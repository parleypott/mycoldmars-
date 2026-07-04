// Locks laserspace's bunkerCellIndex — the pure world-pixel -> bunker-cell mapper
// that hitBunker() uses to decide whether a bullet/bomb struck a bunker cell.
//
// Bug it guards (divergent-copy class): hitBunker used to bound the column with
// `b.cells[0].length` — row 0's width applied to EVERY row — while its sibling
// damageBunker loops each row by its own `b.cells[cy].length`. For the shipped
// rectangular BUNKER_PROTO the two agree (all rows 16 wide), so this was a latent
// landmine, not a live miss. But a ragged grid (any future proto edit) would make
// hitBunker read the WRONG bound on non-first rows: a real "G" cell beyond row 0's
// width is unhittable, or a short row is over-scanned. bunkerCellIndex now bounds
// per-row, matching damageBunker.
//
// The test EXTRACTS the real shipped bunkerCellIndex from laserspace/index.html at
// runtime (can't drift from a mirror) and mutation-proves the per-row bound with a
// deliberately ragged bunker.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, 'index.html'), 'utf8');

// Extract a top-level `function NAME(params) { ...body... }` via brace matching.
function extractFn(name) {
  const sig = `function ${name}(`;
  const start = html.indexOf(sig);
  assert.ok(start !== -1, `${name} not found in index.html`);
  let i = html.indexOf('{', start);
  assert.ok(i !== -1, `opening brace for ${name} not found`);
  let depth = 0, end = -1;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  assert.ok(end !== -1, `closing brace for ${name} not found`);
  const params = html.slice(start + sig.length, html.indexOf(')', start));
  const body = html.slice(i + 1, end);
  // eslint-disable-next-line no-new-func
  return new Function(params, body);
}

const bunkerCellIndex = extractFn('bunkerCellIndex');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', msg); }
}
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// A rectangular bunker like the shipped proto (all rows same width). x=24, y=188.
const rect = {
  x: 24, y: 188,
  cells: [
    "GGGG".split(""),
    "GGGG".split(""),
    "GGGG".split(""),
  ],
};

// ── in-bounds mapping (rectangular): identical to the old row-0-bound form ──
eq(bunkerCellIndex(rect, 24, 188), { cx: 0, cy: 0 }, 'top-left maps to (0,0)');
eq(bunkerCellIndex(rect, 27, 190), { cx: 3, cy: 2 }, 'bottom-right cell maps correctly');
eq(bunkerCellIndex(rect, 24.9, 188.9), { cx: 0, cy: 0 }, 'sub-pixel floors into the cell');

// ── out-of-bounds returns null (never crashes hitBunker) ──
eq(bunkerCellIndex(rect, 23, 188), null, 'left of grid -> null');
eq(bunkerCellIndex(rect, 24, 187), null, 'above grid -> null');
eq(bunkerCellIndex(rect, 28, 188), null, 'right of a 4-wide row -> null');
eq(bunkerCellIndex(rect, 24, 191), null, 'below the last row -> null');

// ── THE LOAD-BEARING CASE: a ragged bunker. Row 0 is 2 wide, row 1 is 6 wide. ──
// A hit at column 4 on row 1 is a REAL cell (row 1 has width 6) and MUST map, not
// return null. The old `b.cells[0].length` bound (= 2) would reject it -> the bug.
const ragged = {
  x: 0, y: 0,
  cells: [
    "GG".split(""),               // row 0: width 2
    "GGGGGG".split(""),           // row 1: width 6
    "GGG".split(""),              // row 2: width 3
  ],
};
eq(bunkerCellIndex(ragged, 4, 1), { cx: 4, cy: 1 },
   'RAGGED: col 4 on a 6-wide row maps (row-0 width-2 bound would wrongly null it)');
eq(bunkerCellIndex(ragged, 5, 1), { cx: 5, cy: 1 }, 'RAGGED: last col of the wide row maps');
eq(bunkerCellIndex(ragged, 6, 1), null, 'RAGGED: past the 6-wide row -> null');
// A short row must be bounded by ITS width, not a wider row's:
eq(bunkerCellIndex(ragged, 2, 2), { cx: 2, cy: 2 }, 'RAGGED: last col (idx 2) of a 3-wide row maps');
eq(bunkerCellIndex(ragged, 3, 2), null, 'RAGGED: col 3 on a 3-wide row is out of bounds');
eq(bunkerCellIndex(ragged, 2, 0), null, 'RAGGED: col 2 on the 2-wide row 0 -> null (per-row bound)');
eq(bunkerCellIndex(ragged, 1, 0), { cx: 1, cy: 0 }, 'RAGGED: col 1 on the 2-wide row 0 maps');

console.log(`bunker-collision: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
