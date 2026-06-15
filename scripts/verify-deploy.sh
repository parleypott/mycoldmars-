#!/usr/bin/env bash
# verify-deploy.sh URL GREP_STRING
# Exits 0 (PASS) if URL returns HTTP 200 AND grep-string is found in body.
# Exits 1 (FAIL) otherwise. Prints details either way.
set -euo pipefail

URL="${1:-}"
GREP_STRING="${2:-}"

if [[ -z "$URL" || -z "$GREP_STRING" ]]; then
  echo "Usage: verify-deploy.sh <url> <grep-string>" >&2
  exit 2
fi

TMPFILE=$(mktemp)
HTTP_STATUS=$(curl -sS -o "$TMPFILE" -w "%{http_code}" "$URL")

if [[ "$HTTP_STATUS" != "200" ]]; then
  echo "FAIL  HTTP $HTTP_STATUS — expected 200 for $URL"
  rm -f "$TMPFILE"
  exit 1
fi

if grep -q "$GREP_STRING" "$TMPFILE"; then
  echo "PASS  HTTP 200 + \"$GREP_STRING\" found in $URL"
  rm -f "$TMPFILE"
  exit 0
else
  echo "FAIL  HTTP 200 but \"$GREP_STRING\" NOT found in $URL"
  rm -f "$TMPFILE"
  exit 1
fi
