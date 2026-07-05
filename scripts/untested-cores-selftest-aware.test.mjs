// Locks the coverage census's THIRD coverage layer: gate scripts whose --self-test
// mode is executed by the suite runner (scripts/run-tests.mjs SHELL_GATES/BUN_GATES)
// must NOT be reported as untested "gaps". The import-only census was blind to
// --self-test coverage and re-flagged find-inline-gemini-contents.mjs,
// find-naive-body-read.mjs, and the shared sort-comparators.js classifier they
// import as gaps EVERY iteration — pure recurring triage waste. This test proves
// (a) no runner-executed gate appears in gaps, and (b) the specific 3 that used to
// leak are covered. Mutation check: delete the `selfTestedByRunner.has(real)` skip
// in find-untested-cores.mjs and this test goes RED.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.error('FAIL:', m); } };

// Run the census in machine-readable mode.
const out = execFileSync('node', [join(HERE, 'find-untested-cores.mjs'), '--json'], {
  encoding: 'utf8', cwd: ROOT, maxBuffer: 8 * 1024 * 1024,
});
const census = JSON.parse(out);
const gaps = new Set(census.gaps || []);

// Parse the runner's actual gate lists — the same source of truth the census reads.
const runnerSrc = readFileSync(join(HERE, 'run-tests.mjs'), 'utf8');
const gateBasenames = [];
for (const m of runnerSrc.matchAll(/const\s+(?:SHELL|BUN)_GATES\s*=\s*\[([^\]]*)\]/g)) {
  for (const lit of m[1].matchAll(/['"]([^'"]+\.(?:mjs|js|sh))['"]/g)) gateBasenames.push(lit[1]);
}
ok(gateBasenames.length >= 20, `runner exposes a real gate list (got ${gateBasenames.length})`);

// (a) No runner-executed gate script is ever reported as an untested gap.
for (const b of gateBasenames) {
  ok(!gaps.has(`scripts/${b}`), `self-tested gate scripts/${b} must not be a census gap`);
}

// (b) The 3 that historically leaked are gone (guards against a partial regression
// where the list-parse silently returns nothing).
for (const leaked of ['scripts/find-inline-gemini-contents.mjs', 'scripts/find-naive-body-read.mjs', 'scripts/sort-comparators.mjs']) {
  ok(!gaps.has(leaked), `${leaked} (self-tested via a runner gate) must not be a census gap`);
}

console.log(`untested-cores-selftest-aware: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
