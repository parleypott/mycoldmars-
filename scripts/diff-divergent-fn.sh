#!/usr/bin/env bash
#
# diff-divergent-fn.sh — extract and COMPARE function bodies across files.
#
# WHY THIS EXISTS
# find-divergent-fns.sh surfaces every function NAME defined in 2+ source files
# — the candidate divergent copies. Its own header then says, do this by hand:
#     grep -n -A6 'function NAME' <each file>   # then diff the bodies.
# That manual body-diff is the loop's single most productive bug-finding move
# (a hardened helper gets fixed in one file while a stale twin keeps the bug),
# but doing it by eyeball across ~50 shared names every iteration is slow and
# lossy — you skim, you miss the one that actually drifted.
#
# This codifies the body-diff step. Given a function name it pulls the
# balanced-brace body from every non-test source file that defines it, normalizes
# cosmetic noise (indentation, blank lines, // line-comments), and reports:
#     IDENTICAL  — all copies match (coincidental name reuse, or already merged)
#     DIVERGENT  — bodies differ → prints a unified diff of the outliers
# In --scan mode it runs find-divergent-fns.sh and prints ONLY the DIVERGENT
# names: the actionable shortlist. That converts "50 names to eyeball" into
# "the N that genuinely drifted" — a direct multiplier on the best technique.
#
# It is a TRIAGE aid, not a parser: brace counting is char-naive (it does not
# special-case braces inside strings/regex/template-literals). That can split a
# pathological body early, but it splits BOTH copies the same way, so two truly
# identical copies still compare equal — the equality verdict is robust; a
# DIVERGENT verdict on a brace-in-string-heavy function is worth an eyeball.
# Single-expression arrows (`const f = x => x*2`, no brace body) are reported
# NO-BODY and skipped. Intentional splits (a text-only escapeHtml vs escapeAttr)
# will show DIVERGENT — that is correct; the tool flags, the human judges.
#
# WHY grep/awk not rg/node: same as find-divergent-fns.sh — rg is a shell
# function in this env (absent headless) and this must run under cron. grep +
# awk are always present.
#
# USAGE
#   scripts/diff-divergent-fn.sh NAME                 # compare one function's bodies
#   scripts/diff-divergent-fn.sh --scan [MIN]         # shortlist DIVERGENT names, tagged vs the triage ledger
#   scripts/diff-divergent-fn.sh --scan [MIN] --new   # ONLY untriaged / re-drifted names (skip judged-SAFE forks)
#   scripts/diff-divergent-fn.sh --self-test          # prove the classifier; exit!=0 on fail
#
# TRIAGE LEDGER: scripts/divergence-triage.tsv remembers which names were already
# judged SAFE (a legit fork), BUG (open), or IGNORE (a same-name COLLISION — N
# unrelated functions sharing a generic identifier like `handler`/`txt`/`items`,
# never a real divergent copy). --scan tags each candidate; --new hides the
# settled SAFE *and* IGNORE rows so a future iteration only eyeballs what's
# genuinely new. A SAFE name whose overlap% later CHANGES is re-flagged "SAFE↻"
# (the fork drifted further — re-check before trusting the old verdict); IGNORE
# rows are EXEMPT from that re-review (collision overlap is meaningless noise that
# drifts constantly, so a SAFE row could never silence them durably). Record
# every verdict there.
#
# EXIT
#   single-name mode : 0 if IDENTICAL (or <2 bodies), 1 if DIVERGENT
#   --scan           : 0 always (it is a report); count of divergent names on stderr
#   --self-test      : 0 if all fixtures classified correctly, else 1
#
set -euo pipefail

cd "$(dirname "$0")/.."
SELF="scripts/diff-divergent-fn.sh"

GREP_OPTS=(
  -rlE
  --include='*.js' --include='*.mjs' --include='*.ts'
  --exclude='*.test.*' --exclude='*.spec.*'
  --exclude-dir=node_modules --exclude-dir=dist
)

