#!/usr/bin/env bash
#
# find-unguarded-json-parse.sh — audit every JSON.parse of BROWSER STORAGE in the
# repo and flag the NAIVE ones (not wrapped in try/catch) that crash the whole
# client tool on load when the stored value is corrupt.
#
# WHY THIS EXISTS
# The single richest recurring PROJECT bug vein this loop has mined is the
# "corrupt localStorage bricks the tool" class:
#     const x = JSON.parse(localStorage.getItem(KEY) || '{}');   // throws on '{bad'
# A `|| '{}'` / `|| '[]'` fallback only guards the MISSING case — it does NOTHING
# for a value that is PRESENT but corrupt / hand-edited / quota-truncated / from a
# legacy format. `JSON.parse('{bad')` throws synchronously, and if that read runs
# at module load (restoring saved state, hydrating a cache, reading an index) the
# exception escapes and the ENTIRE tool white-screens before it paints. The loop
# has fixed this same class on ~20+ separate keys — laserspace high-score,
# walden SCENES, westchester SECTION_KEY/pins/villages, burma 'burma:offline',
# pinglobe 'pg-feedback', QSS 'qss-eggs-found', research SESSIONS, interpreter
# snapshot index, mapkeys, ...each a SEPARATELY-NAMED key in a different file.
#
# That is why the divergence scanner (find-divergent-fns.sh) is BLIND to this
# class: it groups by function NAME, but these are anonymous inline reads in
# unrelated files. Nothing stops a NEW tool Johnny ships next month from adding
# yet another naive `JSON.parse(localStorage...)` at load time, and no name-based
# tool will ever surface it. This codifies the by-hand audit the loop keeps
# re-doing: find every storage parse by its SHAPE (a JSON.parse whose value comes
# from localStorage/sessionStorage) and classify each GUARDED vs NAIVE.
#
# WHY STORAGE ONLY (not every JSON.parse)
# An unguarded JSON.parse of a TRUSTED literal can't be corrupted, and an
# unguarded parse of a server/model reply 500s a request (recoverable) rather
# than bricking a client tool on load (not). Browser-storage parses are the
# severe, user-reachable, recurring one — so this tool scopes to them. (The
# server model-reply parses in api/*.js were hand-audited iteration #31: all 7
# are already in try/catch.)
#
# WHAT IT FLAGS
#   GUARDED — the JSON.parse is lexically inside a try { } block, so a corrupt
#             value degrades gracefully (catch returns a default). This is what
#             every hardened read in this repo already does.
#   NAIVE   — a storage-backed JSON.parse with NO enclosing try in the function.
#             One corrupt value throws and takes the tool down — worth a look.
#   WARN    — (stderr) the file's try/catch counter did not balance, so a `try {`
#             lives somewhere this line-based heuristic can't track (a multi-line
#             template literal or block comment). Its verdicts in the drift region
#             may be unreliable — hand-audit it. Not a --check failure.
#
# SCOPE: inline <script> in *.html is scanned too (most client tools here live in
# HTML), and public/ counts as SOURCE (Vercel serves it; dist/ is the build out).
# Both try/catch AND try/finally / try/catch/finally close a try-block correctly.
#
# It is a HEURISTIC linter, not a prover. A site is "storage-backed" if a storage
# token (localStorage / sessionStorage / .getItem) appears within ±8 lines of the
# JSON.parse — the same windowing find-rollover-formatters.sh uses, which catches
# both the same-line form and the `raw = getItem(...)` ... `JSON.parse(raw)` form.
# try-membership is tracked by a forward try/catch-depth counter (handles single-
# line `try { ... } catch` and multi-line/nested blocks; ignores `.catch(` promise
# chains). A clever guard it doesn't model reads as a false NAIVE — inspect, then
# either wrap in try/catch or whitelist with an inline `json-parse-audit:ignore`.
#
# IMPLEMENTATION NOTE — why grep/awk, not rg: in this environment `rg` is a SHELL
# FUNCTION (Claude Code's token wrapper), absent for a non-interactive/cron run
# (exit 127). grep + awk are always present, so this stays portable to headless.
#
# USAGE
#   scripts/find-unguarded-json-parse.sh            # table of every storage parse, GUARDED/NAIVE
#   scripts/find-unguarded-json-parse.sh --check    # exit 1 if any NAIVE site exists (CI gate)
#   scripts/find-unguarded-json-parse.sh --self-test # prove the classifier on fixtures
#
# OUTPUT (one line per site, NAIVE first):
#   <GUARDED|NAIVE>  <file>:<line>
#
set -euo pipefail

