# Hermes Agent Deployment & Data Restoration Guide

**Version**: 1.0  
**Date**: 2026-05-16  
**Target**: NAS (QNAP) deployment at 192.168.0.27  
**Purpose**: Deploy standalone Hermes agent container with full data restoration from OpenClaw backup.

---

## 1. Prerequisites

- **SSH access** to the NAS: `admin@192.168.0.27`
- **Docker** + **Docker Compose v2** installed on NAS
  - QNAP Container Station path: `/share/CACHEDEV1_DATA/.qpkg/container-station/bin`
- **Hermes source code** placed in `./hermes/` directory
- **NAS backup archive** at:
  `/share/CACHEDEV1_DATA/homes/admin/hermes-migration-20260515/openclaw-full.tar.gz`
- **PocketBase** running (or deployed alongside via `docker-compose.hermes.yml`)

### Required Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | OpenRouter API key | **required, no default** |
| `TELEGRAM_CHAT_ID` | Telegram chat ID for notifications | `-1001234567890` |

---

## 2. Clone / Place Hermes Source Code

On your development machine, clone the Hermes repository into the `./hermes/` directory:

```bash
# From the project root (/share/CACHEDEV1_DATA/homes/admin/Home-ai/ or equivalent)
git clone <hermes-repo-url> ./hermes

# Or copy existing Hermes source
cp -r /path/to/hermes-source ./hermes
```

Expected structure after placement:

```
.
├── docker-compose.hermes.yml
├── Dockerfile.hermes
├── hermes/
│   ├── package.json
│   ├── bun.lock
│   ├── src/
│   └── ...
├── pb_data/
├── pb_public/
└── docs/
```

---

## 3. SSH to NAS

```bash
ssh admin@192.168.0.27
```

Default password (if unchanged): prompt at first login. Use SSH key auth if configured.

---

## 4. Export Docker PATH

Container Station stores Docker binaries in a non-standard location. Export the PATH:

```bash
export PATH=$PATH:/share/CACHEDEV1_DATA/.qpkg/container-station/bin
```

Verify:

```bash
docker --version
docker compose version
```

---

## 5. Copy Compose File to NAS

From your local machine (or directly on NAS if cloning the repo there):

```bash
# On NAS, if repo is already cloned:
cd /share/CACHEDEV1_DATA/homes/admin/Home-ai

# Copy the compose file and Dockerfile into place
# (They should already be present if repo is cloned)
ls -la docker-compose.hermes.yml Dockerfile.hermes
```

If transferring from local machine:

```bash
scp docker-compose.hermes.yml admin@192.168.0.27:/share/CACHEDEV1_DATA/homes/admin/Home-ai/
scp Dockerfile.hermes admin@192.168.0.27:/share/CACHEDEV1_DATA/homes/admin/Home-ai/
```

---

## 6. Build the Image

```bash
cd /share/CACHEDEV1_DATA/homes/admin/Home-ai
export PATH=$PATH:/share/CACHEDEV1_DATA/.qpkg/container-station/bin
docker compose -f docker-compose.hermes.yml build
```

This builds the Hermes image using `./hermes/` as the build context and `Dockerfile.hermes`.

---

## 7. Deploy the Container

```bash
export OPENROUTER_API_KEY=sk-or-v1-your-key-here
docker compose -f docker-compose.hermes.yml up -d
```

Verify the container is running:

```bash
docker compose -f docker-compose.hermes.yml ps

# Check health endpoint
curl http://localhost:8080/health

# View logs
docker compose -f docker-compose.hermes.yml logs hermes
```

---

## 8. Data Restoration from Backup

### 8.1. Verify Backup Archive is Mounted

```bash
docker compose -f docker-compose.hermes.yml exec hermes ls -la /backups/
```

Expected output:

```
-r--r--r--    1 root     root      <size> <date> openclaw-backup.tar.gz
```

If the backup is not mounted, check that the NAS path exists:

```bash
ls -la /share/CACHEDEV1_DATA/homes/admin/hermes-migration-20260515/openclaw-full.tar.gz
```

### 8.2. Extract Backup into hermes_data Volume

```bash
# Create extraction directory
docker compose -f docker-compose.hermes.yml exec hermes mkdir -p /tmp/restore

# Extract the backup archive
docker compose -f docker-compose.hermes.yml exec hermes \
  tar -xzf /backups/openclaw-backup.tar.gz -C /tmp/restore

# List extracted contents
docker compose -f docker-compose.hermes.yml exec hermes \
  ls -la /tmp/restore
```

### 8.3. Restore Memory Bank (Workspace Context)

