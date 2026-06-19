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
    | sed -E 's/-[A-Za-z0-9_]{8}\./-H./g' \
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

clean_literals "$TMP"/live-*.js  > "$TMP/live.lit"
clean_literals "$TMP"/local-*.js > "$TMP/local.lit"

# Clean literals present locally (HEAD) but ABSENT from live = un-deployed source.
MISSING="$(comm -13 "$TMP/live.lit" "$TMP/local.lit" || true)"
MISS_N=0
[[ -n "$MISSING" ]] && MISS_N=$(printf '%s\n' "$MISSING" | grep -c .)

if [[ "$MISS_N" -le "$TOLERANCE" ]]; then
  echo "FRESH  ${HOST}${PAGE_PATH} serves local HEAD source (content match; hashes differ — Vercel minifier output differs from local \`bunx vite build\`, NOT staleness)"
  echo "  hash sets differ but all ${local_js} local JS bundle(s) share HEAD's source literals (${MISS_N} missing ≤ ${TOLERANCE} tolerance)"
  if [[ "$MISS_N" -gt 0 ]]; then
    echo "  tolerated misses (build-env artifacts):"; printf '%s\n' "$MISSING" | sed 's/^/    /'
  fi
  exit 0
else
  echo "STALE  ${HOST}${PAGE_PATH} is missing ${MISS_N} HEAD source literal(s) — deploy has not propagated the latest code"
  echo "  un-deployed source markers (in local HEAD build, absent from live):"
  printf '%s\n' "$MISSING" | head -25 | sed 's/^/    /'
  [[ "$MISS_N" -gt 25 ]] && echo "    … and $((MISS_N-25)) more"
  exit 1
fi
