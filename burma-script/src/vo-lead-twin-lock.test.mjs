// vo-lead-twin-lock.test.mjs
//
// A FRONT-LOADED VERIFIER for the loop's single richest bug class: the "divergent-weaker twin."
//
// The regex that decides "does this line lead with a VO cue?" is HAND-COPIED into two files that
// have no shared module:
//   • burma-script/parser.ts     -> const VO_LEAD      (the IMPORTER: classifies a raw script line
//                                    as a VO block during ingest)
//   • burma-script/src/migrate-doc.js -> const VO_LEAD_MIG (the additive MIGRATION: reclassifies a
//                                    colonless-VO binBlock into a voBlock on load)
//
// migrate-doc.js's own comment says it "Mirror[s] parser.ts's VO_LEAD". Today the two literals are
// byte-identical. The only thing keeping them in sync is that comment + hope. That is EXACTLY the
// setup that has produced ~50 real bugs across this repo (FCP7 NTSC writer/reader, the cookie-regex
// gates, the Gemini leading-model-turn copies, the hour-drop formatters, the food-quiz shuffle...):
// someone tightens the VO rule in ONE copy and the other silently keeps the old behavior, so the
// SAME line is a VO on import but NOT on migration (or vice-versa) — a split-brain classification.
//
// This gate LOCKS the pair: the two regex literals (pattern + flags) must stay byte-identical, and
// a behavioral corpus mutation-proves what the rule actually does. If a future edit changes one
// copy without the other, `bun run test` goes RED and names the drift.
//
// Mutation-proven: change a byte of either regex literal -> the byte-identity check goes RED.
//                  weaken the corpus rule (e.g. drop the [:\s] lookahead) -> corpus checks go RED.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BS = join(HERE, '..');            // burma-script/
const PARSER = readFileSync(join(BS, 'parser.ts'), 'utf8');
const MIGRATE = readFileSync(join(HERE, 'migrate-doc.js'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }

// Pull the regex LITERAL (source + flags) assigned to a named const. Brace/bracket-aware only as
// far as a single-line regex literal needs: capture everything between the opening `/` and the
// closing `/flags`, honoring escaped slashes and `[...]` character classes (where `/` is literal).
function extractRegexLiteral(src, constName) {
  const re = new RegExp(`const ${constName}\\s*=\\s*/`);
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length; // now just past the opening slash
  let body = '', inClass = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { body += c + (src[i + 1] ?? ''); i++; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) break; // end of pattern
    body += c;
  }
  // flags run to the end of the token (letters only)
  let flags = '';
  for (i++; i < src.length; i++) {
    const c = src[i];
    if (/[a-z]/i.test(c)) flags += c; else break;
  }
  return { source: body, flags };
}

const A = extractRegexLiteral(PARSER, 'VO_LEAD');
const B = extractRegexLiteral(MIGRATE, 'VO_LEAD_MIG');

ok(A != null, 'VO_LEAD literal found in parser.ts');
ok(B != null, 'VO_LEAD_MIG literal found in migrate-doc.js');

// (1) The two literals must be byte-identical — pattern AND flags.
if (A && B) {
  ok(A.source === B.source,
     `VO_LEAD pattern drifted:\n    parser.ts:      /${A.source}/\n    migrate-doc.js: /${B.source}/`);
  ok(A.flags === B.flags,
     `VO_LEAD flags drifted: parser.ts "${A.flags}" vs migrate-doc.js "${B.flags}"`);
}

// (2) Behavioral corpus. Compile the shared rule from parser.ts's literal (proven identical above,
// so this exercises BOTH copies). Each case mutation-proves a distinct load-bearing clause.
if (A) {
  const RE = new RegExp(A.source, A.flags);
  const hit = (s) => RE.test(s);

  // Leads that MUST be recognized as VO:
  ok(hit('VO: the border was quiet'),      'plain "VO:" is a VO lead');
  ok(hit('VO the narrator begins'),         'VO + space (no colon) is a VO lead');   // (?=[:\s])
  ok(hit('vo: lowercase'),                  'lowercase "vo:" is a VO lead (i flag)');
  ok(hit('- VO: dashed line'),              'leading dash + space is tolerated');    // ^-?\s*
  ok(hit('-VO: tight dash'),                'leading dash with no space is tolerated');
  ok(hit('   VO: indented'),                'leading whitespace is tolerated');       // \s*
  ok(hit('[00:12] VO: with a cue'),         'a [cue] prefix is stepped over');        // (?:\[..\]\s*\+?\s*)?
  ok(hit('[cue] + VO: plus join'),          'a [cue] + join is stepped over');        // \+?
  ok(hit('[cue]VO: no gap after cue'),      'a [cue] with no trailing gap still leads');

  // Leads that must NOT be misread as VO:
  ok(!hit('VOICE: not a VO'),               '"VOICE:" is NOT a VO lead');             // (?=[:\s]) after VO
  ok(!hit('VOX pop'),                        '"VOX" is NOT a VO lead');
  ok(!hit('VO'),                             'bare "VO" at end-of-string is NOT a lead (needs :/space)');
  ok(!hit('AVO: avocado'),                   'a line not starting at VO is NOT a lead');
  ok(!hit('SOT: interview'),                 'a SOT line is NOT a VO lead');
  ok(!hit('the VO comes later'),             'VO mid-line is NOT a lead (anchored at ^)');
  ok(!hit('[unclosed VO: cue'),              'an unclosed [cue bracket does NOT let VO lead');
}

console.log(`vo-lead-twin-lock: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
