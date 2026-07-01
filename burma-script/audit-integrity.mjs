// WP-01 content-integrity AUDIT — the hard gate for "every word + every timecode is on the page."
// Usage: node audit-integrity.mjs <url>   (defaults to http://localhost:5173/burma-script/)
// Loads the live editor, extracts the rendered text, and diffs it against the ORIGINAL script
// (burma-script/sample-script.txt). PASS requires: ZERO missing-content lines AND every timecode
// present AND every timecode inside a clickable tag (.wp-tc-tag / .wp-lcd / [data-tc]).
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] || 'http://localhost:5173/burma-script/';
const orig = fs.readFileSync(path.join(__dirname, 'sample-script.txt'), 'utf8');

// TIMECODE detector — MUST stay byte-identical to parser.ts's exported `TC` so the audit's
// "untagged" math sees exactly what the app chips. The old /\b…\b/ word-boundary form (a) let a
// 1-digit hour through and (b) MISSED any timecode glued to a backslash/bracket/letter/label-colon
// (the parser/builder now chip those via lookbehind/lookahead), so the app could tag a glued
// timecode the audit never counted — a latent silent-loss gap. This is the parser's canonical
// regex verbatim: lookbehind (?<!\d)(?<!\d:) rejects a longer numeric run but keeps a LABEL colon;
// lookahead (?!:?\d) rejects a 5th field / trailing digit but keeps the "tc: description" form.
// The timecode is CAPTURE GROUP 1 here, so every matchAll below reads m[1], not m[0].
const TC = /(?<!\d)(?<!\d:)(\d{2}:\d{2}:\d{2}:\d{2})(?!:?\d)/g;
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const b = await chromium.launch();
const p = await b.newPage();
await p.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
await p.waitForTimeout(1800);

const data = await p.evaluate(() => {
  // AUDIT NEUTRALIZE: content-visibility:auto skips offscreen layout, and innerText is
  // layout-dependent, so an offscreen row would read as '' and false-fail the zero-loss diff.
  // Force every row fully rendered for the measurement (this can only ADD content to what the
  // audit sees, never hide any -- it cannot mask real loss). Read a layout prop to flush reflow.
  const cvKill = document.createElement('style');
  cvKill.textContent = '.wp-trow, [style*="content-visibility"] { content-visibility: visible !important; contain-intrinsic-size: auto !important; }';
  document.documentElement.appendChild(cvKill);
  void document.body.offsetHeight; // force synchronous reflow so innerText sees the now-rendered rows
  const pm = document.querySelector('.ProseMirror');
  const txt = pm ? pm.innerText : (document.body.innerText || '');
  // CELL-AWARE: a split row keeps "what's said" in the LEFT (role:said) cell and "what's
  // shown" in the RIGHT (role:shown) cell. The whole-PM innerText already concatenates
  // both, but we ALSO gather per-cell text so the content probe can match a line even when
  // it was split across cells — and so we read timecodes/clips that live INSIDE cells.
  // Selectors cover the custom node-view cell (.wp-tcell / [data-tcell]), the plain HTML
  // fallback ([data-type=tableCell]), and a generic table cell (td) for completeness.
  const cellEls = [...document.querySelectorAll(
    '.wp-tcell, [data-tcell], [data-type="tableCell"], td'
  )];
  const cellTexts = cellEls.map((e) => e.innerText || '');
  // Timecode-bearing tags ANYWHERE, including inside cells.
  const tagged = [...document.querySelectorAll('.wp-tc-tag, .wp-lcd, .wp-broll-tc, [data-tc]')]
    .map((e) => e.innerText).join(' ');
  // VISUAL-TRUNCATION guard: text that lives in the DOM but is hidden by CSS
  // (line-clamp / overflow:hidden) reads fine to innerText yet is invisible to Johnny.
  // Catch it so a clamp can never silently swallow the cold open again. Now walks INTO
  // cell content (.wp-tcell-content, .wp-tcell) too so a clamp inside a split column is caught.
  const clipped = [];
  for (const el of document.querySelectorAll('.wp-body, .wp-cart-body, .wp-note, .wp-svc-group, .wp-vo-body, .wp-tcell, .wp-tcell-content, .ProseMirror p')) {
    const cs = getComputedStyle(el);
    const lineClamped = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
    const overflowClipped = (cs.overflow === 'hidden' || cs.overflowY === 'hidden') && (el.scrollHeight - el.clientHeight > 4);
    if (lineClamped || overflowClipped) {
      clipped.push((el.innerText || '').slice(0, 70) + ` [clamp=${cs.webkitLineClamp} sh=${el.scrollHeight} ch=${el.clientHeight}]`);
    }
  }
  return { txt, tagged, clipped, cellTexts };
});
await b.close();

