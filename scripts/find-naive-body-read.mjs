#!/usr/bin/env bun
//
// find-naive-body-read.mjs — audit every serverless handler that reads a JSON
// request body and force a human to confirm a `null`/non-object body can't crash
// it into an opaque HTTP 500.
//
// WHY THIS EXISTS
// The "null-body 500" trap is one of the loop's single most recurring PROJECT
// bug classes — fixed across ~20+ handlers (qss-* ×10, qss-tts / qss-tts-karaoke
// / admin-users, The Hunter api/gemini.js, research-* ×N, prawn, burma-tk,
// devchat-respond ×2, qss-stories + qss-world-style, …). The shape is always the
// same:
//
//     let body;
//     try { body = await req.json(); } catch { /* only catches MALFORMED json */ }
//     const action = body.action;   // a JSON literal `null` body → TypeError → 500
//
// A request body of the literal JSON token `null` (or a number / string / array)
// PARSES SUCCESSFULLY — so the `try/catch` around `req.json()` (which only guards
// a *rejecting* parse) never fires, and the first RAW property access (`body.x`,
// or `const { x } = body`) throws a TypeError on the non-object. That surfaces as
// an unhandled HTTP 500 instead of the handler's own intended 400 — a bad request
// mis-reported as a server error, and on a PUBLIC endpoint, a trivial way for any
// client to spam 500s. It is invisible in a quick test (every well-formed object
// body behaves perfectly).
//
// The fix the loop standardized: route the read through the shared, mutation-
// locked helpers in api/_lib/read-json-body.js —
//   readJsonBody(req)     → { ok:false, status:400 } on malformed OR non-object
//   coerceObjectBody(raw) → coerces any non-object (incl. null/array) to {}
// — or guard the parsed body inline before any raw access.
//
// NO existing gate looks for this: the rollover / json-parse / date / sort /
// truthy-zero gates are all blind to it. This closes the class so a NEW handler
// (or a missed one) that reads a body unguarded trips `bun run test` immediately.
//
// WHAT IT SCANS
// Every api/**/*.js handler (skipping _lib helpers + tests). A file is in scope
// only if it READS a request body (`req.json()` / `request.json()` / `req.body` /
// `request.body`). For each in-scope file it classifies:
//
//   GUARDED — routes the body through readJsonBody/coerceObjectBody, OR guards the
//             parsed body inline (`body === null`, `typeof body !== 'object'`,
//             `if (!body)`, `body || {}`, `body && typeof body`), OR never accesses
//             the body RAW (every access is optional-chained `body?.x`).
//   NAIVE   — reads a body, accesses it RAW (`body.x` / `req.body.x` / `{x} = body`
//             / `{x} = await req.json()`) and has NEITHER a helper NOR an inline
//             guard. Crash-prone on a non-object body.
//
// WHY A LEDGER
// A handful of handlers may guard in a shape the regex can't see (a guard in an
// imported wrapper, an early method-gate that makes the body unreachable, etc.).
// Rather than turn `bun run test` red on a safe-but-quirky handler, --check fails
// only on a NAIVE site nobody has judged yet, cross-referencing
// scripts/naive-body-read-triage.tsv. A genuinely-safe NAIVE gets one ledger row
// (status SAFE + reason); a real bug gets fixed. A newly-introduced unguarded
// handler trips the gate the moment it lands. (Same proven design as
// find-truthy-zero.mjs / the divergence scanner.)
//
// USAGE
//   scripts/find-naive-body-read.mjs              # table of every body-reading handler + verdict
//   scripts/find-naive-body-read.mjs --check      # exit 1 if any NEW (untriaged) NAIVE handler exists
//   scripts/find-naive-body-read.mjs --self-test  # prove the classifier on fixtures
//   scripts/find-naive-body-read.mjs --new        # list ONLY untriaged NAIVE handlers
//
// OUTPUT (one line per in-scope file): <STATUS>  <file>  [<verdict>]

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'scripts', 'naive-body-read-triage.tsv');

