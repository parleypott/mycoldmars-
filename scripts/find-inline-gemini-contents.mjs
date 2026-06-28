#!/usr/bin/env bun
//
// find-inline-gemini-contents.mjs — audit every Gemini caller for an INLINE
// chat-history → `contents` builder and force a human to confirm it can't ship a
// leading `model` turn (which Gemini rejects with a 500 on the whole chat).
//
// WHY THIS EXISTS
// "Gemini multi-turn request begins with a `model` turn" is one of the loop's
// single most recurring PROJECT bug classes — fixed across cutter.js,
// api/gemini.js (handleChat + handleScriptChat), nano-banana.js (tutor fallback +
// Scribe + Storyboard), walden-design.js, and called out again and again in the
// backlog ("4 surviving leading-model-turn copies", "Gemini chat contents could
// begin with a model turn", "Cutter — Gemini chat contents could begin with a
// model turn", …). The shape is always the same:
//
//     const contents = history.slice(-10).map(m => ({
//       role: m.role === 'user' ? 'user' : 'model',
//       parts: [{ text: m.content }],
//     }));
//     contents.push({ role: 'user', parts: [{ text: message }] });
//     // → POST :generateContent
//
// Gemini REQUIRES a multi-turn `contents` array to BEGIN with a `user` turn — an
// array whose first element has role 'model' is rejected ("First content should
// be with role 'user'"). A loaded / seeded history that OPENS on an assistant
// turn (a seeded greeting is a near-universal chat-UI pattern) — or any short
// slice window that happens to start on a model turn — leaves a leading model
// turn and 500s the entire chat. It is invisible in a quick test: a history that
// happens to start on a user turn behaves perfectly.
//
// The fix the loop standardized: route every chat-history build through the
// shared, mutation-locked helper api/_lib/gemini-chat-contents.js —
//   buildGeminiHistoryContents(history, {window})  → history turns, leading
//                                                     model turns DROPPED
//   buildGeminiChatContents(history, message, …)    → the above + appended user
// — which strips leading model turns (`while (windowed[0].role === 'model')
// windowed.shift()`) and string-coerces every part. The class recurred precisely
// because a NEW handler kept reintroducing its OWN inline `.map(... role ...
// parts ...)` instead of importing the helper.
//
// NO existing gate looks for this. find-divergent-fns.sh groups by function
// NAME, but these are anonymous inline `.map` callbacks in unrelated handlers —
// invisible to it. The per-call unit tests (gemini-chat-contents.test.mjs,
// cutter-prompt.test.mjs) lock the EXISTING callers but say nothing about the
// NEXT handler Johnny ships. This closes the class so a new inline builder trips
// `bun run test` immediately.
//
// WHAT IT SCANS
// Every api/**/*.js (skipping tests, minified bundles, and the canonical helper
// itself). A file is IN SCOPE only if it is a Gemini caller (`generateContent` /
// `generativelanguage`). For each in-scope file it classifies:
//
//   GUARDED — either routes its chat history through the shared helper
//             (imports/uses buildGeminiChatContents / buildGeminiHistoryContents
//             / gemini-chat-contents), OR has NO inline history→turns builder at
//             all (a single-shot `contents: [{ role:'user', parts:[…] }]` request
//             can't lead with a model turn — there's only one user turn).
//   NAIVE   — has an INLINE `.map(… role: … parts: …)` history→turns builder and
//             does NOT use the shared helper. Crash-prone: a history opening on a
//             model turn ships a leading model turn → 500.
//
// The inline-builder signal is a `.map(` whose callback body produces BOTH a
// `role:` and a `parts:` key (in either order, within a bounded window) — exactly
// the history-turn shape every past instance had. A single-shot request uses a
// LITERAL `[{ role:'user', parts:[…] }]` with no `.map` wrapping the role, so it
// never matches. Proven zero false-positives on the live repo at authoring time.
//
// WHY A LEDGER
// A caller might build turns in a shape the regex can't model (a hand-rolled
// for-loop that already drops leading model turns, say). Rather than turn
// `bun run test` red on a safe-but-quirky caller, --check fails only on a NAIVE
// site nobody has judged yet, cross-referencing
// scripts/inline-gemini-contents-triage.tsv. A genuinely-safe NAIVE gets one
// ledger row (status SAFE + reason); a real one gets routed through the helper.
// (Same proven design as find-naive-body-read.mjs / find-truthy-zero.mjs.)
//
// USAGE
//   scripts/find-inline-gemini-contents.mjs              # table of every Gemini caller + verdict
//   scripts/find-inline-gemini-contents.mjs --check      # exit 1 if any NEW (untriaged) NAIVE caller exists
//   scripts/find-inline-gemini-contents.mjs --self-test  # prove the classifier on fixtures
//   scripts/find-inline-gemini-contents.mjs --new        # list ONLY untriaged NAIVE callers
//
// OUTPUT (one line per in-scope file): <STATUS>  <file>  [<verdict>]

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'scripts', 'inline-gemini-contents-triage.tsv');

