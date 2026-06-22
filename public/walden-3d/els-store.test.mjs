// Verifier lock for walden-3d's `walden-design` store reads (JSON.parse type-confusion
// class). Both scene3d.html and studio.html adopt a stored object's `.els` to seed the
// element list, then iterate it (for...of / forEach) OUTSIDE the parse try/catch — so a
// corrupt `{els:<non-array>}` store crashed the render at load. The fix guards each read
// with Array.isArray. This test EXTRACTS the real shipped load expression from each file
// at runtime (can't drift), proves the OLD unguarded form fed a non-array to the consumer,
// and source-binds the Array.isArray guard.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scene3d = readFileSync(join(__dirname, 'scene3d.html'), 'utf8');
const studio = readFileSync(join(__dirname, 'studio.html'), 'utf8');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('✗', name, '\n   ', e.message); } };
const mkLS = (raw) => {
  const store = raw === undefined ? {} : { 'walden-design': raw };
  return { getItem: (k) => (k in store ? store[k] : null) };
};

// --- materialize the REAL shipped scene3d load line, return the resulting `els` ---
const sceneLine = scene3d.match(/let els=\[\];try\{const d=JSON\.parse[\s\S]*?\}catch\(_\)\{ \}/);
assert(sceneLine, 'could not locate scene3d els load line');
function sceneEls(raw) {
  return new Function('localStorage', `${sceneLine[0]} return els;`)(mkLS(raw));
}
// --- materialize the REAL shipped studio IIFE, return {dElements,dUid} ---
const studioIife = studio.match(/\(function\(\)\{try\{const s=JSON\.parse[\s\S]*?\}\)\(\);/);
assert(studioIife, 'could not locate studio load IIFE');
function studioState(raw) {
  return new Function('localStorage', `let dElements=[],dUid=1; ${studioIife[0]} return {dElements,dUid};`)(mkLS(raw));
}

// ---------- RED proofs: the OLD unguarded forms fed a non-array to the consumer ----------
// scene3d old: els=(d&&d.els)||[]  then  for(const el of els)
function oldSceneEls(raw) {
  return new Function('localStorage',
    `let els=[];try{const d=JSON.parse(localStorage.getItem('walden-design')||'null');els=(d&&d.els)||[];}catch(_){ } return els;`
  )(mkLS(raw));
}
t('RED proof: old scene3d returns a non-array object on {els:5} and for...of crashes', () => {
  const old = oldSceneEls(JSON.stringify({ els: 5 }));
  assert.strictEqual(old, 5, 'old form keeps the non-array els verbatim');
  assert.throws(() => { for (const _ of old) void _; }, TypeError, 'for...of must crash under old code');
});
t('RED proof: old scene3d on {els:{}} yields a non-iterable object', () => {
  const old = oldSceneEls(JSON.stringify({ els: { a: 1 } }));
  assert(!Array.isArray(old) && typeof old === 'object', 'old keeps the object els');
  assert.throws(() => { for (const _ of old) void _; }, TypeError);
});
// studio old: if(s&&s.els){dElements=s.els}  then  dElements.forEach(...)
function oldStudioState(raw) {
  return new Function('localStorage',
    `let dElements=[],dUid=1;(function(){try{const s=JSON.parse(localStorage.getItem('walden-design')||'null');if(s&&s.els){dElements=s.els;dUid=s.uid||(dElements.length+1);}}catch(_){}})(); return {dElements,dUid};`
  )(mkLS(raw));
}
t('RED proof: old studio adopts a non-array els ({els:5}) and forEach crashes', () => {
  const { dElements } = oldStudioState(JSON.stringify({ els: 5 }));
  assert.strictEqual(dElements, 5, 'old form adopts the non-array els');
  assert.throws(() => dElements.forEach(() => {}), TypeError, 'forEach must crash under old code');
});

// ---------- the FIX: real shipped code degrades a corrupt els to [] ----------
t('scene3d: {els:5} (corrupt) -> [] (for...of safe)', () => {
  const els = sceneEls(JSON.stringify({ els: 5 }));
  assert.deepStrictEqual(els, []);
  for (const _ of els) void _; // no throw
});
t('scene3d: {els:{}} -> []', () => assert.deepStrictEqual(sceneEls(JSON.stringify({ els: { a: 1 } })), []));
t('scene3d: {els:"x"} (string) -> []', () => assert.deepStrictEqual(sceneEls(JSON.stringify({ els: 'x' })), []));
t('scene3d: literal null store -> []', () => assert.deepStrictEqual(sceneEls('null'), []));
t('scene3d: malformed JSON -> [] (caught)', () => assert.deepStrictEqual(sceneEls('{bad'), []));
t('scene3d: absent key -> []', () => assert.deepStrictEqual(sceneEls(undefined), []));
t('scene3d: missing .els -> []', () => assert.deepStrictEqual(sceneEls(JSON.stringify({ uid: 3 })), []));

t('studio: {els:5} (corrupt) -> dElements [] (forEach safe)', () => {
  const { dElements } = studioState(JSON.stringify({ els: 5 }));
  assert.deepStrictEqual(dElements, []);
  dElements.forEach(() => {}); // no throw
});
t('studio: {els:{}} -> dElements []', () => assert.deepStrictEqual(studioState(JSON.stringify({ els: { a: 1 } })).dElements, []));
t('studio: {els:"x"} -> dElements []', () => assert.deepStrictEqual(studioState(JSON.stringify({ els: 'x' })).dElements, []));
t('studio: literal null -> dElements []', () => assert.deepStrictEqual(studioState('null').dElements, []));
t('studio: malformed -> dElements []', () => assert.deepStrictEqual(studioState('{bad').dElements, []));

// ---------- no-regression: a real array store is byte-identical to before ----------
const realStore = JSON.stringify({ els: [{ id: 'd1', type: 'tree', e: 1, n: 2 }, { id: 'd2', type: 'pool', e: 3, n: 4 }], uid: 7 });
t('scene3d: real array store preserved verbatim (order + contents)', () => {
  const els = sceneEls(realStore);
  assert.strictEqual(els.length, 2);
  assert.strictEqual(els[0].id, 'd1');
  assert.strictEqual(els[1].type, 'pool');
});
t('studio: real array store adopts els + uid', () => {
  const { dElements, dUid } = studioState(realStore);
  assert.strictEqual(dElements.length, 2);
  assert.strictEqual(dElements[1].id, 'd2');
  assert.strictEqual(dUid, 7);
});
t('studio: real array store with no uid -> uid = length+1', () => {
  const { dUid } = studioState(JSON.stringify({ els: [{ id: 'd1' }] }));
  assert.strictEqual(dUid, 2);
});
t('consumer-safety invariant: scene3d els is always for...of-safe, studio dElements always forEach-safe', () => {
  for (const raw of ['{}', '5', '"x"', 'true', 'null', '0', JSON.stringify({ els: 9 }), JSON.stringify({ els: {} }), '{bad', undefined]) {
    const els = sceneEls(raw);
    assert(Array.isArray(els), `scene3d els must be an array for ${raw}`);
    for (const _ of els) void _;
    const { dElements } = studioState(raw);
    assert(Array.isArray(dElements), `studio dElements must be an array for ${raw}`);
    dElements.forEach(() => {});
  }
});

// ---------- source-binding: the guard ships in BOTH files, old forms gone ----------
t('source-binding: scene3d.html carries the Array.isArray(d.els) guard, old (d&&d.els)||[] gone', () => {
  assert(/els=\(d&&Array\.isArray\(d\.els\)\)\?d\.els:\[\]/.test(scene3d), 'scene3d must guard with Array.isArray(d.els)');
  assert(!/els=\(d&&d\.els\)\|\|\[\]/.test(scene3d), 'old unguarded (d&&d.els)||[] must be gone');
});
t('source-binding: studio.html carries the Array.isArray(s.els) guard, old if(s&&s.els){ gone', () => {
  assert(/if\(s&&Array\.isArray\(s\.els\)\)\{dElements=s\.els/.test(studio), 'studio must guard with Array.isArray(s.els)');
  assert(!/if\(s&&s\.els\)\{dElements=s\.els/.test(studio), 'old unguarded if(s&&s.els){ must be gone');
});

console.log(`\nwalden-3d els-store: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
