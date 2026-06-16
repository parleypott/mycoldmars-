#!/usr/bin/env bash
# verify-deploy.sh URL GREP_STRING [EXPECTED_STATUS]
# Exits 0 (PASS) if URL returns the expected HTTP status AND grep-string is in body.
# Exits 1 (FAIL) otherwise. Prints details either way.
#
# EXPECTED_STATUS is optional and defaults to 200, so existing two-arg calls are
# unchanged. Pass a third arg to verify non-200 routes — e.g. a custom 404 page
# (".../missing" "error 404" 404) or a redirect (".../old" "" 307). When the
# grep-string is empty, only the status is checked.
set -euo pipefail

URL="${1:-}"
GREP_STRING="${2:-}"
EXPECTED_STATUS="${3:-200}"

if [[ -z "$URL" ]]; then
  echo "Usage: verify-deploy.sh <url> <grep-string> [expected-status=200]" >&2
  exit 2
fi

TMPFILE=$(mktemp)
HTTP_STATUS=$(curl -sS -o "$TMPFILE" -w "%{http_code}" "$URL")

if [[ "$HTTP_STATUS" != "$EXPECTED_STATUS" ]]; then
  echo "FAIL  HTTP $HTTP_STATUS — expected $EXPECTED_STATUS for $URL"
  rm -f "$TMPFILE"
  exit 1
fi

# Empty grep-string means "status-only" check — pass once the status matches.
if [[ -z "$GREP_STRING" ]]; then
  echo "PASS  HTTP $HTTP_STATUS (status-only) for $URL"
  rm -f "$TMPFILE"
  exit 0
fi

if grep -q "$GREP_STRING" "$TMPFILE"; then
  echo "PASS  HTTP $HTTP_STATUS + \"$GREP_STRING\" found in $URL"
  rm -f "$TMPFILE"
  exit 0
else
  echo "FAIL  HTTP $HTTP_STATUS but \"$GREP_STRING\" NOT found in $URL"
  rm -f "$TMPFILE"
  exit 1
fi
