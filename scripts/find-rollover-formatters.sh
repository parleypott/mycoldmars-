#!/usr/bin/env bash
#
# find-rollover-formatters.sh — audit every number-abbreviation formatter in the
# repo and flag the NAIVE ones that flash "1000K" / "1000.0M" at a unit boundary.
#
# WHY THIS EXISTS
# The single richest recurring live-bug vein this loop has mined is the
# "number-abbreviation rollover flash": a value formatter that does
#     (v / 1e6).toFixed(1) + 'M'
# with no guard for the band just below the next unit. At v = 999,950 that prints
# "1000.0K" (or "1000.0M" one tier up) for a frame mid-climb instead of rolling
# to "1.0M" / "1.0B". The loop has fixed this same bug at least SIX times:
#   - views-growth fmtViews ("1000K" flash, 999.5K-999.99K band)
#   - views-growth y-axis tick callback (a FOURTH divergent copy of fmtViews)
#   - growth fmtCount (subscriber chart, same band)
#   - westchester fmtUSDshort ("$1000K" on the loan line)
#   - views-growth M->B boundary ("1000.0M" instead of "1.0B")
#   ...each one a SEPARATELY-NAMED copy of the same idea.
#
# That last word is why the divergence scanner (find-divergent-fns.sh) is BLIND to
# this class: it groups by function NAME, but these copies are all named
# differently — fmtViews, fmtCount, fmtUSDshort, the bare y-axis callback. Nothing
# stops a NEW chart Johnny adds next month from shipping yet another naive copy,
# and no name-based tool will ever surface it. This codifies the by-hand audit the
# loop keeps re-doing: find every abbreviation formatter by its SHAPE (a magnitude
# divide feeding .toFixed() with a unit suffix), and classify each GUARDED vs NAIVE.
#
# WHAT IT FLAGS
#   GUARDED — the formatter has a rollover-band guard near the divide: a threshold
#             comparison that routes the 999.5->1000 band up a tier. Recognized
#             guard shapes: `>= 1e6` / `>= 1e9`, `>= 1000` / `k >= 1000`,
#             `=== '1000.0'` (the post-toFixed string check). These are exactly the
#             forms every hardened copy in this repo already uses.
#   NAIVE   — a magnitude divide feeds .toFixed()+unit with NO such guard in the
#             surrounding window. A candidate "1000K flash" — worth a human look.
#
# It is a HEURISTIC linter, not a prover: a clever guard it doesn't recognize will
# read as a false NAIVE (inspect, then either harden or whitelist by hardening into
# a recognized shape). False GUARDED is unlikely — it requires a real threshold
# token next to the divide. The point is the same as the divergence scanner: narrow
# the whole repo to the few formatter sites worth eyeballing, every iteration, free.
#
# IMPLEMENTATION NOTE — why grep/awk, not rg: in this environment `rg` is a SHELL
# FUNCTION (Claude Code's token wrapper), absent for a non-interactive/cron run
# (exit 127). grep + awk are always present, so this stays portable to headless.
#
# USAGE
#   scripts/find-rollover-formatters.sh            # table of every site, GUARDED/NAIVE
#   scripts/find-rollover-formatters.sh --check    # exit 1 if any NAIVE site exists (CI gate)
#   scripts/find-rollover-formatters.sh --self-test # prove the classifier on fixtures
#
# OUTPUT (one line per site, NAIVE first):
#   <GUARDED|NAIVE>  <file>:<line>
#
set -euo pipefail

cd "$(dirname "$0")/.."

