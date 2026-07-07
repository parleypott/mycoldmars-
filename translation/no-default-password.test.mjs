// Source guard: the shared default password is dead in the Interpreter too.
//
// Sibling of api/admin-users.test.mjs. The server side (api/admin-users.js —
// shared by scripts-library AND the Interpreter) already generates per-user
// random passwords and returns them once as `generatedPassword`. This test
// locks the Interpreter CLIENT to the same contract:
//   • no quoted 'newpress' literal anywhere in the gate/auth/admin UI source
//     (the old sins: `defaultValue: 'newpress'`, hint copy, seeded-password
//     instructions in manual-steps);
//   • no copy that pairs "password" with "newpress" — the hint that used to
//     sit on the public login screen and in the admin console;
//   • the admin console actually consumes the one-time `generatedPassword`
//     field (create + set_password), not the removed `defaultPassword`.
//
// Pure source inspection — no DOM, no network.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const FILES = [
  'src/main.js',
  'src/manual-steps.js',
  'src/gate.js',
  'src/auth.js',
  'index.html',
];

// Legit brand/domain uses that are allowed to contain the substring.
function stripAllowed(src) {
  return src
    .replace(/[\w.+-]+@newpress\.com/gi, '')   // admin emails
    .replace(/newpress\.(press|com|show)/gi, ''); // domains
}

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; }
  catch (e) { console.error(`FAIL: ${name}\n  ${e.message}`); process.exitCode = 1; }
}

const sources = {};
for (const f of FILES) {
  sources[f] = await readFile(new URL(`./${f}`, import.meta.url), 'utf8');
}

for (const f of FILES) {
  await t(`${f}: no quoted 'newpress' password literal`, async () => {
    const src = stripAllowed(sources[f]);
    assert.ok(!/(["'`])newpress\1/.test(src),
      `found a quoted 'newpress' literal in translation/${f} — the shared default must not come back`);
  });

  await t(`${f}: no copy pairing "password" with "newpress"`, async () => {
    const src = stripAllowed(sources[f]);
    const near =
      /password[\s\S]{0,60}?newpress/i.test(src) ||
      /newpress[\s\S]{0,60}?password/i.test(src);
    assert.ok(!near,
      `translation/${f} mentions "newpress" within 60 chars of "password" — no public hints, no default-password copy`);
  });
}

await t('admin UI consumes the one-time generatedPassword (create + set_password)', async () => {
  const src = sources['src/main.js'];
  const hits = src.match(/generatedPassword/g) || [];
  assert.ok(hits.length >= 4,
    `expected main.js to read generatedPassword in both admin surfaces (account modal + admin console); found ${hits.length} reference(s)`);
  assert.ok(!/defaultPassword/.test(src),
    'main.js still references the removed defaultPassword response field');
});

console.log(`translation no-default-password: ${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
