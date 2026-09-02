# Consuela Chat Speed + Wiring Sweep — Design

**Date:** 2026-09-02
**Status:** Approved by user (with the Telegram-poll tightening amendment)
**Scope:** `Home-ai` dashboard — the "Ask Consuela" chat path and Consuela's background wiring across the app.

## 1. Problem (verified evaluation)

A single chat message today pays this serial cost:

1. `UnifiedInput.handleSubmit` calls `POST /api/chat/process` **before** the real send. That route queries `consuela_family_members` + `consuela_saved_locations` — phantom demo collections that don't exist; both reads throw, fall back to `[]`, and the ambiguity check is skipped. Result: a full HTTP round trip + middleware verify + 2 throwing PB reads that produce nothing, on **every** message.
2. `POST /api/hermes/chat` then runs: 2 sequential uncached `getServiceConfig` PB reads (URL + key), up to 4 **serialized, buffered** LLM rounds (no timeout on the Hermes fetch), tool handlers that fetch-whole-collections-then-filter, then 2 sequential PB writes to persist the pair.
3. The client enforces `MIN_THINKING_DELAY = 2000` — every reply waits at least 2 seconds regardless of actual speed.
4. The client then re-fetches the entire daily thread.

Nothing streams end-to-end, so the user stares at typing dots for the full LLM + tool time. Floor for any answer: ~2.5s+; tool answers commonly 4–10s.

Dead/duplicated wiring also exists: orphaned `ConsuelaFAB.tsx`, unused `buildSystemPrompt` in `src/db/features/family-ai.ts`, the dead clarification stack, serial suggestion-engine scanners, serial briefing reads, and a 30-min Telegram mirror cadence.

## 2. Goals / Non-goals

**Goals**
- Remove the dead pre-flight so a send starts the real request immediately.
- Remove the guaranteed 2s floor (keep a small 400ms beat for the orb animation on fast replies).
- Stream the assistant's answer token-by-token (biggest perceived-latency win).
- Parallelize everything independent: config reads, tool calls within a round, persist writes, engine scanners, briefing reads.
- Fail gracefully and fast: 60s timeout on every Hermes call; SSE fallback to buffered mode.
- Remove dead Consuela code; make hot tool handlers use PB-side filters instead of full-collection scans.
- Tighten Telegram mirror poll from 30 min → 5 min (user-approved amendment; host crontab edit + docs).

**Non-goals**
- No changes to Hermes container code itself (only what the dashboard sends it).
- No changes to the suggestion engine's rules, thresholds, or UI.
- No changes to auth/session/role gating semantics (kids still get no house-control tools).
- Existing non-chat AI callers (meal plan generation, recipe parsing, task/reward generation, recipe ingest) keep the buffered JSON mode unchanged.

## 3. Architecture

### 3.1 Landing 1 — Quick wins

- `src/components/chat/UnifiedInput.tsx`: `handleSubmit` calls `onSendMessage(message)` directly. The `/api/chat/process` fetch, clarification state, and modal are removed here (full stack deletion happens in Landing 3).
- `src/app/chat/page.tsx`: `MIN_THINKING_DELAY` 2000 → 400.
- `src/app/api/hermes/chat/route.ts`:
  - `resolveHermes()` results cached in a module-scope var for 10 min (`HERMES_CONFIG_TTL_MS`). Settings → Services "Test" reads fresh config independently, so testing is unaffected; a registry edit propagates within 10 min worst case.
  - The URL and key lookups run via `Promise.all`.
  - `callHermes` fetch gains `AbortSignal.timeout(60_000)`.
  - `persistChatPair` writes both rows via `Promise.all`.

### 3.2 Landing 2 — Streaming (SSE passthrough with server-side tool loop)

Chosen design: **SSE passthrough** (alternatives rejected: "stream only the final round" — requires regenerating the answer; "browser⇄Hermes direct socket" — breaks server-side role gating and tool execution).

**Request contract:** `POST /api/hermes/chat` accepts `stream?: boolean`. When absent/false, the route behaves exactly as today (buffered JSON `{content}`) — this protects meal/task/recipe callers and `ClemAssistant` until it opts in.

**Streaming mode flow:**

```
browser (stream:true)
  → route: session/role gate (unchanged), tools built, history trimmed
  → loop rounds (MAX_ROUNDS, unchanged):
      call Hermes with stream:true
      while deltas arrive:
        content delta → emit SSE "data: {t: <chunk>}"          (browser renders immediately)
        tool_call deltas → accumulate silently
      if round ended with tool_calls:
        emit SSE "event: status" {label} per tool (friendly name map)
        run the round's tool calls with Promise.all
        append assistant+tool messages, next round
      else:
        persist chat pair (Promise.all, awaited before close, failures logged not fatal)
        emit SSE "data: [DONE]"
```

