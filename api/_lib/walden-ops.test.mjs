/**
 * Tests for the Walden landscape-studio op pipeline (api/_lib/walden-ops.js).
 *
 * Run: node walden-ops.test.mjs   (from api/_lib/)  — or `bun run test` from repo root.
 *
 * Headline bug (fixed): the AI design collaborator on 35 Walden — an explicitly
 * TERRACED site — could place a retaining wall but could NEVER set its height or
 * terrace level. The `wall` element's whole job is holding grade: heightFt drives
 * the on-plan "R.W. H=N'" label, the >4ft "needs an engineer" warning, and the
 * terracing advice; levelFt is the top terrace level. The client modelled both
 * and even round-tripped them INTO the model via planSummary(), but the op
 * pipeline dropped them on the way back: add_element had no height param, and
 * neither functionCallToOp nor normalizeOp carried heightFt/levelFt. So every
 * AI-placed wall was stuck at the 3ft client default, and "make that a 6-foot
 * wall" / "stack terraces at +4 and +8" were impossible through the AI. Both
 * functions now carry the wall grade properties through the add path.
 */

import {
  ELEMENT_TYPES,
  functionCallToOp,
  normalizeOp,
  defaultName,
  sanitizePlan,
  extractOpsFromText,
  tryParseOpsArray,
} from './walden-ops.js';

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; fails.push(`✗ ${msg}\n    expected ${e}\n    got      ${a}`); }
}
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; fails.push(`✗ ${msg}`); }
}

// A Gemini-style function call for placing a 6ft retaining wall on a +8ft terrace.
const wallCall = {
  name: 'add_element',
  args: { type: 'wall', kind: 'line', name: 'Upper terrace wall', cx: 10, cy: 40, wFt: 1.5, lFt: 30, rot: 0, heightFt: 6, levelFt: 8 },
};

// ── HEADLINE: the wall grade properties survive the add path ──────────────────
{
  const op = functionCallToOp(wallCall);
  eq(op.heightFt, 6, 'functionCallToOp carries heightFt from the Gemini call');
  eq(op.levelFt, 8, 'functionCallToOp carries levelFt from the Gemini call');

  const norm = normalizeOp(op);
  eq(norm.heightFt, 6, 'normalizeOp preserves heightFt (the fix)');
  eq(norm.levelFt, 8, 'normalizeOp preserves levelFt (the fix)');
  eq(norm.type, 'wall', 'wall add normalizes with type wall');
  eq(norm.kind, 'line', 'wall add keeps line kind');
  eq(norm.name, 'Upper terrace wall', 'wall add keeps name');
}

// ── INLINE RED PROOF: the OLD pipeline (no height carry) silently dropped it ───
// Reconstructs the pre-fix add-case so the test is provably a real verifier:
// if someone reverts the fix to this shape, the headline asserts above go RED.
{
  const oldFunctionCallToOp = (fc) => {
    const a = fc?.args || {};
    if (fc?.name !== 'add_element') return null;
    return { op: 'add', type: a.type, kind: a.kind, name: a.name, cx: a.cx, cy: a.cy, wFt: a.wFt, lFt: a.lFt, rot: a.rot };
  };
  const oldOp = oldFunctionCallToOp(wallCall);
  ok(oldOp.heightFt === undefined, 'RED PROOF: old functionCallToOp dropped heightFt (bug reproduced)');
  ok(oldOp.levelFt === undefined, 'RED PROOF: old functionCallToOp dropped levelFt (bug reproduced)');
  // And prove the NEW code differs from the old on exactly this input:
  ok(functionCallToOp(wallCall).heightFt === 6 && oldOp.heightFt === undefined,
     'RED PROOF: new code carries what old code dropped');
}

// ── COERCION of the grade properties ──────────────────────────────────────────
{
  // A wall can't hold negative grade — clamp height to magnitude.
  const n = normalizeOp({ op: 'add', type: 'wall', kind: 'line', cx: 0, cy: 0, wFt: 1, lFt: 10, heightFt: -6 });
  eq(n.heightFt, 6, 'heightFt clamped to its magnitude (no negative grade)');
  ok(!('levelFt' in n), 'levelFt omitted when not provided');

  // levelFt is a SIGNED elevation — a terrace can sit below house datum.
  const n2 = normalizeOp({ op: 'add', type: 'wall', kind: 'line', cx: 0, cy: 0, wFt: 1, lFt: 10, heightFt: 3, levelFt: -4 });
  eq(n2.levelFt, -4, 'levelFt kept signed (terrace below datum allowed)');

  // String numbers (model sometimes stringifies) coerce.
  const n3 = normalizeOp({ op: 'add', type: 'wall', kind: 'line', cx: 0, cy: 0, wFt: 1, lFt: 10, heightFt: '5.5' });
  eq(n3.heightFt, 5.5, 'heightFt coerces a numeric string');

  // Non-finite height is dropped, not turned into 0/NaN.
  const n4 = normalizeOp({ op: 'add', type: 'wall', kind: 'line', cx: 0, cy: 0, wFt: 1, lFt: 10, heightFt: 'tall' });
  ok(!('heightFt' in n4), 'non-finite heightFt is omitted, never NaN');
}

