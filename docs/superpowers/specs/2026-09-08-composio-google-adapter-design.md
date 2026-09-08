# Google Calendar via Composio — Design

**Date:** 2026-09-08
**Status:** Approved design, pre-implementation
**Scope:** Replace the dead Google Device-Flow integration with a Composio-brokered Google adapter. One spec covers: hosted connect flow, event sync, Google Tasks/Reminders unlock, agent event writes + week visibility. Device Flow is deleted entirely.

## Problem

The dashboard's Google Calendar integration is dead: `consuela_google_tokens` has 0 rows (the device-flow grant was lost), the 5-min sync cron fails honestly with no-grant every tick, and 148 stale cached events keep rendering on the Calendar page with no way to refresh. The direct integration also carries two structural limitations: Google's Device Flow rejects the Tasks scope (Reminders are permanently paused), and event writes are impossible without a public redirect URI this LAN-only NAS can't host.

Composio (already integrated for Instacart) solves all three: it brokers Google OAuth on its own hosted consent page (no public redirect needed), its `googlecalendar` toolkit exposes 49 actions including sync + create/patch/delete, and a `googletasks` toolkit unlocks the paused Reminders feature. Verified live 2026-09-08: stored key valid (v3.1 tools probe 200), 0 connected accounts, toolkit actions enumerated.

## Goals

1. Calendar page + Home widgets show fresh Google events again, powered by Composio
2. Hosted connect flow — user clicks one link, approves on Google, dashboard auto-detects the connection
3. Reminders section lights up via Google Tasks sync
4. Consuela chat can create/remove events on the real Google Calendar and see a week of events
5. Device Flow code fully removed — one connect story
6. Zero changes to the read contract the Calendar page and widgets consume

## Non-Goals

