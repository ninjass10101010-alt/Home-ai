#!/usr/bin/env bash
# push-safe.sh — pre-push secret gate for the public-ish GitHub remotes.
# Reads live credential VALUES at runtime from gitignored local sources
# (.env.local files, the sshpass strings in DEPLOY_NAS_LOCAL.md, optionally
# NAS /tmp/new.env) and greps them against everything about to be pushed:
# the origin..HEAD commit range, the staged diff, and the working tree.
# Prints ONLY key names on hits — never a value. Exit 1 = do not push.
#
# Usage: bash scripts/security/push-safe.sh [--all] [--nas]
#   --all  also scan the full current branch history (slow; deep audits)
#   --nas  cross-check against the NAS /tmp/new.env values (needs SSH, creds
#          from the local-only DEPLOY_NAS_LOCAL.md)
set -u

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"
# locate the Home-ai dir whether we run from the submodule or the outer repo
if [ -f .env.local ]; then AI_DIR="."; else AI_DIR="Home-ai"; fi
[ -d "$AI_DIR" ] || { echo "push-safe: cannot find .env.local source dir"; exit 2; }

SCAN_ALL=0
SCAN_NAS=0
for arg in "$@"; do
  case "$arg" in --all) SCAN_ALL=1;; --nas) SCAN_NAS=1;; esac
done

# secret-ish key names whose VALUES must never be pushed
is_secret_key() {
  case "$1" in
    *SESSION_SECRET*|*ADMIN_SECRET*|*CRON_SECRET*|*_SECRET|*_PASS|*_PASSWD|*_PASSWORD|*_TOKEN|*_KEY) return 0;;
    *) return 1;;
  esac
}
is_placeholder() {
  # skip obviously-fake / template / documented-dev values
  case "$1" in
    ""|*changeme*|your_*|REPLACE_*|"<"*|"<REDACTED"*|\$\{*\}|dev-*) return 0;;
  esac
  [ "${#1}" -lt 8 ] && return 0
  return 1
}

# parallel arrays: VALS[i] value -> NAMES[i] display key
VALS=(); NAMES=()

add_val() { # $1 key-name $2 value
  [ -z "$2" ] && return
  is_placeholder "$2" && return
  local existing
  for existing in "${VALS[@]:-}"; do [ "$existing" = "$2" ] && return; done
  VALS+=("$2"); NAMES+=("$1")
}

collect_env_file() { # $1 path, $2 label
  [ -f "$1" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue;; *=*) ;; *) continue;; esac
    k=${line%%=*}; v=${line#*=}
    v=$(printf '%s' "$v" | tr -d '\r' | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    is_secret_key "$k" || continue
    add_val "$2:$k" "$v"
  done < "$1"
}

collect_env_file "$AI_DIR/.env.local" "local"
[ "$AI_DIR" = "." ] || collect_env_file ".env.local" "local-outer"

# sshpass passwords from the (gitignored) deploy runbook — both repos may hold it
for RB in "$AI_DIR/DEPLOY_NAS_LOCAL.md" "DEPLOY_NAS_LOCAL.md"; do
  [ -f "$RB" ] || continue
  while IFS= read -r pw; do
    add_val "runbook:$RB" "$pw"
  done < <(grep -o "sshpass -p '[^']*'" "$RB" 2>/dev/null | sed "s/sshpass -p '//;s/'$//")
done

if [ "$SCAN_NAS" = 1 ]; then
  RB="$AI_DIR/DEPLOY_NAS_LOCAL.md"; [ -f "$RB" ] || RB="DEPLOY_NAS_LOCAL.md"
  NASHOST=$(grep -o "ssh admin@[0-9.]*" "$RB" 2>/dev/null | head -1 | cut -d@ -f2)
  NASPW=$(grep -o "sshpass -p '[^']*'" "$RB" 2>/dev/null | head -1 | sed "s/sshpass -p '//;s/'$//")
  if [ -n "$NASHOST" ] && [ -n "$NASPW" ]; then
    while IFS= read -r line; do
      k=${line%%=*}; v=${line#*=}
      is_secret_key "$k" || continue
      add_val "nas:$k" "$v"
    done < <(sshpass -p "$NASPW" ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no "admin@$NASHOST" 'cat /tmp/new.env' 2>/dev/null)
  else
    echo "push-safe: --nas requested but runbook SSH details missing — skipping NAS check" >&2
  fi
fi

echo "push-safe: checking ${#VALS[@]} distinct secret values against:"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || echo "")
if [ "$SCAN_ALL" = 1 ]; then RANGE=""; DESC="FULL BRANCH HISTORY ($BRANCH)"; elif [ -n "$UPSTREAM" ]; then RANGE="$UPSTREAM..HEAD"; DESC="$RANGE ($BRANCH)"; else RANGE=""; DESC="all commits (no upstream)"; fi
echo "  commits: $DESC  |  staged diff  |  worktree"

LEAKS=0
i=0
while [ "$i" -lt "${#VALS[@]}" ]; do
  v="${VALS[$i]}"; n="${NAMES[$i]}"; i=$((i+1))
  hits=""
  if [ -n "$RANGE" ]; then
    c=$(git log -S"$v" --oneline "$RANGE" 2>/dev/null | head -3)
  else
    c=$(git log -S"$v" --oneline "$BRANCH" 2>/dev/null | head -3)
  fi
  [ -n "$c" ] && hits="history:$(printf '%s' "$c" | cut -d' ' -f1 | tr '\n' ',')"
  s=$(git diff --cached | grep -nF -- "$v" 2>/dev/null | head -1)
  [ -n "$s" ] && hits="$hits staged-diff"
  w=$(git grep -l -F -- "$v" -- . 2>/dev/null | head -3 | tr '\n' ',')
  [ -n "$w" ] && hits="$hits worktree($w)"
  if [ -n "$hits" ]; then echo "LEAK!! $n -> $hits"; LEAKS=$((LEAKS+1)); fi
done

if [ "$LEAKS" -gt 0 ]; then
  echo "push-safe: REFUSING — replace the values above with <REDACTED-NAME> placeholders,"
  echo "           keep real values in gitignored files (.env.local / NAS /tmp/new.env / runbook),"
  echo "           commit the redaction, re-run. If a hit is in already-pushed history: ROTATE."
  exit 1
fi
echo "push-safe: CLEAN — no secret values in the range, staged diff, or worktree. Safe to push."
