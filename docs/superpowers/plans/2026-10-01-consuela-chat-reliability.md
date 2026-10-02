# Consuela Chat Reliability + Thinking UI + Tool Gaps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (the approach the user approved, spec §11) or `superpowers:executing-plans` to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replies always render live — fix the deterministic id collision that swallows
replies, close seven supporting weaknesses, upgrade the thinking display the user likes,
and fill the approved tool gaps so Consuela can actually operate the dashboard.

**Architecture:** Three landings. **L1** fixes the client/server rendering contract — the
optimistic-id collision, the watchdog that never races the read loop, the discarded route
error text, and the round/attempt mismatch that makes displayed ≠ persisted. **L2** adds
reasoning + tool-activity visibility end-to-end as a new set of SSE frames, display-only by
construction. **L3** adds 8 tools following the registry's existing role/PIN safety model.
Every fix is brain-agnostic — the provider chain is resolved at runtime from PocketBase.

**Tech Stack:** Next.js 16 App Router, React 19, PocketBase via `withAdmin`, vitest 4 +
jsdom, Playwright probes, `scripts/write-ai-boot.mjs` persona drift gate.

**Spec:** `docs/superpowers/specs/2026-10-01-consuela-chat-reliability-design.md`

---

## Global Constraints

- **Stage only explicit file paths.** Never `git add .` or `git add -A`.
- **Test commands:** `npx vitest run <file>` (single) · `npx vitest run` (full suite).
- **Gates:** `npm run typecheck` · `npm run lint` (0 new errors on touched files) · `npm run build`.
- **Baseline:** full suite green at `0b47af4` (4,644 tests). `public/version.json` is modified
  by a build — **it is not ours**, leave it unstaged.
- **Commit cadence:** commit after each task. Confirm with the user before the first commit
  of the session.
- **Repo rule:** `AGENTS.md` + `CHANGELOG.md` must be updated in the same session as the code
  (T17). Contracts belong in `docs/ARCHITECTURE.md` (T15), visual standards in
  `docs/DESIGN.md` (T16).
- **Safety invariants (binding, spec §8):**
  - Points **and** reward redemptions never move from chat. Only PIN-confirmed chips; the
    server re-verifies (`/api/consuela/planner/apply`, `/api/rewards/redeem`).
  - The kid tool surface stays **reads-only**. New kid reads go into **both**
    `KID_TOOL_NAMES` and `ai/KID.md` — the drift gate enforces it.
  - Reasoning text + tool activity are **display-only**; stripped before any persistence.
  - `textEmoji()` on any member/hall emoji surfaced in tool output (photo data-URLs are
    100KB+ base64 and blow the provider request limit — a documented live failure).
  - UI: 12px type floor, ≥44px targets, tokens only, reduced-motion respected.

### Corrections to the spec — code-verified, these override the spec text

The spec was written from a prior analysis session. Five claims did not survive reading the
actual source, and one design decision was strengthened. Implement to the corrections:

1. **The brain is not Hermes.** Spec §1 says the chain resolves through
   `hermes-agent-2:8642` → OpenCode Go → `deepseek-v4-flash`. That is the pre-2026-09-07
   architecture. Hermes left the chat path (`Dockerfile.hermes` is referenced by neither
   compose file; no `src/` module reads `HERMES_API_URL`). Providers now come from
   `consuela_ai_providers` in PocketBase. The *reasoning-model observation* still holds —
   `route.ts:284-290` demonstrably handles `reasoning_content` — so every fix below stands.
   Only the environment note is stale.
2. **Use `event: attempt`, not `event: round`.** Spec §4.1.7 proposes round frames. Round
   granularity does not achieve "displayed == persisted"; attempt granularity does, and
   covers two paths round frames miss. See **T6** for the trace.
3. **`X-Accel-Buffering` must be *added*.** Spec §4.1.4 lists it as a missing weakness —
   correct, and the streamed `Response` (`route.ts:545-551`) carries only three headers.
4. **`resolveMealDay` does not exist.** Spec §4.3 says `remove_meal` shares it with
   `add_meal`. Day resolution is currently *inline* in `add_meal` (`hermes-tools.ts:1155-1171`).
   Extracting it is a new function, not a lookup. See **T12**.
5. **The watchdog is not a bare `setTimeout`.** Spec W1 cites `chat-stream.ts:63-64` as an
   uncleared timer; it is `AbortSignal.timeout(300_000)` bound to `fetch` only. The bug is
   real but the mechanism differs — the signal never reaches the read loop. See **T2**.
6. **`send()`'s catch is 374-423**, not 404-421 (that is the error-copy branch only). The
   load-bearing line is `void error;` at **423** — the thrown route message is discarded there.

### Baseline facts worth knowing before you start

- `msgCounter` starts at `100` (`chat-store.ts:171`) and **only ever increments in production**;
  the sole reset is `__resetChatStoreForTests()` at :472.
- Three id spaces share one React-keyed list: `1` (seed greeting) · `101+` (optimistic) ·
  `2_000_000+` (PB synthetic, regenerated on every reconcile at :154).
- `parseSSEFrames` (`chat-stream.ts:41-57`) already drops comment-only frames (no `data:`
  line ⇒ :54 skips the frame), so the T4 heartbeat needs no parser change.
- `onToken(full)` already **overwrites** (`chat-store.ts:315`), not appends — which is why
  T6 needs no new store API.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/chat-store.ts` | Modify (T1,T2,T3,T9) | Id allocation, watchdog plumbing, route-error passthrough, thinking/tool state |
| `src/lib/chat-stream.ts` | Modify (T2,T6,T9) | SSE client: composed fail signal, attempt reset, reasoning/tool callbacks, protocol docs |
| `src/app/api/hermes/chat/route.ts` | Modify (T4,T5,T6,T7,T8,T13) | Attempt/reasoning/tool frames, heartbeat, header, tool-call ids, streamed timeout, proposal map |
| `src/lib/hermes-tools.ts` | Modify (T11,T12,T13) | 8 new tools, `resolveMealDay` extraction, `KID_TOOL_NAMES` growth |
| `src/lib/consuela/live-reads.ts` | Modify (T11) | `liveTimeCapsules`, `liveSkillTree` — honest null-on-failure readers |
| `src/components/chat/ThinkingDisclosure.tsx` | Create (T10) | Collapsible reasoning transcript |
| `src/components/chat/ToolActivityChips.tsx` | Create (T10) | Per-tool ⏳/✅/❌ activity chips |
| `src/components/chat/RedeemRewardChip.tsx` | Create (T14) | PIN chip for reward redemption |
| `src/app/chat/page.tsx` | Modify (T10,T14) | Render the new components |
| `ai/KID.md`, `ai/TOOLS.md` | Modify (T11–T13) | Drift-gated persona docs — must ship WITH the tools |
| `scripts/consuela/verify-chat-reliability.mjs` | Create (T18) | Live reliability probe (new stream pattern) |
| `docs/ARCHITECTURE.md` | Modify (T15) | SSE contract rewrite |
| `docs/DESIGN.md` | Modify (T16) | UI Change Records |
| `CHANGELOG.md`, `AGENTS.md` | Modify (T17) | Ship record + snapshot |
| `tests/unit/chat-store.test.ts`, `chat-stream.test.ts`, `hermes-chat-stream.test.ts`, `chat-page-stream.test.tsx`, `chat-redeem-chip.test.tsx` | Modify/Create | Per-task suites |

---
## Landing 1 — Replies reliably render

### Task 1: Collision-proof optimistic ids

> `msgCounter` resets to 100 per page load while `persistHistory()` keeps prior sessions'
> messages (ids ~101, 102, …) in localStorage. A fresh session's optimistic reply row then
> **overwrites** a stale assistant row instead of appending — the stale row carries an old
> timestamp, so the reply sorts far above the newest messages. The dots stop and nothing
> appears. Refresh re-hydrates from PB (synthetic 2M ids, no collision) and the reply is
> there. The 2026-09-04 review fixed this class for PB rows only; localStorage rows were
> left untouched. This is the headline root cause.

**Files:**
- Modify: `src/lib/chat-store.ts:171` (counter), `203-222` (`ensureHydrated`), `246-264` (allocation)
- Modify: `tests/unit/chat-store.test.ts`

**Interfaces:**
- Produces: `nextOptimisticId(): number` — the single allocation seam. Every optimistic id
  (user row, stream bubble, error bubble, reset marker) goes through it, so the three id
  spaces can never interleave.
- Invariant: optimistic ids stay **strictly below** `pbSyntheticIdCounter` (2,000,000),
  disjoint by construction from PB ids.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/chat-store.test.ts`. The suite already hoists a `streamConsuelaChat` mock
(4-5) and resets the store in `beforeEach` (25-30), so seed localStorage before `ensureHydrated()`:

```ts
it("appends the reply instead of overwriting a stale localStorage row", async () => {
  localStorage.setItem("consuela-chat-messages", JSON.stringify([
    { id: 101, role: "assistant", content: "yesterday's answer", timestamp: "Yesterday", at: 1 },
    { id: 102, role: "assistant", content: "another stale row", timestamp: "Yesterday", at: 2 },
  ]));
  streamMock.fn.mockImplementation(async ({ onToken }: any) => {
    onToken("today's answer", "today's answer");
    return { content: "today's answer", streamed: true };
  });
  await ensureHydrated();
  await send("hello", SPEAKER);
  const msgs = getSnapshot().messages;
  // The reply is its OWN row, and neither stale row was clobbered.
  expect(msgs.filter((m) => m.content === "today's answer")).toHaveLength(1);
  expect(msgs.find((m) => m.id === 101)?.content).toBe("yesterday's answer");
  expect(msgs.find((m) => m.id === 102)?.content).toBe("another stale row");
  expect(new Set(msgs.map((m) => m.id)).size).toBe(msgs.length); // no duplicate React keys
});
```

- [ ] **Step 2: Run it to confirm the red baseline**

Run: `npx vitest run tests/unit/chat-store.test.ts`
Expected: FAIL — the "today's answer" row is missing or `101` was overwritten.

- [ ] **Step 3: Implement `reseedOptimisticCounter` + `nextOptimisticId`**

In `chat-store.ts`, replace the bare counter reads with a helper and reseed after hydration:

```ts
/**
 * Optimistic ids must never collide with rows rehydrated from localStorage.
 * `persistHistory()` keeps prior sessions' messages (ids 101, 102, …) while
 * msgCounter starts at 100 every page load — so a fresh reply row could land
 * on a stale row and OVERWRITE it instead of appending. Reseeding above every
 * merged id fixes it; PB ids live at 2_000_000+ and stay disjoint by construction.
 */
function reseedOptimisticCounter(rows: Message[]): void {
  let max = 100;
  for (const m of rows) {
    if (typeof m.id === "number" && m.id < pbSyntheticIdCounter) max = Math.max(max, m.id);
  }
  msgCounter = max + 1;
}

/** The single allocation seam for optimistic ids. */
function nextOptimisticId(): number {
  msgCounter += 1;
  return msgCounter;
}
```

Call `reseedOptimisticCounter` at the end of `ensureHydrated()`'s first branch (after the
merge at :211), and replace all four `msgCounter += 1` sites (:246, :260-261, :410, :441-443)
with `nextOptimisticId()`.

- [ ] **Step 4: Verify green**

