#!/bin/sh
set -e

# Uses the PocketBase REST API directly via curl from the QNAP host.
# This avoids needing the pocketbase npm package inside the container.

PB_URL="http://192.168.0.28:8090"
EMAIL="admin@consuela.app"
PASS="26649_alan"

echo "=== Authenticating ==="
AUTH=$(curl -s -X POST "$PB_URL/api/collections/_superusers/auth-with-password" \
  -H "Content-Type: application/json" \
  -d "{\"identity\":\"$EMAIL\",\"password\":\"$PASS\"}")

TOKEN=$(echo "$AUTH" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
if [ -z "$TOKEN" ]; then
  echo "Auth failed: $AUTH"
  exit 1
fi
echo "Token: ${TOKEN:0:20}..."

echo ""
echo "=== Getting existing collections ==="
EXISTING=$(curl -s "$PB_URL/api/collections" \
  -H "Authorization: Bearer $TOKEN" 2>&1)
echo "$EXISTING" | head -3

# List existing collection names
echo "$EXISTING" | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | sort
