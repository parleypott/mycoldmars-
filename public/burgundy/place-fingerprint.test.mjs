// Locks the place-memory FINGERPRINT-FALLBACK core of the BERGUNDY reader
// (public/burgundy/index.html): placeParts(), placeValueFor(), resolvePlace().
// Extracted from the shipped HTML at runtime so a drift in index.html breaks
// this test.
//
// WHY THIS IS LOAD-BEARING (commit 9b9d89c): the author republishes book.json
// several times a day. A saved reading place used to be a bare "ci:pi" key
// (chapter:paragraph index) — but a republish that edits/reorders chapters
// SHIFTS that numbering, so the key goes stale and the reader loses its spot in
// Johnny's own novel every time he reopens it. The fix stores the place as
// "ci:pi|first-40-chars-of-the-paragraph": the key finds the paragraph fast,
// and the text fingerprint RE-FINDS it by content when the key has drifted.
// No bug was found in the shipped code — this pins its contract so a future
// edit can't silently reintroduce the place-drift it was built to cure.
//
// Contract locked here:
//  - placeParts: null-safe; splits on the FIRST '|' only (key never contains
//    '|', so a fingerprint carrying its own '|' round-trips intact); an old
//    fingerprint-less "ci:pi" value still yields {key, fp:''}.
//  - placeValueFor: "key|first40chars", round-trips through placeParts.
//  - resolvePlace: (a) resolves by key on the happy path; (b) a STALE key
//    re-finds the right paragraph by fingerprint; (c) a vanished key still
//    resolves by fingerprint; (d) — the subtle one — when the key resolves but
//    the paragraph's opening was EDITED (fingerprint matches nothing), it
//    PRESERVES the key match instead of nulling it (`if (hit) p = hit`);
//    (e) whitespace differences between capture and republish are tolerated
//    (both sides normalized).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');

// placeParts + placeValueFor are one-liners — grab the whole line.
const mParts = html.match(/^function placeParts\(v\).*$/m);
const mValue = html.match(/^function placeValueFor\(p\).*$/m);
const mResolve = html.match(/function resolvePlace\(v\)\s*\{[\s\S]*?\n\}/);
assert.ok(mParts, 'could not extract placeParts() — did the signature change?');
assert.ok(mValue, 'could not extract placeValueFor() — did the signature change?');
assert.ok(mResolve, 'could not extract resolvePlace() — did the signature change?');

const placeParts = (0, eval)('(' + mParts[0].replace(/^function placeParts/, 'function') + ')');
const placeValueFor = (0, eval)('(' + mValue[0].replace(/^function placeValueFor/, 'function') + ')');
// resolvePlace references placeParts, document, CSS as free (global) vars.
globalThis.placeParts = placeParts;
globalThis.CSS = { escape: s => s };
const resolvePlace = (0, eval)('(' + mResolve[0] + ')');

// --- mock DOM ------------------------------------------------------------
const mkPara = (key, text) => ({ dataset: { key }, textContent: text });
function setDoc(paras) {
  globalThis.document = {
    querySelector(sel) {
      const m = sel.match(/data-key="([^"]*)"/);
      const want = m ? m[1] : null;
      return paras.find(p => p.dataset.key === want) || null;
    },
    querySelectorAll() { return paras.slice(); },
  };
}

// --- pre-9b9d89c buggy reconstructions, to PROVE the test is load-bearing ---
// (a) key-only resolution — the behavior BEFORE the fingerprint fallback.
function keyOnlyResolve(v) {
  const { key } = placeParts(v);
  return key ? document.querySelector(`p[data-key="${key}"]`) : null;
}
// (b) unguarded-hit resolution — resolvePlace WITHOUT the `if (hit) p = hit`
// guard, i.e. it overwrites the key match with the (possibly null) search
// result. This is the plausible-but-wrong refactor the guard defends against.
function unguardedResolve(v) {
  const { key, fp } = placeParts(v);
  let p = key ? document.querySelector(`p[data-key="${key}"]`) : null;
  if (fp) {
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    const want = norm(fp);
    if (want && (!p || !norm(p.textContent).startsWith(want))) {
      p = [...document.querySelectorAll('.chapter p[data-key]')].find(x => norm(x.textContent).startsWith(want)) || null;
    }
  }
  return p;
}

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); pass++; };

// ============ placeParts ============
{
  eq(JSON.stringify(placeParts(null)), JSON.stringify({ key: '', fp: '' }), 'null → empty key + empty fp');
  eq(JSON.stringify(placeParts('')), JSON.stringify({ key: '', fp: '' }), 'empty string → empty key + empty fp');
  eq(JSON.stringify(placeParts('2:0')), JSON.stringify({ key: '2:0', fp: '' }), 'legacy fingerprint-less value → key only');
  eq(JSON.stringify(placeParts('12:7|The dawn came')), JSON.stringify({ key: '12:7', fp: 'The dawn came' }), 'key|fp splits');
  // fingerprint text that itself contains a '|' must survive — split on FIRST '|' only.
  eq(placeParts('3:4|a | b | c').fp, 'a | b | c', 'fingerprint keeps its own pipes (split on first | only)');
  eq(placeParts('3:4|a | b | c').key, '3:4', 'key is clean even when fingerprint has pipes');
}

