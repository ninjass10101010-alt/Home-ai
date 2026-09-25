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

## Routes (current live-PB gates)
- `GET /api/services/config` — current live PB parent; nonparents receive no field metadata or secret suffix, and secrets never return beyond a last-2-character hint.
- `GET /api/ai/health`, `GET /api/ai/providers`, and `POST /api/services/test` — current live PB parent before health buffers, masked metadata, provider probes, or credentialed tests.
- `GET /api/google/state`, `/api/google/sync-state`, `/api/google/calendars`, and `POST /api/google/sync` — current live PB parent before metadata, PB, or Google access; child/pet 403, deleted session 401, identity outage 503.
- `GET /api/google-calendar` — session-scoped product-event read; `?sync=now` requires the current-parent admin gate before any collection or token work.
- `GET /api/google-tasks` — current-parent admin gate before every cache or collection read, including plain GET.
- `GET /api/ha/notify-targets` — current live PB parent before HA/PB metadata reads.
- `POST /api/emergency/test` — middleware requires a valid signed cookie, while the route's current-parent authorization remains authoritative for the live identity.
- `PUT`/`DELETE /api/services/config`, `POST /api/services/import` — current-parent authorization with registry validation and encrypted writes.
- `POST /api/tasks/sync` — current live PB role; non-parent bodies retain only the tasks leg.
- Generic `/api/db/[collection]` writes use the current live PB role and `WRITE_POLICY`; the signed-cookie role is never authoritative.
- Family edit/delete targets opaque live PB IDs; fallback-only rows are read-only. Admin/self-service/profile PIN writes share the member-admin lock and reject collisions with `409 pin_collision`.
- Self-service profile and PIN routes target only the signed `session.memberId`; legacy `actorName` input cannot select a different record. Create/rename duplicate checks use normalized exact full names, so similar names can coexist.
- Google calendar selection is serialized with `withGoogleIntegrationOperation` through the connection check, collection setup, selection writes, and prune.
- `POST /api/services/home-assistant/reconnect` — closes HA WS bridge so instrumentation-style restart picks up new credentials on next tick (exported reset handle in ha/bridge)
- `GET /api/services/runtime` — non-secret runtime values for client widgets; public runtime fields are resolved through the registry without exposing secrets.

## UI

Settings → Integrations gains **"Services & Keys"** SectionCard (parent-only; child, pet, and guest sessions receive no manifest or field metadata): rows per service with status dot 🟢tested/🟡configured/🔴unset + source chip DB/.env; expand → fields (secrets = password inputs, `•••xy` hint), Save, Test, Clear-override; import banner when legacy localStorage blob present (import → delete blob); HA row gains "Reconnect bridge" button. Removed: ConnectionManager component, connections/store.ts, /api/connections.

## Prerequisite plumbing (Task 1)

Both docker-compose files: un-hardcode `- TELEGRAM_BOT_TOKEN=` → `${TELEGRAM_BOT_TOKEN:-}`; add passthroughs HA_HOST/HA_TOKEN/MQTT_BROKER/MQTT_USER/MQTT_PASS/HA_GROCERY_TODO_NAME/TELEGRAM_ALERT_CHAT_ID/GMAIL_USER/GMAIL_APP_PASSWORD/INSTACART_API_KEY. `.env.example`: add GMAIL_*, TELEGRAM_ALERT_CHAT_ID, HA_* already present ✓, remove dead GOOGLE_POLL_INTERVAL_MS + empty OPENROUTER literal. Outer compose mirrors.

## Out of scope

Rate limiting, session revocation, voice/OCR revivals, dead-code sweep (separate cleanup), positive filter grammar for db gateway.

## Testing

TDD: secret-box roundtrip + tamper; resolver precedence (db>env>null) incl. decrypt path; registry whitelist/exclusion rejection; routes (anon 401, child PUT 403, adult ok, GET masking shape, DELETE clears); every testFn with mocked fetch/transport; import mapping incl. legacy-HA-token drop-in; consumer tests updated (ha-config etc.). Full suite green throughout.