const SCAN_DIR = join(ROOT, 'api');
const EXT = /\.js$/;
const SKIP = /(\.test\.|\.spec\.|\.min\.|node_modules)/;
// The canonical home of the inline turn-map shape — this is where it BELONGS.
const HELPER_BASENAME = 'gemini-chat-contents.js';

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      walk(p, out);
    } else if (EXT.test(name) && !SKIP.test(p)) {
      out.push(p);
    }
  }
}

function sourceFiles() {
  const out = [];
  walk(SCAN_DIR, out);
  return out.sort();
}

// Blank out comments + string/template literals (overwrite with spaces, byte
// offsets preserved) so a `role:`/`parts:` example inside a docstring — or a
// `generateContent` mention in a comment — never registers as real code.
// Pragmatic, not a full lexer: misreads can only DROP a match, never invent one.
function stripCommentsAndStrings(src) {
  const out = src.split('');
  let inStr = null, prev = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inStr) {
      if (c !== '\n') out[i] = ' ';
      if (c === inStr && prev !== '\\') inStr = null;
      prev = c === '\\' && prev === '\\' ? '' : c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; out[i] = ' '; prev = c; continue; }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') { out[i] = ' '; i++; }
      i--; prev = ''; continue;
    }
    if (c === '/' && n === '*') {
      out[i] = ' '; out[i + 1] = ' '; i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < src.length) { out[i] = ' '; out[i + 1] = ' '; i++; }
      prev = ''; continue;
    }
    prev = c;
  }
  return out.join('');
}

// Strip ONLY comments (line + block), preserving string literals — used for the
// Gemini-caller signal, which lives in URL/method string literals. String-aware
// so a `//` or `/*` INSIDE a string is not mistaken for a comment.
function stripComments(src) {
  const out = src.split('');
  let inStr = null, prev = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inStr) {
      if (c === inStr && prev !== '\\') inStr = null;
      prev = c === '\\' && prev === '\\' ? '' : c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; prev = c; continue; }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') { out[i] = ' '; i++; }
      i--; prev = ''; continue;
    }
    if (c === '/' && n === '*') {
      out[i] = ' '; out[i + 1] = ' '; i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < src.length) { out[i] = ' '; out[i + 1] = ' '; i++; }
      prev = ''; continue;
    }
    prev = c;
  }
  return out.join('');
}

// Does the source contain an inline `.map(… => …{ role: … parts: … })` turn
// builder? Matches role-then-parts and parts-then-role within a bounded window
// after a `.map(`, so it never spans unrelated code. (`for`-loop turn builders
// are caught by the ledger path, not here — none exist in-repo.)
function hasInlineTurnMapper(src) {
  const ROLE_PARTS = /\.map\s*\([^)]*=>[\s\S]{0,260}?\brole\s*:[\s\S]{0,200}?\bparts\s*:/;
  const PARTS_ROLE = /\.map\s*\([^)]*=>[\s\S]{0,260}?\bparts\s*:[\s\S]{0,200}?\brole\s*:/;
  return ROLE_PARTS.test(src) || PARTS_ROLE.test(src);
}

