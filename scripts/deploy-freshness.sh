#!/usr/bin/env bash
# deploy-freshness.sh <url-or-path> [dist-html-path] [host]
#
# Answers the question HTTP-200 cannot: "is the LIVE deploy actually serving the
# code I just built, or a stale older build?"
#
# TWO-STAGE CHECK:
#   1) HASH FAST-PATH — compare the content-hashed asset bundles
#      (assets/<name>-<hash>.js|css) the live page references against the locally
#      built dist/ for the SAME page. Identical sets -> FRESH (exit 0), done.
#   LAZY-CHUNK DISCOVERY — the page HTML only names the entry + preloaded bundles.
#      Code-split lazy chunks (dynamic import()) are referenced INSIDE those bundles,
#      not the HTML. A fix that lands ONLY in a lazy chunk (e.g. translation's
#      devchat panel) is invisible to a page-HTML-only scan, producing a FALSE FRESH
#      (loop journal Jun 23 #19 — the devchat relAgo fix). So Stage 2 walks the
#      bundle graph: it greps the fetched bundles for further asset refs and pulls
#      every lazy chunk too, folding their content into the comparison below.
#   2) CONTENT FALLBACK — if the hash sets DIFFER, do NOT immediately cry STALE.
#      Vite/Rollup content hashes are minifier-output hashes, and Vercel's build
#      toolchain renames minified variables differently than a local `bunx vite
#      build` — so two byte-different bundles can carry IDENTICAL SOURCE and only
#      differ in `let F=` vs `let H=`. That alone re-hashes the file. The old
#      version of this script declared STALE on any hash mismatch, which produced
#      a FALSE "deploy frozen" for DAYS (the freeze had cleared; the tool couldn't
#      see it — see loop journal Jun 16-19). The fallback compares the bundles'
#      CLEAN HUMAN-READABLE STRING LITERALS, which survive minification verbatim
#      (only identifiers get renamed). live ⊇ local-literals -> FRESH; otherwise
#      STALE, and it PRINTS the missing literals (which name exactly what recent
#      source is not yet live).
#
# WHY THIS EXISTS: a Vercel deploy can stay frozen for hours while every endpoint
# still returns 200 (and auth-gated ones still return a clean 401) — those signals
# prove the route EXISTS, not that it runs FRESH code. But the inverse failure is
# just as costly: a hash-only check calls a perfectly-fresh deploy STALE whenever
# the remote minifier diverges, stranding the loop on "freeze still on" forever.
# The content fallback is the signal that survives both.
#
# ARG 1 accepts EITHER form — same convention as verify-deploy.sh:
#   deploy-freshness.sh https://mycoldmars.vercel.app/hunter/   (full URL; host taken from it)
#   deploy-freshness.sh /hunter/                                (bare path; host from arg3/default)
#
# Requires dist/ built from the current HEAD first:  bunx vite build
# Only meaningful for Vite-built pages (those with hashed asset bundles). Pure
# static public/*.html copied verbatim have no hash — use verify-deploy.sh (a
# body grep for the changed text) for those instead.
set -euo pipefail

ARG1="${1:-}"
DIST_HTML="${2:-}"
HOST="${3:-https://mycoldmars.com}"
# How many clean literals may be missing from live and STILL count as FRESH.
# Absorbs build-env artifacts (e.g. the VITE_SUPABASE_* env-injection guard string
# that exists in a keyless local build but not the env-provisioned Vercel build)
# and the occasional minifier string-split difference. A genuinely stale deploy —
# one missing a whole commit's worth of new code — misses far more than this.
TOLERANCE="${FRESHNESS_TOLERANCE:-3}"
# How much drift in minifier-invariant global-API call counts (Stage 2b) is still
# FRESH. These are built-in member names a minifier CANNOT rename, so a same-source
# build matches them EXACTLY — default 0. Bump only if a build-env-conditional dead
# branch is ever found to touch one (none known; the VITE_* env guard is a string
# check, which shows up in the literal diff, not here).
API_TOLERANCE="${FRESHNESS_API_TOLERANCE:-0}"

if [[ -z "$ARG1" ]]; then
  echo "Usage: deploy-freshness.sh <url-or-path> [dist-html-path] [host]" >&2
  echo "  e.g. deploy-freshness.sh https://mycoldmars.vercel.app/hunter/" >&2
  echo "       deploy-freshness.sh /hunter/" >&2
  exit 2
