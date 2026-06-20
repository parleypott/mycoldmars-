// ts-date.test.mjs
//
// The Commentbank (commentbank/index.html, live + in vite.config.js) renders a Slack timestamp as a
// Date in TWO display sites: the browse month header (renderBrowse) and the producer-facing comment
// embed Johnny COPIES INTO VIDEOS (buildEditFor). Both USED to do `new Date(parseFloat(c.slack_ts) *
// 1000)` with NO finite guard — and parseFloat of a missing / non-numeric slack_ts is NaN, so the Date
// is Invalid. That rendered "Invalid Date" in the month header and, worse, "NaN years ago" on the
// stylized embed (Math.max(1, Math.round((now - NaN)/...)) === NaN, which fails every `< N` ternary and
// falls to the years branch -> "NaN years ago"). Same NaN class as the sort fix (496cdf4); these are the
// two display sites that fix's note explicitly logged as the follow-up. Live data is clean today (all
// rows carry a numeric slack_ts), so it was latent — but a single dropped slack_ts from a future
// comment-bank sync would silently print "NaN years ago" on a comment embed Johnny pastes into a video.
//
// The fix adds two NaN-safe helpers next to tsNum: tsToDate(c) -> a valid Date or null, and relTimeAgo(d)
// -> the "N units ago" label (null / Invalid Date -> "recently"). Both display sites route through them;
// a bad timestamp now groups under "Undated" / renders "recently" instead of corrupting the view. For a
// valid Date both helpers are byte-identical to the old inline expressions -> zero regression on clean
// data. This test EXTRACTS the real shipped helpers from index.html at runtime (no hand-copied mirror,
// can't drift), locks them, proves the corruption is gone, and binds the call sites so a revert goes RED.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// --- extract a named function body by brace-match. Both helpers have balanced braces: tsToDate has no
//     strings; relTimeAgo's only braces are balanced `${...}` template substitutions, so naive matching
//     is correct (every `{` has a matching `}` and they nest). ---
function sliceBraces(src, fromIdx) {
  let depth = 0, i = fromIdx;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(fromIdx, i + 1); }
  }
  throw new Error('unbalanced braces from ' + fromIdx);
}
function extractFn(name) {
  const at = HTML.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`${name} not found in index.html`);
  const braceAt = HTML.indexOf('{', at);
  const sig = HTML.slice(at, braceAt);            // e.g. "function relTimeAgo(d) "
  const src = `${sig}${sliceBraces(HTML, braceAt)}`;
  return new Function(`${src}\nreturn ${name};`)();
}

const tsToDate = extractFn('tsToDate');
const relTimeAgo = extractFn('relTimeAgo');

const DAY = 86400000;

// =============================================================================================
// 1. tsToDate unit lock — the core invariant: a valid Date for clean input, NULL (not Invalid Date)
//    for every degenerate input, so the month-header caller's `d ? ... : "Undated"` falls to the
//    fallback rather than rendering "Invalid Date".
// =============================================================================================
{
  const d = tsToDate({ slack_ts: '1700000000' });
  ok(d instanceof Date, 'clean ts -> a Date');
  eq(d.getTime(), 1700000000000, 'clean integer ts -> correct epoch ms');
}
{
  const d = tsToDate({ slack_ts: '1700000000.5' });
  eq(d.getTime(), 1700000000500, 'clean fractional ts -> correct epoch ms');
}
{
  const d = tsToDate({ slack_ts: 1699999999 });   // numeric, not string
  eq(d.getTime(), 1699999999000, 'numeric (non-string) ts -> correct epoch ms');
}
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
  // assert it's literally null, NOT an Invalid Date (which JSON.stringify would also show as "null",
  // so report the concrete type to keep a mutation failure legible).
  const got = tsToDate(bad.c);
  ok(got === null, `tsToDate(${bad.label}) -> null, NOT an Invalid Date (got ${got instanceof Date ? 'Invalid Date object' : JSON.stringify(got)})`);
}

