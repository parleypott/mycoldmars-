#!/usr/bin/env node
// deploy-gate.mjs — pushes to main stop shipping when the burma-script engine is red.
//
// WHY: Vercel's build used to be just `vite build` — a commit that broke the script
// engine's tests would sail straight to production. This gate runs every
// burma-script/src/**/*.test.mjs BEFORE vite build and exits nonzero when one fails,
// so a red engine never ships. package.json "build" is wired as:
//
//     node scripts/deploy-gate.mjs && vite build
//
// It's invoked with `node` (not bun) ON PURPOSE: vercel.json's buildCommand is
// `npm run build`, and node is the only runtime GUARANTEED to exist in Vercel's
// build container. The gate itself then picks the best runner for the tests
// (bun preferred — the repo is bun-native; bun.lock, tests use bare json imports).
//
// FAIL-SAFE DESIGN (the critical part):
//   FAIL-CLOSED on genuine test failures — a proven runner ran a test and it
//     exited nonzero (or hung past the per-file timeout). Exit 1. Deploy stops.
//   FAIL-OPEN on an environment that cannot run tests at all — no candidate
//     runtime passes the canary (scripts/deploy-gate-canary.mjs, which exercises
//     the tests' exact import surface: node:assert, tiptap ESM, bare json
//     imports), or no test files are found, or a proven runner later refuses to
//     spawn. Loud warning, exit 0. A misconfigured gate must never brick deploys.
//   The line between the two is the CANARY: a runner only gets to declare the
//   suite red after proving it can run a file shaped exactly like the suite.
//
// Wall time: files run in a CPU-capped parallel pool (same shape as
// scripts/run-tests.mjs), 120s per-file timeout — the whole gate stays well
// under the 3-minute budget.
//
// Escape hatch: DEPLOY_GATE_SKIP=1 skips the gate (loudly). For emergencies only.
//
// Test hooks (used by scripts/deploy-gate.test.mjs, harmless otherwise):
//   DEPLOY_GATE_DIR      — override the discovery root (default burma-script/src)
//   DEPLOY_GATE_RUNNERS  — comma-separated runner candidates (default: bun, then
//                          the runtime executing this script)
//   --list               — print the discovered test files and exit (no run)

import { spawn } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CANARY = join(ROOT, 'scripts', 'deploy-gate-canary.mjs');
const PER_FILE_TIMEOUT_MS = 120_000;
const CANARY_TIMEOUT_MS = 60_000;

const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

function warnOpen(reason) {
  console.warn('');
  console.warn('  ┌──────────────────────────────────────────────────────────────┐');
  console.warn('  │  DEPLOY GATE: FAILING OPEN — tests were NOT run              │');
  console.warn('  └──────────────────────────────────────────────────────────────┘');
  console.warn(`  ${reason}`);
  console.warn('  the deploy will proceed UNGATED. fix the gate environment so the');
  console.warn('  burma-script tests actually protect production again.');
  console.warn('');
}

// ── discovery ────────────────────────────────────────────────────────────────
const dirArg = process.env.DEPLOY_GATE_DIR || 'burma-script/src';
const TEST_DIR = isAbsolute(dirArg) ? dirArg : join(ROOT, dirArg);

function findTests(dir) {
  const out = [];
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) out.push(...findTests(full));
    else if (/\.test\.mjs$/.test(name)) out.push(full);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

// ── skip hatch ───────────────────────────────────────────────────────────────
if (process.env.DEPLOY_GATE_SKIP === '1') {
  warnOpen('DEPLOY_GATE_SKIP=1 is set — someone asked for an ungated deploy.');
  process.exit(0);
}

const tests = findTests(TEST_DIR);

if (process.argv.includes('--list')) {
  for (const f of tests) console.log(relative(ROOT, f));
  console.log(`${tests.length} test files under ${relative(ROOT, TEST_DIR) || TEST_DIR}`);
  process.exit(0);
}

