// Verifier-layer LOCK for the LIVE QSSArt image-prompt assembler.
//
// QSSArt (an IIFE in queen-scarlet-school/index.html, exposed as window.QSSArt)
// is the load-bearing, Henry-facing core behind EVERY storybook illustration:
//   • detectCharacters(text) — decides which canonical character lookbook
//     entries get injected into the nano-banana prompt for a scene. A
//     regression here either summons a character who isn't in the scene
//     (wrong art) or drops one who is (generic art), silently.
//   • build({...}) — assembles the actual image-gen prompt (style preface +
//     scene beat + character block + composition rules).
//
// IMPORTANT: api/_lib/qss-art-direction.test.mjs locks the SERVER MIRROR
// (api/_lib/qss-art-direction.js), which the loop's mark-alias note documented
// as DEAD and DIVERGENT from this live inline code (the mirror still says
// "16:9" + DO/DONT walls + an old "blue polo" Mark Rober; the live one says
// "1:1 square" + the backward-cap Mark Rober). So nothing previously locked
// the code Henry actually hits. This test extracts the REAL shipped IIFE from
// index.html at runtime (brace-match + new Function) so it can't drift from a
// mirror, and is mutation-proven against the source.
//
// NO live bug: detectCharacters escapes regex specials + word-bounds each name
// with \b...\b (so "scarletina" never matches "scarlet", and the collision-heavy
// bare "mark" alias was already removed — only "mark rober"/"mr rober" remain),
// and build's empty-scene guard + override precedence are correct. This is a
// verifier-layer LOCK of that contract, not a fix.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, 'index.html'), 'utf8');

// --- Extract the live QSSArt IIFE verbatim from the shipped HTML ---
function extractQSSArt(html) {
  const s = html.indexOf('const QSSArt = (function() {');
  if (s < 0) throw new Error('QSSArt IIFE not found in index.html');
  const braceStart = html.indexOf('{', s);
  let depth = 0, end = -1;
  for (let i = braceStart; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) throw new Error('unbalanced QSSArt IIFE');
  const stmt = html.slice(s, end + 1) + ')();'; // re-close the IIFE invocation
  return new Function(stmt + '\nreturn QSSArt;')();
}

const QSSArt = extractQSSArt(HTML);

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond) {
  if (cond) { passed++; }
  else { failed++; fails.push(name); console.error('  ✗ ' + name); }
}
const keys = (t) => QSSArt.detectCharacters(t).map(c => c.key);

// ===================================================================
// RED PROOFS — reconstruct broken variants, prove they'd misbehave,
// and prove the shipped code does not.
// ===================================================================

// (1) A word-boundary-LESS detector (substring includes) would false-fire
//     "scarlet" inside "scarletina". The shipped \b-bounded detector does not.
function detectSubstring(text) {
  const t = String(text || '').toLowerCase();
  const hits = [];
  for (const [key, entry] of Object.entries(QSSArt.LOOKBOOK)) {
    const names = [key, ...(entry.aliases || []), entry.name];
    for (const n of names) {
      if (t.includes(String(n).toLowerCase())) { hits.push(key); break; }
    }
  }
  return hits;
}
ok('RED-proof: substring detector false-fires "scarletina" -> queen scarlet',
   detectSubstring('the scarletina flower').includes('queen scarlet'));
ok('RED-proof: shipped detector does NOT match "scarletina"',
   !keys('the scarletina flower').includes('queen scarlet'));

// (2) If a bare "mark" alias were (re)added, "question mark" would summon
//     Mark Rober. The shipped LOOKBOOK has no bare "mark" — only "mark rober"
//     / "mr rober" — so it does not.
ok('RED-proof context: LOOKBOOK has no bare "mark" alias',
   !(QSSArt.LOOKBOOK['mark rober'].aliases || []).includes('mark'));
ok('shipped: "a big question mark" does NOT summon Mark Rober',
   keys('a big question mark').length === 0);

// ===================================================================
// detectCharacters — positive detection
// ===================================================================
ok('detect Kevin', keys('Kevin ran fast').includes('kevin'));
ok('detect Benny (full name)', keys('benny the prepared beaver waddled').includes('benny'));
ok('detect Benny (bare key)', keys('then Benny spoke').includes('benny'));
ok('detect Queen Scarlet (full name)', keys('Queen Scarlet swooped').includes('queen scarlet'));
ok('detect Queen Scarlet (the deliberate "scarlet" alias)', keys('Scarlet roared').includes('queen scarlet'));
ok('detect Mark Rober (full name)', keys('Mark Rober built a trap').includes('mark rober'));
ok('detect Mark Rober ("mr rober" alias)', keys('then Mr Rober grinned').includes('mark rober'));
ok('detect Principal Gerald', keys('Principal Gerald sighed').includes('principal gerald'));
ok('detect Lunch Lady', keys('the lunch lady ladled soup').includes('lunch lady'));
ok('case-insensitive', keys('KEVIN AND BENNY').sort().join(',') === 'benny,kevin');

