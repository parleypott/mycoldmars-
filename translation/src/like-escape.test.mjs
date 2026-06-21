// Lock escapeLikePattern — the PostgreSQL LIKE/ILIKE search-pattern escaper used
// by db.js searchTranscripts (the Interpreter library search) and
// searchUserProfiles (the Share dialog collaborator picker).
//
// REAL BUG fixed: the two inline copies escaped only %  and _, NOT the backslash
// — which is PostgreSQL's DEFAULT LIKE escape character. A search query ending in
// a backslash (e.g. a pasted "C:\path\" fragment) produced `%foo\%`, where the
// trailing `\` escapes the CLOSING `%` wildcard and eats it -> the search returns
// wrong/empty results instead of a substring match. The fix escapes \  %  _ in a
// single character-class pass so the escape character itself is doubled.
//
// The load-bearing invariant: a query ending in N backslashes must yield 2N
// trailing backslashes in `escaped`, so the closing wildcard in `%${escaped}%`
// can never be consumed. (Even count of trailing backslashes = wildcard intact.)
//
// Run: bun translation/src/like-escape.test.mjs   (auto-discovered by `bun run test`)
import { escapeLikePattern } from './like-escape.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`); }
};
const ok = (cond, msg) => eq(!!cond, true, msg);

const BS = '\\'; // a single literal backslash

// Count the run of backslashes immediately before the closing `%` of the
// pattern `%${escaped}%`. Returns the ACTUAL backslash count (not display-escaped).
function trailingBackslashesBeforeCloser(escaped) {
  const pattern = '%' + escaped + '%';
  const m = pattern.match(/\\+%$/); // run of backslashes then the final %
  return m ? m[0].length - 1 : 0;   // minus the % itself
}

// ── inline RED proof: reconstruct the OLD %_-only escaper (the bug) ──
function oldEscape(q) {
  return (q || '').replace(/[%_]/g, ch => '\\' + ch);
}

// A query that is exactly one trailing backslash: "foo\"
const trailingBSQuery = 'foo' + BS;
// OLD: leaves the lone backslash -> pattern "%foo\%" -> ODD (1) trailing backslash
//      -> the closing % is escaped == eaten == BUG.
ok(trailingBackslashesBeforeCloser(oldEscape(trailingBSQuery)) % 2 === 1,
  'RED proof: OLD escaper leaves an ODD trailing-backslash count (closing % wildcard escaped == search broken)');
// NEW: doubles it -> pattern "%foo\\%" -> EVEN (2) trailing backslashes
//      -> literal backslash + intact closing % wildcard.
ok(trailingBackslashesBeforeCloser(escapeLikePattern(trailingBSQuery)) % 2 === 0,
  'fix: escapeLikePattern yields an EVEN trailing-backslash count (closing % wildcard intact)');
eq(escapeLikePattern(trailingBSQuery), 'foo' + BS + BS,
  'fix: single trailing backslash doubled');

// ── the three special chars each get exactly one backslash prepended ──
eq(escapeLikePattern(BS), BS + BS, 'backslash -> doubled (the escape char itself)');
eq(escapeLikePattern('%'), BS + '%', 'percent -> escaped');
eq(escapeLikePattern('_'), BS + '_', 'underscore -> escaped');
eq(escapeLikePattern('a' + BS + 'b'), 'a' + BS + BS + 'b', 'mid-string backslash doubled');
eq(escapeLikePattern('C:' + BS + 'Users' + BS + 'jh'), 'C:' + BS + BS + 'Users' + BS + BS + 'jh',
  'Windows path fragment: every backslash doubled');
eq(escapeLikePattern('50% off_now'), '50' + BS + '% off' + BS + '_now',
  'percent + underscore both escaped in one string');
eq(escapeLikePattern(BS + '%' + '_'), BS + BS + BS + '%' + BS + '_',
  'all three specials adjacent each escaped independently');

// ── invariant sweep: for every query ending in K backslashes, the escaped
//    trailing-backslash count is EVEN (closing wildcard can never be consumed) ──
for (let k = 0; k <= 5; k++) {
  const q = 'name' + BS.repeat(k);
  const n = trailingBackslashesBeforeCloser(escapeLikePattern(q));
  eq(n % 2, 0, `query ending in ${k} backslash(es) -> even trailing-backslash count (${n})`);
  // and the OLD escaper is wrong for any ODD k
  if (k % 2 === 1) {
    ok(trailingBackslashesBeforeCloser(oldEscape(q)) % 2 === 1,
      `RED: OLD escaper broken for ${k} trailing backslash(es)`);
  }
}

// ── NO-REGRESSION: any query WITHOUT a backslash is byte-identical to the old escaper ──
const noBackslash = [
  'plain search', '50% off', 'a_b_c', '100%_done', 'café résumé', '日本語', '',
  'multi word query', 'UPPER', 'name (final)', 'a/b:c;d', 'symbols!@#$^&*()', '   ',
  'email@example.com', 'Last, First', '12345', '%%%', '___', '%_%_',
];
for (const q of noBackslash) {
  eq(escapeLikePattern(q), oldEscape(q), `no-regression (no backslash): ${JSON.stringify(q)}`);
}

// ── null-safety (old inline used `(q||'')`; the helper coerces the same way) ──
eq(escapeLikePattern(null), '', 'null -> empty, no throw');
eq(escapeLikePattern(undefined), '', 'undefined -> empty, no throw');
eq(escapeLikePattern(''), '', 'empty -> empty');
eq(escapeLikePattern(12345), '12345', 'number coerced to string');
let threw = false;
try { escapeLikePattern(null); } catch { threw = true; }
ok(!threw, 'escapeLikePattern(null) does not throw');

console.log(`\nlike-escape.test: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
