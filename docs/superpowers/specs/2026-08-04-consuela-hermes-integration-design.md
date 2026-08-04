# Consuela ↔ Hermes Integration — Implementation Spec

**Date:** 2026-08-04
**Status:** Approved for execution (subagent-driven)
**Owner:** Consuela family dashboard (Garcia family)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan stream-by-stream. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Consuela from a chatbot into a proactive family brain: pushes noticed alerts via a Home widget, executes real tool calls in chat, mirrors Telegram into one dashboard thread, auto-generates a 7am briefing card, and runs Google Calendar sync on a 5-min cron.

**Architecture:** New PB collections (`proactive_suggestions`, `chat_messages`, `morning_briefing`) seeded via the existing self-healing `pb-seed.ts`. New suggestion engine in `src/lib/consuela/` reads family data and writes alert rows. Host crontab pings stateless Next.js cron routes (`POST /api/cron/consuela/*`) protected by `CRON_SECRET`. Native OpenAI tool-calling replaces the JSON-envelope chat protocol in `route.ts`. A shared action-runner module makes widget + chat share one execution path.

**Tech Stack:** Next.js 16 (app router), React 19, PocketBase v0.27 (Docker `muchobien/pocketbase`), Hermes-agent container (OpenAI-compatible `/v1/chat/completions`), existing `withAdmin` PB SDK auth, host `crontab`, `node:crypto` for idempotency hashing.

## Global Constraints

- **Push to PB only via `withAdmin`** from `src/lib/pb-auth.ts` — never the browser SDK.
- **Cron routes are stateless** — `export const dynamic = "force-dynamic"`, no module-level state, every request re-auths.
- **Self-healing seed** — additions to `pb-seed.ts:COLLECTIONS` must survive re-runs on an existing DB (the diff-and-patch logic at `pb-seed.ts:242-254` already does this).
- **No new test framework** — verification uses `npm run typecheck && npm run lint && npm run build` + a `scripts/consuela/test-<name>.mjs` curl script + Playwright for UI flows (Playwright is already in `package.json`).
- **Env vars in `.env.example` first, never committed** — `CRON_SECRET`, `CONSUELA_TELEGRAM_POLL_INTERVAL_MS` go to `.env.docker` + `.env.example`.
- **AGENTS.md gets a Change Log entry + new SOP entry per stream** — required by the file's own rules (line ~20: "After any code change that touches UI, navigation, meals, emergency, or integrations, update this file in the same session").
- **Commit frequently** — one stream = one branch = one PR per stream in the suggested order below.
- **After every `npm run build`, restart the container** — `docker restart consuela-dashboard` (faster than rebuild) to fix CSS-chunk desync (Next.js 16.2.6 Turbopack bug, AGENTS.md line ~14).

---

## File Map (created/modified per stream)

### Stream #1 — Proactive suggestions feed
- Modify: `Home-ai/src/lib/pb-seed.ts` — add `proactive_suggestions` collection (after `meal_week_archive`).
- Create: `Home-ai/src/lib/consuela/types.ts` — `ProactiveSuggestion` interface.
- Create: `Home-ai/src/lib/consuela/engine.ts` — `runEngine({ scopeDate })` + scanners.
- Create: `Home-ai/src/lib/consuela/hash.ts` — `idempotencyHashOf(kind, title, scopeDate)`.
- Modify: `Home-ai/src/db/pb-db.ts` — `insertProactiveSuggestions`, `selectPendingSuggestions`, `updateSuggestion`, `deleteStaleSuggestions`.
- Modify: `Home-ai/src/db/index.ts` — re-export the new methods on the `db` facade.
- Create: `Home-ai/src/app/api/cron/consuela/suggestions/route.ts` — POST cron trigger.
- Create: `Home-ai/src/app/api/consuela/suggestions/route.ts` — GET/PATCH public read + lifecycle.
- Modify: `Home-ai/src/lib/layout-config.ts` — add `"consuelaSuggestions"` widget id.
- Modify: `Home-ai/src/app/page.tsx` — add `case "consuelaSuggestions"`.
- Create: `Home-ai/src/components/suggestions/HomeSuggestionsWidget.tsx` — Home widget.
- Create: `Home-ai/src/components/suggestions/hooks/useSuggestions.ts` — polling hook.
- Create: `Home-ai/src/app/suggestions/page.tsx` — full list page.
- Modify: `Home-ai/src/lib/hermes-tools.ts` — add `get_proactive_suggestions` + `dismiss_suggestion` + `action_suggestion` tools.
- Create: `Home-ai/scripts/consuela/test-suggestions.mjs` — curl + assertion script.

### Stream #2 — Native tool powers in chat
- Modify: `Home-ai/src/app/api/hermes/chat/route.ts` — replace JSON envelope with OpenAI `tools` + `tool_calls`, bump `MAX_ROUNDS` to 4.
- Modify: `Home-ai/src/lib/hermes-tools.ts` — make `add_task`, `add_grocery_item`, `complete_task`, `add_event`, `remove_event`, `complete_grocery_item` actually write to PB; delete the now-unused `extractJSON` support in route.ts.
- Create: `Home-ai/src/lib/grocery-service.ts` — extracted `upsertGroceryItem` (shared by chat handler + `useGrocery` hook).
- Create: `Home-ai/src/lib/action-runner.ts` — extracted from `chat/page.tsx:128-362`, shared by widget + chat.
- Modify: `Home-ai/src/components/suggestions/HomeSuggestionsWidget.tsx` — wire action/dismiss buttons through `action-runner`.
- Create: `Home-ai/scripts/consuela/test-chat-tool-call.mjs` — verifies a `add_grocery_item` chat round actually inserts a PB row.

### Stream #3 — Unified chat thread (Telegram mirror)
- Modify: `Home-ai/src/lib/pb-seed.ts` — add `chat_messages` collection.
- Modify: `Home-ai/src/db/pb-db.ts` + `src/db/index.ts` — `insertChatMessage`, `selectChatMessages`.
- Create: `Home-ai/src/app/api/consuela/telegram/mirror/route.ts` — receiver for Telegram polls.
- Create: `Home-ai/src/lib/telegram/get-updates.ts` — `pollTelegramUpdates(lastUpdateId)` calling Telegram bot API `getUpdates`.
- Create: `Home-ai/src/app/api/cron/consuela/telegram-poll/route.ts` — cron trigger.
- Create: `Home-ai/src/app/api/chat/messages/route.ts` — GET unified thread.
- Modify: `Home-ai/src/app/chat/page.tsx` — seed history from PB on mount; keep localStorage as optimistic buffer.
- Modify: `Home-ai/src/app/api/hermes/chat/route.ts` — after Hermes reply, insert `{role:"user",source:"dashboard"}` + `{role:"assistant",source:"dashboard"}` rows.
- Create: `Home-ai/scripts/consuela/test-telegram-mirror.mjs`.

