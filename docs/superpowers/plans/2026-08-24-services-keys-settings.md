# Services & Keys Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Ship the approved "Services & Keys" design (spec 2026-08-24) — PB-backed encrypted service registry, resolver-based config reads, Settings UI with per-service tests, localStorage migration, HA bridge reconnect.

**Architecture:** `consuela_service_config` PB collection (LOCKED rules, secrets AES-256-GCM via shared secret-box keyed by CONSUELA_ENCRYPTION_KEY). Code-defined registry whitelist. Resolver precedence PB → env → null, per-request. Session-gated routes; mutations adults-only. Boot-critical six hard-excluded.

**Tech Stack:** existing crypto helpers, withAdmin, authorizeAdminRequest, SectionCard UI patterns.

## Global Constraints

- No new npm dependencies.
- Boot-critical six (SESSION_SECRET, ADMIN_SECRET, CRON_SECRET, PB_ADMIN_EMAIL/PASS, NEXT_PUBLIC_PB_URL, CONSUELA_ENCRYPTION_KEY) are NEVER registry-configurable — registry rejects them.
- GET responses never contain secret values (max 2-char suffix hint).
- Full suite stays green (baseline 510); typecheck clean every task; commit each task.

---

### Task 1: Plumbing — compose passthroughs + .env.example

**Files:** Modify `docker-compose.yml`, `.env.example`; Modify outer repo `/Users/garciafam/Documents/Dashboard/docker-compose.yml`.
- [ ] Home-ai compose: `- TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}`; add `${VAR:-}` lines for HA_HOST, HA_TOKEN, MQTT_BROKER, MQTT_USER, MQTT_PASS, HA_GROCERY_TODO_NAME, TELEGRAM_ALERT_CHAT_ID, GMAIL_USER, GMAIL_APP_PASSWORD, INSTACART_API_KEY. Remove `GOOGLE_POLL_INTERVAL_MS` line and empty `- OPENROUTER_API_KEY=` literal.
- [ ] Outer compose: add same passthrough set under home-dashboard environment (it has none of them today).
- [ ] .env.example: append GMAIL_USER/GMAIL_APP_PASSWORD/TELEGRAM_ALERT_CHAT_ID/INSTACART_API_KEY with comments; remove GOOGLE_POLL_INTERVAL_MS + OPENROUTER lines if present.
- [ ] Validate both composes parse (js-yaml). Commit: `chore(config): pass integration env through Docker; complete .env.example`

### Task 2: secret-box extraction

**Files:** Create `src/lib/secret-box.ts`; Modify `src/lib/google/encryption.ts`; Test `tests/unit/secret-box.test.ts`.
- [ ] RED: roundtrip(encrypt→decrypt), tamper-ciphertext→null, wrong-key→null, missing CONSUELA_ENCRYPTION_KEY→encrypt throws / decrypt returns null.
- [ ] GREEN: move AES-256-GCM core (versioned payload `v1.<iv>.<tag>.<ct>` base64 as in google/encryption.ts) into exported `encryptSecret(plain): string` / `decryptSecret(payload): string | null`; google/encryption.ts re-exports/wraps it — its public API and existing google token tests unchanged.
- [ ] Commit: `refactor(crypto): shared secret-box (AES-256-GCM) extracted from google encryption`

### Task 3: Registry manifest + PB collection

