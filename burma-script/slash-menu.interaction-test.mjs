// Slash-menu + direction-chip INTERACTION test (manual dev tool — like audit-integrity.mjs, it
// needs a live vite server, so it is deliberately NOT swept into scripts/run-tests.mjs).
//
// Run:  bun run dev --port 5199 --strictPort   (in another shell)
//       node burma-script/slash-menu.interaction-test.mjs
//
// Asserts the full flow the redesign requires:
//   1. typing "/" in an editable block opens the floating menu with the six commands
//   2. picking "archive" inserts a red "ARCHIVE NEEDED" inline chip
//   3. a real mousedown on the chip cycles it to green "ARCHIVE FOUND"
// Prints RESULT: PASS / FAIL. Regression guard for the immediatelyRender mount crash.
import { chromium } from 'playwright';
const URL = process.env.URL || 'http://localhost:5199/burma-script/';
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
const fail = (m) => { console.log('FAIL:', m); };

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.ProseMirror', { timeout: 8000 });
await page.waitForTimeout(600);

// 1) place cursor at end of a VO/writing paragraph body and type "/"
const clicked = await page.evaluate(() => {
  const p = document.querySelector('.wp-cart p') || document.querySelector('.wp-editor-content p');
  if (!p) return false;
  const range = document.createRange();
  range.selectNodeContents(p);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  p.focus?.();
  return true;
});
console.log('cursor placed:', clicked);
await page.waitForTimeout(150);
await page.keyboard.type('/');
await page.waitForTimeout(400);

// 2) assert menu appears with the expected items
const menu = await page.evaluate(() => {
  const m = document.querySelector('.wp-slash-menu');
  if (!m) return { present: false };
  return { present: true, items: [...m.querySelectorAll('.wp-slash-item')].map(b => b.textContent) };
});
console.log('MENU:', JSON.stringify(menu));
const EXPECT = ['archive','factcheck','animation','broll','direction','break'];
let ok = menu.present && EXPECT.every(x => menu.items.includes(x));
if (!ok) fail('menu missing or items incomplete');

// 3) pick "archive" via keyboard: it is first item -> Enter. Assert red chip inserted.
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
const chip1 = await page.evaluate(() => {
  const c = document.querySelector('.wp-dchip[data-kind="archive"]');
  if (!c) return null;
  const bg = getComputedStyle(c).backgroundColor;
  return { text: c.textContent.trim(), status: c.getAttribute('data-status'), bg };
});
console.log('CHIP after pick:', JSON.stringify(chip1));
if (!chip1) fail('archive chip not inserted');
else {
  if (chip1.status !== 'needed') fail('chip not in red "needed" state');
  // red background from CSS: #f2d4d4 -> rgb(242,212,212)
  if (chip1.bg !== 'rgb(242, 212, 212)') fail('chip background not red, got ' + chip1.bg);
  if (!/ARCHIVE NEEDED/.test(chip1.text)) fail('chip text not "ARCHIVE NEEDED": ' + chip1.text);
}

// 4) dispatch a REAL mousedown on the chip -> assert it cycles to green "found"
const chip2 = await page.evaluate(() => {
  const c = document.querySelector('.wp-dchip[data-kind="archive"]');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: r.x+2, clientY: r.y+2 });
  c.dispatchEvent(ev);
  return true;
});
await page.waitForTimeout(300);
const chip3 = await page.evaluate(() => {
  const c = document.querySelector('.wp-dchip[data-kind="archive"]');
  if (!c) return null;
  return { text: c.textContent.trim(), status: c.getAttribute('data-status'), bg: getComputedStyle(c).backgroundColor };
});
console.log('CHIP after mousedown:', JSON.stringify(chip3));
if (!chip3 || chip3.status !== 'found') fail('chip did not cycle to green "found"');
else {
  // green #d9e8d0 -> rgb(217,232,208)
  if (chip3.bg !== 'rgb(217, 232, 208)') fail('chip not green after cycle, got ' + chip3.bg);
  if (!/ARCHIVE FOUND/.test(chip3.text)) fail('chip text not "ARCHIVE FOUND": ' + chip3.text);
}

console.log('PAGE ERRORS:', errs.length ? errs.join(' | ') : 'none');
console.log(ok && chip1 && chip3 && chip3.status==='found' && errs.length===0 ? 'RESULT: PASS' : 'RESULT: FAIL');
await browser.close();
