# Architecture — Consuela (Home-ai)

> API surface, data conventions, admin capabilities + routing/access-control truths, and SOP conventions — moved verbatim from AGENTS.md §2.3 / §3.5 / §4.1 / §4.3 / §5 + the scaffolding recipes on 2026-09-24. Deployment-level architecture (containers, host, data flow) lives in the parent repo's `../docs/ARCHITECTURE.md`.

## API Route Surface & Access Gates

### 2.3 API route surface & access gates (2026-09-15)

The middleware default is **session-required for every `/api/**` path**, minus the
exempt prefixes that carry their own gate (`/api/auth/`, `/api/cron/` (CRON_SECRET),
`/api/admin/`, `/api/ha/alarm`, `/api/emergency`, `/api/recipes/search`,
`/api/hermes/`, `/api/consuela/suggestions`, `/api/consuela/screensaver`,
`/api/muse/`). `/api/muse/` is exempt *from the session gate* because it
self-authenticates with its own bearer token — its settings/log routes still
require an adult dashboard session (or the server-only `ADMIN_SECRET`, or a
parent PIN). Non-gateway routes with meaningfully different gates:

| Route | Method | Gate |
| --- | --- | --- |
| `/api/muse/auth/login` | POST | Key-authenticated (constant-time SHA-256) + per-IP throttle; public surface |
| `/api/muse/auth/logout` | POST | Bearer (stateless no-op) |
| `/api/muse/whoami` | GET | MUSE bearer |
| `/api/muse/tools` | GET | MUSE bearer (admin tools only while the live admin toggle is on) |
| `/api/muse/tool` | POST | MUSE bearer + per-key rate limit + redacted audit |
| `/api/muse/context` | GET | MUSE bearer (`?scope=meal\|task\|schedule\|all`) |
| `/api/muse/docs` | GET | Public (protocol docs only, no family data) |
| `/api/muse/settings`, `settings/rotate`, `settings/revoke-tokens`, `/api/muse/log` | GET/PUT/POST | Parent session **or** `ADMIN_SECRET` **or** parent `x-admin-pin` — never the bearer |
| `/api/rewards/redeem` | POST | Session + member PIN; server-authoritative (reads cost, checks balance, writes the redeem tx) |
| `/api/ai/health` | GET | Session (any signed-in member; metadata-only chat outcomes — never message text) |
| `/api/ai/providers` | GET | Session (any signed-in member; key previews only — 2-char suffix, decrypted key never leaves the server) |
| `/api/ai/providers` | PUT/DELETE | Parent session (`authorizeAdminRequest`) |
| `/api/ai/models` | POST | Parent session (`authorizeAdminRequest`) — server-side `/v1/models` listing with the stored key |
| `/api/db/[collection]`, `/api/db/[collection]/[id]` | POST/PATCH/DELETE | Session + per-collection write policy (parent-only vs session) — see §5.6 |
| `/api/tasks/sync` | POST | Session; non-parents sync the tasks leg only (`ignoredLegs`) |
| `/api/consuela/briefing` | GET/PATCH | Session (no longer middleware-exempt); PATCH stamps `acknowledgedBy` |
| `/api/ha/call-service`, `notify-config`, `notify-prefs`, `notify-test` | POST | Parent session (`authorizeAdminRequest`); HA reads stay session-level |

---


## Chat Data Conventions

### 3.5 Consuela Chat Data Conventions
- **Chat thread id = `YYYY-MM-DD` (daily thread).** Every message stored in the `chat_messages` PB collection belongs to the day it was sent: `threadId` is always the **UTC date** in `YYYY-MM-DD` form (use the same `new Date().toISOString().split("T")[0]` helper used across the codebase — UTC, not local, deliberately: consistent across servers and matches the dashboard server; suggestions/briefings use local date via `src/lib/local-date.ts`, thread ids stay UTC). Telegram messages, dashboard messages, and API messages all land in the same daily thread so the Ask Consuela page can show one unified conversation per day. `selectChatMessages(threadId, sinceISO?)` is the only way to read them; ordering is `createdAt` ascending.