// ── NO SPURIOUS FIELDS: a non-wall add stays byte-identical to its old shape ───
{
  const pool = normalizeOp({ op: 'add', type: 'pool', kind: 'oval', name: 'Main pool', cx: 5, cy: 20, wFt: 16, lFt: 32 });
  eq(pool, { op: 'add', type: 'pool', kind: 'oval', name: 'Main pool', cx: 5, cy: 20, wFt: 16, lFt: 32, rot: 0 },
     'a pool add gains no heightFt/levelFt keys');
  ok(!('heightFt' in pool) && !('levelFt' in pool), 'non-wall add has no grade keys at all');
}

// ── REGRESSION LOCKS: every other op normalizes exactly as before ─────────────
{
  eq(normalizeOp({ op: 'add', type: 'pool', kind: 'octagon', cx: 1, cy: 2, wFt: 4, lFt: 4 }).kind, 'rect',
     'invalid kind snaps to the type default');
  ok(normalizeOp({ op: 'add', type: 'spaceship', kind: 'rect', cx: 1, cy: 2, wFt: 4, lFt: 4 }) === null,
     'unknown type → null');
  ok(normalizeOp({ op: 'add', type: 'pool', kind: 'rect', cx: 'x', cy: 2, wFt: 4, lFt: 4 }) === null,
     'non-numeric coord → null');
  eq(normalizeOp({ op: 'add', type: 'tree', kind: 'point', cx: 0, cy: 0, wFt: -8, lFt: -8 }).wFt, 8,
     'width/length clamped to magnitude');
  eq(normalizeOp({ op: 'add', type: 'tree', kind: 'point', cx: 0, cy: 0, wFt: 8, lFt: 8 }).name, 'Tree',
     'missing name falls back to defaultName');
  eq(normalizeOp({ op: 'add', type: 'tree', kind: 'point', name: 'x'.repeat(99), cx: 0, cy: 0, wFt: 8, lFt: 8 }).name.length, 60,
     'name capped at 60 chars');

  eq(normalizeOp({ op: 'move', id: 7, cx: 1, cy: 2 }), { op: 'move', id: '7', cx: 1, cy: 2 }, 'move coerces id to string');
  ok(normalizeOp({ op: 'move', cx: 1, cy: 2 }) === null, 'move without id → null');
  eq(normalizeOp({ op: 'resize', id: 'a', wFt: -3, lFt: 5 }), { op: 'resize', id: 'a', wFt: 3, lFt: 5 }, 'resize clamps width');
  eq(normalizeOp({ op: 'rotate', id: 'a', rot: 45 }), { op: 'rotate', id: 'a', rot: 45 }, 'rotate passes through');
  ok(normalizeOp({ op: 'rotate', id: 'a', rot: 'spin' }) === null, 'non-numeric rot → null');
  eq(normalizeOp({ op: 'delete', id: 'a' }), { op: 'delete', id: 'a' }, 'delete passes through');
  ok(normalizeOp({ op: 'delete' }) === null, 'delete without id → null');
  eq(normalizeOp({ op: 'rename', id: 'a', name: 'New' }), { op: 'rename', id: 'a', name: 'New' }, 'rename passes through');
  ok(normalizeOp({ op: 'rename', id: 'a' }) === null, 'rename without name → null');
  ok(normalizeOp(null) === null && normalizeOp({ op: 'frobnicate' }) === null, 'junk → null');
}

// ── functionCallToOp name mapping ─────────────────────────────────────────────
{
  eq(functionCallToOp({ name: 'move_element', args: { id: 'a', cx: 1, cy: 2 } }), { op: 'move', id: 'a', cx: 1, cy: 2 }, 'move_element maps');
  eq(functionCallToOp({ name: 'delete_element', args: { id: 'a' } }), { op: 'delete', id: 'a' }, 'delete_element maps');
  ok(functionCallToOp({ name: 'launch_rocket', args: {} }) === null, 'unknown tool → null');
  ok(functionCallToOp({ args: {} }) === null, 'no name → null');
  ok(!('heightFt' in functionCallToOp({ name: 'add_element', args: { type: 'pool', kind: 'rect', cx: 0, cy: 0, wFt: 1, lFt: 1 } })),
     'add_element without heightFt produces no heightFt key');
}

