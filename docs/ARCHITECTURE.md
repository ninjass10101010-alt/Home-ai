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
| `/api/tasks/sync` | POST | Session; **no browser writes** — a `tasks`/`weekData` body is 410 `legacy_sync_write_disabled`, any other body 400 `invalid_body` (GET is the read: rollover + reconcile + snapshot) |
| `/api/tasks/quarantine` | POST | Parent session **and** a live PocketBase `role === "parent"` row (`verifyLiveParentSession`; 401 `unauthorized`/`member_missing`, 403 `adult_only`, 503 `member_lookup_failed`); takes no PIN because it writes nothing to the server — `dry-run` returns the match report only, `export` writes one JSON file to `local-quarantine/`. PB is read-only here (snapshot → `week_data` fallback, `getFullList` only; 503 `canonical_week_unavailable`) |
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
- `POST /api/tasks/sync` takes **no browser writes at all**: a body carrying
  `tasks` or `weekData` is refused 410 `legacy_sync_write_disabled`, and every
  other body is 400 `invalid_body`. Task, ledger and config writes go through the
  command routes (`/api/tasks/approve`, `/api/tasks/claim`, `/api/tasks/ledger`,
  `/api/tasks/config`, `/api/tasks/manage`, `/api/rewards/redeem`) and the
  server-side week-ledger lock, so no session — child included — can overwrite the
  shared points snapshot.
- `POST /api/tasks/quarantine` is **read-only against PocketBase** and is not a
  ledger write: it needs a parent session *and* a live parent PB role
  (`verifyLiveParentSession`, no PIN), answers `dry-run` with the match report
  alone, and `export` writes a single JSON file under `local-quarantine/`. It
  must never grow a `create`/`update`/`delete` against `week_data` or the tasks
  snapshot — unmatched legacy rows are surfaced and exported, never applied.
- Kid reward redemption is **not** a gateway write: `POST /api/rewards/redeem` is
  server-authoritative (server-read cost + balance, appends the redeem tx, 60s
  dedupe → 409, unknown → 404, insufficient → 400, wrong/missing PIN → 401).