---


## SOP Authoring Conventions

### 4.1 Reusable SOP Template (copy this block when creating new ones)

```markdown
#### SOP-XXX: <Short Descriptive Title> (Lifecycle Phase: Onboard | Daily | Maintain | Incident | Rollout | Retire)

**Purpose**  
One-sentence goal from the human user's perspective.

**Prerequisites**
- What the user or admin must have ready
- Files / env vars to touch (with exact paths)
- Docs the agent must read first (always include the relevant deep doc)

**Step-by-Step** (imperative, one action per line, numbered)
1. Open the Settings tab...
2. ...

**Expected Results / Success Signals**
- UI: "You should now see a green success toast and the new contact in the list."
- Backend / DB: "A new row appears in emergencyContactsData with isPrimary: true"
- Logs / Notifications: "Gmail sent folder contains the alert"

**Rollback / Undo**
- Exact reverse steps or DB edit command

**Agent Notes**
- Verbatim sentence you should say to the user
- When to escalate: "If the above fails, read the full EMERGENCY_SETUP.md §Troubleshooting"
- Related SOPs
```

### 4.3 How to Create a New SOP
1. Pick the next SOP-XXX number.
2. Choose the lifecycle phase.
3. Fill the template above.
4. Add it under 4.2.
5. Update the table of contents if you added a new top-level section.
6. Commit the change to this file together with the feature.

---


## Admin Capabilities & Routing Truths

## 5. Consuela Admin Capabilities (Self-Management)

Consuela has 5 admin-level tools available through the Ask Consuela chat interface. These tools let her manage the dashboard itself — check for updates, deploy new code, restart containers, and verify database health.

### 5.1 Available Admin Tools

| Tool | Description | Use Case | Safety |
|------|-------------|----------|--------|
| `check_for_update` | Checks GitHub for newer commits on `warm-glass-v2` | "Is there a dashboard update available?" | Read-only. Calls `/api/admin/version` internally. |
| `trigger_update` | Pulls latest code + rebuilds Docker container | "Update the dashboard to the latest version" | **Destructive** — restarts the dashboard (brief downtime). Consuela will confirm with the user before running. |
| `get_container_status` | Lists Docker containers and their health | "Is PocketBase running?" / "Check dashboard health" | Read-only. Calls `/api/admin/containers`. |
| `restart_container` | Restarts a Docker container by name | "Restart PocketBase, it's not responding" | **Restart** — brief downtime for that service. Only allowed: consuela-dashboard, pocketbase, hermes-agent-2. |
| `check_pocketbase` | Verifies PocketBase is healthy | "Check if the database is up" | Read-only. Pings PB health endpoint. |

### 5.2 Architecture

The admin tools work via internal HTTP calls from the tool handler (runs inside the Next.js process) to the dashboard's own API routes:

```
User → Ask Consuela → POST /api/hermes/chat
  → Consuela (Hermes agent) decides tool_call
  → Tool handler runs inside Next.js
    → Internal fetch to /api/admin/version, /api/admin/update, /api/admin/containers, /api/admin/restart
  → Results formatted → Sent back to Hermes for natural response
  → User sees natural-language answer
```

**New API routes:**
- `src/app/api/admin/containers/route.ts` — GET: lists three key containers (dashboard, PB, Hermes) with state, status, ports, image
- `src/app/api/admin/restart/route.ts` — POST: restarts a named container from an allow-list

**Env vars needed:**
- `NEXT_PUBLIC_APP_URL=http://localhost:3000` — internal self-referencing URL for tool handler fetches