// ============ placeValueFor + round-trip ============
{
  const short = mkPara('2:0', 'Short opening.');
  eq(placeValueFor(short), '2:0|Short opening.', 'value = key|text for a short paragraph');
  eq(placeParts(placeValueFor(short)).key, '2:0', 'round-trip preserves key');
  eq(placeParts(placeValueFor(short)).fp, 'Short opening.', 'round-trip preserves fingerprint');

  const long = mkPara('5:9', 'x'.repeat(80));
  eq(placeValueFor(long), '5:9|' + 'x'.repeat(40), 'fingerprint is capped at 40 chars');
}

// ============ resolvePlace ============

// (1) Happy path: key resolves and text matches.
{
  const p = mkPara('2:0', 'Chapter two opens on the frost.');
  setDoc([p]);
  const v = placeValueFor(p);
  ok(resolvePlace(v) === p, 'happy path: resolves to the key-matched paragraph');
}

// (2) STALE key after republish — the whole point. The key "3:5" now points to
// a DIFFERENT paragraph; the original text lives at "2:8". Fingerprint re-finds it.
{
  const wrong = mkPara('3:5', 'Some other paragraph entirely, unrelated.');
  const right = mkPara('2:8', 'The dawn came grey over the harbour and the gulls woke.');
  setDoc([wrong, right]);
  // saved BEFORE the republish: stale key 3:5, but fingerprint of the real text.
  const v = '3:5|The dawn came grey over the harbour a';
  ok(resolvePlace(v) === right, 'stale key: fingerprint re-finds the correct paragraph');
  // load-bearing: the pre-fix key-only behavior returns the WRONG paragraph.
  ok(keyOnlyResolve(v) === wrong, 'PROOF: key-only (pre-fix) mis-resolves to the shifted paragraph');
  ok(resolvePlace(v) !== keyOnlyResolve(v), 'fingerprint fallback diverges from the buggy key-only form');
}

// (3) Key vanished entirely — fingerprint still finds it.
{
  const right = mkPara('2:8', 'The dawn came grey over the harbour and the gulls woke.');
  setDoc([right]);
  const v = '9:9|The dawn came grey over the harbour a'; // key 9:9 no longer exists
  ok(resolvePlace(v) === right, 'vanished key: fingerprint resolves it anyway');
  ok(keyOnlyResolve(v) === null, 'PROOF: key-only returns nothing for a vanished key');
}

// (4) THE SUBTLE ONE: key resolves, but the paragraph opening was EDITED so the
// fingerprint matches NOTHING. resolvePlace must PRESERVE the key match, not null it.
{
  const edited = mkPara('2:0', 'A wholly rewritten opening sentence now stands here.');
  setDoc([edited]);
  const v = '2:0|The old opening that no longer exists'; // fingerprint of the pre-edit text
  ok(resolvePlace(v) === edited, 'edited opening: keeps the key match when the fingerprint finds nothing');
  // load-bearing: dropping the `if (hit) p = hit` guard nulls the place here.
  ok(unguardedResolve(v) === null, 'PROOF: unguarded overwrite loses the key match (scrolls to page 0)');
  ok(resolvePlace(v) !== unguardedResolve(v), 'the guard diverges from the unguarded form');
}

// (5) Legacy fingerprint-less value still resolves by key.
{
  const p = mkPara('2:0', 'Chapter two opens on the frost.');
  setDoc([p]);
  ok(resolvePlace('2:0') === p, 'legacy bare-key value still resolves');
}

// (6) Whitespace tolerance: fingerprint captured with messy whitespace matches a
// republished paragraph with collapsed whitespace (both sides normalized).
{
  const republished = mkPara('4:1', 'The dawn came grey over the harbour and beyond.');
  setDoc([republished]);
  const v = '7:2|The  dawn\n came grey over the harbour'; // stale key + messy fp
  ok(resolvePlace(v) === republished, 'whitespace differences between capture and republish are tolerated');
}

// (7) No match anywhere and no key → null (title page never overwrites a place).
{
  setDoc([mkPara('1:0', 'Nothing like the fingerprint here.')]);
  ok(resolvePlace('') === null, 'empty value resolves to null');
  ok(resolvePlace('') !== undefined ? resolvePlace('') === null : true, 'empty value is a clean null');
}

console.log(`place-fingerprint.test.mjs: ${pass} assertions passed`);
