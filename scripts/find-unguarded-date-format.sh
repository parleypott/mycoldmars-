#!/usr/bin/env bash
#
# find-unguarded-date-format.sh — audit every INLINE `new Date(<rawValue>).toLocale*()`
# in the repo and flag the NAIVE ones (no isNaN / null / getTime guard nearby) that
# render the literal string "Invalid Date" to the user when the value is missing or
# unparseable.
#
# WHY THIS EXISTS
# The single MOST-REPEATED user-facing PROJECT bug in this loop's backlog is the
# "Invalid Date" class: a date value that is PRESENT but unparseable (a legacy row,
# a corrupt sync blob, a hand-edited field, a null slack_ts) is fed straight to a
# display formatter:
#     el.textContent = new Date(row.updatedAt).toLocaleDateString('en-US', {...});
# When `row.updatedAt` is null/garbage, `new Date(x)` is an Invalid Date and every
# toLocale*() method returns the literal string "Invalid Date" — which then renders
# verbatim in the UI (and the related `new Date(x) - new Date(y)` diff path renders
# "NaNd ago" / "NaN years ago"). The loop has fixed this SAME class on 15+ separate
# fields across unrelated tools — QSS library relTime, QSS world-style "last saved",
# QSS arc-stat chip, Hunter "Recent analyses" + 4 bare toLocaleDateString rows,
# Interpreter library/trash/devchat/conflict stamps, Burma Essays fmtDate, nile-flights
# sync footer, Westchester scenario dropdown + "Last run", Commentbank browse header,
# …each a DIFFERENTLY-NAMED field in a different file.
#
# That is why the divergence scanner (find-divergent-fns.sh) is BLIND to this class:
# it groups by function NAME, but these are anonymous inline expressions in unrelated
# files. Nothing stops a NEW tool Johnny ships next month from rendering yet another
# raw `new Date(field).toLocaleDateString()`, and no name-based tool will surface it.
# This codifies the by-hand audit the loop keeps re-doing: find every inline date
# formatter by its SHAPE and classify each GUARDED vs NAIVE — the same role
# find-unguarded-json-parse.sh (brick-on-load) and find-rollover-formatters.sh
# (1000K rollover) already play for their classes.
#
# WHAT IT FLAGS (scope — kept crisp for near-zero false positives)
#   A "site" is an INLINE  new Date(<ARG>).toLocale...(  in one of two shapes:
#     (a) <ARG> is a RAW VALUE — a bare identifier or member/index access (`then`,
#         `row.updatedAt`, `r.at`) with NO operators.
#     (b) <ARG> is a STRING CONCATENATION — `new Date(x + 'T12:00:00')` — the ISO
#         datetime form. This was ORIGINALLY out of scope on the assumption x is
#         always a machine ISO day key (the Hunter calendar). That assumption BROKE:
#         essays/index.html fed a HAND-EDITED manifest value (e.date) into this exact
#         form, so a typo'd date rendered the literal "Invalid Date" on a live public
#         page — the very class this gate exists to catch, slipping through the hole.
#         Concat is now IN scope; a machine-key concat site (genuinely never Invalid)
#         carries a `date-format-audit:ignore` marker to read GUARDED.
#   Scanned file types: .js/.ts/.mjs/.jsx AND .html (inline <script>) — the essays
#   bug lived in inline HTML, which the .js-only scan had also missed.
#   Deliberately OUT OF SCOPE (skipped, not flagged):
#     • new Date()            — argless, the current clock, ALWAYS valid.
#     • new Date(Date.now())  — a call expression; always valid.
#     • Vite BUILD OUTPUT only — dist/, hashed assets/index-*, *.min.* vendor drops.
#       Hand-authored pages under public/ (burgundy, structure, lauterbrunnen, …) are
#       Vite static assets served verbatim, so they ARE live source and ARE scanned
#       (see is_vendor_path — the blanket public/ exclusion was a blindspot, closed
#       2026-07-12: it hid every hand-authored public page, the exact class this gate
#       exists to catch).
#   The two-step form (`const d = new Date(x); … d.toLocaleDateString()`) needs
#   variable tracking and is FP-prone; not modelled here (documented gap).
#
#   GUARDED — a validity guard appears in real code within ±W lines of the site:
#             isNaN / getTime / isFinite / Number.isFinite / an `=== null` / `== null`
#             check / the word "Invalid" / parseDateMs (the repo's shared safe parser).
#             This is what every hardened formatter in this repo already does.
#   NAIVE   — a raw-value inline date formatter with NO such guard nearby. A present-
#             but-unparseable value renders "Invalid Date" to the user — worth a look.
#
# It is a HEURISTIC linter, not a prover. A clever guard it doesn't model reads as a
# false NAIVE — inspect, then either add a guard or whitelist with an inline
# `date-format-audit:ignore` marker (document why next to it).
#
# IMPLEMENTATION NOTE — why grep/awk, not rg: in this environment `rg` is a SHELL
# FUNCTION (Claude Code's token wrapper), absent for a non-interactive/cron run
# (exit 127). grep + awk are always present, so this stays portable to headless.
#
# USAGE
#   scripts/find-unguarded-date-format.sh            # table of every inline site, GUARDED/NAIVE
#   scripts/find-unguarded-date-format.sh --check    # exit 1 if any NAIVE site exists (CI gate)
#   scripts/find-unguarded-date-format.sh --self-test # prove the classifier on fixtures
#
# OUTPUT (one line per site, NAIVE first):
#   <GUARDED|NAIVE>  <file>:<line>
#
set -euo pipefail

