// Burma Script Tool — TRANSCRIPT DROP (2026-07-21).
//
// Johnny drops/pastes a transcript soundbite — either as a SCREENSHOT of the Interpreter/Trint panel
// (dark UI, an "IN - OUT" timecode range + a quote) or as PLAIN TEXT copied from the same tool — and
// it lands as a properly formatted quote row: the timecode range as clickable CHIPS (day unknown →
// the existing DAY ? state) followed by the quote in ON CAM formatting with its ONCAM run tag,
// reclassifiable to SOT via the existing right-click convert menu.
//
// TWO EXTRACTION ROADS, ONE INSERTION:
//   • TEXT (parseTranscriptText) — pure regex, zero AI, instant. Runs on a plain-text paste/drop the
//     instant it matches the transcript shape (a timecode/-range LEADING the block, optional speaker,
//     Interpreter [...] markers stripped). A paste that does NOT match falls through untouched — the
//     writing-tool paste path is sacred.
//   • IMAGE (startImageQuote) — one call to /api/script-quote-extract (a vision model → strict JSON).
//     While it runs, an attr-driven "reading transcript…" placeholder row holds the spot; on success
//     it swaps to the real quote row, on failure it REVERTS TO MEDIA (the original image is added the
//     normal way) — a dropped file is never lost.
//
// DISAMBIGUATION: an image can't be cheaply told apart (screenshot-of-transcript vs. a real still), so
// when one lands the image handler offers a small flat MEDIA / QUOTE choice at the drop point
// (offerMediaOrQuote). Esc / click-away / Enter = MEDIA (the drop is never lost); Q = QUOTE.
//
// INSERTION SHAPE — a NEW full-width row below the caret's/​drop's outermost row (the tool's grain:
// every piece of material is its own tableRow(cols:1) > tableCell(role:'full') > block, exactly what
// document-builder + doInsertStructureBlock + the media-paste rows build). The block is a NEUTRAL
// noneBlock (a chrome-less line) whose FIRST paragraph carries the timecode CHIPS (timecode mark,
// day=null → the DAY ? state on day-aware scripts) and whose SECOND paragraph carries the quote as a
// contiguous directionMark('oncam') run (speaker "NAME:" prefix inside the run) so the ONCAM run tag
// renders and the convert menu can reclass it to SOT. The MEANING lives in the marks (WP-13: attrs,
// not decorations), so it survives the canonical whole-doc JSON round-trip; a sotBlock node was NOT
// used precisely because the oncam run + inline reclass is the requested, reversible shape.
//
// ONE TRANSACTION per user action (COLLAB LOOP LAW: user-initiated, no auto-dispatch/appendTransaction).

import { mintUserPairId } from './table.js';
import { defaultDirectionMarkAttrs } from './direction-chip.js';
import { isReadOnly } from '../read-mode.js';
import { getEpisode } from '../episode-config.js';

// ── PURE TEXT PARSER ─────────────────────────────────────────────────────────────────────────────
// A line that STARTS with a broadcast timecode — HH:MM:SS:FF (4-part) or HH:MM:SS (3-part), the shapes
// the transcript tools print — optionally after a "LABEL:" speaker prefix, then an optional "- OUT"
// range end, then the rest of the line as the quote. Kept a STATIC literal (no dynamic `new RegExp`,
// per the repo's find-dynamic-regex gate + marks.js's convention): the bare-code sub-pattern
// (\d{2}:\d{2}:\d{2}(?::\d{2})?) is written out at each of its two sites. The hour is a hard 2 digits
// — lockstep with marks.js's TC and the endpoint's TC_RE — so a stray longer number can't masquerade
// as a code. The label group can't begin with a digit (so a bare code is never eaten as a label) and
// must be colon-terminated (so ordinary prose with an embedded clock time never triggers — the code
// has to LEAD its line or sit right after "NAME:").
const TC_LINE_RE = /^(?:([^\d:][^:\n]{0,38}?):\s*)?(\d{2}:\d{2}:\d{2}(?::\d{2})?)(?:\s*(?:[-–—]|to)\s*(\d{2}:\d{2}:\d{2}(?::\d{2})?))?\s*(.*)$/s;

