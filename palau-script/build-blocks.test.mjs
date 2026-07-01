/**
 * Tests for the PURE TRANSFORMS of the Palau (WP-02) block builder — the brand-new
 * (commit 046ce07, "add Palau") one-shot parser that turns the structured Palau source
 * into palau-blocks.json, the committed, deployed data that drives the /palau-script/
 * editor. Run: bun palau-script/build-blocks.test.mjs
 *
 * Why this was at ACTIVE RISK with zero coverage: build-blocks.mjs shapes EVERY block of
 * Johnny's real WP-02 script — the said/shown A/V pairing, the sot speaker/timecode stamps,
 * the strikethrough "trim" markers, and the stable block ids. Johnny re-runs it whenever he
 * updates the Palau source, so a silent regression here corrupts real content. The whole
 * file also ran main() on import, so it could not be imported to test at all — this test
 * accompanies the fix that guards main() (import is now side-effect-free) and exports the
 * pure transforms.
 *
 * The buildTimecode assertions are anchored to a REAL shape pulled from the committed
 * palau-blocks.json (an ambiguous, day-null sot with an in/out pair), so the lock tracks
 * what is actually deployed, not a hypothetical.
 */
import {
  hash6,
  applyTrims,
  buildTimecode,
  leftBlockFromCell,
  rightBlockFromCell,
} from './build-blocks.mjs';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`); }
};
const deep = (got, want, msg) => eq(JSON.stringify(got), JSON.stringify(want), msg);
const ok = (cond, msg) => eq(!!cond, true, msg);

// ── hash6: deterministic 6-char base36 identity hash ──────────────────────────────────
eq(typeof hash6('anything'), 'string', 'hash6 returns a string');
eq(hash6('anything').length, 6, 'hash6 is exactly 6 chars');
eq(hash6('anything'), hash6('anything'), 'hash6 is deterministic (same input → same hash)');
ok(hash6('a') !== hash6('b'), 'hash6 distinguishes different inputs');
ok(/^[0-9a-z]{6}$/.test(hash6('a')), 'hash6 output is base36-safe, padded to 6');
// short/empty inputs must still pad to 6 (padStart) — an id builder that emitted <6 chars
// would produce ragged, collision-prone ids.
eq(hash6('').length, 6, 'hash6("") still 6 chars (padStart)');

// ── applyTrims: wraps the first occurrence of each trim in ~~…~~ (a strikethrough) ─────
eq(applyTrims('keep this out', ['this']), 'keep ~~this~~ out', 'wraps the trim in ~~…~~');
eq(applyTrims('a b c', ['b', 'c']), 'a ~~b~~ ~~c~~', 'wraps multiple distinct trims');
eq(applyTrims('the cat and the dog', ['the']), '~~the~~ cat and the dog',
   'wraps only the FIRST occurrence (indexOf)');
// already-wrapped guard: a trim whose ~~wrapped~~ form is already present is skipped, so we
// never double-wrap into ~~~~x~~~~. MUTATION CANARY: dropping the includes() guard reds this.
eq(applyTrims('~~x~~ y', ['x']), '~~x~~ y', 'skips a trim already wrapped (no double-wrap)');
// a trim not present in the text is a no-op, not a crash
eq(applyTrims('nothing here', ['absent']), 'nothing here', 'absent trim is a no-op');
// falsy / empty trims are skipped, not wrapped into ~~~~
eq(applyTrims('a b', ['', null, undefined]), 'a b', 'falsy trims skipped (no empty ~~~~)');
// null/undefined text and trims degrade to safe defaults
eq(applyTrims(null, ['x']), '', 'null text → "" (no crash)');
eq(applyTrims('a', null), 'a', 'null trims → text unchanged');
eq(applyTrims(undefined, undefined), '', 'both undefined → ""');

// ── buildTimecode: pick the in/out pair, stamp day + ambiguity, cap raw at 200 ─────────
// Real committed shape (from palau-blocks.json): an ambiguous, day-null sot with in+out.
const realTc = buildTimecode(
  'EXPERTS SAY\n\n● 20260311-James Porter - Interview: [00:03:29] this alga...',
  [{ kind: 'in', tc: '00:03:29', day: null }, { kind: 'out', tc: '00:03:36', day: null }],
);
eq(realTc.tc, '00:03:29', 'buildTimecode.tc = the in-kind timecode');
eq(realTc.tcOut, '00:03:36', 'buildTimecode.tcOut = the out-kind timecode');
eq(realTc.day, null, 'buildTimecode.day passes through firstIn.day (null here)');
eq(realTc.ambiguous, true, 'ambiguous = true when day is null (MUTATION: day==null gate)');

// a real day stamps through and clears the ambiguous flag
const dayTc = buildTimecode('x', [{ kind: 'in', tc: '01:00:00', day: 4 }]);
eq(dayTc.day, 4, 'day passes through');
eq(dayTc.ambiguous, false, 'ambiguous = false when a day is present');
eq('tcOut' in dayTc, false, 'no tcOut key when there is no out-kind entry');

// when there is no explicit in-kind entry, firstIn falls back to the first timecode
const fallbackTc = buildTimecode('x', [{ tc: '02:00:00', day: 2 }]);
eq(fallbackTc.tc, '02:00:00', 'firstIn falls back to timecodes[0] when no kind:"in"');
eq(fallbackTc.day, 2, 'fallback still reads the day off the first entry');

// empty / missing timecode list → blank tc, ambiguous
const emptyTc = buildTimecode('x', []);
eq(emptyTc.tc, '', 'no timecodes → tc = ""');
eq(emptyTc.ambiguous, true, 'no timecodes → ambiguous');

// raw is capped at 200 chars so a giant cell can't bloat the block payload
const bigTc = buildTimecode('Z'.repeat(500), [{ kind: 'in', tc: '00:00:01', day: 1 }]);
eq(bigTc.raw.length, 200, 'raw is truncated to 200 chars');

// ── leftBlockFromCell: role→type map, said-lane pairing, sot speaker/timecode ──────────
deep(
  leftBlockFromCell({ role: 'vo', text: 'hello' }, ''),
  { type: 'vo', text: 'hello', rawSource: 'hello' },
  'vo cell → plain vo block, no lane when unpaired',
);
eq(leftBlockFromCell({ role: 'text', text: 'x' }, '').type, 'vo', 'role "text" maps to vo');
eq(leftBlockFromCell({ role: 'weird', text: 'x' }, '').type, 'vo', 'unknown role defaults to vo');
eq(leftBlockFromCell({ role: 'oncam', text: 'x' }, '').type, 'oncam', 'role oncam preserved');

// paired left cell joins the said lane at half width
const pairedLeft = leftBlockFromCell({ role: 'vo', text: 'x' }, 'pair_palau_5');
eq(pairedLeft.lane, 'said', 'paired left → lane "said"');
eq(pairedLeft.pairId, 'pair_palau_5', 'paired left carries the pairId');
eq(pairedLeft.width, 'half', 'paired left → half width');

// keyLine flags the yellow flavor
eq(leftBlockFromCell({ role: 'vo', text: 'x', keyLine: true }, '').flavor, 'yellow',
   'keyLine → yellow flavor');

// a sot cell carries speaker, an unstarted done flag, and a built timecode
const sot = leftBlockFromCell(
  { role: 'sot', text: 'quote', speaker: 'James', timecodes: [{ kind: 'in', tc: '00:03:29', day: null }] },
  '',
);
eq(sot.type, 'sot', 'sot role → sot block');
eq(sot.speaker, 'James', 'sot carries the speaker');
eq(sot.done, false, 'sot starts not-done');
eq(sot.timecode.tc, '00:03:29', 'sot gets a built timecode');
// trims applied to sot text too
eq(leftBlockFromCell({ role: 'vo', text: 'cut me now', trims: ['cut me'] }, '').text,
   '~~cut me~~ now', 'applyTrims runs on the left cell text');

// ── rightBlockFromCell: always broll, shown-lane pairing, flavor precedence ────────────
deep(
  rightBlockFromCell({ text: 'b-roll of reef' }, ''),
  { type: 'broll', text: 'b-roll of reef', rawSource: 'b-roll of reef' },
  'right cell → broll block',
);
const pairedRight = rightBlockFromCell({ text: 'x' }, 'pair_palau_5');
eq(pairedRight.lane, 'shown', 'paired right → lane "shown"');
eq(pairedRight.width, 'half', 'paired right → half width');

// flavor map: liked→gold, animation→purple, straggler→pink
eq(rightBlockFromCell({ text: 'x', flavor: 'liked' }, '').flavor, 'gold', 'flavor liked → gold');
eq(rightBlockFromCell({ text: 'x', flavor: 'animation' }, '').flavor, 'purple', 'flavor animation → purple');
eq(rightBlockFromCell({ text: 'x', flavor: 'straggler' }, '').flavor, 'pink', 'flavor straggler → pink');
eq('flavor' in rightBlockFromCell({ text: 'x', flavor: 'nope' }, ''), false,
   'unknown flavor → no flavor key');
// keyLine yellow WINS over the flavor map. MUTATION CANARY: if the else-branch ran anyway,
// a liked+keyLine cell would come back "gold" instead of "yellow".
eq(rightBlockFromCell({ text: 'x', keyLine: true, flavor: 'liked' }, '').flavor, 'yellow',
   'keyLine yellow overrides the flavor map');
// timecode only when the cell actually carries timecodes
eq('timecode' in rightBlockFromCell({ text: 'x' }, ''), false, 'no timecodes → no timecode key');
eq(rightBlockFromCell({ text: 'x', timecodes: [{ kind: 'in', tc: '00:09:19', day: 2 }] }, '').timecode.tc,
   '00:09:19', 'right cell with timecodes → built timecode');

console.log(`build-blocks: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
