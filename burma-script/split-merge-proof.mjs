// WP-01 SPLIT / MERGE PROOF — programmatic Playwright test of the table gesture.
//
// Proves, against the REAL served bundle (not a stale dev server):
//   1. SERVED-HASH GUARD — the burmaScript-*.js the page loads matches the on-disk
//      dist build, so we're testing what we just compiled (no stale 5173/5191 server).
//   2. SPLIT — a full-width row (cols:1, one cell role:full) becomes a 2-cell row;
//      LEFT cell text === the ORIGINAL row text (no word lost), RIGHT cell is empty.
//   3. TYPE — we type "what's shown" prose into the RIGHT (shown) cell; it lands there.
//   4. MERGE — the 2-cell row collapses to ONE full-width cell; BOTH the original said
//      text AND the typed shown text are present, none lost.
//
// Usage: node split-merge-proof.mjs <url>   (defaults to the preview server URL)
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] || 'http://localhost:4317/burma-script/';

// Read the hash the on-disk dist build expects, so we can assert the page loads it.
const distIndex = path.join(__dirname, '..', 'dist', 'burma-script', 'index.html');
const expectHash = (() => {
  try {
    const html = fs.readFileSync(distIndex, 'utf8');
    const m = html.match(/burmaScript-([A-Za-z0-9_]+)\.js/);
    return m ? m[1] : null;
  } catch { return null; }
})();

const fail = (msg) => { console.log('FAIL:', msg); process.exit(1); };
const ok = (msg) => console.log('  ✓', msg);

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const words = (s) => norm(s).split(' ').filter(Boolean);

const browser = await chromium.launch();
const page = await browser.newPage();

// SERVED-HASH GUARD — capture the burmaScript bundle the page actually requests.
let servedHash = null;
page.on('request', (req) => {
  const m = req.url().match(/burmaScript-([A-Za-z0-9_]+)\.js/);
  if (m) servedHash = m[1];
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForSelector('.ProseMirror', { timeout: 20000 });
await page.waitForTimeout(1200);

// --- 1) SERVED-HASH GUARD --------------------------------------------------
if (expectHash) {
  if (servedHash !== expectHash) {
    fail(`served bundle hash ${servedHash} != on-disk build ${expectHash} (STALE SERVER). `
      + `Rebuild + serve dist/, do not point at a leftover 5173/5191 dev server.`);
  }
  ok(`served bundle hash matches build: burmaScript-${servedHash}.js`);
} else {
  console.log('  ! could not read dist index hash — skipping hash guard');
}

// Helper: read the live editor state from inside the page (via the editor handle the app
// hands to window, or by reading the DOM as a fallback). We drive the gesture through the
// real TipTap commands by focusing a cell and dispatching, but to keep the proof robust we
// click the row-spine ⊟/⊞ control — the exact affordance Johnny will use.

// Find the FIRST full-width row that holds real words (skip the decorative scriptStart row
// and any empty band). Returns an index into the .wp-trow list.
const pickRow = async () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('.wp-trow')];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const cols = Number(r.getAttribute('data-cols') || '1');
    const txt = (r.innerText || '').replace(/\s+/g, ' ').trim();
    if (cols === 1 && txt.split(' ').filter(Boolean).length >= 4) return i;
  }
  return -1;
});

const rowIdx = await pickRow();
if (rowIdx < 0) fail('no full-width content row found to split');

// Snapshot the chosen row's ORIGINAL text + cell count BEFORE splitting.
const before = await page.evaluate((i) => {
  const r = document.querySelectorAll('.wp-trow')[i];
  const cells = r.querySelectorAll('.wp-tcell');
  return {
    cols: Number(r.getAttribute('data-cols') || '1'),
    cellCount: cells.length,
    text: (r.innerText || '').replace(/\s+/g, ' ').trim(),
    // The cell content text only (strips the SAID/SHOWN ::before labels — those are CSS
    // generated content, not in innerText, so cell.innerText is already pure content).
    cellText: cells.length ? (cells[0].innerText || '').replace(/\s+/g, ' ').trim() : '',
  };
}, rowIdx);

if (before.cellCount !== 1) fail(`expected 1 cell before split, got ${before.cellCount}`);
ok(`picked full-width row #${rowIdx}: 1 cell, ${words(before.text).length} words`);

// --- 2) SPLIT — click the row-spine ⊟ control ------------------------------
await page.evaluate((i) => {
  const r = document.querySelectorAll('.wp-trow')[i];
  const btn = r.querySelector('.wp-row-split');
  if (!btn) throw new Error('no .wp-row-split control on row');
  // mousedown is what the NodeView listens for (preventDefault keeps focus/selection sane).
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
}, rowIdx);
await page.waitForTimeout(400);

const afterSplit = await page.evaluate((i) => {
  const r = document.querySelectorAll('.wp-trow')[i];
  const cells = [...r.querySelectorAll('.wp-tcell')];
  return {
    cols: Number(r.getAttribute('data-cols') || '1'),
    cellCount: cells.length,
    roles: cells.map((c) => c.getAttribute('data-role')),
    said: cells[0] ? (cells[0].innerText || '').replace(/\s+/g, ' ').trim() : '',
    shown: cells[1] ? (cells[1].innerText || '').replace(/\s+/g, ' ').trim() : '',
  };
}, rowIdx);

