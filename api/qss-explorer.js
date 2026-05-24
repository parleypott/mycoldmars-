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
    return j(502, { error: 'no_items_extracted', chunkErrors });
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

// Build a full nano-banana art prompt from a row's title + caption.
// Encapsulates the world style frame so the model gets a consistent
// painterly Burgundy treatment without the extract step having to
// emit it per row.
function buildArtPrompt(row) {
  const STYLE = [
    'Painterly cinematic watercolor illustration in the register of Studio Ghibli atmosphere crossed with Iron Giant mechanical weight and a Yucatan 1512 movie-poster mood.',
    'Hand-painted feel, visible brush strokes, atmospheric depth, painted lighting.',
    'PALETTE: deep teal-blue night, warm amber lamplight, sienna-burgundy reds, iron-gray. Heavy chiaroscuro.',
    'WORLD: Puppy Town — a backwater mining planet. Retro-futurist: MS-DOS green-on-black terminals, CRT monitors, hand-soldered boards.',
    'The puppies are LITERAL working-breed dogs (brown-and-white, tan, weathered) in period work clothes / royal cloaks — NOT cute anthropomorphic mascots.',
    'DO NOT: sticker outlines, flat cel coloring, manga/anime, photorealism, generic Disney-3D, bright saccharine palettes.',
  ].join(' ');
  const KIND_HINT = {
    person: 'PORTRAIT framing — 3/4 or head-and-shoulders, character-focused.',
    place:  'ESTABLISHING shot — landscape framing, environment-first, atmospheric.',
    thing:  'CLOSE-UP — single object or contraption, tactile detail, painted lighting.',
    event:  'CINEMATIC scene — multiple figures, action moment, dramatic composition.',
  }[row.kind] || '';
  return `${STYLE}\n\n${KIND_HINT}\n\nSUBJECT: ${row.title}. ${row.caption || ''} ${row.source_quote ? `(Anchor moment from the source: "${row.source_quote}")` : ''}`;
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
