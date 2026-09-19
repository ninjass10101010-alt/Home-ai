# Ask Consuela — Deterministic Thread Ordering + Clean New Conversation

**Date:** 2026-09-18
**Status:** Approved (design)
**Area:** `src/app/chat/page.tsx`, new `src/lib/chat-thread.ts`, `src/db/pb-db.ts`

## Problem

Two user-reported defects on the Ask Consuela screen:

1. **The reply sometimes renders above the message the user just sent.** Reported as
   intermittent and happening "right after sending".
2. **Starting a new conversation leaves all previous messages on screen.** `/new`,
   `/restart`, and the top-bar button add a "New conversation" divider but never clear
   the visible thread.

Both trace to the same architecture flaw: the in-memory thread is mutated by
**blind replacement** (`setMessages(pbMsgs)`) and **blind append** (`mergePBThread`
pushes new rows to the end), with render order defined solely by array position.

## Root Causes

### RC1 — Mount hydration clobbers an in-flight send

`src/app/chat/page.tsx` mount effect:

```ts
const { messages: pbMsgs, latest } = await fetchPBThread();
if (pbMsgs.length > 0) {
  setMessages(pbMsgs);        // <-- replaces whatever is on screen
} else {
  const saved = loadChatHistory();
  if (saved.length > 0) setMessages(saved);  // <-- also a replace
}
```

If the user sends before this fetch resolves:

1. Optimistic thread = `[greeting, user]`; stream appends `assistant`.
2. Hydration resolves and **replaces** the array with PB history, dropping the
   optimistic `user` row.
3. The post-send reconcile fetches the persisted `user` row and
   `mergePBThread` appends it at the **end**.
4. Result: `[..., assistant, user]` — the reply sits above the request.

It is intermittent because it only fires when the send wins the race against the
initial PB load.

### RC2 — New conversation never clears the view

`startNewConversation` appends a local `system` marker and POSTs the reset, but the
render path maps the **entire** `messages` array. The marker is only a visual divider;
everything before it stays on screen. The existing test already describes the intended
behaviour as "the local view resets to the greeting + a system divider"
(`tests/unit/chat-page-stream.test.tsx:406`), but the assertion never checked it.

### RC3 — Dedupe key includes `speaker`, so signed-out rows duplicate

`mergePBThread`'s key is `role:speaker:content`. A signed-out local user row carries
`speaker: <selected member name>` while the persisted PB row maps to `speaker: "guest"`.
The keys never match, so the PB copy is appended as a duplicate.

## Goals

- Thread order is deterministic and chronological regardless of when hydration,
  streaming, or reconcile land.
- A message the user just sent can never be dropped or reordered by a late fetch.
- Starting a new conversation shows a genuinely fresh thread, immediately, after a
  reload, and on other devices.
- No PocketBase schema change or migration.

## Non-Goals

- A server-assigned monotonic `seq` column on `chat_messages` (deferred; revisit only
  if cross-device ordering still misbehaves after this change).
- "Show earlier messages" / collapsed-history UI (deliberately out of scope).
- Any change to the LLM context-cutoff contract (already slices on the newest `system`
  marker via `messagesRef`).

## Design

### 1. Message model — add `at`

Extend the page-local `Message` interface with `at: number` (epoch ms):

- PB rows (`fetchPBThread`): `at = Date.parse(m.createdAt) || 0`.
- Optimistic local rows (user message, streaming reply, reset marker): `at = Date.now()`.
- `initialGreeting` and any legacy localStorage rows lacking `at`: `at = 0` (sort first).
- The streaming assistant bubble keeps its original `at` when its content is finalised.

`at` is persisted with the thread in `consuela-chat-messages`, so ordering survives
reloads.

### 2. New pure module `src/lib/chat-thread.ts`

No React. Exports:

- `threadKey(m)` → `` `${m.role}\u0000${m.content}` ``.
  Drops `speaker` (fixes RC3). Count semantics are preserved by the merge, so genuine
  repeated identical messages still render once per occurrence. Accepted trade-off:
  two different members posting the exact same text inside one reconcile window may
  collapse to one row.
- `sortThread(msgs)` → stable ascending by `at`; ties broken by role rank
  (`user < system < assistant`), then original index. Returns a new array.
- `mergeThread(prev, incoming)` → multiset union by `threadKey`, keeping the existing
  (`prev`) row because it carries UI-only fields (`proposals`, `errorFor`,
  `speakerEmoji`). **Insertion order is irrelevant** — callers sort. `mergeThread` is
  purely additive: it never removes rows (so a late hydration can never delete an
  optimistic message).
