// Tests for buildGeminiChatContents — the shared Gemini `contents` builder that
// guarantees a multi-turn request begins with a `user` turn (Gemini rejects a
// leading `model` turn). Consolidates the previously-divergent inline copies in
// cutter.js (window 12) and gemini.js handleChat + handleScriptChat (window 10).
//
// Run: node api/_lib/gemini-chat-contents.test.mjs  (or `bun run test`)
import { buildGeminiChatContents, buildGeminiHistoryContents } from './gemini-chat-contents.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let pass = 0, fail = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); } }

// ---- inline RED proof: the OLD inline gemini.js logic leads with a model turn ----
function oldGeminiContents(history, message) {
  const historyParts = (history || []).slice(-10).map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));
  return [...historyParts, { role: 'user', parts: [{ text: message }] }];
}
const seeded = [
  { role: 'assistant', content: 'Hi! I am Hunter.' },
  { role: 'user', content: 'what river clips?' },
  { role: 'assistant', content: 'You have 3.' },
];
ok('RED proof: old gemini logic leads with model turn',
  oldGeminiContents(seeded, 'next').at(0).role === 'model');
ok('FIX: shared builder leads with user turn on the same seeded history',
  buildGeminiChatContents(seeded, 'next', { window: 10 }).at(0).role === 'user');

// ---- head-is-user invariant across many shapes ----
const shapes = [
  [],
  [{ role: 'assistant', content: 'greeting' }],
  [{ role: 'assistant', content: 'a' }, { role: 'user', content: 'b' }],
  [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }],
  seeded,
  Array.from({ length: 20 }, (_, i) => ({ role: i % 2 === 0 ? 'assistant' : 'user', content: 'm' + i })),
];
for (let i = 0; i < shapes.length; i++) {
  const c = buildGeminiChatContents(shapes[i], 'NEW', { window: 10 });
  ok('shape ' + i + ': non-empty', c.length >= 1);
  ok('shape ' + i + ': head is user', c[0].role === 'user');
  ok('shape ' + i + ': last turn is the new message', eq(c.at(-1), { role: 'user', parts: [{ text: 'NEW' }] }));
}

// ---- all-model window collapses to just the new message ----
ok('all-model window collapses to single user turn',
  eq(buildGeminiChatContents(
    [{ role: 'assistant', content: 'x' }, { role: 'assistant', content: 'y' }], 'Q', { window: 10 }),
    [{ role: 'user', parts: [{ text: 'Q' }] }]));

// ---- clean alternating history starting from user is preserved verbatim ----
const clean = [
  { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' },
  { role: 'user', content: 'q2' }, { role: 'assistant', content: 'a2' },
];
ok('clean user-first history preserved + new message appended',
  eq(buildGeminiChatContents(clean, 'q3', { window: 10 }), [
    { role: 'user', parts: [{ text: 'q1' }] },
    { role: 'model', parts: [{ text: 'a1' }] },
    { role: 'user', parts: [{ text: 'q2' }] },
    { role: 'model', parts: [{ text: 'a2' }] },
    { role: 'user', parts: [{ text: 'q3' }] },
  ]));

// ---- role mapping: only 'user' → user, everything else → model ----
ok('role mapping user→user / assistant→model / system→model',
  eq(buildGeminiChatContents([
    { role: 'user', content: 'u' }, { role: 'assistant', content: 'a' }, { role: 'system', content: 's' },
  ], 'm', { window: 10 }).map(t => t.role), ['user', 'model', 'model', 'user']));

// ---- window cap: window:10 keeps last 10, window:12 keeps last 12 ----
const long = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'm' + i }));
// 30 turns, indices 0..29. slice(-10) → indices 20..29 (20 is even=user). head should be user.
const w10 = buildGeminiChatContents(long, 'X', { window: 10 });
ok('window:10 keeps 10 history turns + new msg', w10.length === 11);
ok('window:10 first kept turn is m20', w10[0].parts[0].text === 'm20');
const w12 = buildGeminiChatContents(long, 'X', { window: 12 });
ok('window:12 keeps 12 history turns + new msg', w12.length === 13);
ok('window:12 first kept turn is m18', w12[0].parts[0].text === 'm18');

