# Hermes Gateway Layout (saved for Drogon)

## In a nutshell
We run **four Hermes gateway profiles** — `default` (Drogon), `consuela`, `finance` (Alex), and `rubio` — as separate API servers on unique ports, all under **one** s6-overlay container (`hermes-agent-2`). Every profile's LLM brain is the same: **OpenCode Go → `deepseek-v4-flash`** (provider `opencode-go`). The gateways speak HTTP API (OpenAI-compatible `/v1/chat/completions`) so the dashboard and other services can talk to them. **Never record a key/token value in this file — env-var NAMES only.**

## The environment
- **Host:** QNAP NAS (Container Station)
- **Container:** `nousresearch/hermes-agent:latest` with s6-overlay supervision, named `hermes-agent-2`
- **Version:** **v0.21.3 (2026.9.14)** — upgraded 2026-09-21 from v0.20.4 (image pull + container recreate)
- **Persistent volume:** `/share/Container/Hermes` → `/opt/data` inside the container (configs, profiles, `.env`, logs survive recreates)
- **Dashboard** → Consuela via `hermes-agent-2:8642` on the `familydashboard_consuela-net` Docker network
- **No git/docker in default QNAP PATH** — tools at `/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker`
- **Published ports:** `-p 8082:8082` and `-p 8642:9119` (host 8642 → the container's **9119 dashboard**). The per-profile API servers (8642/8643/8644/8646, see below) are **container-internal only** and reachable by DNS name + port across the shared Docker networks.

## Gateway Profiles, Ports & Model
| Profile | Gateway id | API port | Profile config |
|---------|-----------|----------|----------------|
| Default (**drogon**) | `gateway-default` | **8643** | `/opt/data/config.yaml` |
| **Consuela** (dashboard) | `gateway-consuela` | **8642** | `/opt/data/profiles/consuela/config.yaml` |
| Finance (**Alex**) | `gateway-finance` | **8644** | `/opt/data/profiles/finance/config.yaml` |
| **Rubio** | `gateway-rubio` | **8646** | `/opt/data/profiles/rubio/config.yaml` |

All four resolve to the same model block:
```yaml
model:
  provider: opencode-go
  default: deepseek-v4-flash
```
(No `base_url`/`api_key` in the block — the built-in provider pins its own relay and reads its key from env.)

## Provider keys (names only)
- `OPENCODE_GO_API_KEY` → OpenCode **Go** relay `https://opencode.ai/zen/go/v1` (the relay in use).
- `OPENCODE_ZEN_API_KEY` → OpenCode **Zen** relay `https://opencode.ai/zen/v1`.
- Each profile has its own `.env`: `/opt/data/.env` (default) and `/opt/data/profiles/<name>/.env`. The **same key value is set for `OPENCODE_GO_API_KEY` in all four profiles.**
- `API_SERVER_KEY` → bearer the API server requires. Present in `/opt/data/.env` and `/opt/data/profiles/finance/.env`; container-level env also carries it. Named profiles fail closed (API server won't start) if their scoped key is missing/&lt;16 chars.
- `API_SERVER_PORT` → see gotcha #1 — set in **each profile's own `.env`**.

## How to verify they're running
```sh
docker exec hermes-agent-2 hermes gateway list
```
All four should be green with PIDs:
```
✓ default (current)  — PID <n>
✓ consuela           — PID <n>
✓ finance            — PID <n>
✓ rubio              — PID <n>
```
```sh
curl localhost:8642/health   # consuela
curl localhost:8643/health   # drogon
curl localhost:8644/health   # alex
curl localhost:8646/health   # rubio
```
Each returns `{"status": "ok", "platform": "hermes-agent", "version": "0.21.3"}`.
Per-profile gateway logs: `docker exec hermes-agent-2 tail -f /opt/data/logs/gateways/<profile>/current` (rotated, persistent). Boot reconciler audit: `/opt/data/logs/container-boot.log`.

## Key configuration files
- **Default profile:** `/opt/data/config.yaml` + `/opt/data/.env`
- **Named profiles:** `/opt/data/profiles/{consuela,finance,rubio}/{config.yaml,.env}`
- **Cron jobs:** `/opt/data/cron/jobs.json` (default), `/opt/data/profiles/<name>/cron/jobs.json`
- **Gateway state (controls auto-start on container restart):** `/opt/data/gateway_state.json` + `/opt/data/profiles/<name>/gateway_state.json`

`hermes --profile <name> …` targets a named profile; plain `hermes …` targets `default`.

## Critical gotchas (do not forget)

### 1. API_SERVER_PORT precedence flipped in ≥0.21.x — a profile's own `.env` now WINS over `config.yaml`
In v0.20.4 the config key won (`ApiServerPlatform.__init__` read `platforms.api_server.extra.port` first, then the `API_SERVER_PORT` env var). On v0.21.3 the **profile `.env` `API_SERVER_PORT` is authoritative** — this silently re-shuffled the ports on upgrade (Consuela briefly took 8643, finance took 8642, and `default` went `fatal: Port 8642 already in use`, because the container-level `API_SERVER_PORT=8642` leaked into profiles that had no override).

**Rule:** set `API_SERVER_PORT` in **each profile's own `.env`** (never only at container level), and keep `platforms.api_server.extra.port` consistent for documentation:
```sh
hermes config set API_SERVER_PORT 8643                              # default/drogon
hermes --profile consuela config set API_SERVER_PORT 8642           # consuela (dashboard)
hermes --profile finance  config set API_SERVER_PORT 8644           # alex
hermes --profile rubio    config set API_SERVER_PORT 8646           # rubio
```
Verify the live binding from `gateway_state.json` → `api_server.listener_base` (v0.21.3 records it). Confirm Consuela is on **8642** — the dashboard depends on that exact port.

### 2. OpenCode Go needs an `x-opencode-session` header — only supported by newer builds
Both built-in OpenCode providers (`opencode-zen` → `/zen/v1`, `opencode-go` → `/zen/go/v1`) send a per-conversation `x-opencode-session` header. **v0.20.4 did NOT send it** → every Go call failed `HTTP 400 MissingSessionID`. v0.21.3 does. If a future downgrade/pin is ever needed, remember Go will not work below the version that added the header. (The interim workaround used on 0.20.4 — a named custom provider with a static `extra_headers: {x-opencode-session: …}` — was removed after the upgrade; do not reintroduce unless you actually downgrade.)

### 3. API server auth is profile-scoped
The API server authenticates `Authorization: Bearer <API_SERVER_KEY>`. On named profiles the expected key is resolved from **that profile's** secret scope (`get_secret("API_SERVER_KEY")`, min 16 chars); if it can't resolve, the API server **refuses to start**. The default profile falls back to the container-level env. Health is reachable without auth; `/v1/chat/completions` is not.

### 4. Telegram token lock
Telegram bot tokens are mutually exclusive — only **one** process may hold the lock at a time, at `/opt/data/.local/state/hermes/gateway-locks/telegram-bot-token-*.lock`. The **default gateway** holds it; other profiles report `telegram: fatal` ("already in use") which is fine (they don't need Telegram).

### 5. `_enabled_explicit` guard
When `telegram.enabled` is set explicitly in YAML, an internal `_enabled_explicit: true` flag is set and `_apply_env_overrides` won't re-enable Telegram even if `TELEGRAM_BOT_TOKEN` is present. That's why non-default profiles pin `telegram.enabled: false`.

### 6. `gateway_state.json` controls auto-start
At container boot `container_boot.py` reads each profile's `gateway_state.json`. `gateway_state: "running"` → the s6 slot auto-starts; anything else → a `down` file is touched and it stays stopped. All four are `running`, so they come back after a container restart / image upgrade.

### 7. Run scripts are ephemeral
`/run/service/gateway-*/run` live on tmpfs and are regenerated by `02-reconcile-profiles` on every container restart. Hand-edits (`export API_SERVER_PORT=…`, `unset TELEGRAM_BOT_TOKEN`) are **lost on restart**. Persist changes in the profile `.env`/`config.yaml` (persistent → `/opt/data/…`) or a custom `cont-init.d` script.

### 8. The container runs `sleep infinity` (not `gateway run`), supervised by s6
`docker run … nousresearch/hermes-agent:latest sleep infinity`. s6-overlay supervises `main-hermes` + the per-profile `gateway-<name>` slots. Attaching the interactive TUI to a container started without `-t` fails ("Input is not a terminal"); the current container has `Tty=false` and that only affects interactive TUI use — the gateways are unaffected.

## Upgrading Hermes (pull + recreate; data volume is preserved)
The image is stateless; `/opt/data` holds all state. Hermes runs non-interactive config migrations on first boot of the new image (timestamped backups land next to `config.yaml`/`.env`).

```sh
export PATH=/share/CACHEDEV1_DATA/.qpkg/container-station/bin:$PATH
# 0) Back up the persistent configs (host-side copy of the bind mount)
TS=$(date +%Y%m%d-%H%M%S); BK=/share/Container/hermes-backup-$TS; mkdir -p $BK
cp -p /share/Container/Hermes/config.yaml /share/Container/Hermes/.env $BK/
# 1) Pull + recreate (keep a rollback twin)
docker pull nousresearch/hermes-agent:latest
docker rm -f hermes-agent-2-old >/dev/null 2>&1 || true
docker stop hermes-agent-2 && docker rename hermes-agent-2 hermes-agent-2-old
# 2) Capture user env to an env-file FIRST (never hand-type; see DEPLOY gotcha #10 in the dashboard repo)
docker inspect hermes-agent-2-old --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E '^(API_SERVER_ENABLED|API_SERVER_KEY|TELEGRAM_BOT_TOKEN|API_SERVER_HOST|API_SERVER_PORT)=' > /tmp/hermes-recreate.env
chmod 600 /tmp/hermes-recreate.env
# 3) Run the new container with the SAME mounts/networks/ports
docker run -d --name hermes-agent-2 --restart unless-stopped \
  --env-file /tmp/hermes-recreate.env \
  -p 8082:8082 -p 8642:9119 \
  -v /share/Container/Workspace:/workspace \
  -v /share/Container:/hermes-data \
  -v /share/Container:/openclaw-backup \
  -v /share/Container/Hermes:/opt/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  nousresearch/hermes-agent:latest sleep infinity
docker network connect familydashboard_consuela-net hermes-agent-2
docker network connect media-stack_default hermes-agent-2
# 4) Verify after ~1 min
docker exec hermes-agent-2 hermes gateway list      # all four green
docker exec -u hermes hermes-agent-2 hermes --version
```
Rollback: stop/rm the new container, `docker rename hermes-agent-2-old hermes-agent-2`, `docker start hermes-agent-2`.

## Model / provider changes (per profile)
Model is per-profile. Set it with the profile flag, then restart that gateway (or the container):
```sh
hermes [-p <profile>] config set model.provider opencode-go
hermes [-p <profile>] config set model.default deepseek-v4-flash
hermes [-p <profile>] config unset model.base_url model.api_key_env model.api_key   # one key at a time
hermes [-p <profile>] gateway restart
```
Switch a profile's brain by changing `model.provider`/`model.default`; the fallback chain lives in `fallback_providers` (leave it or edit per profile).

## If container restarts
1. `gateway_state.json: "running"` → all four slots auto-start ✅
2. Profile `.env`/`config.yaml` changes survive (persistent) ✅
3. Run-script edits are reverted by `02-reconcile-profiles` ⚠️
4. Default profile re-grabs the Telegram lock; the others stay `fatal`/telegram — expected ✅
5. `API_SERVER_PORT` is read from each profile's `.env` (gotcha #1) — keep them distinct ⚠️

## Tested (2026-09-21, v0.21.3)
- `hermes gateway list` → all four green
- `curl :8642|:8643|:8644|:8646/health` → `{"status":"ok",...,"version":"0.21.3"}`
- `api_server` state `connected` on all four; `listener_base` = consuela 8642, default 8643, finance 8644, rubio 8646
- One-shot chat (`hermes -z "…ok"`) → `ok` on **all four** profiles (native `opencode-go` / `deepseek-v4-flash`)
- Consuela `:8642` `/v1/chat/completions` via API → `ok` (dashboard path)
- `docker ps` → `0.0.0.0:8082->8082/tcp, 0.0.0.0:8642->9119/tcp`