Run: `npx vitest run tests/unit/chat-store.test.ts`
Expected: PASS (8/8)

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-store.ts tests/unit/chat-store.test.ts
git commit -m "fix(chat): reseed optimistic ids above hydrated rows (reply vanished into stale localStorage row)"
```

---

### Task 2: Watchdog races the read loop

> The client watchdog is `AbortSignal.timeout(300_000)` composed at `chat-stream.ts:62-64`,
> but it is passed only to `fetch` (:75). The body read loop races **only** `opts.signal`
> (:124-141). A wedged body read — some runtimes and proxies don't honor the fetch abort on
> the body stream — leaves the dots bouncing forever with no honest error. The user
> reported exactly this shape: "the typing dots bounce for a bit, then stop" (and, when the
> read wedges, forever).

**Files:**
- Modify: `src/lib/chat-stream.ts:11-25` (options), `62-64` (signal), `117-135` (abort race), `137-183` (read loop)
- Create: `tests/unit/chat-stream.test.ts`

**Interfaces:**
- Produces: `watchdogMs?: number` on `StreamConsuelaChatOptions` — defaults to 300_000, the
  test seam that makes this assertable without a 5-minute test.
- Produces: the composed signal drives **both** the fetch and the read-loop race.

- [ ] **Step 1: Write the failing test**

`tests/unit/chat-stream.test.ts` is new — `chat-store.test.ts` mocks the stream wholesale, so
nothing currently exercises the real SSE reader. Stub `fetch` with a body that yields once
and then never resolves:

```ts
it("rejects on the watchdog when the body read wedges", async () => {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode('data: {"t":"partial"}\n\n'));
      // never enqueue again, never close — a wedged intermediary
    },
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, {
    status: 200, headers: { "content-type": "text/event-stream" },
  })));
  await expect(streamConsuelaChat({ message: "hi", watchdogMs: 50 }))
    .rejects.toThrow(/timed out|timed out/i);
});

it("still reports a user stop as AbortError", async () => {
  const ac = new AbortController();
  // same wedged body, but the caller aborts first
  const p = streamConsuelaChat({ message: "hi", signal: ac.signal, watchdogMs: 60_000 });
  ac.abort();
  await expect(p).rejects.toMatchObject({ name: "AbortError" });
});
```

- [ ] **Step 2: Run it to confirm the red baseline**

Run: `npx vitest run tests/unit/chat-stream.test.ts`
Expected: FAIL (or time out) — the read loop never races the watchdog.

- [ ] **Step 3: Implement the composed fail signal**

In `chat-stream.ts`, build one signal and race it in both places:

```ts
const watchdogMs = opts.watchdogMs ?? 300_000;
// One composed signal so the caller's stop and the watchdog are indistinguishable
// to the body reader — the caller's signal never leaks the watchdog identity.
const failSignal = AbortSignal.any([
  ...(opts.signal ? [opts.signal] : []),
  AbortSignal.timeout(watchdogMs),
]);
const res = await fetch(url, { ..., signal: failSignal });
```

Then in the abort-race setup (:117-135), race `failSignal` instead of `opts.signal`, and keep
the existing `stopSignal?.aborted` checks so a **user stop** still produces `AbortError` while
a watchdog expiry produces the honest timeout error. Also handle the buffered
`res.json()` branch (:98), which is currently completely unabortable.

- [ ] **Step 4: Verify green**

Run: `npx vitest run tests/unit/chat-stream.test.ts tests/unit/chat-store.test.ts`
Expected: PASS (new suite + 8/8 store). The stop test is the regression guard — a watchdog
timeout must NOT be reported as a user stop.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-stream.ts tests/unit/chat-stream.test.ts
git commit -m "fix(chat): race the client watchdog against the SSE body read (wedged stream bounced dots forever)"
```

---

### Task 3: Route error text reaches the user

> `chat-stream.ts:185` throws the route's `event: error` message verbatim, and
> `chat-store.ts:423` throws it away with `void error;`. The user therefore sees one of two
> hardcoded strings (offline / "couldn't reach the family server") for **every** failure —
> including the route's own honest "My brain isn't configured yet — add a provider in
> Settings → AI Models." That last one is the single most actionable message the route can
> emit and it is currently invisible. Spec W3.

**Files:**
- Modify: `src/lib/chat-stream.ts` (error construction at :185)
- Modify: `src/lib/chat-store.ts:374-423` (catch branch)
- Modify: `tests/unit/chat-stream.test.ts`, `tests/unit/chat-store.test.ts`

**Interfaces:**
- Produces: `RouteChatError` with `error.name === "RouteChatError"`, carrying the route's
  message. **Discriminated by `name`, not `instanceof`** — it survives module mocks and the
  JSON round-trip, and `instanceof` would break the moment the test mocks the module.

- [ ] **Step 1: Write the failing tests**

Client — an `event: error` frame surfaces as `RouteChatError`:
```ts
it("wraps the route's error frame so the store can render it", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    'event: error\ndata: {"message":"My brain isn\'t configured yet."}\n\n', {
      status: 200, headers: { "content-type": "text/event-stream" },
    })));
  await expect(streamConsuelaChat({ message: "hi" }))
    .rejects.toMatchObject({ name: "RouteChatError", message: "My brain isn't configured yet." });
});
```

Store — the message renders verbatim AND keeps the retry affordance:
```ts
it("renders the route's own error text and still offers a retry", async () => {
  streamMock.fn.mockRejectedValue(
    Object.assign(new Error("My brain isn't configured yet — add a provider in Settings → AI Models."), { name: "RouteChatError" }),
  );
  await ensureHydrated();
  await send("hi", SPEAKER);
  const msgs = getSnapshot().messages;
  expect(msgs.some((m) => m.content.includes("add a provider in Settings"))).toBe(true);
  expect(msgs.some((m) => m.errorFor === "hi")).toBe(true);
});

it("keeps the offline copy for a real network failure", async () => {
  streamMock.fn.mockRejectedValue(new TypeError("Failed to fetch"));
  await ensureHydrated();
  await send("hi", SPEAKER);
  expect(getSnapshot().messages.some((m) => m.content.includes("couldn't reach the family server"))).toBe(true);
});
```

- [ ] **Step 2: Run to confirm the red baseline**

Run: `npx vitest run tests/unit/chat-stream.test.ts tests/unit/chat-store.test.ts`
Expected: FAIL — no `RouteChatError` exists; the store shows the generic copy.

- [ ] **Step 3: Implement**

In `chat-stream.ts`:
```ts
/** The route's own terminal failure, kept distinguishable from a network error.
 *  Discriminated by `name` so it survives module mocks and serialization. */
export class RouteChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteChatError";
  }
}
```
Change `:185` to `if (errorMsg) throw new RouteChatError(errorMsg);`.

In `chat-store.ts`'s catch (:404-421), branch **before** the offline check:
```ts
} else if (error instanceof Error && error.name === "RouteChatError") {
  // The route already said something honest and specific ("brain isn't configured",
  // "hit a snag"). Showing generic offline copy over it is strictly less useful.
  setMessages((prev) => [...prev, {
    id: nextOptimisticId(),
    role: "assistant",
    content: error.message,
    timestamp: "Just now",
    at: Date.now(),
    errorFor: trimmed,   // so "Try again" still works
  }]);
} else {
  // ...existing offline/server copy (:405-421)
}
```

- [ ] **Step 4: Verify green**

Run: `npx vitest run tests/unit/chat-stream.test.ts tests/unit/chat-store.test.ts`
Expected: PASS — the second store test is the guard that this did not swallow the offline copy.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-stream.ts src/lib/chat-store.ts tests/unit/chat-stream.test.ts tests/unit/chat-store.test.ts
git commit -m "fix(chat): render the route's own error text; keep network-failure copy for real outages"
```

---

### Task 4: SSE heartbeat + `X-Accel-Buffering: no`

> Two providers of a dead-looking stream, not bugs in our code. (a) There is **no heartbeat** —
> during a long reasoning phase the provider can legitimately emit zero bytes for the whole
> silent think, and every buffering intermediary in the path may hold frames until a buffer
> fills or the connection closes. (b) `X-Accel-Buffering: no` is never set — the streamed
> `Response` (`route.ts:545-551`) carries only `Content-Type`, `Cache-Control`, `Connection`.
> A 15s `: ping` comment frame plus the header keeps intermediaries from swallowing the
> final burst. `parseSSEFrames` (`chat-stream.ts:41-57`) already drops comment frames — a
> frame with no `data:` line is skipped at :54 — so **no parser change is needed**. Spec W4.

**Files:**
- Modify: `src/app/api/hermes/chat/route.ts:423-435` (writer setup), `540-542` (finally), `545-551` (headers)
- Modify: `tests/unit/hermes-chat-stream.test.ts`

**Interfaces:**
- Produces: a `: ping\n\n` comment frame every 15s while the stream is open.
- Produces: `X-Accel-Buffering: no` on the streamed response.

- [ ] **Step 1: Write the failing tests**

`hermes-chat-stream.test.ts` mocks `fetch` with a controllable `ReadableStream`. Assert the
heartbeat lands and that the header is present:

```ts
it("emits a heartbeat comment frame during a silent provider think", async () => {
  const { push, close } = controllableStream();
  stubProviderStream(push, close);
  const res = await postStreamed({ message: "hi" });
  expect(res.headers.get("x-accel-buffering")).toBe("no");
  const reader = res.body!.getReader();
  // read the first chunk, then let >15s elapse via fake timers and read again
  // ...assert a frame starting with ": ping" is observed
});

it("adds X-Accel-Buffering to the streamed response", async () => {
  const res = await postStreamed({ message: "hi" });
  expect(res.headers.get("x-accel-buffering")).toBe("no");
});
```

Use `vi.useFakeTimers()` to advance 15s rather than actually waiting.

- [ ] **Step 2: Run to confirm the red baseline**

Run: `npx vitest run tests/unit/hermes-chat-stream.test.ts`
Expected: FAIL — no heartbeat, header is `null`.

- [ ] **Step 3: Implement**

In `handleStreamedChat`, next to the existing `write` (:428-435):

```ts
// Providers can go silent for the whole reasoning phase of a long think, and
// buffering intermediaries hold frames until a buffer fills. A 15s comment
// frame keeps the path warm; the client parser drops comment-only frames
// (parseSSEFrames requires a data: line), so this is invisible to the contract.
const heartbeat = setInterval(() => {
  if (!clientGone) write(": ping\n\n");
}, 15_000);
```

Clear it in the existing `finally` (:540-542) before `writer.close()` — an uncleared interval
on a long-lived process is a leak:

```ts
} finally {
  clearInterval(heartbeat);
  writer.close().catch(() => {});
}
```

And add the header:
```ts
return new Response(readable, {
  headers: {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  },
});
```

- [ ] **Step 4: Verify green**

Run: `npx vitest run tests/unit/hermes-chat-stream.test.ts`
Expected: PASS (26/26 — 24 existing + 2 new)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/hermes/chat/route.ts tests/unit/hermes-chat-stream.test.ts
git commit -m "fix(chat): 15s SSE heartbeat + X-Accel-Buffering:no (silent reasoning reads as a dead stream)"
```

---

### Task 5: `tool_call_id` backfill

> `route.ts:503` (and :701) push `tool_call_id: tool_calls[i].id || ""`. Some gateways omit
> `id` on stream deltas — `callAiStream` only sets it when the delta carries one (:298-299) —
> so the *next* round posts a `role: "tool"` message with an empty id, which most
> OpenAI-compatible servers reject with a 400. The whole turn then dies mid-loop and the
> user sees the dots-then-nothing symptom. Spec W5.