// ---- default window is 12 ----
ok('default window is 12',
  buildGeminiChatContents(long, 'X').length === 13);

// ---- robustness: non-array history → just the new message, no throw ----
for (const bad of [null, undefined, 'str', 42, {}]) {
  ok('non-array history (' + JSON.stringify(bad) + ') → single user turn',
    eq(buildGeminiChatContents(bad, 'Q', { window: 10 }), [{ role: 'user', parts: [{ text: 'Q' }] }]));
}

// ---- cutter delegation still works (window 12, head-is-user) ----
const { buildChatContents } = await import('./cutter-prompt.js');
ok('cutter buildChatContents delegates: leads with user on seeded history',
  buildChatContents(seeded, 'next').at(0).role === 'user');
ok('cutter buildChatContents uses window 12',
  buildChatContents(long, 'X').length === 13);

// ════════════════════════════════════════════════════════════════════════════
// buildGeminiHistoryContents — the history-only helper used by callers whose new
// user turn carries non-text parts (e.g. nano-banana attaches reference images).
// It must do the SAME leading-model-turn drop but NOT append a user turn.
// ════════════════════════════════════════════════════════════════════════════

// inline RED proof: the OLD inline nano-banana / walden map had NO drop, so a
// seeded (model-leading) history left contents[0] === 'model' → Gemini 400.
function oldInlineHistory(history) {
  return (history || []).map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: String(m.content || '') }],
  }));
}
ok('RED proof: old inline history map leads with a model turn',
  oldInlineHistory(seeded).at(0).role === 'model');
ok('FIX: buildGeminiHistoryContents drops the leading model turn',
  buildGeminiHistoryContents(seeded).at(0).role === 'user');

// history-only: never appends a user turn (the caller owns the final turn)
ok('history helper does not append a new user turn (clean alternating)',
  eq(buildGeminiHistoryContents(clean), [
    { role: 'user', parts: [{ text: 'q1' }] },
    { role: 'model', parts: [{ text: 'a1' }] },
    { role: 'user', parts: [{ text: 'q2' }] },
    { role: 'model', parts: [{ text: 'a2' }] },
  ]));
ok('history helper: all-model history collapses to []',
  eq(buildGeminiHistoryContents([{ role: 'assistant', content: 'x' }, { role: 'model', content: 'y' }]), []));
ok('history helper: empty / non-array → []',
  eq(buildGeminiHistoryContents([]), []) && eq(buildGeminiHistoryContents(null), []) && eq(buildGeminiHistoryContents('nope'), []));
// content coercion: null/undefined/number content never yields a non-string text part
ok('history helper: content coerced to string (null/number safe)',
  eq(buildGeminiHistoryContents([{ role: 'user', content: null }, { role: 'user', content: 42 }]),
     [{ role: 'user', parts: [{ text: '' }] }, { role: 'user', parts: [{ text: '42' }] }]));
// window default 12, override honored
ok('history helper: default window 12',
  buildGeminiHistoryContents(long).length <= 12 && buildGeminiHistoryContents(long).length >= 11);
ok('history helper: window override',
  buildGeminiHistoryContents(long, { window: 4 }).length <= 4);
// ---- window-cap guard: a bad window must NEVER return unbounded history ----
// RED proof: the old unguarded `slice(-window)` collapses to slice(0) for
// window 0 / NaN, returning the WHOLE 30-turn history instead of a capped slice.
function oldUnguardedHistory(history, window) {
  return (Array.isArray(history) ? history : []).slice(-window).map(m => ({
    role: m && m.role === 'user' ? 'user' : 'model',
    parts: [{ text: String(m && m.content != null ? m.content : '') }],
  }));
}
ok('RED proof: old unguarded window:0 returns the ENTIRE history',
  oldUnguardedHistory(long, 0).length === 30);
ok('RED proof: old unguarded window:NaN returns the ENTIRE history',
  oldUnguardedHistory(long, NaN).length === 30);
