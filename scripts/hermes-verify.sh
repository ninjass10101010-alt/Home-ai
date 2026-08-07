#!/bin/bash
cd /opt/data/Home-ai
PASS=0; FAIL=0

run_check() {
  local name="$1"; shift
  echo "▶ $name"
  if "$@" >/dev/null 2>&1; then
    echo "  ✅ PASS"
    PASS=$((PASS + 1))
  else
    echo "  ❌ FAIL"
    FAIL=$((FAIL + 1))
  fi
}

run_check "typecheck" npm run typecheck
run_check "lint" npm run lint
run_check "build" npm run build
run_check "docker build" docker build -t app-source-home-dashboard:latest .

echo ""
echo "═══════════════════════════════"
echo "Results: $PASS passed, $FAIL failed"
exit $FAIL
