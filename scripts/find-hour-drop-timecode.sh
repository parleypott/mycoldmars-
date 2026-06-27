#!/usr/bin/env bash
#
# find-hour-drop-timecode.sh — audit every MM:SS clock/timecode formatter in the
# repo and flag the NAIVE ones (no hour component) that render an hour-plus value
# as "75:30" instead of "1:15:30".
#
# WHY THIS EXISTS
# After the "Invalid Date" class (now gated by find-unguarded-date-format.sh), the
# SECOND most-repeated user-facing PROJECT bug in this loop's backlog is the
# "hour-drop timecode" class: a duration/playhead/clip-range formatter computes
#     const m = Math.floor(secs / 60);   // minutes straight from total seconds
#     const s = Math.floor(secs % 60);
#     return `${m}:${pad(s)}`;           // NO hour field
# Johnny edits HOUR-PLUS interview footage, so an hour-plus playhead/duration is
# the COMMON case, not an edge case. For a 1h15m30s value this renders "75:30" —
# a wrong, confusing label. The fix is always the same: split the hour out
#     const h = Math.floor(total / 3600);
#     const m = Math.floor((total % 3600) / 60);
#     return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
# The loop has fixed this SAME class on 10+ formatters across unrelated tools —
# Interpreter player label + soundbite total (formatClock), main.js fmtShortTimecode,
# the essays player fmt ("77:47" for a 1:17:47 essay), QSS read-aloud clock, the
# Hunter's gemini formatSeconds + two more clip/scene display formatters, the
# Interpreter sequence-export tcToSec, …each a DIFFERENTLY-NAMED formatter in a
# different file.
#
# That is why the divergence scanner (find-divergent-fns.sh) is BLIND to this class:
# it groups by function NAME, and these are all differently-named formatters in
# unrelated files. Nothing stops a NEW tool Johnny ships next month from rendering
# yet another hourless `${m}:${pad(s)}`, and no name-based tool will surface it.
# This codifies the by-hand audit the loop keeps re-doing: find every MM:SS clock
# formatter by its SHAPE and classify each CORRECT (carries the hour) vs NAIVE
# (drops it) — the same role find-unguarded-date-format.sh, find-rollover-formatters.sh
# and find-unguarded-json-parse.sh already play for their classes.
#
# WHAT IT FLAGS (scope — kept crisp for near-zero false positives)
#   A "site" is a colon-joined MM:SS output template — a line carrying `}:${`
#   (interp-colon-interp, e.g. `${m}:${pad(s)}`) or `:${…pad…}` — whose surrounding
#   ±W-line window ALSO contains BOTH a minutes-from-seconds `Math.floor(<x> / 60)`
#   and a seconds `% 60` field. Those three together identify a clock formatter that
#   turns a total-seconds value into "M:SS". Deliberately OUT OF SCOPE (no site):
#     • `Nm Ns` duration labels (`${min}m${sec}s`) — letter separators, not a colon
#       clock; minutes legitimately exceed 60 there (a 90-minute scene → "90m0s").
#     • string-concatenation output (`m + ':' + pad(s)`) — FP-prone (`a + ':' + b`
#       builds many non-time strings); the template form is what every formatter in
#       this repo actually uses. Documented gap, like the date gate's two-step gap.
#
#   CORRECT — the window carries an HOUR component: a literal 3600, a `/ 60 / 60`,
#             a getHours, the word hours, or the canonical `h > 0 ? …` hour gate.
#             This is what every hardened clock formatter in this repo already does.
#   NAIVE   — a MM:SS template with minutes computed straight off total seconds and
#             NO hour component anywhere nearby. An hour-plus value renders "75:30".
#
# It is a HEURISTIC linter, not a prover. A clever hour handling it doesn't model
# reads as a false NAIVE — inspect, then either carry the hour or whitelist with an
# inline `hour-drop-audit:ignore` marker (document why: the value is provably < 1h).
#
# IMPLEMENTATION NOTE — why grep/awk, not rg: in this environment `rg` is a SHELL
# FUNCTION (Claude Code's token wrapper), absent for a non-interactive/cron run
# (exit 127). grep + awk are always present, so this stays portable to headless.
#
# USAGE
#   scripts/find-hour-drop-timecode.sh            # table of every MM:SS site, CORRECT/NAIVE
#   scripts/find-hour-drop-timecode.sh --check    # exit 1 if any NAIVE site exists (CI gate)
#   scripts/find-hour-drop-timecode.sh --self-test # prove the classifier on fixtures
#
# OUTPUT (one line per site, NAIVE first):
#   <CORRECT|NAIVE>  <file>:<line>
#
set -euo pipefail

cd "$(dirname "$0")/.."