// FIX: every invalid window falls back to the default cap of 12 (never unbounded).
for (const badWindow of [0, -1, -10, NaN, Infinity, -Infinity, 2.5, null, 'big']) {
  const h = buildGeminiHistoryContents(long, { window: badWindow });
  ok('history helper: invalid window ' + JSON.stringify(badWindow) + ' caps at 12 (not unbounded)',
    h.length === 12);
  const c = buildGeminiChatContents(long, 'X', { window: badWindow });
  ok('chat builder: invalid window ' + JSON.stringify(badWindow) + ' caps at 12 history + new msg',
    c.length === 13);
}
// a valid small integer override is still honored exactly
ok('history helper: valid window:4 still keeps exactly 4 (guard does not over-cap)',
  buildGeminiHistoryContents(long, { window: 4 }).length === 4);

// buildGeminiChatContents is buildGeminiHistoryContents + one appended user turn
ok('chat builder = history helper + appended user turn',
  eq(buildGeminiChatContents(clean, 'q3', { window: 10 }),
     [...buildGeminiHistoryContents(clean, { window: 10 }), { role: 'user', parts: [{ text: 'q3' }] }]));

// ════════════════════════════════════════════════════════════════════════════
// SOURCE-BINDING — the consolidated Gemini call sites must import the shared
// builder and carry NO surviving inline `history.map(... parts:[{ text`
// contents copy. (The line-716 nano-banana CLAUDE messages map is a DIFFERENT,
// Anthropic-shaped builder — deliberately out of scope — so we assert on the
// Gemini `parts:[{ text` shape specifically. walden-design.js was also bound
// here until the walden app + its serverless surface were removed 2026-07-06.)
// ════════════════════════════════════════════════════════════════════════════
const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, '..');
const stripComments = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const nano = stripComments(readFileSync(join(apiDir, 'nano-banana.js'), 'utf8'));

ok('nano-banana imports the shared builder',
  /from '\.\/_lib\/gemini-chat-contents\.js'/.test(nano) && /buildGeminiChatContents/.test(nano));
// no surviving inline Gemini contents copy (history.map → parts:[{ text ...}])
const inlineGeminiCopy = /history\.map\([\s\S]{0,140}parts:\s*\[\{\s*text/;
ok('nano-banana has no inline Gemini contents map (only the shared builder)',
  !inlineGeminiCopy.test(nano));

// ════════════════════════════════════════════════════════════════════════════
// APPENDED-MESSAGE COERCION — the new user turn is the one part present in EVERY
// Gemini chat call. History content is coerced (above); the appended message
// must be too. A truthy NON-string message (number/array/object from a malformed
// body — callers only guard `!message`) must NOT be pushed raw, or Gemini 400s
// the whole chat ("Invalid value at 'contents.parts.text'").
// ════════════════════════════════════════════════════════════════════════════
// RED proof: the old raw push (`text: message`) leaves a non-string text part.
function oldRawAppend(history, message) {
  const c = buildGeminiHistoryContents(history, { window: 12 });
  c.push({ role: 'user', parts: [{ text: message }] }); // raw — the pre-fix bug
  return c;
}
ok('RED proof: old raw append leaves a NON-string text for a numeric message',
  typeof oldRawAppend([], 42).at(-1).parts[0].text === 'number');
ok('RED proof: old raw append leaves a NON-string text for an object message',
  typeof oldRawAppend([], { text: 'x' }).at(-1).parts[0].text === 'object');
// FIX: every message shape yields a STRING text part (never a 500-triggering raw value).
for (const m of [42, 0, true, null, undefined, ['a', 'b'], { t: 'x' }]) {
  const last = buildGeminiChatContents([], m).at(-1);
  ok('appended message ' + JSON.stringify(m) + ' → string text part',
    typeof last.parts[0].text === 'string');
}
ok('numeric message 42 coerces to "42"',
  buildGeminiChatContents([], 42).at(-1).parts[0].text === '42');
ok('null/undefined message coerces to "" (not "null"/"undefined")',
  buildGeminiChatContents([], null).at(-1).parts[0].text === '' &&
  buildGeminiChatContents([], undefined).at(-1).parts[0].text === '');
ok('string message is preserved verbatim (no behavior change for the common case)',
  buildGeminiChatContents([], 'hello there').at(-1).parts[0].text === 'hello there');

console.log(`\ngemini-chat-contents: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
