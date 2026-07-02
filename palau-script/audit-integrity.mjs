import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173/palau-script/';
const src = fs.readFileSync(new URL('./palau-source.txt', import.meta.url), 'utf8');

const TC = /(?<!\d)(?<!\d:)(?:\d{2}:\d{2}:\d{2}:\d{2}|\d{2}:\d{2}:\d{2})(?!:?\d)/g;
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(1800);

const data = await page.evaluate(() => {
  const cvKill = document.createElement('style');
  cvKill.textContent = '.wp-trow, [style*="content-visibility"] { content-visibility: visible !important; contain-intrinsic-size: auto !important; }';
  document.documentElement.appendChild(cvKill);
  void document.body.offsetHeight;

  const pm = document.querySelector('.ProseMirror');
  const txt = pm ? pm.innerText : (document.body.innerText || '');
  const tagged = [...document.querySelectorAll('.wp-tc-tag, .wp-lcd, .wp-broll-tc, [data-tc]')]
    .map((el) => el.innerText)
    .join(' ');

  return { txt, tagged };
});

await browser.close();

const srcLines = src.split('\n').map((line) => norm(line)).filter((line) => line.length > 3);
const renderedNorm = norm(data.txt);

// Line-presence check. FAST PATH: the whole normalized line appears verbatim (contiguous). FALLBACK:
// ≥85% of the line's DISTINCTIVE tokens (len≥3, non-stopword) appear anywhere in the page text —
// the same robust token-set check the Burma audit uses. The fallback is required because the SOT
// SEQUENCE TAG legitimately REFORMATS a soundbite line (a "name · timecode" pill, then the quote,
// then the out-tc), so the original line is no longer a contiguous substring even though every word
// is on the page. Token coverage still catches REAL loss (dropped words → missing tokens). Timecode
// loss is caught separately + exactly below (0-tolerance), so this only governs prose words.
const STOP = new Set('the a an and or of to in on is it its this that for with we our you your they their as at be by so but not no are was has had have will can just out get to'.split(' '));
const pageTokens = new Set(renderedNorm.split(' ').filter(Boolean));
const lineCovered = (line) => {
  const toks = [...new Set(line.split(' ').filter((t) => t.length >= 3 && !STOP.has(t)))];
  if (!toks.length) return true;
  const present = toks.filter((t) => pageTokens.has(t)).length;
  return present / toks.length >= 0.85;
};
const missingLines = srcLines.filter((line) => !renderedNorm.includes(line) && !lineCovered(line));

const srcTc = [...new Set([...src.matchAll(TC)].map((m) => m[0]))];
const renderedTcSet = new Set([...data.txt.matchAll(TC)].map((m) => m[0]));
const taggedNorm = ` ${norm(data.tagged)} `;
const missingTc = srcTc.filter((tc) => !renderedTcSet.has(tc));
const untaggedTc = srcTc.filter((tc) => renderedTcSet.has(tc) && !taggedNorm.includes(` ${norm(tc)} `) && !taggedNorm.includes(norm(tc)));

const pass = missingLines.length === 0 && missingTc.length === 0 && untaggedTc.length === 0;

console.log('=== PALAU LIVE AUDIT ===');
console.log('source content lines checked:', srcLines.length);
console.log('MISSING content lines:', missingLines.length, missingLines.slice(0, 5));
console.log('source timecodes:', srcTc.length);
console.log('MISSING timecodes:', missingTc.length, missingTc.slice(0, 8));
console.log('UNTAGGED timecodes:', untaggedTc.length, untaggedTc.slice(0, 8));
console.log(pass ? 'RESULT: PASS ✓' : 'RESULT: FAIL ✗');

process.exit(pass ? 0 : 1);
