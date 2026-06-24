// Locks sanitizeImportedState — the todo day-planner's IMPORT front door validator.
//
// THE BUG IT GUARDS (real, reachable): the `import json…` handler used to do only
//   `if (!incoming.columns) throw`  then immediately  pushHistory() / state = {...} /
//   save() / render(). A TRUTHY-but-non-array `columns` (the wrong json file, a
//   hand-edited backup, a different tool's export carrying a `columns` object) sailed
//   past that guard, corrupted + PERSISTED live state, and broke the UI behind a generic
//   "import failed" toast. And a block with a non-numeric startMin/endMin silently
//   poisoned the lane sort + minToPx() → blocks rendered at top:NaNpx (invisible).
//
// sanitizeImportedState validates + repairs into a known-good shape and returns null for
// anything that isn't a real export, so the caller rejects WITHOUT touching live state.
//
// This EXTRACTS the real shipped function from todo/index.html via brace-matching (same
// standard as planner-core.test.mjs) so it can't drift from a hand-copied mirror, and is
// mutation-proven: the OLD truthy-only guard is reconstructed here and shown to ACCEPT
// the exact payloads that corrupt state, while the shipped function rejects/repairs them.
//
// run: node todo/import-sanitize.test.mjs   (or via `bun run test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'index.html'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found in index.html`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

const { sanitizeImportedState } = (() => {
  const body = `${extractFn(HTML, 'sanitizeImportedState')}\nreturn { sanitizeImportedState };`;
  return new Function(body)();
})();

const DEFAULTS = { columns: [], hourStart: 6, hourEnd: 23, view: { tx: 0, ty: 0, scale: 1 } };

let pass = 0, fail = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } }

// ── 1. A valid export round-trips, merged onto defaults ──
{
  const inc = { columns: [{ id: 'c1', mode: 'day', blocks: [{ id: 'b', startMin: 360, endMin: 420 }] }], hourStart: 5 };
  const out = sanitizeImportedState(inc, DEFAULTS);
  ok(out && Array.isArray(out.columns) && out.columns.length === 1, 'valid export accepted');
  ok(out.columns[0].blocks.length === 1, 'valid block kept');
  ok(out.hourStart === 5 && out.hourEnd === 23, 'incoming overrides + defaults fill gaps');
}

// ── 2. REJECTED (null) — the payloads that used to corrupt persisted state ──
const rejects = [
  ['truthy non-array columns (object)', { columns: { a: 1 } }],
  ['columns is a number', { columns: 5 }],
  ['columns is a string', { columns: 'nope' }],
  ['columns is true', { columns: true }],
  ['no columns key', { hourStart: 6 }],
  ['null payload', null],
  ['array payload (not an object export)', [{ columns: [] }]],
  ['string payload', 'wat'],
];
for (const [label, inc] of rejects) {
  ok(sanitizeImportedState(inc, DEFAULTS) === null, `rejects: ${label}`);
}

// ── 3. MUTATION PROOF: the OLD truthy-only guard ACCEPTED the corrupting payloads ──
// (reconstructed inline so a regression to that logic is provably caught)
const oldGuardAccepts = inc => !!(inc && inc.columns); // the shipped-before predicate
ok(oldGuardAccepts({ columns: { a: 1 } }) === true,
   'OLD guard would have accepted a non-array columns (this is the bug)');
ok(sanitizeImportedState({ columns: { a: 1 } }, DEFAULTS) === null,
   'NEW guard rejects the same payload — mutation distinguishes them');

// ── 4. Block repair: non-finite / inverted-range blocks are dropped, good ones kept ──
{
  const inc = { columns: [{ id: 'c', blocks: [
    { id: 'good', startMin: 360, endMin: 420 },
    { id: 'nanStart', startMin: 'oops', endMin: 420 },
    { id: 'nanEnd', startMin: 360, endMin: null },
    { id: 'inverted', startMin: 500, endMin: 480 },
    { id: 'missing' },
    null,
    'notablock',
  ] }] };
  const out = sanitizeImportedState(inc, DEFAULTS);
  const ids = out.columns[0].blocks.map(b => b.id);
  ok(eq(ids, ['good']), `only the finite, forward-range block survives (got ${JSON.stringify(ids)})`);
}

// ── 5. A column missing a blocks array gets a clean empty one (no NaN sort downstream) ──
{
  const out = sanitizeImportedState({ columns: [{ id: 'c', mode: 'list' }] }, DEFAULTS);
  ok(Array.isArray(out.columns[0].blocks) && out.columns[0].blocks.length === 0,
     'column without blocks → empty array');
}

// ── 6. Garbage column entries are dropped, not crashed on ──
{
  const out = sanitizeImportedState({ columns: [null, 'x', 42, { id: 'real', blocks: [] }] }, DEFAULTS);
  ok(out.columns.length === 1 && out.columns[0].id === 'real', 'non-object columns dropped');
}

// ── 7. Does not mutate the caller's defaults ──
{
  const defs = { columns: [], hourStart: 6, hourEnd: 23, view: { tx: 0, ty: 0, scale: 1 } };
  sanitizeImportedState({ columns: [{ id: 'c', blocks: [{ id: 'b', startMin: 0, endMin: 1 }] }] }, defs);
  ok(defs.columns.length === 0, 'defaults left untouched (structuredClone isolation)');
}

console.log(`sanitizeImportedState: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 1 - 1 : 1);
