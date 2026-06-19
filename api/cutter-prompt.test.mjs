// Tests for api/_lib/cutter-prompt.js — the pure prompt/context builders behind
// the rough-cut editorial chatbot (api/cutter.js). First coverage.
//
// Headline lock: buildChatContents must return a `contents` array that BEGINS
// with a `user` turn (Gemini rejects a multi-turn request whose first turn is
// 'model'). Mutation-proven: revert the leading-model drop -> the leading-role
// cases go RED.

import { buildSystemInstruction, buildChatContents } from './_lib/cutter-prompt.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

// ── RED proof: reconstruct the OLD buildChatContents (no leading-model drop) ──
function oldContents(history, message) {
  return [
    ...(history || []).slice(-12).map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
    { role: 'user', parts: [{ text: message }] },
  ];
}
{
  const hist = [{ role: 'model', content: 'Hi! I read your cut.' }, { role: 'user', content: 'the open drags' }];
  eq(oldContents(hist, 'fix it')[0].role, 'model', 'RED proof: old logic leads with a model turn (Gemini-rejected)');
  eq(buildChatContents(hist, 'fix it')[0].role, 'user', 'fix: new logic leads with a user turn');
}

// ── buildChatContents: leading-role guarantee ──────────────────────────────
{
  // seeded assistant greeting at the head of a short history
  const hist = [{ role: 'model', content: 'greeting' }, { role: 'user', content: 'q1' }, { role: 'model', content: 'a1' }];
  const c = buildChatContents(hist, 'now restructure');
  eq(c[0].role, 'user', 'seeded greeting: contents starts with user');
  eq(c[0].parts[0].text, 'q1', 'the original first user turn is preserved as the head');
  eq(c[c.length - 1].role, 'user', 'last turn is the appended user message');
  eq(c[c.length - 1].parts[0].text, 'now restructure', 'appended message text correct');
}
{
  // an all-model window collapses to just the appended user message
  const hist = [{ role: 'model', content: 'm1' }, { role: 'model', content: 'm2' }];
  const c = buildChatContents(hist, 'hello');
  eq(c.length, 1, 'all-model window collapses to one turn');
  eq(c[0].role, 'user', 'collapsed contents is the user message');
  eq(c[0].parts[0].text, 'hello', 'collapsed message text');
}
{
  // clean alternating history starting with user — unchanged
  const hist = [{ role: 'user', content: 'u1' }, { role: 'model', content: 'a1' }];
  const c = buildChatContents(hist, 'u2');
  eq(c.length, 3, 'clean history: 2 turns + appended message');
  eq(c[0].role, 'user', 'clean history still leads user');
  eq(c[0].parts[0].text, 'u1', 'first user turn intact');
  eq(c[1].role, 'model', 'second turn maps assistant->model');
  eq(c[2].parts[0].text, 'u2', 'appended message at tail');
}
{
  // never returns an empty array, even with no history
  for (const h of [[], null, undefined, 'nope', 42, {}]) {
    const c = buildChatContents(h, 'msg');
    eq(c.length, 1, `no-history (${JSON.stringify(h)}): single user turn`);
    eq(c[0].role, 'user', `no-history (${JSON.stringify(h)}): role user`);
  }
}
{
  // role mapping: only exact 'user' maps to user; everything else -> model
  const hist = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'system', content: 'c' }];
  const c = buildChatContents(hist, 'm');
  eq(c[0].role, 'user', 'user -> user');
  eq(c[1].role, 'model', 'assistant -> model');
  eq(c[2].role, 'model', 'system -> model');
}
{
  // 12-message window cap (plus the appended message)
  const hist = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'model', content: `t${i}` }));
  const c = buildChatContents(hist, 'final');
  eq(c.length, 13, 'window caps at 12 history turns + 1 appended');
  eq(c[0].role, 'user', 'windowed head is a user turn (even index -> user)');
  eq(c[0].parts[0].text, 't8', 'window takes the last 12 (t8..t19)');
}
{
  // EVERY mutation-relevant input keeps the head a user turn
  const cases = [
    [{ role: 'model', content: 'x' }],
    [{ role: 'model', content: 'x' }, { role: 'model', content: 'y' }, { role: 'user', content: 'z' }],
    [{ role: 'assistant', content: 'x' }, { role: 'user', content: 'y' }],
  ];
  for (const h of cases) {
    eq(buildChatContents(h, 'm')[0].role, 'user', `head-is-user invariant for ${JSON.stringify(h.map(e => e.role))}`);
  }
}

// ── buildSystemInstruction: script rendering ───────────────────────────────
{
  const segs = [
    { timestamp_start: '0:00', timestamp_end: '0:12', words: 'JOHNNY: we begin', visual: 'wide, highway at night' },
    { timestamp_start: '0:12', timestamp_end: '0:30', words: '[music]', visual: 'market crowd' },
  ];
  const s = buildSystemInstruction(segs, 'Burma open');
  ok(s.includes('THE CUT — "Burma open"'), 'title embedded');
  ok(s.includes('[0:00–0:12]'), 'segment timestamp range rendered (en-dash)');
  ok(s.includes('WORDS: JOHNNY: we begin'), 'words rendered');
  ok(s.includes('VISUAL: wide, highway at night'), 'visual rendered');
  ok(s.includes('editorial consultant'), 'framing preamble present');
  ok(s.split('\n\n').some(b => b.startsWith('[0:12–0:30]')), 'segments joined by blank line');
}
{
  // empty / missing segments -> "(no script loaded)"; missing title -> "Untitled"
  for (const segs of [[], null, undefined]) {
    const s = buildSystemInstruction(segs, '');
    ok(s.includes('(no script loaded)'), `empty segments (${JSON.stringify(segs)}) -> no-script placeholder`);
    ok(s.includes('THE CUT — "Untitled"'), `missing title (${JSON.stringify(segs)}) -> Untitled`);
  }
}
{
  // exact byte-for-byte match against the reconstructed old inline builder for a real array
  function oldSystem(segments, title) {
    const scriptText = (segments || []).map(s =>
      `[${s.timestamp_start}–${s.timestamp_end}]\n  WORDS: ${s.words}\n  VISUAL: ${s.visual}`
    ).join('\n\n');
    return `You are an editorial consultant reviewing a rough cut with a filmmaker.

You have read the complete two-column breakdown of the cut below. Your job is to help restructure the narrative.

When the filmmaker tells you what's not working, be specific and opinionated. Propose concrete reorderings using timestamps. Explain WHY each move improves the story — what it establishes, what tension it creates, what payoff it sets up.

Be direct. One idea at a time. No padding, no disclaimers.

THE CUT — "${title || 'Untitled'}"
${scriptText || '(no script loaded)'}`;
  }
  const segs = [{ timestamp_start: '1:00', timestamp_end: '1:20', words: 'a', visual: 'b' }];
  eq(buildSystemInstruction(segs, 'T'), oldSystem(segs, 'T'), 'byte-identical to old inline builder (real array)');
  eq(buildSystemInstruction([], 'T'), oldSystem([], 'T'), 'byte-identical to old inline builder (empty)');
}

console.log(`cutter-prompt: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  ✗', f); process.exit(1); }