// Interpreter/Trint sprinkle "[...]" / "[…]" ellipsis markers through a soundbite — strip them.
export function stripEllipsisMarkers(s) {
  return String(s || '').replace(/\[\s*(?:\.\.\.|…)\s*\]/g, ' ');
}

// A short speaker LABEL (not prose): ≤40 chars, ≤6 words, no sentence punctuation, name-ish glyphs.
export function isSpeakerLabel(line) {
  const b = String(line || '').replace(/[:\s]+$/, '').trim();
  if (!b || b.length > 40) return false;
  if (/[.!?]/.test(b)) return false;
  if (b.split(/\s+/).filter(Boolean).length > 6) return false;
  return /^[A-Za-z0-9 ,'&/\-]+$/.test(b);
}

function cleanQuote(s) {
  return stripEllipsisMarkers(s).replace(/\s+/g, ' ').trim();
}

// Parse a plain-text clipboard/drop payload into the insertion contract { tcIn, tcOut, text, speaker }
// — or null when it isn't a transcript soundbite (→ the paste falls through untouched). PURE + headless.
//
// Shape accepted (the real Interpreter/Trint copy shapes):
//   "00:25:14:22 - 00:25:38:20  quote text"          (code leads, range)
//   "SPEAKER NAME\n00:25:14:22 - 00:25:38:20\nquote"  (speaker line, then code line, then quote)
//   "NAME: 00:25:14:22 quote"                          (inline speaker label, single code)
// The code must LEAD the block (line 0, or line 1 after a speaker label line) — a timecode buried in
// prose does NOT parse, so normal writing paste is never hijacked.
export function parseTranscriptText(raw) {
  if (typeof raw !== 'string') return null;
  let s = stripEllipsisMarkers(raw.replace(/\r\n?/g, '\n'))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (!s || s.length > 2000) return null; // a soundbite, not an article

  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean);
  // The transcript block LEADS with the code: line 0 is the code line, or line 0 is a speaker label
  // and line 1 is the code line. Anything deeper is prose that happens to contain a time — skip it.
  for (const idx of [0, 1]) {
    if (idx >= lines.length) break;
    if (idx === 1 && !isSpeakerLabel(lines[0])) break;
    const m = TC_LINE_RE.exec(lines[idx]);
    if (!m) continue;
    const inlineSpeaker = m[1] ? m[1].trim() : '';
    const tcIn = m[2];
    const tcOut = m[3] || '';
    let text = (m[4] || '').trim();

    let speaker = inlineSpeaker;
    if (!speaker && idx === 1) speaker = lines[0].replace(/:$/, '').trim();

    // Quote body = the rest of the code line, plus every following line (a multi-line soundbite).
    const tail = lines.slice(idx + 1).join(' ').trim();
    text = cleanQuote([text, tail].filter(Boolean).join(' '));
    // A stray "NAME:" that led the quote body instead of the code line.
    if (!speaker) {
      const sp = text.match(/^([A-Z][A-Za-z .'\-]{0,30}):\s+(\S.*)$/s);
      if (sp && isSpeakerLabel(sp[1])) { speaker = sp[1].trim(); text = sp[2].trim(); }
    }
    if (!text) return null;
    return { tcIn, tcOut, text, speaker: speaker || '' };
  }
  return null;
}

// ── DOC BUILDERS (pure — take a schema, return PM nodes) ───────────────────────────────────────────
export function mintQuoteBlockId() {
  return 'quote_' + Math.random().toString(36).slice(2, 9);
}

// The two paragraphs of a quote block: [timecode chips] then [ON CAM quote run].
export function buildQuoteParagraphs(schema, { tcIn, tcOut, text, speaker }) {
  const paraType = schema.nodes.paragraph;
  const tcMark = schema.marks.timecode;
  const dirMark = schema.marks.directionMark;
  const chip = (code) => schema.text(code, tcMark ? [tcMark.create({ tc: code, day: null, seq: null })] : []);

  const tcInline = [chip(tcIn)];
  if (tcOut) { tcInline.push(schema.text(' – ')); tcInline.push(chip(tcOut)); }
  const tcPara = paraType.create(null, tcInline);

  const quoteText = speaker ? `${speaker}: ${text}` : text;
  const oncam = dirMark ? [dirMark.create(defaultDirectionMarkAttrs('oncam'))] : [];
  const quotePara = paraType.create(null, [schema.text(quoteText, oncam)]);
  return [tcPara, quotePara];
}

// A neutral noneBlock carrying the quote paragraphs (chrome-less line — the meaning is in the marks).
function buildQuoteBlock(schema, id, parsed) {
  const noneType = schema.nodes.noneBlock;
  if (!noneType) return null;
  return noneType.create({ blockId: id, flavor: null, chapterId: null }, buildQuoteParagraphs(schema, parsed));
}

// The full-width row wrapping the quote block — exactly document-builder's fullWidthRow shape, with a
// user pairId (so the Palau empty-row culler keeps it) — matching the media-paste rows' grain.
export function buildQuoteRowNode(schema, id, parsed) {
  const rowType = schema.nodes.tableRow;
  const cellType = schema.nodes.tableCell;
  const block = buildQuoteBlock(schema, id, parsed);
  if (!rowType || !cellType || !block) return null;
  return rowType.create({ cols: 1, pairId: mintUserPairId() }, cellType.create({ role: 'full' }, block));
}

// The "reading transcript…" placeholder row — a noneBlock with a single labelled paragraph. It IS a
// real doc node (attr-driven, WP-13, mirrors media-paste's uploading row) so it survives reload and a
// collaborator watches it appear then resolve; the block is found by its stable blockId at swap time.
const READING_LABEL = 'READING TRANSCRIPT…';
export function buildReadingRowNode(schema, id) {
  const rowType = schema.nodes.tableRow;
  const cellType = schema.nodes.tableCell;
  const noneType = schema.nodes.noneBlock;
  const paraType = schema.nodes.paragraph;
  if (!rowType || !cellType || !noneType || !paraType) return null;
  const block = noneType.create(
    { blockId: id, flavor: null, chapterId: null },
    paraType.create(null, [schema.text(READING_LABEL)]),
  );
  return rowType.create({ cols: 1, pairId: mintUserPairId() }, cellType.create({ role: 'full' }, block));
}

// ── POSITION HELPERS ──────────────────────────────────────────────────────────────────────────────
// The doc position AFTER the outermost tableRow that owns `pos` — where a new sibling row is inserted
// (mirrors doInsertStructureBlock / insertPlaceholderRows). Returns null on a bare (pre-table) doc so
// the caller can fall back to a top-level insert.
function afterOutermostRow(state, pos) {
  const $pos = state.doc.resolve(Math.max(0, Math.min(pos, state.doc.content.size)));
  for (let d = 1; d <= $pos.depth; d++) {
    if ($pos.node(d).type.name === 'tableRow') return $pos.after(d);
  }
  return null;
}

// Find the outermost row [from,to) that contains a block carrying `blockId` (null = gone → abort a
// swap, never clamp). Identity-based so a swap survives concurrent edits that shifted the row.
export function findQuoteRow(state, blockId) {
  let hit = null;
  state.doc.descendants((node, pos) => {
    if (hit) return false;
    if (node.attrs && node.attrs.blockId === blockId &&
        (node.type.name === 'noneBlock' || node.type.name === 'sotBlock' || node.type.name === 'oncamBlock')) {
      const $p = state.doc.resolve(pos);
      for (let d = $p.depth; d >= 1; d--) {
        if ($p.node(d).type.name === 'tableRow') { hit = { from: $p.before(d), to: $p.after(d) }; break; }
      }
      return false;
    }
    return undefined;
  });
  return hit;
}

// ── INSERT / SWAP (return a tr or dispatch) ─────────────────────────────────────────────────────────
// ONE transaction that inserts `rowNode` as a new sibling below the row owning `atPos` (or, on a bare
// doc, at the top level). Returns the tr, or null if the schema can't build the row.
function insertRowTr(state, atPos, rowNode) {
  if (!rowNode) return null;
  const after = afterOutermostRow(state, atPos);
  const tr = state.tr;
  if (after != null) {
    tr.insert(after, rowNode);
  } else {
    // Bare pre-table doc — drop the block at the top level; ensureTableDoc wraps it into a row on the
    // next load exactly like any other bare block. Unwrap the cell's block out of the row shell.
    const $pos = state.doc.resolve(Math.max(0, Math.min(atPos, state.doc.content.size)));
    const block = rowNode.child(0).child(0);
    const at = $pos.depth > 0 ? $pos.after(1) : Math.min($pos.pos, state.doc.content.size);
    tr.insert(at, block);
  }
  return tr.scrollIntoView();
}

// Insert a finished quote row below the caret (text road) or a drop position. Returns the minted id.
export function insertQuoteRow(view, parsed, atPos) {
  const id = mintQuoteBlockId();
  const row = buildQuoteRowNode(view.state.schema, id, parsed);
  const tr = insertRowTr(view.state, atPos, row);
  if (!tr) return null;
  view.dispatch(tr);
  return id;
}

// Insert the "reading transcript…" placeholder row (image road). Returns the id, or null on failure.
function insertReadingRow(view, atPos) {
  const id = mintQuoteBlockId();
  const row = buildReadingRowNode(view.state.schema, id);
  const tr = insertRowTr(view.state, atPos, row);
  if (!tr) return null;
  view.dispatch(tr);
  return id;
}

// Swap the placeholder row (found by blockId) → the real quote row, in ONE transaction. false = the
// placeholder was removed meanwhile (undo / collaborator) → the caller aborts, never clamps.
function swapReadingToQuote(view, id, parsed) {
  const range = findQuoteRow(view.state, id);
  if (!range) return false;
  const row = buildQuoteRowNode(view.state.schema, id, parsed);
  if (!row) return false;
  view.dispatch(view.state.tr.replaceWith(range.from, range.to, row).scrollIntoView());
  return true;
}

// Delete the placeholder row (image road revert-to-media). No-op if already gone.
function removeReadingRow(view, id) {
  const range = findQuoteRow(view.state, id);
  if (!range) return;
  view.dispatch(view.state.tr.delete(range.from, range.to));
}

function toast(msg, tone = 'error') {
  try { window.dispatchEvent(new CustomEvent('wp-toast', { detail: { tone, msg } })); } catch {}
}

// FileReader → bare base64 (strip the data:*;base64, prefix — the endpoint wants raw).
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      const at = s.indexOf('base64,');
      resolve(at >= 0 ? s.slice(at + 7) : s);
    };
    r.onerror = () => reject(r.error || new Error('read failed'));
    r.readAsDataURL(file);
  });
}