### Stream #4 — Morning briefing card
- Modify: `Home-ai/src/lib/pb-seed.ts` — add `morning_briefing` collection.
- Modify: `Home-ai/src/db/pb-db.ts` + `src/db/index.ts` — `upsertMorningBriefing`, `selectMorningBriefing(scopeDate)`, `ackMorningBriefing(id)`.
- Create: `Home-ai/src/lib/consuela/briefing.ts` — `generateBriefing({ scopeDate })` reusing `engine.runEngine` + meal/task enrichment.
- Create: `Home-ai/src/app/api/cron/consuela/briefing/route.ts` — 7am cron.
- Create: `Home-ai/src/app/api/consuela/briefing/route.ts` — GET + PATCH acknowledged.
- Modify: `Home-ai/src/lib/layout-config.ts` — add `"morningBriefing"` widget id, prepend to DEFAULT_LAYOUT.
- Modify: `Home-ai/src/app/page.tsx` — add `case "morningBriefing"`.
- Create: `Home-ai/src/components/briefing/MorningBriefingWidget.tsx` + `hooks/useMorningBriefing.ts`.
- Create: `Home-ai/scripts/consuela/test-briefing.mjs`.

### Stream #5 — Google Calendar auto-sync cron
- Create: `Home-ai/src/app/api/cron/consuela/google-sync/route.ts` — calls existing `src/lib/google/calendar.ts:syncCalendar` directly.
- Create: `Home-ai/src/lib/google/quota-guard.ts` — `checkQuota(headroomK)` against existing `consuela_google_api_usage`.
- Modify: `Home-ai/src/app/settings/page.tsx` + `src/components/google/GoogleConnectCard.tsx` (find path during impl) — show "auto-sync every 5 min" + "Last auto-sync: …".
- Modify: `Home-ai/.env.example` + `docker-compose.yml` — add `CRON_SECRET`.
- Create: `Home-ai/scripts/consuela/test-google-sync.mjs`.

---

# Suggested execution order (and why)

1. **Stream #5** first. 1 route. Zero new UI. Gives fresher Calendar data, which Stream #1's conflict scanner depends on. Smallest blast radius, immediate visible benefit.
2. **Stream #1** next. The flagship. Generates the actual content Streams #2 and #4 consume.
3. **Stream #4** third. Reuses Stream #1's engine; just produces a different rendering surface.
4. **Stream #2** fourth. Depends on Stream #1's `actionPayload` schema. Rewrites the chat protocol — biggest behavioral change, lands once the suggestion feed is proven working.
5. **Stream #3** last. Largest external-coupling research; depends on Telegram bot token wiring; can land independently and last.

---

# Stream #1 — Proactive Suggestions Feed

## Task 1.1 — PocketBase `proactive_suggestions` collection

**Files:**
- Modify: `src/lib/pb-seed.ts` (insert new collection at line ~167 after `meal_week_archive`)
- Test: `scripts/consuela/test-seed.mjs`

**Interfaces:**
- Produces: PB collection `proactive_suggestions` exists with the fields below.
- Consumes: existing `withAdmin` from `src/lib/pb-auth.ts`, existing `seedCollections` function.

```ts
{
  name: "proactive_suggestions",
  schema: [
    { name: "idempotencyHash", type: "text", required: true },
    { name: "kind",            type: "select", options: { values: ["pantry_low","task_penalty_streak","calendar_conflict","stale_data","custom"] } },
    { name: "severity",        type: "select", options: { values: ["info","warn","alert"] } },
    { name: "title",           type: "text", required: true },
    { name: "body",            type: "text" },
    { name: "emoji",           type: "text" },
    { name: "actionLabel",     type: "text" },
    { name: "actionPayload",   type: "json" },
    { name: "status",          type: "select", options: { values: ["pending","dismissed","actioned","snoozed"] } },
    { name: "snoozedUntil",    type: "date" },
    { name: "scopeDate",       type: "text", required: true },
    { name: "createdAt",       type: "date" },
    { name: "expiresAt",       type: "date" },
  ],
  indexes: [
    { name: "idx_hash_unique",  create: { unique: true, fields: ["idempotencyHash"], query: "" } },
    { name: "idx_status_scope", create: { unique: false, fields: ["status","scopeDate"], query: "" } },
  ],
}
```

> PB v0.27+ uses the structured `indexes: [{ name, create: { unique, fields } }]` shape. If the live PB version rejects this, fall back to `indexes: ["CREATE UNIQUE INDEX idx_hash_unique ON proactive_suggestions (idempotencyHash)"]` strings (PB accepts both per their schema docs).

- [ ] **Step 1:** Confirm PB version inside the container. Run: `docker exec pocketbase /pocketbase --version`. If `<0.27` use the string-indexes form; if `>=0.27` use the structured form.
- [ ] **Step 2:** Edit `src/lib/pb-seed.ts` — insert the new collection object after the `meal_week_archive` block (line ~167).
- [ ] **Step 3:** The existing `seedCollections` patcher at lines 242-254 already handles `select` and `json` types with `options`. Verify it handles the new structured `indexes` — the patcher only touches `schema`, not `indexes`. If the collection already-exists case is hit, you must also patch indexes: read `live.indexes` and merge missing ones. Add ~10 lines at the patcher's existing-collection branch.
- [ ] **Step 4:** Run `npm run pb:seed` inside the dashboard container: `docker exec consuela-dashboard npm run pb:seed`. Expected output: `proactive_suggestions (created)`.
- [ ] **Step 5:** Verify with curl: `docker exec pocketbase /pocketbase admin ls --collection proactive_suggestions` or via the PB admin UI at `http://<nas>:8090/_/`. Confirm 14 fields + 2 indexes exist.
- [ ] **Step 6:** Run a second time: `npm run pb:seed`. Expected: `proactive_suggestions (already exists)`. (Self-healing.)
- [ ] **Step 7:** Write `scripts/consuela/test-seed.mjs` that connects to PB admin and asserts the collection exists. Run: `node scripts/consuela/test-seed.mjs`. Expected exit 0.
- [ ] **Step 8:** Commit: `git add src/lib/pb-seed.ts scripts/consuela/test-seed.mjs && git commit -m "feat(consuela): add proactive_suggestions PB collection"`.

## Task 1.2 — Suggestion types, hash, and DB access layer

**Files:**
- Create: `src/lib/consuela/types.ts`
- Create: `src/lib/consuela/hash.ts`
- Modify: `src/db/pb-db.ts`
- Modify: `src/db/index.ts`
- Test: `scripts/consuela/test-db.mjs`

