#!/usr/bin/env bash
# push-safe.sh — pre-push secret gate for the public-ish GitHub remotes.
#
# TWO TIERS, both mandatory:
#
#   TIER 1 — VALUE-based (unchanged since 2026-09). Reads live credential VALUES
#     at runtime from gitignored local sources (.env.local files, the sshpass
#     strings in DEPLOY_NAS_LOCAL.md, optionally NAS /tmp/new.env) and greps
#     them against the push range, the staged diff and the worktree. Precise,
#     but blind by construction: it cannot see a credential that was committed
#     and later ROTATED (the committed value no longer matches the local one),
#     a credential from a machine/env file we do not have, or a value pasted
#     straight into source. That blind spot is how a live Telegram bot token
#     reached a tracked file on a public-ish remote in 2026-09.
#
#   TIER 2 — SHAPE + NAME-based (added 2026-10-03). Fires on the SHAPE of a
#     value (Tier A) or on a secret-looking NAME holding a non-placeholder
#     literal (Tier B). Needs no local copy of the credential, so it covers the
#     rotated / foreign / pasted cases Tier 1 cannot see.
#
# Prints ONLY rule ids, key names and file:line — NEVER a value. Exit 1 = do
# not push. Tier 2 is deliberately conservative: a false positive here trains
# people to ignore the gate, so every ambiguous shape is a documented rejection
# below instead of a rule.
#
# Usage: bash scripts/security/push-safe.sh [--all] [--nas] [--self-test]
#   --all       also scan the full current branch history (slow; deep audits)
#   --nas       cross-check Tier 1 against the NAS /tmp/new.env values (needs
#               SSH, creds from the local-only DEPLOY_NAS_LOCAL.md)
#   --self-test prove Tier 2 on planted FAKE secrets + the repo's real
#               placeholder corpus (offline: no git, no network, temp dir only)
set -u

