// Verifier-layer coverage for the STRUCTURE board's corrupt-store GUARD —
// mergeWithDefaults(parsed), the single funnel EVERY persisted board state passes
// through before it becomes live `state`: local boot (loadState -> JSON.parse ->
// mergeWithDefaults) AND every cloud adopt (adoptRemoteState -> mergeWithDefaults).
//
// THE BUG THIS LOCKS: the board renders by iterating its four collections —
// rebuildAll() does `state.cards.map(...)`, `state.cards.forEach(renderCard)`,
// `state.connections.forEach(renderConnection)`, and other paths hit
// `state.frames.forEach` / `state.drawings`. If ANY of those four is a non-array,
// rebuildAll THROWS and the whole board bricks. The old mergeWithDefaults left
// TWO holes:
//   - cards / connections had NO guard at all (raw `...parsed` passthrough).
//   - frames / drawings used `parsed.frames || []`, which only catches FALSY —
//     a truthy non-array ({} or "x") sails straight through.
// Crucially, mergeWithDefaults itself does NOT throw on a non-array collection
// (it just spreads it), so loadState's try/catch never fires — the corrupt value
// reaches `state` intact and detonates later at the first rebuildAll(). This is
// the exact "corrupt non-array store bricks the whole tool at boot" class the
// loop has fixed ~15x across walden / westchester / burma-essays / reef / etc.
//
// A STRUCTURE board is a LIVE multi-user tool (Johnny + editors) that syncs board
// state through the cloud AND localStorage, so a bad value can arrive from a
// legacy/partial local copy OR a synced-down row and hit every other client.
//
// EXTRACTS the real shipped mergeWithDefaults from index.html at runtime (regex +
// new Function) so the test can't drift from a hand-mirrored copy. defaultState()
// (which pulls in DOM-era swatch constants) is stubbed in the Function scope with
// a minimal fixture — we're testing the coercion/merge logic, not the palette.
//
// Mutation-proven: revert any of the four `asArray(...)` guards back to the old
// `parsed.X || []` (or a raw passthrough) and the load-bearing "non-array ->
// real array" assertions turn RED.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

// mergeWithDefaults' body contains template-literal-free code but nested braces
// (object literals), so anchor the match on its real terminator: the closing
// `}` of the function, which is the first `\n}` at column 0 after the signature.
const m = html.match(/function mergeWithDefaults\(parsed\)\{[\s\S]*?\n\}/);
assert.ok(m, 'could not find mergeWithDefaults() in index.html');

// Minimal defaultState stub: same SHAPE the real one returns (four array
// collections + boardMeta + settings), but trivial values so assertions are
// legible. The real defaultState depends on swatch constants that only exist in
// the browser; the coercion logic under test is independent of those values.
const STUB = `function defaultState(){ return { camera:{x:0,y:0,zoom:1}, boardMeta:{title:'D',subtitle:'D'}, cards:[], connections:[], frames:[], drawings:[], settings:{defaultFont:'sans',globalFontSize:30} }; }`;
const mergeWithDefaults = new Function(`${STUB}\n${m[0]}\nreturn mergeWithDefaults;`)();

const isArr = (v) => Array.isArray(v);
const COLLECTIONS = ['cards', 'connections', 'frames', 'drawings'];

// 1. The happy path is byte-identical: a valid board round-trips untouched.
{
  const good = {
    camera: { x: 5, y: 6, zoom: 2 },
    boardMeta: { title: 'My Board', subtitle: 'Sub' },
    cards: [{ id: 'a', x: 1 }, { id: 'b', x: 2 }],
    connections: [{ id: 'c1', from: 'a', to: 'b' }],
    frames: [{ id: 'f1' }],
    drawings: [{ id: 'd1' }],
    settings: { defaultFont: 'serif', globalFontSize: 40 },
  };
  const out = mergeWithDefaults(good);
  assert.deepEqual(out.cards, good.cards, 'valid cards preserved');
  assert.deepEqual(out.connections, good.connections, 'valid connections preserved');
  assert.deepEqual(out.frames, good.frames, 'valid frames preserved');
  assert.deepEqual(out.drawings, good.drawings, 'valid drawings preserved');
  assert.equal(out.boardMeta.title, 'My Board', 'valid boardMeta preserved');
  assert.equal(out.settings.defaultFont, 'serif', 'user settings override defaults');
  assert.equal(out.settings.globalFontSize, 40, 'user settings override defaults');
  assert.deepEqual(out.camera, good.camera, 'camera preserved');
}

// 2. THE LOAD-BEARING GUARD: each collection, when a non-array, becomes a real
//    array so rebuildAll()'s .map/.forEach can never throw. Covers null (old
//    no-guard hole), {} and "x" (old `|| []` truthy-non-array hole), and number.
for (const key of COLLECTIONS) {
  for (const bad of [null, undefined, {}, 'x', 42, true, NaN]) {
    const out = mergeWithDefaults({ [key]: bad });
    assert.ok(isArr(out[key]), `${key}=${String(bad)} must coerce to an array`);
    // And it must actually be iterable without throwing (the real crash site).
    assert.doesNotThrow(() => out[key].forEach(() => {}), `${key} must be safe to .forEach`);
    assert.doesNotThrow(() => out[key].map(() => 0), `${key} must be safe to .map`);
  }
}

// 3. All four corrupt at once — the worst-case synced-down garbage — still yields
//    a fully iterable, non-bricking state.
{
  const out = mergeWithDefaults({ cards: null, connections: 'x', frames: {}, drawings: 7 });
  for (const key of COLLECTIONS) {
    assert.ok(isArr(out[key]) && out[key].length === 0, `${key} coerced to [] under all-corrupt`);
  }
}

// 4. A non-object top-level parse (JSON `null`, a number, a string, an array) must
//    not throw and must yield defaults — adoptRemoteState/loadState can hand this
//    in from a corrupt cloud row or legacy value.
for (const bad of [null, 42, 'garbage', true]) {
  assert.doesNotThrow(() => mergeWithDefaults(bad), `top-level ${String(bad)} must not throw`);
  const out = mergeWithDefaults(bad);
  for (const key of COLLECTIONS) assert.ok(isArr(out[key]), `${key} is array for top-level ${String(bad)}`);
  assert.ok(out.boardMeta && typeof out.boardMeta === 'object', 'boardMeta falls back to defaults');
  assert.ok(out.settings && typeof out.settings === 'object', 'settings falls back to defaults');
}

// 5. A JSON array as the top-level state (a real corruption shape) must not leak
//    numeric-index props into cards etc. — collections stay clean arrays.
{
  const out = mergeWithDefaults([{ id: 'x' }, { id: 'y' }]);
  for (const key of COLLECTIONS) assert.ok(isArr(out[key]) && out[key].length === 0, `${key} clean under top-level array`);
}

// 6. A corrupt non-object boardMeta / settings falls back instead of poisoning
//    state.boardMeta.title / state.settings.*.
{
  const out = mergeWithDefaults({ boardMeta: 'oops', settings: 'nope', cards: [] });
  assert.equal(out.boardMeta.title, 'D', 'string boardMeta -> defaults');
  assert.equal(out.settings.defaultFont, 'sans', 'string settings -> defaults');
}

console.log('OK merge-defaults.test.mjs — mergeWithDefaults corrupt-store guard locked');