# ── The shape of an abbreviation formatter, and the shape of its rollover guard ──
# A candidate FORMATTER (not just any divide) needs all three, within one window:
#   1. `.toFixed(`                         — the rounded display
#   2. a magnitude divide by 1e3/1e6/1e9   — 1000 / 1_000_000 / 1000000000 etc.
#   3. a quoted magnitude UNIT suffix 'K'/'M'/'B'/'T'
# Requirement 3 is what separates a count/money abbreviator (the rollover class)
# from a `/1000` ms->seconds conversion ending in 's'/'min' — those divide and
# .toFixed too, but never roll a unit, so they are NOT this bug class.
CAND_DIVIDE='/[[:space:]]*(1e[369]|1_?000(_?000)?(_?000)?)'
SUFFIX='["'"'"'`][KMBT]["'"'"'`]'
# A guard token in the window that routes the 999.5->1000 rollover band up a tier.
GUARD='(>=?[[:space:]]*1e[369])|([kvKVnpa][[:space:]]*>=?[[:space:]]*1_?000)|(>=?[[:space:]]*1_?000([^0-9]|$))|((===?)[[:space:]]*["'"'"'`]?1_?000)'
# Inspected + judged unreachable: an inline `rollover-audit:ignore` marker in the
# window exempts a site (it reads as GUARDED). Use ONLY after confirming the values
# can never reach the band below the next unit; document why next to the marker.
IGNORE='rollover-audit:ignore'