```bash
# Create memory bank directory
docker compose -f docker-compose.hermes.yml exec hermes \
  mkdir -p /app/data/.kilocode/rules/memory-bank

# Copy memory bank files from backup
docker compose -f docker-compose.hermes.yml exec hermes \
  cp -r /tmp/restore/.kilocode/rules/memory-bank/* /app/data/.kilocode/rules/memory-bank/

# Verify
docker compose -f docker-compose.hermes.yml exec hermes \
  ls -la /app/data/.kilocode/rules/memory-bank/
```

### 8.4. Restore Agent Identity & State (.kilo/)

```bash
# Create .kilo directory
docker compose -f docker-compose.hermes.yml exec hermes \
  mkdir -p /app/data/.kilo

# Copy agent state files from backup
docker compose -f docker-compose.hermes.yml exec hermes \
  cp -r /tmp/restore/.kilo/* /app/data/.kilo/ 2>/dev/null || echo "No .kilo in backup"

# Verify
docker compose -f docker-compose.hermes.yml exec hermes \
  ls -la /app/data/.kilo/
```

### 8.5. Restore Hermes Config

```bash
# Copy configuration files if present in backup
docker compose -f docker-compose.hermes.yml exec hermes \
  cp -r /tmp/restore/.env* /app/data/ 2>/dev/null || echo "No .env in backup"

docker compose -f docker-compose.hermes.yml exec hermes \
  cp -r /tmp/restore/config* /app/data/ 2>/dev/null || echo "No config in backup"
```

### 8.6. Restore Tasks Database

```bash
# Copy any SQLite/migration files
docker compose -f docker-compose.hermes.yml exec hermes \
  cp -r /tmp/restore/*.db /app/data/ 2>/dev/null || echo "No .db files in backup"

docker compose -f docker-compose.hermes.yml exec hermes \
  cp -r /tmp/restore/*.sqlite /app/data/ 2>/dev/null || echo "No .sqlite files in backup"
```

### 8.7. Clean Up Temporary Files

```bash
docker compose -f docker-compose.hermes.yml exec hermes \
  rm -rf /tmp/restore
```

### 8.8. Verify Restoration

```bash
# Check memory bank integrity
docker compose -f docker-compose.hermes.yml exec hermes \
  ls -la /app/data/.kilocode/rules/memory-bank/

# Check agent state
docker compose -f docker-compose.hermes.yml exec hermes \
  ls -la /app/data/.kilo/

# Check overall data directory
docker compose -f docker-compose.hermes.yml exec hermes \
  ls -la /app/data/

# Restart Hermes to pick up restored data
docker compose -f docker-compose.hermes.yml restart hermes

# Verify health after restart
curl http://localhost:8080/health
```

---

## 9. Migration Checklist

### Uptime & Connectivity

- [ ] `docker compose -f docker-compose.hermes.yml ps` shows all services healthy
- [ ] `curl http://localhost:8080/health` returns HTTP 200
- [ ] `curl http://localhost:8090/api/health` (PocketBase) returns OK
- [ ] Hermes responds to API requests

### Data Integrity

- [ ] Memory bank files present in `/app/data/.kilocode/rules/memory-bank/`
- [ ] Agent state files present in `/app/data/.kilo/`
- [ ] Backup archive mounted at `/backups/openclaw-backup.tar.gz`
- [ ] All `.md` files in memory bank are readable and non-empty
- [ ] Chat/task history preserved

### Model & API Functionality

- [ ] OpenRouter primary model responds (`anthropic/claude-3.5-sonnet`)
- [ ] OpenRouter fallback model responds (`google/gemini-2.0-flash-001`)
- [ ] Telegram bot sends test notification
- [ ] Ollama fallback responds (`http://192.168.0.12:11434`)
- [ ] Gateway authentication token accepted (`openclaw-key-998877-aBcDeFgHiJkLmNoPqRsTuVwXyZ`)

### Persistence

- [ ] Container restart preserves all data
- [ ] Docker host restart preserves all data
- [ ] `hermes_data` volume exists and contains restored files

---

## 10. Rollback Plan

### Stop Hermes

```bash
export PATH=$PATH:/share/CACHEDEV1_DATA/.qpkg/container-station/bin
cd /share/CACHEDEV1_DATA/homes/admin/Home-ai
docker compose -f docker-compose.hermes.yml down
```

### Restore Previous Bridge Architecture

1. Restore `docker-compose.yml` from backup (or revert git changes):

```bash
git checkout -- docker-compose.yml
```

2. Restore environment variables:

