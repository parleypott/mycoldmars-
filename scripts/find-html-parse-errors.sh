#!/usr/bin/env bash
#
# find-html-parse-errors.sh — parse EVERY inline <script> in every served HTML
# page and flag the ones that do not parse. A SyntaxError in a single inline
# script aborts that ENTIRE <script> block in the browser, so a page that returns
# HTTP 200 can be a blank, dead screen with none of its JS running.
#
# WHY THIS EXISTS
# The single highest-cost class of bug this loop has ever found was NOT a subtle
# edge case — it was a whole tool DEAD ON LIVE because one inline script would not
# parse:
#   • bounce/ (a country-shape game) was a BLANK SCREEN for ~4 MONTHS. Four raw
#     straight apostrophes inside single-quoted strings in its LEVEL_META data
#     (`you'd`, `don't`, `We're`, `You're`) were each a fatal SyntaxError that
#     aborted the one <script> holding both the data AND all the game logic. The
#     page served 200 the whole time; the JS never ran. A "fix" was even committed
#     to that file while it was dead, because nobody had actually loaded the page.
#   • hunter/roadmap.html had a stray leading `(` (a half-removed IIFE wrapper)
#     that was never closed, so its entire live-stats inline script was a
#     SyntaxError and never ran.
# Both are the same shape: a parse error in inline HTML JS that ships silently.
#
# NOTHING in the repo caught either. The other shape gates (find-rollover-formatters,
# find-unguarded-json-parse, find-unguarded-date-format, find-hour-drop-timecode)
# all scan SOURCE *.js/*.ts and are STRUCTURALLY BLIND to JavaScript that lives
# inside <script> tags in an .html file. Many of Johnny's tools are exactly that:
# raw single-file HTML with one big inline script (every game, essays, cutter,
# commentbank, prawn, the westchester/walden public pages, …). For those, the
# inline script IS the whole app, so a parse error = a dead tool, and the live
# page is the only source — there is no build step to fail.
#
# This gate closes that class. It extracts every inline script from every served
# HTML page and asks the actual JS parser whether it parses — classic scripts via
# `new Function(body)` (in-process, fast; catches the bounce apostrophe and the
# roadmap dangling-paren classes exactly), and `type="module"` scripts via
# `node --check` on a temp .mjs (module grammar, so a legitimate top-level
# `import`/`export` is NOT a false positive — the trap a naive `new Function`
# scan falls into).
#
# WHAT IT CHECKS / SKIPS (scope — kept crisp for zero false positives)
#   CHECKED : every <script> with NO src= whose type is empty, text/javascript,
#             application/javascript, text/ecmascript, or module, and whose body
#             is non-empty. Classic → script grammar; module → ESM grammar.
#   SKIPPED : external scripts (src=), and non-JS blocks (type=application/json,
#             text/template, text/html, text/babel, importmap, speculationrules,
#             …) — those are data/templates, not executable JS, and are not parsed.
#   IGNORED PATHS: node_modules, any /dist/, built bundles (assets/index-*), and
#             *.min.* — generated output, not hand-edited source.
#
# KNOWN GAP (documented, like the sibling gates): classic scripts are checked with
# `new Function`, which parses the body as a FUNCTION body, so a top-level `return`
# — illegal in a real classic <script> — reads as OK here (false negative). That
# pattern does not occur in this repo and is not one of the observed bug classes
# (both real bugs were inside string/expression grammar, caught faithfully). If it
# ever matters, switch the classic path to `node --check` on a temp .cjs.
#
# IMPLEMENTATION NOTE — why node, not rg/awk: HTML-aware script extraction + a real
# JS parse needs the JS engine, and `node` is a real binary on PATH (unlike `rg`,
# which is a Claude Code shell FUNCTION absent in non-interactive/cron runs). This
# stays portable to headless.
#
# USAGE
#   scripts/find-html-parse-errors.sh             # table of any inline scripts that fail to parse
#   scripts/find-html-parse-errors.sh --check     # exit 1 if ANY inline script fails to parse (CI gate)
#   scripts/find-html-parse-errors.sh --self-test # prove the classifier on fixtures + assert live repo clean
#
# OUTPUT (one line per broken script):
#   FAIL\t<file>\t<script #N[ (module)]>\t<parser message>
#
set -euo pipefail

cd "$(dirname "$0")/.."

