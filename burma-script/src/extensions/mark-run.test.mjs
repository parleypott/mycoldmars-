/**
 * Tests for contiguousMarkRun — the span-run resolver behind marks.js openWorkshop
 * (the {tk …} / {fc …} click → Workshop hub flow).
 *
 * THE BUG (real, in-range): a {tk …}/{fc …} ask that contains an embedded broadcast timecode
 * is SPLIT by ProseMirror into multiple adjacent text nodes — the timecode fragment carries
 * an extra `timecode` mark, so it's a separate text node — but every fragment still carries
 * the span mark:
 *   "{tk the exact time was 02:02:01:07 here}"
 *   -> ["tk the exact time was " | "02:02:01:07" | " here"]   (all three carry tkSpan)
 * openWorkshop's old loop kept ONLY the single fragment under the click (last-write-wins), so
 * clicking the part after the timecode captured just " here" — the Workshop got truncated text
 * and a too-narrow [from,to], and writing the model's completion back replaced only " here",
 * shattering the span. contiguousMarkRun expands across the WHOLE contiguous mark run so any
 * click inside the ask captures the entire ask.
 *
 * The precondition (a span fragmenting into >=2 mark-bearing text nodes) is proven against the
 * REAL shipped buildEditorDocument output, not a mock. The fix is mutation-proven: an inline
 * reconstruction of the OLD single-fragment logic is asserted to return only the clicked piece.
 *
 * Run: bun src/extensions/mark-run.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import { contiguousMarkRun } from './mark-run.js';
import { buildEditorDocument } from '../document-builder.js';

let pass = 0, fail = 0;
const eq = (got, want, label) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; }
  else { fail++; console.log(`FAIL ${label}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
};
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${label}`); } };

// ── Inline reconstruction of the OLD buggy single-fragment loop (for the RED proof) ──────────
// Mirrors the original openWorkshop body: walk fragments, keep the LAST mark-bearing fragment
// that contains pos. With a fragmented span only one fragment contains pos → just that piece.
function oldSingleFragment(frags, pos) {
  let from = pos, to = pos;
  for (const f of frags) {
    if (f.hasMark && f.from <= pos && pos <= f.to) { from = f.from; to = f.to; }
  }
  return { from, to };
}

// Concatenate the fragment texts wholly inside [from,to] — stands in for doc.textBetween,
// faithful because runs always align to whole fragments.
const runText = (frags, { from, to }) => frags.filter((f) => f.from >= from && f.to <= to).map((f) => f.text).join('');

// Turn a built doc's inline text nodes into the { from, to, hasMark, text } fragment shape
// openWorkshop builds from parent.forEach — PM-style contiguous offsets (next.from === prev.to).
function fragmentsFromDoc(doc, markName, base = 1) {
  const texts = [];
  (function walk(n) { if (n?.type === 'text') texts.push(n); (n?.content || []).forEach(walk); })(doc);
  let cur = base;
  return texts.map((t) => {
    const from = cur, to = cur + (t.text?.length || 0);
    cur = to;
    return { from, to, text: t.text || '', hasMark: (t.marks || []).some((m) => m.type === markName) };
  });
}

// ── PRECONDITION + THE FIX, against REAL buildEditorDocument output ──────────────────────────
{
  const doc = buildEditorDocument([
    { id: 'b1', type: 'vo', text: 'Open on the river. {tk the exact time was 02:02:01:07 here} keep going.' },
  ]);
  const frags = fragmentsFromDoc(doc, 'tkSpan');
  const marked = frags.filter((f) => f.hasMark);

  // Precondition: the {tk …} span really did fragment into >= 2 mark-bearing text nodes.
  ok(marked.length >= 2, `precondition: tk span fragments into >=2 marked nodes (got ${marked.length})`);
  // The whole ask, concatenated across fragments, is what the Workshop must receive.
  const wholeAsk = marked.map((f) => f.text).join('');
  const runFrom = marked[0].from, runTo = marked[marked.length - 1].to;

  // Click the LAST fragment (after the timecode) — the headline failure case.
  const last = marked[marked.length - 1];
  const posLast = last.from + 1;
  eq(contiguousMarkRun(frags, posLast), { from: runFrom, to: runTo }, 'click-after-timecode -> full run');
  eq(runText(frags, contiguousMarkRun(frags, posLast)), wholeAsk, 'click-after-timecode -> whole ask text');

  // RED proof: the OLD logic captured only the clicked trailing fragment.
  const old = oldSingleFragment(frags, posLast);
  ok(old.from === last.from && old.to === last.to, 'RED: old logic returns only the clicked fragment');
  ok(runText(frags, old) !== wholeAsk, 'RED: old logic text is truncated (not the whole ask)');
  ok(runText(frags, old) === last.text, 'RED: old logic text is exactly the trailing fragment');

  // Click the FIRST fragment and the TIMECODE-bearing middle fragment — both must give the full run.
  eq(contiguousMarkRun(frags, marked[0].from + 1), { from: runFrom, to: runTo }, 'click-first-fragment -> full run');
  const mid = marked.find((f) => f.text.includes('02:02:01:07'));
  ok(!!mid, 'middle (timecode) fragment exists and carries the span mark');
  eq(contiguousMarkRun(frags, mid.from + 1), { from: runFrom, to: runTo }, 'click-timecode-fragment -> full run');

  // Click the UNMARKED prose before the span → zero-width fallback (no span hit).
  const unmarked = frags.find((f) => !f.hasMark && f.text.includes('Open on the river'));
  const posU = unmarked.from + 1;
  eq(contiguousMarkRun(frags, posU), { from: posU, to: posU }, 'click-unmarked -> zero-width fallback');
}

// ── fc span fragmented the same way (factCheckSpan also routes through openWorkshop) ─────────
{
  const doc = buildEditorDocument([
    { id: 'b2', type: 'vo', text: 'Claim here {fc the figure at 01:02:03:04 is disputed} and more.' },
  ]);
  const frags = fragmentsFromDoc(doc, 'factCheckSpan');
  const marked = frags.filter((f) => f.hasMark);
  ok(marked.length >= 2, `fc span fragments into >=2 marked nodes (got ${marked.length})`);
  const last = marked[marked.length - 1];
  eq(contiguousMarkRun(frags, last.from + 1),
     { from: marked[0].from, to: last.to }, 'fc click-after-timecode -> full run');
}

// ── No-regression: an UNFRAGMENTED span (no embedded timecode) — new === old ─────────────────
{
  const frags = [
    { from: 1, to: 5, hasMark: false, text: 'pre ' },
    { from: 5, to: 20, hasMark: true, text: 'tk write this ' },
    { from: 20, to: 25, hasMark: false, text: 'tail' },
  ];
  const pos = 10;
  eq(contiguousMarkRun(frags, pos), { from: 5, to: 20 }, 'single marked fragment -> itself');
  eq(contiguousMarkRun(frags, pos), oldSingleFragment(frags, pos), 'single fragment: new === old (no regression)');
}

// ── Two SEPARATE marked runs in one block — clicking one returns only that run ───────────────
{
  const frags = [
    { from: 1, to: 6, hasMark: true, text: 'tk a ' },   // run 1
    { from: 6, to: 11, hasMark: false, text: 'gap  ' },  // break
    { from: 11, to: 16, hasMark: true, text: 'tk b ' },  // run 2
  ];
  eq(contiguousMarkRun(frags, 3), { from: 1, to: 6 }, 'click run-1 -> run-1 only');
  eq(contiguousMarkRun(frags, 13), { from: 11, to: 16 }, 'click run-2 -> run-2 only');
}

// ── Boundary positions ───────────────────────────────────────────────────────────────────────
{
  // Three contiguous marked fragments (a span split twice).
  const frags = [
    { from: 1, to: 4, hasMark: true, text: 'aa ' },
    { from: 4, to: 9, hasMark: true, text: '12:34' },
    { from: 9, to: 13, hasMark: true, text: ' bb' },
  ];
  eq(contiguousMarkRun(frags, 4), { from: 1, to: 13 }, 'boundary inside run -> full run');
  eq(contiguousMarkRun(frags, 1), { from: 1, to: 13 }, 'run start -> full run');
  eq(contiguousMarkRun(frags, 13), { from: 1, to: 13 }, 'run end -> full run');

  // Boundary between a marked run's end and an unmarked fragment's start → prefer the marked run.
  const frags2 = [
    { from: 1, to: 5, hasMark: true, text: 'tk x' },
    { from: 5, to: 9, hasMark: false, text: 'tail' },
  ];
  eq(contiguousMarkRun(frags2, 5), { from: 1, to: 5 }, 'marked/unmarked boundary -> marked run');
}

// ── Degenerate inputs → zero-width fallback, never throws ─────────────────────────────────────
{
  eq(contiguousMarkRun([], 7), { from: 7, to: 7 }, 'empty fragments -> zero-width');
  eq(contiguousMarkRun(null, 7), { from: 7, to: 7 }, 'null fragments -> zero-width');
  eq(contiguousMarkRun([{ from: 0, to: 3, hasMark: false, text: 'no' }], 1),
     { from: 1, to: 1 }, 'no marked fragment -> zero-width');
  eq(contiguousMarkRun([{ from: 10, to: 14, hasMark: true, text: 'tk' }], 2),
     { from: 2, to: 2 }, 'pos outside all fragments -> zero-width');
}

console.log(`\nmark-run: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