```bash
# Restore NEXT_PUBLIC_OPENCLAW_BRIDGE_URL in .env.local
# Remove NEXT_PUBLIC_HERMES_URL references
```

3. Start the original bridge:

```bash
docker compose up -d bridge
```

4. Verify bridge reconnects to OpenClaw:

```bash
docker compose logs bridge
```

### Full State Recovery (if needed)

If Hermes data is corrupted:

```bash
# Destroy the hermes_data volume
docker compose -f docker-compose.hermes.yml down -v

# Re-create the volume and re-deploy
docker compose -f docker-compose.hermes.yml up -d

# Re-run data restoration steps from Section 8
```

### Revert to Git

```bash
git reset --hard HEAD~1
git push --force-with-lease
```

---

## Appendix A: Quick-Reference Commands

| Action | Command |
|--------|---------|
| SSH to NAS | `ssh admin@192.168.0.27` |
| Export Docker PATH | `export PATH=$PATH:/share/CACHEDEV1_DATA/.qpkg/container-station/bin` |
| Build Hermes | `docker compose -f docker-compose.hermes.yml build` |
| Deploy Hermes | `docker compose -f docker-compose.hermes.yml up -d` |
| Stop Hermes | `docker compose -f docker-compose.hermes.yml down` |
| View logs | `docker compose -f docker-compose.hermes.yml logs -f hermes` |
| Restart Hermes | `docker compose -f docker-compose.hermes.yml restart hermes` |
| Check health | `curl http://localhost:8080/health` |
| Exec into container | `docker compose -f docker-compose.hermes.yml exec hermes sh` |
| Destroy volume | `docker compose -f docker-compose.hermes.yml down -v` |

## Appendix B: Hermes Environment Reference

| Variable | Value | Purpose |
|----------|-------|---------|
| `OPENROUTER_API_KEY` | (set via env) | OpenRouter authentication |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter API endpoint |
| `OPENROUTER_MODEL` | `anthropic/claude-3.5-sonnet` | Primary chat model |
| `OPENROUTER_FALLBACK_MODEL` | `google/gemini-2.0-flash-001` | Fallback model |
| `TELEGRAM_BOT_TOKEN` | `8752546510:AAE523dDchdKnhgSaQqlWSR1GBiyLkHQJ4I` | Telegram bot auth |
| `TELEGRAM_CHAT_ID` | (set via env) | Target chat for notifications |
| `OLLAMA_URL` | `http://192.168.0.12:11434` | Local Ollama server |
| `OLLAMA_MODEL` | `llama3.2:latest` | Default Ollama model |
| `GATEWAY_TOKEN` | `openclaw-key-998877-aBcDeFgHiJkLmNoPqRsTuVwXyZ` | Inter-agent auth token |
| `HERMES_PORT` | `8080` | HTTP server port |
| `MEMORY_BANK_PATH` | `/app/data/.kilocode/rules/memory-bank` | Memory bank location |
| `KILO_CONFIG_PATH` | `/app/data/.kilo` | Kilo agent config location |
| `NODE_ENV` | `production` | Runtime environment |

## Appendix C: OpenRouter Models Available for Routing

| Variable | Model ID |
|----------|----------|
| `MODEL_ANTHROPIC_CLAUDE_OPUS` | `anthropic/claude-3-opus:beta` |
| `MODEL_ANTHROPIC_CLAUDE_SONNET` | `anthropic/claude-3.5-sonnet` |
| `MODEL_ANTHROPIC_CLAUDE_HAIKU` | `anthropic/claude-3.5-haiku` |
| `MODEL_OPENAI_GPT4O` | `openai/gpt-4o` |
| `MODEL_OPENAI_GPT4O_MINI` | `openai/gpt-4o-mini` |
| `MODEL_OPENAI_O1` | `openai/o1-preview` |
| `MODEL_OPENAI_O3_MINI` | `openai/o3-mini` |
| `MODEL_GOOGLE_GEMINI_FLASH` | `google/gemini-2.0-flash-001` |
| `MODEL_GOOGLE_GEMINI_PRO` | `google/gemini-2.0-pro-exp-02-05` |
| `MODEL_MISTRAL_MIXTRAL` | `mistralai/mixtral-8x22b-instruct` |
| `MODEL_MISTRAL_CODESTRAL` | `mistralai/codestral-2501` |
| `MODEL_META_LLAMA` | `meta-llama/llama-3.3-70b-instruct` |
| `MODEL_DEEPSEEK_CHAT` | `deepseek/deepseek-chat` |
| `MODEL_QWEN_QWQ` | `qwen/qwq-32b-preview` |