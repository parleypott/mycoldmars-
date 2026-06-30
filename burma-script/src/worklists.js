// Burma Script Tool — WORKLIST EXTRACTION (pure, no Preact/JSX).
//
// The producer-facing handoff logic, lifted out of Exports.jsx so it can be unit-tested
// headlessly (Exports.jsx is JSX and can't be imported by a plain node test). Exports.jsx
// imports these and only owns the render + download/print plumbing.
//
// One worklist is pulled from a live blocks array:
//   • TRANSLATION  — every SOT speaker quote (sound-on-tape to translate / subtitle)
// Each row is normalized to { id, primary, body, meta } so render + download share one shape.

import { cleanQuote, stripSpanScaffolding } from './document-builder.js';
import { getEpisode } from './episode-config.js';

// ---- worklist extraction -------------------------------------------------
// Pull the worklist out of a live blocks array. Each entry is normalized to
// { id, primary, body, meta } so the render + download paths share one shape.
export function buildWorklists(blocks, episode = getEpisode()) {
  const translation = [];
  const flavors = Array.isArray(episode?.flavors) ? episode.flavors.filter((f) => f?.id) : [];
  const byFlavor = {};
  for (const f of flavors) byFlavor[f.id] = [];

  // Track the chapter we're under so each worklist row says WHERE in the script it lives —
  // the producer needs the section, not just the line. (Chapter spine, like the outline.)
  let chapter = '';

  for (const b of blocks) {
    if (b.type === 'chapter') { chapter = (b.title || '').trim(); continue; }

    if (b.type === 'sot') {
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

    if (b.flavor && byFlavor[b.flavor]) {
      byFlavor[b.flavor].push({
        id: b.id,
        primary: b.timecode?.tc || b.title || '(line)',
        body: stripSpanScaffolding(cleanQuote(b.text || '')),
        meta: [b.speaker, chapter].filter(Boolean).join(' · '),
        done: !!b.done,
      });
    }
  }
  return { translation, ...byFlavor };
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

// Actionable rows = everything except faint empty placeholders. With only the TRANSLATION
// worklist left (SOT rows never carry an `empty` flag) this is effectively a passthrough, kept
// as a stable shape for the Exports counts + .txt handoff.
export const actionable = (rows) => rows.filter((r) => !r.empty);