# Classify every formatter site in one file. Emits: STATUS\tfile:line
classify_file() {
  awk -v F="$1" -v CAND="$CAND_DIVIDE" -v SUFFIX="$SUFFIX" -v GUARD="$GUARD" -v IGN="$IGNORE" '
    { L[NR]=$0 }
    END {
      sline=0; gflag=0; last=-100
      for (i=1; i<=NR; i++) {
        line=L[i]
        if (line !~ /\.toFixed\(/) continue
        if (line !~ CAND) continue
        # Require a magnitude unit suffix in the ±4 window (else it is a unit
        # CONVERSION like ms->s, not a count/money abbreviation that rolls over).
        sfx=0
        for (j=i-4; j<=i+4; j++) if (j>=1 && j<=NR && L[j] ~ SUFFIX) { sfx=1; break }
        if (!sfx) continue
        # GUARDED if the window has a recognized rollover guard OR an ignore marker.
        wg=0
        for (j=i-4; j<=i+4; j++) if (j>=1 && j<=NR && (L[j] ~ GUARD || index(L[j], IGN))) { wg=1; break }
        if (sline>0 && i <= last+8) {        # same formatter (lines clustered)
          if (wg) gflag=1
          last=i
        } else {
          if (sline>0) printf "%s\t%s:%d\n", (gflag?"GUARDED":"NAIVE"), F, sline
          sline=i; gflag=wg; last=i
        }
      }
      if (sline>0) printf "%s\t%s:%d\n", (gflag?"GUARDED":"NAIVE"), F, sline
    }' "$1"
}

# Repo scan: every non-test, non-vendor source file that even mentions .toFixed.
scan_repo() {
  local files
  files=$(grep -rlE '\.toFixed\(' \
            --include='*.js' --include='*.html' --include='*.ts' --include='*.mjs' . 2>/dev/null \
          | grep -v node_modules | grep -v '/dist/' \
          | grep -vE '\.(test|spec)\.' || true)
  local f
  for f in $files; do
    classify_file "$f"
  done
}

self_test() {
  local tmp rc=0
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN

  # Fixture 1: NAIVE — bare divide+toFixed+unit, no guard. MUST be flagged NAIVE.
  cat >"$tmp/naive.js" <<'JS'
function fmtViews(v) {
  return (v / 1e6).toFixed(1) + 'M';
}
JS
  # Fixture 2: GUARDED (same-line threshold). MUST be GUARDED.
  cat >"$tmp/guarded.js" <<'JS'
function fmtCount(v) {
  const k = Math.round(v / 1000);
  return (v >= 1e6 || k >= 1000) ? (v / 1e6).toFixed(1) + 'M' : k + 'K';
}
JS
  # Fixture 3: GUARDED via the post-toFixed string check on a FOLLOWING line
  # (the views-growth `m === '1000.0'` shape — proves the window, not same-line).
  cat >"$tmp/guarded-window.js" <<'JS'
function fmtBig(v) {
  const m = (v / 1e6).toFixed(1);
  return m === '1000.0' ? (v / 1e9).toFixed(1) + 'B' : m + 'M';
}
JS
  # Fixture 4: NOT a formatter — toFixed with no magnitude divide. MUST NOT appear.
  cat >"$tmp/notformatter.js" <<'JS'
function pct(x) { return (x * 100).toFixed(1) + '%'; }
JS
  # Fixture 5: a /1000 ms->seconds CONVERSION (suffix 's', not K/M/B). MUST NOT appear.
  cat >"$tmp/conversion.js" <<'JS'
const elapsed = ((Date.now() - t0) / 1000).toFixed(1) + 's';
JS
  # Fixture 6: naive K-formatter with an inspected `ignore` marker → exempt (GUARDED).
  cat >"$tmp/ignored.js" <<'JS'
// rollover-audit:ignore (line items never reach $1M)
const s = (x / 1000).toFixed(1) + 'K';
JS

  local out
  out=$(classify_file "$tmp/naive.js")
  assert "$out" "NAIVE	$tmp/naive.js:2" "naive bare divide flagged NAIVE" || rc=1

  out=$(classify_file "$tmp/guarded.js")
  assert "$out" "GUARDED	$tmp/guarded.js:3" "same-line threshold flagged GUARDED" || rc=1

  out=$(classify_file "$tmp/guarded-window.js")
  assert "$out" "GUARDED	$tmp/guarded-window.js:2" "following-line string-check flagged GUARDED" || rc=1

  out=$(classify_file "$tmp/notformatter.js")
  assert "$out" "" "non-magnitude toFixed produces no site" || rc=1

  out=$(classify_file "$tmp/conversion.js")
  assert "$out" "" "ms->seconds conversion (suffix 's') produces no site" || rc=1

  out=$(classify_file "$tmp/ignored.js")
  assert "$out" "GUARDED	$tmp/ignored.js:2" "inspected ignore-marker site reads GUARDED" || rc=1

  # Load-bearing: the LIVE repo must currently be clean (0 NAIVE). If this fails,
  # a real un-hardened formatter shipped — the whole reason the tool exists.
  local naive_live
  naive_live=$(scan_repo | grep -c '^NAIVE' || true)
  if [ "$naive_live" -eq 0 ]; then
    echo "PASS  live repo scan: 0 NAIVE formatters"
  else
    echo "FAIL  live repo scan: $naive_live NAIVE formatter(s) — run without --self-test to see them"
    rc=1
  fi

  [ "$rc" -eq 0 ] && echo "── self-test: ALL PASS ──" || echo "── self-test: FAILURES ──"
  return $rc
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

# ─────────────────────────────── main ───────────────────────────────
case "${1:-}" in
  --self-test) self_test ;;
  --check)
    rows=$(scan_repo | sort)   # NAIVE sorts before GUARDED
    naive=$(printf '%s\n' "$rows" | grep -c '^NAIVE' || true)
    printf '%s\n' "$rows" | grep '^NAIVE' || true
    if [ "$naive" -gt 0 ]; then
      echo "✗ $naive NAIVE number-abbreviation formatter(s) — possible '1000K' flash" >&2
      exit 1
    fi
    echo "✓ 0 NAIVE formatters ($(printf '%s\n' "$rows" | grep -c '^GUARDED' || true) GUARDED)"
    ;;
  ''|--list)
    rows=$(scan_repo | sort)
    g=$(printf '%s\n' "$rows" | grep -c '^GUARDED' || true)
    n=$(printf '%s\n' "$rows" | grep -c '^NAIVE' || true)
    echo "number-abbreviation formatters (divide → .toFixed() → unit):"
    echo "  STATUS    SITE   [GUARDED=has rollover-band guard · NAIVE=may flash 1000K/1000.0M]"
    printf '%s\n' "$rows" | awk -F'\t' 'NF==2 { printf "  %-9s %s\n", $1, $2 }'
    echo "→ $((g+n)) formatter site(s): $g GUARDED, $n NAIVE."
    [ "$n" -gt 0 ] && echo "  inspect each NAIVE: does it flash a wrong unit in the band just below the next tier?"
    ;;
  *) echo "usage: $0 [--list|--check|--self-test]" >&2; exit 2 ;;
esac
