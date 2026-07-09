// prune-ledger.test.mjs — locks the untested-cores ledger prune surgery.
//
// The prune must (1) drop EXACTLY the stale entry's line, (2) preserve the file's
// compact one-line-per-entry formatting byte-for-byte on every kept line, and
// (3) REFUSE (ok:false, no mutation) rather than corrupt a ledger it can't cleanly
// edit. Each assertion below goes RED under a plausible weakening of the helper.

import { pruneLedgerText, lineKey } from './prune-ledger.mjs';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); } };

// A realistic ledger fragment in the file's exact convention: one entry per line.
const LEDGER = [
  '{',
  '  "_README": "triage ledger",',
  '  "entries": {',
  '    "a/keep.js": { "status": "GLUE", "note": "one", "triaged": "x" },',
  '    "b/stale.js": { "status": "DELEGATED", "note": "gained a test", "triaged": "y" },',
  '    "c/keep.js": { "status": "STUB", "note": "two", "triaged": "z" }',
  '  }',
  '}',
].join('\n');

// ---- happy path: drop exactly the one stale entry ----
{
  const { next, pruned, ok: good } = pruneLedgerText(LEDGER, ['b/stale.js']);
  ok('reports ok', good === true);
  ok('pruned exactly the stale key', pruned.length === 1 && pruned[0] === 'b/stale.js');
  ok('stale line is gone', !next.includes('b/stale.js'));
  ok('kept entries survive', next.includes('a/keep.js') && next.includes('c/keep.js'));
  ok('_README survives', next.includes('"_README"'));
  ok('result is valid JSON', (() => { try { JSON.parse(next); return true; } catch { return false; } })());
  // Minimal-diff proof: every kept line is byte-identical; exactly one line removed.
  const removed = LEDGER.split('\n').filter((l) => !next.split('\n').includes(l));
  ok('exactly one physical line removed', removed.length === 1 && removed[0].includes('b/stale.js'));
  // Trailing comma discipline: dropping the LAST entry would strip a needed comma;
  // here b is a middle entry so c must still parse (covered by valid-JSON above).
}

// ---- multiple stale keys at once ----
{
  const { pruned, ok: good, next } = pruneLedgerText(LEDGER, ['a/keep.js', 'c/keep.js']);
  // removing a (first) and c (last) leaves b with a dangling comma? b had a comma,
  // a had a comma, c had none. After removing a and c: b's line keeps its comma ->
  // invalid JSON -> helper must REFUSE. This is the load-bearing safety case.
  ok('refuses when removal would leave a dangling comma (invalid JSON)', good === false);
  ok('refusal does not mutate the text', next === LEDGER);
  ok('refusal still reports which lines it matched', pruned.length === 2);
}

// ---- no-op: stale key not present ----
{
  const { next, pruned, ok: good } = pruneLedgerText(LEDGER, ['z/missing.js']);
  ok('missing key => nothing pruned', pruned.length === 0);
  ok('missing key => not ok (count mismatch)', good === false);
  ok('missing key => text unchanged', next === LEDGER);
}

// ---- lineKey only matches a top-level "key": , never a value or brace ----
{
  ok('lineKey reads the entry key', lineKey('    "b/stale.js": { "status": "X" }') === 'b/stale.js');
  ok('lineKey ignores a bare brace line', lineKey('  }') === null);
  ok('lineKey ignores a blank line', lineKey('') === null);
  // MUTATION GUARD: the key regex must be ANCHORED at line start (only indent
  // before the quote). A `"key":` embedded after other text is NOT an entry line
  // and must yield null — else an un-anchored regex could match a value fragment
  // and prune the wrong line.
  ok('lineKey requires the key at line start (anchored)', lineKey('xyz "bar": 1') === null);
  ok('lineKey reads the first top-level key when anchored',
     lineKey('    "x": { "note": "the b/stale.js reference" }') === 'x');
}

// ---- last-entry removal that orphans a trailing comma is REFUSED (safety) ----
{
  // Line-surgery can't retroactively strip the previous entry's trailing comma,
  // so removing the LAST entry would leave `..},\n}` — invalid JSON. The helper
  // must refuse (ok:false, no mutation) and let the census say "prune by hand".
  const twoLast = [
    '{',
    '  "entries": {',
    '    "keep.js": { "status": "GLUE" },',
    '    "stale.js": { "status": "DELEGATED" }',
    '  }',
    '}',
  ].join('\n');
  const { ok: good, next } = pruneLedgerText(twoLast, ['stale.js']);
  ok('orphaned-comma last-entry removal is refused', good === false);
  ok('refusal leaves the ledger byte-identical', next === twoLast);
}

// ---- lone-entry removal is clean (no sibling comma to orphan) ----
{
  const oneOnly = [
    '{',
    '  "entries": {',
    '    "stale.js": { "status": "DELEGATED" }',
    '  }',
    '}',
  ].join('\n');
  const { ok: good, next } = pruneLedgerText(oneOnly, ['stale.js']);
  ok('lone stale entry prunes cleanly', good === true && !next.includes('stale.js'));
  ok('lone-entry prune leaves valid JSON', (() => { try { JSON.parse(next); return true; } catch { return false; } })());
}

console.log(`prune-ledger: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