**The browser outbox is how a device asks for a write (`consuela-task-operation-outbox-v1`).**
Normal browser task/ledger writes are **retired** — no device pushes `tasks`,
`weekData`, points or history anywhere, and no client surface POSTs a command
route directly. `saveTasks`/`saveWeekData` are still called on the client, but
they are the localStorage **cache** writers (they are what "adopt the
authoritative state, then cache it" means), and `addTransaction` is a pure
in-memory transformer that returns a new `WeekData` — none of the three reaches
the network.
Every task/ledger mutation leaves the device as a durable command queued in
`src/lib/task-operation-outbox.ts`, persisted under the localStorage key
**`consuela-task-operation-outbox-v1`** (one `:entry:<operationId>` record per
command; a credential never enters the entry). An entry is queued — with its
stable `operationId` and a display target — *before* any local state moves, is
released only after a `200`/`202` acknowledgment has handed back authoritative
`weekData`/`task` plus the snapshot revision for adoption, retries on the same
`operationId`, and only clears on acknowledgment or an explicit user cancel of
a non-applied operation. The queue carries the outbox-carrying command routes
(`/api/tasks/claim`, `/api/tasks/approve`, `/api/tasks/manage`,
`/api/tasks/config`, `/api/tasks/ledger`, `/api/rewards/redeem`);
`/api/tasks/quarantine` is the one command route it does not carry, because that
route writes nothing to the server. **Do not fork the key or the entry shape** —
import `TASK_OUTBOX_STORAGE_KEY` and the queue helpers, never re-implement a
localStorage command buffer.

**A task id is only meaningful while the snapshot still holds it — so the
snapshot's id is authority and a stale local id must be healed, never
addressed.** `mergeTasksSnapshot` matches rows by id **or** by
`(title, assignee)`. A server row matching a local row on that second key with a
**different** id means the server **re-keyed the chore**: `recurringClone()`
(`src/lib/task-recurrence.ts`) issues each day's recurrence clone with a NEW id
and the same title/assignee (a lineage IS title+cadence+owner), and "↻ Repeat
last week" plus delete-then-re-add re-create a row the same way. The merge
therefore **re-keys the local row onto the server's id** rather than freezing the
stale one. Without that, the stranded id is what every command sends:
`liveSnapshotTasks()` does not contain it, `POST /api/tasks/manage` answers `404
unknown_task`, the outbox marked the entry `failed` (terminal, never retried),
the display-only optimistic hide was released, and the chore could never be
deleted or completed from that device while a permanent "couldn't be sent"
banner sat above the list. The re-key is deliberately narrow — it fires **only**
on the `(title, assignee)` key with a differing id, and never onto a tombstoned
id, never onto an id a different live local row already holds, never from/to a
non-integer id (validity is read from the **raw** snapshot row, because
`restored` mints an id for a malformed one), and it changes **only** the id so a
kid's un-landed completion/pending stamps survive for the existing proof gates
to arbitrate.

**A terminal `unknown_task` self-heals device-side.** `404 unknown_task` on a
command carrying a usable `taskId` means the id was stranded, so the outbox
tombstones it **on that device** and acknowledges the entry instead of failing
it forever (`strandedTaskId` → `acknowledge` in
`src/lib/task-operation-outbox.ts`). The row cannot exist on the server, so
dropping it locally is the user's actual intent and invents no server state —
there was nothing to delete. A named refusal (`unknown_task_owner`), a config
leg with no `taskId`, and every 401/403/409/5xx keep their existing
classification, and with no adoption seam the heal degrades to
`adoption_unavailable` rather than reporting a success that never happened.
**Honest trade-off:** a completion tap that lands in this window is dropped
rather than replayed — the chore reappears under its true id, uncompleted, so
the state is visible and retryable instead of silently paid or silently lost.

**What the on-disk entry payload may contain.** A `/api/rewards/redeem` entry
persists `{ rewardId, memberName, parentName }` in localStorage. `parentName` is
the approver's **identity**, not a credential: `/api/rewards/redeem` re-resolves
it against the LIVE PocketBase roster with `namesMatch` and then verifies
`parentPin`, so a stale, renamed, deleted or forged name authorizes nothing — a
name off the roster or a non-parent is `403 parent_only`, and a right name with
a wrong PIN is `401 invalid_pin`, both before the ledger write. A PIN
(`pin` / `parentPin`) **never** enters the entry: it lives only in the ephemeral
credential registry keyed by `operationId`. The stored reward row stays the sole
authority for the cost — never widen the allowlist to admit a client `cost` or
`title`. The entry's failure fields are split, and the boundary is exact:

- `body.reason` / `body.code` is the **machine channel** and is honoured
  **unconditionally**. The client deliberately acts on it: it selects
  retryable / permanent / semantic-duplicate and sets the retry backoff. This is
  the one place a server field is trusted outright, and it is intentional.
- `body.error` is the **display channel** — normally a human sentence — and is
  honoured as a machine reason **only when it is a member of the closed
  `ERROR_CHANNEL_MACHINE_CODES` vocabulary** in `task-operation-outbox.ts`. That
  exception exists because two command routes express their machine codes ONLY
  through `error`: `/api/tasks/config`, whose bodies are pinned by exact equality
  in `tests/unit/task-config-route.test.ts`, and `/api/tasks/manage`, whose bodies
  are pinned by `toMatchObject` in `tests/unit/task-manage-route.test.ts`. Neither
  route's codes can move to `reason` without rewriting those assertions.
- A **non-member** `error` yields no machine reason, and the caller degrades to a
  status-derived reason (`http_<status>`, `unauthorized`, `adult_only`,
  `operation_conflict`, ...). Every `error` — member or not — also lands on
  `lastErrorMessage`, which one caller renders; that field **steers nothing**.
- The vocabulary buys **correctness, not security.** An attacker who controls the
  response body already controls `reason` / `code`, which are honoured
  unconditionally, so gating `error` defends nothing against a hostile server.
  What it buys is that a well-behaved route's human sentence is never mistaken for
  a code, and that no server field can impersonate a module sentinel and strand a
  queued command. Do not later describe it as a security control.
- The list is hand-written because `TaskManageErrorCode` and `TaskConfigErrorCode`
  are type-only unions in server-only modules a browser module cannot import at
  runtime. `EveryManageCodeIsClassified` and `EveryConfigCodeIsClassified` make
  `npm run typecheck` fail if a new member of **either union** has no matching
  decision here. Those two guards cover only those two unions; five further
  members (`invalid_body`, `member_missing`, `member_lookup_failed`,
  `pin_required`, `unsupported_task_command`) are bare string literals with no
  derivable union, so they rest on the table-driven test alone.
- `credentialMissing` is a **module-owned boolean**, not a string. It is set only
  by `markAuthRequired(..., deferred: false)` — the one place this module decides a
  credential is absent — and `runFlush` reads it to skip an entry that cannot be
  attempted. Because it is never string-matched against `lastErrorReason`,
  **no server field, through any channel, can move the credential gate.**

**`executeInternalTaskCommand` is the sanctioned server-side command seam.**
`executeInternalTaskCommand` (`src/lib/task-commands.ts`) is the *only* entry
point a non-browser task mutation may use: it takes a normalized
`{ operationId, kind, actor, payload }` command plus a `context.source`
(`hermes` | `muse` | `server`), refuses a malformed id or shape, a forbidden
payload key (any authority token — `member`, `amount`, `points`, `history`, … —
or any credential token) and an unregistered kind, then dispatches to the
handler registered via `registerInternalTaskCommandHandler`.
`/api/tasks/manage`, `/api/tasks/claim` and `/api/tasks/approve` all execute
through it. A new internal writer **registers a handler and calls this** — it
never reaches PocketBase or the week row on its own, and it never infers a
payee, amount or approval identity from untrusted tool arguments.
**Wave 3 is COMPLETE — there is NO unremediated writer left in this plan's
scope.** Do not "migrate" any of the surfaces below; they are already on the
seam and the notes that once said otherwise are retired. What each one rides
now:

- **Hermes/MUSE task tools (Tasks 5 + 6).** `complete_task` / `reopen_task` ride
  the **claim** seam (`kind:"complete"` / `kind:"undo"`) and `add_task` /
  `update_task` / `delete_task` ride the **manage** seam
  (`kind:"add"|"update"|"delete"`) — none of them writes a snapshot, a tombstone
  or a mirror row itself, and the `mutateSnapshot` / `upsertSnapshotTask` /
  `deleteSnapshotTask` / `mirrorTaskToCollection` imports are gone from
  `src/lib/hermes-tools.ts`.
- **Reward redemption (Task 3).** `POST /api/rewards/redeem` runs through
  `applyWeekLedgerOperation` (`src/lib/ledger-operations.ts`) — the **shared**
  helper, under the same lock order (`week-ledger → snapshot-keyed`), with a
  `tx.meta.operationId` for replay and a shared projection-repair callback. It
  does **not** have its own `withWeekLedgerLock` body; an earlier note here
  claiming it did was wrong and has been removed.
- **Planner point adjustment (Task 2).**
  `POST /api/consuela/planner/apply` uses the same shared helper. It is **not**
  "its own `withWeekLedgerLock` body" — the earlier wording was wrong and is
  retired. The route still requires a live parent session + the parent PIN, and
  a chat-side adjustment with no stable operation id is refused rather than
  applied.
- **Briefing authority (Task 7).** The morning briefing, the assistant live
  reads and the screensaver payload all read through
  `readCanonicalTasks()` (`src/lib/consuela/live-reads.ts`) — the snapshot
  first, the PB replica only as a declared fallback, and `unavailable` as the
  third, honest outcome. See "snapshot-first reads" below.
- **All-time totals (Task 8).** `GET /api/tasks/all-time` +
  `src/lib/all-time-totals.ts` recompute points AND completions from canonical
  transaction history. See "all-time recomputation" below.

**CONTRACTS to keep (Wave 3, all tasks):**

1. **Command seam.** Every non-browser task mutation registers a handler and
   calls `executeInternalTaskCommand`; it never reaches PocketBase or the week
   row on its own and never infers a payee, amount or approval identity from
   untrusted arguments. The two command routes that carry a ledger write
   (redeem, planner apply) go through `applyWeekLedgerOperation`, so lock order,
   replay detection and projection repair are defined in exactly one place.
2. **All-time recomputation from canonical history.** All-time points and
   completion counts are **recomputed** from parsed transaction history
   (`parseCanonicalTransactions`) across the live week plus archived weeks. A
   stored `points` map is **never** authority. `historyComplete: false` means
   at least one week could not be read, so the per-member values are `null` and
   every surface says so rather than showing a short total as if it were whole.
3. **The honest-null policy.** A value that cannot be known is `null` and says
   so — never `0`, never an empty list, never "no chores", never a level
   derived from a missing number. Only *rendered* copies change ("no chores"
   was the specific Wave 3 Task 7 fix). Any new total, count or level MUST
   accept the null and must not coalesce it to zero.
4. **Snapshot-first reads.** Assistant/ambient task readers use
   `readCanonicalTasks()`: `consuela_data_snapshots` (the rows the family
   actually sees) → PB `tasks` replica as a **declared** fallback → `unavailable`.
   The screensaver throws `task_data_unavailable` on the third case and answers
   an honest 503; it never renders a fabricated progress bar. Tombstoned rows
   are dropped, and unresolved (`pendingApproval`) rows are filtered where the
   surface's meaning requires a settled answer.
5. **Outbox `parentName` contract.** A queued `/api/rewards/redeem` entry stores
   `{ rewardId, memberName, parentName }`; `parentName` is the approver's
   **identity**, never a credential. The route re-resolves it against the LIVE
   roster with `namesMatch` and then verifies `parentPin` — a stale, renamed,
   deleted or forged name authorizes nothing (off-roster or non-parent is
   `403 parent_only`; right name + wrong PIN is `401 invalid_pin`, both before
   the ledger write). A PIN never enters the entry; the stored reward row stays
   the sole authority for the cost.
6. **Prompt/codegen coupling.** `ai/TOOLS.md` is embedded at prebuild into
   `src/lib/ai-boot.generated.ts` and composes `SYSTEM_PROMPT` for every parent
   chat — **regenerate it with `node scripts/write-ai-boot.mjs` (or
   `npm run ai:boot`) in the same commit as any `ai/*.md` edit**; never hand-edit
   the generated file.
7. **Assistant actor attribution (Task 5).** Every assistant task write passes
   a `caller`; the actor role is the caller's LIVE role and `callerRole()`
   **fails closed** (only a literal `parent` is a parent), so a context-free
   `handler(args)` can never author a parent-actor command. All five call sites
   pass a context.
8. **Assigned-only completion, canonical payee.** `complete_task` completes an
   ASSIGNED chore only; open/late-stealable chores are CLAIMED from the Tasks
   screen and crew chores need every member checked in. The payee and the amount
   are derived from the chore's canonical owner and stored points — the
   `assignee` argument only disambiguates which row was meant.
9. **Reopen guard.** The payee list follows how the earn was actually written: a
   crew approval pays PER MEMBER (`pendingApproval.crew`), so `byName` — the
   literal `"Crew"` — is not a payee. There is **no** cheap pre-filter:
   `hasUnreversedTaskEarn` normalizes and its throw path is the fail-closed one.
   `reopenTask` writes `completedBy/completedAt/completedInWeek` as **`null`**,
   matching the approval seam's send-back — `""` is not nullish and would persist
   as a lie.
10. **GET `/api/tasks/sync` is the read, not a writer.** The route is retired as
    a browser write path (POST is 410 `legacy_sync_write_disabled` / 400
    `invalid_body`) and **kept** as the cross-device read. The browser's
    structured whole-body push family (`syncTasksToPB`, `syncWeekDataToPB`,
    `syncArchiveToPB`, `syncRewardsToPB`, `syncPenaltiesToPB`,
    `syncWeeklyPrizesToPB`, `syncAllTasksToPB`, `syncHallOfFameToPB`) is
    **deleted** — there is no migration-tooling caller left, so nothing is
    retained "for migration". `pushLocalToPB` keeps only the six non-task
    migration collections the Settings push may write
    (`SAFE_LOCAL_PUSH_COLLECTIONS` = grocery, pantry, meals, recipes, events,
    schedules) — tasks, points and goals stay server-owned and the legacy
    emergency-contact leg is gone. `syncFamilyGoalToPB` is the one surviving
    `sync*ToPB` helper and it is a family-goal (non-task) write.
    `tests/unit/task-normal-writes-disabled.test.ts` pins the writer surface and
    `tests/unit/task-no-browser-writes.test.ts` pins the db layer.

**DECIDED (2026-09-28, Option B):** an adult-owned chore completed from chat
queues as `pendingApproval` — chat never moves points, and the Tasks screen
still pays directly, because it is PIN-verified: `"pin"` pays, an adult
`"session"` caller is refused `pin_required`. The queue/pay branch keys off
`authentication`, never `role`.

`complete_task` no longer refuses a chore whose canonical owner is a grown-up
(the `reason: "adult_owner"` guard in `src/lib/hermes-tools.ts` is deleted — the
tool makes **no** authority decision at all any more). The disposition moved into
the claim seam (`src/lib/task-claim.ts`, the `action === "complete"` branch):

- `actor.authentication === "internal"` (chat / MUSE / a server-side caller)
  → **queues** as `pendingApproval`, no ledger write.
- `"pin"` (the Tasks screen, member PIN verified) → **pays** immediately.
- `"session"` → an adult is refused `pin_required` by `sessionPolicyAllows`
  (pre-existing: the adult Tasks-screen path is PIN-verified).
- A **child** actor still queues on every authentication — the child path is
  unchanged.

Because the branch never reads `role`, the spec §3 roster-promotion race (a
member promoted `child → parent` between two roster reads) is closed **by
construction**: the role read can no longer change the outcome. Do not "improve"
this by consulting `role` — that is what reintroduces the race. Pinned by
`tests/unit/task-claim-adult-queue.test.ts` (chat-queues-with-`role: "parent"`,
`pin`-pays, child-unchanged, session-refused, adult reopen, adult approve
idempotency) and by the Option B case in
`tests/unit/hermes-tools-task-crud.test.ts`.

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

**Crew close modes + the daily sweep — CONTRACTS (2026-09-29):**

1. `crewCloseMode` absent ⇒ `strict`; never default-change existing rows.
2. `pendingApproval.crew` is the award list; approval validates membership, never recomputes participation.
3. All crew payouts — strict, parent, deadline — pass through parent approval; `crew-close` and the sweep only stage pendings.
4. `crew-close` rides the claim seam (parent role + parent PIN; receipt + keyed lock like its siblings).
5. The daily sweep is idempotent per local day (`lastDaySweep.day`) and never mutates a task holding a live `pendingApproval`.
6. Sweep failures are labeled `tasks:daysweep:*` and surface through the sync GET's existing failed/reconciled shape (503 only when the sweep itself is unavailable) — never a false success.

**Recurrence + expiry + templates — CONTRACTS (2026-10-01):**

1. **The server sweep is the only recurrence writer.** `task-day-sweep` and the
   week rollover share `recurringLineage` (`src/lib/task-recurrence.ts`) — title +
   cadence + owner identity — and `regenerateRecurringOnTasks` consumes stale
   daily/weekday instances and spawns exactly one clone due today. The client-side
   twin is deleted; no browser path regenerates recurrence. Weekday lineages
   freeze over weekends (Saturday/Sunday consume and spawn nothing).
2. **Expiry culls via tombstones only.** `cullExpiredTasksOnTasks` writes
   `deletedTaskIds` for one-time, incomplete, non-pending rows strictly past
   `due + expiresAfterDays` (cull at N+1, never at N). Completed and
   pending-approval rows are never culled; recurring rows are immune; a task with
   no due date never expires; `expiresAfterDays` is an integer 1–30.
3. **Templates are config-leg data with LWW stamps; prefill-only.**
   `taskTemplates`/`taskTemplatesStamp` ride the snapshot config leg (never a
   second store), and a template only fills the compose form — it never creates
   a task. Writes are replace-with-full-list, so the leg is absent until its
   first write and `upsert`/`delete` against an absent leg is `422`.
4. **All date math is in `due-date-utils` / `local-date` (the 2026-09-29 rule).**
   Presets, calendar cells, `addDaysISO` and `getMonthGrid` are local-day,
   noon-anchored; never parse `YYYY-MM-DD` with `new Date(value)` or slice a UTC
   instant for a day comparison.
5. **`archivedTasks` is rollover-written, bounded to 4 week keys, read-only
   elsewhere.** The week rollover is its only writer; it keeps the newest four
   week keys (one-off completed defs for repeat-last-week), and every other
   surface reads it.

---


## Scaffolding Recipes

### Project Scaffolding Recipes (original content preserved for the coding agent)
When users request features beyond the base template, check `.kilocode/recipes/`.

| Recipe       | File                                | When to Use                                           |
| ------------ | ----------------------------------- | ----------------------------------------------------- |
| Add Database | `.kilocode/recipes/add-database.md` | When user needs data persistence (users, posts, etc.) |

**How to use:** Read the recipe → follow steps → update the relevant memory bank.