**Scheduled cron endpoints (background jobs, since 2026-08-05):** a host crontab (see `scripts/consuela/host-crontab.example`) pings several stateless Next.js routes with `Authorization: Bearer $CRON_SECRET` (docker-compose env: `CRON_SECRET`; local dev fallback `dev-cron-secret-2026`):

| Route | Schedule | What it does |
|-------|----------|--------------|
| `POST /api/cron/consuela/suggestions` | every 5 min | Runs the proactive-suggestion engine (pantry lows, task-penalty streaks, calendar conflicts, no-meals-this-week, routines-due-soon) into `proactive_suggestions` |
| `POST /api/cron/consuela/briefing` | 7am daily | Writes today's morning briefing (events/tasks/meals/suggestions); pushes to phones when the `briefing` pref is on |
| `POST /api/cron/consuela/weather-alert` | every 15 min | Reads Open-Meteo; pushes a severe-weather heads-up (storm/heavy-snow) once per episode via `broadcastHouseAlert` when the `weather` pref is on; deduped in `ha_alert_state`; 9pm–7am quiet hours |
| `POST /api/cron/consuela/calendar-alert` | every 15 min | Pushes a ~60-min lead-time heads-up for important (`importanceScore ≥ 50`) events today via `broadcastHouseAlert` when the `calendar` pref is on; one push per event/date deduped in `ha_alert_state`; quiet hours |
| `POST /api/cron/consuela/google-sync` | every 5 min | Pulls Google Calendar + updates last-auto-sync state (quota-guarded) |
| `POST /api/cron/consuela/telegram-poll` | every 5 min | Polls Telegram and mirrors group messages into the daily chat thread |

Unauthorized requests (missing/wrong bearer) get a 401 `{error:"unauthorized"}`.

**Security (suggestion write routes):** all `/api/consuela/suggestions/*` write routes (PATCH, POST /act) require the `x-consuela-pin` header verified against a family member PIN. GET requests remain public (read-only). The client sends the active session PIN when one exists; when the session has none (after a page reload — the PIN is in-memory only and never persisted — or for guests) the Home "Consuela suggests" widget and the /suggestions page prompt for a family-member PIN, queue the pending dismiss/snooze/act, and retry it once a PIN is submitted. A rejected PIN (401) clears the cached pin and re-prompts with an error; non-401 write failures surface a toast instead of failing silently.

### 5.3 What Consuela CAN Do

Every bullet is backed by shipped tools in `src/lib/hermes-tools.ts` (`getAllTools()` = 52) and matches `ai/TOOLS.md`.