# The parse engine. Reads a newline-separated list of HTML file paths on STDIN,
# prints a tab-delimited FAIL line per inline script that does not parse, writes a
# one-line summary to STDERR, and exits 1 iff any failure was found. Kept free of
# the single-quote character so it can live inside a single-quoted bash string.
NODE_PARSE='
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const files = fs.readFileSync(0, "utf8").split("\n").map(s => s.trim()).filter(Boolean);

// type=... attribute value (lowercased) or empty string when absent.
const typeOf = (attrs) => {
  const m = /type\s*=\s*["\x27]([^"\x27]*)["\x27]/i.exec(attrs);
  return m ? m[1].toLowerCase().trim() : "";
};
// Empty type defaults to classic JS. These are the executable-JS types we parse.
const JS_TYPES = new Set(["", "text/javascript", "application/javascript", "text/ecmascript", "module"]);

const reScript = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let scripts = 0, fails = 0;

for (const f of files) {
  let html;
  try { html = fs.readFileSync(f, "utf8"); } catch { continue; }
  let m, idx = 0;
  while ((m = reScript.exec(html))) {
    const attrs = m[1] || "", body = m[2] || "";
    if (/\bsrc\s*=/i.test(attrs)) continue;        // external script — nothing inline to parse
    const t = typeOf(attrs);
    if (!JS_TYPES.has(t)) continue;                // json / template / importmap / babel — not plain JS
    if (!body.trim()) continue;                    // empty inline block
    idx++; scripts++;

    if (t === "module") {
      // ESM grammar: a legitimate top-level import/export must NOT read as an error.
      const tmp = path.join(os.tmpdir(), "hpe-" + process.pid + "-" + idx + ".mjs");
      try {
        fs.writeFileSync(tmp, body);
        execFileSync(process.execPath, ["--check", tmp], { stdio: ["ignore", "ignore", "pipe"] });
      } catch (e) {
        const out = String((e && e.stderr) || (e && e.message) || "");
        const msg = out.split("\n").find(l => /SyntaxError|Error:/.test(l)) || "parse error";
        console.log(["FAIL", f, "script #" + idx + " (module)", msg.trim()].join("\t"));
        fails++;
      } finally {
        try { fs.unlinkSync(tmp); } catch {}
      }
    } else {
      // Classic script grammar.
      try { new Function(body); }
      catch (e) {
        if (e instanceof SyntaxError) {
          console.log(["FAIL", f, "script #" + idx, e.message].join("\t"));
          fails++;
        }
      }
    }
  }
}

console.error("scanned " + files.length + " HTML file(s), " + scripts + " inline script(s), " + fails + " parse failure(s)");
process.exit(fails > 0 ? 1 : 0);
'

# Every served, hand-edited HTML file that contains a <script>. Excludes vendored
# deps, build output, minified files, and hashed bundles.
list_html() {
  grep -rlE '<script' --include='*.html' . 2>/dev/null \
    | grep -v node_modules \
    | grep -vE '/dist/|assets/index-|\.min\.' \
    || true
}

# Run the parser over a given newline list of files (on stdin). Returns node exit.
parse_stdin() { node -e "$NODE_PARSE"; }

assert() {  # got want label
  if [ "$1" = "$2" ]; then
    echo "PASS  $3"
  else
    echo "FAIL  $3"
    echo "        got:  [$1]"
    echo "        want: [$2]"
    return 1
  fi
}