cd "$(dirname "$0")/.."

WINDOW=8
# A storage token marks a JSON.parse value as user-corruptible browser storage.
STORAGE='localStorage|sessionStorage|getItem'
# Inspected + judged safe: an inline `json-parse-audit:ignore` marker in the window
# exempts a site (reads as GUARDED). Use ONLY after confirming the parse can never
# throw on a present-but-corrupt value (e.g. the value is provably a clean literal);
# document why next to the marker.
IGNORE='json-parse-audit:ignore'

# Classify every storage-backed JSON.parse in one file. Emits: STATUS\tfile:line
#
# Works on a COMMENT-STRIPPED view of each line: the store files in this repo
# describe the OLD naive `JSON.parse(localStorage...)` they already hardened in a
# block comment, and a `// ... localStorage ...` word would otherwise read as a
# live storage parse. Stripping `//`-tails and full comment lines (`//`, `*`,
# `/*`) keeps the audit on real code only — for the JSON.parse match, the storage
# search, AND the try/catch depth counter.
classify_file() {
  awk -v F="$1" -v STOR="$STORAGE" -v IGN="$IGNORE" -v W="$WINDOW" '
    function strip(s,   t) {
      t=s
      # Full comment line (trimmed starts with // or * or /*) → no code.
      if (t ~ /^[[:space:]]*(\/\/|\*|\/\*)/) return ""
      # Trailing line comment ` // ...` (a space-anchored // avoids URL `https://`).
      sub(/[[:space:]]\/\/.*$/, "", t)
      return t
    }
    # ── try-protection tracking via a try-state stack ──────────────────────
    # st[sp] ∈ {1=OPEN (try seen, no closer yet), 2=CAUGHT (catch seen; a
    # trailing `finally` for the SAME try is still possible)}. `open` = how many
    # try-protected regions we are currently inside (slots still in state 1).
    #   try/catch          → +1 at try, −1 at catch                       → net 0
    #   try/finally(NOcatch)→ +1 at try, −1 at finally                    → net 0
    #   try/catch/finally  → +1 at try, −1 at catch, finally is a no-op   → net 0
    # The OLD counter only decremented on `catch`, so EVERY try/finally block
    # permanently inflated the depth and falsely marked every later storage
    # parse GUARDED (it shipped wrong verdicts on 5 real files). Nested single-
    # line try/catch leaves CAUGHT slots on the stack; a later catch/finally pops
    # past them (the while-loop) before closing its own OPEN slot, so `open`
    # stays correct under nesting and never reads a false NAIVE.
    {
      RAW[NR]=$0          # original, for the IGNORE marker (lives in a comment)
      code=strip($0)
      C[NR]=code
      # Open a try BEFORE recording this line depth, so a single-line
      # `try { JSON.parse(...) } catch {}` records the parse at depth>0.
      if (code ~ /(^|[^A-Za-z0-9_.])try[[:space:]]*\{/) { sp++; st[sp]=1; open++ }
      G[NR]=open
      # Close on a catch BLOCK (catch{ / catch( / } catch) — never `.catch(`.
      if (code ~ /(^|[^A-Za-z0-9_.])catch[[:space:]]*[({]/) {
        while (sp>0 && st[sp]==2) sp--          # drop CAUGHT slots that got no finally
        if (sp>0 && st[sp]==1) { st[sp]=2; open-- }
      }
      # A `finally` ends its try-block: pop a CAUGHT slot (no-op on `open`,
      # the catch already left the protected region) or close an OPEN slot
      # (a try/finally with no catch).
      if (code ~ /(^|[^A-Za-z0-9_.])finally[[:space:]]*\{/) {
        if (sp>0 && st[sp]==2) sp--
        else if (sp>0 && st[sp]==1) { sp--; open-- }
      }
    }
    END {
      for (i=1; i<=NR; i++) {
        line=C[i]
        if (line !~ /JSON\.parse\(/) continue
        # Deep-clone idiom JSON.parse(JSON.stringify(...)) can never throw — skip.
        if (line ~ /JSON\.parse\([[:space:]]*JSON\.stringify/) continue
        # Storage-backed? a storage token in real code within the ±W window.
        stor=0
        for (j=i-W; j<=i+W; j++) if (j>=1 && j<=NR && C[j] ~ STOR) { stor=1; break }
        if (!stor) continue
        # Inspected-safe ignore marker in the window → treat as GUARDED. The marker
        # lives in a comment, so scan the RAW (un-stripped) lines for it.
        ign=0
        for (j=i-W; j<=i+W; j++) if (j>=1 && j<=NR && index(RAW[j], IGN)) { ign=1; break }
        printf "%s\t%s:%d\n", ((G[i]>0 || ign) ? "GUARDED" : "NAIVE"), F, i
      }
      # Honesty self-check: a balanced file ends with open==0. If it does not, the
      # file holds a `try {` this LINE-based heuristic cannot track — almost always
      # one living inside a MULTI-LINE template literal or block comment (regex/awk
      # cannot tokenize those, and a template ${...} can even contain real code).
      # In the drifted region `open` is inflated, so a genuinely-NAIVE parse there
      # can read as GUARDED. Rather than vouch silently we say so on stderr — a
      # flag to hand-audit, NOT a failure (drift never produces a false NAIVE that
      # would break --check).
      if (open != 0)
        printf "WARN  %s: try/catch counter unbalanced (open=%d) — storage-parse verdicts may be unreliable; hand-audit this file\n", F, open > "/dev/stderr"
    }' "$1"
}

# Repo scan: every non-test, non-vendor source file that mentions JSON.parse.
scan_repo() {
  local files
  # HTML is in scope: most of this repo's client tools (queen-scarlet-school,
  # prawn, todo, the public/ pages, ...) embed ALL their logic in inline
  # <script> blocks, and that is exactly where the loop's hand-audits keep
  # finding naive storage parses the .js-only scan was blind to. public/ is
  # SOURCE here (git-tracked pages Vercel serves directly — dist/ is the build
  # output), so it must be watched too. Still skip dist/ and minified bundles.
  files=$(grep -rlE 'JSON\.parse\(' \
            --include='*.js' --include='*.ts' --include='*.mjs' --include='*.jsx' --include='*.html' . 2>/dev/null \
          | grep -v node_modules | grep -vE '/dist/|assets/index-' \
          | grep -vE '\.(test|spec)\.' \
          | grep -vE 'migrate-probe|integrity-check|find-wrongtype-json-parse' || true)
          # ^ exclude standalone dev probe/check harnesses: they parse trusted
          #   round-trip data (bytes they just JSON.stringify'd) against an
          #   in-memory fake-localStorage and are NOT in any client tool's load
          #   path — the brick-on-load severity this tool guards can't apply.
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

  # Fixture 1: NAIVE — storage parse with a `|| '{}'` fallback but NO try. The
  # fallback guards MISSING, not CORRUPT — a present '{bad' still throws. MUST be NAIVE.
  cat >"$tmp/naive.js" <<'JS'
function load() {
  const raw = JSON.parse(localStorage.getItem('k') || '{}');
  return raw;
}
JS
  # Fixture 2: GUARDED multi-line — the classic try/catch around a getItem read.
  cat >"$tmp/guarded.js" <<'JS'
function load() {
  try {
    const raw = localStorage.getItem('k');
    return JSON.parse(raw);
  } catch { return null; }
}
JS
  # Fixture 3: GUARDED single-line `try { ... } catch` — proves the forward depth
  # counter records the parse at depth>0 on a one-liner.
  cat >"$tmp/guarded-oneline.js" <<'JS'
function loadAll() { try { return JSON.parse(localStorage.getItem('k') || '{}'); } catch { return {}; } }
JS
  # Fixture 4: NOT storage — JSON.parse of a server reply, no storage token nearby.
  # MUST NOT appear (out of scope; severity is a 500, not a brick).
  cat >"$tmp/notstorage.js" <<'JS'
const data = JSON.parse(await res.text());
JS
  # Fixture 5: deep-clone idiom — JSON.parse(JSON.stringify(x)) can't throw even
  # next to a storage token. MUST NOT appear.
  cat >"$tmp/clone.js" <<'JS'
function snap() {
  localStorage.setItem('k', '1');
  return JSON.parse(JSON.stringify(state));
}
JS
  # Fixture 6: a `.catch(` promise chain must NOT be mistaken for a try-closer and
  # wrongly drop depth — the parse stays correctly classified. Here: NAIVE (no try).
  cat >"$tmp/promisecatch.js" <<'JS'
fetch('/x').then(r => r.json()).catch(() => {});
const v = JSON.parse(localStorage.getItem('k'));
JS
  # Fixture 7: naive storage parse with an inspected ignore marker → exempt (GUARDED).
  cat >"$tmp/ignored.js" <<'JS'
// json-parse-audit:ignore (key only ever holds the literal "1")
const n = JSON.parse(localStorage.getItem('flag'));
JS
  # Fixture 8: the try/FINALLY regression. A `try { } finally { }` (no catch) does
  # NOT swallow a throw, and the parse here sits AFTER the block — so it MUST be
  # NAIVE. The OLD counter only decremented on catch, so the finally-less try left
  # depth elevated and this read as a false GUARDED. Mutation proof of the fix.
  cat >"$tmp/tryfinally.js" <<'JS'
function load() {
  try { risky(); } finally { cleanup(); }
  const v = JSON.parse(localStorage.getItem('k') || '{}');
  return v;
}
JS
  # Fixture 9: try/catch/finally. Parse INSIDE the try-body is GUARDED; the
  # finally must be a no-op (no double-decrement) so the block still nets to 0.
  cat >"$tmp/trycatchfinally.js" <<'JS'
function load() {
  try {
    return JSON.parse(localStorage.getItem('k') || '{}');
  } catch { return {}; }
  finally { done(); }
}
JS
  # Fixture 10: nested try/catch/finally INSIDE an outer try. The parse comes after
  # the inner block but is still inside the OUTER try → GUARDED. This is the case a
  # naive "decrement on catch and finally" would mis-handle (inner double-close
  # would drop depth to 0 and read a FALSE NAIVE, breaking --check). MUST be GUARDED.
  cat >"$tmp/nested.js" <<'JS'
function load() {
  try {
    try { setup(); } catch (e) {} finally { mid(); }
    return JSON.parse(localStorage.getItem('k') || '{}');
  } catch { return {}; }
}
JS
  # Fixture 11: an HTML inline <script> with a naive storage parse — proves the
  # classifier works on the .html files now in scope. MUST be NAIVE.
  cat >"$tmp/inline.html" <<'HTML'
<script>
  const s = JSON.parse(localStorage.getItem('k') || '{}');
</script>
HTML
  # Fixture 12: a `try {` living inside a (single-line) template literal with no
  # real catch — stands in for the multi-line-template phantom the heuristic can't
  # tokenize. The counter ends unbalanced, so the file MUST trigger the stderr WARN
  # rather than silently vouch (the parse below it even reads a bogus GUARDED).
  cat >"$tmp/unbalanced.js" <<'JS'
const help = `if it fails, wrap it in try { ... } and move on`;
const v = JSON.parse(localStorage.getItem('k') || '{}');
JS

  local out
  out=$(classify_file "$tmp/naive.js")
  assert "$out" "NAIVE	$tmp/naive.js:2" "storage parse with ||-fallback but no try → NAIVE" || rc=1

  out=$(classify_file "$tmp/guarded.js")
  assert "$out" "GUARDED	$tmp/guarded.js:4" "multi-line try/catch around getItem → GUARDED" || rc=1

  out=$(classify_file "$tmp/guarded-oneline.js")
  assert "$out" "GUARDED	$tmp/guarded-oneline.js:1" "single-line try{...}catch → GUARDED" || rc=1

  out=$(classify_file "$tmp/notstorage.js")
  assert "$out" "" "non-storage server-reply parse produces no site" || rc=1

  out=$(classify_file "$tmp/clone.js")
  assert "$out" "" "JSON.parse(JSON.stringify(...)) deep-clone produces no site" || rc=1

  out=$(classify_file "$tmp/promisecatch.js")
  assert "$out" "NAIVE	$tmp/promisecatch.js:2" ".catch() promise chain not mistaken for try-closer" || rc=1

  out=$(classify_file "$tmp/ignored.js")
  assert "$out" "GUARDED	$tmp/ignored.js:2" "inspected ignore-marker site reads GUARDED" || rc=1

  out=$(classify_file "$tmp/tryfinally.js" 2>/dev/null)
  assert "$out" "NAIVE	$tmp/tryfinally.js:3" "parse after a try/finally(no catch) → NAIVE (not falsely GUARDED)" || rc=1

  out=$(classify_file "$tmp/trycatchfinally.js" 2>/dev/null)
  assert "$out" "GUARDED	$tmp/trycatchfinally.js:3" "parse in try-body of try/catch/finally → GUARDED" || rc=1

  out=$(classify_file "$tmp/nested.js" 2>/dev/null)
  assert "$out" "GUARDED	$tmp/nested.js:4" "parse after nested try/catch/finally, still in outer try → GUARDED" || rc=1

  out=$(classify_file "$tmp/inline.html" 2>/dev/null)
  assert "$out" "NAIVE	$tmp/inline.html:2" "naive storage parse in an HTML inline <script> → NAIVE" || rc=1

  # Unbalanced file: the verdict line may be bogus (that's the point), but the
  # honesty WARN MUST fire on stderr so the file gets hand-audited.
  classify_file "$tmp/unbalanced.js" >/dev/null 2>"$tmp/err"
  if grep -q 'counter unbalanced' "$tmp/err"; then
    echo "PASS  untrackable try (template phantom) → stderr WARN, not a silent vouch"
  else
    echo "FAIL  untrackable try (template phantom) → stderr WARN, not a silent vouch"
    echo "        got stderr:  [$(cat "$tmp/err")]"
    rc=1
  fi

  # Load-bearing: the LIVE repo must currently be clean (0 NAIVE). If this fails,
  # a real un-hardened storage parse shipped — the whole reason the tool exists.
  local naive_live
  naive_live=$(scan_repo | grep -c '^NAIVE' || true)
  if [ "$naive_live" -eq 0 ]; then
    echo "PASS  live repo scan: 0 NAIVE storage parses"
  else
    echo "FAIL  live repo scan: $naive_live NAIVE storage parse(s) — run without --self-test to see them"
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
      echo "✗ $naive NAIVE storage JSON.parse(s) — corrupt value can brick the tool on load" >&2
      exit 1
    fi
    echo "✓ 0 NAIVE storage parses ($(printf '%s\n' "$rows" | grep -c '^GUARDED' || true) GUARDED)"
    ;;
  ''|--list)
    rows=$(scan_repo | sort)
    g=$(printf '%s\n' "$rows" | grep -c '^GUARDED' || true)
    n=$(printf '%s\n' "$rows" | grep -c '^NAIVE' || true)
    echo "browser-storage JSON.parse sites (value from localStorage/sessionStorage):"
    echo "  STATUS    SITE   [GUARDED=inside try/catch · NAIVE=corrupt value crashes the tool on load]"
    printf '%s\n' "$rows" | awk -F'\t' 'NF==2 { printf "  %-9s %s\n", $1, $2 }'
    echo "→ $((g+n)) storage-parse site(s): $g GUARDED, $n NAIVE."
    [ "$n" -gt 0 ] && echo "  inspect each NAIVE: does a present-but-corrupt stored value throw at load?"
    ;;
  *) echo "usage: $0 [--list|--check|--self-test]" >&2; exit 2 ;;
esac
