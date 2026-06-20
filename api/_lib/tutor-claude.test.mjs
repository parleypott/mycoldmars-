// Tests for the QSS tutor's PRIMARY Claude payload builder + the
// strictly-non-regressive accept/fall-back guard (api/_lib/tutor-claude.js).
//
// THE BUG: the old inline tutor payload set BOTH `temperature: 1.0` AND
// `top_p: 0.95`. The Anthropic Messages API rejects a request carrying both
// sampling parameters on every Claude 4+ model (claude-sonnet-4-6 is Claude 4+)
// with a 400 invalid_request_error — so the primary Claude call 400'd on every
// turn and silently fell back to Gemini Flash. These cases lock that the new
// payload carries EXACTLY ONE sampling parameter, normalizes the messages so a
// model-leading history can't 400 either, and that the accept guard only keeps
// a Claude result when it has usable options (else the caller falls back).

import assert from 'node:assert';
import {
  buildTutorClaudePayload,
  isTutorClaudeResultUsable,
  TUTOR_CLAUDE_MODEL,
  TUTOR_CLAUDE_MAX_TOKENS,
  TUTOR_CLAUDE_TEMPERATURE,
} from './tutor-claude.js';

let passed = 0, failed = 0;
function ok(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// ── RED PROOF: reconstruct the OLD inline payload and assert it carried BOTH
// sampling parameters — the exact shape the Anthropic API 400s on. ──
ok('RED: old inline payload set BOTH temperature AND top_p (the 400 bug)', () => {
  const history = [{ role: 'user', content: 'hi' }];
  const userTurnText = 'next';
  // Faithful reconstruction of the pre-fix inline build.
  const oldClaudeMessages = history.map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
  }));
  oldClaudeMessages.push({ role: 'user', content: userTurnText });
  const oldPayload = {
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
    temperature: 1.0,
    top_p: 0.95,
    system: 'sys',
    messages: oldClaudeMessages,
  };
  const oldSampling = ['temperature', 'top_p', 'top_k'].filter(k => k in oldPayload);
  assert.equal(oldSampling.length, 2, 'old payload set two sampling params (rejected by the API)');
});

// ── THE FIX: the new payload carries EXACTLY ONE sampling parameter. ──
ok('new payload carries exactly one sampling parameter (temperature only)', () => {
  const p = buildTutorClaudePayload('sys', [{ role: 'user', content: 'hi' }], 'next');
  const sampling = ['temperature', 'top_p', 'top_k'].filter(k => k in p);
  assert.deepEqual(sampling, ['temperature'], 'only temperature is set');
  assert.equal('top_p' in p, false, 'top_p must be gone (the 400 cause)');
  assert.equal(p.temperature, TUTOR_CLAUDE_TEMPERATURE);
});

ok('payload carries the expected model/max_tokens/system', () => {
  const p = buildTutorClaudePayload('SYSTEXT', [], 'go');
  assert.equal(p.model, TUTOR_CLAUDE_MODEL);
  assert.equal(p.model, 'claude-sonnet-4-6');
  assert.equal(p.max_tokens, TUTOR_CLAUDE_MAX_TOKENS);
  assert.equal(p.system, 'SYSTEXT');
});

// ── messages normalization (leading-model-turn safety + user turn appended) ──
ok('messages always begin with a user turn even on a seeded wordy greeting', () => {
  const history = [
    { role: 'wordy', content: 'Hi Henry! Ready to write?' }, // seeded model turn
    { role: 'user', content: 'yes' },
  ];
  const p = buildTutorClaudePayload('sys', history, 'what next?');
  assert.equal(p.messages[0].role, 'user', 'first message must be user');
  // the seeded greeting (mapped to assistant) is dropped as a leading non-user turn
  assert.equal(p.messages.some(m => /Ready to write/.test(String(m.content))), false);
  // the two consecutive user turns ('yes' + the appended turn) merge into one;
  // the appended turn's text is preserved at the tail.
  assert.ok(/what next\?$/.test(p.messages[p.messages.length - 1].content), 'appended turn preserved');
});

ok('a clean alternating user-first history is preserved (1:1) plus the appended turn', () => {
  const history = [
    { role: 'user', content: 'a' },
    { role: 'wordy', content: 'b' },
  ];
  const p = buildTutorClaudePayload('sys', history, 'c');
  assert.deepEqual(p.messages, [
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'b' },
    { role: 'user', content: 'c' },
  ]);
});

ok('wordy/system roles map to assistant; user stays user', () => {
  const history = [
    { role: 'user', content: 'u' },
    { role: 'wordy', content: 'w' },
    { role: 'user', content: 'u2' },
    { role: 'assistant', content: 'a' },
  ];
  const p = buildTutorClaudePayload('sys', history, 'last');
  assert.deepEqual(p.messages.map(m => m.role), ['user', 'assistant', 'user', 'assistant', 'user']);
});

ok('empty / non-array history => just the appended user turn', () => {
  for (const h of [[], null, undefined]) {
    const p = buildTutorClaudePayload('sys', h, 'only');
    assert.deepEqual(p.messages, [{ role: 'user', content: 'only' }]);
  }
});

ok('a history entirely of model turns collapses to just the appended user turn', () => {
  const history = [
    { role: 'wordy', content: 'greeting' },
    { role: 'wordy', content: 'more' },
  ];
  const p = buildTutorClaudePayload('sys', history, 'go');
  assert.deepEqual(p.messages, [{ role: 'user', content: 'go' }]);
});

// ── the accept/fall-back guard (strictly-non-regressive) ──
ok('directions phase: usable only when directions is non-empty', () => {
  assert.equal(isTutorClaudeResultUsable('directions', [{ x: 1 }], []), true);
  assert.equal(isTutorClaudeResultUsable('directions', [], [{ y: 2 }]), false, 'empty directions => fall back');
  assert.equal(isTutorClaudeResultUsable('directions', [], []), false);
});

ok('blocks phase: usable only when blockOptions is non-empty', () => {
  assert.equal(isTutorClaudeResultUsable('blocks', [], [{ y: 2 }]), true);
  assert.equal(isTutorClaudeResultUsable('blocks', [{ x: 1 }], []), false, 'empty blockOptions => fall back');
  assert.equal(isTutorClaudeResultUsable('blocks', [], []), false);
  // any non-directions phase keys on blockOptions
  assert.equal(isTutorClaudeResultUsable('whatever', [], [{ y: 2 }]), true);
});

ok('guard never throws on missing/garbage arrays => not usable (falls back)', () => {
  assert.equal(isTutorClaudeResultUsable('directions', undefined, undefined), false);
  assert.equal(isTutorClaudeResultUsable('blocks', null, null), false);
  assert.equal(isTutorClaudeResultUsable('directions', 'x', 'y'), false);
});

console.log(`tutor-claude: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
