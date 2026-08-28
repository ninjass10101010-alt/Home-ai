#!/bin/bash
set -e
# Remove old container (force)
docker rm -f consuela-dashboard 2>/dev/null || true
# Start new container from freshly built image
docker run -d \
  --name consuela-dashboard \
  --restart unless-stopped \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e POCKETBASE_URL=http://pocketbase:8090 \
  -e PB_URL=http://pocketbase:8090 \
  -e "PB_ADMIN_EMAIL=admin@family.local" \
  -e "PB_ADMIN_PASSWORD=" \
  -e HERMES_API_URL=http://hermes-agent-2:8643 \
  -e "HERMES_API_KEY=consuela-api-key-2026" \
  -e "TELEGRAM_BOT_TOKEN=8509642029:AAE3eBxRQbgayiX-FXLxpIeXr3gVH2MWSHc" \
  -e "OPENROUTER_API_KEY=" \
  --network familydashboard_consuela-net \
  home-ai-app:latest
# Attach the host-visible bridge network so the dashboard is
# reachable on 192.168.0.28:3000 (the QNAP host IP your tablet hits).
docker network connect bridge consuela-dashboard 2>/dev/null || true
