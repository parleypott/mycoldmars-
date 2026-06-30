/**
 * Twin-lock: QSS literal-escape normalizer must stay identical across all copies.
 * Run: bun queen-scarlet-school/escape-normalizer-twinlock.test.mjs
 *
 * Henry's story-block text reaches QSS down three independent write paths, and EACH carries
 * its own inline copy of the same "unescape literal \n / \r / \t" chain:
 *
 *   1. runAutoBuild(sourceText)   — the paste/auto-build ingest front door
 *   2. repairLiteralEscapes()     — the on-open self-heal that rewrites EXISTING stored blocks
 *   3. addVerbatimBlock(text)     — the "add this verbatim" ingest path
 *
 * They MUST apply byte-for-byte the same transform. If one drifts (someone teaches the
 * self-heal to also unescape, say, \f, but forgets the two ingest paths — or vice-versa), the
 * SAME paste corrupts or self-heals differently depending on which door Henry walked through,
 * and a child's story text silently diverges from itself. That's the exact divergent-copy
 * class this loop keeps closing; here the cost is data integrity on a kid's creative work.
 * This test fails the moment the three copies stop agreeing.
 *
 * It also unit- + mutation-locks the canonical transform's BEHAVIOR (not just that the copies
 * match each other), so "all three agree on the wrong thing" can't pass silently.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n   got:  ${g}\n   want: ${w}`); }
};
const ok = (cond, msg) => eq(!!cond, true, msg);

// --- Extract every escape-normalizer chain from the live HTML -----------------
// A chain starts at `.replace(/\\r\\n/g, '\n')` (the leading CRLF rule, which uniquely
// identifies these normalizers and not the dozens of other .replace() calls in the file) and
// runs through the contiguous `.replace(...)` calls that follow, ignoring whitespace between
// them. We normalize each chain to an ordered list of "/pattern/flags => 'replacement'"
// tuples so layout differences (1-line vs 4-line) don't matter but a SEMANTIC change
// (added/removed/reordered/retargeted rule) does.

// One `.replace(/PATTERN/FLAGS, 'REPLACEMENT')` call. PATTERN and REPLACEMENT contain
// backslash escapes (they always do here), so allow escaped chars inside both.
const REPLACE_CALL = /\.replace\(\/((?:[^/\\]|\\.)+)\/(\w*),\s*'((?:[^'\\]|\\.)*)'\)/g;

function extractChains(src) {
  const chains = [];
  // Anchor on the leading CRLF rule. In the FILE the pattern is written `/\\r\\n/g` — the
  // source bytes contain DOUBLE backslashes (a regex matching a literal backslash+r), so the
  // anchor must look for `\\\\r\\\\n`. From each anchor, walk forward consuming only
  // whitespace + further `.replace(...)` calls; stop at the first non-replace token.
  const anchorRe = /\.replace\(\/\\\\r\\\\n\/g,\s*'\\n'\)/g;
  let a;
  while ((a = anchorRe.exec(src)) !== null) {
    let i = a.index;
    const tuples = [];
    REPLACE_CALL.lastIndex = i;
    let m;
    while ((m = REPLACE_CALL.exec(src)) !== null) {
      if (m.index !== i) {
        const gap = src.slice(i, m.index);
        if (!/^\s*$/.test(gap)) break; // only whitespace may separate contiguous calls
      }
      tuples.push(`/${m[1]}/${m[2]} => '${m[3]}'`);
      i = REPLACE_CALL.lastIndex;
    }
    chains.push(tuples);
  }
  return chains;
}

const chains = extractChains(HTML);

// 1) The lockstep set is exactly three copies. A new copy on a 4th write path must join the
//    set deliberately (bump this count) so it can't slip in unguarded.
eq(chains.length, 3, 'exactly three escape-normalizer copies (runAutoBuild + repairLiteralEscapes + addVerbatimBlock)');

// 2) All copies apply the IDENTICAL ordered transform.
if (chains.length >= 2) {
  const canonical = JSON.stringify(chains[0]);
  chains.forEach((chain, idx) => {
    eq(JSON.stringify(chain), canonical, `escape-normalizer copy #${idx + 1} matches copy #1`);
  });
} else {
  fail++; console.error('FAIL: need at least two copies to compare');
}

// 3) The canonical chain is exactly the four expected rules, in order. Tuples carry the FILE's
//    double-backslash source form (a regex matching literal \r etc).
eq(chains[0], [
  "/\\\\r\\\\n/g => '\\n'", // CRLF (escaped) -> one newline, FIRST so \r\n collapses to a single \n
  "/\\\\n/g => '\\n'",      // lone literal \n -> newline
  "/\\\\r/g => '\\n'",      // lone literal \r -> newline
  "/\\\\t/g => '\\t'",      // literal \t -> tab
], 'canonical chain is the four expected rules in order');

// --- Behavior + mutation lock on the canonical transform ----------------------
// A faithful JS copy of the chain. In the live file it runs on a SOURCE string where the
// escapes are LITERAL two-char sequences (backslash + n), because the corruption baked the
// JSON escape as visible text. Model that by feeding strings that literally contain "\\n" etc.
function repairLiteral(text) {
  return String(text == null ? '' : text)
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t');
}
const LIT = { n: '\\n', r: '\\r', t: '\\t', rn: '\\r\\n' };

// literal \n\n becomes a real paragraph break (the original corruption symptom)
{
  const corrupted = `Scarlet drew her sword.${LIT.n}${LIT.n}The dragon roared.`;
  eq(repairLiteral(corrupted), 'Scarlet drew her sword.\n\nThe dragon roared.', 'literal \\n\\n -> real paragraph break');
  ok(!repairLiteral(corrupted).includes('\\n'), 'no literal backslash-n survives (no "backslash n" read aloud)');
}

// literal \r\n collapses to a SINGLE newline — the CRLF rule MUST run first, else "\r\n"
// becomes "\r" + newline then "\r" -> newline, yielding TWO newlines. Order is load-bearing.
eq(repairLiteral(`a${LIT.rn}b`), 'a\nb', 'literal \\r\\n -> single newline (CRLF rule first)');

// literal \t -> tab; lone literal \r -> newline
eq(repairLiteral(`col1${LIT.t}col2`), 'col1\tcol2', 'literal \\t -> tab');
eq(repairLiteral(`line1${LIT.r}line2`), 'line1\nline2', 'lone literal \\r -> newline');

// clean prose untouched; nullish input safe
{
  const clean = 'Once upon a time, Queen Scarlet ruled with kindness.';
  eq(repairLiteral(clean), clean, 'clean prose untouched');
  eq(repairLiteral(null), '', 'null -> ""');
  eq(repairLiteral(undefined), '', 'undefined -> ""');
}

// teeth on the ordering: a normalizer MISSING the leading \r\n rule double-spaces a CRLF.
{
  const missingCrlfFirst = (t) =>
    String(t).replace(/\\n/g, '\n').replace(/\\r/g, '\n').replace(/\\t/g, '\t');
  eq(missingCrlfFirst(`a${LIT.rn}b`), 'a\n\nb', 'dropping CRLF-first rule double-spaces (the bug ordering prevents)');
  ok(missingCrlfFirst(`a${LIT.rn}b`) !== repairLiteral(`a${LIT.rn}b`), 'mutation differs from canonical');
}

console.log(`escape-normalizer-twinlock: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