# ═══════════════════════════════════════════════════════════════════════════
# RULE TABLE — the single place a detector is added or retired.
# ═══════════════════════════════════════════════════════════════════════════
#
# ── TIER A: shape rules ───────────────────────────────────────────────────
# A shape rule matches the VALUE SHAPE alone, anywhere, in any file: no name
# context, no local copy of the credential, no placeholder exemption (a rotated
# credential is still a credential). Each entry is anchored to a real vendor
# format with a length floor, so the only maintenance cost is keeping the
# format current. Fields: id|ERE|what it is — the EREs are POSIX-extended and
# deliberately contain NO backslashes so they can be handed to git/grep/awk
# verbatim (awk -v and grep -E would otherwise eat them).
#
#   telegram-bot-token|[0-9]{5,}:[A-Za-z0-9_-]{35,}|Telegram bot token — numeric bot id, ':', 35-char secret (real ones are exactly 35)
#   github-pat        |gh[pousx]_[A-Za-z0-9]{30,}   |GitHub classic PAT (ghp_/gho_/ghu_/ghs_/ghx_)
#   github-fine-pat   |github_pat_[A-Za-z0-9_]{40,}|GitHub fine-grained PAT
#   anthropic-key     |sk-ant-[A-Za-z0-9_-]{20,}    |Anthropic key (sk-ant-…)
#   openai-key        |sk-[A-Za-z0-9]{20,}         |OpenAI-style key (sk-…, incl. sk-proj-)
#   google-api-key    |AIza[0-9A-Za-z_-]{30,}       |Google API key
#   aws-access-key    |(AKIA|ASIA|ABIA|ACCA|AIDA|AROA)[0-9A-Z]{16}|AWS access key id (long-lived or STS)
#   slack-token       |xox[baprs]-[0-9A-Za-z-]{10,}|Slack bot/user/app/refresh token
#   slack-webhook     |hooks[.]slack[.]com/services/[A-Za-z0-9_/]{20,}|Slack incoming-webhook URL
#   stripe-live-key   |[srp]k_live_[0-9A-Za-z]{16,}  |Stripe live secret / restricted / publishable key
#   private-key       |-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|PEM private key header (any algorithm)
#   jwt               |eyJ[0-9A-Za-z_=-]{10,}[.][0-9A-Za-z_=-]{10,}[.][0-9A-Za-z_=-]{5,}|JSON Web Token (3+ base64url segments)
#
# Deliberately NOT included (would fire on ordinary repo content, so they stay
# out rather than ship as noise): npm_ / hf_ / glpat- / dop_v1_ prefixes, AWS
# `aws_secret_access_key = <40-char base64>` (Tier B owns it by name), Discord /
# Plex / qBittorrent / Sonarr token shapes (undocumented formats — Tier B covers
# them by name), and "generic long hex" (Tier B's readability test owns it).
#
# ── TIER B: name rule ─────────────────────────────────────────────────────
# Fires when a variable NAME matches SECRET_NAME_RE (or SECRET_CODE_NAME_RE) and
# the VALUE after the first ':' or '=' passes value_is_credential(). Env-file,
# JS/TS, shell, YAML and markdown-prose assignments all match, because the
# 2026-09-08 wave leaked through AGENTS.md prose and .env.docker — not only
# through code.
#
# ── TIER B: exactly what "an obvious placeholder" means ───────────────────
# value_is_credential() returns FALSE (no hit) for, in order:
#   1. empty, or shorter than 12 chars — a real credential is not 3 chars, and
#      the repo's own fakes are "tok", "k", "123:abc"
#   2. anything containing whitespace, < > $ ( ) { } | # — prose, markdown, code
#      expressions, and every "<REDACTED-NAME>" style placeholder
#   3. a URL (contains "://"), a filesystem path, a pure number, or a dotted
#      identifier chain (process.env.X, r.token) — a reference, not a literal
#   4. a run of ONE repeated character >= 12 chars (tests/unit/secret-box.test.ts
#      assigns 32 bytes of base64 padding to a bare KEY)
#   5. any "_" / "-" / "." / ":" / "/" separated segment that IS one of the
#      documented template markers: test dev demo mock fake dummy sample
#      placeholder redacted change your example replace xxx unsafe env spec
#      todo notreal nosecret. This is what keeps the repo's committed fixtures
#      ("test-secret-0123456789", "mock-key", "unsafe-session",
#      "dev-cron-secret-2026", "123456:test-mock-token") green. Tier A still
#      applies to those files, so a real vendor token pasted into a test is
#      still caught.
#   6. a READABLE value: <= 48 chars, only [A-Za-z0-9._+*/~!-], and >= 18%
#      vowels. That is the storage-key / slug corpus this repo is full of
#      ("consuela-events", "consuela-rewards-updatedAt", "tasks-snapshot",
#      "last_telegram_update_id", "member-admin", "++operationTokenRef.current")
#      — and it still leaves opaque hex/base64 suspicious, because random hex is
#      vowel-poor (~12% of characters) while words are vowel-rich (~38%).
#      Measured on 2026-10-03: the whole readable corpus is 21%+ (lowest
#      "tasks-snapshot"), sampled secrets are 12% or below.
# Tier B trades recall for zero noise on purpose: Tier A plus Tier 1 carry the
# hard cases, and a gate nobody trusts protects nothing.
#
# ── Tier 1's own placeholder list (unchanged, value-scan side) ────────────
#   empty, <8 chars, "<…>", "<REDACTED…>", your_*, REPLACE_*, changeme, dev-*
# ═══════════════════════════════════════════════════════════════════════════

# ── Tier A rules ───────────────────────────────────────────────────────────
SHAPE_RULES=(
  'telegram-bot-token|[0-9]{5,}:[A-Za-z0-9_-]{35,}'
  'github-pat|gh[pousx]_[A-Za-z0-9]{30,}'
  'github-fine-pat|github_pat_[A-Za-z0-9_]{40,}'
  'anthropic-key|sk-ant-[A-Za-z0-9_-]{20,}'
  'openai-key|sk-[A-Za-z0-9]{20,}'
  'google-api-key|AIza[0-9A-Za-z_-]{30,}'
  'aws-access-key|(AKIA|ASIA|ABIA|ACCA|AIDA|AROA)[0-9A-Z]{16}'
  'slack-token|xox[baprs]-[0-9A-Za-z-]{10,}'
  'slack-webhook|hooks[.]slack[.]com/services/[A-Za-z0-9_/]{20,}'
  'stripe-live-key|[srp]k_live_[0-9A-Za-z]{16,}'
  'private-key|-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----'
  'jwt|eyJ[0-9A-Za-z_=-]{10,}[.][0-9A-Za-z_=-]{10,}[.][0-9A-Za-z_=-]{5,}'
)