fi

# Accept a full URL OR a bare path in arg 1 (verify-deploy.sh parity).
if [[ "$ARG1" =~ ^https?://([^/]+)(/.*)?$ ]]; then
  HOST="${ARG1%%"${BASH_REMATCH[2]}"}"   # scheme://authority (strip the path tail)
  PAGE_PATH="${BASH_REMATCH[2]:-/}"      # path, defaulting to / for a bare origin
else
  PAGE_PATH="$ARG1"
fi

case "$PAGE_PATH" in
  /*) : ;;
  *)  PAGE_PATH="/$PAGE_PATH" ;;
esac
if [[ -z "$DIST_HTML" ]]; then
  rel="${PAGE_PATH#/}"
  rel="${rel%/}"
  if [[ -z "$rel" ]]; then
    DIST_HTML="dist/index.html"
  else
    DIST_HTML="dist/${rel}/index.html"
  fi
fi

if [[ ! -f "$DIST_HTML" ]]; then
  echo "FAIL  local build not found: $DIST_HTML — run 'bunx vite build' from HEAD first" >&2
  exit 2
fi

extract_assets() { grep -oE 'assets/[A-Za-z0-9_.-]+\.(js|css)' | sort -u; }

LIVE_SET=$(curl -sSL "${HOST}${PAGE_PATH}" | extract_assets || true)
LOCAL_SET=$(extract_assets < "$DIST_HTML" || true)

if [[ -z "$LOCAL_SET" ]]; then
  echo "FAIL  no hashed asset bundles found in $DIST_HTML — page may be pure static; use verify-deploy.sh instead" >&2
  exit 2
fi
if [[ -z "$LIVE_SET" ]]; then
  echo "STALE  live ${HOST}${PAGE_PATH} referenced no hashed bundles (page missing or not yet deployed)"
  exit 1
fi

# ── Stage 1: hash fast-path ────────────────────────────────────────────────
if [[ "$LIVE_SET" == "$LOCAL_SET" ]]; then
  echo "FRESH  ${HOST}${PAGE_PATH} serves the local HEAD build (hash match)"
  echo "$LIVE_SET" | sed 's/^/  /'
  exit 0
fi

# ── Stage 2: content fallback (minifier-immune) ────────────────────────────
# Extract clean, human-readable string literals from a JS bundle: real words /
# labels / URLs / property names with no code punctuation, with the camelCase
# noise of concatenated minified identifiers filtered out, asset-hash fingerprints
# normalised away, and env-injection (VITE_*) artifacts dropped. These survive
# minification verbatim, so they compare equal across build environments.
clean_literals() {
  grep -hoE "\"[^\"]{4,}\"|'[^']{4,}'" "$@" 2>/dev/null \
    | sed -E 's/^.//;s/.$//' \
    | grep -E '^[A-Za-z0-9 ._,:/?&%#@!()-]+$' \
    | grep -vE '[a-z][A-Z][a-z].*[a-z][A-Z]' \
    | grep -v 'VITE_' \
    `# Drop minified CODE fragments the quote-regex captures across string`         \
    `# boundaries. They carry RENAMED identifiers (let F=… vs let H=…), so Vercel`  \
    `# and a local vite build disagree on them and they read as "missing" — the`    \
    `# /translation/ false-STALE that stranded the loop (journal Jun 16-20). They`  \
    `# are NOT human-readable content. Two signatures cover every observed case:`   \
    `#  • a paren — call/group syntax: .once(  ),Ft(  ).classList.add(  (kills 11)`  \
    `#  • a leading , or ) , a trailing , or ; , or a && / || operator — kills the`  \
    `#    paren-less object-property fragments (,onClick:At,  ,query:F.query,…:)`     \
    `# Genuine paren-bearing literals (rgba(…), "(no email)", "Smart Sync (rewrite)")` \
    `# are minifier-STABLE string content, identical on both sides, so they never`   \
    `# appear in the missing set — dropping them costs nothing for stale-detection,`  \
    `# while ~800 paren-free genuine literals remain as the comparison surface.`      \
    | grep -vE '[()]' \
    | grep -vE '^[,)]|[,;]$|&&|\|\|' \
    `# Normalise asset-hash fingerprints  <name>-<hash>.<ext>  ->  <name>-H.<ext>`  \
    `# so a chunk self-/cross-reference compares equal across builds. The hash is`  \
    `# the 8-char base64url segment before the ext — and base64url INCLUDES '-'`    \
    `# and '_', so Vercel emits hashes like 'D-P0gDwf' while local vite emits`       \
    `# 'CPA7lGbx'. The charset MUST allow '-' inside the hash or a hyphen-bearing`   \
    `# live hash stays un-normalised and reads as a phantom missing literal (the`    \
    `# self-ref misses lazy-chunk discovery surfaced).`                              \
    | sed -E 's/-[A-Za-z0-9_-]{8}\.(js|css|mjs)/-H.\1/g' \
    | sort -u
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Pull every live .js bundle the page references; read the local dist .js files.
live_js=0
while IFS= read -r a; do
  [[ "$a" == *.js ]] || continue
  if curl -sSL "${HOST}/${a}" -o "$TMP/live-$(basename "$a")"; then live_js=$((live_js+1)); fi
done <<< "$LIVE_SET"

local_js=0
while IFS= read -r a; do
  [[ "$a" == *.js ]] || continue
  if [[ -f "dist/$a" ]]; then cp "dist/$a" "$TMP/local-$(basename "$a")"; local_js=$((local_js+1)); fi
done <<< "$LOCAL_SET"

if [[ "$live_js" -eq 0 || "$local_js" -eq 0 ]]; then
  echo "STALE  ${HOST}${PAGE_PATH} hash sets differ and JS bundles could not be fetched for content comparison"
  echo "  live :"; echo "$LIVE_SET"  | sed 's/^/    /'
  echo "  local:"; echo "$LOCAL_SET" | sed 's/^/    /'
  exit 1
fi

# ── Stage 2 (cont.): transitively pull LAZY-loaded chunks ──────────────────
# The page HTML names only the entry + preloaded bundles; code-split lazy chunks
# (dynamic import()) live INSIDE the entry bundle (e.g. "assets/devchat-<hash>.js").
# A change confined to a lazy chunk DOES flip the entry hash (the chunk filename is
# embedded), so Stage 1 mismatches and we land here — but the entry's lazy-chunk ref
# normalises to "<name>-H.js" (identical across builds) and the chunk's own literals
# + logic are never fetched, so the diff below sees nothing → FALSE FRESH (the gap
# that masked the devchat relAgo fix not propagating, journal Jun 23 #19). Fix: walk
# the bundle graph to a fixpoint — grep already-fetched bundles for asset refs, fetch
# any not yet present, repeat. Folds lazy-chunk content into the SAME literal +
# API-count comparison. live side pulls from the network (its OWN hashes), local from
# dist (HEAD's hashes); the comparison is union-based so chunks match by content, not
# name, and a stale-live lazy chunk surfaces as a missing literal or an API drift.
discover_chunks() {
  local prefix="$1" added=1 pass=0 a base
  while [[ "$added" -gt 0 && "$pass" -lt 8 ]]; do
    added=0; pass=$((pass+1))
    while IFS= read -r a; do
      [[ -n "$a" && "$a" == *.js ]] || continue
      base="$(basename "$a")"
      [[ -f "$TMP/$prefix-$base" ]] && continue   # already fetched
      if [[ "$prefix" == "live" ]]; then
        if curl -sSL "${HOST}/${a}" -o "$TMP/$prefix-$base"; then added=$((added+1)); else rm -f "$TMP/$prefix-$base"; fi
      else
        if [[ -f "dist/$a" ]]; then cp "dist/$a" "$TMP/$prefix-$base"; added=$((added+1)); fi
      fi
    done < <(cat "$TMP/$prefix-"*.js 2>/dev/null | extract_assets || true)
  done
}
discover_chunks live
discover_chunks local

# ── Vendor-chunk exclusion: @sentry SDK ────────────────────────────────────
# The @sentry SDK chunks build NON-DETERMINISTICALLY between a local `bunx vite
# build` and Vercel's build: Sentry bakes a release/env string into its bundle, and
# the env injection shifts BOTH identifier renaming AND code-splitting. Two symptoms,
# same root cause, both false-STALE this tool on a deploy that IS live:
#  (1) LITERALS — the renamed-identifier CODE FRAGMENTS the literal-regex captures
#      across string boundaries ("?e.recordAfter:", "SpotlightBrowser", the Spotlight
#      sidecar URL "http://localhost:8969/stream", "ai.operationId", …) diverge and
#      read as phantom "un-deployed" markers (masked iter #18's verify: 15 phantom
#      misses, EVERY one sentry-internal).
#  (2) API COUNTS — Vercel splits an extra sub-chunk (browserTracingIntegration) that
#      the local build folds elsewhere, so the un-renameable built-in call COUNTS
#      (Object.keys, isNaN, …) drift by exactly that chunk's contribution.
# This is VENDORED code: whether @sentry's minified bytes byte-match tells us NOTHING
# about whether OUR source deployed. A real SDK bump changes our lockfile + own bundle;
# an identical redeploy is already caught by Stage 1's hash match. So EXCLUDE sentry
# chunks from both the literal set and the API count, on BOTH sides.
#
# Detection is CONTENT-based, not filename-based: filename `*sentry*` misses the
# Vercel-only `browserTracingIntegration` chunk (a @sentry sub-module), which is the
# very asymmetry that inflates the count drift. A sentry vendor chunk is DENSELY
# sentry (sentry-client=108, browserTracingIntegration=206 'sentry' tokens); every one
# of our app chunks has 0-1 (main=0, burmaScript=1). A threshold cleanly separates
# them with an enormous margin, and works whichever side the chunk appears on. The
# `*sentry*` filename is kept as a belt-and-suspenders OR (covers our tiny sentry-boot
# wrapper, which is below the density threshold).
SENTRY_TOKEN_MIN="${FRESHNESS_SENTRY_TOKEN_MIN:-20}"
is_sentry_chunk() {
  local f="$1" n
  case "$(basename "$f")" in *sentry*) return 0 ;; esac
  n=$( { grep -oiE 'sentry' "$f" 2>/dev/null || true; } | wc -l | tr -d ' ')
  [[ "$n" -ge "$SENTRY_TOKEN_MIN" ]]
}
# Partition discovered chunks into app (compared) vs sentry-vendor (excluded).
LIVE_APP=(); LOCAL_APP=(); SENTRY_DROP_N=0
for f in "$TMP"/live-*.js;  do [[ -f "$f" ]] || continue; if is_sentry_chunk "$f"; then SENTRY_DROP_N=$((SENTRY_DROP_N+1)); else LIVE_APP+=("$f"); fi; done
for f in "$TMP"/local-*.js; do [[ -f "$f" ]] || continue; if is_sentry_chunk "$f"; then SENTRY_DROP_N=$((SENTRY_DROP_N+1)); else LOCAL_APP+=("$f"); fi; done

# Full count of local app bundles actually compared (entry + preloaded + lazy, sans sentry).
COMPARED=${#LOCAL_APP[@]}

clean_literals "${LIVE_APP[@]}"  > "$TMP/live.lit"
clean_literals "${LOCAL_APP[@]}" > "$TMP/local.lit"

# Clean literals present locally (HEAD) but ABSENT from live = un-deployed source.
MISSING="$(comm -13 "$TMP/live.lit" "$TMP/local.lit" || true)"
MISS_N=0
[[ -n "$MISSING" ]] && MISS_N=$(printf '%s\n' "$MISSING" | grep -c .)

if [[ "$MISS_N" -le "$TOLERANCE" ]]; then
  # ── Stage 2b: logic-only guard (minifier-invariant global-API call counts) ──
  # Clean string literals MISS logic-only changes — a new Array.isArray guard, a
  # Number.isFinite check, an extra Math.max — that add NO new literal. So Stage 2
  # would call a stale deploy FRESH (the exact blindspot that masked the sot-hunter
  # loadFeedback fix not landing; loop journal Jun 22 #16/#17). Built-in member names
  # (Array.isArray, JSON.parse, Math.*, localStorage.*, parseInt) are un-renameable
  # by ANY minifier, so their COUNTS are source-deterministic + minifier-invariant: a
  # genuinely fresh deploy matches them EXACTLY, a stale one missing logic-only source
  # differs. This catches what literals cannot WITHOUT the false-STALE risk — same-source
  # builds always agree (empirically: 5/6 tokens matched exactly across Vercel-vs-local
  # builds of different commits; only the one real source diff showed up).
  API_TOKENS=(
    'Array\.isArray('   'JSON\.parse('       'JSON\.stringify('
    'Number\.isFinite(' 'Number\.isInteger(' 'Object\.keys('
    'Object\.entries('  'Object\.assign('    'Object\.values('
    'Math\.max('        'Math\.min('         'Math\.floor('
    'Math\.round('      'Math\.abs('         'Math\.ceil('
    'localStorage\.getItem(' 'localStorage\.setItem('
    'parseInt('         'parseFloat('        'encodeURIComponent('
    'isFinite('         'isNaN('
  )
  # Count over the APP chunks only (sentry-vendor excluded, per the partition above):
  # the SDK's un-renameable built-in call COUNTS (Object.keys, isNaN, …) also drift
  # between Vercel and local because Vercel splits an extra sentry sub-chunk. A
  # logic-only change to OUR code still lands in a non-sentry chunk and is caught;
  # only a change confined to our tiny sentry wrappers is invisible — the same narrow,
  # acceptable blindspot the literal exclusion accepts.
  cat "${LIVE_APP[@]}"  > "$TMP/live.all"  2>/dev/null || true
  cat "${LOCAL_APP[@]}" > "$TMP/local.all" 2>/dev/null || true
  API_DRIFT=""
  API_DRIFT_N=0
  for tok in "${API_TOKENS[@]}"; do
    # `|| true` swallows grep's exit-1-on-no-match so set -e/pipefail don't trip
    # when a token (e.g. Math.abs) is absent from a bundle — a 0 count is valid.
    l=$( { grep -o "$tok" "$TMP/local.all" 2>/dev/null || true; } | wc -l | tr -d ' ')
    v=$( { grep -o "$tok" "$TMP/live.all"  2>/dev/null || true; } | wc -l | tr -d ' ')
    if [[ "$l" -ne "$v" ]]; then
      d=$(( l > v ? l - v : v - l ))
      API_DRIFT_N=$(( API_DRIFT_N + d ))
      API_DRIFT+="    ${tok//\\/}  local=${l}  live=${v}"$'\n'
    fi
  done
  if [[ "$API_DRIFT_N" -gt "$API_TOLERANCE" ]]; then
    echo "STALE  ${HOST}${PAGE_PATH} matches HEAD's string literals but DIFFERS on ${API_DRIFT_N} minifier-invariant global-API call(s) — a LOGIC-ONLY change (a new guard / check that adds no string literal) has not propagated"
    echo "  string literals can't see logic-only diffs; un-renameable built-in counts can:"
    printf '%s' "$API_DRIFT"
    echo "  (live is serving older code whose logic differs from HEAD — re-check after the deploy lands)"
    exit 1
  fi
  echo "FRESH  ${HOST}${PAGE_PATH} serves local HEAD source (content match; hashes differ — Vercel minifier output differs from local \`bunx vite build\`, NOT staleness)"
  echo "  hash sets differ but all ${COMPARED} local JS bundle(s) — entry + preloaded + lazy chunks — share HEAD's source literals (${MISS_N} missing ≤ ${TOLERANCE} tolerance) AND match on every minifier-invariant global-API call count (logic-only diffs checked)"
  if [[ "$MISS_N" -gt 0 ]]; then
    echo "  tolerated misses (build-env artifacts):"; printf '%s\n' "$MISSING" | sed 's/^/    /'
  fi
  [[ "$SENTRY_DROP_N" -gt 0 ]] && echo "  excluded ${SENTRY_DROP_N} @sentry vendor chunk(s) — env-nondeterministic build, not our source"
  exit 0
else
  echo "STALE  ${HOST}${PAGE_PATH} is missing ${MISS_N} HEAD source literal(s) — deploy has not propagated the latest code"
  echo "  un-deployed source markers (in local HEAD build, absent from live):"
  printf '%s\n' "$MISSING" | head -25 | sed 's/^/    /'
  [[ "$MISS_N" -gt 25 ]] && echo "    … and $((MISS_N-25)) more"
  [[ "$SENTRY_DROP_N" -gt 0 ]] && echo "  (${SENTRY_DROP_N} @sentry vendor chunk(s) already excluded — these misses are OUR source)"
  exit 1
fi