**Files:**
- Modify: `src/app/api/hermes/chat/route.ts:502-508` (streamed), `700-705` (buffered)
- Modify: `tests/unit/hermes-chat-stream.test.ts`

**Interfaces:**
- Produces: every `role: "tool"` message carries a non-empty `tool_call_id`, either the
  provider's or a synthesized `call_<ts>_<i>_<rand>`.

- [ ] **Step 1: Write the failing test**

```ts
it("synthesizes a tool_call_id when the provider omits ids in stream deltas", async () => {
  // provider returns tool_calls deltas WITHOUT any `id`
  stubProviderStreamToolCall({ id: undefined, name: "get_weather", args: "{}" });
  await postStreamed({ message: "what's the weather" });
  const roundTwo = capturedProviderRequests()[1];
  const toolMsg = roundTwo.messages.find((m: any) => m.role === "tool");
  expect(toolMsg.tool_call_id).toBeTruthy();
  expect(toolMsg.tool_call_id).toMatch(/^call_\d+_0_/);
});
```

- [ ] **Step 2: Run to confirm the red baseline**

Run: `npx vitest run tests/unit/hermes-chat-stream.test.ts`
Expected: FAIL — `tool_call_id` is `""`.

- [ ] **Step 3: Implement**

Extract a helper near `extractPointProposal` (:188-203) and use it at both sites:

```ts
/** Some gateways omit `id` on stream deltas, and an empty tool_call_id makes
 *  the NEXT round 400. Synthesize a stable one so the round-trip always parses. */
function toolCallIdFor(id: string | undefined, index: number): string {
  const trimmed = typeof id === "string" ? id.trim() : "";
  if (trimmed) return trimmed;
  return `call_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 10)}`;
}
```

```ts
messages.push({ role: "tool", tool_call_id: toolCallIdFor(tool_calls[i].id, i), content: result });
```

- [ ] **Step 4: Verify green**

Run: `npx vitest run tests/unit/hermes-chat-stream.test.ts`
Expected: PASS (27/27). Keep a provider-supplied-id case too — don't overwrite a real id.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/hermes/chat/route.ts tests/unit/hermes-chat-stream.test.ts
git commit -m "fix(chat): synthesize tool_call_id when the provider omits it (empty id 400s the next round)"
```

---

### Task 6: Attempt frames — displayed === persisted

> **This task replaces spec §4.1.7's `event: round` design.** Round granularity does not
> achieve "displayed == persisted". Three paths diverge today:
>
> | Orphan case | Where | Round frame fixes it? |
> |---|---|---|
> | Round 1 streams a preamble, round 2 answers | tokens written at :293 inside `callAiStream`; `finalContent = content` takes only the last round (:493) | Yes |
> | **Target failover mid-round** — target 1 streams 300 tokens then throws at :480; target 2 streams more | same `write` path, **no round boundary between targets** | **No** |
> | **Exhaustion** — 5 tool rounds, wrap-up fails, falls to :489 → :512, token written at :514 | the exhaustion string is *appended* to what the client already rendered | **No** |
>
> Attempt granularity (round × target) covers all three. It also needs **no new store API**:
> `onToken(full)` already overwrites (`chat-store.ts:315`), so if the client-side accumulator
> resets on the attempt frame, `displayed === finalContent === persisted` on every path.
>
> **Accepted consequence:** a tool-heavy turn *replaces* its visible preamble instead of
> appending. Persistence stores only the final round, so appending would contradict what a
> refresh shows. Spec §10 rejected the alternative for exactly this reason.

**Files:**
- Modify: `src/app/api/hermes/chat/route.ts:460-467` (emit before each attempt), `510-515` (exhaustion), `653-665` (buffered), `148-150` (`sseFrame` unchanged)
- Modify: `src/lib/chat-stream.ts:1-9` (protocol docs), `146-171` (frame dispatch)
- Modify: `src/lib/chat-store.ts` (pass-through + attempt handling)
- Modify: `tests/unit/hermes-chat-stream.test.ts`, `tests/unit/chat-stream.test.ts`

**Interfaces:**
- Produces: `event: attempt` frame `{"round": <1-based>, "target": <model>}` emitted before
  every provider call, plus once before the exhaustion token.
- Produces: `onAttempt?: (meta: { round: number; target: string }) => void` on
  `StreamConsuelaChatOptions`.
- Client behavior: on receipt, **reset the accumulator** so the new attempt's tokens replace
  the previous attempt's.

- [ ] **Step 1: Write the failing tests**

Route:
```ts
it("emits an attempt frame before each provider call", async () => {
  stubProviderStream(/* ... */);
  const frames = await collectFrames(await postStreamed({ message: "hi" }));
  expect(frames.filter((f) => f.event === "attempt")).toHaveLength(1);
  expect(frames.find((f) => f.event === "attempt")!.data).toMatchObject({ round: 1 });
});

it("emits an attempt frame when it fails over to the next target mid-round", async () => {
  // target 1 streams partial tokens then the socket dies
  stubTwoTargets({ firstStreams: 'data: {"t":"partial"}\n\n', firstThrows: true });
  const frames = await collectFrames(await postStreamed({ message: "hi" }));
  expect(frames.filter((f) => f.event === "attempt")).toHaveLength(2);  // round+target is 2, not round 1
});

it("emits an attempt frame before the exhaustion message", async () => {
  stubAlwaysToolCalls();  // forces 6 rounds → exhaustion
  const frames = await collectFrames(await postStreamed({ message: "hi" }));
  const lastAttempt = frames.map((f) => f.event).lastIndexOf("attempt");
  const lastToken = frames.map((f) => f.event).lastIndexOf("token");
  expect(lastAttempt).toBeGreaterThan(-1);
  expect(lastAttempt).toBeLessThan(lastToken);  // reset happens BEFORE the final text
});
```

Client:
```ts
it("resets the accumulator so a new attempt replaces the previous attempt's tokens", async () => {
  const body = [
    'event: attempt\ndata: {"round":1,"target":"a"}\n\n',
    'data: {"t":"first attempt text"}\n\n',
    'event: attempt\ndata: {"round":1,"target":"b"}\n\n',
    'data: {"t":"second attempt"}\n\n',
    "data: [DONE]\n\n",
  ].join("");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, {
    status: 200, headers: { "content-type": "text/event-stream" },
  })));
  const seen: string[] = [];
  await streamConsuelaChat({ message: "hi", onToken: (full) => seen.push(full) });
  // Final content is ONLY the second attempt — matching what the server persists.
  expect(seen[seen.length - 1]).toBe("second attempt");
  expect(seen).not.toContain("first attempt textsecond attempt");
});
```

- [ ] **Step 2: Run to confirm the red baseline**

Run: `npx vitest run tests/unit/hermes-chat-stream.test.ts tests/unit/chat-stream.test.ts`
Expected: FAIL — no attempt frame; the client concatenates both attempts.

- [ ] **Step 3: Implement the route side**

At :462-463, immediately before each `callAiStream`:
```ts
// An attempt = one (round × target) provider call. Token frames are written
// INSIDE callAiStream, so a failed-over target's tokens are already in the
// client's bubble and cannot be retracted. Announcing the attempt lets the
// client reset and keep displayed === persisted.
write(sseFrame(JSON.stringify({ round: round + 1, target: target.model }), "attempt"));
```

At :510-515, before writing the exhaustion string:
```ts
write(sseFrame(JSON.stringify({ round: ctx.rounds, target: "exhausted" }), "attempt"));
write(sseFrame(JSON.stringify({ t: finalContent })));
```

The buffered path (:653-665) needs no frames — nothing streams there — but its
`proposals` array is dropped on exhaustion (:716-719), which T13's map work should not
regress. Note it for T13.

- [ ] **Step 4: Implement the client side**

In `chat-stream.ts`, add the option and the dispatch branch (before the token `else` at :162):
```ts
} else if (frame.event === "attempt") {
  // A new attempt replaces the previous one's tokens: persistence only ever
  // stores the answering round, so concatenating would contradict a refresh.
  content = "";
  try {
    const p = JSON.parse(frame.data);
    opts.onAttempt?.({ round: Number(p.round) || 0, target: String(p.target || "") });
  } catch { /* malformed attempt frame — the reset above still stands */ }
}
```

Update the protocol comment block at :1-9 to include the frame.

- [ ] **Step 5: Verify green**

Run: `npx vitest run tests/unit/hermes-chat-stream.test.ts tests/unit/chat-stream.test.ts tests/unit/chat-store.test.ts tests/unit/chat-page-stream.test.tsx`
Expected: PASS — the store and page suites are the regression guard that concatenating
behavior didn't already exist somewhere a test depends on.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/hermes/chat/route.ts src/lib/chat-stream.ts src/lib/chat-store.ts tests/unit/hermes-chat-stream.test.ts tests/unit/chat-stream.test.ts
git commit -m "fix(chat): attempt frames key the bubble reset on round×target (displayed === persisted on failover + exhaustion)"
```

---

### Task 7: Streamed-call timeout 60s → 120s

> `AI_TIMEOUT_MS = 60_000` (`route.ts:49`) bounds **every** provider call. For a reasoning
> model re-planning after a tool error, 60s is too tight — the round dies, the failover loop
> moves to the next target, and if the chain is short the user gets the "hit a snag"
> fallback. The user reported exactly this: *"if I had a tool call error, I do not get a
> response back."* Spec W2.

**Files:**
- Modify: `src/app/api/hermes/chat/route.ts:49` (new constant), `:225` (streamed call only)
- Modify: `tests/unit/hermes-chat-stream.test.ts`

**Interfaces:**
- Produces: `AI_STREAM_TIMEOUT_MS = 120_000`, used **only** at `callAiStream:225`.
- Unchanged: `callAi` (:132) and the planner keep `AI_TIMEOUT_MS = 60_000`. Buffering a
  non-streaming call for two minutes only makes a dead provider slower to fail over.

- [ ] **Step 1: Write the failing test**

```ts
it("gives a streamed reasoning round 120s, not 60s", async () => {
  stubSlowProvider(/* delay */);
  await postStreamed({ message: "hi" });
  const init = capturedProviderRequests()[0].init;
  const timeoutSignal = [...init].find((v: any) => v instanceof AbortSignal);
  // AbortSignal.timeout identity isn't introspectable — assert via the
  // provider mock observing it and advancing fake timers past 60s but under 120s.
});
```
If signal identity is not observable, assert the exported constant instead and keep a
behavioral test that a 90s reasoning round still answers.

- [ ] **Step 2: Run to confirm the red baseline**

Run: `npx vitest run tests/unit/hermes-chat-stream.test.ts`
Expected: FAIL at 60s.

- [ ] **Step 3: Implement**

```ts
const AI_TIMEOUT_MS = 60_000;
// A reasoning model re-planning after a tool error legitimately needs longer than
// a plain answer. Only the STREAMED call gets the larger budget — the buffered
// and planner paths stay at 60s so a dead provider still fails over promptly.
const AI_STREAM_TIMEOUT_MS = 120_000;
```

Use it at :225 (`callAiStream`) only.

- [ ] **Step 4: Verify green**

