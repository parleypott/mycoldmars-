/*
 * check-no-pm-fill.test.mjs — locks the fill()-on-ProseMirror lint (2026-07-08 data-loss guardrail).
 */
import assert from 'node:assert/strict';
import { scanText } from '../../scripts/check-no-pm-fill.mjs';

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('  ✗', name, '—', e.message); } };

ok('flags the exact incident line', () => {
  assert.equal(scanText(`await page.locator('.ProseMirror').fill('X');`).length, 1);
});
ok('flags a fill on the editor-content class', () => {
  assert.equal(scanText(`el.querySelector('.wp-editor-content').fill(v)`).length, 1);
});
ok('does NOT flag Array/TypedArray fill', () => {
  assert.equal(scanText(`const a = new Array(5).fill(0); buf.fill(255);`).length, 0);
});
ok('does NOT flag a fill unrelated to the editor', () => {
  assert.equal(scanText(`await page.locator('#email').fill('you@newpress.com');`).length, 0);
});
ok('reports the 1-indexed line number', () => {
  const hits = scanText(`a\nb\nc.ProseMirror.fill(1)\nd`);
  assert.equal(hits[0].line, 3);
});

console.log(`\ncheck-no-pm-fill: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
