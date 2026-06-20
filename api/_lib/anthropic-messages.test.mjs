// Tests for normalizeAnthropicMessages — the shared Anthropic Messages API
// `messages` normalizer. Imports the REAL shipped function.
//
// Mutation-proven a real verifier (run by hand to confirm):
//   - remove the leading-non-user drop loop -> the leading-assistant cases RED
//   - remove the consecutive-same-role merge  -> the merge cases RED
//   - remove the empty-string filter          -> the empty-turn cases RED
//
// Carries an inline RED PROOF reconstructing the OLD qss-freestyle assembly
// (no normalization) and asserting it produced an Anthropic-contract-violating
// array (leading assistant / consecutive same-role) that the shipped
// normalizer fixes.

import assert from 'node:assert';
import { normalizeAnthropicMessages } from './anthropic-messages.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error(`✗ ${name}\n  ${e.message}`); }
}

const roles = arr => arr.map(m => m.role);

// ── Inline RED proof: reconstruct the OLD qss-freestyle assembly ────────────
// Before this fix, qss-freestyle built `messages` and sent it raw. With an
// EMPTY preamble and a seeded wordy (assistant) greeting in history, the array
// led with an `assistant` turn — a guaranteed Anthropic 400.
function oldAssembly({ preamble, history, message }) {
  const messages = [];
  if (preamble) {
    messages.push({ role: 'user', content: `Context:\n\n${preamble}` });
    messages.push({ role: 'assistant', content: 'Got it. Ready when you are.' });
  }
  for (const m of history) {
    if (!m || !m.content) continue;
    messages.push({ role: m.role === 'wordy' ? 'assistant' : 'user', content: String(m.content) });
  }
  messages.push({ role: 'user', content: message });
  return messages;
}

t('RED PROOF: old assembly leads with assistant on empty preamble + seeded greeting', () => {
  const old = oldAssembly({
    preamble: '',
    history: [{ role: 'wordy', content: 'Hi! What should we dream up today?' }],
    message: 'a dragon who is scared of fire',
  });
  // The bug: first turn is `assistant` → Anthropic 400.
  assert.equal(old[0].role, 'assistant', 'old assembly leads with assistant (the bug)');
  const fixed = normalizeAnthropicMessages(old);
  assert.equal(fixed[0].role, 'user', 'normalizer makes it lead with user');
  // The seeded greeting is dropped (it can never legally lead), the real
  // message survives.
  assert.deepEqual(fixed, [{ role: 'user', content: 'a dragon who is scared of fire' }]);
});

t('RED PROOF: old assembly emits two assistant turns in a row (preamble + leading wordy)', () => {
  const old = oldAssembly({
    preamble: 'Story goal: a brave knight',
    history: [{ role: 'wordy', content: 'Welcome back!' }, { role: 'henry', content: 'ok' }],
    message: 'what next?',
  });
  // The latent bug: assistant("Got it") immediately followed by assistant(wordy).
  assert.equal(old[1].role, 'assistant');
  assert.equal(old[2].role, 'assistant', 'old assembly has consecutive assistant turns');
  const fixed = normalizeAnthropicMessages(old);
  // Merged into one assistant turn carrying both texts; structure alternates.
  assert.deepEqual(roles(fixed), ['user', 'assistant', 'user', 'assistant', 'user']
    .filter((_, i) => i < fixed.length)); // structural check below is the real one
  // No two adjacent turns share a role.
  for (let i = 1; i < fixed.length; i++) {
    assert.notEqual(fixed[i].role, fixed[i - 1].role, `turns ${i - 1},${i} share a role`);
  }
  assert.equal(fixed[0].role, 'user');
  // Both assistant texts preserved in the merged turn.
  const merged = fixed.find(m => m.role === 'assistant');
  assert.ok(merged.content.includes('Got it'));
  assert.ok(merged.content.includes('Welcome back!'));
});

// ── First-turn-is-user invariant ───────────────────────────────────────────
t('drops a single leading assistant turn', () => {
  const out = normalizeAnthropicMessages([
    { role: 'assistant', content: 'greeting' },
    { role: 'user', content: 'hi' },
  ]);
  assert.deepEqual(out, [{ role: 'user', content: 'hi' }]);
});

t('drops multiple leading assistant turns', () => {
  const out = normalizeAnthropicMessages([
    { role: 'assistant', content: 'a' },
    { role: 'assistant', content: 'b' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'reply' },
    { role: 'user', content: 'more' },
  ]);
  assert.equal(out[0].role, 'user');
  assert.deepEqual(roles(out), ['user', 'assistant', 'user']);
  assert.equal(out[0].content, 'hi');
});

t('all-assistant array -> empty (nothing legal to send)', () => {
  const out = normalizeAnthropicMessages([
    { role: 'assistant', content: 'a' },
    { role: 'assistant', content: 'b' },
  ]);
  assert.deepEqual(out, []);
});