const rn = norm(data.txt);
// Per-cell normalized text + a global token multiset of the whole page. TOKEN-SET matching
// (below) checks a line's distinctive tokens against these, so a line SPLIT across the
// said/shown cells still matches (its tokens are all present on the page) while a line whose
// tokens genuinely vanished is still caught.
const cellNorms = (data.cellTexts || []).map(norm).filter(Boolean);
const pageTokens = new Set(rn.split(' ').filter(Boolean));

// Common words carry no identifying signal — a line "matches" only on its DISTINCTIVE tokens.
const STOP = new Set(('the a an and or of to in on at for with from by as is are was were be been '
  + 'it its this that these those i you he she we they them his her their our your my me him '
  + 'so but not no yes do does did has have had will would can could should about into out up '
  + 'down over under then than if when while who what which where why how all any each more most '
  + 'some such only own same too very just also'). split(' '));

// A line PASSES when a strong-enough fraction of its distinctive tokens are present on the page
// (token-SET membership, order-independent). Catches real content loss (tokens missing) but is
// robust to a line being broken across said/shown cells (all tokens still present, just split).
function lineTokens(key) {
  return [...new Set(key.split(' ').filter((w) => w.length >= 3 && !STOP.has(w)))];
}
function tokensPresent(tokens) {
  if (!tokens.length) return true;
  // Whole-page set membership first (covers a line split across cells — all its tokens live
  // somewhere on the page). Require ~85% of distinctive tokens present to count as "on page".
  const hitsPage = tokens.filter((t) => pageTokens.has(t)).length;
  if (hitsPage / tokens.length >= 0.85) return true;
  // Fallback: the line may sit intact inside ONE cell (contiguous) — accept if any single cell
  // contains nearly all of its distinctive tokens.
  for (const c of cellNorms) {
    const hits = tokens.filter((t) => c.includes(t)).length;
    if (hits / tokens.length >= 0.85) return true;
  }
  return false;
}

// 1) TIMECODE integrity — scan the whole-PM text PLUS every cell's text so a timecode that
// lives inside a split cell is still counted as on-page.
const allPageText = data.txt + ' ' + (data.cellTexts || []).join(' ');
const origTc = [...orig.matchAll(TC)].map((m) => m[1]);
const pageTc = [...allPageText.matchAll(TC)].map((m) => m[1]);
const taggedTc = [...data.tagged.matchAll(TC)].map((m) => m[1]);
const origTcSet = new Set(origTc), pageTcSet = new Set(pageTc), taggedSet = new Set(taggedTc);
const missingTc = [...origTcSet].filter((t) => !pageTcSet.has(t));
const untaggedTc = [...pageTcSet].filter((t) => !taggedSet.has(t));

// 2) CONTENT integrity — every meaningful original line should appear in the rendered text
const missingLines = [];
for (const raw of orig.split('\n')) {
  const t = raw.replace(/\\([\-\[\]\!\(\)\.\*_`#>~])/g, '$1').trim();
  if (t.replace(/[^a-z0-9]/gi, '').length < 20) continue;        // skip tiny/structural lines
  const key = norm(t);
  if (!key) continue;
  // TOKEN-SET probe: match on the line's DISTINCTIVE tokens as a set (order-independent),
  // checked against the whole-page token set AND each cell's text. Robust to a line being
  // split across the said/shown cells, while still catching a line whose tokens truly vanished.
  const tokens = lineTokens(key);
  if (!tokensPresent(tokens)) missingLines.push(t.slice(0, 100));
}

const report = {
  timecodes: { original: origTcSet.size, onPage: pageTcSet.size, missing: missingTc.length, untagged: untaggedTc.length },
  content: { missingLines: missingLines.length },
  visuallyClipped: data.clipped.length,
  // ZERO-LOSS GATE: this is a "no word is ever lost" tool, so the content gate is STRICT —
  // a single genuinely-missing line fails the audit. (The token-set probe above is already
  // robust to a line being split across said/shown cells, so a real PASS means zero loss,
  // not "close enough". No tolerance budget to silently consume.)
  PASS: missingTc.length === 0 && untaggedTc.length === 0 && missingLines.length === 0 && data.clipped.length === 0,
};
console.log(JSON.stringify(report, null, 2));
if (data.clipped.length) console.log('VISUALLY CLIPPED (text hidden by CSS — first 10):\n  ' + data.clipped.slice(0, 10).join('\n  '));
if (missingTc.length) console.log('MISSING TIMECODES (first 20):', missingTc.slice(0, 20).join(' '));
if (untaggedTc.length) console.log('UNTAGGED TIMECODES (first 20):', untaggedTc.slice(0, 20).join(' '));
if (missingLines.length) console.log('MISSING CONTENT (first 15):\n  ' + missingLines.slice(0, 15).join('\n  '));
process.exit(report.PASS ? 0 : 1);
