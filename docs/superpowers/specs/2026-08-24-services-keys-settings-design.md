# Services & Keys Settings Design

**Date:** 2026-08-24 · **Status:** Approved (Approach 1 — PB service registry)
**Goal:** Manage integration credentials/endpoints from Settings → Integrations without SSH/rebuild, for all non-critical services. Boot-critical secrets stay env-only forever.

## Storage

New PB collection `consuela_service_config` (LOCKED rules, seeded by pb-seed):
`service` (registry id) · `key` (field id) · `value` (AES-256-GCM ciphertext when `is_secret`, else plaintext) · `is_secret` · `updated_at` · `updated_by`. Unique `(service,key)`. Empty by default — absence = `.env` fallback.

## Registry (`src/lib/services/registry.ts`)

Code-defined whitelist; API rejects anything else. Entries: home_assistant (HA_HOST, HA_TOKEN🔒, MQTT_BROKER, MQTT_USER, MQTT_PASS🔒, HA_GROCERY_TODO_NAME) · telegram_alert (TELEGRAM_BOT_TOKEN🔒, TELEGRAM_ALERT_CHAT_ID) · telegram_mirror (TELEGRAM_MIRROR_BOT_TOKEN🔒) · gmail_emergency (GMAIL_USER, GMAIL_APP_PASSWORD🔒) · hermes (HERMES_API_URL, HERMES_API_KEY🔒) · instacart (INSTACART_API_KEY🔒) · themealdb (MEALDB_KEY, optional) · weather_location (LAT, LON) · composio (COMPOSIO_API_KEY🔒) · greenlight (key🔒) · khanacademy (key🔒). Each entry: displayName, helpText, required flags, testFn id.

**Hard-excluded (never configurable):** SESSION_SECRET, ADMIN_SECRET, CRON_SECRET, PB_ADMIN_EMAIL/PASS, NEXT_PUBLIC_PB_URL, CONSUELA_ENCRYPTION_KEY.

## Crypto

Extract AES-256-GCM helpers from `src/lib/google/encryption.ts` into shared `src/lib/secret-box.ts` (`encryptSecret`/`decryptSecret`, keyed by CONSUELA_ENCRYPTION_KEY). Google encryption refactored onto it — behavior unchanged.

## Resolver

`getServiceConfig(service, key)` in `src/lib/services/config.ts`: PB override (withAdmin, decrypt if secret) → `process.env` fallback → null. Per-request reads. Consumers migrated off direct `process.env`: ha/config (+mqtt), free-communication (Telegram+Gmail), telegram/get-updates, hermes/chat (removes hardcoded key default), instacart, themealdb, weather literals (WeatherWidget/FogBackground/AdultHome).

## Routes (all under middleware session gate)

- `GET /api/services/config` — manifest + per-service `{configured, source: db|env|unset, preview}`; secrets never returned (last-2-char hint max)
- `PUT /api/services/config` `{service,key,value}` — adults-only (authorizeAdminRequest); registry-validated; encrypts 🔒
- `DELETE /api/services/config` `{service,key}` — adults-only; clears override
- `POST /api/services/test` `{service}` — registered health check (HA /api/, Telegram getMe, SMTP verify, Hermes ping, Instacart ping, MealDB search ping, Composio auth check) → `{ok, detail, ms}`
- `POST /api/services/import` — one-time adult-gated ingest of legacy localStorage `consuela-connections` blob; maps known entries to registry keys
- `GET /api/services/runtime` — non-secret runtime values for client widgets (weather LAT/LON)
- `POST /api/services/home-assistant/reconnect` — closes HA WS bridge so instrumentation-style restart picks up new credentials on next tick (exported reset handle in ha/bridge)

## UI

Settings → Integrations gains **"Services & Keys"** SectionCard (hidden for child role): rows per service with status dot 🟢tested/🟡configured/🔴unset + source chip DB/.env; expand → fields (secrets = password inputs, `•••xy` hint), Save, Test, Clear-override; import banner when legacy localStorage blob present (import → delete blob); HA row gains "Reconnect bridge" button. Removed: ConnectionManager component, connections/store.ts, /api/connections.

## Prerequisite plumbing (Task 1)

Both docker-compose files: un-hardcode `- TELEGRAM_BOT_TOKEN=` → `${TELEGRAM_BOT_TOKEN:-}`; add passthroughs HA_HOST/HA_TOKEN/MQTT_BROKER/MQTT_USER/MQTT_PASS/HA_GROCERY_TODO_NAME/TELEGRAM_ALERT_CHAT_ID/GMAIL_USER/GMAIL_APP_PASSWORD/INSTACART_API_KEY. `.env.example`: add GMAIL_*, TELEGRAM_ALERT_CHAT_ID, HA_* already present ✓, remove dead GOOGLE_POLL_INTERVAL_MS + empty OPENROUTER literal. Outer compose mirrors.

## Out of scope

Rate limiting, session revocation, voice/OCR revivals, dead-code sweep (separate cleanup), positive filter grammar for db gateway.

## Testing

TDD: secret-box roundtrip + tamper; resolver precedence (db>env>null) incl. decrypt path; registry whitelist/exclusion rejection; routes (anon 401, child PUT 403, adult ok, GET masking shape, DELETE clears); every testFn with mocked fetch/transport; import mapping incl. legacy-HA-token drop-in; consumer tests updated (ha-config etc.). Full suite green throughout.
