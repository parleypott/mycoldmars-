#!/usr/bin/env bun
//
// find-divergent-md-stripper.mjs — guard the loop's single RICHEST bug vein: a
// markdown→PLAINTEXT stripper re-implemented for TEXT-TO-SPEECH OUTSIDE the one
// shared, hardened core (api/_lib/burma-essays-text.js → stripMarkdown).
//
// WHY THIS EXISTS
// The Burma Essays narrator and the Research-TTS readout both feed prose to
// ElevenLabs, which reads EVERY stray markdown symbol ALOUD — a "**" becomes
// "asterisk asterisk", a "## " becomes "hash hash", a bare URL becomes
// "h-t-t-p-s colon slash slash…". Killing those leaks is a moving target
// (CommonMark has dozens of forms: fenced code, blockquotes, task lists, ref
// links, setext headings, flanking-aware emphasis, backslash escapes…), and this
// loop has hand-fixed a stripMarkdown leak *~30 times* — by a wide margin the most
// frequent PROJECT entry in the backlog. Every one of those fixes hardened the ONE
// shared core in api/_lib/burma-essays-text.js.
//
// The failure this gate watches for is a SECOND, WEAKER copy. It has already
// happened once: api/research-tts.js shipped its own local `strip()` that was a
// "DIVERGENT-WEAKER twin of stripMarkdown" — it missed bare-URL and several
// emphasis forms, so the research readout leaked symbols the essays narrator had
// long since fixed. That was consolidated (research-tts now imports the shared
// core and only adds a research-specific citation rule on top). But NOTHING
// structurally stops the next TTS feature from doing the same: someone wiring a
// new "read this aloud" button hand-rolls `text.replace(/\*\*/g,'').replace(...)`,
// it passes their happy-path test, and it silently re-opens every leak the shared
// core already closed. The divergence scanner (diff-divergent-fn.sh) can't catch
// it — that keys on a shared FUNCTION NAME, and a fresh copy called `clean()` or
// inlined has no name to match.
//
// WHAT IT FLAGS
// A file is a candidate iff ALL of:
//   1. it is TTS-BOUND — references a text-to-speech surface in code (ElevenLabs,
//      /v1/text-to-speech, a fetch to /api/{research-tts,burma-essays,qss-tts},
//      the browser speechSynthesis / SpeechSynthesisUtterance API, voice_id,
//      xi-api-key); AND
//   2. it does NOT import the shared stripper from _lib/burma-essays-text.js; AND
//   3. it contains >= 3 DISTINCT plaintext-markdown-strip signatures — a
//      `.replace(/<markdown-marker>/…, '')` or `…, '$1')` whose REPLACEMENT drops
//      to plaintext. (An HTML renderer like research/md.js replaces with
//      `<em>$1</em>`, never a bare `$1`/``, so mdToHtml is structurally excluded —
//      it renders markdown, it doesn't strip it for speech.)
// Requiring >= 3 distinct marker kinds (bold, strike, heading, image, link,
// bullet, highlight, autolink) means one incidental `.replace(/\*\*/,'')` never
// trips it; only a file that is genuinely re-implementing the stripper does.
//
// WHY IT STARTS GREEN (verified): the only two TTS text-preparers that strip
// markdown — api/burma-essays.js and api/research-tts.js — both import the shared
// core (rule 2 excludes them). Every OTHER plaintext markdown stripper in the repo
// (hunter script cleaners, the Interpreter summary-bullet parsers) is NOT
// TTS-bound (rule 1 excludes them) — those legitimately strip markdown for DISPLAY
// or PARSING, a different downstream than speech, and are individually tested. So
// today: 0 candidates. `--check` trips red the moment a NEW TTS stripper lands
// outside the shared core.
//
// Like the other ledger-backed gates (find-truthy-zero, find-utf16-byte-cap, …),
// whether a given candidate is a real divergence or a justified exception is a
// SEMANTIC call, so this LISTS candidates, cross-references
// scripts/md-stripper-triage.tsv, and (in --check) fails only on a file nobody has
// judged yet. The ledger key is the file path.
//
// USAGE
//   scripts/find-divergent-md-stripper.mjs             # table of every candidate + verdict
//   scripts/find-divergent-md-stripper.mjs --check     # exit 1 if any NEW (untriaged) candidate
//   scripts/find-divergent-md-stripper.mjs --self-test # prove the classifier on fixtures
//   scripts/find-divergent-md-stripper.mjs --new       # list ONLY untriaged candidates
//
// OUTPUT (one line per candidate): <STATUS>  <file>  =>  cats=[…]
//   STATUS = SAFE (ledger: judged a non-divergence, with reason) | BUG (ledger: open)
//          | NEW (not in ledger — judge it, then add a row to the .tsv)

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = 'api/_lib/burma-essays-text.js';
const LEDGER = join(ROOT, 'scripts', 'md-stripper-triage.tsv');

