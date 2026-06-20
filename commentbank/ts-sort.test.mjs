// ts-sort.test.mjs
//
// The Commentbank (commentbank/index.html, live + in vite.config.js) sorts the corpus by Slack
// timestamp in THREE places: the `chrono` base ordering on load, and the "newest"/"oldest" sort in
// filtered(). All three subtract one timestamp from another in a comparator. They USED to read the
// timestamp with a bare parseFloat(c.slack_ts) — and parseFloat of a missing / non-numeric slack_ts
// is NaN. A single NaN inside a subtraction comparator POISONS V8's sort: the partitioning breaks and
// the ENTIRE displayed order scrambles, not just the bad row (same NaN-sort-poison class as the Hunter
// semantic-search fix 2dfe675). Live data is clean today (all 602 rows carry a numeric slack_ts), so it
// was latent — but a single dropped slack_ts from a future comment-bank sync would silently scramble
// Johnny's whole comment view.
//
// The fix routes all three comparators through a NaN-safe key: tsNum(c) = a finite number or 0. This
// test EXTRACTS the real shipped tsNum from index.html at runtime (no hand-copied mirror, can't drift),
// locks it, proves the poison is gone end-to-end, and binds the three sort sites to tsNum so a revert
// to bare parseFloat goes RED.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// --- extract a named function body by brace-match (tsNum is self-contained: no strings/regex) ---
function sliceBraces(src, fromIdx) {
  let depth = 0, i = fromIdx;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(fromIdx, i + 1); }
  }
  throw new Error('unbalanced braces from ' + fromIdx);
}
// build tsNum directly from its source
const tsNumSrc = (() => {
  const at = HTML.indexOf('function tsNum(');
  if (at < 0) throw new Error('tsNum not found in index.html');
  const braceAt = HTML.indexOf('{', at);
  return `function tsNum(c) ${sliceBraces(HTML, braceAt)}`;
})();
const tsNum = new Function(`${tsNumSrc}\nreturn tsNum;`)();

// =============================================================================================
// 1. tsNum unit lock — the core invariant: ALWAYS a finite number, NEVER NaN.
// =============================================================================================
eq(tsNum({ slack_ts: '1700000000.123' }), 1700000000.123, 'clean fractional ts string -> its float');
eq(tsNum({ slack_ts: '1700000000' }), 1700000000, 'clean integer ts string -> its number');
eq(tsNum({ slack_ts: 1699999999.5 }), 1699999999.5, 'numeric ts (not string) -> itself');
eq(tsNum({ slack_ts: '1700000000.500000' }), 1700000000.5, 'trailing-zero ts -> parsed float');
// the bug surface: every degenerate input must become a FINITE number, never NaN
for (const bad of [
  { label: 'missing slack_ts', c: { id: 'x' } },
  { label: 'slack_ts null', c: { slack_ts: null } },
  { label: 'slack_ts undefined', c: { slack_ts: undefined } },
  { label: 'slack_ts empty string', c: { slack_ts: '' } },
  { label: 'slack_ts non-numeric', c: { slack_ts: 'abc' } },
  { label: 'slack_ts NaN', c: { slack_ts: NaN } },
  { label: 'null comment', c: null },
  { label: 'undefined comment', c: undefined },
]) {
  const v = tsNum(bad.c);
  ok(Number.isFinite(v), `tsNum(${bad.label}) is finite (got ${v})`);
  eq(v, 0, `tsNum(${bad.label}) -> 0`);
}
// a leading-numeric string parseFloat tolerates is fine — the point is finiteness, not strictness
ok(Number.isFinite(tsNum({ slack_ts: '1700000000abc' })), 'tsNum of a leading-numeric string is finite');

