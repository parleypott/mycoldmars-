// Burma Script Tool — PROGRESS COUNTS (pure, isomorphic, no Preact/JSX/DOM/PM runtime).
//
// Tallies the three SHARED, doc-resident progress trackers straight off a ProseMirror doc JSON,
// so the SAME function drives the live in-editor bars (pass editor.state.doc.toJSON()) AND a
// server-side Asana sync (pass the stored doc JSON). No editor instance needed.
//
// All three read state that lives IN THE DOCUMENT (collab-synced, team-wide) — not the
// per-person view check-off. That distinction is the whole point (see the design note below):
//   • FC (fact-check): contiguous `factCheckSpan` runs. DONE when status is 'checked' (the
//     receipt landed); 'pending'/'solid' are OPEN. run.status = first fragment (marks.js rule).
//   • TK: contiguous `tkSpan` runs (writing placeholders). No done-state — resolved by removal —
//     so this is an OPEN COUNT, not a fraction.
//   • ARCHIVE: `directionMark[kind='archive']` chips. DONE when status is 'found' (asset gathered);
//     'needed' is OPEN. Mirrors workspaces.js `archiveChipsInRow` — a new chip starts on a positional
//     gap OR a status change (unlike fc, adjacent-same-status merges, adjacent-different-status splits).
//
// Contiguity: non-text inline nodes (timecode chips, footnotes) are TRANSPARENT to a run — a claim
// split by a timecode is ONE claim; runs never span a block boundary.
//
// DESIGN NOTE — why NOT the localStorage check-off: extensions/ws-checkoff.js is a deliberately
// PERSONAL, per-browser aid ("never touches the master, invisible to everyone else — just in their
// view"). The team-wide production TRUTH lives in these marks' statuses instead (what workspaces.js
// already surfaces per craft). Asana wants the shared truth, so this module counts the marks, never
// the check-off. Two different questions: "is the asset actually found?" (shared) vs "have I walked
// this row in my pass?" (personal).

const FC_MARK = 'factCheckSpan';
const TK_MARK = 'tkSpan';
const DIR_MARK = 'directionMark';

function markOf(node, name) {
  const marks = node && node.marks;
  if (!Array.isArray(marks)) return null;
  return marks.find((m) => m && m.type === name) || null;
}
function archiveMarkOf(node) {
  const marks = node && node.marks;
  if (!Array.isArray(marks)) return null;
  return marks.find((m) => m && m.type === DIR_MARK && m.attrs && m.attrs.kind === 'archive') || null;
}

// Tally contiguous fc + tk + archive runs within ONE inline content array (runs never span blocks).
function tallyInline(inline, acc) {
  let fcOpen = null, tkOpen = false, arOpen = null;
  const closeFc = () => { if (fcOpen) { acc.fc.total += 1; if (fcOpen.status === 'checked') acc.fc.done += 1; fcOpen = null; } };
  const closeTk = () => { if (tkOpen) { acc.tk.open += 1; tkOpen = false; } };
  const closeAr = () => { if (arOpen) { acc.archive.total += 1; if (arOpen.status === 'found') acc.archive.done += 1; arOpen = null; } };

  for (const node of inline) {
    if (!node || node.type !== 'text') continue; // chips/footnotes transparent to runs
    // FC — keep the run's first status (marks.js: run.status is the first fragment's).
    const fc = markOf(node, FC_MARK);
    if (fc) { if (!fcOpen) fcOpen = { status: (fc.attrs && fc.attrs.status) === 'checked' ? 'checked' : (fc.attrs && fc.attrs.status) || 'pending' }; }
    else closeFc();
    // TK — presence only.
    if (markOf(node, TK_MARK)) tkOpen = true; else closeTk();
    // ARCHIVE — a status change splits the chip (workspaces.js archiveChipsInRow rule).
    const ar = archiveMarkOf(node);
    if (ar) {
      const st = (ar.attrs && ar.attrs.status) === 'found' ? 'found' : 'needed';
      if (!arOpen) arOpen = { status: st };
      else if (arOpen.status !== st) { closeAr(); arOpen = { status: st }; }
    } else closeAr();
  }
  closeFc(); closeTk(); closeAr();
}

function walk(node, acc) {
  if (!node || typeof node !== 'object') return;
  const content = node.content;
  if (!Array.isArray(content)) return;
  if (content.some((c) => c && c.type === 'text')) tallyInline(content, acc);
  for (const child of content) walk(child, acc); // doc → blocks → paragraphs → text
}

function frac(done, total) {
  return { done, total, open: total - done, pct: total === 0 ? 100 : Math.round((done / total) * 100) };
}

/**
 * Count FC + TK + archive progress over a ProseMirror doc JSON.
 * @returns {{ fc:{done,total,open,pct}, tk:{open}, archive:{done,total,open,pct} }}
 */
export function countProgress(docJSON) {
  const acc = { fc: { done: 0, total: 0 }, tk: { open: 0 }, archive: { done: 0, total: 0 } };
  walk(docJSON, acc);
  return { fc: frac(acc.fc.done, acc.fc.total), tk: { open: acc.tk.open }, archive: frac(acc.archive.done, acc.archive.total) };
}
