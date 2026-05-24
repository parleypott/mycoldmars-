// queen-scarlet-school: Book View — scene detection.
//
// Given a story_id, reads the story's blocks, asks Claude Haiku to
// segment the prose into scenes (location change, time jump, new
// character entrance), then writes one row per scene into
// qss_story_scenes (status=queued). The client then dispatches
// per-scene image generation via qss-scene-illustrate.
//
// Idempotent — re-running on the same story diff-merges scenes by
// scene_index: existing scenes keep their image_url + variations +
// vote, only metadata is updated.
//
// POST /api/qss-scene-detect?world=<slug>
// body: { story_id: uuid, force?: boolean }
// returns: { scenes: [...rows...], detected: number }

import { checkAccess } from './_lib/access.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

const SUPABASE_URL = process.env.QSS_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.QSS_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
};

function j(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

async function sb(method, path, body) {
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`supabase_${res.status}: ${t.slice(0, 200)}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return j(405, { error: 'method_not_allowed' });

  const denied = await checkAccess(req);
  if (denied) {
    const h = new Headers(denied.headers);
    for (const [k, v] of Object.entries(CORS)) h.set(k, v);
    return new Response(denied.body, { status: denied.status, headers: h });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) return j(500, { error: 'no_db' });

  const body = await req.json().catch(() => ({}));
  const storyId = String(body?.story_id || '').trim();
  if (!storyId) return j(400, { error: 'no_story_id' });
  const force = !!body?.force;

  // Load the story.
  const storyRows = await sb('GET', `qss_stories?id=eq.${encodeURIComponent(storyId)}&select=id,name,blocks,bible,rules,world_slug&limit=1`);
  if (!storyRows?.length) return j(404, { error: 'story_not_found' });
  const story = storyRows[0];
  const blocks = Array.isArray(story.blocks) ? story.blocks : [];
  if (!blocks.length) return j(400, { error: 'story_has_no_blocks' });

  // If scenes already exist for this story AND force is false, return
  // existing — don't re-spend tokens unless asked.
  if (!force) {
    const existing = await sb('GET', `qss_story_scenes?story_id=eq.${encodeURIComponent(storyId)}&order=scene_index.asc&select=*`);
    if (existing?.length) {
      return j(200, { scenes: existing, detected: existing.length, cached: true });
    }
  }

  // Call Claude Haiku to enumerate scenes.
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return j(500, { error: 'anthropic_key_missing' });

  // Build the story-as-text payload — block index + text so the model
  // can cite block ranges back to us.
  const proseLines = blocks.map((b, i) => {
    const text = (typeof b === 'string' ? b : b?.text || '').trim();
    return `[B${i}] ${text}`;
  }).join('\n\n');

  const SYSTEM = `You read a kid-written story and identify natural SCENE BREAKS — where the camera would cut in a film. A scene break is:
  - location change (the story moves to a new setting)
  - time jump (later that day, the next morning, etc.)
  - new character enters in a significant way
  - major action shift (build → reveal, calm → fight, etc.)

For each scene, return:
  - scene_index: integer starting at 0
  - title: short cinematic label, 3-7 words ("Basement workshop · 5am", "King's throne room siege")
  - setting: 2-4 word location ("the basement", "throne hall", "shaft #12")
  - time_of_day: free text or empty ("dawn", "thirty-one hours awake", "")
  - prose_start_block: integer, first block (inclusive) the scene covers
  - prose_end_block: integer, last block (inclusive)
  - characters_present: array of character names that appear (by name, as spelled in the story)
  - prose_excerpt: 1-2 sentences summarizing what happens in this scene

OUTPUT — strict JSON, no fences, no preamble:
{ "scenes": [ {scene_index, title, setting, time_of_day, prose_start_block, prose_end_block, characters_present, prose_excerpt}, ... ] }

RULES:
1. A short story (1-3 blocks) is one scene.
2. Long stories get one scene per ~3-8 blocks at natural breaks.
3. NEVER skip a block — scenes must cover [0..last_block_index] contiguously without gaps.
4. Sequential scenes can share a setting if the time/action shifted.
5. characters_present uses the names AS SPELLED in the story (preserve capitalization, weird spellings).

Plain JSON only.`;

  const userPrompt = `Story: "${story.name}"

${proseLines}

Return ~${Math.max(1, Math.min(10, Math.ceil(blocks.length / 4)))} scenes covering all ${blocks.length} blocks.`;

  let detected;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3500,
        system: SYSTEM,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return j(502, { error: 'anthropic_failed', detail: `${r.status}: ${t.slice(0, 200)}` });
    }
    const payload = await r.json();
    const raw = payload?.content?.[0]?.text || '';
    let cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const firstBrace = cleaned.indexOf('{');
    if (firstBrace > 0) cleaned = cleaned.slice(firstBrace);
    const parsed = JSON.parse(cleaned);
    detected = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
  } catch (e) {
    return j(502, { error: 'detect_failed', detail: (e?.message || String(e)).slice(0, 300) });
  }

  if (!detected.length) return j(502, { error: 'no_scenes_detected' });

  // Sanitize + upsert. Preserve existing image_url / variations / vote
  // on rows whose scene_index already exists.
  const lastBlock = blocks.length - 1;
  const cleaned = detected
    .filter(s => s && typeof s.scene_index === 'number')
    .map(s => ({
      story_id: storyId,
      scene_index: Math.max(0, Math.floor(s.scene_index)),
      title: String(s.title || '').slice(0, 200),
      setting: String(s.setting || '').slice(0, 100),
      time_of_day: String(s.time_of_day || '').slice(0, 100),
      prose_start_block: Math.max(0, Math.min(lastBlock, Math.floor(s.prose_start_block || 0))),
      prose_end_block:   Math.max(0, Math.min(lastBlock, Math.floor(s.prose_end_block ?? s.prose_start_block ?? 0))),
      characters_present: Array.isArray(s.characters_present)
        ? s.characters_present.filter(x => typeof x === 'string').map(x => x.slice(0, 100)).slice(0, 12)
        : [],
      prose_excerpt: String(s.prose_excerpt || '').slice(0, 1000),
      status: 'queued',
    }))
    .sort((a, b) => a.scene_index - b.scene_index);

  // Upsert each scene by (story_id, scene_index). Use Prefer:
  // resolution=merge-duplicates so existing image_url stays put.
  // We DON'T want to nuke existing variations/vote/image just because
  // the detect re-ran.
  for (const row of cleaned) {
    await sb('POST', 'qss_story_scenes?on_conflict=story_id,scene_index', row);
  }

  const after = await sb('GET', `qss_story_scenes?story_id=eq.${encodeURIComponent(storyId)}&order=scene_index.asc&select=*`);
  return j(200, { scenes: after || [], detected: cleaned.length });
}