// =============================================================================================
// 2. Inline RED proof — the OLD comparator returns NaN on a bad row; the new one never does.
//    (Deterministic: doesn't depend on V8's exact mis-sort output, just the poison SOURCE.)
// =============================================================================================
const oldKey = (c) => parseFloat(c && c.slack_ts);              // the pre-fix logic
const oldCmp = (a, b) => oldKey(a) - oldKey(b);
const newCmp = (a, b) => tsNum(a) - tsNum(b);
const good = { slack_ts: '1700000000' };
const bad = { slack_ts: undefined };
ok(Number.isNaN(oldCmp(bad, good)), 'RED proof: OLD comparator returns NaN when a row lacks slack_ts');
ok(Number.isNaN(oldCmp(good, bad)), 'RED proof: OLD comparator returns NaN (other operand order)');
ok(!Number.isNaN(newCmp(bad, good)), 'fixed comparator never returns NaN (bad,good)');
ok(!Number.isNaN(newCmp(good, bad)), 'fixed comparator never returns NaN (good,bad)');
// every pair among a mixed corpus is a finite comparison under the fix
{
  const rows = [
    { slack_ts: '1700000300' }, { slack_ts: undefined }, { slack_ts: '1700000100' },
    { slack_ts: 'abc' }, { slack_ts: '1700000200' }, { slack_ts: null },
  ];
  let anyNaN = false;
  for (const a of rows) for (const b of rows) if (Number.isNaN(newCmp(a, b))) anyNaN = true;
  ok(!anyNaN, 'no pair in a mixed corpus produces a NaN comparison under tsNum');
}

// =============================================================================================
// 3. End-to-end sort proof — the property the poison would break: the GOOD rows always land in
//    correct relative order regardless of the bad row, and all rows survive.
// =============================================================================================
{
  // 5 good (shuffled) + 1 bad
  const rows = [
    { id: 'c', slack_ts: '1700000300' },
    { id: 'bad', slack_ts: undefined },
    { id: 'a', slack_ts: '1700000100' },
    { id: 'e', slack_ts: '1700000500' },
    { id: 'b', slack_ts: '1700000200' },
    { id: 'd', slack_ts: '1700000400' },
  ];
  // oldest -> newest (chrono / "oldest")
  const asc = [...rows].sort((a, b) => tsNum(a) - tsNum(b));
  eq(asc.length, 6, 'asc sort keeps every row (none lost to NaN)');
  const ascGood = asc.filter(r => r.id !== 'bad').map(r => r.id).join('');
  eq(ascGood, 'abcde', 'good rows ascending by ts regardless of the bad row');
  eq(asc[0].id, 'bad', 'bad row (ts->0) sorts as oldest, deterministically');

  // newest -> oldest
  const desc = [...rows].sort((a, b) => tsNum(b) - tsNum(a));
  eq(desc.length, 6, 'desc sort keeps every row');
  const descGood = desc.filter(r => r.id !== 'bad').map(r => r.id).join('');
  eq(descGood, 'edcba', 'good rows descending by ts regardless of the bad row');
  eq(desc[desc.length - 1].id, 'bad', 'bad row sorts last under newest-first');
}
// all-clean corpus: tsNum sort is identical to the old parseFloat sort (no regression on real data)
{
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: i, slack_ts: String(1700000000 + (i * 37 % 20) * 11) }));
  const viaNew = [...rows].sort((a, b) => tsNum(a) - tsNum(b)).map(r => r.id);
  const viaOld = [...rows].sort((a, b) => oldKey(a) - oldKey(b)).map(r => r.id);
  eq(viaNew.join(','), viaOld.join(','), 'clean corpus: tsNum sort byte-identical to old parseFloat sort');
}

// =============================================================================================
// 4. Source binding — all three sort sites route through tsNum; no bare parseFloat(slack_ts)
//    comparator survives. Re-introducing the old comparator goes RED here.
// =============================================================================================
{
  // strip line/block comments so the explanatory text above tsNum doesn't false-match
  const code = HTML
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  // the three comparators must use tsNum
  ok(/sort\(\(a, b\) => tsNum\(a\) - tsNum\(b\)\)/.test(code), 'chrono/oldest sort uses tsNum');
  ok(/sort\(\(a, b\) => tsNum\(b\) - tsNum\(a\)\)/.test(code), 'newest sort uses tsNum');
  // no surviving parseFloat-based slack_ts COMPARATOR (the display `new Date(parseFloat(...))` sites
  // are not comparators and are allowed)
  ok(!/parseFloat\([^)]*slack_ts\)\s*-\s*parseFloat/.test(code),
     'no bare parseFloat(slack_ts) subtraction comparator remains');
}

// =============================================================================================
console.log(`commentbank ts-sort: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