// ===================================================================
// detectCharacters — word-boundary regression guards (the bug class)
// ===================================================================
ok('"scarletina" does not match', keys('the scarletina bloom').length === 0);
ok('"question mark" does not summon Mark Rober', keys('a question mark').length === 0);
ok('"exclamation mark" does not summon Mark Rober', keys('an exclamation mark!').length === 0);
ok('"on your mark" does not summon Mark Rober', keys('on your mark, get set').length === 0);
ok('"Denmark" does not summon Mark Rober', keys('they sailed to Denmark').length === 0);
ok('"marker" does not summon Mark Rober', keys('a red marker pen').length === 0);
ok('"kevinish" does not match Kevin', keys('a kevinish vibe').length === 0);

// ===================================================================
// detectCharacters — dedup, empty, structure
// ===================================================================
ok('dedup: "Queen Scarlet" + "scarlet" -> ONE queen scarlet hit',
   keys('Queen Scarlet and her scarlet scales').filter(k => k === 'queen scarlet').length === 1);
ok('empty text -> []', keys('').length === 0);
ok('null text -> []', QSSArt.detectCharacters(null).length === 0);
ok('undefined text -> []', QSSArt.detectCharacters(undefined).length === 0);
ok('no characters -> []', keys('a quiet empty hallway').length === 0);
ok('hit carries the lookbook entry (name + signature)', (() => {
  const h = QSSArt.detectCharacters('Kevin ran')[0];
  return h && h.key === 'kevin' && h.name === 'Kevin' && typeof h.signature === 'string' && h.signature.length > 0;
})());
ok('multiple distinct characters detected', (() => {
  const k = keys('Kevin and Queen Scarlet faced Principal Gerald').sort();
  return k.join(',') === 'kevin,principal gerald,queen scarlet';
})());

// ===================================================================
// build — prompt assembly contract
// ===================================================================
const STYLE_MARK = 'Hand-drawn children\'s storybook illustration';

ok('build: always includes the STYLE preface', QSSArt.build({ sceneText: 'Kevin ran' }).includes(STYLE_MARK));
ok('build: square 1:1 (the live register, NOT the mirror\'s 16:9)',
   QSSArt.build({ sceneText: 'x' }).includes('1:1 aspect ratio') && !QSSArt.build({ sceneText: 'x' }).includes('16:9'));

ok('build: detected character listed in the character block', (() => {
  const p = QSSArt.build({ sceneText: 'Kevin ran into class' });
  return p.includes('match the portraits') && /- Kevin:/.test(p);
})());

ok('build: no character -> ordinary-people fallback', (() => {
  const p = QSSArt.build({ sceneText: 'a quiet empty hallway at dawn' });
  return p.includes('ordinary-looking kids and grown-ups') && !p.includes('match the portraits');
})());

ok('build: characterOverrides[key] WINS over canonical signature', (() => {
  const p = QSSArt.build({ sceneText: 'Kevin ran', characterOverrides: { kevin: 'a boy in a SILVER spacesuit' } });
  return p.includes('a boy in a SILVER spacesuit') && !/- Kevin: a school-age boy whose head/.test(p);
})());

ok('build: characterOverrides keyed by lowercased NAME also wins', (() => {
  const p = QSSArt.build({ sceneText: 'Kevin ran', characterOverrides: { 'kevin': 'OVERRIDE-A' } });
  return p.includes('OVERRIDE-A');
})());

ok('build: empty scene -> establishing-shot guard, NOT an empty quoted block', (() => {
  const p = QSSArt.build({ sceneText: '' });
  return p.includes('inviting establishing shot') && !p.includes('""');
})());

ok('build: whitespace-only scene -> establishing-shot guard', (() => {
  const p = QSSArt.build({ sceneText: '   \n  ' });
  return p.includes('inviting establishing shot');
})());

ok('build: scene text is quoted for a real passage', (() => {
  const p = QSSArt.build({ sceneText: 'Kevin opened the door slowly.' });
  return p.includes('"Kevin opened the door slowly."');
})());

ok('build: scene text sliced to 800 chars in the quoted block', (() => {
  const long = 'Kevin ' + 'z'.repeat(2000);
  const p = QSSArt.build({ sceneText: long });
  // the quoted scene segment must not carry the full 2006-char string
  const m = p.match(/passage[^"]*"([\s\S]*?)"/);
  return m && m[1].length <= 800;
})());

ok('build: variation=true adds the fresh-take line',
   QSSArt.build({ sceneText: 'Kevin ran', variation: true }).includes('fresh take'));
ok('build: variation=false omits the fresh-take line',
   !QSSArt.build({ sceneText: 'Kevin ran', variation: false }).includes('fresh take'));

ok('build: extra direction appended',
   QSSArt.build({ sceneText: 'Kevin ran', extra: 'make it rain' }).includes('Additional direction: make it rain'));
ok('build: no extra -> no Additional-direction line',
   !QSSArt.build({ sceneText: 'Kevin ran' }).includes('Additional direction:'));

ok('build: composition rules always present (no comic panels / no text)', (() => {
  const p = QSSArt.build({ sceneText: 'Kevin ran' });
  return p.includes('No comic panels') && p.includes('no visible text');
})());

ok('build: no-args call does not throw and returns a non-empty prompt', (() => {
  const p = QSSArt.build();
  return typeof p === 'string' && p.includes(STYLE_MARK) && p.includes('inviting establishing shot');
})());

console.log(`\nqss-art (live QSSArt): ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('FAILED: ' + fails.join(' | ')); process.exit(1); }
