// Burma Script Tool — WORKLIST EXTRACTION (pure, no Preact/JSX).
//
// The producer-facing handoff logic, lifted out of Exports.jsx so it can be unit-tested
// headlessly (Exports.jsx is JSX and can't be imported by a plain node test). Exports.jsx
// imports these and only owns the render + download/print plumbing.
//
// Three worklists are pulled from a live blocks array:
//   • MAP NEEDS    — every map-need block (mapping data the graphics team must source)
//   • ARCHIVE      — every archive-req block (archival footage/stills to license)
//   • TRANSLATION  — every SOT speaker quote (sound-on-tape to translate / subtitle)
// Each row is normalized to { id, primary, body, meta } so render + download share one shape.

import { cleanQuote, stripSpanScaffolding } from './document-builder.js';

// ---- worklist extraction -------------------------------------------------
// Pull the three worklists out of a live blocks array. Each entry is normalized to
// { id, primary, body, meta } so the render + download paths share one shape.
export function buildWorklists(blocks) {
  const maps = [];
  const archive = [];
  const translation = [];

  // Track the chapter we're under so each worklist row says WHERE in the script it lives —
  // the producer needs the section, not just the line. (Chapter spine, like the outline.)
  let chapter = '';

  for (const b of blocks) {
    if (b.type === 'chapter') { chapter = (b.title || '').trim(); continue; }

    if (b.type === 'map-need') {
      const primary = b.title || 'Mapping data needs';
      const body = stripSpanScaffolding(cleanBody(b.text));
      // A generic-default row with no items isn't actionable work — it's a map-need block
      // the writer dropped in but never filled. Flag it `empty` so it renders as a quiet,
      // faint placeholder (still visible: the section HAS a map-need), drops out of the
      // actionable count, and never pollutes the producer's .txt handoff checklist.
      const empty = !body && primary === 'Mapping data needs';
      maps.push({ id: b.id, primary, body, meta: chapter, empty });
    } else if (b.type === 'archive-req') {
      archive.push({ id: b.id, primary: b.title || 'Archive request', body: stripSpanScaffolding(cleanBody(b.text)), meta: chapter });
    } else if (b.type === 'sot') {
      // SOT = sound-on-tape — the interview quotes that get translated / subtitled. The
      // timecode is the hero datum the editor matches against; speaker tells the translator
      // who's talking. Done-flagged quotes are kept but marked, so the translator can skip
      // what's already handled.
      const tc = b.timecode?.tc || '';
      // The quote body is what a translator actually subtitles — run it through the SAME
      // hygiene the editor uses (cleanQuote) so the worklist matches what's on screen:
      // no leading bullet dashes, no inline 'DAY 1 SOT:' / 'SCENE …' lead-ins, no echoed
      // timecode (the hero already carries it). Then unwrap span markup for the handoff view.
      translation.push({
        id: b.id,
        primary: tc || '——:——:——:——',
        body: stripSpanScaffolding(cleanQuote(b.text)),
        // surface a TBD anchor when the speaker is missing so the "who's talking" gap is
        // explicit rather than silently collapsing to chapter-only meta.
        meta: [b.speaker || '(speaker TBD)', chapter].filter(Boolean).join(' · '),
        done: !!b.done,
      });
    }
  }
  return { maps, archive, translation };
}

// The service/archive blocks still carry the bracketed "[Mapping data needs: …]" wrapper
// and the U+2043 hyphen-bullets from the parser. Strip the outer brackets, turn the bullet
// separators into clean line items, so the worklist reads as a tidy checklist.
export function cleanBody(text) {
  if (!text) return '';
  let t = String(text)
    .replace(/\\([\-\[\]\!\(\)\.\*_`#>~])/g, '$1')
    .replace(/^\s*\[\s*/, '')
    .replace(/\s*\]\s*$/, '')
    .replace(/⁠/g, '')
    .trim();
  // Peel a leading "Mapping data needs:" / "Archive request for this section:" label —
  // it's already the row's primary heading, no need to echo it in the body.
  t = t.replace(/^Mapping data needs?:?\s*/i, '')
       .replace(/^Archive request(?:\s+for this section)?:?\s*/i, '')
       .trim();
  // Split the hyphen-bullet list into discrete lines.
  const parts = t.split(/\s*[⁃•]\s*/).map((s) => s.trim()).filter(Boolean);
  // Multi-item → a clean bulleted checklist. SINGLE item → the bare item, NOT the raw `t`:
  // returning `t` leaks the parser's `⁃` (U+2043) bullet into the producer handoff for any
  // one-item section (e.g. a section needing just one archival clip), so single-item rows
  // read "⁃ 1962 coup footage" while multi-item rows read "• …" — inconsistent raw markup in
  // a producer-facing document. parts[0] is the de-bulleted item (or the plain-prose body,
  // which split leaves whole). '' when the body was only bullets/whitespace.
  if (parts.length > 1) return parts.map((p) => '• ' + p).join('\n');
  return parts[0] || '';
}

// ---- plain-text download -------------------------------------------------
export function toPlainText(title, docTitle, rows, opts = {}) {
  const lines = [];
  lines.push(docTitle);
  lines.push(title.toUpperCase());
  lines.push('Generated ' + new Date().toISOString().slice(0, 10) + ' · ' + rows.length + ' items');
  lines.push('='.repeat(60));
  lines.push('');
  rows.forEach((r, i) => {
    const num = String(i + 1).padStart(2, '0');
    const flag = opts.done && r.done ? '  [DONE]' : '';
    lines.push(`${num}.  ${r.primary}${flag}`);
    if (r.meta) lines.push('     ' + r.meta);
    if (r.body) r.body.split('\n').forEach((bl) => lines.push('     ' + bl));
    lines.push('');
  });
  return lines.join('\n');
}

// Actionable rows = everything except faint empty placeholders. Drives the counts and the
// .txt handoff so a producer's checklist reflects real work, not unfilled map-need stubs.
export const actionable = (rows) => rows.filter((r) => !r.empty);
