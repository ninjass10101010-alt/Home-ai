#!/bin/bash
set -euo pipefail
# Remove old container (force)
docker rm -f consuela-dashboard 2>/dev/null || true

# Secrets live in an env file that is NEVER committed, instead of being passed
# as `-e KEY=value` flags. Inline flags are persisted in the container's config
# and were the reason a live Telegram bot token reached a tracked file on
# 2026-10-03. `--env-file` keeps values out of this script, out of `docker
# inspect`, and out of git history going forward.
ENV_FILE="${CONSUELA_ENV_FILE:-./.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "error: env file not found: $ENV_FILE" >&2
  echo "       create it (gitignored) or set CONSUELA_ENV_FILE=/path/to/env" >&2
  exit 1
fi

# Start new container from freshly built image
docker run -d \
  --name consuela-dashboard \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file "$ENV_FILE" \
  -e NODE_ENV=production \
  -e POCKETBASE_URL=http://pocketbase:8090 \
  -e PB_URL=http://pocketbase:8090 \
  -e HERMES_API_URL=http://hermes-agent-2:8643 \
  --network familydashboard_consuela-net \
  home-ai-app:latest
# Attach the host-visible bridge network so the dashboard is
# reachable on 192.168.0.28:3000 (the QNAP host IP your tablet hits).
docker network connect bridge consuela-dashboard 2>/dev/null || true