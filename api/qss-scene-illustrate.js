// queen-scarlet-school: Book View — illustrate one scene.
//
// Given a scene_id, gathers world canon + art style + characters present
// (from qss_cast) + setting (from qss_world_explorer if matched), builds
// the painterly prompt, calls Gemini 2.5 flash image, uploads the bytes
// straight to the qss-scenes Storage bucket, sets image_url on the row.
//
// Same pristine pattern as qss-character-card + qss-explorer image gen.
// Server NEVER stores the bytes inline — DB row only carries the URL.
//
// POST /api/qss-scene-illustrate
// body: { scene_id: uuid, variation?: boolean }
// returns: { ok, image_url, variation_id? }

import { checkAccess } from './_lib/access.js';
import { loadWorldStyle } from './_lib/qss-worlds.js';

// Edge runtime — Node fails on this project. Gemini 2.5-flash-image
// returns in 5-12s, comfortably inside the 25s Edge cap.
export const config = { runtime: 'edge' };

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
  return res.headers.get('content-type')?.includes('application/json') ? res.json() : null;
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
  const sceneId = String(body?.scene_id || '').trim();
  if (!sceneId) return j(400, { error: 'no_scene_id' });
  const isVariation = !!body?.variation;

  // Pull the scene row + the parent story to get world_slug + the
  // actual block text the scene covers.
  const sceneRows = await sb('GET', `qss_story_scenes?id=eq.${encodeURIComponent(sceneId)}&select=*&limit=1`);
  if (!sceneRows?.length) return j(404, { error: 'scene_not_found' });
  const scene = sceneRows[0];

  const storyRows = await sb('GET', `qss_stories?id=eq.${encodeURIComponent(scene.story_id)}&select=id,name,blocks,world_slug&limit=1`);
  if (!storyRows?.length) return j(404, { error: 'story_not_found' });
  const story = storyRows[0];
  const worldSlug = story.world_slug || 'queen-scarlet';

  // For a fresh-draw (not a variation), skip if already ready and
  // image_url is set — caller can force by deleting image_url first.
  if (!isVariation && scene.status === 'ready' && scene.image_url) {
    return j(200, { ok: true, status: 'ready', image_url: scene.image_url, skipped: true });
  }

  // Mark generating
  await sb('PATCH', `qss_story_scenes?id=eq.${encodeURIComponent(sceneId)}`, {
    status: 'generating', updated_at: new Date().toISOString(),
  });

  // ── Build the prompt ──────────────────────────────────────────
  // 1. World art style + canon (DB-live, edited via Style Hub)
  const worldStyle = await loadWorldStyle(worldSlug);
  const art = worldStyle.artStyle || {};
  const STYLE = [art.styleBlock, art.references, art.dontList].filter(Boolean).join(' ');

  // 2. Characters present — look up each by name in qss_cast for visual_notes
  const charPromptParts = [];
  if (Array.isArray(scene.characters_present) && scene.characters_present.length) {
    for (const name of scene.characters_present.slice(0, 6)) {
      try {
        const k = name.toLowerCase();
        const rows = await sb('GET', `qss_cast?name_key=eq.${encodeURIComponent(k)}&world_slug=eq.${encodeURIComponent(worldSlug)}&select=name,visual_notes&limit=1`);
        const c = rows?.[0];
        if (c?.visual_notes) {
          charPromptParts.push(`- ${c.name}: ${c.visual_notes}`);
        } else {
          charPromptParts.push(`- ${name}`);
        }
      } catch {}
    }
  }
  const charBlock = charPromptParts.length
    ? `\n\nCHARACTERS in this scene (preserve their established visual identity):\n${charPromptParts.join('\n')}`
    : '';

  // 3. Setting — match against world_explorer for an anchor image if present
  let settingBlock = scene.setting ? `\n\nSETTING: ${scene.setting}` : '';
  if (scene.setting) {
    try {
      const matches = await sb('GET', `qss_world_explorer?world_slug=eq.${encodeURIComponent(worldSlug)}&kind=eq.place&title=ilike.*${encodeURIComponent(scene.setting.split(' ')[0])}*&select=title,caption&limit=1`);
      if (matches?.length) {
        settingBlock += ` (${matches[0].title}: ${matches[0].caption})`;
      }
    } catch {}
  }

  // 4. The actual prose excerpt — what's happening NOW
  const blocks = Array.isArray(story.blocks) ? story.blocks : [];
  const sceneText = [];
  for (let i = scene.prose_start_block; i <= scene.prose_end_block && i < blocks.length; i++) {
    const b = blocks[i];
    const text = (typeof b === 'string' ? b : b?.text || '').trim();
    if (text) sceneText.push(text);
  }
  const proseBlock = sceneText.length
    ? `\n\nWHAT HAPPENS IN THIS SCENE:\n${sceneText.join('\n\n').slice(0, 1500)}`
    : (scene.prose_excerpt ? `\n\nSCENE SUMMARY: ${scene.prose_excerpt}` : '');

  // 5. Time / framing hint
  const timeBlock = scene.time_of_day ? `\n\nTIME: ${scene.time_of_day}` : '';
  const FRAMING = [
    'CINEMATIC single-frame illustration — one composition, one camera angle, one moment.',
    '',
    'COMPOSITION RULE (absolute, do not break):',
    '- ONE single image. ONE moment.',
    '- NEVER a comic panel layout. NEVER a multi-panel collage. NEVER split-screen.',
    '- NEVER speech bubbles. NEVER thought bubbles. NEVER captions.',
    '- NEVER any text, words, letters, numbers, signs, or labels visible inside the image.',
    '- NEVER show a sequence of beats. Pick the ONE strongest visual moment from the scene below — the most surprising, the most physically dynamic, or the most emotionally loaded — and render ONLY that single picture.',
    '- If the scene describes many things happening, choose the SINGLE image that captures the spirit best. Drop the rest.',
    '- Treat the output like one page of a picture book, NOT a page of a graphic novel.',
  ].join('\n');

  // 6. Variation hint — if generating a variant, ask for a meaningfully
  // different composition with the same characters/setting.
  const variantHint = isVariation
    ? `\n\nVARIATION — same characters, same setting, but a DIFFERENT moment / camera angle / composition from any previous attempt.`
    : '';

  const fullPrompt = `${STYLE}\n\n${FRAMING}\n\nTITLE: ${scene.title}${settingBlock}${timeBlock}${charBlock}${proseBlock}${variantHint}`;

  // ── Generate ──────────────────────────────────────────────────
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!geminiKey) return j(500, { error: 'gemini_key_missing' });

  let imgBase64 = null, imgMime = 'image/png', errMsg = null;
  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
        signal: AbortSignal.timeout(50_000),
      }
    );
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      errMsg = `gemini_${r.status}: ${t.slice(0, 200)}`;
    } else {
      const data = await r.json();
      for (const c of (data?.candidates || [])) {
        for (const p of (c?.content?.parts || [])) {
          if (p.inlineData?.data) {
            imgBase64 = p.inlineData.data;
            imgMime = p.inlineData.mimeType || 'image/png';
            break;
          }
        }
        if (imgBase64) break;
      }
      if (!imgBase64) errMsg = 'no_image_in_response';
    }
  } catch (e) {
    errMsg = (e?.message || String(e)).slice(0, 300);
  }

  if (!imgBase64) {
    await sb('PATCH', `qss_story_scenes?id=eq.${encodeURIComponent(sceneId)}`, {
      status: 'error', error_msg: errMsg, updated_at: new Date().toISOString(),
    });
    return j(502, { error: 'image_gen_failed', detail: errMsg });
  }

  // ── Upload to Storage ─────────────────────────────────────────
  const ext = imgMime.includes('jpeg') ? 'jpg' : imgMime.includes('webp') ? 'webp' : 'png';
  const variationId = isVariation ? `v-${Date.now().toString(36)}` : `primary-${Date.now().toString(36)}`;
  const path = `${worldSlug}/${scene.story_id}/${sceneId}/${variationId}.${ext}`;
  let imageUrl = null, storagePath = null, uploadErr = null;
  try {
    // Edge-safe base64 decode → Uint8Array (no Buffer global on Edge).
    const binStr = atob(imgBase64);
    const bin = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bin[i] = binStr.charCodeAt(i);
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/qss-scenes/${path}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': imgMime,
        'x-upsert': 'true',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
      body: bin,
    });
    if (up.ok) {
      imageUrl = `${SUPABASE_URL}/storage/v1/object/public/qss-scenes/${path}`;
      storagePath = path;
    } else {
      uploadErr = `storage_${up.status}: ${(await up.text().catch(() => '')).slice(0, 200)}`;
    }
  } catch (e) { uploadErr = e?.message || String(e); }

  if (!imageUrl) {
    await sb('PATCH', `qss_story_scenes?id=eq.${encodeURIComponent(sceneId)}`, {
      status: 'error', error_msg: `storage_upload_failed: ${uploadErr}`, updated_at: new Date().toISOString(),
    });
    return j(502, { error: 'storage_upload_failed', detail: uploadErr });
  }

  // ── Write back ────────────────────────────────────────────────
  if (isVariation) {
    // Append to variations[]; keep current image_url as the active one
    // (Henry switches via qss-story-scenes?action=set-active-variation).
    const variations = Array.isArray(scene.variations) ? scene.variations.slice() : [];
    variations.push({
      id: variationId, image_url: imageUrl, storage_path: storagePath,
      mime: imgMime, generated_at: Date.now(),
    });
    await sb('PATCH', `qss_story_scenes?id=eq.${encodeURIComponent(sceneId)}`, {
      status: 'ready', error_msg: null, variations,
      updated_at: new Date().toISOString(),
    });
  } else {
    await sb('PATCH', `qss_story_scenes?id=eq.${encodeURIComponent(sceneId)}`, {
      status: 'ready', error_msg: null,
      image_url: imageUrl, storage_path: storagePath, image_mime: imgMime,
      prompt_text: fullPrompt.slice(0, 4000),
      active_variation_id: variationId,
      updated_at: new Date().toISOString(),
    });
  }
  return j(200, { ok: true, status: 'ready', image_url: imageUrl, variation_id: variationId, is_variation: isVariation });
}