- `lastResetIndex(msgs)` → index of the newest `system` row, `-1` if none (assumes
  already sorted).
- `visibleThread(msgs)` (assumes already sorted) → slice from the newest `system`
  marker to the end
  (inclusive; a marker that is the last message yields `[marker]`), else the whole
  list. Then, **if the sliced result contains any `user` row, drop the seed
  `initialGreeting` (`id === 1`)**.

  This single rule replaces today's inconsistent behaviour: currently the greeting
  survives a send (blind append) but is dropped on reload (blind replace), so it can
  appear above the user's first question after the first reply. With the rule, the
  greeting is visible only in a truly untouched thread, and never on restored history.

### 3. Hydration merges instead of replacing

In `src/app/chat/page.tsx`, the mount effect becomes functional:

```ts
setMessages(prev => mergeThread(prev, pbMsgs.length > 0 ? pbMsgs : saved));
```

A late hydration can no longer wipe an optimistic message. The localStorage seed
effect also goes through `mergeThread`.

### 4. Render + page model use the ordered, sliced thread

Add one memo:

```ts
const visibleMessages = useMemo(() => visibleThread(sortThread(messages)), [messages]);
```

Feed it to every surface that shows or reasons about the visible conversation:

- the message map (`page.tsx:825`),
- `userMessageCount` / `showHero` / `showQuickActions`,
- `lastAssistantReply` (read-aloud).

`messagesRef` keeps the **full** array for the LLM history slice (already cuts at the
newest `system` marker) — unchanged.

### 5. New conversation becomes a clean view

`startNewConversation` continues to append the local marker and POST `{action:"reset"}`.
Because the marker is a `system` row stored in localStorage and written to PB, the
`visibleThread` slice hides everything before it:

- immediately (local marker present),
- after a reload (PB hydration returns the marker),
- on other devices (same PB thread).

With no messages after the marker, `userMessageCount` is `0` → the hero/greeting state
renders, i.e. a genuinely fresh chat. `/new` remains ignored while a stream is in
flight (unchanged).

### 6. Deterministic PB ordering (defense in depth)

`selectChatMessages` (`src/db/pb-db.ts:709`) sort becomes `"createdAt,id"` so rows with
an identical `createdAt` still come back in a stable order. `persistChatPair`'s `+1ms`
user-before-assistant offset stays as the primary guarantee.

### 7. Test impact

New `tests/unit/chat-thread.test.ts` (pure):

- `sortThread` orders by `at`, breaks user/assistant ties as user-first, is stable.
- `visibleThread` slices from the newest marker; returns all when no marker.
- `mergeThread` dedupes across differing `speaker` (RC3), keeps the `prev` row's
  UI fields, and never drops a `prev` row.
- `visibleThread` drops the seed greeting once a `user` row is present, and keeps it in
  an untouched thread.
- a backdated `incoming` row sorts into the middle rather than the end.

Page tests (`tests/unit/chat-page-stream.test.tsx`):

- **hydration landing after a send** (delayed `/api/chat/messages` response) keeps the
  sent request and renders the reply **below** it.
- Update the stale `chat-page-stream.test.tsx:406` comment/assertion to assert the
  fresh thread (pre-marker messages gone).

Existing green suites must stay green: `chat-conversation-reset` (LLM cutoff uses the
full `messagesRef`; `/new` still POSTs once), `chat-messages-since`, `chat-context-speech`.

## Edge Cases

- **Marker with no `at`** (legacy localStorage written before this change): sorts first,
  so pre-hydration it does not slice. PB hydration supplies the marker with a real `at`,
  after which slicing applies. Transient and self-healing; documented, not coded around.
- **Stream aborted/failed:** optimistic rows persist with their `at`; no reorder.
- **Guest thread** (`userId: "guest"`): dedupe now matches, removing the duplicate row.
- **Multiple resets in one day:** `lastResetIndex` picks the newest by sorted order.

## Verification

- `npx vitest run` full suite green; new `chat-thread` suite green.
- `tsc --noEmit` clean; eslint 0 on touched files.
- Manual jsdom scenario: delayed hydration + send → request stays, reply below.

## Ops / Docs

- No PB seed or migration required.
- AGENTS.md: add the UI Change Record entry + Current Dashboard Snapshot line; correct
  the stale `/new` "clears the visible thread" claim so it is now true.
