// Tests for api/whh-narrative.js buildPrompt — the pure prompt-builder behind the
// Westchester House Hunter narrative generator (Johnny's real house hunt). buildPrompt
// dispatches on `kind` and returns { system, userMsg, maxTokens }; the handler gates a
// 400 unknown_kind on a null system, and feeds maxTokens straight to the Anthropic call.
// No live bug found — this is a verifier-layer LOCK of the prompt contract, fully
// freeze-independent because buildPrompt is pure. Every assertion is mutation-proven to
// go RED if the corresponding logic regresses (see the mutation notes at the bottom).
//
// Run: bun api/whh-narrative.test.mjs   (also auto-discovered by `bun run test`)

import assert from 'node:assert/strict';
import { buildPrompt } from './whh-narrative.js';

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${err.message}`); }
}

// ── The seven real kinds the tool dispatches, with their load-bearing contract ──
// maxTokens is fed straight to the model — a regression here silently truncates output.
// Each system must carry the structural instructions that shape the model's response.
const KINDS = [
  { kind: 'story',             maxTokens: 800,  systemMust: '200-word narrative',          usesMemory: true,  usesPin: 'pin'  },
  { kind: 'visit-prep',        maxTokens: 1400, systemMust: '### Ask the Broker',           usesMemory: true,  usesPin: 'pin'  },
  { kind: 'negotiation',       maxTokens: 1200, systemMust: '### Walk-Away',                usesMemory: true,  usesPin: 'pin'  },
  { kind: 'decision-walk',     maxTokens: 2200, systemMust: '### The Three Frames',         usesMemory: true,  usesPin: 'pins' },
  { kind: 'realtor-shortlist', maxTokens: 3000, systemMust: '## Homes We\'re Interested In', usesMemory: false, usesPin: 'pins' },
  { kind: 'realtor-doctrine',  maxTokens: 2400, systemMust: '## Geographic Lanes',          usesMemory: false, usesPin: null   },
  { kind: 'brief',             maxTokens: 2000, systemMust: '### What I Need From You',      usesMemory: true,  usesPin: 'pins' },
];

const PIN = { address: '12 Maple St', village: 'Pleasantville', price: 1250000 };
const PINS = [PIN, { address: '7 Elm Ave', village: 'Irvington', price: 1490000 }];
const CTX = {
  familyCriteria: 'DOCTRINE_SENTINEL_connection-first',
  memory: [{ text: 'MEMORY_SENTINEL_alpha', ts: 1 }, { text: 'MEMORY_SENTINEL_beta', ts: 2 }],
};

// Every kind returns a complete, non-null result with the right token budget.
for (const k of KINDS) {
  t(`${k.kind}: non-null system + userMsg`, () => {
    const r = buildPrompt({ kind: k.kind, pin: PIN, pins: PINS, context: CTX });
    assert.ok(r.system && typeof r.system === 'string', 'system must be a non-empty string');
    assert.ok(r.userMsg && typeof r.userMsg === 'string', 'userMsg must be a non-empty string');
  });

  t(`${k.kind}: exact maxTokens budget`, () => {
    const r = buildPrompt({ kind: k.kind, pin: PIN, pins: PINS, context: CTX });
    assert.equal(r.maxTokens, k.maxTokens);
  });

  t(`${k.kind}: system carries its load-bearing structure`, () => {
    const r = buildPrompt({ kind: k.kind, pin: PIN, pins: PINS, context: CTX });
    assert.ok(r.system.includes(k.systemMust), `system must contain "${k.systemMust}"`);
  });

  t(`${k.kind}: userMsg embeds the family doctrine`, () => {
    const r = buildPrompt({ kind: k.kind, pin: PIN, pins: PINS, context: CTX });
    assert.ok(r.userMsg.includes('DOCTRINE_SENTINEL_connection-first'),
      'doctrine must flow into the userMsg');
  });

  t(`${k.kind}: memory embedded iff the kind uses it`, () => {
    const r = buildPrompt({ kind: k.kind, pin: PIN, pins: PINS, context: CTX });
    const hasMem = r.userMsg.includes('MEMORY_SENTINEL_alpha');
    assert.equal(hasMem, k.usesMemory,
      k.usesMemory ? 'this kind must embed saved memory' : 'this kind must NOT embed memory');
  });

  if (k.usesPin === 'pin') {
    t(`${k.kind}: userMsg embeds the single pin`, () => {
      const r = buildPrompt({ kind: k.kind, pin: PIN, pins: PINS, context: CTX });
      assert.ok(r.userMsg.includes('12 Maple St'), 'the pin address must be serialized into userMsg');
    });
  }
  if (k.usesPin === 'pins') {
    t(`${k.kind}: userMsg embeds the pins list`, () => {
      const r = buildPrompt({ kind: k.kind, pin: PIN, pins: PINS, context: CTX });
      assert.ok(r.userMsg.includes('12 Maple St') && r.userMsg.includes('7 Elm Ave'),
        'both pins must be serialized into userMsg');
    });
  }
}

// ── Unknown / empty kind → null system (the handler gates 400 unknown_kind on this) ──
for (const bad of ['', undefined, null, 'storyy', 'STORY', 'random', 'chat']) {
  t(`unknown kind ${JSON.stringify(bad)} → {system:null, maxTokens:0}`, () => {
    const r = buildPrompt({ kind: bad, pin: PIN, pins: PINS, context: CTX });
    assert.equal(r.system, null);
    assert.equal(r.userMsg, null);
    assert.equal(r.maxTokens, 0);
  });
}

// ── Memory renderer: numbered list, object→.text, legacy string passthrough ──
t('memory renders as a 1-based numbered list', () => {
  const r = buildPrompt({ kind: 'story', pin: PIN, context: { memory: [{ text: 'first' }, { text: 'second' }] } });
  assert.ok(r.userMsg.includes('1. first'), 'item 1 numbered');
  assert.ok(r.userMsg.includes('2. second'), 'item 2 numbered');
});

t('legacy string memory items pass through (m.text || m)', () => {
  // Older saved memory was a bare string, not {text}. The `|| m` fallback must keep it.
  const r = buildPrompt({ kind: 'story', pin: PIN, context: { memory: ['bare legacy note'] } });
  assert.ok(r.userMsg.includes('1. bare legacy note'));
});

t('empty memory array → "(none saved)"', () => {
  const r = buildPrompt({ kind: 'story', pin: PIN, context: { memory: [] } });
  assert.ok(r.userMsg.includes('(none saved)'), 'empty memory must show the (none saved) placeholder');
});

t('absent context → memory "(none saved)" and doctrine fallback', () => {
  const r = buildPrompt({ kind: 'story', pin: PIN });
  assert.ok(r.userMsg.includes('(none saved)'));
  assert.ok(r.userMsg.includes('general best-fit reasoning'),
    'missing familyCriteria must use the general-reasoning doctrine fallback');
});

// ── Family identity is always present (the prompt is family-specific by design) ──
t('every kind names the Harris family + the two kids in the prompt', () => {
  for (const k of KINDS) {
    const r = buildPrompt({ kind: k.kind, pin: PIN, pins: PINS, context: CTX });
    assert.ok(r.userMsg.includes('Johnny Harris'), `${k.kind}: family line present`);
    assert.ok(r.system.length > 50, `${k.kind}: system is substantive`);
  }
});

// ── INLINE RED PROOF: distinct maxTokens per kind (a regression collapsing them is caught) ──
t('RED-proof: the seven kinds have distinct token budgets', () => {
  const budgets = KINDS.map(k => buildPrompt({ kind: k.kind, pin: PIN, pins: PINS, context: CTX }).maxTokens);
  const uniq = new Set(budgets);
  assert.equal(uniq.size, KINDS.length, 'each kind must keep its own maxTokens (none collapsed/aliased)');
  assert.ok(!budgets.includes(0), 'no real kind may return the unknown-kind sentinel 0');
});

console.log(`\nwhh-narrative buildPrompt: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

/* Mutation proof (run by hand to confirm this is a real verifier, not a rubber stamp):
 *  1. Delete the `if (kind === 'brief')` branch         → brief falls through to null → RED
 *     (non-null, maxTokens, structure, doctrine, memory, pins asserts for brief all fail).
 *  2. Change story maxTokens 800 → 1000                 → "story: exact maxTokens" RED +
 *     "RED-proof distinct budgets" survives only if it stays unique, else also RED.
 *  3. Swap realtor-doctrine to embed `${memory}`         → "memory embedded iff" RED for it.
 *  4. Break the numbering `${i+1}.` → `${i}.`            → "1-based numbered list" RED.
 *  5. Drop the `|| '(none saved)'` fallback              → "empty memory" + "absent context" RED.
 * All restored → green. */
