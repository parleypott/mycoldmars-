// Locks the Sacred Selects sequence-gap parser against the truthy-zero trap.
//
// Bug: both export builders (the Premiere .jsx payload and buildSacredSequencerXML)
// read the gap as `parseInt($('#seq-gap').value) || 12`. The #seq-gap input is
// `type="number" min="0" max="240"`, so a gap of 0 (soundbites butted directly
// together — a real tight-assembly choice) is valid and reachable, but `0 || 12`
// forced the 12-frame default. A producer requesting zero gap silently got 12.
//
// The fix preserves a real 0 and only falls back to 12 when the field is
// empty/unparseable (NaN). Every other value is byte-identical to the old form,
// so the ONLY behavior change is the 0 case the bug ate.
//
// Run: bun translation/src/seq-gap.test.mjs  (auto-discovered by `bun run test`)
import { parseGapFrames } from './seq-gap.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};

// ── Inline RED proof: the OLD `parseInt(value) || 12` form eats a real 0 ──
const oldParse = (v) => parseInt(v, 10) || 12;
eq(oldParse('0'), 12, 'RED-proof: old form turns a 0-gap request into the 12 default');
// …while the fixed parser preserves it:
eq(parseGapFrames('0'), 0, 'THE FIX: gap "0" → 0 frames, not 12');
eq(parseGapFrames(0), 0, 'THE FIX: numeric 0 → 0 frames, not 12');

// ── Real fallback cases: an empty / unparseable field uses the 12 default ──
eq(parseGapFrames(''), 12, 'empty string → 12 (matches the input value="12")');
eq(parseGapFrames('   '), 12, 'whitespace → 12');
eq(parseGapFrames(null), 12, 'null → 12');
eq(parseGapFrames(undefined), 12, 'undefined → 12');
eq(parseGapFrames('abc'), 12, 'non-numeric → 12');
eq(parseGapFrames(NaN), 12, 'NaN → 12');
eq(parseGapFrames('0', 30), 0, 'custom fallback still preserves 0');
eq(parseGapFrames('', 30), 30, 'custom fallback used when empty');

// ── Normal values pass through unchanged ──
eq(parseGapFrames('12'), 12, 'default 12 passes through');
eq(parseGapFrames('24'), 24, 'one second @ 24fps');
eq(parseGapFrames('240'), 240, 'the input max');
eq(parseGapFrames('1'), 1, 'one frame');
eq(parseGapFrames('12.7'), 12, 'parseInt truncates a decimal (frames are integers)');
eq(parseGapFrames('30px'), 30, 'parseInt stops at non-digit');

// ── No-regression battery: parseGapFrames === the old form for EVERYTHING but 0 ──
// (proves the fix is surgical — only the 0 case changed, including the pre-existing
//  negative passthrough that the truthy `||` left alone)
for (const v of ['1', '5', '11', '12', '13', '24', '60', '120', '239', '240', '-5', '-1', '7.9', '', '  ', 'x', 'abc']) {
  const oldVal = parseInt(v, 10) || 12;
  const newVal = parseGapFrames(v);
  if (parseInt(v, 10) === 0) continue; // the one intentional divergence
  eq(newVal, oldVal, `no-regression: "${v}" identical to old form`);
}
// And the divergence is exactly and only the 0 case:
eq(parseGapFrames('0') !== (parseInt('0', 10) || 12), true, 'the ONLY divergence from old form is the 0 case');

// ── Pre-existing negative passthrough preserved (min="0" prevents it via UI;
//    a manually-typed negative behaved as a passthrough before, still does) ──
eq(parseGapFrames('-5'), -5, 'negative preserved (byte-identical to old behavior)');

if (fail === 0) console.log(`seq-gap: ${pass} passed, 0 failed`);
else { console.error(`seq-gap: ${pass} passed, ${fail} failed`); process.exit(1); }