**Interfaces:**
- Consumes: PB collection from Task 1.1.
- Produces:
  - `ProactiveSuggestion` type (cn-standard for the engine + UI).
  - `idempotencyHashOf(kind: SuggestionKind, title: string, scopeDate: string): string`
  - `db.insertProactiveSuggestions(items: NewSuggestion[]): Promise<InsertResult>` — bulk insert, swallows duplicate-hash 4xx, returns `{ inserted, rejected }`.
  - `db.selectPendingSuggestions(opts?: { scopeDate?: string; limit?: number }): Promise<ProactiveSuggestion[]>` — filter: `status="pending" && scopeDate>="<today>" && (snoozedUntil=null || snoozedUntil<now)`.
  - `db.updateSuggestion(id: string, patch: { status?: SuggestionStatus; snoozedUntil?: string }): Promise<void>`.
  - `db.deleteStaleSuggestions(beforeISO: string): Promise<number>`.

```ts
// src/lib/consuela/types.ts
export type SuggestionKind = "pantry_low" | "task_penalty_streak" | "calendar_conflict" | "stale_data" | "custom";
export type SuggestionSeverity = "info" | "warn" | "alert";
export type SuggestionStatus = "pending" | "dismissed" | "actioned" | "snoozed";

export interface ProactiveSuggestion {
  id: string;
  idempotencyHash: string;
  kind: SuggestionKind;
  severity: SuggestionSeverity;
  title: string;
  body?: string;
  emoji?: string;
  actionLabel?: string;
  actionPayload?: { tool: string; args: Record<string, unknown> };
  status: SuggestionStatus;
  snoozedUntil?: string;
  scopeDate: string;
  createdAt: string;
  expiresAt?: string;
}

export interface NewSuggestion {
  kind: SuggestionKind;
  severity: SuggestionSeverity;
  title: string;
  body?: string;
  emoji?: string;
  actionLabel?: string;
  actionPayload?: { tool: string; args: Record<string, unknown> };
  scopeDate: string;
  expiresAt?: string;
}
```

```ts
// src/lib/consuela/hash.ts
import { createHash } from "node:crypto";
import type { SuggestionKind } from "./types";
export function idempotencyHashOf(kind: SuggestionKind, title: string, scopeDate: string): string {
  const norm = `${kind}|${title.trim().toLowerCase()}|${scopeDate}`;
  return createHash("sha256").update(norm).digest("hex").slice(0, 32);
}
```

- [ ] **Step 1:** Create `types.ts` and `hash.ts` exactly as above.
- [ ] **Step 2:** Add the four methods to `pb-db.ts`. Mirror the existing pattern (e.g. `selectMeals`). Uses `pb.collection("proactive_suggestions")`.
  - `insertProactiveSuggestions`: for each item, build a `create()` body using `idempotencyHashOf(...)`. Try/catch each insert; if `err.status === 400 && err.response?.includes("unique")` increment `rejected` else rethrow. Set `status: "pending"`, `createdAt: new Date().toISOString()`.
  - `selectPendingSuggestions`: build filter = `'status="pending" && scopeDate>="${todayISO()}"'` + optional additional filter for snooze `&& (snoozedUntil=null || snoozedUntil<"${nowISO()}")`. Sort `createdAt DESC`. Limit default 20.
  - `updateSuggestion`: `pb.collection("proactive_suggestions").update(id, patch)`.
  - `deleteStaleSuggestions`: `pb.collection("proactive_suggestions").delete(<query>)` or filter-then-delete loop; returns count.
- [ ] **Step 3:** Add re-exports to `db/index.ts` for the new methods.
- [ ] **Step 4:** Write `scripts/consuela/test-db.mjs` that inserts 3 suggestions (varying kinds, same scopeDate), asserts: 2 inserts succeed, 3rd duplicate-hash insert is rejected, `selectPendingSuggestions` returns ≥2, `updateSuggestion` flips one to dismissed, `selectPendingSuggestions` count drops.
- [ ] **Step 5:** Run `node scripts/consuela/test-db.mjs`. Expected: assertions pass. (Will need `PB_ADMIN_EMAIL` + `PB_ADMIN_PASS` env vars from `.env.docker`.)
- [ ] **Step 6:** Run `npm run typecheck && npm run lint`. Expected: clean.
- [ ] **Step 7:** Commit: `feat(consuela): DB layer for proactive suggestions`.

## Task 1.3 — Suggestion engine scanners

**Files:**
- Create: `src/lib/consuela/engine.ts`
- Test: `scripts/consuela/test-engine.mjs`

**Interfaces:**
- Consumes: `db.selectPantry`, `db.selectEvents`, `db.selectMeals`, `db.selectWeekData` (for transactions), `db.insertProactiveSuggestions`, plus the hash helper.
- Produces:
  - `runEngine(opts: { scopeDate: string }): Promise<{ scanned: number; inserted: number; rejected: number }>`
  - Scanners (each `Promise<NewSuggestion[]>`, pure except DB reads):
    - `scanPantryLow()`
    - `scanTaskPenaltyStreak()` (threshold ≥3 penalties / child / last 7 days)
    - `scanCalendarConflicts()` (overlap on same-day events within 30-min tolerance)
    - `scanStaleData()` (zero meals for current `weekOf`)