if (tests.length === 0) {
  warnOpen(`no *.test.mjs files found under ${TEST_DIR} — discovery is broken or the dir moved.`);
  process.exit(0);
}

// ── run one file under a runner, with a timeout ──────────────────────────────
// Resolves { ok, code, spawnError, timedOut, out } — never rejects.
function runFile(runner, file, timeoutMs) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    let child;
    try {
      child = spawn(runner, [file], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return finish({ ok: false, spawnError: true, out: String(err) });
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      finish({ ok: false, timedOut: true, out: out + `\n(killed: exceeded ${timeoutMs / 1000}s timeout)` });
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (err) => finish({ ok: false, spawnError: true, out: out + String(err) }));
    child.on('close', (code) => finish({ ok: code === 0, code, out }));
  });
}

// ── prove a runner with the canary ───────────────────────────────────────────
// Candidates: env override, else bun first (repo-native), then whatever runtime
// is executing this very script (guaranteed to exist since we're running).
const candidates = (process.env.DEPLOY_GATE_RUNNERS
  ? process.env.DEPLOY_GATE_RUNNERS.split(',').map((s) => s.trim()).filter(Boolean)
  : ['bun', process.execPath]
).filter((r, i, a) => a.indexOf(r) === i);

if (!existsSync(CANARY)) {
  warnOpen(`canary missing at ${CANARY} — cannot prove any runner, so no runner may fail the build.`);
  process.exit(0);
}

let runner = null;
for (const cand of candidates) {
  const res = await runFile(cand, CANARY, CANARY_TIMEOUT_MS);
  if (res.ok) { runner = cand; break; }
  console.log(`  deploy gate: runner candidate "${cand}" failed the canary — skipping it`);
}

if (!runner) {
  warnOpen(
    `no runtime here can run the burma-script tests (tried: ${candidates.join(', ')}).\n` +
    '  each one failed the canary (scripts/deploy-gate-canary.mjs), which needs\n' +
    '  node:assert + tiptap ESM + bare json imports — the same surface the tests use.',
  );
  process.exit(0);
}

// ── run the suite ────────────────────────────────────────────────────────────
const POOL = Math.max(1, Math.min(cpus().length, tests.length));
console.log(`\n  deploy gate: ${tests.length} burma-script test files under "${runner}" (${POOL}-way parallel)\n`);

const results = Array.from({ length: tests.length });
let next = 0;
async function worker() {
  while (true) {
    const i = next++;
    if (i >= tests.length) return;
    results[i] = { file: tests[i], ...(await runFile(runner, tests[i], PER_FILE_TIMEOUT_MS)) };
  }
}
await Promise.all(Array.from({ length: POOL }, worker));

const failures = results.filter((r) => !r.ok && !r.spawnError);
const spawnErrors = results.filter((r) => r.spawnError);
const passed = results.filter((r) => r.ok).length;

for (const r of results) {
  if (!r.ok) console.log(`  ✗ ${relative(ROOT, r.file)}${r.timedOut ? ' (timeout)' : r.spawnError ? ' (spawn error)' : ''}`);
}

if (failures.length) {
  // FAIL-CLOSED: a proven runner ran these files and they are genuinely red.
  console.error(`\n  deploy gate: ${failures.length}/${tests.length} test file(s) FAILED (${passed} passed, ${elapsed()}) — BLOCKING DEPLOY\n`);
  for (const f of failures) {
    console.error(`  ── ${relative(ROOT, f.file)} ──`);
    console.error(f.out.split('\n').map((l) => '  ' + l).join('\n'));
  }
  process.exit(1);
}

if (spawnErrors.length) {
  // The runner passed the canary but then refused to spawn for some files —
  // that's an environment fault (fd exhaustion, binary vanished), not red tests.
  warnOpen(`runner "${runner}" passed the canary but failed to SPAWN for ${spawnErrors.length} file(s); 0 genuine test failures.`);
  process.exit(0);
}

console.log(`\n  deploy gate: all ${tests.length} test files passed in ${elapsed()} — deploy may proceed\n`);
process.exit(0);
