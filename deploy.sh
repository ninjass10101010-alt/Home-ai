#!/bin/sh
set -e

echo "🚀 Consuela Dashboard Updater"
echo ""

REPO="${REPO:-https://github.com/ninjass10101010-alt/Home-ai}"
BRANCH="${BRANCH:-warm-glass-v2}"
COMPOSE_DIR="${COMPOSE_DIR:-/share/Family-Dashboard}"

cd "$COMPOSE_DIR" || {
  echo "❌ Cannot cd to $COMPOSE_DIR. Set COMPOSE_DIR to your dashboard directory."
  exit 1
}

echo "📦 Pulling $BRANCH from $REPO ..."
if [ -d .git ]; then
  git fetch origin "$BRANCH" 2>/dev/null || true
  LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
  REMOTE=$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo "unknown")
  if [ "$LOCAL" = "$REMOTE" ] && [ "$LOCAL" != "unknown" ]; then
    echo "✅ Already up to date ($(echo "$LOCAL" | cut -c1-7))"
    exit 0
  fi
  git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH"
  git pull origin "$BRANCH"
else
  echo "   Cloning fresh..."
  git clone --branch "$BRANCH" "$REPO" .
fi

if [ ! -f .env ]; then
  echo "   Creating .env from template..."
  cp .env.docker .env 2>/dev/null || echo "⚠️  No .env.docker found — create .env manually with your secrets"
fi

echo "🔨 Rebuilding container..."
docker compose down consuela-dashboard 2>/dev/null || true
docker compose up -d --build consuela-dashboard

echo ""
echo "✅ Dashboard updated! Latest commit:"
git log -1 --format="   %h — %s (%cr)"
