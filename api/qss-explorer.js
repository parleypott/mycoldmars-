// queen-scarlet-school: World Explorer hub.
//
// One endpoint, action-routed via ?action=. Powers the world-explorer
// page at /universe/<world>/explore/.
//
// Actions:
//   GET  ?action=list&world=...                → { items: [...] }
//   POST ?action=extract                       → seed 100 items from the
//                                                 source novel. Returns
//                                                 { inserted, items }.
//   POST ?action=generate                      → produce one image for
//                                                 item { id }. Updates
//                                                 status + image bytes.
//   POST ?action=rate                          → { id, rating, reason? }
//   POST ?action=reset                         → wipe a world's explorer
//                                                 (debug only).
//
// Schema:  qss_world_explorer  (migration applied 2026-05-23)
//   id uuid, world_slug, kind (person|place|thing|event), title, caption,
//   source_quote, art_prompt, image_data_base64, image_mime, rating,
//   rating_reason, status (queued|generating|ready|error), sort_order,
//   created_at, updated_at.

import { checkAccess } from './_lib/access.js';
import { BURGUNDY_NOVEL_ACT1 } from './_lib/burgundy-novel-act1.js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
};

function j(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

async function sb(method, path, body) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const err = new Error(`supabase_${res.status}: ${txt.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return null;
}

function sanitizeWorldSlug(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'burgundy') return 'burgundy';
  return 'queen-scarlet';
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const denied = await checkAccess(req);
  if (denied) {
    const h = new Headers(denied.headers);
    for (const [k, v] of Object.entries(CORS)) h.set(k, v);
    return new Response(denied.body, { status: denied.status, headers: h });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) return j(500, { error: 'no_db' });

  const url = new URL(req.url);
  const action = url.searchParams.get('action') || (req.method === 'GET' ? 'list' : '');

  try {
    if (req.method === 'GET' && action === 'list') {
      const world = sanitizeWorldSlug(url.searchParams.get('world'));
      const rows = await sb('GET', `qss_world_explorer?world_slug=eq.${encodeURIComponent(world)}&order=sort_order.asc,created_at.asc&select=id,world_slug,kind,title,caption,source_quote,art_prompt,image_data_base64,image_mime,rating,rating_reason,status,error_msg,sort_order,created_at,updated_at&limit=500`);
      return j(200, { items: rows || [] });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (action === 'extract')  return await handleExtract(body);
      if (action === 'generate') return await handleGenerate(body);
      if (action === 'rate')     return await handleRate(body);
      if (action === 'reset')    return await handleReset(body);
      return j(400, { error: 'bad_action' });
    }
    return j(405, { error: 'method_not_allowed' });
  } catch (e) {
    console.error('[qss-explorer]', e);
    return j(500, { error: 'internal', detail: (e?.message || String(e)).slice(0, 300) });
  }
}

// ────────────────────── extract ──────────────────────
// Reads the world's source novel (currently hardcoded to Burgundy Act I —
// the puppy_town_act1_novel.md we baked into burgundy-novel-act1.js).
// Asks Haiku to enumerate ~100 explorer items spanning people, places,
// things, and events. Inserts them all with status='queued'. The client
// then dispatches per-item image generation in parallel batches.

async function handleExtract(body) {
  const world = sanitizeWorldSlug(body?.world);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return j(500, { error: 'anthropic_key_missing' });

  const source = typeof body?.source_text === 'string' && body.source_text.trim()
    ? body.source_text
    : (world === 'burgundy' ? BURGUNDY_NOVEL_ACT1 : '');
  if (!source) return j(400, { error: 'no_source_for_world' });

  // Sectioned + sequential extract — Edge runtime doesn't give us real
  // parallelism for outbound fetches to one host (Anthropic), so 4
  // simultaneous calls effectively serialize and hit the 25s cap.
  // Strategy: do one focused call that covers the WHOLE novel and
  // requests ~50 items. Haiku-4.5 handles this in ~12-16s. We get a
  // good first pass; user can later trigger a "more items" expansion
  // by re-running extract or by adding follow-up endpoints.
  const TARGET_ITEMS = 50;
  const results = [await extractChunk({
    apiKey,
    section: source,
    sectionIndex: 0,
    totalSections: 1,
    itemsTarget: TARGET_ITEMS,
  }).then(items => ({ status: 'fulfilled', value: items }))
   .catch(e => ({ status: 'rejected', reason: e }))];

  // Merge — preserve section order so the gallery reads top-to-bottom
  // through the novel.
  const VALID_KIND = new Set(['person', 'place', 'thing', 'event']);
  let allItems = [];
  let chunkErrors = [];
  results.forEach((r, idx) => {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      allItems = allItems.concat(r.value.map((it, withinIdx) => ({ ...it, _sec: idx, _within: withinIdx })));
    } else {
      chunkErrors.push({ section: idx, error: r.reason?.message || String(r.reason || 'unknown') });
    }
  });

  if (!allItems.length) {
    return j(502, { error: 'no_items_extracted', chunkErrors });
  }

  const rows = allItems
    .filter(x => x && VALID_KIND.has(x.kind) && x.title && x.art_prompt)
    .map((x, i) => ({
      world_slug: world,
      kind: String(x.kind).slice(0, 16),
      title: String(x.title).slice(0, 200),
      caption: String(x.caption || '').slice(0, 400),
      source_quote: String(x.source_quote || '').slice(0, 600),
      art_prompt: String(x.art_prompt).slice(0, 4000),
      status: 'queued',
      sort_order: i,
    }));

  if (!rows.length) return j(502, { error: 'no_valid_items', chunkErrors });

  // Wipe + reseed.
  await sb('DELETE', `qss_world_explorer?world_slug=eq.${encodeURIComponent(world)}`);
  const inserted = await sb('POST', 'qss_world_explorer', rows);
  return j(200, {
    inserted: (inserted || []).length,
    items: inserted || [],
    chunkErrors: chunkErrors.length ? chunkErrors : undefined,
  });
}

// Split source text into N roughly-equal sections by paragraph break.
// Each section is contiguous prose — the model sees a coherent slice,
// not arbitrarily chopped mid-sentence.
function splitSourceIntoChunks(text, n) {
  const len = text.length;
  const target = Math.floor(len / n);
  const sections = [];
  let cursor = 0;
  for (let i = 0; i < n - 1; i++) {
    const idealEnd = cursor + target;
    // Find next paragraph break after the ideal endpoint.
    let cut = text.indexOf('\n\n', idealEnd);
    if (cut === -1) cut = idealEnd;
    sections.push(text.slice(cursor, cut).trim());
    cursor = cut;
  }
  sections.push(text.slice(cursor).trim());
  return sections.filter(s => s.length > 0);
}

async function extractChunk({ apiKey, section, sectionIndex, totalSections, itemsTarget }) {
  const SYSTEM = `You are an editorial researcher. You're reading section ${sectionIndex + 1} of ${totalSections} of a novel and enumerating distinctive subjects — every person, place, thing, and event in this section — so that an illustrator could draw companion cards.

OUTPUT — strict JSON, no fences, no preamble:
{
  "items": [
    {
      "kind": "person" | "place" | "thing" | "event",
      "title": "Burgundy at the basement workshop",
      "caption": "Three monitors glowing green, the prototype under a tarp, two years of late nights.",
      "source_quote": "The basement smelled like ozone and old copper.",
      "art_prompt": "A young puppy in coveralls hunched at a workbench, three CRT monitors glowing green-on-black, ..."
    }
  ]
}

RULES:
1. Return APPROXIMATELY ${itemsTarget} items from THIS section only. A few more or fewer is fine; do NOT stretch to hit a quota.
2. Distribution across kinds should reflect what's actually IN this section.
3. "title" — 3-8 words, action-led. Distinguishing detail over generic noun.
4. "caption" — 1 sentence, 8-22 words. No AI-essay tropes.
5. "source_quote" — short verbatim phrase from THIS section, 4-20 words. Empty string if none anchors.
6. "art_prompt" — 80-220 words, image-gen ready. ALWAYS include the world style frame:
   - Painterly cinematic watercolor; Studio Ghibli atmosphere + Iron Giant mechanical weight + Yucatan 1512 movie-poster mood
   - Hand-painted, visible brush strokes, atmospheric depth
   - Deep teal-blue night + warm amber lamplight + sienna-burgundy reds + iron-gray
   - Puppies are LITERAL working-breed dogs (brown-and-white, weathered, period clothes) — NOT cute mascots
   - Retro-futurist mining planet: MS-DOS green-on-black terminals, CRT monitors, hand-soldered circuits
   - NOT sticker, NOT cel, NOT vector, NOT photorealism, NOT manga
   Then describe the SPECIFIC scene/subject with concrete visual detail.
7. Items should appear in the order they're introduced in the source.

Plain JSON only. No fences. No preamble.`;

  const userPrompt = [
    `Section ${sectionIndex + 1} of ${totalSections} between markers. Enumerate items from THIS section only.`,
    '',
    '===SECTION-BEGIN===',
    section,
    '===SECTION-END===',
    '',
    `Return ~${itemsTarget} items as JSON.`,
  ].join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 11000,
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    signal: AbortSignal.timeout(23_500),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`anthropic_${res.status}: ${txt.slice(0, 160)}`);
  }
  const payload = await res.json();
  const raw = payload?.content?.[0]?.text || '';
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch { throw new Error('parse_failed'); }
  return Array.isArray(parsed?.items) ? parsed.items : [];
}

// ────────────────────── generate one image ──────────────────────

async function handleGenerate(body) {
  const id = String(body?.id || '').trim();
  if (!id) return j(400, { error: 'no_id' });

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) return j(500, { error: 'gemini_key_missing' });

  // Load the row.
  const rows = await sb('GET', `qss_world_explorer?id=eq.${encodeURIComponent(id)}&select=id,world_slug,art_prompt,status&limit=1`);
  if (!rows?.length) return j(404, { error: 'not_found' });
  const row = rows[0];
  if (row.status === 'ready') return j(200, { ok: true, status: 'ready', skipped: true });

  // Mark as generating
  await sb('PATCH', `qss_world_explorer?id=eq.${encodeURIComponent(id)}`, { status: 'generating', updated_at: new Date().toISOString() });

  // Call Gemini Nano Banana — same model + header pattern as
  // /api/nano-banana so failure modes and rate-limit behavior match.
  let imgBase64 = null;
  let imgMime = 'image/png';
  let errMsg = null;
  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: row.art_prompt }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
        signal: AbortSignal.timeout(22_000),
      }
    );
    if (!geminiRes.ok) {
      const t = await geminiRes.text().catch(() => '');
      errMsg = `gemini_${geminiRes.status}: ${t.slice(0, 200)}`;
    } else {
      const data = await geminiRes.json();
      const candidates = data?.candidates || [];
      for (const c of candidates) {
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
    errMsg = e?.message || String(e);
  }

  if (!imgBase64) {
    await sb('PATCH', `qss_world_explorer?id=eq.${encodeURIComponent(id)}`, {
      status: 'error', error_msg: (errMsg || 'unknown').slice(0, 300), updated_at: new Date().toISOString(),
    });
    return j(502, { error: 'image_gen_failed', detail: errMsg });
  }

  await sb('PATCH', `qss_world_explorer?id=eq.${encodeURIComponent(id)}`, {
    status: 'ready',
    image_data_base64: imgBase64,
    image_mime: imgMime,
    error_msg: null,
    updated_at: new Date().toISOString(),
  });
  return j(200, { ok: true, status: 'ready' });
}

// ────────────────────── rate ──────────────────────

async function handleRate(body) {
  const id = String(body?.id || '').trim();
  if (!id) return j(400, { error: 'no_id' });
  const ratingIn = String(body?.rating || '').toLowerCase();
  const rating = (ratingIn === 'up' || ratingIn === 'down') ? ratingIn : null;
  const reason = String(body?.reason || '').slice(0, 600) || null;

  await sb('PATCH', `qss_world_explorer?id=eq.${encodeURIComponent(id)}`, {
    rating,
    rating_reason: reason,
    updated_at: new Date().toISOString(),
  });
  return j(200, { ok: true });
}

// ────────────────────── reset ──────────────────────

async function handleReset(body) {
  const world = sanitizeWorldSlug(body?.world);
  await sb('DELETE', `qss_world_explorer?world_slug=eq.${encodeURIComponent(world)}`);
  return j(200, { ok: true });
}