# --- balanced-brace body extractor -------------------------------------------
# Prints the normalized body of the first definition of NAME in FILE, or nothing.
# Normalization: trim each line, drop // line-comments and blank lines.
extract_body() {
  local file="$1" name="$2"
  awk -v name="$name" '
    function isdef(line,   re) {
      # function NAME( ... )   /   (function NAME(   /   export function NAME(
      re = "(^|[^A-Za-z0-9_$])function[ \t]+" name "[ \t]*\\("
      if (line ~ re) return 1
      # const NAME = ... function|(   (arrow or function expression)
      re = "(^|[^A-Za-z0-9_$])(const|let|var)[ \t]+" name "[ \t]*="
      if (line ~ re) return 1
      return 0
    }
    { lines[NR] = $0 }
    END {
      start = 0
      for (i = 1; i <= NR; i++) { if (isdef(lines[i])) { start = i; break } }
      if (!start) exit 0
      # Accumulate the body string starting at the FIRST "{" (inclusive) and
      # ending at its matching "}" (inclusive), across however many lines.
      started = 0; depth = 0; done = 0; buf = ""
      for (j = start; j <= NR && !done; j++) {
        s = lines[j]
        for (k = 1; k <= length(s); k++) {
          c = substr(s, k, 1)
          if (c == "{") { depth++; started = 1 }
          if (started) buf = buf c
          if (c == "}") { depth--; if (started && depth == 0) { done = 1; break } }
        }
        if (started && !done) buf = buf "\n"
      }
      if (!started) exit 0
      # Emit normalized body, line by line, so cosmetic diffs do not split copies.
      n = split(buf, arr, "\n")
      for (m = 1; m <= n; m++) {
        line = arr[m]
        sub(/\/\/.*$/, "", line)               # strip line comments
        gsub(/^[ \t]+|[ \t]+$/, "", line)       # trim
        gsub(/[ \t]+/, " ", line)               # collapse internal runs
        if (line == "") continue
        print line
      }
    }
  ' "$file"
}

# Min line-overlap (%) between two copies for a divergence to count as a DRIFTED
# COPY (worth a look) rather than a coincidental same-name collision (noise).
SIM_THRESHOLD="${DIFF_FN_SIM:-50}"

# Max pairwise normalized-line overlap (integer %) among the body.* files in $1.
# 100 = identical line sets; low = unrelated functions that share a name.
max_similarity() {
  local dir="$1" n="$2" best=0 i j
  for ((i = 0; i < n; i++)); do
    for ((j = i + 1; j < n; j++)); do
      local a b shared ratio
      a=$(sort -u "$dir/body.$i" | wc -l)
      b=$(sort -u "$dir/body.$j" | wc -l)
      shared=$(comm -12 <(sort -u "$dir/body.$i") <(sort -u "$dir/body.$j") | wc -l)
      local denom=$(( a > b ? a : b ))
      [ "$denom" -eq 0 ] && continue
      ratio=$(( shared * 100 / denom ))
      [ "$ratio" -gt "$best" ] && best=$ratio
    done
  done
  echo "$best"
}

# --- compare one name across all defining files ------------------------------
compare_name() {
  local name="$1" quiet="${2:-}"
  # Word-boundary-ish search so "tick" does not match "ticked"; we still verify
  # via extract_body (which requires a real definition), so a loose file list is fine.
  local files
  mapfile -t files < <(grep "${GREP_OPTS[@]}" -e "[^A-Za-z0-9_\$]${name}[^A-Za-z0-9_\$]" . 2>/dev/null | sort -u || true)

  local -a have_file
  local tmpdir; tmpdir="$(mktemp -d)"
  local n=0
  for f in "${files[@]}"; do
    local b; b="$(extract_body "$f" "$name")"
    [ -z "$b" ] && continue
    printf '%s\n' "$b" > "$tmpdir/body.$n"
    have_file[$n]="$f"
    n=$((n + 1))
  done

  if [ "$n" -lt 2 ]; then
    rm -rf "$tmpdir"
    [ "$quiet" = "quiet" ] && return 0
    echo "· $name: only $n extractable definition(s) — nothing to compare."
    return 0
  fi

  # Are all bodies identical to the first?
  local divergent=0 i
  for ((i = 1; i < n; i++)); do
    if ! diff -q "$tmpdir/body.0" "$tmpdir/body.$i" >/dev/null 2>&1; then
      divergent=1; break
    fi
  done

  if [ "$divergent" -eq 0 ]; then
    rm -rf "$tmpdir"
    [ "$quiet" = "quiet" ] && return 0
    echo "✓ $name: IDENTICAL across $n files"
    for ((i = 0; i < n; i++)); do echo "    ${have_file[$i]}"; done
    return 0
  fi

  # DIVERGENT. In quiet (scan) mode, gate on similarity so coincidental same-name
  # collisions ("handler", "main", single letters) are dropped and only drifted
  # COPIES survive. In human mode, always show the diff — the caller asked for it.
  local sim; sim="$(max_similarity "$tmpdir" "$n")"
  # Largest body (normalized lines) — tiny 2-3 line helpers are cheap to eyeball
  # and dominate the noise, so the scan shortlist skips them.
  local maxlines=0 i2
  for ((i2 = 0; i2 < n; i2++)); do
    local l; l=$(grep -c . "$tmpdir/body.$i2")
    [ "$l" -gt "$maxlines" ] && maxlines=$l
  done
  if [ "$quiet" = "quiet" ]; then
    rm -rf "$tmpdir"
    # The bug-bearing case (one copy hardened, one stale) means the hardened copy
    # has a line the stale one LACKS → overlap < 100%. A 100% set-overlap is just
    # a reordering or coincidence, never a missing fix — so cap below 100.
    if [ "$sim" -ge "$SIM_THRESHOLD" ] && [ "$sim" -lt 100 ] && [ "$maxlines" -ge "${DIFF_FN_MINLINES:-4}" ]; then
      printf '%s\t%s\t%s\n' "$sim" "$name" "$n"
      return 1
    fi
    return 0  # coincidental collision / cosmetic reorder / tiny body — not reported
  fi
  echo "✗ $name: DIVERGENT across $n files  (max body overlap ${sim}%)"
  echo "    [0] ${have_file[0]}  (baseline)"
  for ((i = 1; i < n; i++)); do
    if diff -q "$tmpdir/body.0" "$tmpdir/body.$i" >/dev/null 2>&1; then
      echo "    [$i] ${have_file[$i]}  (== baseline)"
    else
      echo "    [$i] ${have_file[$i]}  (DIFFERS):"
      diff -u "$tmpdir/body.0" "$tmpdir/body.$i" 2>/dev/null \
        | sed '1,2d' | sed 's/^/        /' || true
    fi
  done
  rm -rf "$tmpdir"
  return 1
}

