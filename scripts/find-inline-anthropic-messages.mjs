#!/usr/bin/env bun
//
// find-inline-anthropic-messages.mjs — audit every Anthropic Messages API caller
// for an INLINE chat-history → `messages` builder and force a human to confirm it
// can't ship a leading `assistant` turn (which the API rejects with a 400 on the
// whole request).
//
// WHY THIS EXISTS
// This is the ANTHROPIC MIRROR of find-inline-gemini-contents.mjs. The Gemini side
// ("multi-turn `contents` begins with a `model` turn → 500") was one of the loop's
// single most recurring PROJECT bug classes and got its own standing gate. The
// Anthropic Messages API has the exact same landmine — and it bit the SAME feature
// area repeatedly (Interpreter devchat, the editorial copilot, QSS Freestyle,
// cutter) — yet had NO gate on this side. The shape is always the same:
//
//     const messages = history.map(m => ({
//       role: m.role === 'user' ? 'user' : 'assistant',
//       content: m.content,
//     }));
//     messages.push({ role: 'user', content: message });
//     // → POST https://api.anthropic.com/v1/messages   { messages }
//
// The Anthropic Messages API REQUIRES the `messages` array to BEGIN with a `user`
// turn — an array whose first element has role 'assistant' is rejected ("messages:
// first message must use the \"user\" role"). A loaded / seeded history that OPENS
// on an assistant turn (a seeded greeting is a near-universal chat-UI pattern) — or
// any short slice window that happens to start on an assistant turn — leaves a
// leading assistant turn and 400s the whole request. It is invisible in a quick
// test: a history that happens to start on a user turn behaves perfectly.
// (Consecutive same-role turns are the second failure mode — some models merge
// them, some 400 on "roles must alternate".)
//
// The fix the loop standardized: route every chat-history build through the shared,
// mutation-locked helper api/_lib/anthropic-messages.js —
//   normalizeAnthropicMessages(messages)  → drops leading non-`user` turns, merges
//                                            consecutive same-role turns, drops empty
//                                            turns; byte-equivalent for an already-
//                                            valid alternating array.
// — used today by qss-freestyle.js, devchat-respond.js, and _lib/tutor-claude.js.
// The class recurs precisely because a NEW handler reintroduces its OWN inline
// `.map(... role ... content ...)` instead of importing the helper.
//
// NO existing gate looks for this. find-divergent-fns.sh groups by function NAME,
// but these are anonymous inline `.map` callbacks in unrelated handlers — invisible
// to it. find-inline-gemini-contents is Gemini-only (it keys on `role`+`parts` and
// treats an Anthropic `role`+`content` map as NA — see its own self-test). The
// per-call unit tests lock the EXISTING callers but say nothing about the NEXT
// handler Johnny ships. This closes the class so a new inline builder trips
// `bun run test` immediately.
//
// WHAT IT SCANS
// Every api/**/*.js (skipping tests, minified bundles, and the canonical helper
// itself). A file is IN SCOPE only if it is an Anthropic Messages caller
// (`api.anthropic.com`, `anthropic-version` header, or the SDK `.messages.create(`).
// For each in-scope file it classifies:
//
//   GUARDED — either routes its chat history through the shared helper
//             (imports/uses normalizeAnthropicMessages / anthropic-messages), OR has
//             NO inline history→turns builder at all (a single-shot
//             `messages: [{ role:'user', content:… }]` request can't lead with an
//             assistant turn — there's only one user turn).
//   NAIVE   — has an INLINE `.map(… role: … content: …)` history→turns builder and
//             does NOT use the shared helper. Crash-prone: a history opening on an
//             assistant turn ships a leading assistant turn → 400.
//
// The inline-builder signal is a `.map(` whose callback body produces BOTH a `role:`
// and a `content:` key (in either order, within a bounded window) — exactly the
// history-turn shape every past instance had. A single-shot request uses a LITERAL
// `[{ role:'user', content:… }]` with no `.map` wrapping the role, so it never
// matches. A caller that maps history AND then routes it through the helper (e.g.
// tutor-claude.js does `.map(...).push(...)` then normalizeAnthropicMessages) is
// GUARDED — the helper check is evaluated FIRST. Proven zero false-positives on the
// live repo at authoring time.
//
// WHY A LEDGER
// A caller might build turns in a shape the regex can't model (a hand-rolled
// for-loop that already drops leading assistant turns, say). Rather than turn
// `bun run test` red on a safe-but-quirky caller, --check fails only on a NAIVE site
// nobody has judged yet, cross-referencing
// scripts/inline-anthropic-messages-triage.tsv. A genuinely-safe NAIVE gets one
// ledger row (status SAFE + reason); a real one gets routed through the helper.
// (Same proven design as find-inline-gemini-contents.mjs / find-naive-body-read.mjs.)
//
// USAGE
//   scripts/find-inline-anthropic-messages.mjs             # table of every Anthropic caller + verdict
//   scripts/find-inline-anthropic-messages.mjs --check     # exit 1 if any NEW (untriaged) NAIVE caller exists
//   scripts/find-inline-anthropic-messages.mjs --self-test # prove the classifier on fixtures
//   scripts/find-inline-anthropic-messages.mjs --new       # list ONLY untriaged NAIVE callers
//
// OUTPUT (one line per in-scope file): <STATUS>  <file>  [<verdict>]

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'scripts', 'inline-anthropic-messages-triage.tsv');