// A .replace(/pat/flags, <plaintext-repl>) where the replacement DROPS to plaintext.
// Deliberately narrow on the replacement ('' | "" | `` | '$1' | "$1" | `$1`) so an
// HTML renderer (…, '<em>$1</em>') is never counted — it renders, it doesn't strip.
const REPLACE_RE = /\.replace\(\s*(\/(?:\\.|[^/\\\n])*\/[gimsuy]*)\s*,\s*(''|""|``|'\$1'|"\$1"|`\$1`)\s*\)/g;

// Distinct markdown-marker categories a stripper targets. >= 3 distinct == a real
// stripper, not an incidental single replace.
const MARKERS = {
  bold: /\*\*/,
  strike: /~~/,
  image: /!\\?\[/,
  link: /\]\\?\(/,
  heading: /\^#|#\+/,
  bullet: /\^\\?s\*\\?\[?\s*\[?\\?[-*+]|\^\[ \\t\]\*\[-\*\+\]/,
  highlight: /==/,
  autolink: /<https|mailto/,
};

// TTS-bound signal: a real text-to-speech surface referenced in code. Specific,
// API-shaped tokens (not the bare word "tts"/"narrator") so a file that only
// MENTIONS the narrator in a comment (e.g. research/md.js) is not mislabeled.
const TTS_RE = /elevenlabs|text-to-speech|speechSynthesis|SpeechSynthesisUtterance|\/api\/(?:research-tts|burma-essays|qss-tts)|voice_id|xi-api-key/i;

// Imports the shared stripper -> uses the ONE hardened core, exempt by construction.
const IMPORTS_SHARED_RE = /from\s+['"][^'"]*_lib\/burma-essays-text(?:\.js)?['"]/;

function markerCats(text) {
  const cats = new Set();
  let m;
  REPLACE_RE.lastIndex = 0;
  while ((m = REPLACE_RE.exec(text)) !== null) {
    const pat = m[1];
    for (const [name, re] of Object.entries(MARKERS)) if (re.test(pat)) cats.add(name);
  }
  return cats;
}

// The core classifier — shared by the live scan and --self-test. Returns the set of
// plaintext-strip categories iff this file is a divergent-TTS-stripper CANDIDATE
// (TTS-bound, not importing shared, >= 3 categories); otherwise null.
function classify(text) {
  if (IMPORTS_SHARED_RE.test(text)) return null;   // uses the shared core
  if (!TTS_RE.test(text)) return null;             // not a TTS text-preparer
  const cats = markerCats(text);
  return cats.size >= 3 ? cats : null;
}

// Filesystem walk (not `git ls-files`) so a brand-new, not-yet-tracked TTS stripper
// is scanned the moment it lands — the regression must trip before the commit, not
// after. Mirrors find-utf16-byte-cap.mjs's traversal.
const SKIP_DIR = /^(node_modules|\.git|dist|build|assets|coverage|\.vercel|\.next)$/;
function walk(dir, acc) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (!SKIP_DIR.test(name)) walk(full, acc);
    } else if (/\.(js|mjs|html)$/.test(name) && !/\.test\.|\.min\./.test(name)) {
      acc.push(relative(ROOT, full));
    }
  }
  return acc;
}