```ts
// src/lib/consuela/engine.ts
import { db } from "@/db";
import type { NewSuggestion } from "./types";

function todayISO(): string { return new Date().toISOString().split("T")[0]; }

export async function scanPantryLow(scopeDate: string): Promise<NewSuggestion[]> {
  const pantry = await db.selectPantry();
  const emitting = pantry.filter(p => p.status === "low" || p.status === "out");
  return emitting.map(p => ({
    kind: "pantry_low",
    severity: p.status === "out" ? "warn" : "info",
    title: `${p.item} is ${p.status === "out" ? "out" : "running low"}`,
    body: `Pantry shows ${p.quantity ?? 0} ${p.unit ?? ""} of ${p.item}. Add to grocery list?`,
    emoji: "🥫",
    actionLabel: "Add to grocery",
    actionPayload: { tool: "add_grocery_item", args: { items: p.item } },
    scopeDate,
  }));
}

export async function scanTaskPenaltyStreak(scopeDate: string): Promise<NewSuggestion[]> {
  const week = await db.selectWeekData(/* current week */);
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const penaltiesByChild: Record<string, number> = {};
  for (const tx of week?.history ?? []) {
    if (tx.type === "penalty" && tx.timestamp && new Date(tx.timestamp).getTime() > weekAgo) {
      penaltiesByChild[tx.member] = (penaltiesByChild[tx.member] ?? 0) + 1;
    }
  }
  return Object.entries(penaltiesByChild)
    .filter(([, count]) => count >= 3)
    .map(([child, count]) => ({
      kind: "task_penalty_streak",
      severity: "warn",
      title: `${child} got ${count} penalties this week`,
      body: `Consider checking in — their bedtime chore has tripped ${count} times in 7 days.`,
      emoji: "⚠️",
      actionLabel: "View tasks",
      actionPayload: { tool: "get_pending_tasks", args: { member: child } },
      scopeDate,
    }));
}

export async function scanCalendarConflicts(scopeDate: string): Promise<NewSuggestion[]> {
  const events = await db.selectEvents(scopeDate);
  // sort by start, find overlaps within 30-min tolerance
  // emit one suggestion per overlapping pair
  return [];
}

export async function scanStaleData(scopeDate: string): Promise<NewSuggestion[]> {
  const meals = await db.selectMeals();
  if (meals.filter(m => m.weekOf === currentWeekStart()).length === 0) {
    return [{
      kind: "stale_data",
      severity: "info",
      title: "No meals planned for this week",
      body: "Open the Meals tab and tap ✨ Generate or copy last week's plan.",
      emoji: "🍽️",
      actionLabel: "Open meals",
      actionPayload: { tool: "get_weekly_meals", args: {} },
      scopeDate,
    }];
  }
  return [];
}

export async function runEngine({ scopeDate }: { scopeDate: string }): Promise<{ scanned: number; inserted: number; rejected: number }> {
  const scanners = [scanPantryLow, scanTaskPenaltyStreak, scanCalendarConflicts, scanStaleData];
  let all: NewSuggestion[] = [];
  for (const s of scanners) {
    try {
      const items = await s(scopeDate);
      all = all.concat(items);
    } catch (e) {
      console.error("[consuela.engine] scanner failed:", (e as Error).message);
    }
  }
  const result = await db.insertProactiveSuggestions(all);
  return { scanned: all.length, inserted: result.inserted, rejected: result.rejected };
}
```

Note: `currentWeekStart()` exists as `weekStart()` in `src/lib/task-utils.ts` (and `meals-week-utils.ts` has week math). Use whichever matches the `weekOf` format used by `meal_plan_entries`.

- [ ] **Step 1:** Implement `scanPantryLow` + `runEngine`. Skip conflict scanner for now.
- [ ] **Step 2:** Write `scripts/consuela/test-engine.mjs` that sets up a pantry row with `status:"low"`, runs the engine via `npx tsx`, and asserts 1 insert + 1 row in PB.
- [ ] **Step 3:** Run: `npx tsx scripts/consuela/test-engine.mjs`. Expected: `scanned: 1, inserted: 1, rejected: 0`.
- [ ] **Step 4:** Implement `scanTaskPenaltyStreak`. Add test data to `week_data.history`. Run again. Expected matches.
- [ ] **Step 5:** Implement `scanCalendarConflicts`. Choose two events that overlap on the test scopeDate. Run again.
- [ ] **Step 6:** Implement `scanStaleData`. Run with no meals for current week. Expected emits.
- [ ] **Step 7:** Run `npm run typecheck && npm run lint && npm run build`. All clean.
- [ ] **Step 8:** Commit: `feat(consuela): proactive suggestion engine scanners`.

## Task 1.4 — Cron + public API routes

**Files:**
- Create: `src/app/api/cron/consuela/suggestions/route.ts`
- Create: `src/app/api/consuela/suggestions/route.ts`
- Modify: `.env.example` (add `CRON_SECRET`)
- Modify: `docker-compose.yml` (pass `CRON_SECRET` env)
- Create: `scripts/consuela/host-crontab.example`

```ts
// src/app/api/cron/consuela/suggestions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { runEngine } from "@/lib/consuela/engine";
import { db } from "@/db";

export const dynamic = "force-dynamic";

function todayISO(): string { return new Date().toISOString().split("T")[0]; }
function weekAgoISO(): string { return new Date(Date.now() - 7 * 86400_000).toISOString(); }

export async function POST(request: NextRequest) {
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (request.headers.get("authorization") !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runEngine({ scopeDate: todayISO() });
  await db.deleteStaleSuggestions(weekAgoISO());
  return NextResponse.json({ ok: true, ...result });
}
```

```ts
// src/app/api/consuela/suggestions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await db.selectPendingSuggestions({ limit: 20 });
  return NextResponse.json({ items });
}

export async function PATCH(request: NextRequest) {
  const { id, status, snoozedUntil } = await request.json();
  if (!id || !status) return NextResponse.json({ error: "id+status required" }, { status: 400 });
  await db.updateSuggestion(id, { status, snoozedUntil });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 1:** Create the cron route exactly as above.
- [ ] **Step 2:** Create the public GET/PATCH route.
- [ ] **Step 3:** Add `CRON_SECRET=changeme-please-set-me` to `.env.example`. Add `- CRON_SECRET=${CRON_SECRET:-changeme-please-set-me}` to `docker-compose.yml` env block (line ~36).
- [ ] **Step 4:** Create `scripts/consuela/host-crontab.example`:
  ```
  CONSUELA_CRON_SECRET=__replace_me__
  */5 * * * * curl -fs -m 10 -H "Authorization: Bearer $CONSUELA_CRON_SECRET" http://localhost:3000/api/cron/consuela/suggestions >> ~/consuela-cron.log 2>&1
  0 7 * * *   curl -fs -m 30 -H "Authorization: Bearer $CONSUELA_CRON_SECRET" http://localhost:3000/api/cron/consuela/briefing        >> ~/consuela-cron.log 2>&1
  */5 * * * * curl -fs -m 30 -H "Authorization: Bearer $CONSUELA_CRON_SECRET" http://localhost:3000/api/cron/consuela/google-sync     >> ~/consuela-cron.log 2>&1
  */30 * * * * curl -fs -m 30 -H "Authorization: Bearer $CONSUELA_CRON_SECRET" http://localhost:3000/api/cron/consuela/telegram-poll  >> ~/consuela-cron.log 2>&1
  ```
- [ ] **Step 5:** Restart dashboard container: `docker compose up -d --force-recreate home-dashboard`.
- [ ] **Step 6:** Smoke test from the host (via `docker exec`): `docker exec consuela-dashboard curl -s -X POST -H "Authorization: Bearer Changeme-please-set-me" http://localhost:3000/api/cron/consuela/suggestions`. Expected: `{"ok":true,"scanned":N,"inserted":M,"rejected":0}`. 401 if wrong secret.
- [ ] **Step 7:** GET check: `curl http://localhost:3000/api/consuela/suggestions`. Expected: `{"items":[...]}`.
- [ ] **Step 8:** PATCH check: `curl -X PATCH -H "Content-Type: application/json" -d '{"id":"<id>","status":"dismissed"}' http://localhost:3000/api/consuela/suggestions`. GET again — that row is gone.
- [ ] **Step 9:** Run `npm run typecheck && npm run lint && npm run build`.
- [ ] **Step 10:** Commit: `feat(consuela): suggestions cron + public read/update route`.

