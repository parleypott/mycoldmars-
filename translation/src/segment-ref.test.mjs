// Tests for translation/src/segment-ref.js — the ONE shared recognizer for the
// model's segment-reference syntax used by both the summary enricher and the
// bullet→segment linker. Imports the REAL shipped helpers (no mirror, can't drift).
//
// Headline: the model writes prose ranges with an em-dash ("(Segments 3—7)") or the
// word "to" ("(Segments 3 to 7)"). The four old copies of the regex only accepted a
// hyphen / en-dash, so those ranges leaked through RAW — the enricher left the
// "(Segments 3—7)" text in Johnny's summary and the bullet mis-linked. This module
// widens the separator set; the test proves the old narrow pattern goes RED on the
// new separators while every previously-working form is byte-identical.

import { matchSegmentRef, enrichSegmentRefs, segmentRefRegex } from './segment-ref.js';

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; fails.push(`FAIL: ${msg}\n   expected ${e}\n   got      ${a}`); }
}
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; fails.push(`FAIL: ${msg}`); }
}

// ---- the OLD narrow pattern (pre-consolidation), reconstructed for RED proof ----
const OLD = /(?:\(Segments?\s+(\d+)(?:\s*[-–]\s*(\d+))?\)|\[(\d+)(?:\s*[-–]\s*(\d+))?\])/i;
const oldMatch = (s) => {
  const m = s.match(OLD);
  if (!m) return null;
  return { start: parseInt(m[1] || m[3]), end: parseInt(m[2] || m[4] || m[1] || m[3]) };
};

// ── 1. matchSegmentRef: every separator the model actually emits resolves ──
eq(matchSegmentRef('(Segments 3-7)'), { start: 3, end: 7 }, 'ascii hyphen range');
eq(matchSegmentRef('(Segments 3–7)'), { start: 3, end: 7 }, 'en-dash range');
eq(matchSegmentRef('(Segments 3—7)'), { start: 3, end: 7 }, 'EM-DASH range (was leaking)');
eq(matchSegmentRef('(Segments 3 to 7)'), { start: 3, end: 7 }, '"to" range (was leaking)');
eq(matchSegmentRef('(Segments 3 through 7)'), { start: 3, end: 7 }, '"through" range (was leaking)');
eq(matchSegmentRef('(Segment 3)'), { start: 3, end: 3 }, 'singular collapses end→start');
eq(matchSegmentRef('[3-7]'), { start: 3, end: 7 }, 'bracket hyphen range');
eq(matchSegmentRef('[3—7]'), { start: 3, end: 7 }, 'bracket EM-DASH range (was leaking)');
eq(matchSegmentRef('[14]'), { start: 14, end: 14 }, 'bracket single');
eq(matchSegmentRef('a note about (Segments 12-15) here'), { start: 12, end: 15 }, 'ref embedded mid-text');
eq(matchSegmentRef('nothing here'), null, 'no ref → null');
eq(matchSegmentRef(''), null, 'empty → null');
eq(matchSegmentRef(null), null, 'null-safe');

// ── 2. RED PROOF: the old pattern FAILS exactly on the widened separators ──
ok(oldMatch('(Segments 3—7)') === null, 'OLD regex misses em-dash (proves the leak)');
ok(oldMatch('(Segments 3 to 7)') === null, 'OLD regex misses "to" (proves the leak)');
ok(oldMatch('[3—7]') === null, 'OLD regex misses bracket em-dash');
// ...while the NEW recognizer catches all three
ok(matchSegmentRef('(Segments 3—7)') !== null, 'NEW recognizer catches em-dash');
ok(matchSegmentRef('(Segments 3 to 7)') !== null, 'NEW recognizer catches "to"');
ok(matchSegmentRef('[3—7]') !== null, 'NEW recognizer catches bracket em-dash');

// ── 3. NO REGRESSION: every form the OLD pattern handled is byte-identical ──
for (const s of ['(Segments 3-7)', '(Segments 3–7)', '(Segment 3)', '[3-7]', '[14]',
                 'lead (Segments 1-2) tail', 'no ref']) {
  eq(matchSegmentRef(s), oldMatch(s), `parity with old on ${JSON.stringify(s)}`);
}

// ── 4. enrichSegmentRefs: replaces refs with timecodes, preserves delimiter style ──
const tc = (n) => ({ 3: '0:45', 7: '2:10', 14: '5:00' })[n] || null;
eq(enrichSegmentRefs('see (Segments 3-7)', tc), 'see (0:45 – 2:10)', 'paren range → tc range');
eq(enrichSegmentRefs('see (Segments 3—7)', tc), 'see (0:45 – 2:10)', 'EM-DASH range now enriches (was raw)');
eq(enrichSegmentRefs('see (Segments 3 to 7)', tc), 'see (0:45 – 2:10)', '"to" range now enriches (was raw)');
eq(enrichSegmentRefs('see (Segment 3)', tc), 'see (0:45)', 'singular → single tc');
eq(enrichSegmentRefs('see [3-7]', tc), 'see [0:45 – 2:10]', 'bracket stays bracket');
eq(enrichSegmentRefs('see [14]', tc), 'see [5:00]', 'bracket single');
// unknown segment → ref left untouched (better raw than wrong)
eq(enrichSegmentRefs('see (Segments 9)', tc), 'see (Segments 9)', 'unknown seg left raw');
eq(enrichSegmentRefs('see (Segments 3-9)', tc), 'see (0:45)', 'unknown END collapses to start tc');
// multiple refs in one string
eq(enrichSegmentRefs('(Segment 3) then (Segments 3 to 7)', tc),
   '(0:45) then (0:45 – 2:10)', 'multiple refs, mixed separators');
eq(enrichSegmentRefs('', tc), '', 'empty passthrough');
eq(enrichSegmentRefs(null, tc), null, 'null passthrough');

// ── 5. fresh regex each call (no shared lastIndex desync) ──
ok(segmentRefRegex('gi') !== segmentRefRegex('gi'), 'segmentRefRegex returns a fresh object');

if (fail) { console.error(fails.join('\n')); console.error(`\n${pass} passed, ${fail} FAILED`); process.exit(1); }
console.log(`segment-ref: ${pass} passed`);