**Files:** Create `src/lib/services/registry.ts`; Modify `src/lib/pb-seed.ts`; Test `tests/unit/services-registry.test.ts`.
- [ ] Registry exactly per spec §Registry (11 services, fields with `{key,label,secret,required,helpText,placeholder?}`, testFn ids, BOOT_EXCLUDED set). Export types `ServiceId`, `ServiceFieldDef`, `SERVICES_REGISTRY`, `isRegistryPair(service,key)`, `isSecretPair(service,key)`.
- [ ] pb-seed: add `consuela_service_config` collection (fields service/key/value/is_secret/updated_at/updated_by; unique index on service+key following the seed's SQL-string index pattern) with LOCKED_RULES; add to lockdown test's expectation list if it enumerates collections.
- [ ] Tests: whitelist accepts listed pairs, rejects unknown + all six boot-excluded names even if someone adds them to a collection literal; field defs complete (every secret flag correct per spec).
- [ ] Commit: `feat(services): registry manifest + consuela_service_config collection`

### Task 4: Config resolver

**Files:** Create `src/lib/services/config.ts`; Test `tests/unit/services-config-resolver.test.ts`.
- [ ] `getServiceConfig(service,key): Promise<string|null>` — withAdmin read consuela_service_config (decrypt when is_secret via secret-box) → else process.env fallback → null; `getServiceStatus(service)` helper returning per-field {configured, source}. Mock withAdmin + env stubs; cover decrypt path, plaintext path, env fallback, both-missing null, corrupt ciphertext → falls back to env (log once).
- [ ] Commit: `feat(services): config resolver (PB override → env fallback)`

### Task 5: Config routes (GET/PUT/DELETE)

**Files:** Create `src/app/api/services/config/route.ts`; Test `tests/unit/services-config-routes.test.ts`.
- [ ] GET: session required (middleware covers; route still 401s without cookie via verifySession for defense) → `{services:[{id,label,status:{configured,source},fields:[{key,label,secret,required,set,source,preview?}]}]}`; preview = last 2 chars only for set secrets; never includes values.
- [ ] PUT: authorizeAdminRequest (401 anon / 403 child adult_only); validate isRegistryPair + value string ≤ 2000 chars; upsert withAdmin (encrypt 🔒, updated_by=session.name or "admin-secret"); unknown/excluded → 400 invalid_service_key.
- [ ] DELETE: same gate; delete row → 200; absent row → 200 idempotent.
- [ ] Tests mock @/lib/pb-auth withAdmin + @/lib/admin-auth where appropriate (pattern: admin-routes.test.ts); sign real session cookies for role cases (pattern: auth-routes.test.ts).
- [ ] Commit: `feat(services): config CRUD routes with masking + adult gate`

### Task 6: Per-service test functions

**Files:** Create `src/lib/services/tests.ts`; Route `POST /api/services/test/route.ts`; Test `tests/unit/services-test-fns.test.ts`.
- [ ] `runServiceTest(service): Promise<{ok:boolean;detail:string;ms:number}>` switch on registry testFn id: ha (GET {HA_HOST}/api/ 5s timeout, expect json w/ token ok false acceptable = reachable), telegram_alert+mirror (api.telegram.org/bot<tok>/getMe), gmail (nodemailer createTransport.verify() guarded try), hermes (GET {url}/health or / 5s), instacart (existing connect ping shape from old /api/connections logic), themealdb (search?q=x ping), composio/greenlight/khan (GET provider base w/ key header, accept any HTTP response <500 as reachable). All fetches use AbortSignal.timeout(5000). Unset required creds → {ok:false,detail:"not_configured"} fast.
- [ ] Route: session-gated; body {service}; unknown → 400. Tests mock global fetch/nodemailer; assert URL shapes + not_configured short-circuit + timeout usage.
- [ ] Commit: `feat(services): per-service health test functions + route`

### Task 7: Import + runtime routes

**Files:** `POST /api/services/import/route.ts`; `GET /api/services/runtime/route.ts`; Tests appended to services route tests file(s).
- [ ] import: adults-only; body `{entries:[{service,key,value}]}` — validate each against registry; encrypt secrets; bulk upsert; respond {imported:n,rejected:[{service,key,reason}]}. Legacy mapping doc: instacart_key→instacart INSTACART_API_KEY; composio entries→composio COMPOSIO_API_KEY only when service==="composio" (per-widget legacy keys map to the single hub key if present, else rejected); ha url/token → home_assistant HA_HOST/HA_TOKEN; greenlight/khan map directly.
- [ ] runtime: session-gated; returns `{weather:{LAT,LON}}` from resolver/env fallback only for non-secret registry fields flagged `publicRuntime` in registry (add flag to weather_location LAT/LON).
- [ ] Commit: `feat(services): legacy import + runtime non-secret endpoint`

### Task 8: Consumer migrations

**Files:** Modify src/lib/ha/config.ts (+mqtt/client.ts passthrough), src/lib/free-communication.ts (sendTelegramMessage token + gmail transport build), src/lib/telegram/get-updates.ts, src/app/api/hermes/chat/route.ts (HERMES_URL/KEY resolve; DELETE hardcoded "consuela-api-key-2026" default), src/lib/instacart.ts, src/lib/themealdb.ts, WeatherWidget/FogBackground/AdultHome lat-lon literals → fetch `/api/services/runtime` once (small hook `useRuntimeConfig` in hooks dir).
- [ ] Each consumer: replace direct process.env read with `await getServiceConfig(...)` keeping exact fallback order (env stays fallback so existing deployments unchanged). Make previously-sync reads async where required by callers (check each call site; hermes route already async; free-communication functions already async).
- [ ] Update affected unit tests (ha-config, themealdb, etc.) to stub the resolver OR keep env-fallback behavior tests valid (resolver reads env when DB empty — most existing env-stub tests remain valid IF getServiceConfig is called with env fallback; where tests assert module-level consts, adapt minimally).
- [ ] Grep proof in report: zero remaining direct reads for migrated keys outside resolver.
- [ ] Commit: `refactor(services): integrations read config via resolver`

### Task 9: HA bridge reconnect

**Files:** Modify src/lib/ha/websocket-client.ts + src/lib/ha/bridge.ts (export `resetHABridge()` stopping ws/mqtt + clearing started guard so next instrumentation tick reconnects using fresh config — mirror existing close()/started patterns); Route POST /api/services/home-assistant/reconnect (adults gate; call reset; schedule immediate restartHABridge() instead of waiting for tick); Test: bridge reset clears started + client closed (mock ws client).
- [ ] Commit: `feat(ha): bridge reconnect endpoint for credential changes`

### Task 10: Settings UI + legacy stack removal

**Files:** Create `src/components/settings/ServicesKeysCard.tsx`; Modify src/app/settings/page.tsx (render card top of Integrations for non-child; import banner state); Delete src/components/settings/ConnectionManager.tsx (if exists), src/lib/connections/store.ts, src/app/api/connections/route.ts; Test `tests/unit/services-keys-ui.test.tsx` (jsdom, pattern ha-settings-ui.test.tsx).
- [ ] Card: rows per registry service (status dot 🟢tested/🟡configured/🔴unset + source chip), expand → fields (secret=password input with •••hint placeholder), Save per service (PUT changed fields), Test button (POST test → dot update + detail line), Clear-override per overridden field, Reconnect button on home_assistant row, Import banner when localStorage consuela-connections exists → POST import → remove key.
- [ ] Child role: card hidden (useAuth role check, same as House nav).
- [ ] UI tests render card with mocked fetch: masking shown, save calls PUT payload shape, test updates status, banner imports+clears storage.
- [ ] Commit: `feat(settings): Services & Keys card; remove legacy connections stack`

### Task 11: Docs

AGENTS.md snapshot line + Change Log entry; note deploy ordering (compose vars optional now; seed unchanged). Commit: `docs: Services & Keys settings phase`
