// Locks the QSS library card display cores — extracted from the REAL shipped
// queen-scarlet-school/library/index.html at runtime (can't drift from a mirror):
//   relTime(iso)   — the "N mins/hours/days ago" stamp on every story card
//   decorFor(id)   — the stable decorative cover for a coverless story
//
// relTime got a finite-ms guard this iteration: a present-but-unparseable
// updated_at previously fell through every band to "Invalid Date"
// (new Date(iso).toLocaleDateString()); it now returns 'just now'. Byte-identical
// for every valid timestamp. decorFor is a verifier-layer LOCK (no live bug — its
// stable hash is correct) pinning the deterministic + in-range contract.
//
// Run: node queen-scarlet-school/library-cards.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, 'library', 'index.html'), 'utf8');

// ── extract a balanced span starting at a marker, matching open/close chars ──
function span(src, marker, open, close) {
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`marker not found: ${marker}`);
  let i = src.indexOf(open, start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`unbalanced span for ${marker}`);
}

const decorArr = span(html, 'const DECOR = [', '[', ']');          // const DECOR = [ ... ]
const decorForSrc = span(html, 'function decorFor(', '{', '}');     // function decorFor(id){...}
const relTimeSrc = span(html, 'function relTime(', '{', '}');       // function relTime(iso){...}

const built = new Function(`
  ${decorArr};
  ${decorForSrc}
  ${relTimeSrc}
  return { DECOR, decorFor, relTime };
`)();
const { DECOR, decorFor, relTime } = built;

// Reconstruct the OLD relTime (no finite-ms guard) to prove the bug + the fix.
const relTimeOld = new Function('iso', `
  if (!iso) return 'just now';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return \`\${m} min\${m === 1 ? '' : 's'} ago\`;
  const h = Math.floor(m / 60);
  if (h < 24) return \`\${h} hour\${h === 1 ? '' : 's'} ago\`;
  const d = Math.floor(h / 24);
  if (d < 30) return \`\${d} day\${d === 1 ? '' : 's'} ago\`;
  return new Date(iso).toLocaleDateString();
`);

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`); };
};
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

// ── RED proof: the OLD relTime renders "Invalid Date" on a present-but-bad iso ──
ok(relTimeOld('not-a-real-date') === 'Invalid Date',
  'RED proof: old relTime returns "Invalid Date" on an unparseable timestamp');
ok(relTime('not-a-real-date') === 'just now',
  'FIX: shipped relTime returns "just now" on an unparseable timestamp (not "Invalid Date")');

// ── relTime: the fix (present-but-unparseable / garbage → graceful) ──
eq(relTime('garbage'), 'just now', 'garbage iso -> just now');
eq(relTime('2026-13-99'), 'just now', 'impossible date -> just now');
eq(relTime(''), 'just now', 'empty iso -> just now (falsy short-circuit)');
eq(relTime(null), 'just now', 'null iso -> just now');
eq(relTime(undefined), 'just now', 'undefined iso -> just now');
ok(relTime('not-a-real-date') !== 'Invalid Date', 'never renders the literal "Invalid Date"');

// ── relTime: no-regression — every valid timestamp matches the OLD formatter ──
for (const ms of [0, 5_000, 59_000, MIN, 5 * MIN, 59 * MIN, HOUR, 5 * HOUR, 23 * HOUR, DAY, 5 * DAY, 29 * DAY]) {
  const t = iso(ms);
  eq(relTime(t), relTimeOld(t), `no-regression: valid ts (${ms}ms ago) matches old formatter`);
}
// band spot-checks
eq(relTime(iso(0)), 'just now', '0ms ago -> just now');
eq(relTime(iso(30_000)), 'just now', '30s ago -> just now');
eq(relTime(iso(MIN + 1000)), '1 min ago', '~1 min -> singular');
eq(relTime(iso(5 * MIN)), '5 mins ago', '5 min -> plural');
eq(relTime(iso(HOUR + 1000)), '1 hour ago', '~1 hour -> singular');
eq(relTime(iso(5 * HOUR)), '5 hours ago', '5 hours -> plural');
eq(relTime(iso(DAY + 1000)), '1 day ago', '~1 day -> singular');
eq(relTime(iso(5 * DAY)), '5 days ago', '5 days -> plural');
ok(relTime(iso(40 * DAY)) === relTimeOld(iso(40 * DAY)), '>30 days -> locale date (matches old)');
// future timestamp (clock skew) stays graceful, never "Invalid Date"
eq(relTime(iso(-90_000)), 'just now', 'future ts (90s skew) -> just now');

// ── decorFor: deterministic + always in range (verifier-layer lock) ──
ok(Array.isArray(DECOR) && DECOR.length > 0, 'DECOR is a non-empty array');
const ids = ['s1', 'story-abc', 'queen-scarlet', 'b7f3', '', '0', 'a'.repeat(64), '🐉dragon'];
for (const id of ids) {
  const r = decorFor(id);
  ok(DECOR.includes(r), `decorFor(${JSON.stringify(id)}) returns a member of DECOR (in range)`);
  eq(decorFor(id), decorFor(id), `decorFor(${JSON.stringify(id)}) is deterministic (stable cover)`);
}
eq(decorFor(null), decorFor(''), 'decorFor(null) === decorFor("") (null coerced to empty id)');
eq(decorFor(undefined), decorFor(''), 'decorFor(undefined) === decorFor("")');
ok(DECOR.includes(decorFor(null)), 'decorFor(null) still in range (no crash)');
// distinct ids generally map across the palette (not all collapsed to one)
const distinct = new Set(['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'].map(decorFor));
ok(distinct.size > 1, 'distinct ids spread across more than one decor (hash actually mixes)');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
