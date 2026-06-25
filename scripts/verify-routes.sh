#!/usr/bin/env bash
# verify-routes.sh — one command to confirm the ENTIRE deployed surface is up.
#
# Why this exists: verify-deploy.sh and deploy-freshness.sh each check a SINGLE
# URL. The doctrine's VERIFY GATE leans on them, but after a deploy there was no
# fast way to confirm that *every* live tool route still serves — a broken route
# on a tool you didn't touch (a bad rewrite, a dropped build entry, a 500 on a
# page that imports a regressed module) would sail past a single-URL check.
#
# This walks every page Vite actually builds — parsed straight from
# vite.config.js's `resolve(__dirname, '<dir>/index.html')` entries, so the route
# list can NEVER drift from what's deployed: add a tool to the build and it's
# covered here automatically, with no edit to this script.
#
# It ALSO walks every static page under public/ (burma-essays, glossary,
# nile-flights, deck-v2, walden, walden-3d, westchester, …). Vite copies public/
# to the deploy root verbatim, so `public/<name>/index.html` is served live at
# `/<name>/` but is NOT a build entry — the earlier version hardcoded only two of
# these (walden, westchester) and silently OMITTED the rest, including the
# flagship burma-essays PWA. Deriving them from public/*/index.html keeps the
# "full surface" honestly full and drift-proof: drop a new static page into
# public/ and it's covered automatically, no edit here.
#
# Semantics: a route is HEALTHY if it returns 2xx OR 3xx. A 3xx is a working
# redirect (the QSS /queen-scarlet-school/* routes legitimately 307 to /universe/*),
# not a broken page — flagging it would be a false alarm. Only 4xx/5xx (and curl
# transport failures → 000) count as FAIL. Exits nonzero iff any route fails, so
# it slots straight into the loop's VERIFY GATE.
#
# Usage:
#   scripts/verify-routes.sh                         # default live base
#   scripts/verify-routes.sh https://my-preview.app  # any base URL
#   BASE=http://localhost:4173 scripts/verify-routes.sh
set -uo pipefail

BASE="${1:-${BASE:-https://mycoldmars.vercel.app}}"
BASE="${BASE%/}"  # strip trailing slash

# Resolve repo root from this script's location so it runs from anywhere.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VITE="$ROOT/vite.config.js"
if [[ ! -f "$VITE" ]]; then
  echo "verify-routes: cannot find vite.config.js at $VITE" >&2
  exit 2
fi

# ── Derive routes from Vite build entries (the deterministic source of truth) ──
# 'index.html'            -> /
# 'eez/index.html'        -> /eez/
# 'a/b/index.html'        -> /a/b/
mapfile -t ROUTES < <(
  grep -oE "resolve\(__dirname, *'[^']+'\)" "$VITE" \
    | sed -E "s/.*'([^']+)'.*/\1/" \
    | sed -E 's#/?index\.html$##' \
    | sed -E 's#^#/#; s#//#/#' \
    | sort -u
)

# ── Static pages under public/ (served at root, NOT Vite build entries) ──
# Vite copies public/ verbatim to the deploy root, so public/<name>/index.html
# serves live at /<name>/. Derive these the same way as build entries so the
# list can never drift (a new public page is covered automatically).
mapfile -t EXTRA_ROUTES < <(
  if [[ -d "$ROOT/public" ]]; then
    ( cd "$ROOT" && find public -name index.html -type f ) \
      | sed -E 's#^public/##; s#/?index\.html$##' \
      | sed -E 's#^#/#; s#//#/#' \
      | sort -u
  fi
)

# Normalize: ensure a single trailing slash on non-root paths.
norm() { local r="$1"; [[ "$r" == "/" ]] && { echo "/"; return; }; r="${r%/}/"; echo "$r"; }

ALL=()
for r in "${ROUTES[@]}"; do ALL+=("$(norm "$r")"); done
for r in "${EXTRA_ROUTES[@]}"; do ALL+=("$(norm "$r")"); done
# de-dup while preserving order
declare -A seen; UNIQ=()
for r in "${ALL[@]}"; do [[ -n "${seen[$r]:-}" ]] && continue; seen[$r]=1; UNIQ+=("$r"); done

echo "verify-routes: checking ${#UNIQ[@]} routes against $BASE"
echo "------------------------------------------------------------"

fails=0; oks=0
for r in "${UNIQ[@]}"; do
  code="$(curl -sS -m 20 -o /dev/null -w "%{http_code}" "$BASE$r" 2>/dev/null)"
  if [[ "$code" =~ ^[23][0-9][0-9]$ ]]; then
    printf "  \033[32mOK\033[0m   %-3s  %s\n" "$code" "$r"
    oks=$((oks+1))
  else
    printf "  \033[31mFAIL\033[0m %-3s  %s\n" "${code:-000}" "$r"
    fails=$((fails+1))
  fi
done

echo "------------------------------------------------------------"
if [[ "$fails" -eq 0 ]]; then
  echo -e "\033[32mall $oks routes healthy (2xx/3xx)\033[0m"
  exit 0
else
  echo -e "\033[31m$fails route(s) FAILED, $oks healthy\033[0m"
  exit 1
fi