- ✅ Answer questions about the family's REAL data with live reads — calendar (today's events with family + Google rows merged, or ANY date range via `get_calendar_range`, max 30 days), pending AND recently completed tasks, the weekly meal plan, recipes, grocery, pantry (real stock — an empty pantry reports honestly), family roster, routines (today's slice + the FULL weekly `get_family_routines` view), this week's real points, archived past weeks (`get_past_weeks`), and the kids' reward catalog (`get_rewards`)
- ✅ Real live weather via Open-Meteo (`get_weather`: temp, feels-like, high/low, condition, precip chance in °F) — when it errors, weather is reported as unavailable, never invented
- ✅ Task CRUD that really writes to PocketBase — `add_task` / `update_task` / `delete_task` (pending rows; completed rows are undone in the Tasks UI) / `reopen_task` (rows still in the approval queue), and `complete_task` — a chat completion QUEUES for parent approval; chat never moves points
- ✅ Calendar events — add (`add_event`, `check_conflicts` first), move/edit family events (`update_event`), remove by title (`remove_event`); Google-synced events are edited on Google's side
- ✅ Meals + recipes — add/replace a meal slot (`add_meal`: weekOf-aware upsert, weekday short or YYYY-MM-DD resolved against America/Detroit), save a recipe to the catalog (`add_recipe`), and push one recipe's missing ingredients to the shopping list (`recipe_ingredients_to_grocery`: skips stocked, dedupes, aborts honestly if stock can't be read)
- ✅ Pantry + routine writes — `add_pantry_item` (upsert; quantity is the NEW total), `remove_pantry_item`; `add_schedule_item` / `update_schedule_item` / `delete_schedule_item` (exact titles, ambiguous refused)
- ✅ Grocery — add items (`add_grocery_item`) and mark them picked up (`complete_grocery_item`); honest store-split via `compare_grocery_prices` (there is NO live price feed — never states prices)
- ✅ PROPOSE point adjustments — `propose_point_adjustment` hands back an inert PIN-confirmation chip; the adjustment executes ONLY when a parent taps it and verifies their PIN (server re-verifies); she never states an adjustment as done before that confirmation
- ✅ Planner agent mode (parents only) — `POST /api/hermes/chat {agent:"planner",intent}`: zero tools, grounded context, validated JSON, no thread pollution; powers the meal/task/reward suggestion buttons and the "Consuela's week" Calendar card (PIN-gated apply)
- ✅ Memory (adults only) — `recall_memories` / `remember_fact` / `forget_memory`
- ✅ House control (parents) — `ha_list_devices` / `ha_control_device` for lights/switches/scenes/climate/media players/vacuums; alarms + locks excluded at the server
- ✅ Suggestions + logistics — `get_proactive_suggestions`, `dismiss_suggestion`, `action_suggestion`; `check_conflicts`, `suggest_buffers`, `create_buffers`
- ✅ Check for dashboard updates and report version info
- ✅ Trigger dashboard rebuild after user confirmation
- ✅ Check container health (dashboard, PocketBase, Hermes)
- ✅ Restart unhealthy containers
- ✅ Verify PocketBase database connectivity
- ✅ Explain what she can and can't do when asked

Chat history is persisted as user + final assistant content only — tool-call transcripts are NOT persisted to the daily thread; multi-turn tool-state checks rely on Consuela using read tools.

### 5.4 What Consuela CANNOT Do

- ❌ Delete meals (she can add/replace a slot via `add_meal`; recipes can be ADDED via `add_recipe`; schedule items can be added/updated/deleted — meal deletion stays a UI action)
- ❌ Delete grocery items from the list (she can add and mark picked up, not remove)
- ❌ Move points through chat directly — completions queue for parent approval and adjustments run only behind a parent's PIN-confirmed proposal; undoing an already-paid completion lives in the Tasks UI
- ❌ Reset the leaderboard
- ❌ Control alarms or locks (excluded at the server); the house domains she CAN drive are lights/switches/scenes/climate/media/vacuum
- ❌ Access external APIs beyond Google Calendar and Open-Meteo weather (no Spoonacular, no live grocery-price feed)
- ❌ Send emergency alerts (human must press the shield button)
- ❌ Touch the family finances / The Ledger
- ❌ Access the Docker host or other containers outside the allowed three
- ❌ Run arbitrary commands or shell access
- ❌ Modify her own system prompt or tools
- ❌ Invent family data — an unavailable tool/provider is reported honestly, never papered over with demo rows

### 5.5 Common Q&A

**"Consuela, can you update the dashboard?"**  
"I can check if an update is available and install it. Want me to check first?"

**"Consuela, PocketBase is acting up"**  
"Let me check PocketBase's health and the container status. I'll let you know what I find."

**"Consuela, what tools do you have?"**  
Full explanation of all 52 tools available (reads incl. calendar ranges/routines/history, task CRUD, pantry/routine/recipe writes, memory, house control, admin; point adjustments only via PIN-confirmed proposals). Memory is adults-only; kids get the read-only allowlist (the 17 `get_*` tools). No shell access.

### 5.6 Routing & access-control truths (2026-09-15)

**Per-collection gateway write policy.** The single sessioned gateway
`/api/db/[collection]` is role-gated per collection (`WRITE_POLICY`/`canWrite` in
`src/lib/db-gateway.ts`). Reads are unchanged (any session); a missing session is
still 401 at middleware, and a wrong role is 403 `adult_only`.

