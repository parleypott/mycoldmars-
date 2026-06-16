// WP-01 content-integrity AUDIT — the hard gate for "every word + every timecode is on the page."
// Usage: node audit-integrity.mjs <url>   (defaults to http://localhost:5173/burma-script/)
// Loads the live editor, extracts the rendered text, and diffs it against the ORIGINAL script
// (burma-script/sample-script.txt). PASS requires: missing-content lines ~0 AND every timecode
// present AND every timecode inside a clickable tag (.wp-tc-tag / .wp-lcd / [data-tc]).
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] || 'http://localhost:5173/burma-script/';
const orig = fs.readFileSync(path.join(__dirname, 'sample-script.txt'), 'utf8');

const TC = /\b\d{1,2}:\d{2}:\d{2}:\d{2}\b/g;
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const b = await chromium.launch();
const p = await b.newPage();
await p.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
await p.waitForTimeout(1800);

const data = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror');
  const txt = pm ? pm.innerText : (document.body.innerText || '');
  const tagged = [...document.querySelectorAll('.wp-tc-tag, .wp-lcd, .wp-broll-tc, [data-tc]')]
    .map((e) => e.innerText).join(' ');
  return { txt, tagged };
});
await b.close();

const rn = norm(data.txt);

// 1) TIMECODE integrity
const origTc = [...orig.matchAll(TC)].map((m) => m[0]);
const pageTc = [...data.txt.matchAll(TC)].map((m) => m[0]);
const taggedTc = [...data.tagged.matchAll(TC)].map((m) => m[0]);
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
  // check the line's distinctive middle chunk is present (robust to edge trimming)
  const probe = key.length > 50 ? key.slice(10, 50) : key;
  if (probe && !rn.includes(probe)) missingLines.push(t.slice(0, 100));
}

const report = {
  timecodes: { original: origTcSet.size, onPage: pageTcSet.size, missing: missingTc.length, untagged: untaggedTc.length },
  content: { missingLines: missingLines.length },
  PASS: missingTc.length === 0 && untaggedTc.length === 0 && missingLines.length <= 3,
};
console.log(JSON.stringify(report, null, 2));
if (missingTc.length) console.log('MISSING TIMECODES (first 20):', missingTc.slice(0, 20).join(' '));
if (untaggedTc.length) console.log('UNTAGGED TIMECODES (first 20):', untaggedTc.slice(0, 20).join(' '));
if (missingLines.length) console.log('MISSING CONTENT (first 15):\n  ' + missingLines.slice(0, 15).join('\n  '));
process.exit(report.PASS ? 0 : 1);
