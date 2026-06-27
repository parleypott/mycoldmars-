// Locks cutter's renderScript HTML boundary: every interpolated field of a
// script segment (timestamp_start, timestamp_end, words, visual) comes from the
// SAME untrusted source — the Gemini analysis JSON, which api/cutter.js returns
// to the client with NO sanitisation (JSON.parse(raw) -> res.json) — so every
// one must be esc()'d before landing in innerHTML.
//
// The bug this caught: words/visual were esc()'d but timestamp_start/_end were
// interpolated RAW, so an HTML-bearing timestamp in the model response (LLM
// output is induceable / hallucinable) injected a live element into the DOM.
//
// The test EXTRACTS the real shipped esc + buildScriptRowHtml from cutter/index.html
// at runtime (brace-match + new Function, esc bound into buildScriptRowHtml's
// scope) so it can't drift from a mirror.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, 'index.html'), 'utf8');

// --- extract a `function NAME(...) { ... }` body by brace-matching from source ---
function extractFn(src, decl) {
  const start = src.indexOf(decl);
  assert.notStrictEqual(start, -1, `could not find ${decl}`);
  let i = src.indexOf('{', start);
  let depth = 0, end = -1;
  let inStr = null, esc = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  assert.notStrictEqual(end, -1, `unbalanced braces for ${decl}`);
  return src.slice(start, end + 1);
}

const escSrc = extractFn(html, 'function esc(str)');
const rowSrc = extractFn(html, 'function buildScriptRowHtml(seg)');

const esc = new Function(`${escSrc}; return esc;`)();
// buildScriptRowHtml references the sibling esc — bind it into scope.
const buildScriptRowHtml = new Function('esc', `${rowSrc}; return buildScriptRowHtml;`)(esc);

