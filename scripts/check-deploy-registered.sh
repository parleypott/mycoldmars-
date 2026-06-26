#!/usr/bin/env bash
# check-deploy-registered.sh [SHA] [--wait SECONDS]
#
# Answers ONE question the content-based checks (deploy-freshness.sh /
# verify-deploy.sh) structurally cannot: did Vercel ever CREATE a deployment for
# this commit at all?
#
# The failure mode this catches: a `git push` to main succeeds and lands on
# GitHub, but Vercel's Git integration never fires (a dropped/missed webhook, a
# paused project, a queue gap). The commit is on origin/main, the live site is
# healthy on the PREVIOUS build, and every content check passes — yet your change
# never deployed. deploy-freshness.sh would call it STALE without telling you WHY;
# this names the actual cause: NO DEPLOYMENT WAS REGISTERED. This bit the loop on
# cecb218 (2026-06-26): pushed clean, author correct, site 200 — but Vercel
# created no deployment for ~40+ min while every prior commit had deployed in
# seconds.
#
# Uses the GitHub Deployments API (Vercel registers each build as a deployment),
# the same outside signal the doctrine already trusts. Read-only; never pushes.
#
# Exit codes:
#   0  REGISTERED and latest status is success
#   1  NOT REGISTERED (no Vercel deployment exists for this SHA — webhook miss?)
#   2  REGISTERED but latest status is failure/error/pending (not yet live/green)
#   3  usage error / gh unavailable
set -euo pipefail

SHA_ARG=""
WAIT_SECS=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --wait) WAIT_SECS="${2:-0}"; shift 2 ;;
    -h|--help)
      echo "Usage: check-deploy-registered.sh [SHA] [--wait SECONDS]" >&2
      echo "  SHA defaults to current HEAD. --wait polls until registered or timeout." >&2
      exit 3 ;;
    *) SHA_ARG="$1"; shift ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR  gh CLI not found — cannot query the GitHub Deployments API." >&2
  exit 3
fi

# Resolve the target commit (full + short) from whatever the caller passed.
if [[ -n "$SHA_ARG" ]]; then
  FULL_SHA=$(git rev-parse --verify "$SHA_ARG^{commit}" 2>/dev/null || true)
else
  FULL_SHA=$(git rev-parse --verify HEAD 2>/dev/null || true)
fi
if [[ -z "$FULL_SHA" ]]; then
  echo "ERROR  could not resolve commit '${SHA_ARG:-HEAD}'." >&2
  exit 3
fi
SHORT_SHA="${FULL_SHA:0:7}"

# Returns the deployment id for FULL_SHA on stdout, or empty if none registered.
deployment_id_for_sha() {
  gh api "repos/:owner/:repo/deployments?per_page=30" \
    --jq ".[] | select(.sha == \"$FULL_SHA\") | .id" 2>/dev/null | head -1
}

DEPLOY_ID="$(deployment_id_for_sha || true)"

# Optional bounded foreground poll — for use right after a push, when the webhook
# may legitimately take a few seconds. Blocking on purpose (doctrine: verify
# synchronously, never background a watcher).
if [[ -z "$DEPLOY_ID" && "$WAIT_SECS" -gt 0 ]]; then
  echo "… no deployment yet for $SHORT_SHA — polling up to ${WAIT_SECS}s"
  elapsed=0
  while [[ "$elapsed" -lt "$WAIT_SECS" ]]; do
    sleep 8; elapsed=$((elapsed + 8))
    DEPLOY_ID="$(deployment_id_for_sha || true)"
    if [[ -n "$DEPLOY_ID" ]]; then break; fi
    echo "  …still no deployment after ${elapsed}s"
  done
fi

if [[ -z "$DEPLOY_ID" ]]; then
  echo "NOT-REGISTERED  Vercel has created NO deployment for $SHORT_SHA."
  echo "                The commit is in git but the build pipeline never fired."
  # Show how far HEAD has drifted past the newest deployment Vercel DID register —
  # a non-zero gap is the smoking gun for a dropped webhook.
  LATEST_DEPLOYED=$(gh api "repos/:owner/:repo/deployments?per_page=1" --jq '.[0].sha' 2>/dev/null || true)
  if [[ -n "$LATEST_DEPLOYED" ]]; then
    echo "                Newest registered deployment: ${LATEST_DEPLOYED:0:7}"
    if git merge-base --is-ancestor "$LATEST_DEPLOYED" "$FULL_SHA" 2>/dev/null; then
      GAP=$(git rev-list --count "${LATEST_DEPLOYED}..${FULL_SHA}" 2>/dev/null || echo "?")
      echo "                $SHORT_SHA is $GAP commit(s) AHEAD of the last deployed commit."
    fi
  fi
  echo "                Remedy: push a fresh commit to re-trigger the webhook"
  echo "                (HEAD carries this change along), or redeploy from the"
  echo "                Vercel dashboard. If a NEW push also fails to register,"
  echo "                the pipeline is frozen — ping Johnny."
  exit 1
fi

STATE=$(gh api "repos/:owner/:repo/deployments/$DEPLOY_ID/statuses?per_page=1" \
  --jq '.[0].state' 2>/dev/null || echo "unknown")

case "$STATE" in
  success)
    echo "REGISTERED  $SHORT_SHA → deployment $DEPLOY_ID — state: success ✓"
    exit 0 ;;
  failure|error)
    echo "REGISTERED  $SHORT_SHA → deployment $DEPLOY_ID — state: $STATE ✗ (build did NOT succeed)"
    exit 2 ;;
  *)
    echo "REGISTERED  $SHORT_SHA → deployment $DEPLOY_ID — state: $STATE (in flight, not yet green)"
    exit 2 ;;
esac