// ── IMAGE ROAD ─────────────────────────────────────────────────────────────────────────────────────
// Place a "reading transcript…" row, call the vision endpoint, then SWAP to the real quote row — or,
// on any failure, revert to MEDIA (onFallback re-runs the normal image insert for the same file), so
// a dropped image is never lost. atPos is the drop position (drop) or caret (paste).
export async function startImageQuote(view, file, atPos, onFallback) {
  if (isReadOnly() || !view.editable) return;
  const id = insertReadingRow(view, atPos);
  if (!id) { onFallback?.(); return; }

  let quote = null;
  let detail = '';
  try {
    const dataBase64 = await fileToBase64(file);
    // The scripts-library gate's fetch interceptor injects the signed-in JWT on same-origin /api/*
    // calls, so this request is authed for free in editable sessions (same as script-image-upload).
    const res = await fetch('/api/script-quote-extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: getEpisode().id, dataBase64, mimeType: file.type }),
    });
    const out = await res.json().catch(() => null);
    if (res.ok && out && out.ok && out.quote) quote = out.quote;
    else detail = (out && out.error) || `http ${res.status}`;
  } catch (e) {
    detail = e?.message || 'network error';
  }
  if (view.isDestroyed) return;

  if (!quote) {
    // REVERT TO MEDIA — never a vanished drop. Pull the placeholder, add the image the normal way.
    removeReadingRow(view, id);
    toast(`couldn't read a transcript there (${detail || 'unknown'}) — added the image as media instead`, 'info');
    onFallback?.();
    return;
  }
  if (!swapReadingToQuote(view, id, quote)) {
    toast('that spot was edited away while the transcript was read — drop it again');
  }
}