- **Fallback:** if Hermes responds to `stream: true` with a non-SSE error/shape, the route detects it (content-type check) and completes that round from the buffered body. A module-scope flag remembers "no streaming" so later rounds/requests skip the attempt until process restart.
- **Events:** `data: {"t":"…"}` (content token), `event: status` + `data: {"label":"Checking your grocery list…"}`, `event: error` + `data: {"message":…}`, terminator `data: [DONE]`.
- **Client:** new `src/lib/chat-stream.ts` `streamConsuelaChat({message, history, agent?, system?, onToken, onStatus})` — fetch + `response.body.getReader()` SSE parser. Used by `chat/page.tsx` and `ClemAssistant` (Clem gains streaming too; it already skips the pre-flight).
- **Chat page:** tokens append to the assistant bubble as they arrive; status text shows under the typing indicator; on `[DONE]` the bubble is final and the (unchanged) thread reconcile runs; on `error` event the existing error bubble + "Try again" path is used. `MIN_THINKING_DELAY` only applies to the non-streamed fallback path.
- **Timeouts:** the 60s `AbortSignal.timeout` applies per Hermes call in both modes. Overall worst case stays bounded by `MAX_ROUNDS`.

### 3.3 Landing 3 — Cleanup + wiring hygiene

- Delete: `src/components/ui/ConsuelaFAB.tsx` (orphan — zero imports), `buildSystemPrompt`/`family-ai.ts` demo prompt builder (verify no importers), `src/app/api/chat/process/route.ts`, `src/lib/consuela-ai-enhanced.ts`, `src/components/clarification/ClarificationModal.tsx` (last three after grep confirming no remaining importers, with unit test updates).
- Parallelize: `src/lib/consuela/engine.ts` scanner `for` loop → `Promise.all` (each scanner is independent and already failure-isolated); `src/lib/consuela/briefing.ts` post-engine reads → `Promise.all`.
- Tool-handler efficiency in `src/lib/hermes-tools.ts`: convert the worst fetch-all-then-filter reads to PB-side `filter` queries — `complete_task` (tasks + week_data lookups), `adminUpsert*` upserts, `add_grocery_item` per-item duplicate checks, `remove_event`, `complete_grocery_item`, `ha_list_devices`-adjacent reads — using existing `pb-db`/`getAuthedPB` helpers. Behavior (and returned text) unchanged.
- Incremental thread reconcile: after a send, `fetchPBThread` uses the existing `selectChatMessages(threadId, sinceISO)` support (add `?since=` passthrough to `/api/chat/messages` if absent) instead of re-reading the whole day.
- **Telegram mirror cadence:** `scripts/consuela/host-crontab.example` 30 min → 5 min + matching docs. (Host crontab itself is an ops step the user applies on the NAS.)

## 4. Error handling

- Hermes unreachable/timeout → same friendly bubble as today ("…hit a snag… Give me a moment and try again! 🔧"), just faster; mid-stream failure emits `event: error` into the same UI path.
- Tool errors per call remain JSON `{error}` results fed back to the model (unchanged semantics), now executed in parallel.
- Persistence failures stay logged, never break the reply.
- Streaming auto-fallback keeps non-stream Hermes fully functional; `stream:true` is strictly opt-in per request.

## 5. Testing

Repo conventions: vitest unit suite + Playwright probes under `scripts/consuela/` + `tsc` + eslint. Per landing:

- **L1:** UnifiedInput posts only `/api/hermes/chat` (assert no `/api/chat/process` fetch); config-cache TTL test (second request within TTL = no PB read; expired TTL re-reads); timeout maps to friendly content; suite stays green.
- **L2:** SSE route tests with a mocked streaming Hermes: content deltas forwarded in order, tool-call rounds emit status events and return final content, parallel tool execution observed, non-SSE Hermes → buffered fallback, timeout → error event; `chat-stream.ts` parser unit tests (partial chunks, [DONE], error frames); Playwright probe `verify-chat-stream.mjs`: progressive token growth observed in the DOM, status line appears during a mocked tool round, and **zero** `/api/chat/process` requests on send.
- **L3:** deletion safety = grep + suite + typecheck green; engine/briefing behavior unchanged (existing tests pass); filtered tool handlers keep their existing test contract; Playwright regression probe on `/chat` happy path.

Gates after each landing: `tsc --noEmit` clean, eslint clean on touched files, full vitest suite passes (current baseline: 728/729 with the known pre-existing hermes-port failure).

## 6. Docs / ops

- `AGENTS.md` updated in the same session per repo rule: Current Dashboard Snapshot entry, UI Change Record (chat timing + streaming behavior), §3.5 noting the removed `/api/chat/process` route, Change Log entry.
- `scripts/consuela/host-crontab.example`: telegram-poll line `*/30` → `*/5`.
- User-facing summary of the whole sweep provided in plain language.

## 7. Rollout

Three sequentially-merged landings (internal order, one branch is fine): L1 quick wins → L2 streaming → L3 cleanup. Each landing is independently shippable and independently green.