## Task 1.5 — Home widget + `/suggestions` page

**Files:**
- Modify: `src/lib/layout-config.ts`
- Modify: `src/app/page.tsx`
- Create: `src/components/suggestions/HomeSuggestionsWidget.tsx`
- Create: `src/components/suggestions/hooks/useSuggestions.ts`
- Create: `src/app/suggestions/page.tsx`

**Pattern reference:** `HomeLeaderboardWidget.tsx` (211 lines) is the canonical widget skeleton — SectionCard wrapper + mounted skeleton + empty state + populated list + "See all →" action + Link out.

- [ ] **Step 1:** In `src/lib/layout-config.ts` add `"consuelaSuggestions"` to the `WidgetId` union, add to `ALL_WIDGETS` the row `{ id: "consuelaSuggestions", label: "Consuela's Suggestions", emoji: "✨", description: "Proactive alerts Consuela noticed for you" }`, append `"consuelaSuggestions"` to `DEFAULT_LAYOUT.widgets` after `"aiQuickAsk"`.
- [ ] **Step 2:** Create `useSuggestions.ts` polling hook. 60s interval (mirrors the global `CacheRefresher`). Returns `{ items, loading, refresh, patch(id, body) }`.
  ```ts
  // src/components/suggestions/hooks/useSuggestions.ts
  "use client";
  import { useEffect, useState } from "react";
  export function useSuggestions(limit = 20) {
    const [items, setItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const refresh = async () => {
      const r = await fetch("/api/consuela/suggestions").then(r => r.json());
      setItems(r.items ?? []);
      setLoading(false);
    };
    const patch = async (id: string, body: Record<string, unknown>) => {
      await fetch("/api/consuela/suggestions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) });
      await refresh();
    };
    useEffect(() => {
      refresh();
      const t = setInterval(refresh, 60_000);
      return () => clearInterval(t);
    }, []);
    return { items, loading, refresh, patch };
  }
  ```
- [ ] **Step 3:** Create `HomeSuggestionsWidget.tsx` modeled on `HomeLeaderboardWidget.tsx`. Use `<SectionCard title="Consuela suggests" icon="✨" action={<Link href="/suggestions" className="text-sm text-[var(--color-accent-selected)]">See all →</Link>}>`. Render rows: emoji + title (bold) + body (muted) + two buttons (`SoftButton size="sm"` for action, `IconButton size="sm" variant="ghost"` × for dismiss). Dismiss calls `patch(id, { status: "dismissed" })`.
- [ ] **Step 4:** Add the widget case to `src/app/page.tsx` in the `widgets.map` switch (around line 288-375):
  ```tsx
  case "consuelaSuggestions": return <div key="consuelaSuggestions" className="mt-3"><HomeSuggestionsWidget /></div>;
  ```
- [ ] **Step 5:** Create `src/app/suggestions/page.tsx` — `PageShell` with a header, filter chips (`All / Pantry / Tasks / Calendar / Stale`), full list (no limit), and snooze controls. Mirror the styling from `tasks/page.tsx` "Consuela suggests" SectionCard (lines 1111-1137).
- [ ] **Step 6:** Rebuild and restart: `docker compose up -d --build home-dashboard && docker restart consuela-dashboard`. (AGENTS.md note: CSS chunks can desync post-build — restart the container to fix layout glitches.)
- [ ] **Step 7:** Visit `http://localhost:3000/`. Verify widget appears (post-rubber default layout self-heal will insert it for existing users thanks to `loadLayoutConfig`).
- [ ] **Step 8:** Playwright smoke (or manual browser): verify tap dismiss → row disappears on next 60s tick; widget empty state shows when no pending suggestions; settings → Layout shows "Consuela's Suggestions" in the list and lets users reorder/hide.
- [ ] **Step 9:** Run `npm run typecheck && npm run lint && npm run build`. Clean.
- [ ] **Step 10:** Commit: `feat(consuela): Home suggestions widget + /suggestions page`.

## Task 1.6 — Hermes tools for suggestions read/dismiss/act

**Files:**
- Modify: `src/lib/hermes-tools.ts`

```ts
// add to TOOLS array after get_dashboard_summary
{
  definition: {
    name: "get_proactive_suggestions",
    description: "Get Consuela's pending proactive alerts that need the family's attention. Returns pantry lows, task penalty streaks, calendar conflicts, etc.",
    parameters: { type: "object", properties: { limit: { type: "number", description: "Max to return (default 10)" } } },
  },
  handler: async (args) => {
    const items = await db.selectPendingSuggestions({ limit: args.limit ?? 10 });
    return summarize(items);
  },
},
{
  definition: {
    name: "dismiss_suggestion",
    description: "Mark a proactive suggestion as dismissed. Use when the user wants to dismiss an alert.",
    parameters: { type: "object", properties: { id: { type: "string", description: "Suggestion id" } }, required: ["id"] },
  },
  handler: async (args) => {
    await db.updateSuggestion(args.id, { status: "dismissed" });
    return JSON.stringify({ ok: true, dismissed: args.id });
  },
},
{
  definition: {
    name: "action_suggestion",
    description: "Run the suggested action attached to a proactive suggestion. e.g. add a pantry item to the grocery list.",
    parameters: { type: "object", properties: { id: { type: "string", description: "Suggestion id" } }, required: ["id"] },
  },
  handler: async (args) => {
    // Full implementation lands in Stream #2 Task 2.2 — for now, find the suggestion, fetch its actionPayload,
    // look up the named tool, call tool.handler(args). Mark the suggestion actioned.
    return JSON.stringify({ ok: true, actionedLater: true });
  },
},
```

- [ ] **Step 1:** Add the three tools above.
- [ ] **Step 2:** Rebuild: `docker compose up -d --build home-dashboard && docker restart consuela-dashboard`.
- [ ] **Step 3:** Ask Consuela via chat: "any suggestions pending?". Expected: the agent calls `get_proactive_suggestions` and returns a natural-language list.
- [ ] **Step 4:** Ask: "dismiss the first one". Expected: agent calls `dismiss_suggestion`, returns success.
- [ ] **Step 5:** Run `npm run typecheck && npm run lint`. Clean.
- [ ] **Step 6:** Commit: `feat(consuela): Hermes tools get/dismiss/act suggestions`.
- [ ] **Step 7:** Update `AGENTS.md` — add a new Common Journey ("How do I see what Consuela noticed?"), a new UI Change Record, and a Change Log entry. Commit: `docs(agents): proactive suggestions feed`.

---

# Stream #2 — Native tool powers in chat

## Task 2.1 — Extract grocery-service + action-runner