# ── Tier B name + value rules ──────────────────────────────────────────────
# SECRET_NAME_RE: the env-var convention. The name contains KEYS?, TOKENS?,
# SECRETS?, PASSWORDS?, PASSWD, PWD, PASS or CREDENTIALS? as a word-fragment, so
# AI_MAX_TOKENS matches but "keyboard" does not. PASS/PASSWD are added beyond the
# original list because this repo's own env names are PB_ADMIN_PASS / MQTT_PASS /
# PB_ADMIN_PASSWORD.
SECRET_NAME_RE='(^|[^A-Za-z0-9_])([A-Za-z0-9_]*_?(KEYS?|TOKENS?|SECRETS?|PASSWORDS?|PASSWD|PWD|PASS|CREDENTIALS?)[A-Za-z0-9_]*)[[:space:]]*[:=][[:space:]]*'
# SECRET_CODE_NAME_RE: the idiomatic JS/TS credential names, which is where a
# pasted secret actually lands in an app repo. Matched as whole words (no
# identifier suffix allowed before the ':'/'='), so tokenizer/mapKey/sortKey do
# not match. Verified against all 1294 tracked files: zero findings 2026-10-03.
SECRET_CODE_NAME_RE='(^|[^A-Za-z0-9_])(apiKey|botToken|sessionSecret|accessToken|refreshToken|authToken|secretKey|privateKey|encryptionKey|token|secret|password|passwd|credential|credentials)[[:space:]]*[:=][[:space:]]*'
# value-token charset after NAME<sep>= : ASCII only, so the value stops at
# prose/punctuation instead of swallowing a sentence. The optional opening quote
# is required or every quoted JS/TS assignment is invisible to the prescan.
SECRET_VALUE_TAIL='["'"'"']?[A-Za-z0-9_+/=.$%^&()!:~-]{12,}'
SECRET_VALUE_RE='[:=][[:space:]]*["'"'"']?([A-Za-z0-9_+/=.${}%^&()!:~-]+)'
PLACEHOLDER_MARKERS=' test dev demo mock fake dummy sample placeholder redacted change your example replace xxx unsafe env spec todo notreal nosecret '

# SHAPE_ANY is every Tier A ERE as one alternation: one regex evaluation rejects
# the overwhelming majority of lines, and the per-rule loop below only runs (to
# name the rule) when that one match fires. bash 3.2 recompiles on every =~, so
# this turns 12 compiles per line into 1.
SHAPE_ANY=""
for _r in "${SHAPE_RULES[@]}"; do SHAPE_ANY="${SHAPE_ANY:+$SHAPE_ANY|}${_r#*|}"; done
unset _r

# ═══════════════════════════════════════════════════════════════════════════
# TIER 2 CLASSIFIER — shared by the real scan and --self-test
# ═══════════════════════════════════════════════════════════════════════════
PS_FINDINGS=""

ps_findings_reset() {
  if [ -z "$PS_FINDINGS" ]; then
    PS_FINDINGS=$(mktemp "${TMPDIR:-/tmp}/push-safe-findings.XXXXXX") || exit 2
    trap 'rm -f "$PS_FINDINGS"' EXIT INT TERM
  else
    : > "$PS_FINDINGS"
  fi
}

