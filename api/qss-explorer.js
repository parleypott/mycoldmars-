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
import { loadWorldStyle, sanitizeSlug } from './_lib/qss-worlds.js';
import { imageStorageMeta } from './_lib/image-storage.js';

// Edge runtime. We surfaced the underlying Anthropic error so we can see
// why the call is failing fast. The list endpoint no longer pulls
// image_data_base64 (was the 504-on-GET cause); images are streamed via
// ?action=image&id=... instead.
export const config = { runtime: 'edge', maxDuration: 30 };

const SUPABASE_URL = process.env.QSS_SUPABASE_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.QSS_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

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

// World-slug resolution is owned by the shared registry in qss-worlds.js
// (the single source of truth `sanitizeSlug` uses). This file previously
// kept its own hardcoded `if (s === 'burgundy')` allowlist — extensionally
// identical for the two worlds that exist today, but a latent landmine: the
// moment a 3rd world ships, the local copy would silently route its explorer
// items to queen-scarlet — showing the WRONG world's atlas on `list`, storing
// new items under the wrong world on `generate`, and (worst) wiping the wrong
// world's atlas on `reset`. Routing through the registry closes that: adding a
// world to qss-worlds.js's WORLDS is the only edit ever needed.
const sanitizeWorldSlug = sanitizeSlug;

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const action = url.searchParams.get('action') || (req.method === 'GET' ? 'list' : '');

  // ?action=image returns image bytes for <img src> tags, which can't carry
  // the x-access-code header. The image data is non-sensitive curated atlas
  // art (same threat model as a public CDN), so this route is open. All
  // other actions (list / extract / generate / rate / reset) require auth.
  if (!(req.method === 'GET' && action === 'image')) {
    const denied = await checkAccess(req);
    if (denied) {
      const h = new Headers(denied.headers);
      for (const [k, v] of Object.entries(CORS)) h.set(k, v);
      return new Response(denied.body, { status: denied.status, headers: h });
    }
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) return j(500, { error: 'no_db' });

  try {
    if (req.method === 'GET' && action === 'list') {
      const world = sanitizeWorldSlug(url.searchParams.get('world'));
      // Pull image_url so the client can serve straight from Supabase
      // Storage's public CDN. Falls back to /api/qss-explorer?action=image
      // for rows that pre-date the Storage migration (image_url null but
      // image_data_base64 present). Migrating those rows is handled
      // separately by backfill-explorer-storage.mjs.
      const rows = await sb('GET', `qss_world_explorer?world_slug=eq.${encodeURIComponent(world)}&order=sort_order.asc,created_at.asc&select=id,world_slug,kind,title,caption,source_quote,art_prompt,image_mime,image_url,rating,rating_reason,status,error_msg,sort_order,created_at,updated_at&limit=500`);
      return j(200, { items: rows || [] });
    }

    if (req.method === 'GET' && action === 'image') {
      const id = url.searchParams.get('id') || '';
      if (!id) return j(400, { error: 'no_id' });
      const rows = await sb('GET', `qss_world_explorer?id=eq.${encodeURIComponent(id)}&select=image_data_base64,image_mime&limit=1`);
      const row = rows?.[0];
      if (!row?.image_data_base64) return j(404, { error: 'not_ready' });
      // Edge-safe base64 decode → Uint8Array (no Buffer global on Edge).
      const bin = atob(row.image_data_base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': imageStorageMeta(row.image_mime).mime,
          'Cache-Control': 'public, max-age=31536000, immutable',
          ...CORS,
        },
      });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (action === 'extract')  return await handleExtract(body);
      if (action === 'append')   return await handleAppend(body);
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

  // KEY INSIGHT — even with templated art_prompt and 25-item target,
  // Haiku was still timing out. The 44K-char input ALONE takes ~20s
  // to process on Edge (something about Edge + Anthropic latency).
  // Fix: send only the FIRST QUARTER of the novel in the extract step.
  // Subsequent quarters get appended via /append?pass=2|3|4 — same
  // pattern Henry's client already chains.
  const FIRST_QUARTER = splitSourceIntoChunks(source, 4)[0] || source;
  const TARGET_ITEMS = 25;
  const results = [await extractChunk({
    apiKey,
    section: FIRST_QUARTER,
    sectionIndex: 0,
    totalSections: 4,
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
    const detail = chunkErrors.map(e => e.error).filter(Boolean).join(' | ') || 'no detail';
    return j(502, { error: 'no_items_extracted', detail, chunkErrors });
  }

  const rows = allItems
    .filter(x => x && VALID_KIND.has(x.kind) && x.title)
    .map((x, i) => {
      const row = {
        world_slug: world,
        kind: String(x.kind).slice(0, 16),
        title: String(x.title).slice(0, 200),
        caption: String(x.caption || '').slice(0, 400),
        source_quote: String(x.source_quote || '').slice(0, 600),
        status: 'queued',
        sort_order: i,
      };
      row.art_prompt = buildArtPrompt(row).slice(0, 4000);
      return row;
    });

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

// ────────────────────── append (chain to reach 100) ──────────────────────
// Adds more items WITHOUT wiping. The client calls this with a pass
// hint (1..4) that focuses Haiku on a specific quarter of the novel,
// telling it which kinds we already have a lot of so it diversifies.
async function handleAppend(body) {
  const world = sanitizeWorldSlug(body?.world);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return j(500, { error: 'anthropic_key_missing' });

  const source = typeof body?.source_text === 'string' && body.source_text.trim()
    ? body.source_text
    : (world === 'burgundy' ? BURGUNDY_NOVEL_ACT1 : '');
  if (!source) return j(400, { error: 'no_source_for_world' });

  // Pass selector: 1..N, picks a quarter of the novel.
  const pass = Math.max(1, Math.min(4, Number(body?.pass) || 2));
  const TOTAL_SECTIONS = 4;
  const sections = splitSourceIntoChunks(source, TOTAL_SECTIONS);
  const section = sections[pass - 1] || source;

  // Existing titles — sent in the prompt so Haiku doesn't duplicate.
  const existingRows = await sb('GET', `qss_world_explorer?world_slug=eq.${encodeURIComponent(world)}&select=title,sort_order&order=sort_order.asc&limit=200`);
  const existingTitles = (existingRows || []).map(r => r.title);
  const maxSort = (existingRows || []).reduce((m, r) => Math.max(m, Number(r.sort_order) || 0), -1);

  let items;
  try {
    items = await extractChunk({
      apiKey,
      section,
      sectionIndex: pass - 1,
      totalSections: TOTAL_SECTIONS,
      itemsTarget: 25,
      existingTitles,
    });
  } catch (e) {
    return j(502, { error: 'extract_failed', detail: e?.message || String(e) });
  }

  const VALID_KIND = new Set(['person', 'place', 'thing', 'event']);
  const lowerExisting = new Set(existingTitles.map(t => t.toLowerCase()));
  const rows = items
    .filter(x => x && VALID_KIND.has(x.kind) && x.title)
    .filter(x => !lowerExisting.has(String(x.title).toLowerCase()))
    .map((x, i) => {
      const row = {
        world_slug: world,
        kind: String(x.kind).slice(0, 16),
        title: String(x.title).slice(0, 200),
        caption: String(x.caption || '').slice(0, 400),
        source_quote: String(x.source_quote || '').slice(0, 600),
        status: 'queued',
        sort_order: maxSort + 1 + i,
      };
      row.art_prompt = buildArtPrompt(row).slice(0, 4000);
      return row;
    });

  if (!rows.length) return j(200, { inserted: 0, items: [], note: 'no_new_items' });
  const inserted = await sb('POST', 'qss_world_explorer', rows);
  return j(200, { inserted: (inserted || []).length, items: inserted || [] });
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

async function extractChunk({ apiKey, section, sectionIndex, totalSections, itemsTarget, existingTitles }) {
  // KEY OPTIMIZATION — extract returns ONLY title/caption/kind/quote
  // per item. The art_prompt is built server-side at draw time by
  // combining a world-template with the item title + caption. The old
  // version asked the model to emit a 200-word art_prompt PER item,
  // which dominated output token count and kept blowing the 25s cap.
  const dedupClause = (Array.isArray(existingTitles) && existingTitles.length)
    ? `\n\nALREADY CAPTURED — DO NOT REPEAT THESE TITLES:\n${existingTitles.slice(0, 80).map(t => `- ${t}`).join('\n')}\n\nReturn ONLY NEW items.`
    : '';
  const SYSTEM = `You read a novel and enumerate distinctive subjects — every person, place, thing, and event — so an illustrator can draw companion cards.${dedupClause}

OUTPUT — strict JSON, no fences, no preamble:
{
  "items": [
    { "kind": "person", "title": "Burgundy at the basement workshop", "caption": "Three monitors glow green; the prototype waits under a tarp.", "source_quote": "The basement smelled like ozone and old copper." }
  ]
}

RULES:
1. ~${itemsTarget} items from THIS source.
2. Spread across kinds: person | place | thing | event (whatever's actually IN the source).
3. title: 3-8 words, action-led. Distinguishing detail over generic noun.
4. caption: 1 sentence, 8-22 words. Concrete. No AI-essay tropes.
5. source_quote: 4-20 word verbatim phrase from the source, or empty string.
6. Order: roughly narrative order through the source.

Plain JSON only. No art_prompt — that's built server-side.`;

  const userPrompt = [
    totalSections > 1
      ? `Section ${sectionIndex + 1} of ${totalSections}. Enumerate items from THIS section.`
      : 'Full source. Enumerate items.',
    '',
    '===BEGIN===',
    section,
    '===END===',
    '',
    `Return ~${itemsTarget} items as JSON. No fences.`,
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
      // Item now = title + caption + quote + kind ≈ 60-80 output tokens.
      // 25 items × 80 = 2000 tokens. Leaves headroom for 40+ items if
      // the model goes verbose. Total output time ~6-10s vs ~20s before.
      max_tokens: 3500,
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    signal: AbortSignal.timeout(26_000),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`anthropic_${res.status}: ${txt.slice(0, 200)}`);
  }
  const payload = await res.json();
  const raw = payload?.content?.[0]?.text || '';
  const stopReason = payload?.stop_reason || '';
  if (!raw) {
    throw new Error(`empty_response stop=${stopReason || 'none'}`);
  }
  // Strip fences, also handle a leading prose preamble before the JSON.
  let cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  // Find first { and trim everything before.
  const firstBrace = cleaned.indexOf('{');
  if (firstBrace > 0) cleaned = cleaned.slice(firstBrace);
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (e) {
    throw new Error(`parse_failed stop=${stopReason} preview=${cleaned.slice(0, 120).replace(/\n/g, ' ')}`);
  }
  return Array.isArray(parsed?.items) ? parsed.items : [];
}

// Build a full nano-banana art prompt from a row's title + caption.
// Composes from the LIVE world style (DB-edited art_style merged over
// the bundled defaults via loadWorldStyle). Async so style hub edits
// flow through to the next explorer draw without a deploy. If no
// style row is found, falls back to the bundled defaults silently —
// never produces an empty prompt.
async function buildArtPromptLive(row) {
  const style = await loadWorldStyle(row.world_slug);
  const a = style.artStyle || {};
  // The four fields composed: styleBlock + references + dontList sit
  // ABOVE the subject so they define the register before the prompt
  // names what to draw. `paper` slots in last as a backdrop directive
  // since it affects framing more than register.
  const STYLE = [a.styleBlock, a.references, a.dontList].filter(Boolean).join(' ');
  const KIND_HINT = {
    person: 'PORTRAIT framing — 3/4 or head-and-shoulders, character-focused.',
    place:  'ESTABLISHING shot — landscape framing, environment-first, atmospheric.',
    thing:  'CLOSE-UP — single object or contraption, tactile detail, painted lighting.',
    event:  'CINEMATIC scene — multiple figures, action moment, dramatic composition.',
  }[row.kind] || '';
  const PAPER = a.paper ? `BACKGROUND: ${a.paper}` : '';
  return [
    STYLE,
    KIND_HINT,
    PAPER,
    `SUBJECT: ${row.title}. ${row.caption || ''} ${row.source_quote ? `(Anchor moment from the source: "${row.source_quote}")` : ''}`,
  ].filter(Boolean).join('\n\n');
}

// Sync version kept for the extract step (where we have no live style
// context at write time — extracts run BEFORE the row exists in DB).
// New rows still store this in art_prompt as a fallback for any older
// callers, but handleGenerate now uses buildArtPromptLive to recompute
// from current style every time.
function buildArtPrompt(row) {
  const KIND_HINT = {
    person: 'PORTRAIT framing — 3/4 or head-and-shoulders, character-focused.',
    place:  'ESTABLISHING shot — landscape framing, environment-first, atmospheric.',
    thing:  'CLOSE-UP — single object or contraption, tactile detail, painted lighting.',
    event:  'CINEMATIC scene — multiple figures, action moment, dramatic composition.',
  }[row.kind] || '';
  return `${KIND_HINT}\n\nSUBJECT: ${row.title}. ${row.caption || ''} ${row.source_quote ? `(Anchor moment from the source: "${row.source_quote}")` : ''}`;
}

// ────────────────────── generate one image ──────────────────────

async function handleGenerate(body) {
  const id = String(body?.id || '').trim();
  if (!id) return j(400, { error: 'no_id' });

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) return j(500, { error: 'gemini_key_missing' });

  // Load the row — pull the source fields needed to recompute the
  // prompt against current world style, plus art_prompt as a legacy
  // fallback in case the new fields are missing.
  const rows = await sb('GET', `qss_world_explorer?id=eq.${encodeURIComponent(id)}&select=id,world_slug,kind,title,caption,source_quote,art_prompt,status&limit=1`);
  if (!rows?.length) return j(404, { error: 'not_found' });
  const row = rows[0];
  if (row.status === 'ready') return j(200, { ok: true, status: 'ready', skipped: true });

  // Recompose the prompt from CURRENT world style + this row's
  // title/caption. Falls back to the row's stored art_prompt if
  // anything in buildArtPromptLive throws (e.g. DB hiccup).
  let livePrompt = '';
  try { livePrompt = await buildArtPromptLive(row); }
  catch (e) { console.warn('[qss-explorer] buildArtPromptLive failed, using stored', e?.message); }
  const promptForGemini = livePrompt || row.art_prompt || '';

  // Mark as generating
  await sb('PATCH', `qss_world_explorer?id=eq.${encodeURIComponent(id)}`, { status: 'generating', updated_at: new Date().toISOString() });

  // Call Gemini Nano Banana — same model + header pattern as
  // /api/nano-banana so failure modes and rate-limit behavior match.
  let imgBase64 = null;
  let imgMime = 'image/png';
  let errMsg = null;
  try {
    // gemini-3.1-flash-image-preview hangs forever (direct curl 45s -> no
    // response). gemini-2.5-flash-image returns ~2.5 MB image in ~5s.
    // 50s timeout fits inside Node 60s maxDuration with headroom.
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptForGemini }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
        signal: AbortSignal.timeout(50_000),
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

  // Upload bytes straight to Supabase Storage public bucket so the
  // browser can serve them from the CDN without going through this
  // function at all. Cuts the cold-cache 504 cascade — 48 parallel
  // <img> tags used to saturate the function; now they hit Storage's
  // CDN directly.
  // Derive the served Content-Type AND the path extension from ONE normalized
  // mime so they can never disagree, and so only a canonical image type is
  // served from the public qss-explorer bucket (shared with qss-image-upload).
  const { mime: storeMime, ext } = imageStorageMeta(imgMime);
  const storagePath = `${id}.${ext}`;
  let imageUrl = null;
  let uploadErr = null;
  try {
    const bin = atob(imgBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/qss-explorer/${storagePath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': storeMime,
        'x-upsert': 'true',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
      body: bytes,
    });
    if (!upRes.ok) {
      uploadErr = `storage_${upRes.status}: ${(await upRes.text().catch(()=>'')).slice(0,200)}`;
    } else {
      imageUrl = `${SUPABASE_URL}/storage/v1/object/public/qss-explorer/${storagePath}`;
    }
  } catch (e) { uploadErr = e?.message || String(e); }

  // Write back. Even on Storage upload failure we keep the bytes in
  // image_data_base64 so the legacy /action=image route still serves
  // the image — never lose work because of a transient upload hiccup.
  const patch = {
    status: 'ready',
    image_mime: storeMime,
    error_msg: null,
    updated_at: new Date().toISOString(),
  };
  if (imageUrl) {
    patch.image_url = imageUrl;
    patch.storage_path = storagePath;
    // Storage URL is the authoritative source going forward; drop the
    // base64 from DB to reclaim ~2 MB per row.
    patch.image_data_base64 = null;
  } else {
    // Storage failed — keep the bytes in DB so the row still serves.
    patch.image_data_base64 = imgBase64;
    if (uploadErr) patch.error_msg = `storage_upload_failed_kept_inline: ${uploadErr}`.slice(0, 300);
  }
  await sb('PATCH', `qss_world_explorer?id=eq.${encodeURIComponent(id)}`, patch);
  return j(200, { ok: true, status: 'ready', image_url: imageUrl, fallback: !imageUrl });
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