**Files:**
- Create: `src/lib/grocery-service.ts`
- Create: `src/lib/action-runner.ts`
- Modify: `src/hooks/useGrocery.ts` (use the extracted service)
- Modify: `src/app/chat/page.tsx` (use the extracted runner)

- [ ] **Step 1:** Create `src/lib/grocery-service.ts` containing the body of `addGroceryItem` from `src/hooks/useGrocery.ts` — same `upsertGroceryItem` + dedupe logic, no React state. Signature: `upsertGroceryItem(input: GroceryInput): Promise<GroceryItem>`.
- [ ] **Step 2:** Refactor `useGrocery.ts:addGroceryItem` to call the service and then `setGroceryItems(prev => ...)` with the returned item.
- [ ] **Step 3:** Create `src/lib/action-runner.ts` exporting `runAction(action): Promise<{ success, message }>` — extracted from `chat/page.tsx:128-362`. The case `grocery` calls `grocery-service.upsertGroceryItem`. Cases `meal`, `task`, `event`, `pantry`, `recipe`, `reward`, `clear`, `schedule` use the corresponding existing helpers.
- [ ] **Step 4:** Refactor `chat/page.tsx` to import `runAction`; remove the inlined `executeAction` (~230 lines).
- [ ] **Step 5:** Run `npm run typecheck && npm run lint`. Clean.
- [ ] **Step 6:** Manually test the chat "Add milk to grocery" flow with an `actions[]` reply. Verify item still appears in Grocery.
- [ ] **Step 7:** Commit: `refactor(chat): extract grocery-service and action-runner`.

## Task 2.2 — Make write-tools actually persist

**Files:**
- Modify: `src/lib/hermes-tools.ts` — rewrite handlers

- [ ] **Step 1:** Rewrite `add_grocery_item` handler:
  ```ts
  handler: async (args) => {
    const names = (args.items ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
    const inserted = [];
    for (const name of names) {
      inserted.push(await upsertGroceryItem({ name, category: inferCategory(name), source: "chat" }));
    }
    return summarize({ inserted: inserted.length, items: inserted.map(i => ({ name: i.name, emoji: i.emoji, category: i.category })) });
  },
  ```