cd "$(dirname "$0")/.."

WINDOW=12
# Tokens that mark a date value as validity-checked in the surrounding code.
GUARD='isNaN|getTime|isFinite|Invalid|parseDateMs|[!=]==?[[:space:]]*null|null[[:space:]]*[!=]=='
# Inspected + judged safe: an inline `date-format-audit:ignore` marker in the window
# exempts a site (reads as GUARDED). Use ONLY after confirming the value can never be
# an Invalid Date (e.g. it is always a fresh Date.now()); document why next to it.
IGNORE='date-format-audit:ignore'

# Classify every inline raw-value date formatter in one file. Emits: STATUS\tfile:line
#
# Works on a COMMENT-STRIPPED view: the hardened files describe the OLD naive
# `new Date(x).toLocaleDateString()` they already fixed in a block comment, and that
# word would otherwise read as a live site. Stripping `//`-tails and full comment
# lines keeps the audit on real code — for the site match AND the guard search.
classify_file() {
  awk -v F="$1" -v GUARD="$GUARD" -v IGN="$IGNORE" -v W="$WINDOW" '
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
      for (i=1; i<=NR; i++) {
        line=C[i]
        # Two in-scope shapes of inline `new Date(ARG).toLocale…(`:
        #  (a) BARE raw value — ARG has NO operators/parens/commas, so it admits only
        #      a bare ident or dotted/bracket member access (`then`, `row.updatedAt`).
        #  (b) STRING-CONCATENATION ISO form — `new Date(x + "T…")`. Safe ONLY when x
        #      is a machine-generated ISO day key (the Hunter calendar); a HAND-AUTHORED
        #      x (the essays manifest) can be Invalid Date, so it is IN scope and
        #      classified GUARDED/NAIVE like the bare form. Machine-key concat sites
        #      carry a `date-format-audit:ignore` marker (→ GUARDED).
        # Try (a) first; else (b). They are mutually exclusive (bare forbids +, concat
        # requires +), so whichever matches sets RSTART/RLENGTH for the arg extraction.
        if (match(line, /new[[:space:]]+Date\([^()+*\/%,-]*\)\.toLocale[A-Za-z]*\(/)) {
        } else if (match(line, /new[[:space:]]+Date\([^()]*\+[^()]*\)\.toLocale[A-Za-z]*\(/)) {
        } else continue
        seg=substr(line, RSTART, RLENGTH)
        arg=seg
        sub(/^new[[:space:]]+Date\(/, "", arg)
        sub(/\)\.toLocale.*$/, "", arg)
        gsub(/[[:space:]]/, "", arg)
        if (arg == "") continue          # new Date() — argless clock, always valid
        # Guarded? a guard token in real code within the ±W window.
        g=0
        for (j=i-W; j<=i+W; j++) if (j>=1 && j<=NR && C[j] ~ GUARD) { g=1; break }
        # Inspected-safe ignore marker (lives in a comment) → treat as GUARDED.
        ign=0
        for (j=i-W; j<=i+W; j++) if (j>=1 && j<=NR && index(RAW[j], IGN)) { ign=1; break }
        printf "%s\t%s:%d\n", ((g || ign) ? "GUARDED" : "NAIVE"), F, i
      }
    }' "$1"
}

# Build-output / vendor paths that are NOT hand-authored source. NOTE: hand-authored
# pages under public/ (public/burgundy, public/structure, public/lauterbrunnen,
# public/westchester, public/humanelement-cal, …) are Vite STATIC ASSETS served
# verbatim — they ARE live source and MUST be scanned. This gate's whole reason to
# exist is catching a NEW hand-authored page's raw `new Date(field).toLocale…()`, and
# most of Johnny's new pages ship under public/. So we do NOT blanket-exclude public/;
# we exclude only Vite's built bundles (dist/, hashed assets/index-*) + minified vendor
# drops. (Earlier this over-excluded ALL of public/, blinding the gate to every
# hand-authored public page — closed 2026-07-12.)
is_vendor_path() {
  case "$1" in
    */node_modules/*|node_modules/*) return 0 ;;
    */dist/*|dist/*)                  return 0 ;;
    *assets/index-*)                  return 0 ;;   # Vite hashed build output
    *.min.js|*.min.mjs)               return 0 ;;   # minified vendor
    *) return 1 ;;
  esac
}

# Repo scan: every non-test, non-vendor source file with an inline toLocale date call.
scan_repo() {
  local files f
  files=$(grep -rlE 'new[[:space:]]+Date\([^()]*\)\.toLocale' \
            --include='*.js' --include='*.ts' --include='*.mjs' --include='*.jsx' --include='*.html' . 2>/dev/null \
          | grep -vE '\.(test|spec)\.' || true)
  for f in $files; do
    is_vendor_path "$f" && continue
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

  # Fixture 1: NAIVE — raw member-access value fed straight to a display formatter,
  # no guard anywhere. A null/garbage updatedAt renders "Invalid Date". MUST be NAIVE.
  cat >"$tmp/naive.js" <<'JS'
function row(r) {
  return new Date(r.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
JS
  # Fixture 2: GUARDED via an `== null` check in the window. MUST be GUARDED.
  cat >"$tmp/guarded-null.js" <<'JS'
function stamp(x) {
  if (x == null) return 'unknown';
  return new Date(x).toLocaleString('en-US');
}
JS
  # Fixture 3: GUARDED via isNaN(getTime()) in the window. MUST be GUARDED.
  cat >"$tmp/guarded-isnan.js" <<'JS'
function stamp(s) {
  const t = new Date(s.at).getTime();
  if (isNaN(t)) return 'n/a';
  return new Date(s.at).toLocaleDateString();
}
JS
  # Fixture 4: argless new Date() — the live clock, always valid. MUST NOT appear.
  cat >"$tmp/clock.js" <<'JS'
const today = new Date().toLocaleDateString('en-US', { year: 'numeric' });
JS
  # Fixture 5: string-concatenation ISO form fed a HAND-AUTHORED value with NO guard —
  # the essays-manifest bug. Now IN scope. A typo'd value renders "Invalid Date". NAIVE.
  cat >"$tmp/iso-naive.js" <<'JS'
const label = new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
JS
  # Fixture 5b: INLINE concatenation form with an isNaN guard within the window → GUARDED.
  # (The essays fix uses the two-step `const d = new Date(x); … d.toLocale…()` form, which
  # this inline gate deliberately does not model — so once fixed, essays simply drops out
  # of the site list, exactly as intended.)
  cat >"$tmp/iso-guarded.js" <<'JS'
function fmtDate(s) {
  if (isNaN(new Date(s + 'T12:00:00').getTime())) return '';
  return new Date(s + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
}
JS
  # Fixture 5c: concatenation form with a machine ISO key + inspected ignore marker.
  # GUARDED (the Hunter shoot-calendar form — day is a dateKey(), never Invalid).
  cat >"$tmp/iso-ignored.js" <<'JS'
// date-format-audit:ignore (day is a machine ISO key from dateKey(), never Invalid)
const label = new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
JS
  # Fixture 6: a comment describing the OLD naive call must NOT read as a live site.
  cat >"$tmp/comment.js" <<'JS'
// old bug: new Date(s.createdAt).toLocaleString() rendered the literal "Invalid Date"
const ok = true;
JS
  # Fixture 7: naive site with an inspected ignore marker → exempt (GUARDED).
  cat >"$tmp/ignored.js" <<'JS'
// date-format-audit:ignore (ts is always a fresh Date.now() captured this tick)
const z = new Date(ts).toLocaleTimeString('en-US');
JS

  local out
  out=$(classify_file "$tmp/naive.js")
  assert "$out" "NAIVE	$tmp/naive.js:2" "raw member value, no guard → NAIVE" || rc=1

  out=$(classify_file "$tmp/guarded-null.js")
  assert "$out" "GUARDED	$tmp/guarded-null.js:3" "== null guard in window → GUARDED" || rc=1

  out=$(classify_file "$tmp/guarded-isnan.js")
  assert "$out" "GUARDED	$tmp/guarded-isnan.js:4" "isNaN(getTime()) guard in window → GUARDED" || rc=1

  out=$(classify_file "$tmp/clock.js")
  assert "$out" "" "argless new Date() clock produces no site" || rc=1

  out=$(classify_file "$tmp/iso-naive.js")
  assert "$out" "NAIVE	$tmp/iso-naive.js:1" "concatenation form, hand value, no guard → NAIVE" || rc=1

  out=$(classify_file "$tmp/iso-guarded.js")
  assert "$out" "GUARDED	$tmp/iso-guarded.js:3" "inline concatenation form with isNaN guard → GUARDED" || rc=1

  out=$(classify_file "$tmp/iso-ignored.js")
  assert "$out" "GUARDED	$tmp/iso-ignored.js:2" "concatenation form with ignore marker → GUARDED" || rc=1

  out=$(classify_file "$tmp/comment.js")
  assert "$out" "" "comment describing the old naive call produces no site" || rc=1

  out=$(classify_file "$tmp/ignored.js")
  assert "$out" "GUARDED	$tmp/ignored.js:2" "inspected ignore-marker site reads GUARDED" || rc=1

  # Scope predicate: hand-authored public/ pages MUST be scanned; only Vite build
  # output + minified vendor are excluded. (Regression guard for the 2026-07-12 fix —
  # reverting is_vendor_path to blanket-exclude public/ turns the first line RED.)
  scope() { is_vendor_path "$1" && echo VENDOR || echo SOURCE; }
  assert "$(scope public/burgundy/index.html)"    "SOURCE" "hand-authored public/ page is IN scope" || rc=1
  assert "$(scope public/westchester/index.html)" "SOURCE" "another hand-authored public/ page is IN scope" || rc=1
  assert "$(scope dist/assets/app.js)"            "VENDOR" "dist/ build output excluded" || rc=1
  assert "$(scope public/assets/index-a1b2c3.js)" "VENDOR" "hashed Vite bundle excluded" || rc=1
  assert "$(scope vendor/mapbox-gl.min.js)"       "VENDOR" "minified vendor drop excluded" || rc=1
  assert "$(scope node_modules/foo/bar.js)"       "VENDOR" "node_modules excluded" || rc=1

  # Load-bearing: the LIVE repo must currently be clean (0 NAIVE). If this fails, a
  # real un-guarded inline date formatter shipped — the whole reason the tool exists.
  local naive_live
  naive_live=$(scan_repo | grep -c '^NAIVE' || true)
  if [ "$naive_live" -eq 0 ]; then
    echo "PASS  live repo scan: 0 NAIVE inline date formatters"
  else
    echo "FAIL  live repo scan: $naive_live NAIVE inline date formatter(s) — run without --self-test to see them"
    rc=1
  fi

  [ "$rc" -eq 0 ] && echo "── self-test: ALL PASS ──" || echo "── self-test: FAILURES ──"
  return $rc
}

# ─────────────────────────────── main ───────────────────────────────
case "${1:-}" in
  --self-test) self_test ;;
  --check)
    rows=$(scan_repo | sort)   # NAIVE sorts before GUARDED
    naive=$(printf '%s\n' "$rows" | grep -c '^NAIVE' || true)
    printf '%s\n' "$rows" | grep '^NAIVE' || true
    if [ "$naive" -gt 0 ]; then
      echo "✗ $naive NAIVE inline date formatter(s) — a present-but-unparseable value renders \"Invalid Date\"" >&2
      exit 1
    fi
    echo "✓ 0 NAIVE inline date formatters ($(printf '%s\n' "$rows" | grep -c '^GUARDED' || true) GUARDED)"
    ;;
  ''|--list)
    rows=$(scan_repo | sort)
    g=$(printf '%s\n' "$rows" | grep -c '^GUARDED' || true)
    n=$(printf '%s\n' "$rows" | grep -c '^NAIVE' || true)
    echo "inline new Date(<rawValue>).toLocale*() sites:"
    echo "  STATUS    SITE   [GUARDED=isNaN/null/getTime guard nearby · NAIVE=renders \"Invalid Date\" on a bad value]"
    printf '%s\n' "$rows" | awk -F'\t' 'NF==2 { printf "  %-9s %s\n", $1, $2 }'
    echo "→ $((g+n)) inline date-formatter site(s): $g GUARDED, $n NAIVE."
    [ "$n" -gt 0 ] && echo "  inspect each NAIVE: does a present-but-unparseable value reach this formatter?"
    ;;
  *) echo "usage: $0 [--list|--check|--self-test]" >&2; exit 2 ;;
esac
