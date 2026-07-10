// chip-escape.test.mjs
//
// Locks a real render/injection fix in The Commentbank (commentbank/index.html — Johnny's live
// YouTube-comment tool). `comments.json` carries per-comment `analysis.themes[]` and
// `analysis.sentiment`, both LLM-GENERATED from external YouTube comment text (no client-side
// sanitization; see load()). Every OTHER place those strings hit innerHTML runs them through
// escapeHtml (the "ask" cards, the stylize meta — `escapeHtml(t)`), but THREE sinks rendered them
// RAW:
//   - the theme-filter chip:      `${theme}<span class="ct">…`      (renderChips)
//   - the gallery card corner:    `● ${sent}</div>`                 (render)
//   - the browse-row sentiment:   `<span class="sentiment">${sent}` (chrono render)
// A theme/sentiment label containing '<' (a comment that discusses code, or a prompt-injected model
// reply) therefore broke the chip layout or injected markup into Johnny's tool. Same divergent
// escape-here-but-not-there class the loop has closed repeatedly. FIX: wrap all three in the same
// hoisted escapeHtml the rest of the file already uses. Byte-identical for every clean label.
//
// This test (1) proves escapeHtml actually neutralizes a hostile theme/sentiment payload, and
// (2) SOURCE-locks the three render sites to interpolate escapeHtml(...) rather than the raw field —
// so reverting any one of them goes RED. escapeHtml is extracted from the shipped HTML at runtime
// (no hand-copied mirror), so the behavioral lock can't drift from the live tool.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }

// --- quote/comment/regex-aware balanced brace matcher (escapeHtml holds a /[&<>"']/ regex whose
//     quote chars would fool a naive string-only matcher) ---
function sliceBalanced(src, fromIdx, open, close) {
  let depth = 0, i = fromIdx;
  const isRegexStart = (j) => {
    let k = j - 1;
    while (k >= 0 && /\s/.test(src[k])) k--;
    return k < 0 || '(,=:[!&|?{};+-*%~^<>'.includes(src[k]) || /[a-z]/.test(src[k]) === false;
  };
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { const q = c; i++; for (; i < src.length; i++) { if (src[i] === '\\') { i++; continue; } if (src[i] === q) break; } continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }
    if (c === '/' && isRegexStart(i)) { i++; let inClass = false; for (; i < src.length; i++) { if (src[i] === '\\') { i++; continue; } if (src[i] === '[') inClass = true; else if (src[i] === ']') inClass = false; else if (src[i] === '/' && !inClass) break; } continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(fromIdx, i + 1); }
  }
  throw new Error('unbalanced');
}
function extractFnSource(name) {
  const m = HTML.match(new RegExp(`function\\s+${name}\\s*\\(`));
  if (!m) throw new Error(`function ${name} not found`);
  const braceAt = HTML.indexOf('{', m.index);
  const body = sliceBalanced(HTML, braceAt, '{', '}');
  return `function ${name}${HTML.slice(m.index + `function ${name}`.length, braceAt)}${body}`;
}

// === behavioral: the real shipped escapeHtml neutralizes a hostile label ===
const escapeHtml = new Function(`${extractFnSource('escapeHtml')}\nreturn escapeHtml;`)();
ok(typeof escapeHtml === 'function', 'extracted escapeHtml callable');

const HOSTILE = '<img src=x onerror=alert(1)>';               // a theme/sentiment a comment could induce
const escaped = escapeHtml(HOSTILE);
ok(!/<img/i.test(escaped), 'escapeHtml removes the raw <img tag from a hostile label');
ok(escaped.includes('&lt;img') && escaped.includes('&gt;'), 'escapeHtml encodes the angle brackets');
ok(escapeHtml('war & peace') === 'war &amp; peace', 'escapeHtml encodes &');
ok(escapeHtml('china–taiwan tensions') === 'china–taiwan tensions', 'escapeHtml is byte-identical on a clean label');

// === source lock: the three model-derived render sites must go through escapeHtml, not raw ===
// (1) theme-filter chip
ok(HTML.includes('chip.innerHTML = `${escapeHtml(theme)}<span class="ct">'),
   'theme-filter chip escapes the LLM theme label');
ok(!/chip\.innerHTML = `\$\{theme\}<span class="ct">/.test(HTML),
   'theme-filter chip no longer interpolates the raw theme');
// (2) gallery card sentiment corner
ok(HTML.includes('<span class="accent">●</span> ${escapeHtml(sent)}</div>'),
   'gallery card corner escapes the sentiment label');
ok(!/<span class="accent">●<\/span> \$\{sent\}<\/div>/.test(HTML),
   'gallery card corner no longer interpolates the raw sentiment');
// (3) browse-row sentiment
ok(HTML.includes('<span class="sentiment">${escapeHtml(sent)}</span>'),
   'browse-row escapes the sentiment label');
ok(!/<span class="sentiment">\$\{sent\}<\/span>/.test(HTML),
   'browse-row no longer interpolates the raw sentiment');

// === mutation-proof: the source detectors are load-bearing (they'd catch a revert) ===
// Reconstruct the OLD raw forms and assert each positive detector FAILS on them — so a revert is RED.
const revertedTheme = HTML.replace('${escapeHtml(theme)}<span class="ct">', '${theme}<span class="ct">');
ok(!revertedTheme.includes('${escapeHtml(theme)}<span class="ct">'),
   'RED-proof: reverting the theme escape is detectable');
const revertedCorner = HTML.replace('<span class="accent">●</span> ${escapeHtml(sent)}</div>',
                                    '<span class="accent">●</span> ${sent}</div>');
ok(!revertedCorner.includes('${escapeHtml(sent)}</div>'),
   'RED-proof: reverting the card-corner escape is detectable');

if (fail) { console.error(`chip-escape: ${pass} passed, ${fail} failed`); for (const f of fails) console.error('  ✗ ' + f); process.exit(1); }
console.log(`chip-escape: ${pass} passed, 0 failed`);
