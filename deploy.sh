#!/bin/sh
set -e

echo "🚀 Consuela Dashboard Updater"
echo ""

PARENT_REPO="${PARENT_REPO:-https://github.com/ninjass10101010-alt/Dashboard.git}"
PARENT_BRANCH="${PARENT_BRANCH:-main}"
SUBMODULE_BRANCH="${SUBMODULE_BRANCH:-warm-glass-v2}"
COMPOSE_DIR="${COMPOSE_DIR:-/share/Family-Dashboard}"

cd "$COMPOSE_DIR" || {
  echo "❌ Cannot cd to $COMPOSE_DIR. Set COMPOSE_DIR to your dashboard directory."
  exit 1
}

echo "📦 Pulling Dashboard from $PARENT_REPO (branch: $PARENT_BRANCH) ..."
if [ -d .git ]; then
  git fetch origin "$PARENT_BRANCH" 2>/dev/null || true
  LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
  REMOTE=$(git rev-parse "origin/$PARENT_BRANCH" 2>/dev/null || echo "unknown")
  if [ "$LOCAL" = "$REMOTE" ] && [ "$LOCAL" != "unknown" ]; then
    echo "✅ Dashboard already up to date ($(echo "$LOCAL" | cut -c1-7))"
  else
    git checkout "$PARENT_BRANCH" 2>/dev/null || git checkout -b "$PARENT_BRANCH" "origin/$PARENT_BRANCH"
    git pull origin "$PARENT_BRANCH"
  fi
  git submodule update --init --remote Home-ai
else
  echo "   Cloning fresh..."
  git clone --branch "$PARENT_BRANCH" "$PARENT_REPO" .
  git submodule init
  git submodule update --remote Home-ai
fi

echo "📦 Updating Home-ai submodule (branch: $SUBMODULE_BRANCH) ..."
cd Home-ai
git fetch origin "$SUBMODULE_BRANCH" 2>/dev/null || true
git checkout "$SUBMODULE_BRANCH" 2>/dev/null || git checkout -b "$SUBMODULE_BRANCH" "origin/$SUBMODULE_BRANCH"
git pull origin "$SUBMODULE_BRANCH"
cd ..

if [ ! -f Home-ai/.env ]; then
  echo "   Creating .env from template..."
  cp Home-ai/.env.docker Home-ai/.env 2>/dev/null || echo "⚠️  No .env.docker found — create .env manually with your secrets"
fi

echo "🔨 Rebuilding container..."
cd Home-ai
docker compose down consuela-dashboard 2>/dev/null || true
docker compose up -d --build consuela-dashboard
cd ..

echo ""
echo "✅ Dashboard updated! Latest commits:"
echo "   Dashboard: $(git -C Home-ai log -1 --format='%h — %s (%cr)')"
echo "   Parent:    $(git log -1 --format='%h — %s (%cr)')"
