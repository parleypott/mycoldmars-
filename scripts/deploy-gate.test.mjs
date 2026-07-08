// deploy-gate.test.mjs — locks the deploy gate's fail-closed / fail-open contract.
//
// The gate (scripts/deploy-gate.mjs) is what stands between a red burma-script
// engine and production: package.json "build" runs it before vite build. Its
// contract has two halves and BOTH must hold or the gate is worse than useless:
//   FAIL-CLOSED — a genuine test failure exits nonzero (blocks the deploy)
//   FAIL-OPEN   — an environment that can't run tests at all exits ZERO with a
//                 loud warning (a broken gate must never brick deploys)
//
// These tests exercise both halves hermetically via the gate's env hooks
// (DEPLOY_GATE_DIR points discovery at throwaway fixture suites; DEPLOY_GATE_RUNNERS
// forces the no-usable-runtime path) so `bun run test` doesn't recursively re-run
// the real 90+-file suite through the gate. Discovery against the REAL tree is
// covered by the --list smoke at the end.
//
// Run: bun scripts/deploy-gate.test.mjs   (auto-discovered by run-tests.mjs)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = join(ROOT, 'scripts', 'deploy-gate.mjs');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.log(`  ✗ ${name}\n    ${err.message}`); }
}

// Run the gate as a child process — the same way npm run build does — under
// bun (which is executing this test, so it definitely exists).
function runGate(env = {}, args = []) {
  const res = spawnSync(process.execPath, [GATE, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 180_000,
  });
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

// Fixture suites: tiny self-contained assert scripts, no tiptap needed.
const fixtures = mkdtempSync(join(tmpdir(), 'deploy-gate-fixtures-'));
const greenDir = join(fixtures, 'green');
const redDir = join(fixtures, 'red');
const emptyDir = join(fixtures, 'empty');
mkdirSync(join(greenDir, 'nested'), { recursive: true });
mkdirSync(redDir, { recursive: true });
mkdirSync(emptyDir, { recursive: true });
writeFileSync(join(greenDir, 'a.test.mjs'), `import assert from 'node:assert/strict'; assert.equal(1 + 1, 2); console.log('a: 1 passed');\n`);
writeFileSync(join(greenDir, 'nested', 'b.test.mjs'), `import assert from 'node:assert/strict'; assert.ok(true); console.log('b: 1 passed');\n`);
writeFileSync(join(greenDir, 'not-a-test.mjs'), `throw new Error('this file must NOT be discovered — wrong suffix');\n`);
writeFileSync(join(redDir, 'ok.test.mjs'), `console.log('ok: fine');\n`);
writeFileSync(join(redDir, 'boom.test.mjs'), `import assert from 'node:assert/strict'; assert.equal(1, 2, 'engine is broken');\n`);

// 1. GREEN suite → exit 0, and both nested + flat files were found.
check('green fixture suite exits 0', () => {
  const { code, out } = runGate({ DEPLOY_GATE_DIR: greenDir });
  assert.equal(code, 0, `expected 0, got ${code}\n${out}`);
  assert.match(out, /2 .*test files/, 'should discover exactly the 2 *.test.mjs files (nested included, wrong-suffix excluded)');
  assert.match(out, /deploy may proceed/);
});

// 2. RED suite → exit 1 (FAIL-CLOSED — the whole reason the gate exists).
check('failing fixture suite exits 1 and names the failing file', () => {
  const { code, out } = runGate({ DEPLOY_GATE_DIR: redDir });
  assert.equal(code, 1, `expected 1, got ${code}\n${out}`);
  assert.match(out, /BLOCKING DEPLOY/);
  assert.match(out, /boom\.test\.mjs/);
});

// 3. No usable runtime → exit 0 + loud warning (FAIL-OPEN — a misconfigured
//    gate must never brick a deploy). Every candidate fails: one doesn't exist,
//    one exists but can't pass the canary (/usr/bin/false).
check('no usable runner fails OPEN (exit 0, loud warning)', () => {
  const { code, out } = runGate({
    DEPLOY_GATE_DIR: redDir, // red on purpose: must NOT matter — tests never run
    DEPLOY_GATE_RUNNERS: 'definitely-not-a-real-runtime-xyz,/usr/bin/false',
  });
  assert.equal(code, 0, `expected 0, got ${code}\n${out}`);
  assert.match(out, /FAILING OPEN/);
  assert.match(out, /canary/);
  assert.doesNotMatch(out, /BLOCKING DEPLOY/);
});

// 4. Zero test files discovered → exit 0 + loud warning (broken discovery is an
//    environment fault, not a red engine).
check('empty discovery dir fails OPEN', () => {
  const { code, out } = runGate({ DEPLOY_GATE_DIR: emptyDir });
  assert.equal(code, 0, `expected 0, got ${code}\n${out}`);
  assert.match(out, /FAILING OPEN/);
  assert.match(out, /no \*\.test\.mjs files found/);
});

// 5. DEPLOY_GATE_SKIP=1 → exit 0 even on a red suite, loudly.
check('DEPLOY_GATE_SKIP=1 skips loudly with exit 0', () => {
  const { code, out } = runGate({ DEPLOY_GATE_DIR: redDir, DEPLOY_GATE_SKIP: '1' });
  assert.equal(code, 0, `expected 0, got ${code}\n${out}`);
  assert.match(out, /FAILING OPEN/);
  assert.match(out, /DEPLOY_GATE_SKIP/);
});

// 6. --list against the REAL tree: discovery must see the actual burma-script
//    suite (90+ files today) without running any of them.
check('--list discovers the real burma-script suite', () => {
  const { code, out } = runGate({}, ['--list']);
  assert.equal(code, 0, `expected 0, got ${code}\n${out}`);
  const m = out.match(/(\d+) test files under/);
  assert.ok(m, `no count line in output:\n${out}`);
  assert.ok(Number(m[1]) >= 90, `expected >= 90 real test files, saw ${m[1]}`);
  assert.match(out, /burma-script\/src\//);
});

// 7. package.json "build" actually runs the gate before vite build — the wiring
//    is the deploy-stopping part, so lock it too.
check('package.json build script is wired through the gate', () => {
  const pkg = JSON.parse(spawnSync('cat', [join(ROOT, 'package.json')], { encoding: 'utf8' }).stdout);
  assert.match(pkg.scripts.build, /deploy-gate\.mjs/, 'build must invoke scripts/deploy-gate.mjs');
  assert.match(pkg.scripts.build, /deploy-gate\.mjs.*&&.*vite build/, 'gate must run BEFORE vite build, chained with &&');
  assert.match(pkg.scripts.build, /node scripts\/deploy-gate\.mjs/, 'gate must be invoked with node — the only runtime guaranteed in the Vercel container');
});

rmSync(fixtures, { recursive: true, force: true });

console.log(`\ndeploy-gate: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