Run: `npx vitest run tests/unit/hermes-chat-stream.test.ts tests/unit/hermes-chat-failover.test.ts`
Expected: PASS — the failover suite proves the longer timeout didn't make a dead provider slower.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/hermes/chat/route.ts tests/unit/hermes-chat-stream.test.ts
git commit -m "fix(chat): 120s streamed-call budget for reasoning re-plans; buffered + planner stay 60s"
```

**Landing 1 gate:** `npx vitest run` full suite + `npm run typecheck` + `npm run lint`.

---

## Landing 2 — Thinking UI

> The user asked to make the thinking display **better** and selected all three upgrades
> (spec §11): a live reasoning transcript, richer truth-per-phase status labels, and per-tool
> activity chips so failures are visible. This landing is where the second reported symptom
> becomes legible: *"if I had a tool call error, I do not get a response back"* was, in
> part, a tool error that happened invisibly.

### Task 8: Route emits `reasoning` + `tool` frames

> `callAiStream` reads `delta.reasoning_content` but **throws the text away** — it only
> increments `reasoningChars` to compute `reasoningOnly` (:284-290), which is itself returned
> at :309/:253 and then **never destructured** by the caller (:463 destructures only
> `{ content, tool_calls }`). So a reasoning model thinks out loud in front of us and the
> user sees a one-shot "Thinking deeply…" label and nothing else. Meanwhile a tool failure
> is fed back to the model as JSON `{error}` (:332) and surfaces to the user as **nothing**.
> Spec §4.2.

**Files:**
- Modify: `src/app/api/hermes/chat/route.ts:221` (`reasoningAnnounced`), `284-290` (reasoning deltas), `245-254` (buffered reasoning), `498-508` (tool frames)
- Modify: `src/lib/chat-stream.ts` (protocol docs)
- Modify: `tests/unit/hermes-chat-stream.test.ts`

**Interfaces:**
- Produces: `event: reasoning\ndata: {"r":"<delta>"}` per reasoning delta. **Display-only.**
- Produces: `event: tool\ndata: {"name","state"}` where state is
  `"running" | "ok" | "error"`, emitted around every tool execution.
- Keeps: the one-shot `REASONING_STATUS` label (:57) for the dots phase.

- [ ] **Step 1: Write the failing tests**

```ts
it("forwards reasoning deltas as reasoning frames", async () => {
  stubProviderStream([
    'data: {"choices":[{"delta":{"reasoning_content":"Let me check "}}]}',
    'data: {"choices":[{"delta":{"reasoning_content":"the calendar."}}]}',
    'data: {"choices":[{"delta":{"content":"You have soccer."}}]}',
  ]);
  const frames = await collectFrames(await postStreamed({ message: "when is soccer" }));
  const reasoning = frames.filter((f) => f.event === "reasoning").map((f) => f.data.r);
  expect(reasoning.join("")).toBe("Let me check the calendar.");
  // the one-shot status label still fires
  expect(frames.some((f) => f.event === "status" && /Thinking deeply/.test(f.data.label))).toBe(true);
});

it("emits tool running then error so a failed tool is visible", async () => {
  stubProviderToolCall({ name: "get_pantry", args: "{}", result: { error: "pantry unavailable" } });
  const frames = await collectFrames(await postStreamed({ message: "what's in the pantry" }));
  const tool = frames.filter((f) => f.event === "tool").map((f) => f.data);
  expect(tool[0]).toMatchObject({ name: "get_pantry", state: "running" });
  expect(tool[tool.length - 1]).toMatchObject({ name: "get_pantry", state: "error" });
});

it("emits tool running then ok", async () => { /* ... */ });

it("forwards buffered-path reasoning_content as a single frame", async () => {
  stubBufferedProvider({ content: "Done.", reasoning_content: "thought about it" });
  const res = await postBuffered({ message: "hi" });
  // buffered path has no SSE frames — assert the shape the client will build
  expect(res.reasoning).toBe("thought about it");
});
```

- [ ] **Step 2: Run to confirm the red baseline**

Run: `npx vitest run tests/unit/hermes-chat-stream.test.ts`
Expected: FAIL — no reasoning frames exist; the text is discarded.

- [ ] **Step 3: Implement the streaming reasoning frames**

Replace :284-290:
```ts
if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
  // Forward the reasoning so the user can WATCH the think. Display-only —
  // the client strips it before any persistence (spec §8).
  write(sseFrame(JSON.stringify({ r: delta.reasoning_content }), "reasoning"));
  reasoningChars += delta.reasoning_content.length;
  if (!reasoningAnnounced) {
    reasoningAnnounced = true;
    write(sseFrame(JSON.stringify({ label: REASONING_STATUS }), "status"));
  }
}
```

- [ ] **Step 4: Implement the buffered reasoning read**

`callAi` reads only `content` and `tool_calls` (:142-145) — it cannot distinguish
reasoning-exhaustion from a dead provider. Add `reasoning` to its return and read it:
```ts
return {
  content: data.choices?.[0]?.message?.content || "",
  reasoning: data.choices?.[0]?.message?.reasoning_content || "",
  tool_calls: data.choices?.[0]?.message?.tool_calls,
};
```

- [ ] **Step 5: Implement the tool frames**

Wrap the execution at :501. Note the tool frames must be emitted **outside** the
`results.forEach` so the `running` state precedes execution:
```ts
for (const tc of tool_calls) {
  const name = tc.function?.name || "tool";
  write(sseFrame(JSON.stringify({ label: toolStatusLabel(tc.function?.name) }), "status"));
  write(sseFrame(JSON.stringify({ name, state: "running" }), "tool"));
}
const results = await runToolCalls(tool_calls, tools, toolContext);
results.forEach((result, i) => {
  // The post-result frame parses the result for an `error` field — a tool that
  // fails must be VISIBLE, not just fed back to the model as JSON.
  let failed = false;
  try { failed = JSON.parse(result)?.error !== undefined; } catch { failed = false; }
  write(sseFrame(JSON.stringify({
    name: tool_calls[i].function?.name || "tool",
    state: failed ? "error" : "ok",
  }), "tool"));
  messages.push({ role: "tool", tool_call_id: toolCallIdFor(tool_calls[i].id, i), content: result });
  // ...existing proposal frame (:505-507)
});
```

- [ ] **Step 6: Update the protocol comment block**

`chat-stream.ts:1-9` gains `event: reasoning` and `event: tool` lines. T6 already added
`event: attempt` there.

- [ ] **Step 7: Verify green**

Run: `npx vitest run tests/unit/hermes-chat-stream.test.ts`
Expected: PASS (31/31)

- [ ] **Step 8: Commit**

```bash
git add src/app/api/hermes/chat/route.ts src/lib/chat-stream.ts tests/unit/hermes-chat-stream.test.ts
git commit -m "feat(chat): forward reasoning deltas + per-tool running/ok/error frames"
```

---

### Task 9: Client thinking state (display-only)

> The store owns all streaming state — the page subscribes at `chat/page.tsx:147` and owns
> none. So `thinking` and `toolEvents` belong in `ChatStoreState` (`chat-store.ts:47-52`),
> not as page-local `useState`. The hard requirement: **`persistHistory()` strips them**.
> That function currently strips **only** the seed greeting (:103-115) and writes the raw
> `Message[]` to localStorage on **every** token tick — so reasoning text would land in
> localStorage on every keystroke of the think. Spec §4.2 / §8 make this display-only.

**Files:**
- Modify: `src/lib/chat-stream.ts:11-25` (options), `146-171` (dispatch)
- Modify: `src/lib/chat-store.ts:47-52` (state), `94` + `103-115` (`persistHistory`), `299-329` (`send` callbacks)
- Modify: `tests/unit/chat-stream.test.ts`, `tests/unit/chat-store.test.ts`

**Interfaces:**
- Produces: `onReasoning?: (full: string, delta: string) => void` and
  `onToolEvent?: (ev: { name: string; state: "running" | "ok" | "error" }) => void`.
- Produces: `ChatStoreState.thinking: string` and `ChatStoreState.toolEvents: ToolEvent[]`,
  both cleared at the start of every `send()` and at the end of every turn.
- Produces: finished messages carry `thinking` / `toolEvents` **in memory only**.

- [ ] **Step 1: Write the failing tests**

```ts
it("accumulates reasoning into live thinking state", async () => {
  // ...stub a stream with reasoning frames then a token
  expect(getSnapshot().thinking).toBe("thinking hard");
});

it("NEVER persists reasoning or tool activity to localStorage", async () => {
  // same stream
  const raw = localStorage.getItem("consuela-chat-messages")!;
  expect(raw).not.toContain("thinking hard");
  expect(raw).not.toContain("get_weather");
  // ...but the in-memory message DOES carry them
  const reply = getSnapshot().messages.find((m) => m.role === "assistant" && m.content);
  expect(reply.thinking).toBe("thinking hard");
  expect(reply.toolEvents).toEqual([{ name: "get_weather", state: "ok" }]);
});

it("clears thinking state at the start of the next turn", async () => { /* ... */ });

it("clears the dots when the answer starts", async () => {
  // reasoning frames alone must NOT open the bubble
  expect(getSnapshot().isTyping).toBe(true);
  // the first content token opens it
  expect(getSnapshot().isTyping).toBe(false);
});
```

The localStorage assertion is the binding one — it is the only thing that proves
display-only.

- [ ] **Step 2: Run to confirm the red baseline**

Run: `npx vitest run tests/unit/chat-store.test.ts tests/unit/chat-stream.test.ts`
Expected: FAIL — no `thinking` state; reasoning is not a recognized frame.

- [ ] **Step 3: Add the client callbacks**

In `chat-stream.ts`, add both options and dispatch branches (alongside T6's `attempt`):
```ts
} else if (frame.event === "reasoning") {
  try {
    const p = JSON.parse(frame.data);
    if (typeof p.r === "string" && p.r.length > 0) {
      reasoning += p.r;
      opts.onReasoning?.(reasoning, p.r);
    }
  } catch { /* malformed reasoning frame — ignore */ }
} else if (frame.event === "tool") {
  try {
    const p = JSON.parse(frame.data);
    if (typeof p.name === "string") opts.onToolEvent?.({ name: p.name, state: p.state });
  } catch { /* malformed tool frame — ignore */ }
}
```
Declare `let reasoning = ""` next to `let content = ""`.

- [ ] **Step 4: Add the store state and the strip**

Extend `Message` with `thinking?: string` and `toolEvents?: ToolEvent[]`. Add
`thinking` + `toolEvents` to `ChatStoreState`.

**The strip is the load-bearing change** in `persistHistory`:
```ts
// Reasoning text and tool activity are DISPLAY-ONLY (spec §8) — they must
// never reach PocketBase or localStorage. The stream can emit hundreds of
// reasoning frames, and this function runs on every token tick.
const stripVolatile = (m: Message): Message => {
  const { thinking: _t, toolEvents: _e, ...rest } = m;
  return rest as Message;
};

