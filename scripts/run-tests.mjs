#!/usr/bin/env bun
// run-tests.mjs — the one command that runs the whole mycoldmars test suite.
//
// Why this exists: the repo's tests are hand-rolled assert scripts spread across
// translation/, burma-script/, tools/, api/, and queen-scarlet-school/. They print
// their own "N passed, 0 failed" summaries and (correctly) exit 0/1. But they were
// only ever runnable one file at a time, with mixed runtimes — most run under node,
// but the ones that import a .ts module (ffprobe-meta) crash under node and need bun,
// and parse-test.ts reads a fixture relative to its own directory. So there was no
// single "is the repo green?" command, and running them by hand was error-prone.
//
// This runner runs EVERY suite under bun (which handles .mjs and .ts uniformly),
// from the correct working directory, aggregates by exit code, and exits nonzero if
// any suite fails. Run it with:  bun run test   (or: bun scripts/run-tests.mjs)
//
// Adding a new test: drop a *.test.mjs anywhere and it's auto-discovered. For a .ts
// test (or one with a special cwd) add a line to EXPLICIT_TESTS below.

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IGNORE_DIRS = new Set(['node_modules', 'dist', '.git', '.vercel']);

// Recursively find every *.test.mjs under the repo (skipping build/dep dirs).
function findMjsTests(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (IGNORE_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...findMjsTests(full));
    else if (name.endsWith('.test.mjs')) out.push({ file: full });
  }
  return out;
}

// .ts tests (and any test needing a non-root cwd) are listed explicitly.
// All three burma-script .ts tests run from burma-script/: parse-test.ts reads
// ./sample-script.txt relative to cwd; the other two are cwd-agnostic but live there.
const EXPLICIT_TESTS = [
  { file: join(ROOT, 'burma-script/parse-test.ts'), cwd: join(ROOT, 'burma-script') },
  { file: join(ROOT, 'burma-script/routing-test.ts'), cwd: join(ROOT, 'burma-script') },
  { file: join(ROOT, 'burma-script/roundtrip-test.ts'), cwd: join(ROOT, 'burma-script') },
  { file: join(ROOT, 'burma-script/list-roundtrip-test.ts'), cwd: join(ROOT, 'burma-script') },
];

const tests = [...findMjsTests(ROOT), ...EXPLICIT_TESTS]
  .sort((a, b) => a.file.localeCompare(b.file));

// Pull the most informative one-line summary out of a test's stdout, ignoring the
// MODULE_TYPELESS_PACKAGE_JSON noise node prints for extensionless ES modules.
function summaryLine(stdout) {
  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/MODULE_TYPELESS|Reparsing as ES module|trace-warnings|performance overhead|add "type": "module"/.test(l));
  const scored = lines.filter((l) => /\bpass|\bfail|\bok\b|✓|✗/i.test(l));
  return (scored.length ? scored[scored.length - 1] : lines[lines.length - 1]) || '(no output)';
}

console.log(`\n  mycoldmars test suite — ${tests.length} suites (bun)\n`);

let failed = 0;
const failures = [];
for (const { file, cwd } of tests) {
  const rel = relative(ROOT, file);
  const res = spawnSync('bun', [file], {
    cwd: cwd || ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ok = res.status === 0;
  const summary = summaryLine(res.stdout || '');
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${rel.padEnd(48)} ${summary}`);
  if (!ok) {
    failed++;
    failures.push({ rel, out: (res.stdout || '') + (res.stderr || '') });
  }
}

if (failed) {
  console.log(`\n\x1b[31m  ${failed}/${tests.length} suite(s) FAILED\x1b[0m`);
  for (const f of failures) {
    console.log(`\n  ── ${f.rel} ──`);
    console.log(f.out.split('\n').map((l) => '  ' + l).join('\n'));
  }
  process.exit(1);
}

console.log(`\n\x1b[32m  all ${tests.length} suites passed\x1b[0m\n`);
process.exit(0);