// Classify one source string. Returns { gemini, status, why } where status is one
// of 'GUARDED' | 'NAIVE' | 'NA' (not a Gemini caller / is the helper).
export function classifySource(rawSrc, base = '') {
  if (base === HELPER_BASENAME) return { gemini: false, status: 'NA', why: 'canonical helper' };
  const src = stripCommentsAndStrings(rawSrc);

  // The Gemini signal lives in STRING literals — the request URL / method name
  // (`fetch('…:generateContent')`, the `generativelanguage.googleapis.com` host)
  // — so it must be detected on the comment-stripped-but-string-KEPT source, not
  // the fully-stripped one (which blanks those strings). Stripping comments still
  // prevents a docstring mention from inflating scope.
  const noComments = stripComments(rawSrc);
  const gemini = /\bgenerateContent\b/.test(noComments) || /generativelanguage/.test(noComments);
  if (!gemini) return { gemini: false, status: 'NA', why: 'not a Gemini caller' };

  // Routes its chat history through the shared, leading-model-dropping helper.
  // (Helper call sites and the import specifier both survive comment-stripping.)
  const usesHelper =
    /buildGeminiChatContents|buildGeminiHistoryContents/.test(noComments) ||
    /gemini-chat-contents/.test(noComments);

  if (usesHelper) return { gemini: true, status: 'GUARDED', why: 'shared helper' };

  // An inline history→turns map with no helper is the crash-prone reintroduction.
  if (hasInlineTurnMapper(src)) {
    return { gemini: true, status: 'NAIVE', why: 'inline history→turns map, no helper' };
  }

  // Single-shot request (literal one-user-turn contents) — can't lead with model.
  return { gemini: true, status: 'GUARDED', why: 'single-shot / no inline history map' };
}

function classifyFile(path) {
  let src;
  try { src = readFileSync(path, 'utf8'); } catch { return null; }
  const r = classifySource(src, basename(path));
  return { ...r, path, rel: relative(ROOT, path) };
}

// ── Ledger ──────────────────────────────────────────────────────────────────
// TSV: FILE <TAB> STATUS <TAB> REASON   (# = comment / blank skipped)
function readLedger() {
  let txt;
  try { txt = readFileSync(LEDGER, 'utf8'); } catch { return new Map(); }
  const map = new Map();
  for (const raw of txt.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.startsWith('#')) continue;
    const [file, status, ...reason] = line.split('\t');
    if (!file || !status) continue;
    map.set(file.trim(), { status: status.trim().toUpperCase(), reason: reason.join('\t').trim() });
  }
  return map;
}

function allCallers() {
  return sourceFiles().map(classifyFile).filter(Boolean).filter((r) => r.gemini);
}

