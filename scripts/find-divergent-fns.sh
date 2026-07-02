#!/usr/bin/env bash
#
# find-divergent-fns.sh — surface function names DEFINED in 2+ source files.
#
# WHY THIS EXISTS
# The Redoubt loop's single most productive bug-finding move, once the obvious
# surface is swept, is the "divergent-copy scan": a pure helper (a timecode
# formatter, an embedding parser, an HTML escaper, a daily-puzzle selector) gets
# copy-pasted into N files; one copy gets hardened/fixed while the others rot,
# so a real bug lives on in the stale twins. Iteration #7 found a reachable
# scene-detection CRASH exactly this way (parseEmbedding was the THIRD, unguarded
# copy of math already hardened in two siblings). Many earlier fixes too:
# divergent timecode parsers, cookie-regex copies, fmtViews y-axis copies.
#
# Doing that scan by hand every iteration is slow and lossy. This codifies it:
# one command lists every function name that appears as a definition in two or
# more distinct, non-test source files — the candidate divergent copies — so a
# future iteration can jump straight to auditing them for drift.
#
# It does NOT decide which are real divergences (some shared names are
# coincidental, e.g. startGame in unrelated games; some splits are intentional,
# e.g. a text-only escapeHtml vs an escapeAttr). It just narrows ~thousands of
# functions down to the few dozen worth a human/diff look. Pair it with:
#     grep -n -A6 'function NAME' <each file>   # then diff the bodies.
#
# IMPLEMENTATION NOTE — why grep, not rg: in this environment `rg` is a SHELL
# FUNCTION (Claude Code's token-reduction wrapper), not a binary on PATH, so it
# does not exist for a script run non-interactively (you get exit 127). `grep`
# is always present. This script is therefore portable to cron / headless runs.
#
# USAGE
#   scripts/find-divergent-fns.sh [MIN_FILES] [NAME_SUBSTR]
#     MIN_FILES   : minimum distinct files a name must appear in (default 2)
#     NAME_SUBSTR : optional case-insensitive filter on the function name
#   Examples:
#     scripts/find-divergent-fns.sh            # everything defined in >=2 files
#     scripts/find-divergent-fns.sh 3          # only names in >=3 files
#     scripts/find-divergent-fns.sh 2 embed    # names containing "embed"
#
# OUTPUT (one line per name, most-duplicated first):
#   <count>  <name>  <file> <file> ...
#
# Captures two definition forms (where divergent helpers actually live):
#   function NAME( ... )                 /  export [async] function NAME(
#   const NAME = [async] function|( ...  /  export const NAME = (...) =>
# Excludes: node_modules, dist + */assets/ (Vite build output — the committed
# public/*/assets/ bundles are minified, hashed, never hand-edited, so a
# bundle-vs-source "divergence" is pure noise AND the 1.8MB single-line bundle
# makes the downstream char-naive body extractor hang), and *.test.* / *.spec.*.
#
set -euo pipefail

cd "$(dirname "$0")/.."

MIN="${1:-2}"
FILTER="${2:-}"

if ! [[ "$MIN" =~ ^[0-9]+$ ]] || [ "$MIN" -lt 2 ]; then
  echo "MIN_FILES must be an integer >= 2 (got '$MIN')" >&2
  exit 2
fi

GREP_OPTS=(
  -rHoE
  --include='*.js' --include='*.mjs' --include='*.ts'
  --exclude='*.test.*' --exclude='*.spec.*'
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=assets
)

# Two passes (declaration form + const-expr form), each emitting "path:<keyword name...>".
collect() {
  grep "${GREP_OPTS[@]}" \
    -e '\bfunction[[:space:]]+[A-Za-z_$][A-Za-z0-9_$]*' . || true
  grep "${GREP_OPTS[@]}" \
    -e '\bconst[[:space:]]+[A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*=[[:space:]]*(async[[:space:]]+)?(function\b|\()' . || true
}

collect | awk -v min="$MIN" -v filter="$FILTER" '
{
  i = index($0, ":")
  if (i < 2) next
  file = substr($0, 1, i - 1)
  rest = substr($0, i + 1)
  # Split the matched fragment on any non-identifier char; the token right
  # after the "function"/"const" keyword is the function name.
  n = split(rest, t, /[^A-Za-z0-9_$]+/)
  name = ""
  for (k = 1; k < n; k++) {
    if (t[k] == "function" || t[k] == "const") { name = t[k + 1]; break }
  }
  if (name == "") next
  if (filter != "" && index(tolower(name), tolower(filter)) == 0) next
  key = name SUBSEP file
  if (key in seen) next            # same name, same file -> count the file once
  seen[key] = 1
  cnt[name]++
  files[name] = files[name] " " file
}
END {
  for (n in cnt) if (cnt[n] >= min) printf "%d\t%s\t%s\n", cnt[n], n, files[n]
}
' | sort -rn -k1,1