# --- triage ledger -----------------------------------------------------------
# scripts/divergence-triage.tsv records which divergent names were already JUDGED
# (NAME<TAB>STATUS<TAB>SIM_AT_TRIAGE<TAB>REASON), so the scan can tag known forks
# and `--new` can hide them. lookup_triage NAME → prints "STATUS<TAB>SIM" or "".
LEDGER="scripts/divergence-triage.tsv"
lookup_triage() {
  local name="$1"
  [ -f "$LEDGER" ] || return 0
  awk -F'\t' -v n="$name" '
    /^#/ { next }
    $1 == n { print $2 "\t" $3; exit }
  ' "$LEDGER"
}

# Decide the display tag for a candidate from its ledger status + sims. Pure
# (prints one tag), so scan_mode and the self-test share one source of truth.
#   triage_tag STATUS LOGGED_SIM CURRENT_SIM
#   ""      (untriaged)            → NEW
#   IGNORE  (same-name collision)  → IGNORE   — hidden permanently, NEVER re-flagged
#                                               on sim drift (collision overlap is noise)
#   SAFE    + sim unchanged        → SAFE
#   SAFE    + sim changed          → SAFE↻    — fork drifted, re-review before trusting
#   anything else (BUG, …)         → echoed verbatim
triage_tag() {
  local status="$1" logged_sim="$2" cur_sim="$3"
  if [ -z "$status" ]; then echo NEW; return; fi
  case "$status" in
    IGNORE) echo IGNORE ;;
    SAFE)   if [ "$logged_sim" != "$cur_sim" ]; then echo "SAFE↻"; else echo SAFE; fi ;;
    *)      echo "$status" ;;
  esac
}

