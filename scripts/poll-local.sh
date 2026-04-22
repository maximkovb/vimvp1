#!/usr/bin/env bash
# Manually trigger a TikTok poll against the local dev server.
# Reads CRON_SECRET from .env.local — no hardcoded credentials.
#
# Usage:
#   bash scripts/poll-local.sh           # normal poll (respects 9-min cooldown)
#   bash scripts/poll-local.sh --force   # bypass cooldown, poll all active markets

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found. Copy .env.example to .env.local and fill in CRON_SECRET." >&2
  exit 1
fi

# Source only the CRON_SECRET line to avoid polluting the shell environment
CRON_SECRET=$(grep -E '^CRON_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'" )

if [[ -z "$CRON_SECRET" ]]; then
  echo "Error: CRON_SECRET not set in $ENV_FILE" >&2
  exit 1
fi

FORCE=""
if [[ "${1:-}" == "--force" ]]; then
  FORCE="?force=true"
fi

curl -s \
  -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/poll-tiktok${FORCE}" \
  | jq .