// ── Consecutive same-role merge ────────────────────────────────────────────
t('merges consecutive user turns', () => {
  const out = normalizeAnthropicMessages([
    { role: 'user', content: 'one' },
    { role: 'user', content: 'two' },
  ]);
  assert.deepEqual(out, [{ role: 'user', content: 'one\n\ntwo' }]);
});

t('merges consecutive assistant turns mid-conversation', () => {
  const out = normalizeAnthropicMessages([
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'x' },
    { role: 'assistant', content: 'y' },
    { role: 'user', content: 'bye' },
  ]);
  assert.deepEqual(out, [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'x\n\ny' },
    { role: 'user', content: 'bye' },
  ]);
});

t('merges a run of three same-role turns', () => {
  const out = normalizeAnthropicMessages([
    { role: 'user', content: 'a' },
    { role: 'user', content: 'b' },
    { role: 'user', content: 'c' },
  ]);
  assert.deepEqual(out, [{ role: 'user', content: 'a\n\nb\n\nc' }]);
});

// ── Behavior-preserving for already-valid input ────────────────────────────
t('already-valid alternating user-first array is unchanged', () => {
  const input = [
    { role: 'user', content: 'q1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'q2' },
  ];
  const out = normalizeAnthropicMessages(input);
  assert.deepEqual(out, input);
});

t('single user turn unchanged', () => {
  assert.deepEqual(
    normalizeAnthropicMessages([{ role: 'user', content: 'only' }]),
    [{ role: 'user', content: 'only' }],
  );
});

// ── Empty / junk filtering ─────────────────────────────────────────────────
t('drops empty + whitespace-only string turns', () => {
  const out = normalizeAnthropicMessages([
    { role: 'user', content: '' },
    { role: 'user', content: '   \n\t ' },
    { role: 'user', content: 'real' },
  ]);
  assert.deepEqual(out, [{ role: 'user', content: 'real' }]);
});

t('drops non-user/assistant roles and null/undefined content', () => {
  const out = normalizeAnthropicMessages([
    { role: 'system', content: 'sys' },
    { role: 'user', content: null },
    { role: 'user', content: undefined },
    { role: 'tool', content: 'x' },
    { role: 'user', content: 'kept' },
  ]);
  assert.deepEqual(out, [{ role: 'user', content: 'kept' }]);
});

t('non-array / null / undefined input -> []', () => {
  assert.deepEqual(normalizeAnthropicMessages(null), []);
  assert.deepEqual(normalizeAnthropicMessages(undefined), []);
  assert.deepEqual(normalizeAnthropicMessages('nope'), []);
  assert.deepEqual(normalizeAnthropicMessages(42), []);
  assert.deepEqual(normalizeAnthropicMessages({}), []);
  assert.deepEqual(normalizeAnthropicMessages([]), []);
});

// ── Non-string content is preserved, never string-merged ───────────────────
t('non-string (block) content is kept and not merged across', () => {
  const blockA = [{ type: 'text', text: 'a' }];
  const blockB = [{ type: 'text', text: 'b' }];
  const out = normalizeAnthropicMessages([
    { role: 'user', content: blockA },
    { role: 'user', content: blockB },
  ]);
  // Two block-content turns stay separate (no string-join corruption); they
  // still both lead-survive because the first is a user turn.
  assert.equal(out.length, 2);
  assert.strictEqual(out[0].content, blockA);
  assert.strictEqual(out[1].content, blockB);
});

t('a string turn does not merge into a preceding block-content turn', () => {
  const blockA = [{ type: 'text', text: 'a' }];
  const out = normalizeAnthropicMessages([
    { role: 'user', content: blockA },
    { role: 'user', content: 'plain' },
  ]);
  assert.equal(out.length, 2);
  assert.strictEqual(out[0].content, blockA);
  assert.equal(out[1].content, 'plain');
});

// ── End-to-end qss-freestyle shape ─────────────────────────────────────────
t('preamble + empty history + message: alternating, unchanged shape', () => {
  // The common case: preamble present, no prior history, one user message.
  const out = normalizeAnthropicMessages(oldAssembly({
    preamble: 'Story goal: a kind robot',
    history: [],
    message: 'how do i start?',
  }));
  assert.deepEqual(roles(out), ['user', 'assistant', 'user']);
  assert.equal(out[0].role, 'user');
  assert.equal(out[2].content, 'how do i start?');
});

t('preamble + full alternating history: structure stays alternating', () => {
  const out = normalizeAnthropicMessages(oldAssembly({
    preamble: 'goal',
    history: [
      { role: 'henry', content: 'h1' },
      { role: 'wordy', content: 'w1' },
      { role: 'henry', content: 'h2' },
      { role: 'wordy', content: 'w2' },
    ],
    message: 'next',
  }));
  assert.equal(out[0].role, 'user');
  for (let i = 1; i < out.length; i++) {
    assert.notEqual(out[i].role, out[i - 1].role, `turns ${i - 1},${i} share a role`);
  }
});

console.log(`anthropic-messages: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
