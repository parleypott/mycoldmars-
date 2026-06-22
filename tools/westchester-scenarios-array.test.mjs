// Locks the THREE remaining cloud-synced ARRAY reads in public/westchester/index.html
// onto the array-guaranteeing parseArrayLS helper. whh:scenarios:v1, whh:agent:memory:v1,
// and whh:agent:chat:v1 are all CLOUD_KEYS entries — cloudPull writes the server's raw
// value straight into localStorage — so a non-array value synced down from another machine
// (schema drift, partial/corrupt write, hand-edited Supabase row) used to land verbatim in
// listScenarios()/agentMemory/agentMessages and crash a consumer at page load:
//   - renderScenarioMenu() does list.map(...)   -> scenario menu crash on load
//   - agentMemory.map/.unshift/.slice           -> agent context panel crash
//   - agentMessages.map/.push/.slice            -> agent chat crash
// The be01a6b parseArrayLS fix routed pins+villages but MISSED these three. This locks them.
//
// EXTRACTS the real shipped source from index.html at runtime so the binding can't drift.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, '..', 'public', 'westchester', 'index.html'), 'utf8');

// Source-binding greps run against the raw HTML. The explanatory comments added
// alongside the fix contain none of the matched patterns (no `return parseArrayLS(`,
// no `... = parseArrayLS(`, no `JSON.parse(localStorage.getItem(<KEY>`), so they can't
// false-match — confirmed by the mutation proof (revert an edit -> the binding goes RED).

// --- brace-match-extract a top-level `function NAME(...) { ... }` from the html ---
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found`);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// ---------------- harness ----------------
let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }

// ===== inline RED proof: the OLD verbatim/inline reads crash a consumer on a non-array =====
{
  // listScenarios old form: JSON.parse returned verbatim, no Array.isArray guard.
  const oldListScenarios = (raw) => { try { return JSON.parse(raw || '[]'); } catch { return []; } };
  const leaked = oldListScenarios('{}');           // valid JSON, non-array
  ok(!Array.isArray(leaked), 'RED: old listScenarios returns a non-array ({}) for a non-array store');
  let threw = false;
  try { leaked.map(() => 1); } catch { threw = true; }
  ok(threw, 'RED: the leaked non-array throws on renderScenarioMenu list.map (the live crash)');

  // old agentMemory/agentMessages inline form: same shape.
  const oldAgentRead = (raw) => { let v; try { v = JSON.parse(raw || '[]'); } catch {} return v; };
  const mem = oldAgentRead('{"a":1}');
  ok(!Array.isArray(mem), 'RED: old agentMemory inline read returns a non-array');
  let threw2 = false;
  try { mem.unshift({ text: 'x' }); } catch { threw2 = true; }
  ok(threw2, 'RED: the leaked non-array throws on agentMemory.unshift');
}

// ===== the fix is array-safe end-to-end (drive the real shipped parseArrayLS) =====
{
  const src = extractFn(HTML, 'parseArrayLS');
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  const parseArrayLS = new Function('localStorage', `${src}; return parseArrayLS;`)(localStorage);

  // For each cloud key, a non-array stored value degrades to [] and the consumer op is safe.
  const cases = [
    ['whh:scenarios:v1', '{}', (a) => a.map(() => 1)],            // renderScenarioMenu
    ['whh:scenarios:v1', '5', (a) => a.map(() => 1)],
    ['whh:agent:memory:v1', '{"a":1}', (a) => a.unshift({ text: 'x' })],
    ['whh:agent:memory:v1', '"corrupt"', (a) => a.slice(0, 60)],
    ['whh:agent:chat:v1', 'true', (a) => a.push({ role: 'user' })],
    ['whh:agent:chat:v1', '{bad json', (a) => a.slice(-40)],
  ];
  for (const [key, raw, consume] of cases) {
    store.set(key, raw);
    const out = parseArrayLS(key);
    ok(Array.isArray(out), `${key} store=${raw} -> array`);
    let safe = true;
    try { consume(out); } catch { safe = false; }
    ok(safe, `${key} store=${raw} -> consumer op never throws`);
  }

  // no regression: a real array passes through verbatim
  store.set('whh:scenarios:v1', '[{"id":"s_1","name":"Aggressive"}]');
  ok(JSON.stringify(parseArrayLS('whh:scenarios:v1')) === '[{"id":"s_1","name":"Aggressive"}]',
    'real scenarios array preserved verbatim');
  store.set('whh:agent:memory:v1', '[{"text":"likes pools"}]');
  ok(parseArrayLS('whh:agent:memory:v1').length === 1, 'real agent memory array preserved');
}

// ===== SOURCE BINDING (mutation-proven): the three reads route through parseArrayLS, =====
// ===== and NO surviving inline verbatim JSON.parse(localStorage...KEY) form remains. =====
{
  const listScenariosSrc = extractFn(HTML, 'listScenarios');
  ok(/return\s+parseArrayLS\(\s*SCENARIOS_KEY\s*\)/.test(listScenariosSrc),
    'BIND: listScenarios returns parseArrayLS(SCENARIOS_KEY)');
  ok(!/JSON\.parse\(\s*localStorage\.getItem\(\s*SCENARIOS_KEY/.test(listScenariosSrc),
    'BIND: listScenarios no longer reads SCENARIOS_KEY via inline JSON.parse');

  ok(/agentMemory\s*=\s*parseArrayLS\(\s*AGENT_MEM_KEY\s*\)/.test(HTML),
    'BIND: agentMemory routes through parseArrayLS(AGENT_MEM_KEY)');
  ok(/agentMessages\s*=\s*parseArrayLS\(\s*AGENT_CHAT_KEY\s*\)/.test(HTML),
    'BIND: agentMessages routes through parseArrayLS(AGENT_CHAT_KEY)');

  // the old inline verbatim reads for these two keys are GONE
  ok(!/JSON\.parse\(\s*localStorage\.getItem\(\s*AGENT_MEM_KEY/.test(HTML),
    'BIND: no surviving inline JSON.parse read of AGENT_MEM_KEY');
  ok(!/JSON\.parse\(\s*localStorage\.getItem\(\s*AGENT_CHAT_KEY/.test(HTML),
    'BIND: no surviving inline JSON.parse read of AGENT_CHAT_KEY');

  // all three keys ARE cloud-synced (the reachability premise) — guard against a
  // future edit silently dropping them from CLOUD_KEYS (which would mask the bug).
  for (const k of ['whh:scenarios:v1', 'whh:agent:memory:v1', 'whh:agent:chat:v1']) {
    ok(new RegExp(`CLOUD_KEYS[\\s\\S]{0,300}${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(HTML),
      `BIND: ${k} is in CLOUD_KEYS (reachable via cloudPull)`);
  }
}

const name = 'westchester-scenarios-array';
if (fail === 0) console.log(`✓ ${name}: ${pass} passed, 0 failed`);
else { console.log(`✗ ${name}: ${pass} passed, ${fail} failed`); for (const f of fails) console.log('   - ' + f); process.exit(1); }
