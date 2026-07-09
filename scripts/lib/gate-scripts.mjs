// gate-scripts.mjs — the ONE source of truth for WHICH scripts/find-*.{mjs,sh} are
// shape-scanner GATES.
//
// A gate is a script in scripts/ named find-*.{mjs,sh} whose source implements BOTH the
// `--self-test` and `--check` contract (both flag literals present). That contract is the
// definition of a gate, so membership is discovered FROM DISK, never hand-listed:
//
//   • run-tests.mjs runs each gate's --self-test + --check on every `bun run test`.
//   • find-untested-cores.mjs treats a gate (and the shared cores it imports) as
//     self-test-covered, so it isn't re-flagged as an untested "gap".
//   • untested-cores-selftest-aware.test.mjs locks that coupling.
//
// All three import THIS. So adding a new gate = drop the find-*.mjs file (with a
// --self-test + --check mode) and it auto-wires into the suite, the census, and the lock
// with ZERO edit to any of them — the same forget-proofing the *.test.mjs auto-glob gives
// suites. The OLD design hardcoded the list in run-tests.mjs and re-parsed it by regex in
// two other files: three copies, one forgotten append away from a silent false-green.
//
// Triage/census tools (find-divergent-fns.sh, diff-divergent-fn.sh, find-untested-cores.mjs)
// implement no --self-test+--check pass/fail contract, so they're excluded by construction.

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// scripts/lib/gate-scripts.mjs → scripts/
export const SCRIPTS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

const GATE_NAME_RE = /^find-.*\.(mjs|sh)$/;

// True iff a script's source implements the gate contract (dispatches on BOTH CLI modes).
//
// The discriminator is convention-aware so a COMMENT that merely mentions the flags can't
// masquerade as a gate (find-untested-cores.mjs is a census whose docs name --self-test):
//   • .mjs gates dispatch argv with QUOTED literals — `argv.includes('--check')`,
//     `mode === "--self-test"` — so we require both flags as quoted string literals.
//     (All real .mjs gates satisfy this; a prose comment using bare --check does not.)
//   • .sh gates dispatch via case-arms (`--check)`) which aren't quoted, so for shell we
//     fall back to a raw substring of both flags. The only non-gate .sh (find-divergent-fns.sh)
//     carries neither flag, so this stays unambiguous.
// A flag appears as a quoted string literal iff src contains "'--flag'" or '"--flag"'.
const hasQuotedFlag = (src, flag) => src.includes(`'${flag}'`) || src.includes(`"${flag}"`);
export function isGateContract(src, isShell) {
  if (isShell) return src.includes('--self-test') && src.includes('--check');
  return hasQuotedFlag(src, '--self-test') && hasQuotedFlag(src, '--check');
}

// Sorted basenames of every gate script (e.g. 'find-truthy-zero.mjs'). Deterministic
// order via localeCompare (an explicit comparator, not a bare lexicographic .sort()).
export function gateBasenames(scriptsDir = SCRIPTS_DIR) {
  const out = [];
  let names;
  try { names = readdirSync(scriptsDir); } catch { return out; }
  for (const name of names) {
    if (!GATE_NAME_RE.test(name)) continue;
    let src;
    try { src = readFileSync(join(scriptsDir, name), 'utf8'); } catch { continue; }
    if (isGateContract(src, name.endsWith('.sh'))) out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