// Reconstruct the OLD (buggy) row builder: timestamps interpolated RAW.
function oldBuildRow(seg) {
  const isNoDialogue = /^\[(no dialogue|music|ambient)/i.test(seg.words?.trim() || '');
  return `
        <td class="ts">${seg.timestamp_start || ''}${seg.timestamp_end ? '–' + seg.timestamp_end : ''}</td>
        <td class="words${isNoDialogue ? ' no-dialogue' : ''}">${esc(seg.words || '')}</td>
        <td class="visual-desc">${esc(seg.visual || '')}</td>
      `;
}

const XSS_TS = '<img src=x onerror=alert(1)>';
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  RED:', name); } }

// ── RED proof: the old builder leaks a live tag through a malicious timestamp;
//    the shipped builder escapes it. ─────────────────────────────────────────
ok('RED-proof: OLD builder leaks raw <img in timestamp_start',
  oldBuildRow({ timestamp_start: XSS_TS, words: 'hi', visual: 'v' }).includes('<img src=x'));
ok('RED-proof: OLD builder leaks raw <img in timestamp_end',
  oldBuildRow({ timestamp_start: '0:00', timestamp_end: XSS_TS, words: 'hi', visual: 'v' }).includes('<img src=x'));
ok('FIX: shipped builder escapes <img in timestamp_start (no live tag)',
  !buildScriptRowHtml({ timestamp_start: XSS_TS, words: 'hi', visual: 'v' }).includes('<img src=x'));
ok('FIX: shipped builder escapes <img in timestamp_end (no live tag)',
  !buildScriptRowHtml({ timestamp_start: '0:00', timestamp_end: XSS_TS, words: 'hi', visual: 'v' }).includes('<img src=x'));

// ── esc unit ─────────────────────────────────────────────────────────────────
ok('esc escapes &', esc('a&b') === 'a&amp;b');
ok('esc escapes <', esc('a<b') === 'a&lt;b');
ok('esc escapes >', esc('a>b') === 'a&gt;b');
ok('esc ampersand-first (no double-escape)', esc('&lt;') === '&amp;lt;');
ok('esc plain passthrough', esc('5:30') === '5:30');

// ── escaped timestamps: every dangerous char neutralised, in BOTH fields ──────
const both = buildScriptRowHtml({ timestamp_start: '<x>&', timestamp_end: '<y>&', words: 'w', visual: 'v' });
ok('timestamp_start < escaped', both.includes('&lt;x&gt;&amp;'));
ok('timestamp_end < escaped', both.includes('&lt;y&gt;&amp;'));
ok('no raw < survives anywhere except the structural <td> tags',
  // strip the known structural tags, then assert no stray < remains
  both.replace(/<\/?td[^>]*>/g, '').indexOf('<') === -1);

// ── words / visual still escaped (no regression) ──────────────────────────────
const wv = buildScriptRowHtml({ timestamp_start: '0:00', words: '<b>w</b>', visual: '<i>v</i>' });
ok('words still escaped', wv.includes('&lt;b&gt;w&lt;/b&gt;') && !wv.includes('<b>w'));
ok('visual still escaped', wv.includes('&lt;i&gt;v&lt;/i&gt;') && !wv.includes('<i>v'));

// ── benign timecodes render unchanged (no double-escape, no mangling) ─────────
const benign = buildScriptRowHtml({ timestamp_start: '0:00', timestamp_end: '0:30', words: 'hello', visual: 'wide' });
ok('benign timestamp_start present verbatim', benign.includes('>0:00–0:30<') || benign.includes('0:00–0:30'));
ok('benign en-dash separator present', benign.includes('–'));
ok('benign words verbatim', benign.includes('>hello<') || benign.includes('hello'));
ok('benign visual verbatim', benign.includes('wide'));
ok('no HTML entities in fully-benign row', !/&(amp|lt|gt);/.test(benign));

// ── structure preserved: 3 cells, no-dialogue class, separators ───────────────
ok('three <td> cells', (benign.match(/<td/g) || []).length === 3);
ok('ts cell class', benign.includes('class="ts"'));
ok('words cell class', benign.includes('class="words"') || benign.includes('class="words '));
ok('visual cell class', benign.includes('class="visual-desc"'));

const noDlg = buildScriptRowHtml({ timestamp_start: '1:00', words: '[no dialogue]', visual: 'b-roll' });
ok('no-dialogue class added for [no dialogue]', noDlg.includes('no-dialogue'));
ok('no-dialogue class added for [music]', buildScriptRowHtml({ words: '[music swells]' }).includes('no-dialogue'));
ok('no-dialogue class NOT added for ordinary words', !buildScriptRowHtml({ words: 'she said' }).includes('no-dialogue'));

// ── missing / empty fields → empty cells, no "undefined", no throw ────────────
const empty = buildScriptRowHtml({});
ok('missing fields → no "undefined" string', !empty.includes('undefined'));
ok('missing timestamp_end → no leading en-dash', !empty.includes('>–'));
ok('missing fields → still 3 cells', (empty.match(/<td/g) || []).length === 3);
const onlyStart = buildScriptRowHtml({ timestamp_start: '0:00' });
ok('timestamp_start without _end → no trailing en-dash', !onlyStart.includes('0:00–'));

// ── equivalence: for benign (no-HTML) input, new === old (only escaping changed) ─
for (const seg of [
  { timestamp_start: '0:00', timestamp_end: '0:30', words: 'a', visual: 'b' },
  { timestamp_start: '1:05', words: 'lone start', visual: '' },
  { words: 'no timestamps', visual: 'v' },
  { timestamp_start: '2:00', timestamp_end: '2:45', words: '[music]', visual: 'wide shot' },
]) {
  ok(`equivalence (benign) ts=${seg.timestamp_start}`, buildScriptRowHtml(seg) === oldBuildRow(seg));
}

// ── non-string fields (numeric Gemini JSON) must not crash the render ─────────
// The analysis JSON is unsanitised and an LLM readily emits a NUMBER where a string
// is expected — timestamps especially ("timestamp_end": 90). The OLD esc did a bare
// `str.replace(...)` and the OLD row did `seg.words?.trim()`; both THROW on a number,
// and a single throw aborts the whole renderScript loop → a blank script panel
// (cutter's primary output). The shipped code now coerces with String().
const oldEsc = new Function('return function esc(str){ return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }')();
ok('RED-proof: OLD esc throws on a numeric field',
  (() => { try { oldEsc(90); return false; } catch (e) { return /replace is not a function/.test(e.message); } })());
ok('RED-proof: OLD row builder throws on numeric words (seg.words?.trim())',
  (() => { try { oldBuildRow({ timestamp_start: '0:00', words: 5, visual: 'v' }); return false; } catch { return true; } })());
ok('FIX: shipped esc coerces a number instead of throwing', esc(90) === '90');
ok('FIX: shipped row survives numeric timestamp_end (renders –90)',
  (() => { try { return buildScriptRowHtml({ timestamp_start: '0:00', timestamp_end: 90, words: 'hi', visual: 'v' }).includes('–90'); } catch { return false; } })());
ok('FIX: shipped row survives numeric timestamp_start (renders 12)',
  (() => { try { return buildScriptRowHtml({ timestamp_start: 12, words: 'hi', visual: 'v' }).includes('12'); } catch { return false; } })());
ok('FIX: shipped row survives numeric words (no throw)',
  (() => { try { buildScriptRowHtml({ timestamp_start: '0:00', words: 5, visual: 'v' }); return true; } catch { return false; } })());

// ── truthy-zero trap: a numeric 0 start (first segment of numeric-seconds JSON) ─
// must RENDER as "0", not get blanked by `0 || ''`. The buggy `|| ''` form drops
// the opening segment's start while every later segment (12, 90 above) shows its
// number — a silent, segment-1-only loss. JSON.parse can't produce NaN, so 0 is
// the only reachable falsy-non-null timestamp; this asserts the `?? ''` fix.
ok('RED-proof: OLD `|| \'\'` start-builder blanks a numeric 0 start',
  oldBuildRow({ timestamp_start: 0, words: 'hi', visual: 'v' }).includes('<td class="ts"></td>'));
ok('FIX: shipped row renders a numeric 0 start as "0" (not blank)',
  buildScriptRowHtml({ timestamp_start: 0, words: 'hi', visual: 'v' }).includes('>0<'));
ok('FIX: numeric 0 start + numeric end both render (0–90, opening segment intact)',
  buildScriptRowHtml({ timestamp_start: 0, timestamp_end: 90, words: 'hi', visual: 'v' }).includes('0–90'));
ok('no-regression: empty-string start still → empty ts cell',
  buildScriptRowHtml({ timestamp_start: '', words: 'hi', visual: 'v' }).includes('<td class="ts"></td>'));
ok('no-regression: missing start still → empty ts cell',
  buildScriptRowHtml({ words: 'hi', visual: 'v' }).includes('<td class="ts"></td>'));
ok('FIX: numeric/zero words does not falsely trigger no-dialogue',
  !buildScriptRowHtml({ words: 0, visual: 'v' }).includes('no-dialogue'));
ok('FIX: a non-string visual is still HTML-escaped, not crashed',
  (() => { const out = buildScriptRowHtml({ words: 'w', visual: 5 }); return out.includes('5'); })());

console.log(`script-row.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