- [ ] **Step 2:** Rewrite `add_task` handler to call `upsertTask` from `task-utils.ts`. Returns `{ taskId, title, assignee }`.
- [ ] **Step 3:** Add `complete_task` handler that calls the same logic `tasks/page.tsx:submitPin` uses (server-side eventually — for now reuse `task-utils.markTaskCompleted` if it exists; otherwise PATCH the `tasks` PB row's `status:"done"` and append the earn transaction to `week_data`).
- [ ] **Step 4:** Add `add_event`, `remove_event`, `complete_grocery_item` similarly.
- [ ] **Step 5:** Run `npm run typecheck && npm run lint`. Clean.
- [ ] **Step 6:** Verify via test script `scripts/consuela/test-chat-tool-call.mjs` — POST to `/api/hermes/chat` with `message: "add milk, eggs, and bread to the grocery list"`, assert that within 5s the rows show up in PB `grocery_list_items`.
- [ ] **Step 7:** Commit: `feat(consuela): chat tool handlers actually persist writes`.

## Task 2.3 — Switch `/api/hermes/chat` to native OpenAI tool-calling

**Files:**
- Modify: `src/app/api/hermes/chat/route.ts` (rewrite FIRST_ROUND_PROMPT block, replace `extractJSON` with `tool_calls` parsing)

- [ ] **Step 1:** Update `callHermes` signature to accept `tools` and `tool_choice`:
  ```ts
  async function callHermes(messages, opts: { maxTokens?: number; tools?: any[]; toolChoice?: "auto" | "none" } = {}): Promise<{ content: string; tool_calls?: any[] }> {
    const res = await fetch(`${HERMES_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${HERMES_API_KEY}` },
      body: JSON.stringify({
        model: HERMES_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: opts.maxTokens ?? 1024,
        tools: opts.tools,
        tool_choice: opts.toolChoice ?? "auto",
      }),
    });
    // ... existing error handling ...
    const data = await res.json();
    return { content: data.choices?.[0]?.message?.content || "", tool_calls: data.choices?.[0]?.message?.tool_calls };
  }
  ```
- [ ] **Step 2:** Replace FIRST_ROUND_PROMPT-driven round 1 with: send messages + `tools: buildToolsForOpenAI()`. Save the system prompt as a smaller persona-only system message ("You are Consuela, the Garcia family's AI assistant…").
- [ ] **Step 3:** Parse `tool_calls[0]`: if present, run the named tool, append `{role:"tool", tool_call_id, content: <result>}` to messages, call Hermes again with `toolsChoice: "none"` for the final natural reply. Loop up to `MAX_ROUNDS = 4` if Hermes issues more tool callbacks (e.g. "list pantry first, then add to grocery").
- [ ] **Step 4:** Bump `MAX_ROUNDS` from 2 to 4.
- [ ] **Step 5:** Delete `extractJSON`, `toolListForPrompt`, `FIRST_ROUND_PROMPT`, `CASUAL_PROMPT`. Keep `FINAL_ROUND_PROMPT`.
- [ ] **Step 6:** Run `npm run typecheck && npm run lint && npm run build`. Clean.
- [ ] **Step 7:** Restart the dashboard. Smoke test: "what's on the grocery list?" → expect a real tool_call → real data → natural reply. "Add milk" → expect `add_grocery_item` called → real row in PB.
- [ ] **Step 8:** Run `node scripts/consuela/test-chat-tool-call.mjs`. Expected: assertions pass.
- [ ] **Step 9:** Commit: `refactor(chat): switch to native OpenAI tool-calling, bump MAX_ROUNDS to 4`.
- [ ] **Step 10:** Update `AGENTS.md` §5.3 (add chat-tool powers) + Change Log entry.

---

# Stream #3 — Unified chat thread (Telegram mirror)

## Task 3.1 — `chat_messages` PB collection + DB layer

**Files:**
- Modify: `src/lib/pb-seed.ts`
- Modify: `src/db/pb-db.ts` + `src/db/index.ts`

```ts
// in COLLECTIONS, after proactive_suggestions
{
  name: "chat_messages",
  schema: [
    { name: "userId",    type: "text", required: true },
    { name: "role",      type: "select", options: { values: ["user", "assistant", "system"] } },
    { name: "content",   type: "text", required: true },
    { name: "source",    type: "select", options: { values: ["telegram", "dashboard", "api"] } },
    { name: "threadId",  type: "text", required: true },
    { name: "createdAt", type: "date" },
  ],
  indexes: [
    { name: "idx_thread_created", create: { unique: false, fields: ["threadId", "createdAt"], query: "" } },
  ],
}
```

- [ ] **Step 1:** Add the collection. Seed. Verify self-heal. Test idempotency.
- [ ] **Step 2:** Add `insertChatMessage` + `selectChatMessages(threadId, sinceISO?)` to `pb-db.ts` + `db/index.ts`.
- [ ] **Step 3:** Thread id = `YYYY-MM-DD` (daily thread). Document the convention in `AGENTS.md` §3.
- [ ] **Step 4:** Write `scripts/consuela/test-chat-messages.mjs`, run. Expected assertions pass.
- [ ] **Step 5:** Commit: `feat(consuela): chat_messages PB collection`.

## Task 3.2 — Telegram getUpdates poller

**Files:**
- Create: `src/lib/telegram/get-updates.ts`
- Create: `src/app/api/cron/consuela/telegram-poll/route.ts`
- Modify: `.env.example` (add `TELEGRAM_MIRROR_BOT_TOKEN`)

```ts
// src/lib/telegram/get-updates.ts
export async function pollTelegramUpdates(lastUpdateId: number | undefined): Promise<TgUpdate[]> {
  const token = process.env.TELEGRAM_MIRROR_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_MIRROR_BOT_TOKEN missing");
  const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId ? lastUpdateId + 1 : ""}&timeout=30`;
  const r = await fetch(url);
  const data = await r.json();
  return data.ok ? data.result : [];
}
```

Design rationale (addresses the Telegram-token exclusivity constraint):
- **Poll, don't webhook.** The Hermes default gateway already owns the main bot token long-poll. A *second* long-poll on the same token would conflict (Telegram `getUpdates` is exclusive per bot).
- **Use a separate mirror bot** (`TELEGRAM_MIRROR_BOT_TOKEN`): add the mirror bot to the family Telegram group as a non-admin member. Telegram bots in groups can read all messages by default. The mirror bot uses `getUpdates` for read-only access to the group's history. This honors the "mirror Telegram → PB" goal without touching the Hermes-owned token.

- [ ] **Step 1:** (User action) Create a second bot via @BotFather, name it `Consuela Mirror`, get a token, add the bot to the family Telegram group as a *non-admin* member. Set `TELEGRAM_MIRROR_BOT_TOKEN` in `.env.docker` + `.env.example` + `docker-compose.yml`.
- [ ] **Step 2:** Implement `pollTelegramUpdates` (above).
- [ ] **Step 3:** Implement `src/app/api/cron/consuela/telegram-poll/route.ts` — secrets-check `CRON_SECRET` — fetches updates, normalizes each into `{ userId: <from user's first_name>, role:"user", content: <text>, source:"telegram", threadId:<date of message> }`, calls `db.insertChatMessage`.
- [ ] **Step 4:** Restart dashboard.
- [ ] **Step 5:** Test: send a Telegram message in the group. Run the cron route. Verify a row appears in `chat_messages` with `source:"telegram"`.
- [ ] **Step 6:** Commit: `feat(consuela): telegram mirror poller`.

## Task 3.3 — Dashboard chat writes to PB

**Files:**
- Modify: `src/app/api/hermes/chat/route.ts`
- Modify: `src/app/chat/page.tsx`

- [ ] **Step 1:** In `route.ts`, after building the final response, add:
  ```ts
  const threadId = todayISO();
  await db.insertChatMessage({ userId: <userId from auth or "guest">, role: "user", content: message, source: "dashboard", threadId });
  await db.insertChatMessage({ userId: "consuela", role: "assistant", content: finalResponse, source: "dashboard", threadId });
  ```
  Reading the userId requires checking the auth cookie — the existing `/api/hermes/chat` route doesn't currently check `authorization`. Add a quick parse of the `x-consuela-user` cookie if present, fall back to `"guest"`.
- [ ] **Step 2:** Create `GET /api/chat/messages?threadId=<date>` returning ordered list.
- [ ] **Step 3:** In `chat/page.tsx`, on mount, fetch `GET /api/chat/messages?threadId=<today>` and seed messages if localStorage is empty. Keep localStorage as the optimistic buffer; on every successful save+reply round, also re-fetch to reconcile with PB.
- [ ] **Step 4:** Restart dashboard.
- [ ] **Step 5:** Test: send a dashboard chat message. Close and reopen the tab on another device. The chat history should rehydrate from PB within ~5s.
- [ ] **Step 6:** Test mirroring: send a Telegram message; refresh dashboard `/chat` page within 30s; verify the message appears on the dashboard thread.
- [ ] **Step 7:** Commit: `feat(consuela): unified chat thread across Telegram + dashboard`.
- [ ] **Step 8:** Update `AGENTS.md` (Section 1.5 — add a Common Journey "How do Telegram and dashboard chat sync?").

---

# Stream #4 — Morning briefing card

## Task 4.1 — `morning_briefing` PB collection + DB layer

**Files:**
- Modify: `src/lib/pb-seed.ts`
- Modify: `src/db/pb-db.ts` + `src/db/index.ts`

```ts
{
  name: "morning_briefing",
  schema: [
    { name: "scopeDate",   type: "text", required: true },
    { name: "summary",     type: "json" },     // { events, tasks, meals, conflicts, suggestions }
    { name: "generatedAt", type: "date" },
    { name: "acknowledged", type: "bool" },
  ],
  indexes: [
    { name: "idx_scope_unique", create: { unique: true, fields: ["scopeDate"], query: "" } },
  ],
}
```

- [ ] **Step 1:** Add the collection. Seed. Test idempotency.
- [ ] **Step 2:** Add `upsertMorningBriefing(scopeDate, summary)`, `selectMorningBriefing(scopeDate?)`, `ackMorningBriefing(id)` to `pb-db.ts` + `db/index.ts`.
- [ ] **Step 3:** Test script. Commit: `feat(consuela): morning_briefing PB collection`.

## Task 4.2 — Briefing generator + cron route

**Files:**
- Create: `src/lib/consuela/briefing.ts`
- Create: `src/app/api/cron/consuela/briefing/route.ts`
- Create: `src/app/api/consuela/briefing/route.ts`

```ts
// src/lib/consuela/briefing.ts
import { runEngine } from "./engine";
import { db } from "@/db";

export async function generateBriefing({ scopeDate }: { scopeDate: string }) {
  await runEngine({ scopeDate }); // refreshes today's suggestions
  const events = (await db.selectEvents(scopeDate)) ?? [];
  const tasks = (await db.selectTasks())?.filter(t => t.status === "pending") ?? [];
  const meals = (await db.selectMeals())?.filter(m => m.weekOf === currentWeekStart()) ?? [];
  const suggestions = await db.selectPendingSuggestions({ scopeDate, limit: 5 });
  const summary = { events: events.slice(0, 5), tasks: tasks.slice(0, 6), meals, suggestions, generatedAt: new Date().toISOString() };
  await db.upsertMorningBriefing(scopeDate, summary);
  return summary;
}
```

- [ ] **Step 1:** Create `briefing.ts` + the two routes (cron POST + public GET/PATCH).
- [ ] **Step 2:** Add the 7am line to `scripts/consuela/host-crontab.example` (already drafted in Task 1.4 Step 4).
- [ ] **Step 3:** Restart dashboard. Manually trigger cron route. Verify a row appears in `morning_briefing`.
- [ ] **Step 4:** Tests + commit: `feat(consuela): morning briefing generator + cron`.

## Task 4.3 — Briefing Home widget + acknowledgment

**Files:**
- Modify: `src/lib/layout-config.ts` (add `"morningBriefing"` widget id, prepend to `DEFAULT_LAYOUT`)
- Modify: `src/app/page.tsx` (switch case)
- Create: `src/components/briefing/MorningBriefingWidget.tsx`
- Create: `src/components/briefing/hooks/useMorningBriefing.ts`

Pattern reference: `HomeLeaderboardWidget.tsx`, but more collapsible. Sections: 📅 today's events (≤5), ✅ priority tasks (≤6), 🍽️ meals, ✨ Consuela's noticed (≤5). Collapsed by default; expand on tap. "Got it" button → PATCH `acknowledged:true`, widget auto-collapse + visually fade on next render.

- [ ] **Step 1:** Add widget id + case + DEFAULT_LAYOUT prepend.
- [ ] **Step 2:** Create hook polling `/api/consuela/briefing` every 60s.
- [ ] **Step 3:** Create widget with collapsible card + "Got it" button.
- [ ] **Step 4:** Rebuild + restart. Verify widget appears at top of Home on all signed-in devices without refresh (PB-poll-driven).
- [ ] **Step 5:** Tap "Got it" → widget collapses, "Acknowledged ✓" badge appears, on next 60s poll the whole card slides up and out for the day (do not auto-delete — PB row stays until next day's overwrite).
- [ ] **Step 6:** Commit: `feat(consuela): morning briefing Home widget`.
- [ ] **Step 7:** Update `AGENTS.md` — Change Log + Common Journey "Why is there a morning briefing card at the top of Home?".

---

# Stream #5 — Google Calendar auto-sync cron

## Task 5.1 — Quota guard + cron route

**Files:**
- Create: `src/lib/google/quota-guard.ts`
- Create: `src/app/api/cron/consuela/google-sync/route.ts`

```ts
// src/lib/google/quota-guard.ts
import { withAdmin } from "../pb-auth";
export async function checkQuota(headroomK = 2): Promise<{ ok: boolean; used: number; cap: number }> {
  return withAdmin(async (pb) => {
    const today = new Date().toISOString().split("T")[0];
    const rows = await pb.collection("consuela_google_api_usage").getFullList({ filter: `day="${today}"` });
    const used = rows.reduce((acc, r) => acc + (r.count ?? 0), 0);
    const cap = 50_000 - headroomK * 1000;
    return { ok: used < cap, used, cap };
  });
}
```

```ts
// src/app/api/cron/consuela/google-sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { syncCalendar } from "@/lib/google/calendar";
import { checkQuota } from "@/lib/google/quota-guard";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const quota = await checkQuota();
  if (!quota.ok) return NextResponse.json({ ok: false, reason: "quota", ...quota });
  const result = await syncCalendar();
  return NextResponse.json({ ok: true, result, quota });
}
```

- [ ] **Step 1:** Create the quota guard + cron route. Reuse existing `syncCalendar` from `src/lib/google/calendar.ts`.
- [ ] **Step 2:** Add to `scripts/consuela/host-crontab.example` (every 5 min):
  ```
  */5 * * * * curl -fs -m 30 -H "Authorization: Bearer $CONSUELA_CRON_SECRET" http://localhost:3000/api/cron/consuela/google-sync
  ```
- [ ] **Step 3:** Restart dashboard. Manually hit the cron route. Verify `consuela_google_calendar_events` PB has updates from `<now>`.
- [ ] **Step 4:** Commit: `feat(consuela): Google Calendar auto-sync cron`.

## Task 5.2 — UI affordance

**Files:**
- Modify: `src/components/google/GoogleConnectCard.tsx` (find path via grep during impl)
- Modify: `src/app/settings/page.tsx` (text near the Google card)

- [ ] **Step 1:** Find `GoogleConnectCard.tsx`. Replace "Sync now" button label with "Sync now (also runs every 5 min)".
- [ ] **Step 2:** Add a "Last auto-sync" line reading from `consuela_google_sync_state.lastSyncedAt`. Format as "Synced Ns ago".
- [ ] **Step 3:** Rebuild + restart. Verify the new text appears when Google is connected.
- [ ] **Step 4:** Commit: `docs(settings): reflect Calendar auto-sync in Google card`.
- [ ] **Step 5:** Update `AGENTS.md` — Change Log + Common Journey ("How often does Calendar sync?") + Section 5.3 annoyance bullet removed.

---

# Cross-cutting work (do once at the end)

## Task X.1 — Secrets + env wiring

**Files:**
- Modify: `.env.example` (add `CRON_SECRET=`, `TELEGRAM_MIRROR_BOT_TOKEN=`)
- Modify: `docker-compose.yml` (pass both env vars with safe defaults)
- Modify: `scripts/consuela/host-crontab.example` (final consolidated crontab listing all 5 cron endpoints)

## Task X.2 — AGENTS.md updates

After each stream lands, the per-stream Step "Update AGENTS.md" already covers this. A consolidated Section 1.5/Q&A pass at the end ensures the 5 new Common Journeys flow well together.

---

# Per-stream verification matrix

| Stream | Typecheck | Lint | Build | Restart container | Manual API smoke | Playwright UI | Test script |
|---|---|---|---|---|---|---|---|
| #1 | ✓ | ✓ | ✓ | ✓ (`--build`) | ✓ 4 endpoints | ✓ widget + page | ✓ `test-seed/db/engine/suggestions.mjs` |
| #2 | ✓ | ✓ | ✓ | ✓ | ✓ 1 endpoint rewritten | ✓ chat tool call works | ✓ `test-chat-tool-call.mjs` |
| #3 | ✓ | ✓ | ✓ | ✓ | ✓ 2 endpoints + poller | ✓ chat history rehydrates | ✓ `test-chat-messages.mjs` |
| #4 | ✓ | ✓ | ✓ | ✓ | ✓ 2 endpoints + 7am cron | ✓ briefing card appears | ✓ `test-briefing.mjs` |
| #5 | ✓ | ✓ | ✓ | ✓ | ✓ 1 cron endpoint | ✓ "auto-sync" label | ✓ `test-google-sync.mjs` |