function listCandidates() {
  const files = walk(ROOT, [])
    .filter((f) => !/(^|\/)(node_modules|dist|assets)\//.test(f))
    .filter((f) => f !== SHARED);
  const out = [];
  for (const f of files) {
    let txt;
    try { txt = readFileSync(join(ROOT, f), 'utf8'); } catch { continue; }
    const cats = classify(txt);
    if (cats) out.push({ file: f, cats: [...cats] });
  }
  return out;
}

function loadLedger() {
  const map = new Map();
  if (!existsSync(LEDGER)) return map;
  for (const line of readFileSync(LEDGER, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [status, file, ...reason] = t.split('\t');
    if (file) map.set(file, { status: (status || '').toUpperCase(), reason: reason.join(' ') });
  }
  return map;
}

// ---- self-test: the mutation proof. A hand-rolled TTS stripper MUST flag; the
// exempt shapes (imports shared / HTML renderer / non-TTS stripper) MUST NOT. ----
function selfTest() {
  const fixtures = [
    ['divergent TTS stripper -> FLAG', true, `
      // reads an essay aloud
      const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voiceId, {});
      function clean(md) {
        return md
          .replace(/\\*\\*([^*]+)\\*\\*/g, '$1')
          .replace(/~~([^~]+)~~/g, '$1')
          .replace(/^#+\\s*/gm, '')
          .replace(/!\\[[^\\]]*\\]\\([^)]*\\)/g, '');
      }`],
    ['imports shared core -> SAFE', false, `
      import { stripMarkdown } from './_lib/burma-essays-text.js';
      const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/x', {});
      const clean = stripMarkdown(text)
        .replace(/\\*\\*/g,'').replace(/~~/g,'').replace(/^#+/gm,'').replace(/!\\[/g,'');`],
    ['HTML renderer (mdToHtml), not a stripper -> SAFE', false, `
      // the TTS narrator strips these; this reader RENDERS them
      function mdToHtml(md) {
        return md
          .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
          .replace(/~~([^~]+)~~/g, '<del>$1</del>')
          .replace(/^#+\\s*(.*)$/gm, '<h2>$1</h2>')
          .replace(/!\\[([^\\]]*)\\]\\(([^)]*)\\)/g, '<img alt="$1" src="$2">');
      }`],
    ['non-TTS plaintext stripper (Hunter script cleaner) -> SAFE', false, `
      // strips markdown from a Google-Doc script for the corpus — never spoken
      function stripForCorpus(t) {
        return t
          .replace(/\\*\\*([^*]+)\\*\\*/g, '$1')
          .replace(/^#+\\s*/gm, '')
          .replace(/^\\s*[-*+]\\s+/gm, '');
      }`],
    ['TTS but only ONE marker -> SAFE (incidental replace)', false, `
      const res = await fetch('/api/research-tts', {});
      const t = text.replace(/\\*\\*([^*]+)\\*\\*/g, '$1');`],
  ];
  let pass = 0;
  for (const [name, shouldFlag, code] of fixtures) {
    const flagged = classify(code) !== null;
    const ok = flagged === shouldFlag;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (flagged=${flagged}, want=${shouldFlag})`}`);
    if (ok) pass++;
  }
  console.log(`\nself-test: ${pass}/${fixtures.length} ${pass === fixtures.length ? 'PASS' : 'FAIL'}`);
  return pass === fixtures.length;
}

// ---- main ----
const arg = process.argv[2] || '';
if (arg === '--self-test') {
  process.exit(selfTest() ? 0 : 1);
}

const ledger = loadLedger();
const cands = listCandidates().map((c) => {
  const led = ledger.get(c.file);
  const status = led ? (led.status === 'SAFE' ? 'SAFE' : 'BUG') : 'NEW';
  return { ...c, status, reason: led ? led.reason : '' };
});

if (arg === '--new') {
  const news = cands.filter((c) => c.status === 'NEW');
  for (const c of news) console.log(`NEW  ${c.file}  =>  cats=[${c.cats.join(',')}]`);
  console.log(`\n${news.length} untriaged candidate(s).`);
  process.exit(0);
}

if (arg === '--check') {
  const news = cands.filter((c) => c.status === 'NEW');
  const bugs = cands.filter((c) => c.status === 'BUG');
  for (const c of news) console.log(`NEW  ${c.file}  =>  cats=[${c.cats.join(',')}]`);
  for (const c of bugs) console.log(`BUG  ${c.file}  =>  ${c.reason}`);
  if (news.length) {
    console.error(`\n${news.length} NEW divergent-TTS-stripper candidate(s) — a markdown stripper outside the shared core (${SHARED}). Route it through stripMarkdown, or record a SAFE verdict in scripts/md-stripper-triage.tsv.`);
    process.exit(1);
  }
  console.log(`divergent-md-stripper gate: ${cands.length} candidate(s), 0 NEW — clean.`);
  process.exit(0);
}

// default: full table
for (const c of cands) console.log(`${c.status.padEnd(4)}  ${c.file}  =>  cats=[${c.cats.join(',')}]`);
const bySt = (s) => cands.filter((c) => c.status === s).length;
console.log(`\n${cands.length} candidate(s): ${bySt('NEW')} NEW, ${bySt('BUG')} BUG, ${bySt('SAFE')} SAFE.`);