const SCAN_DIR = join(ROOT, 'api');
const EXT = /\.js$/;
const SKIP = /(\.test\.|\.spec\.|\.min\.|node_modules)/;
// The canonical home of the normalizer — this is where the turn-hygiene BELONGS.
const HELPER_BASENAME = 'anthropic-messages.js';

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
// offsets preserved) so a `role:`/`content:` example inside a docstring never
// registers as real code. Pragmatic, not a full lexer: misreads can only DROP a
// match, never invent one.
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
// Anthropic-caller signal, which lives in URL / header / method string literals.
// String-aware so a `//` or `/*` INSIDE a string is not mistaken for a comment.
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

// Does the source contain an inline `.map(<p> => ({ role: … content: … }))` turn
// builder? The role/content keys must live INSIDE the object literal the arrow
// DIRECTLY returns — bounded by `[^{}]` so the match can't wander out of that
// object into a following single-shot `messages: [{ role:'user', content: x }]`
// literal (the false-positive that a looser window hit on real code, e.g.
// qss-arc-extract's canon-scan `.map` sitting just above a single-shot request).
// `content:` is a very common key near an unrelated `.map`, so this tighter anchor
// is load-bearing here (unlike the Gemini gate, where `parts:` is rare enough that
// a wider window sufficed). A block-body arrow that `return`s the turn object
// (`m => { return { role, content } }`) is NOT matched — that rare shape is handled
// by the ledger, same as the `for`-loop builders. role-then-content and
// content-then-role are both accepted.
function hasInlineTurnMapper(src) {
  const ROLE_CONTENT = /\.map\s*\([^)]*=>\s*\(?\s*\{[^{}]*?\brole\s*:[^{}]*?\bcontent\s*:/;
  const CONTENT_ROLE = /\.map\s*\([^)]*=>\s*\(?\s*\{[^{}]*?\bcontent\s*:[^{}]*?\brole\s*:/;
  return ROLE_CONTENT.test(src) || CONTENT_ROLE.test(src);
}

// Classify one source string. Returns { anthropic, status, why } where status is one
// of 'GUARDED' | 'NAIVE' | 'NA' (not an Anthropic caller / is the helper).
export function classifySource(rawSrc, base = '') {
  if (base === HELPER_BASENAME) return { anthropic: false, status: 'NA', why: 'canonical helper' };
  const src = stripCommentsAndStrings(rawSrc);

  // The Anthropic signal lives in STRING literals — the request URL
  // (`api.anthropic.com`), the `anthropic-version` header — or in the SDK call
  // `.messages.create(`. Detect on the comment-stripped-but-string-KEPT source so a
  // docstring mention can't inflate scope, while the URL/header strings survive.
  const noComments = stripComments(rawSrc);
  const anthropic =
    /api\.anthropic\.com/.test(noComments) ||
    /anthropic-version/.test(noComments) ||
    /\.messages\.create\s*\(/.test(noComments);
  if (!anthropic) return { anthropic: false, status: 'NA', why: 'not an Anthropic caller' };

  // Routes its chat history through the shared, leading-assistant-dropping helper.
  // (Helper call sites and the import specifier both survive comment-stripping.)
  const usesHelper =
    /normalizeAnthropicMessages/.test(noComments) ||
    /anthropic-messages/.test(noComments);

  if (usesHelper) return { anthropic: true, status: 'GUARDED', why: 'shared helper' };

  // An inline history→turns map with no helper is the crash-prone reintroduction.
  if (hasInlineTurnMapper(src)) {
    return { anthropic: true, status: 'NAIVE', why: 'inline history→turns map, no helper' };
  }

  // Single-shot request (literal one-user-turn messages) — can't lead with assistant.
  return { anthropic: true, status: 'GUARDED', why: 'single-shot / no inline history map' };
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
  return sourceFiles().map(classifyFile).filter(Boolean).filter((r) => r.anthropic);
}

// ── Self-test ─────────────────────────────────────────────────────────────────
function selfTest() {
  let pass = 0, fail = 0;
  const expect = (label, src, want, base = '') => {
    const got = classifySource(src, base).status;
    if (got === want) pass++;
    else { fail++; console.log(`  ✗ ${label}: got ${got}, expected ${want}`); }
  };

  // NAIVE — Anthropic caller with an inline history→turns map, no helper.
  expect('inline role→content map',
    `const messages = history.slice(-10).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
     messages.push({ role: 'user', content: message });
     await fetch('https://api.anthropic.com/v1/messages', { body: JSON.stringify({ messages }) });`,
    'NAIVE');
  expect('inline content→role map',
    `const turns = msgs.map(m => ({ content: m.text, role: m.role }));
     await fetch('https://api.anthropic.com/v1/messages', { headers: { 'anthropic-version': '2023-06-01' } });`,
    'NAIVE');
  expect('SDK .messages.create, inline map',
    `const messages = h.map(x => ({ role: x.who, content: x.t }));
     const r = await client.messages.create({ model, messages });`,
    'NAIVE');

  // GUARDED — routes through the shared helper (helper check wins even WITH a .map).
  expect('uses normalizeAnthropicMessages',
    `import { normalizeAnthropicMessages } from './_lib/anthropic-messages.js';
     const messages = normalizeAnthropicMessages(assembled);
     await fetch('https://api.anthropic.com/v1/messages', { body: JSON.stringify({ messages }) });`,
    'GUARDED');
  expect('inline .map THEN normalizeAnthropicMessages (tutor-claude shape)',
    `import { normalizeAnthropicMessages } from './anthropic-messages.js';
     const mapped = history.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
     mapped.push({ role: 'user', content: userTurnText });
     await fetch('https://api.anthropic.com/v1/messages', { body: JSON.stringify({ messages: normalizeAnthropicMessages(mapped) }) });`,
    'GUARDED');
  // GUARDED — single-shot request, literal one-user-turn messages (no .map turn map).
  expect('single-shot literal messages',
    `const body = { messages: [{ role: 'user', content: userPrompt }] };
     await fetch('https://api.anthropic.com/v1/messages', { body: JSON.stringify(body) });`,
    'GUARDED');
  expect('single-shot, content-block parts .map but no role in map',
    `const blocks = images.map(i => ({ type: 'image', source: i }));
     blocks.push({ type: 'text', text: prompt });
     await fetch('https://api.anthropic.com/v1/messages', { body: JSON.stringify({ messages: [{ role: 'user', content: blocks }] }) });`,
    'GUARDED');

  // NA — not an Anthropic caller.
  expect('gemini contents map (no Anthropic)',
    `const contents = history.map(m => ({ role: m.role, parts: [{ text: m.content }] }));
     await fetch('https://generativelanguage.googleapis.com/...:generateContent', { body: JSON.stringify({ contents }) });`,
    'NA');
  expect('the canonical helper itself is exempt',
    `export function normalizeAnthropicMessages(messages) {
       return messages.filter(isChatTurn);
     }`,
    'NA', HELPER_BASENAME);

  // Comment/string immunity: a docstring example must not register as code.
  expect('comment example ignored',
    `// const m = history.map(x => ({ role: x.role, content: x.content })); api.anthropic.com
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
    console.log('Inline Anthropic chat-history builder(s) with no shared helper and no ledger verdict:\n');
    for (const h of newNaive) console.log(`  NAIVE  ${h.rel}  [${h.why}]`);
    console.log(`\n→ ${newNaive.length} inline builder(s). Route the history through`);
    console.log('  api/_lib/anthropic-messages.js (normalizeAnthropicMessages)');
    console.log('  OR add a SAFE row to scripts/inline-anthropic-messages-triage.tsv.');
    process.exit(1);
  }
  console.log(`find-inline-anthropic-messages: ${judged.length} Anthropic caller(s), 0 inline builders.`);
  process.exit(0);
}

// Default: full table.
console.log('Anthropic Messages callers (leading-assistant-turn → 400 crash class):');
console.log('  STATUS    FILE   [GUARDED=helper/single-shot · NAIVE=inline history map, crash-prone]');
let g = 0, n = 0, s = 0;
for (const h of judged) {
  if (h.effective === 'GUARDED') g++;
  else if (h.effective === 'SAFE') s++;
  else n++;
  const tag = h.effective === 'NAIVE' ? 'NAIVE  ' : (h.effective === 'SAFE' ? 'SAFE   ' : 'GUARDED');
  console.log(`  ${tag}   ${h.rel}  [${h.why}]`);
}
console.log(`→ ${judged.length} Anthropic caller(s): ${g} GUARDED, ${s} ledger-SAFE, ${n} NAIVE.`);
process.exit(0);