if (afterSplit.cellCount !== 2) fail(`expected 2 cells after split, got ${afterSplit.cellCount}`);
if (afterSplit.cols !== 2) fail(`expected cols=2 after split, got ${afterSplit.cols}`);
if (afterSplit.roles[0] !== 'said' || afterSplit.roles[1] !== 'shown') {
  fail(`expected roles [said, shown], got [${afterSplit.roles.join(', ')}]`);
}
ok(`split → 2 cells, roles [${afterSplit.roles.join(', ')}], cols=${afterSplit.cols}`);

// LEFT (said) text must equal the ORIGINAL cell text — NO WORD LOSS on split.
if (norm(afterSplit.said) !== norm(before.cellText)) {
  fail(`said cell text changed on split.\n  before: "${before.cellText}"\n  after:  "${afterSplit.said}"`);
}
ok('said cell preserves ALL original words (left text === original)');

// RIGHT (shown) cell must start empty (cursor-ready).
if (words(afterSplit.shown).length !== 0) {
  fail(`shown cell should be empty after split, got: "${afterSplit.shown}"`);
}
ok('shown cell is empty (cursor-ready)');

// --- 3) TYPE into the SHOWN cell -------------------------------------------
const SHOWN_PROSE = 'aerial drone shot of the river delta at dawn';
// Click into the shown cell's paragraph, then type.
await page.evaluate((i) => {
  const r = document.querySelectorAll('.wp-trow')[i];
  const shownCell = r.querySelectorAll('.wp-tcell')[1];
  const p = shownCell.querySelector('p') || shownCell.querySelector('.wp-tcell-content');
  const range = document.createRange();
  range.selectNodeContents(p);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  p.focus?.();
}, rowIdx);
await page.waitForTimeout(150);
await page.keyboard.type(SHOWN_PROSE);
await page.waitForTimeout(400);

const afterType = await page.evaluate((i) => {
  const r = document.querySelectorAll('.wp-trow')[i];
  const cells = [...r.querySelectorAll('.wp-tcell')];
  return {
    said: (cells[0].innerText || '').replace(/\s+/g, ' ').trim(),
    shown: (cells[1].innerText || '').replace(/\s+/g, ' ').trim(),
  };
}, rowIdx);

if (!afterType.shown.includes(SHOWN_PROSE)) {
  fail(`typed shown prose not found in shown cell. got: "${afterType.shown}"`);
}
ok(`typed into shown cell: "${SHOWN_PROSE}"`);
if (norm(afterType.said) !== norm(before.cellText)) {
  fail('typing in shown cell disturbed the said cell');
}
ok('said cell unchanged while typing in shown');

// --- 4) MERGE — click the row-spine ⊞ control ------------------------------
await page.evaluate((i) => {
  const r = document.querySelectorAll('.wp-trow')[i];
  const btn = r.querySelector('.wp-row-split');
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
}, rowIdx);
await page.waitForTimeout(400);

const afterMerge = await page.evaluate((i) => {
  const r = document.querySelectorAll('.wp-trow')[i];
  const cells = [...r.querySelectorAll('.wp-tcell')];
  return {
    cols: Number(r.getAttribute('data-cols') || '1'),
    cellCount: cells.length,
    role: cells[0] ? cells[0].getAttribute('data-role') : null,
    text: (r.innerText || '').replace(/\s+/g, ' ').trim(),
  };
}, rowIdx);

if (afterMerge.cellCount !== 1) fail(`expected 1 cell after merge, got ${afterMerge.cellCount}`);
if (afterMerge.cols !== 1) fail(`expected cols=1 after merge, got ${afterMerge.cols}`);
if (afterMerge.role !== 'full') fail(`expected role=full after merge, got ${afterMerge.role}`);
ok(`merge → 1 cell, role=${afterMerge.role}, cols=${afterMerge.cols}`);

// NO WORD LOSS on merge — every original said word AND the typed shown prose survive.
const mergedWords = words(afterMerge.text);
const missingOrig = words(before.cellText).filter((w) => !mergedWords.includes(w));
if (missingOrig.length) fail(`original words lost on merge: ${missingOrig.join(' ')}`);
ok('merged row keeps ALL original said words');
if (!afterMerge.text.includes(SHOWN_PROSE)) {
  fail(`shown prose lost on merge. merged text: "${afterMerge.text}"`);
}
ok('merged row keeps the typed shown prose (no word lost either direction)');

await browser.close();
console.log('\nSPLIT/MERGE PROOF: PASS');
console.log(JSON.stringify({
  hashGuard: expectHash ? (servedHash === expectHash) : 'skipped',
  servedHash, expectHash,
  before: { cells: before.cellCount, words: words(before.text).length },
  afterSplit: { cells: afterSplit.cellCount, roles: afterSplit.roles },
  typedShown: SHOWN_PROSE,
  afterMerge: { cells: afterMerge.cellCount, role: afterMerge.role, words: mergedWords.length },
}, null, 2));
process.exit(0);