- Two-way editing of Google-origin events in the Calendar page UI (Google rows still open Google's web UI on edit; chat is the write surface)
- Two-way pantry/tasks sync or any other Composio toolkits
- Migrating the Instacart path — it keeps working as-is
- Real-time push (webhooks/watch channels) — polling only

## Architecture

One new server module, thin routes, everything else unchanged:

```
Settings card ──► POST /api/google/composio/setup ──► Composio auth-link ──► Google consent (hosted)
      (poll) ──► GET /api/google/composio/status ──► connected_account_id stored in PB
                                                                │
cron (15-min) ──► src/lib/google/composio.ts ──► Composio execute API ──┤
  (GOOGLECALENDAR_SYNC_EVENTS / LIST_CALENDARS / GOOGLETASKS_*)         ▼
                                              same PB caches (events / tasks / calendar_sync rows)
                                                                │
Calendar page + widgets + /api/google-calendar + /api/google-tasks ── unchanged reads
```

New components:

1. **`src/lib/google/composio.ts`** — Composio client. Executes v3.1 actions (`POST https://backend.composio.dev/api/v3.1/tools/execute/{ACTION}` with `X-API-Key`, `connected_account_id` in the body), resolves the API key via `getServiceConfig("composio", "COMPOSIO_API_KEY")` + `decryptStrict`, 30s timeout per call, typed error taxonomy (`composio_not_configured` | `composio_auth_failed` | `composio_not_connected` | `composio_api_error`).
2. **Connect routes** — `POST /api/google/composio/setup` (adult-gated, creates the auth-link) and `GET /api/google/composio/status` (any session; polls Composio `connected_accounts` and reports state).
3. **Sync adapter** — inside the existing `POST /api/cron/consuela/google-sync` route: Composio branch replaces the direct-Google branch.
4. **Chat write path** — `hermes-tools.ts` `add_event`/`remove_event` gain a Composio leg; new `get_week_events` read tool.
5. **`GoogleConnectCard` rewire** — device-code UI replaced by hosted-link + status poll; calendar multi-select UI preserved.

Unchanged: `consuela_google_calendar_events` / `consuela_google_tasks` / `consuela_google_tasklists` / `consuela_google_calendar_sync` caches and their indexes; `/api/google-calendar` GET; `/api/google/calendars` GET/PUT; `/api/google/sync` POST (manual sync); `/api/google/sync-state`; the Calendar page, `HomeScheduleDisplay`, Today's Events widget, and Reminders section.

## Connect flow

1. User taps "Connect Google account" in Settings → Integrations (adult session required).
2. `POST /api/google/composio/setup`: server calls Composio to create a connected-account auth-link for the `googlecalendar` + `googletasks` toolkits and returns the hosted URL. Composio hosts the Google consent screen and its own OAuth callback — nothing public is needed on the NAS.
3. `GoogleConnectCard` opens the link (new tab) and polls `GET /api/google/composio/status` every 5s.
4. When Composio reports the account `ACTIVE`, the status route persists the **connectedAccountId** into `consuela_google_sync_state` (key-value rows: `composio_account_id`, plus `composio_connected_at`), then triggers one immediate sync so the card can show "Connected · Synced Xs ago" without waiting for the cron.
5. Disconnect: existing card flow → server deletes the Composio connected account via API and clears the state rows.

No Google tokens, refresh tokens, or credentials ever reach the dashboard — Composio holds them. Only the opaque `connectedAccountId` is stored.

## Sync adapter

- **Trigger:** existing cron route `POST /api/cron/consuela/google-sync` (CRON_SECRET bearer, unchanged auth), cadence **15 min** (was 5; host crontab line updated on the NAS — the other consuela crons stay 5-min). The manual Sync button (`POST /api/google/sync`) and the post-connect immediate sync share the same adapter.
- **Window:** 30 days back / 90 days forward — identical to today's contract.
- **Calendars:** `GOOGLECALENDAR_LIST_CALENDARS` feeds the existing multi-calendar selection UI; for each selected calendar, `GOOGLECALENDAR_SYNC_EVENTS` (incremental where Composio's response exposes a cursor, full-window pull otherwise) upserts into `consuela_google_calendar_events` keyed by the existing `(calendar_id, google_id)` composite unique index. Rows outside the window are pruned. Per-calendar failure isolation: one calendar's error is recorded in its `consuela_google_calendar_sync` row (`last_status`/`last_error`) and the loop continues.
- **Tasks:** `GOOGLETASKS_LIST_TASKLISTS` + task-list items sync into `consuela_google_tasklists` / `consuela_google_tasks` (existing rows/shape), which the Reminders section already reads. Tasks sync runs in the same cron pass, best-effort — a Tasks failure never fails the calendar sync.
- **First run after connect:** full pull replaces the 148 stale cached rows.
- **Shape mapping:** Composio event payloads map to the existing cache row fields (`google_id`, `calendar_id`, `summary`, `start_iso`, `all_day`, plus existing fields) — mapping is pure and unit-tested.

## Agent tools (chat)

- **`add_event`** becomes dual-write: PB `events` row exactly as today **plus** `GOOGLECALENDAR_CREATE_EVENT` on the connected account. Target calendar: the account's `primary` calendar (same default the old `createCalendarEvent` helper used); creating onto a user-picked non-primary calendar stays out of scope. The Google leg is best-effort: its failure never fails the PB write and is reported honestly in the tool result ("saved to the family calendar; Google Calendar update failed: …").
- **`remove_event`**: Google-origin row → `GOOGLECALENDAR_DELETE_EVENT` + cache prune; family-origin row → PB delete as today.
- **New `get_week_events`** (read-only): next 7 days from the `consuela_google_calendar_events` + `events` caches, grouped by day — gives the agent multi-day visibility without any live Composio call.
- **Week conflicts:** the suggestion engine's calendar-conflict scanner (currently today-only, 30-min overlap) extends to the 7-day cache window. Parent-only visibility unchanged.

## Device Flow removal

Deleted: `src/lib/google/device-auth.ts`, `src/lib/google/oauth-client.ts` (token-refresh plumbing), routes `/api/google/device-grant|device-poll|device-revoke|webhook`, `consuela_google_tokens` collection from the seed and `ensureGoogleCollections`. Rewired: `GoogleConnectCard` (hosted-link flow), `/api/google/state` + `/api/google/sync-state` (report Composio connection instead of token state), and **`isGoogleConnected()`** — the check `/api/google-calendar` and friends use — now reports `connectedAccountId` presence + Composio-verified status instead of a token row, keeping the same JSON contract (`connected: true/false`). Kept: `secret-box.ts` (still encrypts the Composio service key), `calendar.ts` cache/prune/selection helpers that the adapter reuses, `encryption.ts` if any other consumer remains (verify during planning; delete if orphaned).

## Error handling

| Condition | Behavior |
|---|---|
| Composio key missing/unreadable | Routes return `composio_not_configured`; Settings dot red with detail; cron returns `{ok:false, reason:"composio_not_configured"}` |
| No connected account | Cron returns `{ok:false, reason:"composio_not_connected"}` (not an error spam case — silent-ish single log line); card shows connect prompt |
| Composio 401/403 (revoked/rotated key) | `composio_auth_failed`; card prompts reconnect; stale cache keeps serving |
| Composio outage/timeout (30s cap) | Sync failure keeps last-good cache; per-run status recorded in `consuela_google_sync_state` |
| Google-leg failure during chat write | PB leg unaffected; honest partial-success message |
| PB unreachable | Sync aborts with `db_unreachable` (today's behavior) |

## Security

- API key stored encrypted (`v1.<iv>.<tag>.<ct>` envelope), decrypted only in server memory inside the Composio client; never logged, never sent to the client (Settings shows only the existing 2-char-suffix mask)
- `/api/google/composio/setup` adult-gated via `authorizeAdminRequest` (matches `/api/google/calendars` PUT); status route any-session read-only
- Cron route unchanged: CRON_SECRET bearer
- The hosted auth-link URL is short-lived and returned only to the requesting adult session

## Testing

Vitest with a mocked Composio execute API (no live network):

1. Connect: setup route returns auth-link (and is adult-gated — child/guest 401/403); status route persists account id on `ACTIVE`; disconnect clears state
2. Sync: event mapping to existing row shape; window pruning; per-calendar isolation (one failure recorded, others sync); stale-row replacement on first run
3. Tasks: tasklist/task mapping into existing caches; tasks failure doesn't fail calendar sync
4. Chat: `add_event` dual-write with Google-leg failure isolation; `remove_event` routing by origin; `get_week_events` grouping
5. Week-conflict scanner extension (overlap detection in the 7-day window)
6. Client: `GoogleConnectCard` states (unconnected → waiting → connected → error) against mocked routes

Live verification post-deploy: connect with the real Google account, confirm fresh events render on the Calendar page within one cron cycle, Reminders populate, Consuela adds/removes an event on the real calendar.

## Ops (post-deploy)

1. Standard tar-sync → build (v27+) → swap with `--env-file /tmp/new.env`
2. Update the NAS host crontab google-sync line to `*/15`
3. Connect Google in Settings → Integrations
4. Run `npm run pb:seed` (drops nothing; verifies caches)

## Decomposition note

The agent-capability wishlist surfaced during scoping (proactive push notifications, pantry writes, recipe creation, task reassign/points-editing) is intentionally excluded — it becomes a separate follow-up spec ("Consuela capability pack") with no dependency on this one.
