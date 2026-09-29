// Read one source from the newpress citations RAG in context — the NotebookLM-style
// "open the citation" view behind /sources/?chunk=<chunk_id>.
//
// Calls public.get_rag_source (supabase/migrations/20260929_rag_chunk_seq.sql), which
// returns the focus chunk plus its neighbours in reading order. This endpoint then:
//   - strips the ~200-char overlap the chunker leaves between consecutive chunks, so the
//     text reads continuously (display_text),
//   - returns the whole source when it is small (total <= 40), a window otherwise,
//   - dedupes the citations (which Newpress videos cited this source, and where).
//
// Gated (checkAccess) + per-IP rate limited, same as api/citations-search.js: the corpus
// is internal / copyrighted. No embedding spend here, so the limit is looser.
//
// GET ?chunk=<16 lowercase hex>[&before=N&after=N]        (N: 0..60, default 3)
// 200 → { source:{url,title,access_method,video}, focus, total, first_seq, last_seq,
//         has_before, chunks:[{chunk_id,seq,is_focus,text,display_text,continues}], citations:[...] }
// 400 bad id · 404 unknown chunk · 502 upstream failure

import { checkAccess } from './_lib/access.js';
import { checkRateLimit } from './_lib/rate-limit.js';

export const config = { runtime: 'edge' };

const _bucket = new Map();
const RATE_LIMIT_PER_MIN = 60;
const RATE_WINDOW_MS = 60_000;

const CHUNK_ID_RE = /^[0-9a-f]{16}$/;
const DEFAULT_WINDOW = 3;
const MAX_WINDOW = 60;        // the RPC clamps to this too
const WHOLE_SOURCE_MAX = 40;  // total <= this → return the entire source
const CHAIN_GAP = 100_000;    // chunk_seq_backfill.ts: unconnected chains start on multiples of this

// Overlap probing (chunker: slice [i,end) then [end-200,…), each trimmed).
const HEAD = 60;
const TAIL = 400;

function extractIp(req) {
  try {
    const h = req.headers;
    const v = (typeof h?.get === 'function')
      ? (h.get('x-forwarded-for') || h.get('x-real-ip') || '')
      : (h?.['x-forwarded-for'] || h?.['x-real-ip'] || '');
    return (v || '').split(',')[0].trim() || null;
  } catch { return null; }
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

function clampWindow(raw) {
  if (raw == null || raw === '') return DEFAULT_WINDOW;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_WINDOW;
  return Math.max(0, Math.min(Math.floor(n), MAX_WINDOW));
}

// Remove from `text` the lead-in it repeats from the end of `prev`. Verified, never
// guessed: the candidate overlap must be an exact prefix of `text`, otherwise the text is
// returned untouched (a repeated sentence is better than a lost one).
export function stripOverlap(prev, text) {
  if (typeof prev !== 'string' || typeof text !== 'string') return text;
  const tail = prev.slice(-TAIL);
  const needle = text.slice(0, HEAD);
  if (needle.trim().length < 20) return text; // too short to anchor on
  // Prefer the SHORTEST verified overlap: cutting too little repeats a sentence, cutting
  // too much (repetitive text can verify a longer overlap) would lose text.
  for (let idx = tail.lastIndexOf(needle); idx !== -1; idx = idx === 0 ? -1 : tail.lastIndexOf(needle, idx - 1)) {
    const overlap = tail.slice(idx);
    if (text.startsWith(overlap)) return text.slice(overlap.length);
  }
  return text;
}

export function titleFor(row) {
  const bt = typeof row.book_title === 'string' ? row.book_title.trim() : '';
  if (bt) return bt;
  const url = typeof row.source_url === 'string' ? row.source_url.trim() : '';
  if (url) {
    try {
      const u = new URL(url);
      const segs = u.pathname.split('/').filter(Boolean);
      let last = segs.length ? decodeURIComponent(segs[segs.length - 1]) : '';
      last = last.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim();
      const host = u.hostname.replace(/^www\./, '');
      return last && !/^\d+$/.test(last) ? `${last} (${host})` : host;
    } catch { return url.slice(0, 120); }
  }
  return 'Untitled source';
}

// Distinct (video, doc, span) citations across the window; the focus chunk's come first.
export function dedupeCitations(rows) {
  const ordered = [...rows].sort((a, b) => (b.is_focus === true) - (a.is_focus === true));
  const seen = new Set();
  const out = [];
  for (const r of ordered) {
    if (!Array.isArray(r.metadata)) continue;
    for (const c of r.metadata) {
      if (!c || typeof c !== 'object') continue;
      const key = [c.video ?? '', c.doc_id ?? '', String(c.quoted_span ?? '').replace(/\s+/g, ' ').trim()].join('\u0001');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        chunk_id: r.chunk_id,
        type: c.type ?? null,
        video: c.video ?? null,
        author: c.author ?? null,
        doc_id: c.doc_id ?? null,
        context: c.context ?? null,
        quoted_span: c.quoted_span ?? null,
      });
    }
  }
  return out;
}