self_test() {
  local tmp rc=0
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN

  # Fixture 1: the BOUNCE class — an unescaped apostrophe inside a single-quoted
  # string. Fatal SyntaxError; the whole classic script is dead. MUST be FAIL.
  cat >"$tmp/bounce.html" <<'HTML'
<!doctype html><html><body>
<script>
const LEVELS = ['you'd be surprised', 'fine'];
console.log(LEVELS.length);
</script>
</body></html>
HTML

  # Fixture 2: the ROADMAP class — a stray leading `(` (half-removed IIFE) that is
  # never closed. MUST be FAIL.
  cat >"$tmp/roadmap.html" <<'HTML'
<!doctype html><html><body>
<script>
(async function loadStats() {
  return 1;
}

loadStats();
</script>
</body></html>
HTML

  # Fixture 3: a clean classic script. MUST NOT fail.
  cat >"$tmp/clean.html" <<'HTML'
<!doctype html><html><body>
<script>
const greeting = "it does not break";
function go() { return greeting.length; }
go();
</script>
</body></html>
HTML

  # Fixture 4: a clean type=module script using a legitimate top-level import. A
  # naive new-Function scan would FALSE-POSITIVE this; the gate must NOT.
  cat >"$tmp/module.html" <<'HTML'
<!doctype html><html><body>
<script type="module">
import { thing } from "./thing.js";
export const ready = true;
console.log(thing, ready);
</script>
</body></html>
HTML

  # Fixture 5: a non-JS data block (JSON). MUST be skipped (not parsed as JS).
  cat >"$tmp/data.html" <<'HTML'
<!doctype html><html><body>
<script type="application/json">{ "note": "this is data, not js: a'b'c" }</script>
</body></html>
HTML

  # Fixture 6: an external script — nothing inline to parse. MUST be skipped.
  cat >"$tmp/external.html" <<'HTML'
<!doctype html><html><body>
<script src="./app.js"></script>
</body></html>
HTML

  local out
  out=$(printf '%s\n' "$tmp/bounce.html" | parse_stdin 2>/dev/null | cut -f1,3 || true)
  assert "$out" "FAIL	script #1" "unescaped apostrophe (bounce class) -> FAIL" || rc=1

  out=$(printf '%s\n' "$tmp/roadmap.html" | parse_stdin 2>/dev/null | cut -f1,3 || true)
  assert "$out" "FAIL	script #1" "dangling open-paren (roadmap class) -> FAIL" || rc=1

  out=$(printf '%s\n' "$tmp/clean.html" | parse_stdin 2>/dev/null | cut -f1 || true)
  assert "$out" "" "clean classic script -> no failure" || rc=1

  out=$(printf '%s\n' "$tmp/module.html" | parse_stdin 2>/dev/null | cut -f1 || true)
  assert "$out" "" "clean type=module with import/export -> no failure (no false positive)" || rc=1

  out=$(printf '%s\n' "$tmp/data.html" | parse_stdin 2>/dev/null | cut -f1 || true)
  assert "$out" "" "application/json data block -> skipped" || rc=1

  out=$(printf '%s\n' "$tmp/external.html" | parse_stdin 2>/dev/null | cut -f1 || true)
  assert "$out" "" "external src script -> skipped" || rc=1

  # Load-bearing: the LIVE repo must currently have ZERO inline scripts that fail
  # to parse. If this fails, a real dead-on-load page shipped — the whole reason
  # this gate exists.
  local live_fail
  live_fail=$(list_html | parse_stdin 2>/dev/null | grep -c '^FAIL' || true)
  if [ "$live_fail" -eq 0 ]; then
    echo "PASS  live repo scan: 0 inline scripts fail to parse"
  else
    echo "FAIL  live repo scan: $live_fail inline script(s) fail to parse — run without --self-test to see them"
    rc=1
  fi

  [ "$rc" -eq 0 ] && echo "── self-test: ALL PASS ──" || echo "── self-test: FAILURES ──"
  return $rc
}

# ─────────────────────────────── main ───────────────────────────────
case "${1:-}" in
  --self-test) self_test ;;
  --check)
    rows=$(list_html | parse_stdin 2>/dev/null || true)
    fails=$(printf '%s\n' "$rows" | grep -c '^FAIL' || true)
    printf '%s\n' "$rows" | grep '^FAIL' || true
    if [ "$fails" -gt 0 ]; then
      echo "✗ $fails inline script(s) fail to parse — a 200 page can be a blank/dead screen (its whole <script> aborts)" >&2
      exit 1
    fi
    echo "✓ 0 inline-script parse failures across all served HTML pages"
    ;;
  ''|--list)
    rows=$(list_html | parse_stdin 2>/dev/null || true)
    fails=$(printf '%s\n' "$rows" | grep -c '^FAIL' || true)
    echo "inline-script parse audit (every served HTML page):"
    if [ "$fails" -gt 0 ]; then
      echo "  STATUS  FILE  SCRIPT  MESSAGE"
      printf '%s\n' "$rows" | grep '^FAIL' | awk -F'\t' '{ printf "  %-6s %s  %s  %s\n", $1, $2, $3, $4 }'
    fi
    echo "→ $fails inline script(s) fail to parse."
    [ "$fails" -gt 0 ] && echo "  a parse error aborts the WHOLE <script> — the page serves 200 but its JS never runs."
    ;;
  *) echo "usage: $0 [--list|--check|--self-test]" >&2; exit 2 ;;
esac