# --- scan mode: shortlist every DIVERGENT shared name ------------------------
# Usage: scan_mode [MIN] [--new]
#   --new → print ONLY untriaged (NEW) or re-drifted (SAFE↻) candidates: the
#           actionable set once the known-safe forks are recorded in the ledger.
scan_mode() {
  local min=2 only_new=0 a
  for a in "$@"; do
    case "$a" in
      --new) only_new=1 ;;
      ''|*[!0-9]*) : ;;   # non-numeric, ignore
      *) min="$a" ;;
    esac
  done
  echo "Scanning shared-name candidates (min files: $min) for DRIFTED COPIES" \
       "(body overlap ≥ ${SIM_THRESHOLD}%)…" >&2
  local results; results="$(mktemp)"
  # find-divergent-fns.sh emits: "<count>  <name>  <file> <file> ..."
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local name count
    name="$(printf '%s' "$line" | awk '{print $2}')"
    count="$(printf '%s' "$line" | awk '{print $1}')"
    [ -z "$name" ] && continue
    # 1-2 char names are never a shared helper worth diffing — pure collision noise.
    [ "${#name}" -lt 3 ] && continue
    # FAST PATH — skip the expensive body-extract for names already judged IGNORE
    # (same-name collisions: unrelated functions sharing a generic identifier).
    # IGNORE rows are EXEMPT from sim-drift re-review (triage_tag never re-flags
    # them) AND hidden by --new, so recomputing their body overlap is pure waste.
    # Crucially, the worst offenders ARE these collisions — generic names spanning
    # many files (handler×60, walk×17, selfTest×15, tick×10) force max_similarity's
    # O(files²) pairwise comm/sort/wc, which dominated the whole scan and drove the
    # 10-min hang (fork/exec thrash: sys-time ≫ user-time). Emit the row straight
    # from the ledger's logged sim instead. --new output is byte-identical (IGNORE
    # hidden either way); full-scan shows the same IGNORE rows with the stable
    # logged sim (which the ledger designates reference-only, so no fidelity loss).
    local led; led="$(lookup_triage "$name")"
    if [ "$(printf '%s' "$led" | cut -f1)" = IGNORE ]; then
      printf '%s\t%s\t%s\n' "$(printf '%s' "$led" | cut -f2)" "$name" "$count" >> "$results"
      continue
    fi
    compare_name "$name" quiet >> "$results" 2>/dev/null || true
  done < <(scripts/find-divergent-fns.sh "$min" 2>/dev/null || true)

  local total newcount=0 safecount=0
  total="$(grep -c . "$results" 2>/dev/null || echo 0)"
  if [ "$total" -gt 0 ]; then
    echo "  STATUS    SIM%  NAME (files)   [SAFE=judged-fork · IGNORE=name-collision noise · BUG=open · NEW=untriaged · ↻=re-drifted]"
    # Annotate each row against the ledger, then (optionally) filter to NEW/↻/BUG.
    while IFS=$'\t' read -r sim name nfiles; do
      local rec status logged_sim tag
      rec="$(lookup_triage "$name")"
      status="$(printf '%s' "$rec" | cut -f1)"
      logged_sim="$(printf '%s' "$rec" | cut -f2)"
      tag="$(triage_tag "$status" "$logged_sim" "$sim")"
      case "$tag" in
        NEW|"SAFE↻") newcount=$((newcount + 1)) ;;   # actionable: needs a look
        SAFE|IGNORE) safecount=$((safecount + 1)) ;;  # settled / noise
        *) ;;                                         # BUG etc — count neither
      esac
      if [ "$only_new" -eq 1 ] && { [ "$tag" = SAFE ] || [ "$tag" = IGNORE ]; }; then
        continue   # --new hides settled SAFE + collision-noise IGNORE; NEW/SAFE↻/BUG still shown
      fi
      printf '  %-8s %3s%%  %s (%s files)\n' "$tag" "$sim" "$name" "$nfiles"
    done < <(sort -rn "$results")
    echo "  → inspect any row with: $SELF NAME    (then record the verdict in $LEDGER)"
  fi
  rm -f "$results"
  echo "→ $total drifted-copy candidate(s); $newcount need a look (NEW/re-drifted), $safecount settled (SAFE/IGNORE)." >&2
}