// Only serverless handlers. Skip the shared helpers, tests, and minified bundles.
const SCAN_DIR = join(ROOT, 'api');
const EXT = /\.js$/;
const SKIP = /(\.test\.|\.spec\.|\.min\.|node_modules|\/_lib\/)/;

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
// offsets preserved) so a `body.x` example inside a docstring — or a `req.json()`
// mention in a comment — never registers as real code. Pragmatic, not a full
// lexer: misreads can only DROP a match, never invent one (the safe direction).
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

const countMatches = (s, re) => (s.match(re) || []).length;

// Classify one source string. Returns { reads, status, why } where status is one
// of 'GUARDED' | 'NAIVE' | 'NA' (does not read a body).
export function classifySource(rawSrc) {
  const src = stripCommentsAndStrings(rawSrc);

  const reads =
    /\breq(?:uest)?\s*\.\s*json\s*\(\s*\)/.test(src) ||
    /\breq(?:uest)?\s*\.\s*body\b/.test(src) ||
    /\b(readJsonBody|coerceObjectBody)\s*\(/.test(src);
  if (!reads) return { reads: false, status: 'NA', why: 'no body read' };

  // Routes through the shared safe helpers → GUARDED.
  if (/\b(readJsonBody|coerceObjectBody)\s*\(/.test(src)) {
    return { reads: true, status: 'GUARDED', why: 'shared helper' };
  }

  // Inline guard on the parsed body before any raw access.
  const inlineGuard =
    /\bbody\s*===?\s*null\b/.test(src) ||
    /\bnull\s*===?\s*body\b/.test(src) ||
    /typeof\s+body\s*[!=]==?/.test(src) ||
    /\bif\s*\(\s*!\s*body\b/.test(src) ||
    /\bbody\s*\|\|\s*\{\s*\}/.test(src) ||
    /\bbody\s*&&\s*typeof\b/.test(src) ||
    /\bisPlainObject\s*\(\s*body\b/.test(src);
  if (inlineGuard) return { reads: true, status: 'GUARDED', why: 'inline guard' };

  // RAW (non-optional-chained) access to the body → the crash path.
  const rawMember = countMatches(src, /\bbody\s*\./g) - countMatches(src, /\bbody\s*\?\./g);
  const rawReqBody =
    countMatches(src, /\breq(?:uest)?\s*\.\s*body\s*\./g) -
    countMatches(src, /\breq(?:uest)?\s*\.\s*body\s*\?\./g);
  const destructure =
    /\}\s*=\s*body\b/.test(src) ||
    /\}\s*=\s*await\s+req(?:uest)?\s*\.\s*json\s*\(\s*\)/.test(src) ||
    /\}\s*=\s*req(?:uest)?\s*\.\s*body\b/.test(src);

  const hasRaw = rawMember > 0 || rawReqBody > 0 || destructure;
  if (!hasRaw) return { reads: true, status: 'GUARDED', why: 'optional-chained only' };

  return { reads: true, status: 'NAIVE', why: 'raw body access, no helper/guard' };
}

function classifyFile(path) {
  let src;
  try { src = readFileSync(path, 'utf8'); } catch { return null; }
  const r = classifySource(src);
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

function allHandlers() {
  return sourceFiles().map(classifyFile).filter(Boolean).filter((r) => r.reads);
}

// ── Self-test ─────────────────────────────────────────────────────────────────
function selfTest() {
  let pass = 0, fail = 0;
  const expect = (label, src, want) => {
    const got = classifySource(src).status;
    if (got === want) pass++;
    else { fail++; console.log(`  ✗ ${label}: got ${got}, expected ${want}`); }
  };

  // NAIVE — reads a body, accesses it raw, no helper/guard.
  expect('try/catch only + raw member', 'let body; try { body = await req.json(); } catch {} const a = body.action;', 'NAIVE');
  expect('req.body raw member', 'const action = req.body.action;', 'NAIVE');
  expect('destructure from body', 'const body = await req.json(); const { id } = body;', 'NAIVE');
  expect('destructure direct from req.json', 'const { id, name } = await req.json();', 'NAIVE');
  expect('catch->({}) then raw (only malformed guarded)', 'const body = await req.json().catch(() => ({})); return body.text;', 'NAIVE');

  // GUARDED — shared helper.
  expect('readJsonBody', 'const r = await readJsonBody(req); const b = r.body; return b.x;', 'GUARDED');
  expect('coerceObjectBody', 'const body = coerceObjectBody(await req.json().catch(() => ({}))); return body.bible;', 'GUARDED');
  // GUARDED — inline guards.
  expect('=== null guard', 'const body = await req.json(); if (body === null) return e(400); return body.x;', 'GUARDED');
  expect('typeof guard', "const body = await req.json(); if (typeof body !== 'object') return e(400); return body.x;", 'GUARDED');
  expect('!body guard', 'const body = await req.json(); if (!body) return e(400); return body.x;', 'GUARDED');
  expect('|| {} guard', 'let body = await req.json(); body = body || {}; return body.x;', 'GUARDED');
  expect('(body||{}) guard', 'const body = await req.json(); const { x } = body || {};', 'GUARDED');
  // GUARDED — optional chaining only, never raw.
  expect('optional-chained only', 'let body; try { body = await req.json(); } catch {} const a = body?.action;', 'GUARDED');
  expect('req.body optional-chained', 'const action = req.body?.action;', 'GUARDED');

  // NA — does not read a body at all (GET handler, etc.).
  expect('no body read', 'export default async function (req) { return new Response("ok"); }', 'NA');
  expect('json mention in url only', 'const u = await fetch(api).then(r => r.json());', 'NA'); // r.json(), not req.json()

  // Comment/string immunity: a docstring example must not register as code.
  expect('comment example ignored', '// const a = body.action; reads req.json()\nexport default () => new Response("x");', 'NA');

  console.log(`\nself-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const args = new Set(process.argv.slice(2));

if (args.has('--self-test')) {
  process.exit(selfTest() ? 0 : 1);
}

const ledger = readLedger();
const handlers = allHandlers();
const judged = handlers.map((h) => {
  const hit = ledger.get(h.rel);
  // A ledger SAFE verdict downgrades a NAIVE to an accepted exception.
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
    console.log('NAIVE body-read handler(s) with no guard and no ledger verdict:\n');
    for (const h of newNaive) console.log(`  NAIVE  ${h.rel}  [${h.why}]`);
    console.log(`\n→ ${newNaive.length} unguarded handler(s). Fix (route through readJsonBody/coerceObjectBody`);
    console.log('  or guard the parsed body) OR add a SAFE row to scripts/naive-body-read-triage.tsv.');
    process.exit(1);
  }
  console.log(`find-naive-body-read: ${judged.length} body-reading handler(s), 0 unguarded.`);
  process.exit(0);
}

// Default: full table.
console.log('JSON-body-reading handlers (null/non-object → 500 crash class):');
console.log('  STATUS    FILE   [GUARDED=helper/guard/optional-chained · NAIVE=raw access, crash-prone]');
let g = 0, n = 0, s = 0;
for (const h of judged) {
  if (h.effective === 'GUARDED') g++;
  else if (h.effective === 'SAFE') s++;
  else n++;
  const tag = h.effective === 'NAIVE' ? 'NAIVE  ' : (h.effective === 'SAFE' ? 'SAFE   ' : 'GUARDED');
  console.log(`  ${tag}   ${h.rel}  [${h.why}]`);
}
console.log(`→ ${judged.length} handler(s): ${g} GUARDED, ${s} ledger-SAFE, ${n} NAIVE.`);
process.exit(0);