# value_is_credential VALUE -> 0 when the value looks like a real credential.
# Reads only $1 and prints nothing; order matters (cheapest rejections first).
value_is_credential() {
  local v="$1"
  # unwrap a wrapping quote pair so 'abc' and "abc" classify the same
  case "$v" in
    \"*\") v="${v#\"}"; v="${v%\"}" ;;
    \'*\') v="${v#\'}"; v="${v%\'}" ;;
  esac
  local n=${#v} i seg vowels c1 novowels
  [ "$n" -eq 0 ] && return 1              # (1) empty
  [ "$n" -lt 12 ] && return 1             # (1) too short to be a credential
  case "$v" in                            # (2) prose / expression / mask
    *[[:space:]]*|*'<'*|*'>'*|*'$'*|*'('*|*')'*|*'{'*|*'}'*|*'|'*|*'#'*) return 1 ;;
  esac
  case "$v" in                            # (3) url / path / pure number
    *://*|/*) return 1 ;;
  esac
  case "$v" in *[!0-9]*) ;; *) return 1 ;; esac
  # (3b) a dotted identifier chain is a code reference (process.env.X, r.token)
  case "$v" in
    [A-Za-z_]*.*) case "$v" in *[!A-Za-z0-9._]*) ;; *) return 1 ;; esac ;;
  esac
  # (4) one character repeated >= 12 times (base64 padding fixtures)
  c1="${v:0:1}"
  for ((i = 1; i < n; i++)); do
    [ "${v:i:1}" = "$c1" ] || break
    [ "$i" -ge 11 ] && return 1
  done
  local OLDIFS="$IFS"
  IFS='._-:/'                            # (5) documented template markers
  for seg in $v; do
    case "$seg" in *[A-Z]*) seg=$(printf '%s' "$seg" | tr 'A-Z' 'a-z') ;; esac
    case "$PLACEHOLDER_MARKERS" in *" $seg"*) IFS="$OLDIFS"; return 1 ;; esac
  done
  IFS="$OLDIFS"
  [ "$n" -le 48 ] || return 0             # (6) long values are opaque by default
  case "$v" in                              # (6) readability test — no leading-letter
    *[!A-Za-z0-9._+*/~!-]*) return 0 ;;       #     requirement: code expressions like
  esac                                       #     "++operationTokenRef.current" are
                                             #     readable too, and must stay quiet
                                             #     ("-" must stay last in that class)
  # vowel count by deletion (C-speed in bash, no per-char loop, no subprocess).
  # NOTE: no nested ${#${v//…}} — bash 3.2 rejects that, so use a temp name.
  novowels=${v//[aeiouAEIOU]/}
  vowels=$((n - ${#novowels}))
  # 18% is measured, not guessed: every readable value in this repo's storage-key
  # corpus lands at 21%+ (lowest: "tasks-snapshot"), while hex/base64 secrets
  # land at 12% or below. See docs/PUSH_GITHUB.md for the full table.
  [ $((vowels * 100 / n)) -ge 18 ] && return 1
  return 0
}

# classify_line SCOPE PATH LINENO CONTENT
# Appends one finding per hit to $PS_FINDINGS, carrying a scope, a path:line and
# a rule id or key NAME — never the content.
classify_line() {
  local scope="$1" path="$2" lineno="$3" content="$4" rule id name
  # ── Tier A: shape ───────────────────────────────────────────────────────
  if [[ "$content" =~ $SHAPE_ANY ]]; then
    for rule in "${SHAPE_RULES[@]}"; do
      id="${rule%%|*}"
      [[ "$content" =~ ${rule#*|} ]] || continue
      printf 'LEAK!! shape/%s -> %s %s:%s\n' "$id" "$scope" "$path" "$lineno" >> "$PS_FINDINGS"
    done
  fi
  # ── Tier B: secret-looking NAME + non-placeholder value ─────────────────
  # Both name rules are matched separately so the reported key NAME is exact.
  name=""
  if [[ "$content" =~ $SECRET_NAME_RE ]]; then
    name="${BASH_REMATCH[2]}"
  elif [[ "$content" =~ $SECRET_CODE_NAME_RE ]]; then
    name="${BASH_REMATCH[2]}"
  fi
  [ -n "$name" ] || return 0
  [[ "$content" =~ $SECRET_VALUE_RE ]] || return 0
  value_is_credential "${BASH_REMATCH[1]}" || return 0
  printf 'LEAK!! name/%s -> %s %s:%s\n' "$name" "$scope" "$path" "$lineno" >> "$PS_FINDINGS"
}

# classify_stream — reads "scope|path|line|content" records on stdin.
# "|" not tab: tab is IFS whitespace, so IFS=$'\t' would silently collapse
# empty fields, and read() still hands the remainder to the last variable.
classify_stream() {
  local scope path lineno content
  while IFS='|' read -r scope path lineno content; do
    [ -n "${lineno:-}" ] || continue
    classify_line "$scope" "$path" "$lineno" "$content"
  done
}

# prescan_stream — keep only records whose content can match any rule (awk does
# the broad ERE; bash then applies the placeholder logic to the survivors)
prescan_stream() {
  awk 'index($0, "|") && $0 ~ ENVIRON["PUSHSAFE_PRESCAN"]' | classify_stream
}

# ── worktree: tracked files ────────────────────────────────────────────────
# git grep runs the broad prescan in C; only its matches reach the classifier.
scan_tracked() {
  git grep -n -I -E "$PUSHSAFE_PRESCAN" -- . 2>/dev/null |
    awk -F: '{
      p = $1; l = $2; c = ""
      for (i = 3; i <= NF; i++) c = (i == 3 ? $i : c ":" $i)
      print "worktree|" p "|" l "|" c
    }' | prescan_stream
}

# ── worktree: untracked but not ignored (what a later `git add` sweeps in) ──
scan_untracked() {
  local f
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    grep -n -I -E "$PUSHSAFE_PRESCAN" -- "$f" 2>/dev/null |
      awk -F: -v f="$f" '{
        c = ""
        for (i = 2; i <= NF; i++) c = (i == 2 ? $i : c ":" $i)
        print "untracked|" f "|" $1 "|" c
      }' | prescan_stream
  done < <(git ls-files --others --exclude-standard 2>/dev/null)
}

# ── diff parser, shared by --cached and the history scan ───────────────────
# Emits only ADDED lines as "scope|path|line|content". Added lines only, on
# purpose: a commit that REMOVES a credential (the 2026-09-08 and 2026-10-03
# redaction commits) is the fix, not the leak, and must not block its own push.
# The prescan runs here in awk so a deep --all audit streams 28MB of diff
# without waking bash for every line.
DIFF_AWK='
BEGIN { path = ""; newln = 0; base = ENVIRON["PUSHSAFE_SCOPE"] }
{
  if (substr($0, 1, 7) == "commit ") { commit = substr($0, 8, 7); path = ""; next }
  if (substr($0, 1, 4) == "+++ ") {
    p = substr($0, 5)
    if (substr(p, 1, 2) == "b/") p = substr(p, 3)
    path = p; next
  }
  if (substr($0, 1, 2) == "@@") {
    i = index($0, "+")
    if (i > 0) {
      s = substr($0, i + 1); j = index(s, " ")
      if (j > 0) s = substr(s, 1, j - 1)
      k = index(s, ","); if (k > 0) s = substr(s, 1, k - 1)
      newln = s + 0
    }
    next
  }
  if (path == "" || substr($0, 1, 1) != "+") next
  if ($0 ~ ENVIRON["PUSHSAFE_PRESCAN"]) print base ":" commit "|" path "|" newln "|" substr($0, 2)
  newln++
}'

scan_staged() {
  git diff --cached -U0 --no-color 2>/dev/null |
    PUSHSAFE_SCOPE=staged awk "$DIFF_AWK" | prescan_stream
}

scan_history() { # $1 = rev range
  git log -p -U0 --no-color --format='commit %H' "$1" 2>/dev/null |
    PUSHSAFE_SCOPE=history awk "$DIFF_AWK" | prescan_stream
}

# ═══════════════════════════════════════════════════════════════════════════
# SELF-TEST — planted FAKE secrets + the repo's real placeholder corpus
# ═══════════════════════════════════════════════════════════════════════════
# Every planted value is an obvious fake built from FAKE / NOTREAL, and the run
# asserts those values never reach the output. Nothing here is a credential and
# nothing is written inside the repo (temp dir, removed on exit).
self_test() {
  local dir checks=0 failed=0 out rule got label file
  dir=$(mktemp -d "${TMPDIR:-/tmp}/push-safe-selftest.XXXXXX") || return 2
  ps_findings_reset
  trap "rm -rf '$dir' '$PS_FINDINGS'" EXIT INT TERM

  # ── must NOT fire: the repo's real committed env template, verbatim ──────
  [ -f "$AI_DIR/.env.example" ] && cp "$AI_DIR/.env.example" "$dir/clean-env.example"

  # ── must NOT fire: every <REDACTED-NAME> / marker / reference / slug shape
  cat > "$dir/clean-redacted.env" <<'CLEAN_EOF'
PB_ADMIN_PASS=<REDACTED-NAS-PW>
HERMES_API_KEY=<REDACTED-HERMES-KEY>
SESSION_SECRET="<REDACTED-SESSION>"
GOOGLE_CLIENT_SECRET=<your-client-secret>
CRON_SECRET=changeme-please-set-me
ADMIN_SECRET=generate-a-long-random-string
HA_TOKEN=your_long_lived_token
GMAIL_APP_PASSWORD=your-16-character-app-password
PB_ADMIN_PASSWORD=your_secure_password
AWS_SECRET_ACCESS_KEY=your_secret
INSTACART_API_KEY=your_api_key_here
MUSE_TOKEN='v1.…'
MQTT_PASS=xxxx xxxx xxxx xxxx
PB_PASSWORD=***REMOVED***
CONSUELA_ENCRYPTION_KEY=${CONSUELA_ENCRYPTION_KEY:-}
SESSION_SECRET=$SESSION_SECRET
HA_TOKEN=process.env.HA_LONG_LIVED_TOKEN
CRON_SECRET=$(curl -s "$URL" | jq -r .token)
PASSWORD="placeholder-not-a-real-value"
SECRET=__replace_me__
const EVENTS_STORAGE_KEY = "consuela-events";
const SNAPSHOT_KEY = "tasks-snapshot";
const REWARDS_STAMP_KEY = "consuela-rewards-updatedAt";
const STATE_KEY = "last_telegram_update_id";
const TOKEN_LOCK = "google-token-store";
const MEMBER_ADMIN_LOCK_KEY = "member-admin";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_KEY_LIMIT = 120;
const AI_MAX_TOKENS = 3072;
const KEY_LEN = 32;
const KEYWORDS = ["doctor", "dentist", "flight"];
HA_HOST=http://homeassistant:8123
MQTT_BROKER=mqtt://mosquitto:1883
process.env.SESSION_SECRET = "test-secret-0123456789";
process.env.HA_TOKEN = "test-token";
process.env.TELEGRAM_BOT_TOKEN = "123456:test-mock-token";
process.env.CRON_SECRET = "test-secret-123";
process.env.HERMES_API_KEY = "mock-key";
process.env.TELEGRAM_BOT_TOKEN = "env-token";
const SESSION_SECRET_PROBE = "unsafe-session";
const AI_PROVIDER_KEY_PROBE = "unsafe-key";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
const KEY = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=";
CLEAN_EOF

  # ── MUST fire: planted fakes ────────────────────────────────────────────
  # Every planted value is assembled from fragments at RUNTIME. A literal
  # credential shape committed in this file would be scanned by the very gate
  # that defines it and block every push — so the shapes exist only in $TMPDIR.
local fake_tg fake_sk fake_b64 tg_id tg_sec gh_pfx gh_rest jwt_a jwt_b jwt_c
  local hex_a hex_b
  tg_id="1234567890"; tg_sec="NOTAREALBOTTOKENnotarealbotnotarealbot"
  fake_tg="$tg_id:$tg_sec"
  fake_sk="sk-"; fake_sk="${fake_sk}FAKE0FAKE0"; fake_sk="${fake_sk}FAKE0FAKE0"
  fake_sk="${fake_sk}FAKE0FAKE0"
  fake_b64="Zm9vYmFyMTIzNDU2Nzg5MGFiY2RlZmxvc3N0"
  gh_pfx="ghp_"; gh_rest="FAKEfakeFAKEfakeFAKEfakeFAKEfakeFAKEfake00"
  jwt_a="eyJ"; jwt_b="hbGciOiJIUzI1NiJ9"; jwt_c="eyJzdWIiOiJmYWtlIn0"
  hex_a="4f8b2c9e1a7d305f6b8c2d4e9f0a1b3"; hex_b="c5d7e9f0a2b4c6d8e0f1a3b5c7d9e0f"
  cat > "$dir/leak-telegram.txt" <<EOF
# planted fake: shape only, no secret-looking name on the line
curl "https://api.telegram.org/bot${fake_tg}/getMe"
EOF
  cat > "$dir/leak-openai.txt" <<EOF
# planted fake
OPENAI_API_KEY=${fake_sk}
EOF
  cat > "$dir/leak-github.txt" <<EOF
${gh_pfx}${gh_rest}
EOF
  cat > "$dir/leak-jwt.txt" <<EOF
Authorization: Bearer ${jwt_a}${jwt_b}.${jwt_c}.notarealsignature
EOF
  printf -- '-----BEGIN %s PRIVATE KEY-----\n%s\n' OPENSSH 'b3BlbnNzaC1rZXktdjEAAAAA-not-a-real-key' > "$dir/leak-pem.txt"
  cat > "$dir/leak-name-b64.txt" <<EOF
CONSUELA_ENCRYPTION_KEY=${fake_b64}
EOF
  cat > "$dir/leak-name-hex.txt" <<EOF
HERMES_API_KEY = ${hex_a}${hex_b}
EOF
  cat > "$dir/leak-name-bare.txt" <<EOF
const apiKey = "${fake_b64}";
EOF

  # run the shipped classifier over every fixture, one file at a time so the
  # reported path is the fixture's real name
  for file in "$dir"/*; do
    [ -f "$file" ] || continue
    awk -v OFS='|' -v f="$file" '{ print "selftest", f, FNR, $0 }' "$file" | prescan_stream
  done
  out=$(cat "$PS_FINDINGS")

  expect() { # expect RULE MIN
    rule="$1"; got=$(printf '%s\n' "$out" | grep -c -- "$rule" || true)
    checks=$((checks + 1))
    if [ "$got" -ge "$2" ]; then
      printf '  ok   caught  %-28s (%s finding(s))\n' "$rule" "$got"
    else
      printf '  FAIL caught  %-28s expected >=%s, got %s\n' "$rule" "$2" "$got"; failed=$((failed + 1))
    fi
  }
  quiet() { # quiet LABEL FIXTURE-BASENAME -> must produce NO finding
    label="$1"; file="$2"
    got=$(printf '%s\n' "$out" | grep -c -- "selftest $file:" || true)
    checks=$((checks + 1))
    if [ "$got" -eq 0 ]; then
      printf '  ok   clean   %-28s (no finding)\n' "$label"
    else
      printf '  FAIL clean   %-28s %s finding(s)\n' "$label" "$got"; failed=$((failed + 1))
    fi
  }
  withheld() { # withheld LABEL VALUE -> the gate must never print a value
    label="$1"
    checks=$((checks + 1))
    if printf '%s\n' "$out" | grep -qF "$2"; then
      printf '  FAIL withheld %-27s VALUE LEAKED INTO OUTPUT\n' "$label"; failed=$((failed + 1))
    else
      printf '  ok   withheld %-28s (value never printed)\n' "$label"
    fi
  }
  invisible_to_tier1() { # LABEL VALUE -> Tier 1 must be structurally blind to it
    label="$1"
    checks=$((checks + 1))
    if git grep -q -F -- "$2" -- . 2>/dev/null; then
      printf '  FAIL tier1-blind %-26s value exists in the tree\n' "$label"; failed=$((failed + 1))
    else
      printf '  ok   tier1-blind %-28s (only shape/name can see it)\n' "$label"
    fi
  }

  echo "self-test: planted fakes MUST be caught"
  expect 'shape/telegram-bot-token' 1
  expect 'shape/openai-key' 1
  expect 'shape/github-pat' 1
  expect 'shape/jwt' 1
  expect 'shape/private-key' 1
  expect 'name/CONSUELA_ENCRYPTION_KEY' 1
  expect 'name/HERMES_API_KEY' 1
  expect 'name/apiKey' 1
  echo "self-test: the repo's real placeholder corpus MUST stay clean"
  quiet '<REDACTED-*> + .env.example' 'clean-env.example'
  quiet '<REDACTED-*>/markers/slugs'   'clean-redacted.env'
  echo "self-test: Tier 1 is structurally blind to these (that is the gap)"
  invisible_to_tier1 'telegram token' "$fake_tg"
  invisible_to_tier1 'sk- key'         "$fake_sk"
  invisible_to_tier1 'github PAT'      "$gh_pfx$gh_rest"
  echo "self-test: planted values MUST never be printed"
  withheld 'telegram token' "$fake_tg"
  withheld 'sk- key'         "$fake_sk"
  withheld 'base64 blob'     "$fake_b64"
  withheld 'jwt'             "$jwt_a$jwt_b"

  echo "self-test: $checks checks, $failed failed"
  [ "$failed" -eq 0 ]
}

# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "push-safe: run inside a git repo"; exit 2; }
cd "$REPO_ROOT" || exit 2
# locate the Home-ai dir whether we run from the submodule or the outer repo
if [ -f .env.local ]; then AI_DIR="."; else AI_DIR="Home-ai"; fi

SCAN_ALL=0
SCAN_NAS=0
SELF_TEST=0
for arg in "$@"; do
  case "$arg" in
    --all) SCAN_ALL=1 ;;
    --nas) SCAN_NAS=1 ;;
    --self-test) SELF_TEST=1 ;;
  esac
done

# ── prescan: one alternation of every Tier A shape + the Tier B name/value
# shape. git grep / grep / awk run it so only plausible lines are classified.
SHAPE_PRESCAN="$SHAPE_ANY|$SECRET_NAME_RE$SECRET_VALUE_TAIL|$SECRET_CODE_NAME_RE$SECRET_VALUE_TAIL"
export PUSHSAFE_PRESCAN="$SHAPE_PRESCAN"

if [ "$SELF_TEST" = 1 ]; then
  self_test
  exit $?
fi

[ -d "$AI_DIR" ] || { echo "push-safe: cannot find .env.local source dir"; exit 2; }
ps_findings_reset

# secret-ish key names whose VALUES must never be pushed (Tier 1)
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
# Tier 2 history scope is the commits that are actually going out. With --all it
# is the whole branch, which WILL flag the 2026-09-08 credential still sitting
# in pushed history — that is the point of a deep audit, and the fix is rotation,
# not a history rewrite. Without an upstream there is nothing to push yet, so
# only the tip tree and the index are scanned.
if [ "$SCAN_ALL" = 1 ]; then SHAPE_RANGE="$BRANCH"; elif [ -n "$UPSTREAM" ]; then SHAPE_RANGE="$UPSTREAM..HEAD"; else SHAPE_RANGE=""; fi

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

SHAPE_SCOPE="worktree | untracked | staged"
[ -n "$SHAPE_RANGE" ] && SHAPE_SCOPE="$SHAPE_SCOPE | added lines in $SHAPE_RANGE"
echo "push-safe: scanning shapes + secret names in: $SHAPE_SCOPE"
scan_tracked
scan_untracked
scan_staged
[ -n "$SHAPE_RANGE" ] && scan_history "$SHAPE_RANGE"
cat "$PS_FINDINGS"
SHAPE_HITS=$(wc -l < "$PS_FINDINGS" | tr -d ' ')
if [ "$SHAPE_HITS" -gt 0 ]; then LEAKS=$((LEAKS + SHAPE_HITS)); fi

if [ "$LEAKS" -gt 0 ]; then
  echo "push-safe: REFUSING — replace the values above with <REDACTED-NAME> placeholders,"
  echo "           keep real values in gitignored files (.env.local / NAS /tmp/new.env / runbook),"
  echo "           commit the redaction, re-run. If a hit is in already-pushed history: ROTATE."
  echo "           shape/<id> = that value has this credential format; name/<KEY> = that KEY"
  echo "           holds a literal that is not a documented placeholder."
  exit 1
fi
echo "push-safe: CLEAN — no secret values in the range, staged diff, or worktree. Safe to push."