localStorage.setItem(
  CHAT_STORAGE_KEY,
  JSON.stringify(state.messages.filter((m) => !isSeedGreeting(m)).map(stripVolatile)),
);
```

Wire `onReasoning` / `onToolEvent` in `send()` to update state, and attach both to the
finished message at the same place content is attached (:344-368).

- [ ] **Step 5: Verify green**

Run: `npx vitest run tests/unit/chat-store.test.ts tests/unit/chat-stream.test.ts tests/unit/chat-page-stream.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/chat-stream.ts src/lib/chat-store.ts tests/unit/chat-stream.test.ts tests/unit/chat-store.test.ts
git commit -m "feat(chat): live thinking + tool activity state, stripped before persistence (display-only)"
```

---

### Task 10: `ThinkingDisclosure` + `ToolActivityChips`

> New components in `src/components/chat/`. `ThinkingDisclosure` is a collapsible 💭
> transcript: open while thinking, **auto-collapses when the answer starts**, re-openable
> afterwards. `ToolActivityChips` renders ⏳/✅/❌ per tool. Both render live under the typing
> indicator (`chat/page.tsx:560-588`) and stay on the finished message.
>
> **UI contracts are binding** (AGENTS.md, locked by test):
> - Type floor is **12px** (`text-xs`). Arbitrary px (`text-[10px]`) is **banned** —
>   `tests/unit/warm-glass-contracts.test.tsx` contract B and `compact-type-floor.test.tsx`.
> - Targets **≥44×44**. Carry `.hit-44` for visually-compact controls;
>   `tests/unit/tap-target-contract.test.ts` scans `*.tsx` class strings.
> - Text contrast clears **WCAG AA** in dark AND light.
> - Use the canonical primitives (`docs/DESIGN_SYSTEM.md` §3): `SoftButton`, `Chip`, `Modal`.
>   **Do not** use legacy `Card` / `Button` / `Badge`.
> - `prefers-reduced-motion` respected.

**Files:**
- Create: `src/components/chat/ThinkingDisclosure.tsx`
- Create: `src/components/chat/ToolActivityChips.tsx`
- Modify: `src/app/chat/page.tsx:560-588` (typing block), `480-558` (finished message)
- Create: `tests/unit/chat-thinking-ui.test.tsx`

**Interfaces:**
- Produces: `<ThinkingDisclosure text open onOpenChange />`
- Produces: `<ToolActivityChips events />`

- [ ] **Step 1: Write the failing tests**

`chat-thinking-ui.test.tsx` copies the render harness from `chat-points-chip.test.tsx`
(`createRoot` + `act`, `IS_REACT_ACT_ENVIRONMENT = true`). Required cases:

```tsx
it("renders the live reasoning transcript while thinking", () => { /* 💭 + text visible */ });

it("collapses when the answer starts and can be re-opened", () => {
  // render with open=false after answer -> collapsed; click header -> expanded
});

it("renders running, ok and error chips with distinct labels", () => {
  render(<ToolActivityChips events={[
    { name: "get_weather", state: "running" },
    { name: "get_pantry", state: "ok" },
    { name: "get_calendar_range", state: "error" },
  ]} />);
  expect(el.textContent).toContain("Weather");
  expect(el.querySelector('[data-state="error"]')).not.toBeNull();
});

it("keeps the type floor at 12px and the target at 44px", () => {
  // assert no class contains text-[Npx] with N<12; assert the disclosure
  // header carries .hit-44
});

it("shows no transcript when there was no reasoning", () => {
  render(<ThinkingDisclosure text="" />);
  expect(el.querySelector('[data-testid="thinking-disclosure"]')).toBeNull();
});
```

- [ ] **Step 2: Run to confirm the red baseline**

Run: `npx vitest run tests/unit/chat-thinking-ui.test.tsx`
Expected: FAIL — components do not exist.

- [ ] **Step 3: Implement `ToolActivityChips`**

```tsx
"use client";

const STATE_GLYPH = { running: "⏳", ok: "✅", error: "❌" } as const;

export interface ToolEventView { name: string; state: "running" | "ok" | "error"; }