// ── defaultName (the wall label gap) ──────────────────────────────────────────
{
  eq(defaultName('wall'), 'Retaining wall', 'wall now has a real default label (was "Element")');
  eq(defaultName('pool'), 'Pool', 'pool label intact');
  eq(defaultName('mystery'), 'Element', 'unknown type → Element');
  ok(ELEMENT_TYPES.wall && ELEMENT_TYPES.wall.includes('line'), 'wall is a valid element type with a line kind');
}

// ── sanitizePlan lets the model SEE existing wall heights ─────────────────────
{
  const p = sanitizePlan({
    elements: [
      { id: 1, type: 'wall', kind: 'line', name: 'W', cx: 0, cy: 0, wFt: 1, lFt: 10, rot: 0, heightFt: 5, levelFt: 4 },
      { id: 2, type: 'pool', kind: 'rect', cx: 1, cy: 1, wFt: 10, lFt: 20 },
    ],
  });
  eq(p.elements[0].heightFt, 5, 'sanitizePlan keeps wall heightFt so the model can reason about grade');
  eq(p.elements[0].levelFt, 4, 'sanitizePlan keeps wall levelFt');
  eq(p.elements[0].id, '1', 'sanitizePlan coerces id to string');
  ok(!('heightFt' in p.elements[1]), 'sanitizePlan adds no grade keys to a pool');
  eq(p.units, 'feet', 'sanitizePlan stamps units');
  ok(sanitizePlan({ elements: Array(500).fill({ id: 'x' }) }).elements.length === 200, 'sanitizePlan caps at 200 elements');
  ok(Array.isArray(sanitizePlan(null).elements) && sanitizePlan(null).elements.length === 0, 'sanitizePlan tolerates junk');
}

// ── extractOpsFromText / tryParseOpsArray: fenced wall add carries height ──────
{
  const reply = 'Sure — adding a wall.\n\n```ops\n[{"name":"add_element","args":{"type":"wall","kind":"line","cx":0,"cy":0,"wFt":1,"lFt":12,"heightFt":6}}]\n```\n\nThat holds the slope.';
  const { cleanReply, parsedOps } = extractOpsFromText(reply);
  ok(parsedOps.length === 1, 'fenced ops array parses one op');
  eq(parsedOps[0].heightFt, 6, 'fenced wall add carries heightFt through tryParseOpsArray');
  ok(!cleanReply.includes('```'), 'the fence is stripped from the visible reply');
  ok(cleanReply.includes('holds the slope'), 'surrounding prose is preserved');

  // Load-bearing: the closing ``` HUGS the JSON (no newline before it) — a real
  // LLM fallback shape. The old `\n```` form dropped the op AND leaked the raw
  // fence into the reply. Goes RED if extractOpsFromText reverts to requiring a
  // newline on either side of the fence.
  const hugged = 'Here:\n```ops\n[{"op":"delete","id":"x"}]```\nDone.';
  const hug = extractOpsFromText(hugged);
  eq(hug.parsedOps, [{ op: 'delete', id: 'x' }], 'hugged closing fence still parses the op');
  ok(!hug.cleanReply.includes('```'), 'hugged fence is stripped from the visible reply (no raw-fence leak)');
  ok(hug.cleanReply.includes('Done.'), 'prose after a hugged fence is preserved');
  // Opening tag with no newline before content, closing fence at end-of-string
  const tight = '```ops [{"op":"rotate","id":"a","rot":90}]```';
  eq(extractOpsFromText(tight).parsedOps, [{ op: 'rotate', id: 'a', rot: 90 }], 'single-line fence (no newlines) parses');

  // direct op-shape array + trailing-comma tolerance
  eq(tryParseOpsArray('[{"op":"delete","id":"x"},]'), [{ op: 'delete', id: 'x' }], 'trailing comma tolerated');
  eq(tryParseOpsArray('not json'), [], 'unparseable → empty');
  eq(extractOpsFromText('no fences here').parsedOps, [], 'no fence → no ops');
}

// ── summary ──────────────────────────────────────────────────────────────────
if (fail) {
  console.error(fails.join('\n'));
  console.error(`\n${pass} passed, ${fail} FAILED`);
  process.exit(1);
}
console.log(`walden-ops: ${pass}/${pass} passed`);