- **Parent-only writes** (`role === "parent"`): `week_data`, `week_archive`,
  `rewards`, `penalties`, `hall_of_fame`, `family_goals`, `emergency_contacts`,
  `events`, `schedules`, `meal_plan_entries`, `recipes`, `meal_week_archive`,
  `chat_messages`, `morning_briefing`, `proactive_suggestions`, `consuela_state`.
  Points, the family calendar, the emergency roster and the shared thread are
  adult-controlled.
- **Shared session writes** (`parent | child | pet`): `tasks`,
  `grocery_list_items`, `pantry_items` — what the household already toggles in
  the UI. The gateway `sort` param is whitelisted (field lists only; else 400
  `invalid_sort`).
- `POST /api/tasks/sync` from a non-parent syncs the **tasks leg only**
  (`ignoredLegs: ["weekData","rewards","penalties"]`), so a child can never
  overwrite the shared points snapshot.
- Kid reward redemption is **not** a gateway write: `POST /api/rewards/redeem` is
  server-authoritative (server-read cost + balance, appends the redeem tx, 60s
  dedupe → 409, unknown → 404, insufficient → 400, wrong/missing PIN → 401).

**Parent-only admin auth (pets denied).** `authorizeAdminRequest`
(`src/lib/admin-auth.ts`) is an **allowlist on `role === "parent"`**: a valid
session that is child or pet is 403 `adult_only`, and a valid PIN belonging to a
child/pet is likewise 403 (the roster's third role `pet` has default PIN `0000`,
so a `!== "child"` denylist would leak). Credentials, in order: `Authorization:
Bearer $ADMIN_SECRET` (server-only, internal callers) → parent session cookie →
parent `x-admin-pin`. It guards the `/api/admin/*` routes, members admin,
services-config/ai-provider writes, the family memory bank, the HA mutating
routes, and the MUSE settings/log routes.

**MUSE surface + admin toggle + propose-only invariant.** MUSE is a distinct
inbound identity, not a config toggle: key (SHA-256 stored) → 24-hour HMAC bearer
token (`SESSION_SECRET`, context `muse-token-v1:`). Rotating or revoking bumps
the identity `version`, so every live token dies instantly. The tool catalog is
the full adult set (47 in v1); the 5 destructive admin tools
(`check_for_update`, `trigger_update`, `get_container_status`,
`restart_container`, `check_pocketbase`) are included **only** while the live
admin toggle is on — evaluated per request, so flipping it takes effect
immediately for already-connected agents with no re-login (the token's `adm`
claim is a diagnostics-only mint-time snapshot). The toggle defaults **off** and
is operator-controlled in Settings → MUSE. Invariants: MUSE may **propose**
point adjustments (an inert chip a parent must PIN-confirm) but can never apply
them; task approvals stay in the Tasks UI; the memory tools act on the shared
family bank; no base64 avatars (all member emoji go through `textEmoji()`); and
rotate/revoke are **not** written to the MUSE audit log (known v1 gap — the
`rotatedAt` stamp is the operator record). Full protocol reference:
`GET /api/muse/docs` (also `docs/muse-api.md`).

> **Ops on deploy:** `npm run pb:seed` creates `consuela_muse` +
> `consuela_muse_log` and carries the briefing `acknowledgedBy` field.

---


## Scaffolding Recipes

### Project Scaffolding Recipes (original content preserved for the coding agent)
When users request features beyond the base template, check `.kilocode/recipes/`.

| Recipe       | File                                | When to Use                                           |
| ------------ | ----------------------------------- | ----------------------------------------------------- |
| Add Database | `.kilocode/recipes/add-database.md` | When user needs data persistence (users, posts, etc.) |

**How to use:** Read the recipe → follow steps → update the relevant memory bank.

