# Hermes Migration Guide: OpenClaw → Hermes (Zero Data Loss)

**Date**: 2026-05-15  
**Purpose**: Complete technical migration from OpenClaw bridge architecture to standalone Hermes container with direct OpenRouter integration.  
**Goal**: Zero data loss. Full continuity of memory bank, agent state, PocketBase volumes, OpenRouter mappings, Family Dashboard connectivity.

## Prerequisites

- Docker + Docker Compose v2 installed
- Bun runtime (`bun --version`)
- Access to all source files listed in explore phase
- Git repo clean (`git status`)
- `.env.local` backed up (contains `OPENROUTER_API_KEY`, `NEXT_PUBLIC_*` vars)
- Current running state: `docker ps` shows `pocketbase`, `consuela-dashboard`, `consuela-bridge`
- Read all memory bank files: `.kilocode/rules/memory-bank/*`

## 1. Containerization and Decommissioning Strategy

### Step 1.1: Build Standalone Hermes Container

Create `Dockerfile.hermes` (new file):

```dockerfile
FROM node:20-alpine
WORKDIR /app

# Copy Hermes source (assumes Hermes repo cloned at ./hermes or mounted)
COPY package*.json ./
RUN bun install --frozen-lockfile

COPY . .
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["bun", "start"]
```

Update `docker-compose.yml`:

```yaml
version: "3.8"

services:
  pocketbase:
    image: ghcr.io/muchobien/pocketbase:latest
    container_name: pocketbase
    restart: unless-stopped
    environment:
      - PB_ENCRYPTION_KEY=my_secure_encryption_key_consuela
    ports:
      - "8091:8090"
    volumes:
      - ./pb_data:/pb_data
    networks:
      - family-net

  dashboard:
    build:
      context: .
      args:
        - NEXT_PUBLIC_PB_URL=http://192.168.0.27:8091
        - NEXT_PUBLIC_HERMES_URL=http://192.168.0.27:8080
    container_name: consuela-dashboard
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_PB_URL=http://192.168.0.27:8091
      - NEXT_PUBLIC_HERMES_URL=http://192.168.0.27:8080
    depends_on:
      - pocketbase
      - hermes
    networks:
      - family-net
      - media-stack_default

  hermes:
    build:
      context: ./hermes   # or use pre-built image: ghcr.io/kilo-org/hermes:latest
      dockerfile: Dockerfile
    container_name: hermes
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
      - HERMES_PORT=8080
      - MEMORY_BANK_PATH=/app/.kilocode/rules/memory-bank
    volumes:
      - ./.kilocode/rules/memory-bank:/app/.kilocode/rules/memory-bank:ro
      - ./.kilo:/app/.kilo:ro
      - ./pb_data:/app/pb_data:ro   # read-only for context
    networks:
      - family-net
      - media-stack_default

networks:
  family-net:
    driver: bridge
  media-stack_default:
    external: true
```

### Step 1.2: Graceful OpenClaw Disable

1. Stop bridge:
   ```bash
   docker compose stop bridge
   docker compose rm -f bridge
   ```

2. Update environment (`.env.local` and `docker-compose.yml`):
   - Remove `NEXT_PUBLIC_OPENCLAW_BRIDGE_URL`
   - Add `NEXT_PUBLIC_HERMES_URL=http://192.168.0.27:8080`

3. Backup OpenClaw state (if any local files):
   ```bash
   mkdir -p backups/openclaw-$(date +%Y%m%d)
   cp -r .kilocode/rules/memory-bank backups/openclaw-$(date +%Y%m%d)/
   cp -r .kilo backups/openclaw-$(date +%Y%m%d)/
   ```

## 2. Data Integrity and State Migration

### Step 2.1: Memory Bank Transfer

```bash
# Ensure target paths exist in Hermes container
docker compose exec hermes mkdir -p /app/.kilocode/rules/memory-bank

# Copy all memory bank files (zero loss)
docker cp .kilocode/rules/memory-bank/. hermes:/app/.kilocode/rules/memory-bank/

# Verify
docker compose exec hermes ls -la /app/.kilocode/rules/memory-bank/
```

### Step 2.2: Agent State Migration (`.kilo/*`)