// ── Self-test ─────────────────────────────────────────────────────────────────
function selfTest() {
  let pass = 0, fail = 0;
  const expect = (label, src, want, base = '') => {
    const got = classifySource(src, base).status;
    if (got === want) pass++;
    else { fail++; console.log(`  ✗ ${label}: got ${got}, expected ${want}`); }
  };

  // NAIVE — Gemini caller with an inline history→turns map, no helper.
  expect('inline role→parts map',
    `const contents = history.slice(-10).map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));
     await fetch(url + ':generateContent', { body: JSON.stringify({ contents }) });`,
    'NAIVE');
  expect('inline parts→role map',
    `const turns = msgs.map(m => ({ parts: [{ text: m.content }], role: m.role }));
     const r = await model.generateContent({ contents: turns });`,
    'NAIVE');
  expect('generativelanguage host, inline map',
    `const c = h.map(x => ({ role: x.who, parts: [{ text: x.t }] }));
     fetch('https://generativelanguage.googleapis.com/...', { body: JSON.stringify({ contents: c }) });`,
    'NAIVE');

  // GUARDED — routes through the shared helper.
  expect('uses buildGeminiChatContents',
    `import { buildGeminiChatContents } from './_lib/gemini-chat-contents.js';
     const contents = buildGeminiChatContents(history, message);
     await model.generateContent({ contents });`,
    'GUARDED');
  expect('uses buildGeminiHistoryContents',
    `const turns = buildGeminiHistoryContents(history, { window: 10 });
     turns.push({ role: 'user', parts });
     await fetch(url + ':generateContent', {});`,
    'GUARDED');
  // GUARDED — single-shot request, literal one-user-turn contents (no .map turn map).
  expect('single-shot literal contents',
    `const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }] };
     await fetch(url + ':generateContent', { body: JSON.stringify(body) });`,
    'GUARDED');
  expect('single-shot, image parts .map but no role in map',
    `const parts = images.map(i => ({ inlineData: i }));
     parts.push({ text: prompt });
     await model.generateContent({ contents: [{ role: 'user', parts }] });`,
    'GUARDED');

  // NA — not a Gemini caller.
  expect('anthropic messages map (no Gemini)',
    `const messages = history.map(m => ({ role: m.role, content: m.text }));
     await fetch('https://api.anthropic.com/v1/messages', { body: JSON.stringify({ messages }) });`,
    'NA');
  expect('the canonical helper itself is exempt',
    `export function buildGeminiHistoryContents(history) {
       return history.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));
     }`,
    'NA', HELPER_BASENAME);

  // Comment/string immunity: a docstring example must not register as code.
  expect('comment example ignored',
    `// const c = history.map(m => ({ role: m.role, parts: [{ text: m.content }] })); generateContent
     export default () => 1;`,
    'NA');

  console.log(`\nself-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const args = new Set(process.argv.slice(2));

if (args.has('--self-test')) {
  process.exit(selfTest() ? 0 : 1);
}

const ledger = readLedger();
const callers = allCallers();
const judged = callers.map((h) => {
  const hit = ledger.get(h.rel);
  const effective = (h.status === 'NAIVE' && hit && hit.status === 'SAFE') ? 'SAFE' : h.status;
  return { ...h, effective, ledger: hit };
});

const newNaive = judged.filter((h) => h.status === 'NAIVE' && h.effective === 'NAIVE');

if (args.has('--new')) {
  for (const h of newNaive) console.log(`NAIVE  ${h.rel}  [${h.why}]`);
  process.exit(newNaive.length ? 1 : 0);
}

if (args.has('--check')) {
  if (newNaive.length) {
    console.log('Inline Gemini chat-history builder(s) with no shared helper and no ledger verdict:\n');
    for (const h of newNaive) console.log(`  NAIVE  ${h.rel}  [${h.why}]`);
    console.log(`\n→ ${newNaive.length} inline builder(s). Route the history through`);
    console.log('  api/_lib/gemini-chat-contents.js (buildGeminiChatContents / buildGeminiHistoryContents)');
    console.log('  OR add a SAFE row to scripts/inline-gemini-contents-triage.tsv.');
    process.exit(1);
  }
  console.log(`find-inline-gemini-contents: ${judged.length} Gemini caller(s), 0 inline builders.`);
  process.exit(0);
}

// Default: full table.
console.log('Gemini callers (leading-model-turn → 500 crash class):');
console.log('  STATUS    FILE   [GUARDED=helper/single-shot · NAIVE=inline history map, crash-prone]');
let g = 0, n = 0, s = 0;
for (const h of judged) {
  if (h.effective === 'GUARDED') g++;
  else if (h.effective === 'SAFE') s++;
  else n++;
  const tag = h.effective === 'NAIVE' ? 'NAIVE  ' : (h.effective === 'SAFE' ? 'SAFE   ' : 'GUARDED');
  console.log(`  ${tag}   ${h.rel}  [${h.why}]`);
}
console.log(`→ ${judged.length} Gemini caller(s): ${g} GUARDED, ${s} ledger-SAFE, ${n} NAIVE.`);
process.exit(0);