WINDOW=14
# Tokens that mark a formatter as hour-aware in the surrounding code.
#   3600            — h = floor(total/3600), or m = floor((total%3600)/60)
#   / 60 / 60       — the divide-twice hour form
#   getHours        — pulling the hour off a Date
#   hours           — a named hour variable / comment-free hour handling
#   h > / h>= / h>  — the canonical `h > 0 ? ...` hour-gated ternary (h as a bare ident)
HOUR='3600|/[[:space:]]*60[[:space:]]*[/][[:space:]]*60|getHours|hours|(^|[^A-Za-z_])h[[:space:]]*>=?'
# Inspected + judged safe: an inline `hour-drop-audit:ignore` marker in the window
# exempts a site (reads as CORRECT). Use ONLY after confirming the value can never
# reach an hour (e.g. a 0–59s countdown); document why next to it.
IGNORE='hour-drop-audit:ignore'

# Classify every MM:SS clock template in one file. Emits: STATUS\tfile:line
#
# Works on a COMMENT-STRIPPED view: the hardened files describe the OLD hourless
# `${m}:${pad(s)}` they already fixed in a block comment, and that would otherwise
# read as a live site. Stripping `//`-tails and full comment lines keeps the audit
# on real code — for the site match AND the hour-marker search.
classify_file() {
  awk -v F="$1" -v HOUR="$HOUR" -v IGN="$IGNORE" -v W="$WINDOW" '
    function strip(s,   t) {
      t=s
      if (t ~ /^[[:space:]]*(\/\/|\*|\/\*)/) return ""   # full comment line
      sub(/[[:space:]]\/\/.*$/, "", t)                   # trailing ` // ...` (not URL `://`)
      return t
    }
    {
      RAW[NR]=$0          # original, for the IGNORE marker (lives in a comment)
      C[NR]=strip($0)     # real code only
    }
    END {
      lastEmit = -1000
      for (i=1; i<=NR; i++) {
        line=C[i]
        # SITE anchor: a colon-joined MM:SS output template. `}:${` is interp-colon-
        # interp (`${m}:${pad(s)}`); `:${...pad` covers a leading literal minute.
        if (line !~ /\}:\$\{/ && line !~ /:\$\{[^}]*pad/) continue

        # Corroborate it is a seconds-from-total clock: a minutes `floor(x/60)` AND a
        # seconds `% 60` must both sit within the ±W window. Without both, a stray
        # `${a}:${b}` (a ratio, an aspect, "key:val") is NOT a time formatter — skip.
        hasMin=0; hasSec=0
        for (j=i-W; j<=i+W; j++) {
          if (j<1 || j>NR) continue
          if (C[j] ~ /Math\.floor\([^;{}]*[/][[:space:]]*60[^0-9]/) hasMin=1
          if (C[j] ~ /%[[:space:]]*60([^0-9]|$)/) hasSec=1
        }
        if (!hasMin || !hasSec) continue

        # Dedup: a correct formatter emits TWO colon templates (the h>0 ternary has
        # `${h}:${m}:${s}` and `${m}:${s}`). Count the window once.
        if (i - lastEmit <= W) continue
        lastEmit = i

        # Hour-aware? an hour marker in real code within the ±W window.
        hr=0
        for (j=i-W; j<=i+W; j++) if (j>=1 && j<=NR && C[j] ~ HOUR) { hr=1; break }
        # Inspected-safe ignore marker (lives in a comment) → treat as CORRECT.
        ign=0
        for (j=i-W; j<=i+W; j++) if (j>=1 && j<=NR && index(RAW[j], IGN)) { ign=1; break }
        printf "%s\t%s:%d\n", ((hr || ign) ? "CORRECT" : "NAIVE"), F, i
      }
    }' "$1"
}

# Repo scan: every non-test, non-vendor source file with a colon-joined MM:SS template.
scan_repo() {
  local files
  files=$(grep -rlE '\}:\$\{|:\$\{[^}]*pad' \
            --include='*.js' --include='*.ts' --include='*.mjs' --include='*.jsx' . 2>/dev/null \
          | grep -v node_modules | grep -vE '/dist/|public/|assets/index-' \
          | grep -vE '\.(test|spec)\.' || true)
  local f
  for f in $files; do
    classify_file "$f"
  done
}

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

  # Fixture 1: NAIVE — minutes straight off total seconds, no hour field. A 1h15m30s
  # value renders "75:30". MUST be NAIVE.
  cat >"$tmp/naive.js" <<'JS'
function fmt(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  const pad = n => String(n).padStart(2, '0');
  return `${m}:${pad(s)}`;
}
JS
  # Fixture 2: CORRECT — carries the hour via 3600 + h>0 ternary. MUST be CORRECT.
  cat >"$tmp/correct.js" <<'JS'
function fmt(secs) {
  const total = Math.floor(Math.max(0, secs));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
JS
  # Fixture 3: `Nm Ns` duration label — letter separators, not a colon clock; minutes
  # legitimately exceed 60. MUST NOT appear (no site).
  cat >"$tmp/nmns.js" <<'JS'
function dur(secs) {
  const min = Math.floor(secs / 60);
  const sec = Math.floor(secs % 60);
  return `${min}m${sec}s`;
}
JS
  # Fixture 4: a non-time `${a}:${b}` ratio with no minutes/seconds math nearby.
  # MUST NOT appear (no site — fails the floor/%60 corroboration).
  cat >"$tmp/ratio.js" <<'JS'
function label(a, b) {
  return `${a}:${b}`;
}
JS
  # Fixture 5: a comment describing the OLD hourless formatter must NOT read as a site.
  cat >"$tmp/comment.js" <<'JS'
// old bug: `${m}:${pad(s)}` where m = Math.floor(secs / 60), s = secs % 60 dropped the hour
const ok = true;
JS
  # Fixture 6: NAIVE site with an inspected ignore marker → exempt (CORRECT).
  cat >"$tmp/ignored.js" <<'JS'
function countdown(secs) {
  // hour-drop-audit:ignore (secs is a 0-59s countdown, never reaches an hour)
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
JS

  local out
  out=$(classify_file "$tmp/naive.js")
  assert "$out" "NAIVE	$tmp/naive.js:5" "hourless MM:SS template → NAIVE" || rc=1

  out=$(classify_file "$tmp/correct.js")
  assert "$out" "CORRECT	$tmp/correct.js:7" "3600 + h>0 ternary → CORRECT" || rc=1

  out=$(classify_file "$tmp/nmns.js")
  assert "$out" "" "Nm Ns duration label produces no site" || rc=1

  out=$(classify_file "$tmp/ratio.js")
  assert "$out" "" "non-time \${a}:\${b} ratio produces no site" || rc=1

  out=$(classify_file "$tmp/comment.js")
  assert "$out" "" "comment describing the old hourless formatter produces no site" || rc=1

  out=$(classify_file "$tmp/ignored.js")
  assert "$out" "CORRECT	$tmp/ignored.js:5" "inspected ignore-marker site reads CORRECT" || rc=1

  # Load-bearing: the LIVE repo must currently be clean (0 NAIVE). If this fails, a
  # real hour-dropping clock formatter shipped — the whole reason the tool exists.
  local naive_live
  naive_live=$(scan_repo | grep -c '^NAIVE' || true)
  if [ "$naive_live" -eq 0 ]; then
    echo "PASS  live repo scan: 0 NAIVE MM:SS clock formatters"
  else
    echo "FAIL  live repo scan: $naive_live NAIVE MM:SS clock formatter(s) — run without --self-test to see them"
    rc=1
  fi

  [ "$rc" -eq 0 ] && echo "── self-test: ALL PASS ──" || echo "── self-test: FAILURES ──"
  return $rc
}

# ─────────────────────────────── main ───────────────────────────────
case "${1:-}" in
  --self-test) self_test ;;
  --check)
    rows=$(scan_repo | sort)   # NAIVE sorts before CORRECT
    naive=$(printf '%s\n' "$rows" | grep -c '^NAIVE' || true)
    printf '%s\n' "$rows" | grep '^NAIVE' || true
    if [ "$naive" -gt 0 ]; then
      echo "✗ $naive NAIVE MM:SS clock formatter(s) — an hour-plus value renders \"75:30\" instead of \"1:15:30\"" >&2
      exit 1
    fi
    echo "✓ 0 NAIVE MM:SS clock formatters ($(printf '%s\n' "$rows" | grep -c '^CORRECT' || true) CORRECT)"
    ;;
  ''|--list)
    rows=$(scan_repo | sort)
    g=$(printf '%s\n' "$rows" | grep -c '^CORRECT' || true)
    n=$(printf '%s\n' "$rows" | grep -c '^NAIVE' || true)
    echo "MM:SS clock-formatter sites:"
    echo "  STATUS    SITE   [CORRECT=carries the hour · NAIVE=drops it, renders \"75:30\" on hour-plus input]"
    printf '%s\n' "$rows" | awk -F'\t' 'NF==2 { printf "  %-9s %s\n", $1, $2 }'
    echo "→ $((g+n)) MM:SS clock-formatter site(s): $g CORRECT, $n NAIVE."
    [ "$n" -gt 0 ] && echo "  inspect each NAIVE: can an hour-plus value reach this formatter?"
    ;;
  *) echo "usage: $0 [--list|--check|--self-test]" >&2; exit 2 ;;
esac
