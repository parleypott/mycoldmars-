#!/usr/bin/env bash
# deploy-freshness.sh <page-path> [dist-html-path] [host]
#
# Answers the question HTTP-200 cannot: "is the LIVE deploy actually serving the
# code I just built, or a stale older build?" It compares the content-hashed
# asset bundles (assets/<name>-<hash>.js|css) referenced by the live page against
# the ones in the locally-built dist/ for the SAME page. Vite renames a bundle's
# hash whenever its source changes, so:
#   live set == local set  -> FRESH  (the deploy reflects local HEAD)  exit 0
#   live set != local set  -> STALE  (deploy hasn't propagated/failed) exit 1
#
# WHY THIS EXISTS: a Vercel deploy can stay frozen for hours while every endpoint
# still returns 200 (and auth-gated ones still return a clean 401) — those signals
# prove the route EXISTS, not that it runs FRESH code. Several loop iterations once
# "verified" against a stale deploy because 200/401 looked green. This is the
# outside signal that actually distinguishes a propagated deploy from a stuck one.
#
# Requires dist/ built from the current HEAD first:  bunx vite build
# Only meaningful for Vite-built pages (those with hashed asset bundles). Pure
# static public/*.html copied verbatim have no hash — use verify-deploy.sh (a
# body grep for the changed text) for those instead.
set -euo pipefail

PAGE_PATH="${1:-}"
DIST_HTML="${2:-}"
HOST="${3:-https://mycoldmars.com}"

if [[ -z "$PAGE_PATH" ]]; then
  echo "Usage: deploy-freshness.sh <page-path> [dist-html-path] [host]" >&2
  echo "  e.g. deploy-freshness.sh /hunter/" >&2
  exit 2
fi

# Normalise the page path and derive the local dist html if not given.
case "$PAGE_PATH" in
  /*) : ;;
  *)  PAGE_PATH="/$PAGE_PATH" ;;
esac
if [[ -z "$DIST_HTML" ]]; then
  # /hunter/ -> dist/hunter/index.html ; / -> dist/index.html
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

extract() { grep -oE 'assets/[A-Za-z0-9_.-]+\.(js|css)' | sort -u; }

LIVE_SET=$(curl -sSL "${HOST}${PAGE_PATH}" | extract || true)
LOCAL_SET=$(extract < "$DIST_HTML" || true)

if [[ -z "$LOCAL_SET" ]]; then
  echo "FAIL  no hashed asset bundles found in $DIST_HTML — page may be pure static; use verify-deploy.sh instead" >&2
  exit 2
fi
if [[ -z "$LIVE_SET" ]]; then
  echo "STALE  live ${HOST}${PAGE_PATH} referenced no hashed bundles (page missing or not yet deployed)"
  exit 1
fi

if [[ "$LIVE_SET" == "$LOCAL_SET" ]]; then
  echo "FRESH  ${HOST}${PAGE_PATH} serves the local HEAD build"
  echo "$LIVE_SET" | sed 's/^/  /'
  exit 0
else
  echo "STALE  ${HOST}${PAGE_PATH} does NOT match local HEAD build — deploy not propagated"
  echo "  live :"; echo "$LIVE_SET"  | sed 's/^/    /'
  echo "  local:"; echo "$LOCAL_SET" | sed 's/^/    /'
  exit 1
fi
