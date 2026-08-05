#!/bin/sh
# Seed PocketBase collections via direct REST API (no npm package needed)
# Run this from the QNAP host

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

# Get existing collections
EXISTING=$(curl -s "$PB_URL/api/collections" -H "Authorization: Bearer $TOKEN")
EXISTING_NAMES=$(echo "$EXISTING" | grep -o '"name":"[^"]*"' | cut -d'"' -f4)

create_collection() {
  local NAME="$1"
  local SCHEMA="$2"
  
  if echo "$EXISTING_NAMES" | grep -q "^${NAME}$"; then
    echo "  ✓ $NAME (exists)"
    return
  fi
  
  echo "  + $NAME"
  RESP=$(curl -s -X POST "$PB_URL/api/collections" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$NAME\",\"type\":\"base\",\"schema\":$SCHEMA}")
  
  ERR=$(echo "$RESP" | grep -o '"message":"[^"]*"' | head -1)
  if [ -n "$ERR" ]; then
    echo "    ✗ $ERR"
  fi
}

echo ""
echo "=== Creating collections ==="

create_collection "members" '[
  {"name":"name","type":"text","required":true},
  {"name":"emoji","type":"text"},
  {"name":"color","type":"text"},
  {"name":"role","type":"text"},
  {"name":"avatarSize","type":"text"},
  {"name":"glow","type":"bool"},
  {"name":"pin","type":"text"},
  {"name":"phone","type":"text"},
  {"name":"email","type":"text"}
]'

create_collection "meal_plan_entries" '[
  {"name":"name","type":"text","required":true},
  {"name":"emoji","type":"text"},
  {"name":"time","type":"text"},
  {"name":"mealType","type":"text"},
  {"name":"prepTime","type":"text"},
  {"name":"tags","type":"json"},
  {"name":"ingredients","type":"json"},
  {"name":"servings","type":"number"},
  {"name":"calories","type":"number"},
  {"name":"protein","type":"number"},
  {"name":"carbs","type":"number"},
  {"name":"fat","type":"number"},
  {"name":"instructions","type":"text"},
  {"name":"image","type":"text"}
]'

create_collection "recipes" '[
  {"name":"name","type":"text","required":true},
  {"name":"emoji","type":"text"},
  {"name":"prepTime","type":"text"},
  {"name":"cookTime","type":"text"},
  {"name":"tags","type":"json"},
  {"name":"ingredients","type":"json"},
  {"name":"instructions","type":"text"},
  {"name":"servings","type":"number"},
  {"name":"calories","type":"number"},
  {"name":"protein","type":"number"},
  {"name":"carbs","type":"number"},
  {"name":"fat","type":"number"},
  {"name":"source","type":"text"},
  {"name":"difficulty","type":"text"},
  {"name":"favorite","type":"bool"},
  {"name":"rating","type":"number"},
  {"name":"image","type":"text"}
]'

create_collection "pantry_items" '[
  {"name":"item","type":"text","required":true},
  {"name":"status","type":"select","options":{"values":["plenty","low","out"]}},
  {"name":"category","type":"text"}
]'

create_collection "grocery_list_items" '[
  {"name":"name","type":"text","required":true},
  {"name":"emoji","type":"text"},
  {"name":"category","type":"text"},
  {"name":"aisle","type":"text"},
  {"name":"quantity","type":"text"},
  {"name":"priority","type":"select","options":{"values":["low","medium","high"]}},
  {"name":"needed","type":"bool"},
  {"name":"manualOverride","type":"bool"},
  {"name":"source","type":"text"}
]'

create_collection "events" '[
  {"name":"title","type":"text","required":true},
  {"name":"date","type":"text"},
  {"name":"time","type":"text"},
  {"name":"icon","type":"text"},
  {"name":"color","type":"text"},
  {"name":"member","type":"text"}
]'

create_collection "schedules" '[
  {"name":"title","type":"text","required":true},
  {"name":"time","type":"text"},
  {"name":"days","type":"json"},
  {"name":"type","type":"text"},
  {"name":"icon","type":"text"},
  {"name":"color","type":"text"},
  {"name":"member","type":"text"}
]'

create_collection "emergency_contacts" '[
  {"name":"name","type":"text","required":true},
  {"name":"phone","type":"text"},
  {"name":"email","type":"text"},
  {"name":"carrier","type":"text"},
  {"name":"isPrimary","type":"bool"}
]'

create_collection "auth_sessions" '[
  {"name":"token","type":"text","required":true},
  {"name":"memberName","type":"text","required":true},
  {"name":"deviceName","type":"text"},
  {"name":"ip","type":"text"},
  {"name":"createdAt","type":"text"},
  {"name":"lastActiveAt","type":"text"}
]'

create_collection "tasks" '[
  {"name":"taskId","type":"number","required":true},
  {"name":"title","type":"text","required":true},
  {"name":"assignee","type":"text"},
  {"name":"assigneeEmoji","type":"text"},
  {"name":"due","type":"text"},
  {"name":"points","type":"number"},
  {"name":"recurring","type":"text"},
  {"name":"category","type":"text"},
  {"name":"priority","type":"text"},
  {"name":"universal","type":"bool"},
  {"name":"createdAt","type":"text"}
]'

create_collection "week_data" '[
  {"name":"weekStart","type":"text","required":true},
  {"name":"taskStates","type":"json"},
  {"name":"points","type":"json"},
  {"name":"streak","type":"json"},
  {"name":"lastActive","type":"json"},
  {"name":"history","type":"json"}
]'

create_collection "week_archive" '[
  {"name":"weekStart","type":"text","required":true},
  {"name":"archivedAt","type":"text"},
  {"name":"points","type":"json"},
  {"name":"streak","type":"json"},
  {"name":"history","type":"json"}
]'

create_collection "rewards" '[
  {"name":"name","type":"text","required":true},
  {"name":"emoji","type":"text"},
  {"name":"cost","type":"number"}
]'

create_collection "penalties" '[
  {"name":"name","type":"text","required":true},
  {"name":"emoji","type":"text"},
  {"name":"points","type":"number"}
]'

create_collection "family_goals" '[
  {"name":"title","type":"text"},
  {"name":"emoji","type":"text"},
  {"name":"targetPoints","type":"number"},
  {"name":"reward","type":"text"},
  {"name":"weekStart","type":"text"},
  {"name":"active","type":"bool"}
]'

create_collection "hall_of_fame" '[
  {"name":"member","type":"text","required":true},
  {"name":"emoji","type":"text"},
  {"name":"weekStart","type":"text","required":true},
  {"name":"points","type":"number"},
  {"name":"rank","type":"number"}
]'

echo ""
echo "=== Done ==="