# --- self-test: prove the classifier on fixtures -----------------------------
self_test() {
  local t; t="$(mktemp -d)"; local fail=0
  # Identical pair
  cat > "$t/a.js" <<'EOF'
export function clampNum(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}
EOF
  cat > "$t/b.js" <<'EOF'
function clampNum(n) {
  const v = Number(n);   // trailing comment + extra spaces should be normalized away
  return Number.isFinite(v) ? v : 0;
}
EOF
  # Divergent pair (the classic: one copy hardened, one stale)
  cat > "$t/c.js" <<'EOF'
function parseEmbedding(s) {
  const a = s.split(',').map(Number);
  if (a.some(x => !Number.isFinite(x))) return null;
  return a;
}
EOF
  cat > "$t/d.js" <<'EOF'
function parseEmbedding(s) {
  return s.split(',').map(Number);
}
EOF
  local pass=1
  # extract_body equality on the identical pair
  if diff -q <(extract_body "$t/a.js" clampNum) <(extract_body "$t/b.js" clampNum) >/dev/null; then
    echo "  ✓ identical bodies (cosmetic diffs normalized) compare equal"
  else
    echo "  ✗ FAIL: identical bodies reported different"; pass=0; fail=1
  fi
  # extract_body inequality on the divergent pair
  if ! diff -q <(extract_body "$t/c.js" parseEmbedding) <(extract_body "$t/d.js" parseEmbedding) >/dev/null; then
    echo "  ✓ divergent bodies (one hardened, one stale) compare different"
  else
    echo "  ✗ FAIL: divergent bodies reported equal"; pass=0; fail=1
  fi
  # Non-extractable: single-expression arrow has no brace body
  cat > "$t/e.js" <<'EOF'
const square = x => x * x;
EOF
  if [ -z "$(extract_body "$t/e.js" square)" ]; then
    echo "  ✓ brace-less arrow yields no body (correctly skipped)"
  else
    echo "  ✗ FAIL: brace-less arrow produced a body"; pass=0; fail=1
  fi
  # Balanced-brace nesting: a body with nested {} is captured whole, not cut early
  cat > "$t/f.js" <<'EOF'
function nest(x) {
  if (x) { return { a: 1 }; }
  return null;
}
EOF
  if extract_body "$t/f.js" nest | grep -q 'return null'; then
    echo "  ✓ nested braces captured to the true closing brace"
  else
    echo "  ✗ FAIL: nested-brace body truncated early"; pass=0; fail=1
  fi
  # Triage ledger: lookup hits a recorded row, misses an unknown one, and the
  # SIM-changed re-review logic fires (logged sim != current sim → SAFE↻).
  local saved_ledger="$LEDGER"
  LEDGER="$t/ledger.tsv"
  printf '# comment line\nfoo\tSAFE\t77\tjust a fork\nbar\tBUG\t60\topen defect\n' > "$LEDGER"
  if [ "$(lookup_triage foo)" = "$(printf 'SAFE\t77')" ]; then
    echo "  ✓ ledger lookup returns STATUS+SIM for a recorded name"
  else
    echo "  ✗ FAIL: ledger lookup wrong for recorded name"; pass=0; fail=1
  fi
  if [ -z "$(lookup_triage neverseen)" ]; then
    echo "  ✓ ledger lookup empty for an untriaged name (→ NEW)"
  else
    echo "  ✗ FAIL: ledger lookup non-empty for untriaged name"; pass=0; fail=1
  fi
  # re-review trigger: recorded sim 77 vs a current 70 must be detected as changed
  local lr ls li; lr="$(lookup_triage foo)"; ls="$(printf '%s' "$lr" | cut -f1)"; li="$(printf '%s' "$lr" | cut -f2)"
  if [ "$ls" = SAFE ] && [ "$li" != 70 ]; then
    echo "  ✓ SIM-change re-review condition fires (logged 77 ≠ current 70 → SAFE↻)"
  else
    echo "  ✗ FAIL: SIM-change re-review condition did not fire"; pass=0; fail=1
  fi
  # triage_tag: the pure tag decision shared by scan_mode. Cover every status,
  # including the load-bearing IGNORE-never-re-flagged-on-sim-drift property.
  if [ "$(triage_tag '' '' 75)" = NEW ]; then
    echo "  ✓ triage_tag: untriaged (empty status) → NEW"
  else echo "  ✗ FAIL: triage_tag empty→NEW"; pass=0; fail=1; fi
  if [ "$(triage_tag SAFE 77 77)" = SAFE ] && [ "$(triage_tag SAFE 77 70)" = "SAFE↻" ]; then
    echo "  ✓ triage_tag: SAFE stays SAFE on match, SAFE↻ on sim drift"
  else echo "  ✗ FAIL: triage_tag SAFE drift logic"; pass=0; fail=1; fi
  # IGNORE must be IGNORE whether or not the sim matches the recorded one —
  # collision overlap drifts every scan, and it must never resurface as actionable.
  if [ "$(triage_tag IGNORE 93 93)" = IGNORE ] && [ "$(triage_tag IGNORE 93 41)" = IGNORE ]; then
    echo "  ✓ triage_tag: IGNORE stays IGNORE even when sim drifts (collision stays silenced)"
  else echo "  ✗ FAIL: triage_tag IGNORE re-flagged on sim drift"; pass=0; fail=1; fi
  if [ "$(triage_tag BUG 60 55)" = BUG ]; then
    echo "  ✓ triage_tag: BUG echoed verbatim"
  else echo "  ✗ FAIL: triage_tag BUG passthrough"; pass=0; fail=1; fi
  LEDGER="$saved_ledger"
  rm -rf "$t"
  if [ "$pass" -eq 1 ]; then echo "self-test: PASS"; else echo "self-test: FAIL"; fi
  return $fail
}

# --- dispatch ----------------------------------------------------------------
case "${1:-}" in
  --self-test) self_test ;;
  --scan)      shift; scan_mode "$@" ;;
  ""|-h|--help)
    grep '^#' "$SELF" | sed 's/^# \{0,1\}//' | sed '/^!/d'
    ;;
  *)           compare_name "$1" ;;
esac