// =============================================================================================
// 2. relTimeAgo unit lock — the producer-facing label. Bad input -> "recently", NEVER "NaN ... ago".
//    Valid Dates -> the same "N units ago" the old inline expression produced.
// =============================================================================================
// the bug surface:
eq(relTimeAgo(null), 'recently', 'relTimeAgo(null) -> "recently"');
eq(relTimeAgo(undefined), 'recently', 'relTimeAgo(undefined) -> "recently"');
eq(relTimeAgo(new Date(NaN)), 'recently', 'relTimeAgo(Invalid Date) -> "recently" (never "NaN years ago")');
// valid relative labels (computed relative to Date.now() inside the fn, so these are stable):
eq(relTimeAgo(new Date(Date.now() - 1 * DAY)), '1 day ago', '1 day ago (singular)');
eq(relTimeAgo(new Date(Date.now() - 3 * DAY)), '3 days ago', '3 days ago (plural)');
eq(relTimeAgo(new Date(Date.now() - 6 * DAY)), '6 days ago', '6 days still in the day tier');
eq(relTimeAgo(new Date(Date.now() - 14 * DAY)), '2 weeks ago', '14 days -> 2 weeks');
eq(relTimeAgo(new Date(Date.now() - 7 * DAY)), '1 week ago', '7 days -> 1 week (singular)');
eq(relTimeAgo(new Date(Date.now() - 30 * DAY)), '1 month ago', '30 days -> months tier (boundary)');
eq(relTimeAgo(new Date(Date.now() - 60 * DAY)), '2 months ago', '60 days -> 2 months');
eq(relTimeAgo(new Date(Date.now() - 400 * DAY)), '1 year ago', '400 days -> 1 year (singular)');
eq(relTimeAgo(new Date(Date.now() - 800 * DAY)), '2 years ago', '800 days -> 2 years');
// a future date clamps to "1 day ago" (Math.max(1, ...)), same as the old logic:
eq(relTimeAgo(new Date(Date.now() + 5 * DAY)), '1 day ago', 'future ts clamps to 1 day ago');

// =============================================================================================
// 3. Inline RED proof — reconstruct the OLD inline expressions and show the exact corruption the fix
//    removes: "NaN years ago" on the embed and "Invalid Date" in the header, on a bad slack_ts.
// =============================================================================================
const oldEmbedTime = (c) => {
  const d = new Date(parseFloat(c.slack_ts) * 1000);            // pre-fix embed logic
  const daysAgo = Math.max(1, Math.round((Date.now() - d.getTime()) / DAY));
  return daysAgo < 7 ? `${daysAgo} day${daysAgo === 1 ? '' : 's'} ago`
    : daysAgo < 30 ? `${Math.round(daysAgo / 7)} week${Math.round(daysAgo / 7) === 1 ? '' : 's'} ago`
    : daysAgo < 365 ? `${Math.round(daysAgo / 30)} month${Math.round(daysAgo / 30) === 1 ? '' : 's'} ago`
    : `${Math.round(daysAgo / 365)} year${Math.round(daysAgo / 365) === 1 ? '' : 's'} ago`;
};
const oldHeaderKey = (c) => {
  const d = new Date(parseFloat(c.slack_ts) * 1000);            // pre-fix header logic
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
};
eq(oldEmbedTime({ slack_ts: undefined }), 'NaN years ago',
  'RED proof: OLD embed logic renders "NaN years ago" on a bad slack_ts');
eq(oldHeaderKey({ slack_ts: undefined }), 'Invalid Date',
  'RED proof: OLD header logic renders "Invalid Date" on a bad slack_ts');
// the fix path the live caller now takes:
eq(relTimeAgo(tsToDate({ slack_ts: undefined })), 'recently',
  'FIX: embed renders "recently" on a bad slack_ts');
eq(tsToDate({ slack_ts: undefined }), null,
  'FIX: header gets null -> caller falls to "Undated" (not "Invalid Date")');
// clean-data equivalence: for a valid ts the fix === the old inline expression (zero regression)
for (const days of [1, 3, 6, 7, 14, 30, 60, 400]) {
  const ts = Math.floor((Date.now() - days * DAY) / 1000);
  const c = { slack_ts: String(ts) };
  eq(relTimeAgo(tsToDate(c)), oldEmbedTime(c), `clean-data equivalence: embed label matches old (${days}d)`);
}

// =============================================================================================
// 4. Source binding — the divergent OLD inline pattern must be GONE and the call sites wired to the
//    helpers, so a revert of either site goes RED (comment-stripped to avoid matching the doc above).
// =============================================================================================
const codeOnly = HTML.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/[^\n]*/g, '');
ok(!codeOnly.includes('new Date(parseFloat(c.slack_ts) * 1000)'),
  'source binding: the OLD `new Date(parseFloat(c.slack_ts) * 1000)` inline form is GONE');
ok(codeOnly.includes('relTimeAgo(tsToDate(c))'),
  'source binding: embed site wired to relTimeAgo(tsToDate(c))');
ok(/d \? d\.toLocaleDateString[\s\S]{0,80}: "Undated"/.test(codeOnly),
  'source binding: month-header site falls back to "Undated" when tsToDate -> null');

// ---------------------------------------------------------------------------------------------
console.log(`\nts-date.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) { for (const m of fails) console.log('  FAIL: ' + m); process.exit(1); }