// ── DISAMBIGUATION CHOICE (MEDIA / QUOTE) ───────────────────────────────────────────────────────────
// A small flat inline menu at the drop point. Default is ALWAYS media — Enter / Esc / click-away all
// choose MEDIA so a drop is never lost; only an explicit QUOTE (click or the Q key) takes the quote
// road. House style: flat, 1.5px ink border, mono caps, no shadow (reuses .wp-slash-menu chrome).
let openChoiceEl = null;
let openChoiceCleanup = null;
export function isChoiceOpen() { return !!openChoiceEl; }
function closeChoice() {
  if (openChoiceCleanup) { openChoiceCleanup(); openChoiceCleanup = null; }
  if (openChoiceEl && openChoiceEl.parentNode) openChoiceEl.remove();
  openChoiceEl = null;
}

// Exposed as the pure decision so the default-to-MEDIA contract is headless-testable: given a key (or
// a sentinel for click-away/blur), which road runs? 'quote' ONLY for Q; everything else → 'media'.
export function choiceForKey(key) {
  const k = String(key || '').toLowerCase();
  return k === 'q' ? 'quote' : 'media';
}

// Show the choice. onMedia / onQuote are the two roads (supplied by the image handler so this module
// never reaches back into the media path). Returns true when the menu was shown (feature on, writable),
// false when the caller should just run media itself. `coords` = { x, y } viewport point.
export function offerMediaOrQuote(view, { coords, onMedia, onQuote }) {
  if (isReadOnly() || !view.editable) return false;
  closeChoice();

  let decided = false;
  const decide = (road) => {
    if (decided) return;
    decided = true;
    closeChoice();
    try { view.focus(); } catch {}
    if (road === 'quote') onQuote?.(); else onMedia?.();
  };

  const menu = document.createElement('div');
  menu.className = 'wp-slash-menu wp-transcript-choice';
  menu.setAttribute('contenteditable', 'false');
  menu.setAttribute('role', 'menu');

  const head = document.createElement('div');
  head.className = 'wp-bm-head';
  head.textContent = 'DROPPED IMAGE';
  menu.appendChild(head);

  const mkBtn = (label, hint, road) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wp-slash-item wp-transcript-choice-item';
    b.setAttribute('role', 'menuitem');
    const l = document.createElement('span'); l.className = 'wp-tc-choice-label'; l.textContent = label;
    const h = document.createElement('span'); h.className = 'wp-tc-choice-hint'; h.textContent = hint;
    b.appendChild(l); b.appendChild(h);
    b.addEventListener('mousedown', (e) => { e.preventDefault(); decide(road); });
    menu.appendChild(b);
    return b;
  };
  mkBtn('MEDIA', '↵', 'media');
  mkBtn('QUOTE', 'Q', 'quote');

  document.body.appendChild(menu);
  menu.style.position = 'fixed';
  const x = coords?.x ?? window.innerWidth / 2;
  const y = coords?.y ?? window.innerHeight / 2;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth - 8) menu.style.left = `${Math.max(8, window.innerWidth - r.width - 8)}px`;
  if (r.bottom > window.innerHeight - 8) menu.style.top = `${Math.max(8, window.innerHeight - r.height - 8)}px`;

  const onKey = (e) => {
    if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); decide('media'); return; }
    if (String(e.key).toLowerCase() === 'q') { e.preventDefault(); decide('quote'); }
  };
  const onDown = (e) => { if (openChoiceEl && !openChoiceEl.contains(e.target)) decide('media'); };
  document.addEventListener('keydown', onKey, true);
  // Defer the click-away a tick so the opening drop's own mouseup doesn't instantly dismiss it.
  const t = setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);

  openChoiceEl = menu;
  openChoiceCleanup = () => {
    clearTimeout(t);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onDown, true);
  };
  return true;
}