async function callRpc(supabaseUrl, supabaseKey, chunkId, before, after) {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/get_rag_source`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_chunk_id: chunkId, p_before: before, p_after: after }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`supabase ${res.status}: ${t.slice(0, 200)}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('unexpected shape');
  return rows;
}

export default async function handler(req) {
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);

  const gate = await checkAccess(req);
  if (gate) return gate;

  if (!checkRateLimit(_bucket, extractIp(req), Date.now(), { limit: RATE_LIMIT_PER_MIN, windowMs: RATE_WINDOW_MS })) {
    return json({ error: 'Too many requests. Wait a minute.' }, 429);
  }

  let params;
  try { params = new URL(req.url, 'http://localhost').searchParams; } catch { params = new URLSearchParams(); }
  const chunkId = (params.get('chunk') || '').trim();
  if (!CHUNK_ID_RE.test(chunkId)) return json({ error: 'chunk must be a 16-character lowercase hex id' }, 400);
  const before = clampWindow(params.get('before'));
  const after = clampWindow(params.get('after'));

  // RAG_SUPABASE_* first — the corpus is not the app's database (see citations-search.js).
  const supabaseUrl = process.env.RAG_SUPABASE_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.RAG_SUPABASE_SERVICE_KEY
    || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return json({ error: 'Supabase is not configured (RAG_SUPABASE_URL / SUPABASE_URL)' }, 500);
  }

  let rows;
  try {
    rows = await callRpc(supabaseUrl, supabaseKey, chunkId, before, after);
    const focusRow = rows.find((r) => r.is_focus);
    const total = focusRow ? Number(focusRow.total) || rows.length : 0;
    // Small source: hand back all of it, not a window. (A focus with no known position
    // can only ever return itself, so re-asking would not help.)
    if (focusRow && focusRow.seq != null && total > 0 && total <= WHOLE_SOURCE_MAX && rows.length < total) {
      rows = await callRpc(supabaseUrl, supabaseKey, chunkId, MAX_WINDOW, MAX_WINDOW);
    }
  } catch (e) {
    return json({ error: `source lookup failed: ${String(e?.message || e).slice(0, 200)}` }, 502);
  }

  const focusRow = rows.find((r) => r.is_focus);
  if (!focusRow) return json({ error: 'chunk not found' }, 404);

  // Reading order is the RPC's; re-sort defensively (nulls last).
  rows = [...rows].sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity));
  const total = Number(focusRow.total) || rows.length;

  const chunks = rows.map((r, i) => ({
    chunk_id: r.chunk_id,
    seq: r.seq ?? null,
    is_focus: r.is_focus === true,
    text: r.text ?? '',
    display_text: i === 0 ? (r.text ?? '') : stripOverlap(rows[i - 1].text, r.text ?? ''),
  }));
  // continues: this chunk's display_text picks up exactly where the previous one ended
  // (overlap verified and removed), so a reader may concatenate them with no separator.
  // False = a gap or an unverifiable seam: show a break between them.
  chunks.forEach((c, i) => { c.continues = i > 0 && c.display_text.length < c.text.length; });

  const seqs = chunks.map((c) => c.seq).filter((s) => s != null);
  const first_seq = seqs.length ? Math.min(...seqs) : null;
  const last_seq = seqs.length ? Math.max(...seqs) : null;

  return json({
    source: {
      url: focusRow.source_url ?? null,
      title: titleFor(focusRow),
      access_method: focusRow.access_method ?? null,
      video: focusRow.video ?? null,
    },
    focus: chunkId,
    total,
    first_seq,
    last_seq,
    // Best effort: an unconnected chain starts on a multiple of CHAIN_GAP, web sources at 0.
    has_before: first_seq != null && total > chunks.length && first_seq % CHAIN_GAP !== 0,
    chunks,
    citations: dedupeCitations(rows),
  });
}