/** Human label for a tool name — "get_calendar_range" -> "Calendar range". */
function toolLabel(name: string): string {
  return name.replace(/^(get|list)_/, "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export default function ToolActivityChips({ events }: { events: ToolEventView[] }) {
  if (!events.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 self-start" data-testid="tool-activity">
      {events.map((e, i) => (
        <span
          key={`${e.name}-${e.state}-${i}`}
          data-state={e.state}
          aria-label={`${toolLabel(e.name)}: ${e.state}`}
          className="inline-flex items-center gap-1 rounded-full glass-subtle px-2.5 min-h-[24px] text-xs text-text-secondary"
        >
          <span aria-hidden="true">{STATE_GLYPH[e.state]}</span>
          {toolLabel(e.name)}
        </span>
      ))}
    </div>
  );
}
```

Glyph-only content is inside an `aria-label`-bearing element, and the state is exposed via
`data-state`, so the chips are readable without color.

- [ ] **Step 4: Implement `ThinkingDisclosure`**

Collapsed by default when the answer has started; controlled by the parent so the store stays
the single source of truth:

```tsx
"use client";

export default function ThinkingDisclosure({
  text, open, onOpenChange,
}: { text: string; open: boolean; onOpenChange: (next: boolean) => void }) {
  const [userToggled, setUserToggled] = useState(false);
  if (!text.trim()) return null;
  return (
    <div data-testid="thinking-disclosure" className="self-start max-w-full">
      <button
        type="button"
        onClick={() => { setUserToggled(true); onOpenChange(!open); }}
        aria-expanded={open}
        className="hit-44 inline-flex items-center gap-1.5 rounded-full glass-subtle px-3 min-h-[44px] text-xs text-text-secondary"
      >
        <span aria-hidden="true">💭</span>
        {open ? "Hide thinking" : "Show thinking"}
      </button>
      {open && (
        <div className="mt-1.5 rounded-2xl glass-subtle px-3 py-2 text-xs leading-relaxed text-text-secondary whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire into the page**

In the typing block (`chat/page.tsx:560-588`), render `<ToolActivityChips events={store.toolEvents} />`
above the dots. On the finished assistant message, render both components from `msg.toolEvents` /
`msg.thinking`. The disclosure opens while `isTyping` and auto-collapses on the first content
token — derive that from the store rather than duplicating it in local state:

```tsx
<ThinkingDisclosure
  text={msg.thinking ?? store.thinking}
  open={isTyping || disclosureOpen[msg.id] === true}
/>
```
Where `disclosureOpen` is a small `Record<number, boolean>` local to the page for explicit
re-open. Keep the scroll effect's dependency list (`chat/page.tsx:218-224`) intact — adding
`toolEvents` there keeps the thread pinned while chips appear.

- [ ] **Step 6: Verify green**

Run: `npx vitest run tests/unit/chat-thinking-ui.test.tsx tests/unit/chat-page-stream.test.tsx tests/unit/warm-glass-contracts.test.tsx tests/unit/tap-target-contract.test.ts tests/unit/compact-type-floor.test.tsx`
Expected: PASS — the three contract suites are the binding UI gate.

- [ ] **Step 7: Commit**

```bash
git add src/components/chat/ThinkingDisclosure.tsx src/components/chat/ToolActivityChips.tsx src/app/chat/page.tsx tests/unit/chat-thinking-ui.test.tsx
git commit -m "feat(chat): collapsible thinking transcript + per-tool activity chips"
```

**Landing 2 gate:** `npx vitest run` + `npm run typecheck` + `npm run lint`.

---

## Landing 3 — Tool gaps

> Eight tools the user selected (spec §11): gap fills for existing surfaces
> (`remove_grocery_item`, `remove_meal`, Hall of Fame, PIN redemption), Skill Tree tools,
> and Time Capsule tools. Money Mountain tools were offered and **not** selected.
>
> ### Persona docs ship WITH these tasks, not in a later docs task
> `scripts/write-ai-boot.mjs:32-49` **fails the build** when a name in the runtime
> `KID_TOOL_NAMES` is missing from `ai/KID.md`. So `ai/KID.md` + `ai/TOOLS.md` +
> `npm run ai:boot` are part of T11–T14. `tests/unit/consuela-tools-parity.test.ts` is the
> second gate: every one of the 56 runtime tools must be backticked in `ai/TOOLS.md`.

### Task 11: Three kid-safe reads + honest `live*` wrappers

> Two of the three target services are **not safe to call from a tool as they stand**, and
> the spec did not know this:
>
> - `getSkillTreeProfile` (`skill-tree.ts:45-65`) is documented as a read path but
>   **creates a row** on a miss (:60) *and* falls back to the legacy `demo-user` row
>   (:55-58). A kid tool call would report **another member's XP as their own**, and a
>   "read" tool would write to PB. `getSkillTreeProfileForWrite` (:74-89) avoids the legacy
>   fallback but still creates.
> - `getUserCapsules` (`time-capsule.ts:16-33`) returns **`[]` on failure** (:30-32). It
>   cannot distinguish "no capsules" from "read failed", so a PB outage reads as a
>   confident "you have none" — exactly the false-answer pattern
>   `get_pantry`/`get_rewards` avoid with `live*` null degradation.
>
> **Interfaces:**
> - Produces: `liveTimeCapsules(userId): Promise<TimeCapsule[] | null>` and
>   `readSkillTreeProfile(userId): Promise<SkillTreeProfile | null>` — both in
>   `src/lib/consuela/live-reads.ts`. The skill-tree one **never creates and never falls
>   back**; a brand-new member gets a synthesized zero profile returned, not a write.
> - Produces: `get_hall_of_fame`, `get_skill_tree`, `get_time_capsules` — all kid-safe reads.

**Files:**
- Modify: `src/lib/consuela/live-reads.ts` (two new readers)
- Modify: `src/lib/hermes-tools.ts` (append before `];` at :2569; `KID_TOOL_NAMES` at :2615-2633)
- Modify: `ai/KID.md`, `ai/TOOLS.md`
- Create: `tests/unit/hermes-tool-family.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("get_skill_tree gives a kid their OWN tree, never the legacy demo-user row", async () => {
  // seed a legacy demo-user profile with XP 999 and no per-member row
  const res = JSON.parse(await runTool("get_skill_tree", {}, { caller: KID }));
  expect(res.profile.totalXP).not.toBe(999);   // NOT the legacy fallback
  // and it did NOT write a row
  expect(rowsCreated()).toHaveLength(0);      // never creates
});

it("get_time_capsules degrades honestly when the read fails", async () => {
  failNextRead("time_capsules");
  const res = JSON.parse(await runTool("get_time_capsules", {}, { caller: KID }));
  expect(res.error).toMatch(/do not guess/i);
  expect(res.capsules).toEqual([]);
});

it("get_hall_of_fame sanitizes photo avatars via textEmoji", async () => {
  seedHallRow({ member: "Emily", emoji: `data:image/png;base64,${"A".repeat(2000)}` });
  const res = JSON.parse(await runTool("get_hall_of_fame", {}, { caller: KID }));
  expect(JSON.stringify(res)).not.toContain("data:image");
  expect(res.entries[0].emoji).toBe("👤");
});

it("all three reads are on the kid surface", () => {
  const kid = buildToolsForOpenAI({ role: "child" }).map((t) => t.function.name);
  expect(kid).toEqual(expect.arrayContaining(["get_hall_of_fame", "get_skill_tree", "get_time_capsules"]));
});
```

The `rowsCreated()` assertion is the guard against reintroducing the write-in-a-read bug.

- [ ] **Step 2: Run to confirm the red baseline**

Run: `npx vitest run tests/unit/hermes-tool-family.test.ts`
Expected: FAIL — tools do not exist.

- [ ] **Step 3: Add the two honest readers**

In `src/lib/consuela/live-reads.ts`, following the existing `live*` shape (`null` = read
failed, per `liveRewards:333-342`):
```ts
/** Time capsules, or null when the read FAILED. `getUserCapsules` returns []
 *  for both "no capsules" and "read failed" — an outage must not read as a
 *  confident "you have none". */
export async function liveTimeCapsules(userId: string): Promise<TimeCapsule[] | null> {
  try {
    const rows = await getUserCapsules(userId);
    return Array.isArray(rows) ? rows : null;
  } catch { return null; }
}
```
For skill tree, do **not** wrap `getSkillTreeProfile` — wrap `getAuthedPB` directly:
```ts
/** Read-only skill-tree profile. Never creates a row (the packaged
 *  getSkillTreeProfile CREATES on a miss) and never returns the legacy
 *  demo-user row (which would report another member's XP as this member's). */
export async function readSkillTreeProfile(userId: string): Promise<SkillTreeProfile | null> {
  try {
    const pb = await getAuthedPB();
    const memberId = sanitizeUserId(userId);
    const exact = await pb.collection("skill_tree_profiles").getList<SkillTreeProfile>(1, 1, {
      filter: `userId = "${memberId}"`,
    });
    if (exact.items.length > 0) return exact.items[0];
    return { ...zeroProfile(), userId: memberId } as SkillTreeProfile;
  } catch { return null; }
}
```

- [ ] **Step 4: Add the three tools**

Append before `];` in `hermes-tools.ts`, using the degrade-then-compute idiom from
`get_leaderboard` (:1457-1499) for reads whose absence is meaningful:

- **`get_hall_of_fame`** — read `hall_of_fame` via `withAdmin`, sort `-weekStart`, map
  `{ member, emoji: textEmoji(r.emoji), weekStart, points, rank, prize }`.
  `textEmoji` (`live-reads.ts:104-113`) is **mandatory**: hall rows carry the same
  100-250KB photo-avatar base64 as `members.emoji`, and `get_leaderboard`'s comment
  documents this exact input as a verified live "snag connecting to my brain" cause.
- **`get_skill_tree`** — resolve the member from `context.caller`, never from model args.
  For a child caller, **always their own**. Parents may pass `member`.
  Return `{ profile, branches, quests, xpProgress }` from `getSkillTreeVisualization`'s shape.
- **`get_time_capsules`** — call `liveTimeCapsules(caller.name)`; `null` ⇒
  `{ error: "capsule data unavailable — do not guess what exists, retry later", capsules: [] }`.

Add all three to `KID_TOOL_NAMES` (:2615-2633) with the surrounding comment style.

- [ ] **Step 5: Update the persona docs (build gate)**

In `ai/KID.md`, add `` `get_hall_of_fame` ``, `` `get_skill_tree` ``, `` `get_time_capsules` ``
to the toolset list — **backticked**, or `write-ai-boot.mjs` fails. In `ai/TOOLS.md`, add a row
per tool with its semantics. Then:

Run: `npm run ai:boot`
Expected: regenerates `src/lib/ai-boot.generated.ts` with no drift error.

Run: `npx vitest run tests/unit/consuela-tools-parity.test.ts tests/unit/consuela-kid-soul.test.ts`
Expected: PASS — parity asserts every runtime tool is documented in `ai/TOOLS.md`.

- [ ] **Step 6: Verify green**

Run: `npx vitest run tests/unit/hermes-tool-family.test.ts tests/unit/hermes-tools-live-reads.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/consuela/live-reads.ts src/lib/hermes-tools.ts ai/KID.md ai/TOOLS.md src/lib/ai-boot.generated.ts tests/unit/hermes-tool-family.test.ts
git commit -m "feat(tools): hall of fame + skill tree + time capsule reads (kid-safe, honest null degradation)"
```

---

### Task 12: `remove_grocery_item`, `remove_meal`, `create_time_capsule`

> Three write tools. Note the spec says `remove_meal` shares `resolveMealDay` with
> `add_meal` — **that function does not exist**; the logic is inline at
> `hermes-tools.ts:1155-1171`. Extract it.

**Files:**
- Modify: `src/lib/hermes-tools.ts` — extract `resolveMealDay` near :1155; add 3 tools before `];`
- Modify: `ai/TOOLS.md`
- Modify: `tests/unit/hermes-tool-writes.test.ts` (create), `tests/unit/hermes-tools-dates.test.ts`

**Interfaces:**
- Produces: `resolveMealDay(dayRaw: string): { mealDate: string; weekdayShort: string } | { error: string }`
  — called by **both** `add_meal` and `remove_meal`.
- All three tools are parent-gated via `callerIsAdult(context?.caller)` (fail closed at :223-230).

- [ ] **Step 1: Write the failing tests**

```ts
it("remove_grocery_item removes by normalized name and refuses honestly on a miss", async () => {
  seedGrocery([{ name: "Whole Milk" }]);
  expect(JSON.parse(await runTool("remove_grocery_item", { name: "whole milk" })).ok).toBe(true);
  const miss = JSON.parse(await runTool("remove_grocery_item", { name: "unicorn" }));
  expect(miss.ok).toBe(false);
  expect(miss.error).toMatch(/get_grocery_list/);   // names the tool that lists the real set
});

it("remove_meal deletes the planned row for a resolved day", async () => { /* ... */ });

it("remove_meal shares resolveMealDay with add_meal", async () => {
  // add "pizza" for Tue, then remove_meal for "tue" -> the SAME row is gone
});

it("remove_meal refuses an unresolvable day honestly", async () => {
  const res = JSON.parse(await runTool("remove_meal", { name: "pizza", day: "Blursday" }));
  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/Mon\.\.Sun|YYYY-MM-DD/);
});

it("all three writes refuse a child caller", async () => {
  for (const [name, args] of [["remove_grocery_item", { name: "x" }],
                              ["remove_meal", { name: "x", day: "Tue" }],
                              ["create_time_capsule", { title: "t", unlockDate: "2099-01-01" }]]) {
    expect(JSON.parse(await runTool(name, args, { caller: KID })).reason).toBe("adult_only");
  }
});

it("create_time_capsule fails closed on a past unlock date", async () => { /* ... */ });

it("create_time_capsule starts the capsule empty", async () => {
  const res = JSON.parse(await runTool("create_time_capsule", { title: "Graduation", unlockDate: "2099-06-01" }, { caller: PARENT }));
  expect(res.ok).toBe(true);
  expect(contentsFor(res.capsule.id)).toEqual([]);   // contents added on the page
});
```

- [ ] **Step 2: Run to confirm the red baseline**

Run: `npx vitest run tests/unit/hermes-tool-writes.test.ts`
Expected: FAIL — tools do not exist.

- [ ] **Step 3: Extract `resolveMealDay`**

Lift :1155-1171 into a module-private helper, then have `add_meal` call it:
```ts
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Shared day resolution for add_meal + remove_meal. Never .toISOString() —
 *  that converts to UTC and returns the wrong calendar day east of UTC. */
function resolveMealDay(dayRaw: string):
  | { mealDate: string; weekdayShort: string }
  | { error: string } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayRaw)) {
    return { mealDate: dayRaw, weekdayShort: weekdayOfISO(dayRaw) };
  }
  const idx = WEEKDAYS.findIndex((d) => d.toLowerCase() === dayRaw.toLowerCase());
  if (idx === -1) return { error: `day must be Mon..Sun or YYYY-MM-DD, got "${dayRaw}"` };
  const weekdayShort = WEEKDAYS[idx];
  return {
    weekdayShort,
    mealDate: isoDateForWeekday(weekStartForDate(localTodayISO()), weekdayShort),
  };
}
```
`add_meal`'s handler then narrows the union and keeps its existing error copy byte-identical
so `hermes-tools-dates.test.ts` stays green.

- [ ] **Step 4: Add the three tools**

- **`remove_grocery_item`** — copy the 5-beat shape of `remove_pantry_item` (:2288-2306)
  verbatim: arg guard → `liveGrocery()` null guard ("do not guess inventory, retry later") →
  `normalizeGroceryName` match with an honest not-found that names `get_grocery_list` →
  delete in `withAdmin` → typed catch. Success `{ ok: true, name, deleted: true }`.
- **`remove_meal`** — adult-gated; `resolveMealDay` → find the `meal_plan_entries` row for
  `(weekOf, time, mealType)` → delete. Surface `replaced: true` for symmetry with `add_meal`.
- **`create_time_capsule`** — adult-gated; validate `unlockDate` is a future ISO date
  (fail closed otherwise); insert a `time_capsules` row with **no** `capsule_contents`.

Document all three in `ai/TOOLS.md`.

- [ ] **Step 5: Verify green + regenerate the boot**

Run: `npm run ai:boot && npx vitest run tests/unit/hermes-tool-writes.test.ts tests/unit/hermes-tools-dates.test.ts tests/unit/consuela-tools-parity.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/hermes-tools.ts ai/TOOLS.md src/lib/ai-boot.generated.ts tests/unit/hermes-tool-writes.test.ts tests/unit/hermes-tools-dates.test.ts
git commit -m "feat(tools): remove grocery item + remove meal (shared resolveMealDay) + create time capsule"
```

---

### Task 13: `propose_reward_redemption` + `PROPOSAL_TOOLS` map

> `propose_point_adjustment` (:2503-2568) is the exact pattern: **validate only, write
> nothing**, return an inert `{tool, operationId, args}` the chat page turns into a PIN chip.
> Its no-`caller`-gate design is deliberate and must be copied — the tool never moves points,
> so the server route is what re-verifies.
>
> The extraction is the real work. `extractPointProposal` (:194-203) hardcodes the proposal
> type in **four** places, and the spec's "generalize to a `PROPOSAL_TOOLS` map" needs all
> four moved:
>
> | Line | Hardcoding |
> |---|---|
> | :193 | `const PROPOSAL_TOOL = "propose_point_adjustment"` |
> | :195 | `if (name !== PROPOSAL_TOOL) return null` |
> | :198 | `p.proposal.tool === "adjust_points"` — the inner discriminator |
> | :506 | the label literal `"Waiting for a parent's PIN to confirm…"`, which is **not** in `TOOL_STATUS_LABELS` |

**Files:**
- Modify: `src/app/api/hermes/chat/route.ts:188-203` (extractor), `502-508` + `700-705` (both flow-outs), `504` (buffered exhaustion drops proposals)
- Modify: `src/lib/hermes-tools.ts` (new tool, appended)
- Modify: `ai/TOOLS.md`
- Modify: `tests/unit/hermes-chat-stream.test.ts`, create `tests/unit/hermes-tool-family.test.ts` case

**Interfaces:**
- Produces: `PROPOSAL_TOOLS: Record<string, { expectTool: string; label: string }>`
- Produces: `extractProposal(name, result): unknown | null` — generalizes
  `extractPointProposal`; keep the old name as an alias if any test imports it.
- Produces: tool `propose_reward_redemption` returning
  `{ ok: true, proposal: { tool: "redeem_reward", operationId, args: { member, reward, reason } } }`.

- [ ] **Step 1: Write the failing tests**

```ts
it("propose_reward_redemption validates only and writes nothing", async () => {
  seedReward({ id: "7", name: "Movie night", cost: 25 });
  const res = JSON.parse(await runTool("propose_reward_redemption",
    { member: "Emily", reward: "Movie night", reason: "helped all week" }, { caller: PARENT }));
  expect(res.ok).toBe(true);
  expect(res.proposal.tool).toBe("redeem_reward");
  expect(res.proposal.args).toMatchObject({ member: "Emily", reward: "Movie night" });
  expect(res.message).toMatch(/NOT moved|not moved/);   // never claim completion
  expect(ledgerWrites()).toHaveLength(0);               // inert
});

it("resolveMealDay-level honesty: refuses an unknown reward", async () => {
  const res = JSON.parse(await runTool("propose_reward_redemption",
    { member: "Emily", reward: "Private jet", reason: "x" }, { caller: PARENT }));
  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/get_rewards/);
});

it("the extracted map serves BOTH proposal types", async () => {
  stubProviderToolCall({ name: "propose_reward_redemption", args: JSON.stringify({ member: "Emily", reward: "Movie night", reason: "great week" }) });
  const frames = await collectFrames(await postStreamed({ message: "redeem movie night" }));
  const proposalFrame = frames.find((f) => f.event === "status" && f.data.proposal);
  expect(proposalFrame.data.proposal.tool).toBe("redeem_reward");
});
```

The `ledgerWrites()` assertion is the binding one.

- [ ] **Step 2: Run to confirm the red baseline**

Run: `npx vitest run tests/unit/hermes-chat-stream.test.ts`
Expected: FAIL — the extractor is hardcoded to one tool.

- [ ] **Step 3: Replace the four hardcodings with the map**

In `route.ts`:
```ts
/** Tool name -> the inert proposal it produces and the label the chip frame
 *  carries. A proposal tool NEVER writes; the PIN-gated server route is the
 *  only path that moves points or redeems a reward. */
const PROPOSAL_TOOLS: Record<string, { expectTool: string; label: string }> = {
  propose_point_adjustment: { expectTool: "adjust_points", label: "Waiting for a parent's PIN to confirm…" },
  propose_reward_redemption: { expectTool: "redeem_reward", label: "Waiting for a parent's PIN to confirm…" },
};

function extractProposal(name: string | undefined, result: string): { proposal: unknown; label: string } | null {
  const entry = name ? PROPOSAL_TOOLS[name] : undefined;
  if (!entry) return null;
  try {
    const p = JSON.parse(result);
    if (p?.ok === true && p.proposal?.tool === entry.expectTool && p.proposal.args) {
      return { proposal: p.proposal, label: entry.label };
    }
  } catch { /* malformed tool result — nothing to surface */ }
  return null;
}
```

Update both flow-out sites to destructure `{ proposal, label }` and use `label` at :506. Add
`propose_reward_redemption: "Preparing that redemption…"` to `TOOL_STATUS_LABELS` (:152-183)
so its pre-execution status line is not the generic "Working on it…".

**Also fix the buffered exhaustion drop** (:716-719): a turn that exhausts its rounds
currently returns without the `proposals` array, silently discarding a pending PIN chip.
Include `proposals` in that response.

- [ ] **Step 4: Add the tool**

Mirror `propose_point_adjustment` (:2523-2567) — same inline guard order (required-arg →
resolution → text → length → live-read null → entity match), same `{ok:true, proposal, message}`
shape, `createTaskOperationId()` generated inside the returned object. Resolve the reward via
`liveRewards()` reusing **`r.cost ?? r.points ?? 0`** (`get_rewards:2496`) so the chip's price
cannot disagree with what the server charges. Copy the `message` contract: say it awaits
confirmation and **never** state it as done. Document in `ai/TOOLS.md`.

- [ ] **Step 5: Verify green**

Run: `npm run ai:boot && npx vitest run tests/unit/hermes-chat-stream.test.ts tests/unit/hermes-tool-family.test.ts tests/unit/chat-points-chip.test.tsx`
Expected: PASS — `chat-points-chip` is the regression guard that the refactor didn't break the
existing point proposal.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/hermes/chat/route.ts src/lib/hermes-tools.ts ai/TOOLS.md src/lib/ai-boot.generated.ts tests/unit/hermes-chat-stream.test.ts tests/unit/hermes-tool-family.test.ts
git commit -m "feat(tools): propose_reward_redemption + PROPOSAL_TOOLS map (proposals survive buffered exhaustion)"
```

---

### Task 14: `RedeemRewardChip`

> Mirror `AdjustPointsChip` (197 lines) closely — submit/wrong-PIN/unreachable/clear-on-close,
> PIN in memory only, cleared when the dialog closes.
>
> **It POSTs to `/api/rewards/redeem`, NOT `/api/consuela/planner/apply`.** The planner
> route's `ALLOWED_TOOLS` (`apply/route.ts:41`) is deliberately tighter (`:38-40`: "the
> planner surface may ONLY ever create a calendar event or apply a PIN-confirmed point
> adjustment"), and it requires `requireLiveSession(..., { requireRole: "parent" })` (:195) —
> a stronger gate than the redeem route. Widening it would loosen a deliberately tight
> allowlist. The redeem route is the canonical write path and already re-verifies both PINs.
>
> The body contract is **seven fields in the JSON body** (no header auth):
> `{ operationId, rewardId, rewardName, memberName, pin, parentName, parentPin }`.

**Files:**
- Create: `src/components/chat/RedeemRewardChip.tsx`
- Modify: `src/app/chat/page.tsx:541-552` (render alongside `AdjustPointsChip`)
- Create: `tests/unit/chat-redeem-chip.test.tsx`

**Interfaces:**
- Produces: `RewardRedemptionProposal` + `isRewardRedemptionProposal(value)` guard
- Produces: `<RedeemRewardChip proposal actorName />`

- [ ] **Step 1: Write the failing tests**

Copy the harness from `chat-points-chip.test.tsx` (`createRoot`+`act`,
`IS_REACT_ACT_ENVIRONMENT = true`, the URL-routing `fetch` stub at :81-99, the open-gated
`Modal` mock at :43-53, and the native-setter `typePin` helper at :105-109). Cases:

```tsx
it("POSTs the seven-field contract to /api/rewards/redeem", async () => {
  stubFetch({ status: 200, body: { ok: true, weekData: { points: { Emily: 25 } } } });
  render(<RedeemRewardChip proposal={PROPOSAL} actorName="Alex" />);
  clickChip(); typePin(el, "1234"); clickSubmit();
  const call = redeemCalls[0];
  expect(call.url).toContain("/api/rewards/redeem");
  expect(call.url).not.toContain("planner/apply");
  expect(JSON.parse(call.init.body)).toEqual({
    operationId: PROPOSAL.operationId, rewardId: "7", rewardName: "Movie night",
    memberName: "Emily", pin: "1234", parentName: "", parentPin: "",
  });
});

it("reveals parent name+PIN fields only when cost > 100", async () => {
  render(<RedeemRewardChip proposal={{ ...PROPOSAL, args: { ...PROPOSAL.args, cost: 150 } }} actorName="Alex" />);
  clickChip();
  expect(el.querySelector('input[data-testid="parent-name"]')).not.toBeNull();
  // ...and absent at cost 25
});

it("treats 409 / reason:duplicate as already done", async () => {
  stubFetch({ status: 409, body: { ok: false, reason: "duplicate", error: "already went through" } });
  // ...expect the Done ✓ chip
});

it("reuses one operationId across retries so a retry can't double-redeem", async () => {
  stubFetch([{ status: 503, body: { ok: false, reason: "ledger_unavailable" } },
             { status: 200, body: { ok: true } }]);
  // fail then retry; assert both bodies carry the SAME operationId
});

it("renders from the returned weekData rather than re-reading", async () => { /* ... */ });

it("surfaces insufficient honestly", async () => {
  stubFetch({ status: 400, body: { ok: false, reason: "insufficient", error: "Emily needs 15 more pts for 🎁 Movie night" } });
  // ...expect that message as the pinError
});
```

- [ ] **Step 2: Run to confirm the red baseline**

Run: `npx vitest run tests/unit/chat-redeem-chip.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement the component**

Structure follows `AdjustPointsChip` line-for-line: states `open`/`pinValue`/`pinError`/`busy`/
`done`, a 3s toast with unmount cleanup (:54-66), `closePin` clearing the PIN (:68-74), and the
guard order in `submitPin` (re-entrancy → clear input → `<4` → missing operationId → missing
actor → `verifyPinRemote`). Differences:

```tsx
const res = await fetch("/api/rewards/redeem", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    operationId,                                   // generated at MOUNT, reused on every retry
    rewardId: String(proposal.args.rewardId),
    rewardName: proposal.args.reward ?? null,
    memberName: proposal.args.member,
    pin,
    parentName: approval.name,
    parentPin: approval.pin,
  }),
});
const data = await res.json().catch(() => ({}));
// The redeem route returns 409 + reason:"duplicate" for a replayed operationId
// (NOT a 200 with duplicate:true like the planner route) — treat it as done.
if (res.status === 409 || data?.reason === "duplicate") { closePin(); setDone(true); … }
```

Mirror the cost threshold: show the parent fields when `cost > 100`
(`PARENT_APPROVAL_MIN_COST`, redeem route:29) — strictly greater, so exactly 100 needs none.

- [ ] **Step 4: Render it on the chat page**

Beside `AdjustPointsChip` (:541-552), add a branch for `p.tool === "redeem_reward"`. Keep the
existing `data-testid="point-proposals"` container and give the redeem row its own testid.

- [ ] **Step 5: Verify green**

Run: `npx vitest run tests/unit/chat-redeem-chip.test.tsx tests/unit/chat-points-chip.test.tsx tests/unit/chat-page-stream.test.tsx tests/unit/tap-target-contract.test.ts tests/unit/warm-glass-contracts.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/RedeemRewardChip.tsx src/app/chat/page.tsx tests/unit/chat-redeem-chip.test.tsx
git commit -m "feat(chat): RedeemRewardChip — rewards redeem only behind a PIN, POSTing the canonical redeem route"
```

**Landing 3 gate:** `npm run ai:boot` + `npx vitest run` + `npm run typecheck` + `npm run lint`.

---

## Documentation tasks

> Split from a single docs task at the user's request, so a problem in one document does not
> block shipping the others. Each is independently revertable. All three land in the **same
> session** as the code (repo rule: docs never drift from code).

### Task 15: `docs/ARCHITECTURE.md` — SSE contract rewrite

> `docs/ARCHITECTURE.md:104-147` still documents **Hermes as the chat path**. That is stale —
> Hermes left on 2026-09-07. This task both fixes that drift and records the new wire
> contract from spec §5.

**Files:**
- Modify: `docs/ARCHITECTURE.md` (§5 chat/SSE section; the stale Hermes chat path at :104-147)

- [ ] **Step 1: Rewrite the chat section**

Replace the Hermes-as-chat-path text with the shipped contract:

```
data: {"t":"<delta>"}                        — content token (answering attempt only)
event: attempt\ndata: {"round","target"}     — new (round x target) call; client resets the bubble
event: reasoning\ndata: {"r":"<delta>"}      — reasoning delta (display-only, never persisted)
event: tool\ndata: {"name","state"}         — running | ok | error
event: status\ndata: {"label","proposal"?}  — status line; proposal frames carry the PIN chip payload
event: error\ndata: {"message"}              — terminal failure; the client renders it verbatim
: ping                                       — heartbeat every 15s (comment frame, ignored by parsers)
data: [DONE]                                 — terminator
```

Also record: `X-Accel-Buffering: no` on the streamed response; `AI_STREAM_TIMEOUT_MS = 120_000`
for streamed calls vs `AI_TIMEOUT_MS = 60_000` for buffered/planner; **displayed === persisted**
(the attempt-reset invariant); reasoning + tool activity are display-only and stripped in
`persistHistory`; route `event: error` text reaches the user via `RouteChatError`.

- [ ] **Step 2: Correct the stale Hermes references**

Every "Hermes is the chat path" claim in §5 becomes "the dashboard-owned provider chain
(`consuela_ai_providers`)". Note that the route **filename** `/api/hermes/chat` is retained
deliberately — 10 callers keep working and the URL is load-bearing.

- [ ] **Step 3: Verify no drift**

Run: `grep -n "Hermes" docs/ARCHITECTURE.md` — every remaining hit must be a historical
note or the filename rationale, never a live-path claim.

- [ ] **Step 4: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: rewrite the chat SSE contract; correct the stale Hermes-as-chat-path section"
```

---

### Task 16: `docs/DESIGN.md` — UI Change Records

**Files:**
- Modify: `docs/DESIGN.md`

- [ ] **Step 1: Add the UI Change Records**

Three records, each with its contracts:

1. **Thinking transcript** — `ThinkingDisclosure`: 💭 header, opens while thinking,
   auto-collapses when the answer starts, re-openable. 12px type floor, ≥44px target via
   `.hit-44`, tokens only, reduced-motion respected. **Display-only** — never persisted.
2. **Tool activity chips** — `ToolActivityChips`: ⏳/✅/❌ per tool, `data-state` for
   non-color reading, `aria-label` per chip, glyphs `aria-hidden`.
3. **Redemption chip** — `RedeemRewardChip`: mirrors `AdjustPointsChip`; parent name+PIN
   fields appear only when `cost > 100`; 409/duplicate renders as done; PIN cleared on close.

- [ ] **Step 2: Note the blank-line convention**

Begin each record heading with a **blank line** before it (learned from the 2026-09-29
task-creation review, which flagged the missing blank line as a minor).

- [ ] **Step 3: Commit**

```bash
git add docs/DESIGN.md
git commit -m "docs: UI change records for the thinking transcript, tool chips and redemption chip"
```

---

### Task 17: `CHANGELOG.md` + `AGENTS.md`

**Files:**
- Modify: `CHANGELOG.md` (prepend to "Long-form entries")
- Modify: `AGENTS.md` (Current Dashboard Snapshot)

- [ ] **Step 1: Write the CHANGELOG entry**

One long-form entry at the top, same session as the ship:
`- 2026-10-01 — fix(chat): replies always render live (optimistic-id collision + 6 supporting weaknesses) · thinking UI + 8 tools`

Cover: the root cause and why it was deterministic; all seven weaknesses; the attempt-frame
invariant; the new SSE frames; the eight tools and their role gating; tests; the ops notes
(no PB schema change → **no `pb:seed`**; new probe; no new env/secret requirements).

- [ ] **Step 2: Update the AGENTS.md snapshot**

Add a new newest entry, and **trim to at most 2 entries** (repo rule) — the 2026-09-29 crew
close entry falls off into `CHANGELOG.md`.

- [ ] **Step 3: Verify the secrets rule**

Run: `git status --short` — confirm no `.env*` (except `.env.example`), no
`DEPLOY_NAS_LOCAL.md`, no literal tokens in the staged diff. `public/version.json` must
remain **unstaged** (build-generated, not ours).

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md AGENTS.md
git commit -m "docs: CHANGELOG entry + AGENTS snapshot for chat reliability, thinking UI and tool gaps"
```

---

### Task 18: Probe + full gates + ship

> **The probe establishes a new pattern.** `route.fulfill({ body })` delivers the whole body
> as **one buffered chunk** — it cannot reproduce incremental chunk timing or a mid-stream
> transport drop, both of which are exactly what this feature is about. Use
> `route.fulfill({ body: stream.Readable })`. No existing probe does this.

**Files:**
- Create: `scripts/consuela/verify-chat-reliability.mjs`

**Interfaces:**
- Produces: `node scripts/consuela/verify-chat-reliability.mjs` — exits 0 on pass, 1 on fail.
  Honors `KEEP_CHAT_RELIABILITY_ARTIFACTS=1` to retain logs.

- [ ] **Step 1: Build the harness**

**Model on `verify-emergency-settings.mjs` (252 lines), not `verify-chat-speed.mjs` (38
lines).** The latter has none of the hardening. Import and reuse verbatim:
- `buildProbeEnv(appUrl)` from `./probe-env.mjs`
- `getFreePort` (ephemeral bind, close, hand off)
- `bootDevServer` — `detached: true` on non-Windows so the process **group** can be signalled
- `waitForReady` — fails fast on child death; requires HTTP 200 **and** a `Ready in` log line
- `stopDevServer` — SIGTERM → 5s → SIGKILL → 2s → **await log closure** → wipe `.next/dev`
- `createIdempotentProbeCleanup` + `installProbeSignalHandlers` from `./probe-helpers.mjs`
- `serverLogTail` on failure

Seed localStorage via **`context.addInitScript`** (context, not page, so it lands before app
boot), and install a `**/api/**` catch-all so nothing reaches a real service.

- [ ] **Step 2: Write the scenarios**

```js
// 1. The headline bug: a stale localStorage row must NOT swallow the reply.
await context.addInitScript(() => {
  localStorage.clear();
  localStorage.setItem("consuela-chat-messages", JSON.stringify([
    { id: 101, role: "assistant", content: "yesterday", timestamp: "Yesterday", at: 1 },
  ]));
});
await route.sse("data: {\"t\":\"today's reply\"}\n\ndata: [DONE]\n\n");
check("reply renders despite a colliding stale row",
  await page.locator("text=today's reply").count() > 0);
check("stale row survives", await page.locator("text=yesterday").count() > 0);

// 2. Reasoning frames render as a live transcript.
await route.sse([
  'event: attempt\ndata: {"round":1,"target":"a"}\n\n',
  'event: reasoning\ndata: {"r":"checking the calendar"}\n\n',
  'data: {"t":"Soccer at 5."}\n\n',
  "data: [DONE]\n\n",
].join(""));
// assert the disclosure appears, then auto-collapses on the answer

// 3. Tool error is VISIBLE.
await route.sse([
  'event: tool\ndata: {"name":"get_pantry","state":"running"}\n\n',
  'event: tool\ndata: {"name":"get_pantry","state":"error"}\n\n',
  'data: {"t":"I couldn\'t check the pantry."}\n\n',
  "data: [DONE]\n\n",
].join(""));
check("failed tool shows an error chip",
  await page.locator('[data-state="error"]').count() > 0);

// 4. Attempt reset keeps displayed === persisted. NEW PATTERN — needs a stream.
await route.stream([
  'event: attempt\ndata: {"round":1,"target":"a"}\n\n',
  'data: {"t":"FIRST ATTEMPT"}\n\n',
  'event: attempt\ndata: {"round":1,"target":"b"}\n\n',
  'data: {"t":"second attempt"}\n\n',
  "data: [DONE]\n\n",
]);
check("failed-over attempt is replaced, not concatenated",
  await page.locator("text=FIRST ATTEMPT").count() === 0);

// 5. The route's error text reaches the user verbatim.
await route.sse('event: error\ndata: {"message":"My brain isn\'t configured yet."}\n\n');
check("route error text renders verbatim",
  await page.locator("text=My brain isn't configured yet.").count() > 0);
```

Implement `route.sse(body)` as `route.fulfill({ body })` and `route.stream(frames)` with
`route.fulfill({ body: stream.Readable })` emitting frames on an interval so the read loop
genuinely blocks between them.

- [ ] **Step 3: Run the probe**

Run: `npm run build && node scripts/consuela/verify-chat-reliability.mjs`
Expected: `ALL CHAT-RELIABILITY CHECKS PASSED`

Run `npm run build` first: `prebuild` fires `write-ai-boot.mjs`, and the probes spawn
`npm run dev`, which does **not** run prebuild — without it the probe tests a stale persona.

- [ ] **Step 4: Run every gate**

```bash
npx vitest run                 # full suite — no new failures vs the 0b47af4 baseline
npm run typecheck              # clean
npm run lint                   # 0 new errors on touched files
npm run build                  # exit 0
node scripts/consuela/verify-chat-reliability.mjs   # new probe
node scripts/consuela/verify-chat-speed.mjs         # MUST stay green
```

If you added a new env key in `src/` or `.env.example`,
`tests/unit/settings-task9-hardening.test.ts` **fails** until it is added to `SAFE_PROBE_ENV`
in `scripts/consuela/probe-env.mjs`. This plan adds no new env keys.

- [ ] **Step 5: Commit the probe**

```bash
git add scripts/consuela/verify-chat-reliability.mjs
git commit -m "test(chat): reliability probe — stale-id collision, reasoning frames, tool errors, attempt reset"
```

- [ ] **Step 6: Push both repos**

```bash
bash scripts/security/push-safe.sh          # MUST print CLEAN
git push origin warm-glass-v2
```
Then in the **parent** `Dashboard` repo — stage **only** named paths, never `git add .`:
```bash
git add Home-ai docs/superpowers/specs/2026-10-01-consuela-chat-reliability-design.md \
        docs/superpowers/plans/2026-10-01-consuela-chat-reliability.md
git commit -m "chore(submodule): Home-ai -> chat reliability, thinking UI + 8 tools"
bash scripts/security/push-safe.sh
git push origin main
```
> Both specs and plans for this feature live **together in `Home-ai/docs/superpowers/`**
> per the user's decision. Home-ai's AGENTS.md §6.4 says otherwise (outer repo for Home-ai
> features), so this is a **known, accepted deviation** — and repo organization is a
> separate future project. Do not "fix" it in this plan.

- [ ] **Step 7: Ask about deploy**

**Always end the turn asking "Deploy to NAS now?"** Pushing to GitHub is never a deploy —
the NAS runs its own containers. Runbook: `DEPLOY_NAS_LOCAL.md` (local-only).

Post-deploy verification (this plan's fixes are brain-agnostic, so this is where the live
chain finally gets confirmed):
1. Send a real message that **invokes a tool** and confirm the ✅/❌ chip appears.
2. Send a message that triggers a tool error and confirm the ❌ chip + an honest reply.
3. **Settings → AI Models → AI Health** — reads the outcome ring buffer and answers the
   open question from spec §1 ("whether fallback providers exist behind the brain").
4. Confirm reasoning renders and auto-collapses, and that refreshing shows the same text.

---

## Execution order

1. **Landing 1** (T1–T7) — the reported bug. Ship value on its own; verify against the live
   symptom before moving on.
2. **Landing 2** (T8–T10) — depends on T6's attempt frames.
3. **Landing 3** (T11–T14) — independent of 1 and 2; can run in parallel if desired.
4. **Docs** (T15–T17) — after their owning code lands.
5. **T18** — probe, gates, push, deploy question.

## Rejected alternatives (spec §10, restated with this plan's findings)

- **Rebuild the transport (WebSocket)** — huge blast radius. The Next 16 route streaming
  works and every failure found is fixable inside the current SSE shape.
- **Ids + watchdog hotfix only** — faster, but leaves the thinking display and tool gaps
  unanswered.
- **Round frames instead of attempt frames** — keeps a "Let me check…" preamble visible on
  round boundaries, but displayed ≠ persisted and the reconcile duplicate stays. Truth wins.
- **`planner/apply` for reward redemption** — would require widening a deliberately tight
  `ALLOWED_TOOLS` (`apply/route.ts:38-41`) and inherits a stricter session gate than the
  redeem route needs. The redeem route is the canonical path and re-verifies both PINs.
- **One combined docs task** — a problem in one document would block the others from
  shipping (the user's reason for the split).