```bash
docker cp .kilo/. hermes:/app/.kilo/
docker compose exec hermes ls /app/.kilo/
```

### Step 2.3: PocketBase Volume Preservation

`pb_data` is already mounted read-only in Hermes. No copy needed. Hermes reads context via Drizzle queries.

### Step 2.4: OpenRouter Model Mappings

In Hermes config (or `.env`):

```env
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet
OPENROUTER_FALLBACK=google/gemini-pro
```

Remove all OpenClaw-specific auth/bridge routing. Hermes calls OpenRouter directly using stored `OPENROUTER_API_KEY`.

### Step 2.5: Long-term DBs

PocketBase (`pb_data`) and Drizzle SQLite remain authoritative. Hermes only consumes read replicas.

## 3. System Integration and Reconfiguration

### Step 3.1: Refactor OpenClawDrive → HermesAgent

Rename file: `src/components/ui/OpenClawDrive.tsx` → `src/components/ui/HermesAgent.tsx`

Replace WebSocket bridge logic with direct Hermes HTTP/WebSocket:

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function HermesAgent() {
  const router = useRouter();

  useEffect(() => {
    const hermesUrl = process.env.NEXT_PUBLIC_HERMES_URL || "http://localhost:8080";
    // Future: connect to Hermes WebSocket for real-time drive commands
    console.log("Hermes Agent initialized at", hermesUrl);
    // Placeholder for future drive/control events
    return () => {};
  }, [router]);

  return null;
}
```

### Step 3.2: Update providers.tsx

```tsx
import HermesAgent from "@/components/ui/HermesAgent";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      <HermesAgent />
      <ToastProvider>{children}</ToastProvider>
    </>
  );
}
```

### Step 3.3: Update chat/page.tsx

Replace bridge calls:

```ts
const hermesBase = process.env.NEXT_PUBLIC_HERMES_URL || "http://192.168.0.27:8080";
const res = await fetch(`${hermesBase}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: text }),
});
```

Remove all `NEXT_PUBLIC_OPENCLAW_BRIDGE_URL` references.

### Step 3.4: Environment & Network Updates

- `docker-compose.yml`: replace bridge service with hermes service
- All `NEXT_PUBLIC_*` vars updated in dashboard build args and runtime env
- Networks unchanged (`family-net` + external `media-stack_default`)

## 4. Validation and Verification

### Post-Migration Checklist

**Uptime**
- [ ] `docker compose ps` shows hermes, dashboard, pocketbase healthy
- [ ] `curl http://localhost:8080/health` returns 200
- [ ] Dashboard loads at http://localhost:3000

**Data Integrity**
- [ ] Memory bank files present and identical (`diff -r`)
- [ ] Agent state (`.kilo/agent-manager.json`) intact
- [ ] `pb_data` volume mounted and readable
- [ ] Chat history preserved in PocketBase

**Model/API Functionality**
- [ ] Hermes responds to `/api/chat` with OpenRouter model
- [ ] Model routing correct (no OpenClaw fallback)
- [ ] Streaming responses work in chat UI

**Dashboard Comms**
- [ ] HermesAgent component mounts without error
- [ ] Real-time drive commands (future) received
- [ ] All pages render using real DB data

### Rollback Plan

1. Stop hermes: `docker compose stop hermes`
2. Restore bridge service in docker-compose.yml
3. Revert env vars to `NEXT_PUBLIC_OPENCLAW_BRIDGE_URL`
4. Restart bridge: `docker compose up -d bridge`
5. Restore any overwritten files from `backups/openclaw-*`

### Telegram Notifications (Optional)

Set these in the hermes service environment in docker-compose.yml:

```yaml
environment:
  - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
  - TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}
```

After successful validation checklist, send completion notification:

```bash
curl -X POST http://localhost:3000/api/telegram \
  -H "Content-Type: application/json" \
  -d '{"chatId": "'"$TELEGRAM_CHAT_ID"'", "message": "✅ Hermes migration complete. All systems validated. Zero data loss."}'
```

### Commit & Push Steps (per development.md)

```bash
bun typecheck
bun lint
git add -A
git commit -m "feat: migrate from OpenClaw bridge to standalone Hermes container (zero data loss)"
git push
```

**End of Guide** — Execute in order. All steps preserve 100% of existing data and state.