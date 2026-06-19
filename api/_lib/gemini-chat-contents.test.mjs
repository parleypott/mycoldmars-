// Tests for buildGeminiChatContents — the shared Gemini `contents` builder that
// guarantees a multi-turn request begins with a `user` turn (Gemini rejects a
// leading `model` turn). Consolidates the previously-divergent inline copies in
// cutter.js (window 12) and gemini.js handleChat + handleScriptChat (window 10).
//
// Run: node api/_lib/gemini-chat-contents.test.mjs  (or `bun run test`)
import { buildGeminiChatContents } from './gemini-chat-contents.js';

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

console.log(`\ngemini-chat-contents: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
