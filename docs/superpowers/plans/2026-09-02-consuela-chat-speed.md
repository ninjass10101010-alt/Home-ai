# Consuela Chat Speed + Wiring Sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut Consuela's per-message latency floor (~2.5s of dead weight + a hard 2s artificial delay) and stream her answers token-by-token, then remove the dead Consuela wiring and parallelize the background engine.

**Architecture:** Three sequential landings. **L1 (quick wins):** delete the provably-dead `/api/chat/process` pre-flight from the composer, shrink the artificial thinking delay, cache the Hermes endpoint config in-process, add a 60s timeout to every Hermes call, parallelize independent reads/writes. **L2 (streaming):** `/api/hermes/chat` gains an opt-in SSE mode (`stream: true` in the body) that pipes Hermes content deltas to the browser while tool rounds execute server-side (in parallel) with friendly status events; a shared client helper (`src/lib/chat-stream.ts`) serves both the chat page and Clem; auto-fallback to the current buffered JSON when Hermes can't stream. **L3 (cleanup):** delete the orphaned clarification stack + dead components, parallelize the suggestion engine + briefing reads, convert the worst fetch-all-then-filter tool handlers to PB-side filters/batched reads, make the post-send thread reconcile incremental, and tighten the Telegram mirror cron 30→5 min.

**Tech Stack:** Next.js 16 (App Router, Node runtime), React 19, PocketBase (via `withAdmin`), vitest 4 + jsdom, Playwright probes under `scripts/consuela/`.

**Spec:** `docs/superpowers/specs/2026-09-02-consuela-chat-speed-design.md`

## Global Constraints

- Every Hermes HTTP call gets `signal: AbortSignal.timeout(60_000)`.
- Buffered (non-`stream`) behavior of `/api/hermes/chat` stays byte-compatible for existing callers: `useMeals.ts`, `useRecipes.ts`, `tasks/page.tsx`, `recipes/ingest/route.ts` must not change.
- Role gating is untouched: role comes only from the signed session cookie; kids get no house-control tools (route.ts:145-150).
- Chat thread ids stay UTC `YYYY-MM-DD` (AGENTS.md §3.5).
- `conflict-detection.ts` is LIVE (`/api/conflicts/check`, `ConflictWarning`, `hermes-tools` dynamic import) — never delete it.
- `src/db/features/*` schema/type definitions stay (AGENTS.md convention) — only the unused `buildSystemPrompt` function goes.
- Test commands: `npx vitest run <file>` (single), `npx vitest run` (full suite). Gates: `npm run typecheck`, `npm run lint` (0 new errors on touched files), full suite green. Baseline: one known failure (`hermes-chat-clem` "fallback URL is :8642" — stale test; Task 1 updates it to the adjudicated `:8643`).
- **Staging discipline:** the working tree carries unrelated in-flight work (weather refactor, AvatarPicker, AGENTS.md edits, verify scripts). Stage ONLY the explicit file paths listed per task — never `git add -A` or `git add .`. Task 13's AGENTS.md commit will include the other workstream's pending AGENTS.md edits (user-approved 2026-09-02).
- Commit after each task (repo convention). Confirm with the user before the first commit of the session.
- AGENTS.md must be updated in the same session as the code changes (Task 13) — mandatory repo rule.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/app/api/hermes/chat/route.ts` | Modify (T1,T2,T6) | Chat backend: config resolution (cached), buffered + streaming tool loops, persistence |
| `src/components/chat/UnifiedInput.tsx` | Modify (T3) | Composer: direct send, no pre-flight, no clarification UI |
| `src/app/chat/page.tsx` | Modify (T4,T7,T12) | Chat UI: streaming render, status line, reduced delay floor, incremental reconcile |
| `src/lib/chat-stream.ts` | Create (T5) | SSE frame parser + `streamConsuelaChat()` client helper (shared by chat page + Clem) |
| `src/components/meals/ClemAssistant.tsx` | Modify (T8) | Clem: streaming opt-in via shared helper |
| `src/app/api/chat/process/route.ts` | Delete (T9) | Dead pre-flight route |
| `src/lib/consuela-ai-enhanced.ts` | Delete (T9) | Dead clarification layer |
| `src/components/clarification/ClarificationModal.tsx` | Delete (T9) | Dead modal (only consumer removed in T3) |
| `src/components/ui/ConsuelaFAB.tsx` | Delete (T9) | Orphaned FAB (zero importers) |
| `src/db/features/family-ai.ts` | Modify (T9) | Remove unused `buildSystemPrompt`; keep schemas/types |
| `src/lib/consuela/engine.ts` | Modify (T10) | Scanners run concurrently |
| `src/lib/consuela/briefing.ts` | Modify (T10) | Post-engine reads run concurrently |
| `src/lib/hermes-tools.ts` | Modify (T11) | Filtered/batched PB reads in hot handlers |
| `src/app/api/chat/messages/route.ts` | Modify (T12) | `?since=` incremental thread read |
| `scripts/consuela/verify-chat-speed.mjs` | Create (T12) | Playwright probe: no pre-flight, SSE renders, fast first paint |
| `scripts/consuela/host-crontab.example` | Modify (T13) | Telegram poll `*/30` → `*/5` |
| `src/lib/services/registry.ts` | Modify (T13) | Telegram description text 30-min → 5-min |
| `AGENTS.md` | Modify (T13) | Snapshot + UI Change Record + §5.2 cron table + Change Log |
| `tests/unit/*` | Create/Modify | See each task |

---

## Landing 1 — Quick wins

### Task 1: Fix the stale Hermes-port test (8643 is the Consuela gateway)

Commit `6479d8d` (2026-08-31 22:46, live who-are-you probes: **8643 = Consuela gateway, 8642 = Alex finance**) made the route's `8643` fallback + Clem hardcode correct — but the test `tests/unit/hermes-chat-clem.test.ts` "fallback URL is :8642" still encodes the superseded assumption and is the repo's one known red test. This task updates the stale test (controller + user adjudication 2026-09-02: 8643 governs; do NOT change the route's ports).

**Files:**
- Modify: `tests/unit/hermes-chat-clem.test.ts:142-147`
- No production-code change.

**Interfaces:**
- Produces: green baseline for Tasks 2/6 (both touch this file / rely on the route's `8643` constants).

- [ ] **Step 1: Run the failing test to confirm the red baseline**

Run: `cd Home-ai && npx vitest run tests/unit/hermes-chat-clem.test.ts`
Expected: FAIL — `Expected: "http://hermes-agent-2:8642" Received: "http://hermes-agent-2:8643/v1/chat/completions"` (1 failed | 10 passed)

- [ ] **Step 2: Update the stale test + pin the Clem hardcode**

In `tests/unit/hermes-chat-clem.test.ts`, replace the fallback test (lines 142-147):

```ts
  it("fallback URL is :8643 when no registry or env", async () => {
    await post({ message: "hi" });
    const fetchUrl = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(fetchUrl).toContain("http://hermes-agent-2:8643");
    expect(fetchUrl).not.toContain("8642");
  });

  it("clem hardcodes the Consuela gateway :8643 regardless of registry/env", async () => {
    mocks.getServiceConfig.mockImplementation(async (service: unknown, key: unknown) =>
      service === "hermes" && key === "HERMES_API_URL" ? "http://finance:8642" : null
    );
    await post({ message: "hi", agent: "clem" });
    const fetchUrl = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(fetchUrl).toContain("http://hermes-agent-2:8643");
  });
```

- [ ] **Step 3: Run the test to verify green**

Run: `cd Home-ai && npx vitest run tests/unit/hermes-chat-clem.test.ts`
Expected: PASS (12/12)

- [ ] **Step 4: Commit**

```bash
git add tests/unit/hermes-chat-clem.test.ts
git commit -m "test(chat): Hermes fallback is :8643 (Consuela gateway per 6479d8d live probes) + pin Clem hardcode"
```

---

### Task 2: Hermes config cache + 60s timeout + parallel persist

**Files:**
- Modify: `src/app/api/hermes/chat/route.ts` (`resolveHermes`, `callHermes`, `persistChatPair`)
- Modify: `tests/unit/hermes-chat-clem.test.ts` + `tests/unit/hermes-chat-role.test.ts` (add cache reset to `beforeEach`)
- Create: `tests/unit/hermes-config-cache.test.ts`

**Interfaces:**
- Produces: `export function resetHermesChatForTests(): void` from `@/app/api/hermes/chat/route` — resets the module-scope config cache (and, from Task 6 on, the streaming-support flag). Every test file that imports the route calls it in `beforeEach`.
- Produces: `resolveHermes()` now returns a cached `{ url, key }` for 10 minutes; `callHermes` fetch carries `signal: AbortSignal.timeout(60_000)`; `persistChatPair` awaits both inserts via `Promise.all` with explicit `createdAt` (user row first, assistant row +1ms so the `createdAt`-ascending thread sort can never tie).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/hermes-config-cache.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  buildToolsForOpenAI: vi.fn(() => []),
  getTool: vi.fn(() => undefined),
  insertChatMessage: vi.fn(async () => ({})),
  getServiceConfig: vi.fn(async (..._args: unknown[]) => null as string | null),
}));

vi.mock("@/lib/hermes-tools", () => ({
  buildToolsForOpenAI: mocks.buildToolsForOpenAI,
  getTool: mocks.getTool,
}));
vi.mock("@/lib/services/config", () => ({ getServiceConfig: mocks.getServiceConfig }));
vi.mock("@/db", () => ({ db: { insertChatMessage: mocks.insertChatMessage } }));

import { POST, resetHermesChatForTests } from "@/app/api/hermes/chat/route";

function hermesReply(content = "ok") {
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), { status: 200 });
}

async function post(message: string) {
  return POST(
    new NextRequest("http://localhost/api/hermes/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    })
  );
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  vi.stubEnv("HERMES_API_URL", "");
  vi.stubEnv("HERMES_API_KEY", "");
  resetHermesChatForTests();
  mocks.getServiceConfig.mockReset().mockResolvedValue(null);
  mocks.insertChatMessage.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => hermesReply()));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("hermes chat — config cache + resilience", () => {
  it("reads service config once across two messages (URL + KEY)", async () => {
    await post("one");
    await post("two");
    expect(mocks.getServiceConfig).toHaveBeenCalledTimes(2);
  });

  it("re-reads config after the 10-minute TTL expires", async () => {
    await post("one");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await post("two");
    vi.useRealTimers();
    expect(mocks.getServiceConfig).toHaveBeenCalledTimes(4);
  });

  it("sends an AbortSignal timeout on every Hermes call", async () => {
    await post("hi");
    const opts = (globalThis.fetch as any).mock.calls[0][1];
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it("persists user + assistant rows with ordered createdAt (user first)", async () => {
    await post("hello");
    expect(mocks.insertChatMessage).toHaveBeenCalledTimes(2);
    const [userRow, assistantRow] = mocks.insertChatMessage.mock.calls.map((c: any[]) => c[0]);
    expect(userRow.role).toBe("user");
    expect(assistantRow.role).toBe("assistant");
    expect(new Date(assistantRow.createdAt).getTime()).toBeGreaterThanOrEqual(new Date(userRow.createdAt).getTime());
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd Home-ai && npx vitest run tests/unit/hermes-config-cache.test.ts`
Expected: FAIL — `resetHermesChatForTests` is not exported (import error).

- [ ] **Step 3: Implement in `src/app/api/hermes/chat/route.ts`**

Replace `resolveHermes` (lines 28-37) with:

```ts
// Registry override → env → code fallback. The resolved endpoint is cached
// in-process for 10 minutes — it changes rarely, and two PB reads per chat
// message were pure latency. Settings → Services "Test" reads fresh config
// independently, so a key edit is verified immediately even while cached.
const HERMES_CONFIG_TTL_MS = 10 * 60 * 1000;
const HERMES_TIMEOUT_MS = 60_000;

let hermesConfigCache: { value: { url: string; key: string | null }; expiresAt: number } | null = null;

/** Test-only: clears the module-scope caches between vitest cases. */
export function resetHermesChatForTests() {
  hermesConfigCache = null;
}

async function resolveHermes(): Promise<{ url: string; key: string | null }> {
  if (hermesConfigCache && hermesConfigCache.expiresAt > Date.now()) return hermesConfigCache.value;
  const [storedUrl, storedKey] = await Promise.all([
    getServiceConfig("hermes", "HERMES_API_URL"),
    getServiceConfig("hermes", "HERMES_API_KEY"),
  ]);
  const value = {
    url: storedUrl || process.env.HERMES_API_URL || "http://hermes-agent-2:8643",
    key: storedKey ?? process.env.HERMES_API_KEY ?? null,
  };
  hermesConfigCache = { value, expiresAt: Date.now() + HERMES_CONFIG_TTL_MS };
  return value;
}
```

In `callHermes` (line 108), add the signal to the fetch:

```ts
  const res = await fetch(`${hermes.url}/v1/chat/completions`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(HERMES_TIMEOUT_MS),
    body: JSON.stringify({
```

Replace `persistChatPair`'s two sequential inserts (lines 20-22) with parallel inserts carrying explicit ordered timestamps:

```ts
    const userId = request.cookies.get("x-consuela-user")?.value || "guest";
    const threadId = todayISO();
    // Explicit createdAt keeps the user row strictly before the assistant row
    // in the createdAt-ascending thread sort even when both land in the same ms.
    const userAt = new Date();
    const assistantAt = new Date(userAt.getTime() + 1);
    await Promise.all([
      db.insertChatMessage({ userId, role: "user", content: userMessage, source: "dashboard", threadId, createdAt: userAt.toISOString() }),
      db.insertChatMessage({ userId: "consuela", role: "assistant", content: reply, source: "dashboard", threadId, createdAt: assistantAt.toISOString() }),
    ]);
```

Update the Clem key resolution (Task 1's block) to reuse the cache instead of a fresh `getServiceConfig` call:

```ts
    const clemHermes = isClem
      ? { url: "http://hermes-agent-2:8643", key: (await resolveHermes()).key }
      : null;
```

- [ ] **Step 4: Add the reset to the two existing route test files**

In `tests/unit/hermes-chat-clem.test.ts` and `tests/unit/hermes-chat-role.test.ts`: change the route import to `import { POST, resetHermesChatForTests } from "@/app/api/hermes/chat/route";` and add `resetHermesChatForTests();` as the first line of each `beforeEach`.

- [ ] **Step 5: Run all three route test files + typecheck**

Run: `cd Home-ai && npx vitest run tests/unit/hermes-config-cache.test.ts tests/unit/hermes-chat-clem.test.ts tests/unit/hermes-chat-role.test.ts && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/hermes/chat/route.ts tests/unit/hermes-config-cache.test.ts tests/unit/hermes-chat-clem.test.ts tests/unit/hermes-chat-role.test.ts
git commit -m "perf(chat): cache Hermes config (10min TTL), 60s call timeout, parallel ordered persist"
```

---

### Task 3: Composer sends directly — kill the dead pre-flight

`/api/chat/process` queries two phantom PB collections, always falls back to `[]`, and skips its only job — a full wasted round trip before every message. Clem already proves the direct pattern works.

**Files:**
- Modify: `src/components/chat/UnifiedInput.tsx` (full rewrite below)
- Modify: `src/app/chat/page.tsx:697` (pass `disabled={isTyping}`)
- Create: `tests/unit/unified-input.test.tsx`

**Interfaces:**
- Produces: `UnifiedInput` with props `{ onSendMessage: (message: string) => void; disabled?: boolean }` (unchanged signature); no network calls of its own.
- Note: `ClarificationModal` import is removed here; the file itself is deleted in Task 9.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/unified-input.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { UnifiedInput } from "@/components/chat/UnifiedInput";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/voice-input/VoiceInputButton", () => ({ VoiceInputButton: () => null }));
vi.mock("@/components/photo-input/PhotoInputButton", () => ({ PhotoInputButton: () => null }));

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

function typeInto(el: HTMLElement, text: string) {
  const textarea = el.querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clickSend(el: HTMLElement) {
  const btn = Array.from(el.querySelectorAll("button")).find((b) => b.title === "Send message")!;
  act(() => { btn.click(); });
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("UnifiedInput — direct send", () => {
  it("calls onSendMessage with no pre-flight network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onSend = vi.fn();
    const el = render(<UnifiedInput onSendMessage={onSend} />);
    typeInto(el, "what is for dinner?");
    clickSend(el);
    expect(onSend).toHaveBeenCalledWith("what is for dinner?");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears the textarea after sending", () => {
    vi.stubGlobal("fetch", vi.fn());
    const el = render(<UnifiedInput onSendMessage={vi.fn()} />);
    typeInto(el, "milk");
    clickSend(el);
    expect((el.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
  });

  it("does not send empty or whitespace input", () => {
    vi.stubGlobal("fetch", vi.fn());
    const onSend = vi.fn();
    const el = render(<UnifiedInput onSendMessage={onSend} />);
    typeInto(el, "   ");
    clickSend(el);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("is disabled while the assistant is typing", () => {
    vi.stubGlobal("fetch", vi.fn());
    const el = render(<UnifiedInput onSendMessage={vi.fn()} disabled />);
    expect((el.querySelector("textarea") as HTMLTextAreaElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd Home-ai && npx vitest run tests/unit/unified-input.test.tsx`
Expected: FAIL — first test: `fetchMock` was called (the `/api/chat/process` pre-flight).

- [ ] **Step 3: Rewrite `src/components/chat/UnifiedInput.tsx`**

```tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import { VoiceInputButton } from '@/components/voice-input/VoiceInputButton';
import { PhotoInputButton } from '@/components/photo-input/PhotoInputButton';

interface UnifiedInputProps {
  onSendMessage: (message: string) => void;
  disabled?: boolean;
}

export function UnifiedInput({ onSendMessage, disabled }: UnifiedInputProps) {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [message]);

  const handleSubmit = () => {
    if (!message.trim() || disabled) return;
    onSendMessage(message);
    setMessage('');
  };

  const handleVoiceTranscript = (transcript: string) => {
    setMessage(transcript);
  };

  const handlePhotoExtracted = (text: string) => {
    setMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-end gap-3">
          {/* Voice Input */}
          <VoiceInputButton
            onTranscript={handleVoiceTranscript}
            disabled={disabled}
          />

          {/* Photo Input */}
          <PhotoInputButton
            onExtracted={handlePhotoExtracted}
            disabled={disabled}
          />

          {/* Text Input */}
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message, or use voice/photo..."
              disabled={disabled}
              rows={1}
              className="w-full px-4 py-3 pr-12 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ minHeight: '48px', maxHeight: '200px' }}
            />

            {/* Send Button */}
            <button
              onClick={handleSubmit}
              disabled={!message.trim() || disabled}
              className="absolute right-2 bottom-2 h-9 w-9 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Send message"
            >
              <Send className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Help Text */}
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 text-center">
          💡 Tip: Say "Add dentist appointment tomorrow at 3pm" or snap a photo of a flyer
        </div>
      </div>
    </div>
  );
}
```

(Changes vs old file: no `Loader2`/`ClarificationModal` imports, no `clarification`/`isProcessing` state, no `buildClarifiedMessage`, no modal render, `disabled` prop drives all controls.)

- [ ] **Step 4: Pass the typing guard from the page**

In `src/app/chat/page.tsx` line 697:

```tsx
        <UnifiedInput onSendMessage={sendMessage} disabled={isTyping} />
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd Home-ai && npx vitest run tests/unit/unified-input.test.tsx && npm run typecheck`
Expected: PASS (4/4), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/UnifiedInput.tsx src/app/chat/page.tsx tests/unit/unified-input.test.tsx
git commit -m "perf(chat): composer sends straight to /api/hermes/chat — drop dead /api/chat/process pre-flight"
```

---

### Task 4: Shrink the artificial thinking delay 2000ms → 400ms

**Files:**
- Modify: `src/app/chat/page.tsx:325-331`

**Interfaces:**
- Produces: `MIN_THINKING_DELAY = 400` (ms) — the floor for the buffered reply path. Task 7 makes the streamed path bypass it entirely.

- [ ] **Step 1: Edit the constant + comment**

In `src/app/chat/page.tsx`, replace lines 325-331:

```ts
      // Short beat so the orb animation doesn't flash on instant replies.
      // Streamed answers (Task 7) bypass this entirely — tokens render live.
      const MIN_THINKING_DELAY = 400;
      const elapsed = Date.now() - t0;
      if (elapsed < MIN_THINKING_DELAY) {
        await new Promise(r => setTimeout(r, MIN_THINKING_DELAY - elapsed));
      }
```

- [ ] **Step 2: Run the existing suite to confirm nothing depends on 2000**

Run: `cd Home-ai && npx vitest run`
Expected: full suite green (Task 1 fixed the known failure).

- [ ] **Step 3: Commit**

```bash
git add src/app/chat/page.tsx
git commit -m "perf(chat): thinking-delay floor 2000ms -> 400ms"
```

---

## Landing 2 — Streaming

### Task 5: `src/lib/chat-stream.ts` — SSE client helper

**Files:**
- Create: `src/lib/chat-stream.ts`
- Create: `tests/unit/chat-stream.test.ts`

**Interfaces (the SSE protocol shared with Task 6):**
- Content token: `data: {"t":"<delta>"}\n\n`
- Tool status: `event: status\ndata: {"label":"<friendly text>"}\n\n`
- Error: `event: error\ndata: {"message":"<text>"}\n\n`
- Terminator: `data: [DONE]\n\n`
- Produces:
  - `parseSSEFrames(buffer: string): { frames: Array<{ event: string; data: string }>; rest: string }`
  - `streamConsuelaChat(opts: { message: string; history?: Array<{ role: string; content: string }>; agent?: string; system?: string; onToken?: (full: string, delta: string) => void; onStatus?: (label: string) => void }): Promise<{ content: string; streamed: boolean }>` — throws `Error` on non-ok response or an `error` frame. `streamed: false` means the route answered buffered (fallback path).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/chat-stream.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { parseSSEFrames, streamConsuelaChat } from "@/lib/chat-stream";

function sseResponse(text: string) {
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("parseSSEFrames", () => {
  it("parses complete frames and keeps the partial tail", () => {
    const { frames, rest } = parseSSEFrames('data: {"t":"hi"}\n\nevent: status\ndata: {"label":"Working"}\n\ndata: {"t');
    expect(frames).toEqual([
      { event: "message", data: '{"t":"hi"}' },
      { event: "status", data: '{"label":"Working"}' },
    ]);
    expect(rest).toBe('data: {"t');
  });

  it("joins multi-line data with newlines", () => {
    const { frames } = parseSSEFrames('data: line1\ndata: line2\n\n');
    expect(frames[0].data).toBe("line1\nline2");
  });

  it("returns no frames for an empty buffer", () => {
    expect(parseSSEFrames("")).toEqual({ frames: [], rest: "" });
  });
});

describe("streamConsuelaChat", () => {
  it("forwards token deltas in order and resolves with the full content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      sseResponse('data: {"t":"Hel"}\n\ndata: {"t":"lo"}\n\ndata: [DONE]\n\n')));
    const seen: string[] = [];
    const res = await streamConsuelaChat({ message: "hi", onToken: (full) => seen.push(full) });
    expect(res).toEqual({ content: "Hello", streamed: true });
    expect(seen).toEqual(["Hel", "Hello"]);
  });

  it("delivers status labels via onStatus", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      sseResponse('event: status\ndata: {"label":"Checking the pantry…"}\n\ndata: {"t":"ok"}\n\ndata: [DONE]\n\n')));
    const labels: string[] = [];
    await streamConsuelaChat({ message: "hi", onStatus: (l) => labels.push(l) });
    expect(labels).toEqual(["Checking the pantry…"]);
  });

  it("handles a frame split across network chunks", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        c.enqueue(enc.encode('data: {"t'));
        c.enqueue(enc.encode('":"split"}\n\ndata: [DONE]\n\n'));
        c.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } })));
    const res = await streamConsuelaChat({ message: "hi" });
    expect(res.content).toBe("split");
  });

  it("throws on an error frame", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      sseResponse('event: error\ndata: {"message":"boom"}\n\n')));
    await expect(streamConsuelaChat({ message: "hi" })).rejects.toThrow("boom");
  });

  it("falls back to buffered JSON when the route answers non-SSE", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ content: "buffered" }), { status: 200, headers: { "content-type": "application/json" } })));
    const seen: string[] = [];
    const res = await streamConsuelaChat({ message: "hi", onToken: (full) => seen.push(full) });
    expect(res).toEqual({ content: "buffered", streamed: false });
    expect(seen).toEqual(["buffered"]);
  });

  it("sends stream:true and the message payload", async () => {
    const fetchMock = vi.fn(async () => sseResponse("data: [DONE]\n\n"));
    vi.stubGlobal("fetch", fetchMock);
    await streamConsuelaChat({ message: "hi", agent: "clem", history: [{ role: "user", content: "prior" }] });
    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(body.stream).toBe(true);
    expect(body.agent).toBe("clem");
    expect(body.history).toEqual([{ role: "user", content: "prior" }]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd Home-ai && npx vitest run tests/unit/chat-stream.test.ts`
Expected: FAIL — cannot resolve `@/lib/chat-stream`.

- [ ] **Step 3: Implement `src/lib/chat-stream.ts`**

```ts
/**
 * Shared client for the streaming Ask Consuela endpoint.
 *
 * SSE protocol (produced by /api/hermes/chat when body.stream === true):
 *   data: {"t":"<delta>"}                          — content token
 *   event: status\ndata: {"label":"<text>"}        — tool activity line
 *   event: error\ndata: {"message":"<text>"}       — terminal failure
 *   data: [DONE]                                   — terminator
 */

export interface StreamConsuelaChatOptions {
  message: string;
  history?: Array<{ role: string; content: string }>;
  agent?: string;
  system?: string;
  /** Called per token with the full content so far and the new delta. */
  onToken?: (fullContent: string, delta: string) => void;
  /** Called per tool-status event with a friendly label. */
  onStatus?: (label: string) => void;
}

export interface StreamConsuelaChatResult {
  content: string;
  /** false = the route answered buffered (Hermes streaming unavailable). */
  streamed: boolean;
}

export interface SSEFrame {
  event: string;
  data: string;
}

export function parseSSEFrames(buffer: string): { frames: SSEFrame[]; rest: string } {
  const frames: SSEFrame[] = [];
  let rest = buffer;
  let idx: number;
  while ((idx = rest.indexOf("\n\n")) !== -1) {
    const raw = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    let event = "message";
    const dataLines: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (dataLines.length > 0) frames.push({ event, data: dataLines.join("\n") });
  }
  return { frames, rest };
}

export async function streamConsuelaChat(opts: StreamConsuelaChatOptions): Promise<StreamConsuelaChatResult> {
  const res = await fetch("/api/hermes/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: opts.message,
      history: opts.history,
      agent: opts.agent,
      system: opts.system,
      stream: true,
    }),
  });
  if (!res.ok) throw new Error(`Chat request failed (${res.status})`);

  const ctype = res.headers.get("content-type") || "";
  if (!ctype.includes("text/event-stream") || !res.body) {
    const data = await res.json();
    const content = String(data.content || data.reply || "");
    if (content) opts.onToken?.(content, content);
    return { content, streamed: false };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let errorMsg: string | null = null;

  outer: for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { frames, rest } = parseSSEFrames(buffer);
    buffer = rest;
    for (const frame of frames) {
      if (frame.event === "status") {
        try {
          const p = JSON.parse(frame.data);
          if (p.label) opts.onStatus?.(String(p.label));
        } catch { /* malformed status frame — ignore */ }
      } else if (frame.event === "error") {
        try {
          const p = JSON.parse(frame.data);
          errorMsg = String(p.message || "Chat failed");
        } catch {
          errorMsg = "Chat failed";
        }
        break outer;
      } else if (frame.data === "[DONE]") {
        break outer;
      } else {
        try {
          const p = JSON.parse(frame.data);
          if (typeof p.t === "string" && p.t.length > 0) {
            content += p.t;
            opts.onToken?.(content, p.t);
          }
        } catch { /* non-JSON data frame — ignore */ }
      }
    }
  }

  if (errorMsg) throw new Error(errorMsg);
  return { content, streamed: true };
}
```

- [ ] **Step 4: Run to verify green**

Run: `cd Home-ai && npx vitest run tests/unit/chat-stream.test.ts`
Expected: PASS (9/9)

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-stream.ts tests/unit/chat-stream.test.ts
git commit -m "feat(chat): shared SSE client helper for streaming Consuela replies"
```

---

### Task 6: Streaming mode on `/api/hermes/chat`

**Files:**
- Modify: `src/app/api/hermes/chat/route.ts`
- Create: `tests/unit/hermes-chat-stream.test.ts`

**Interfaces:**
- Consumes: the SSE protocol from Task 5 (identical frame shapes); `resetHermesChatForTests()` from Task 2 (extended to also clear the streaming-support flag).
- Produces: `POST /api/hermes/chat` with `body.stream === true` returns `Content-Type: text/event-stream` and emits Task-5-shaped frames. With `stream` absent/false the route is byte-identical to today. Tool calls within a round now execute via `Promise.all` in BOTH modes.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/hermes-chat-stream.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  buildToolsForOpenAI: vi.fn(() => []),
  getTool: vi.fn(() => undefined),
  insertChatMessage: vi.fn(async () => ({})),
  getServiceConfig: vi.fn(async (..._args: unknown[]) => null as string | null),
}));

vi.mock("@/lib/hermes-tools", () => ({
  buildToolsForOpenAI: mocks.buildToolsForOpenAI,
  getTool: mocks.getTool,
}));
vi.mock("@/lib/services/config", () => ({ getServiceConfig: mocks.getServiceConfig }));
vi.mock("@/db", () => ({ db: { insertChatMessage: mocks.insertChatMessage } }));

import { POST, resetHermesChatForTests } from "@/app/api/hermes/chat/route";

function sseResponse(chunks: string[]) {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const token = (t: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;
const DONE = "data: [DONE]\n\n";
const toolCallRound = (id: string, name: string, args: string, index = 0) => [
  `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index, id, function: { name, arguments: "" } }] } }] })}\n\n`,
  `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index, function: { arguments: args } }] } }] })}\n\n`,
  `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
  DONE,
].join("");

async function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/hermes/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  vi.stubEnv("HERMES_API_URL", "");
  vi.stubEnv("HERMES_API_KEY", "");
  resetHermesChatForTests();
  mocks.getServiceConfig.mockReset().mockResolvedValue(null);
  mocks.insertChatMessage.mockClear();
  mocks.getTool.mockReset().mockReturnValue(undefined);
  mocks.buildToolsForOpenAI.mockReset().mockReturnValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("hermes chat — streaming mode", () => {
  it("streams content tokens as SSE frames and persists the pair", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([token("Hel"), token("lo"), DONE])));
    const res = await post({ message: "hi", stream: true });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await res.text();
    expect(body).toContain('data: {"t":"Hel"}');
    expect(body).toContain('data: {"t":"lo"}');
    expect(body).toContain("data: [DONE]");
    expect(mocks.insertChatMessage).toHaveBeenCalledTimes(2);
  });

  it("runs a tool round: status event, handler, then streams the final answer", async () => {
    const handler = vi.fn(async () => '{"ok":true}');
    mocks.getTool.mockReturnValue({ handler });
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => sseResponse([toolCallRound("c1", "get_pantry", "{}")]))
      .mockImplementationOnce(async () => sseResponse([token("Pantry looks stocked."), DONE])));
    const res = await post({ message: "whats low?", stream: true });
    const body = await res.text();
    expect(body).toContain("event: status");
    expect(body).toContain('data: {"t":"Pantry looks stocked."}');
    expect(handler).toHaveBeenCalled();
    // second Hermes call carries the tool result message
    const second = JSON.parse((globalThis.fetch as any).mock.calls[1][1].body);
    expect(second.messages.some((m: any) => m.role === "tool")).toBe(true);
  });

  it("executes multiple tool calls of one round in parallel", async () => {
    let bStarted = false;
    const handlerA = vi.fn(async () => {
      const deadline = Date.now() + 500;
      while (!bStarted && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
      return '{"ok":"a"}';
    });
    const handlerB = vi.fn(async () => { bStarted = true; return '{"ok":"b"}'; });
    mocks.getTool.mockImplementation((name: string) =>
      name === "get_pantry" ? { handler: handlerA } : name === "get_grocery_list" ? { handler: handlerB } : undefined);
    const round =
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [
        { index: 0, id: "c1", function: { name: "get_pantry", arguments: "{}" } },
        { index: 1, id: "c2", function: { name: "get_grocery_list", arguments: "{}" } },
      ] } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n` + DONE;
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => sseResponse([round]))
      .mockImplementationOnce(async () => sseResponse([token("done"), DONE])));
    const res = await post({ message: "check both", stream: true });
    await res.text();
    expect(handlerA).toHaveBeenCalled();
    expect(handlerB).toHaveBeenCalled();
  });

  it("falls back to buffered when Hermes ignores stream:true, and stops asking next time", async () => {
    const buffered = () => new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content: "buffered answer" } }] }),
      { status: 200, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", vi.fn(async () => buffered()));
    const res1 = await post({ message: "one", stream: true });
    const body1 = await res1.text();
    expect(body1).toContain('data: {"t":"buffered answer"}');
    expect(body1).toContain("data: [DONE]");
    // first Hermes request asked for a stream...
    expect(JSON.parse((globalThis.fetch as any).mock.calls[0][1].body).stream).toBe(true);
    // ...the second one does not (flag flipped after the non-SSE reply)
    await post({ message: "two", stream: true });
    expect(JSON.parse((globalThis.fetch as any).mock.calls[1][1].body).stream).toBeUndefined();
  });

  it("emits an error frame when Hermes fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new Error("aborted"), { name: "TimeoutError" }); }));
    const res = await post({ message: "hi", stream: true });
    const body = await res.text();
    expect(body).toContain("event: error");
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
  });

  it("clem streams without persisting", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([token("milk"), DONE])));
    const res = await post({ message: "hi", agent: "clem", stream: true });
    await res.text();
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
  });

  it("buffered mode (no stream flag) is unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content: "plain" } }] }),
      { status: 200, headers: { "content-type": "application/json" } })));
    const res = await post({ message: "hi" });
    expect(res.headers.get("content-type")).toContain("application/json");
    expect((await res.json()).content).toBe("plain");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd Home-ai && npx vitest run tests/unit/hermes-chat-stream.test.ts`
Expected: FAIL — `stream: true` currently returns buffered JSON (content-type application/json).

- [ ] **Step 3: Implement streaming in `src/app/api/hermes/chat/route.ts`**

Add module state + extend the test reset (after `hermesConfigCache`):

```ts
let hermesStreamingSupported = true;

/** Test-only: clears the module-scope caches between vitest cases. */
export function resetHermesChatForTests() {
  hermesConfigCache = null;
  hermesStreamingSupported = true;
}
```

Add the SSE helpers + streaming Hermes caller (after `callHermes`):

```ts
function sseFrame(payload: string, event?: string): string {
  return (event ? `event: ${event}\n` : "") + `data: ${payload}\n\n`;
}

const TOOL_STATUS_LABELS: Record<string, string> = {
  get_weather: "Checking the weather…",
  get_todays_events: "Checking today's events…",
  get_todays_schedule: "Checking today's routines…",
  get_pending_tasks: "Checking the task list…",
  add_task: "Adding that task…",
  complete_task: "Marking that task done…",
  get_weekly_meals: "Checking the meal plan…",
  get_recipes: "Looking through the recipe box…",
  get_grocery_list: "Checking the grocery list…",
  add_grocery_item: "Adding to the grocery list…",
  complete_grocery_item: "Updating the grocery list…",
  get_pantry: "Checking the pantry…",
  add_event: "Adding that to the calendar…",
  remove_event: "Removing that from the calendar…",
  get_dashboard_summary: "Pulling today's summary…",
  get_proactive_suggestions: "Reviewing my suggestions…",
  action_suggestion: "Taking care of that suggestion…",
  dismiss_suggestion: "Tidying up suggestions…",
  compare_grocery_prices: "Comparing store prices…",
  ha_list_devices: "Looking up house devices…",
  ha_control_device: "Adjusting that device…",
  check_for_update: "Checking for dashboard updates…",
  trigger_update: "Updating the dashboard…",
  get_container_status: "Checking the containers…",
  restart_container: "Restarting that container…",
  check_pocketbase: "Checking the database…",
};
function toolStatusLabel(name?: string): string {
  return (name && TOOL_STATUS_LABELS[name]) || "Working on it…";
}

/**
 * One streaming Hermes round. Content deltas are forwarded to `write` live;
 * tool-call deltas are accumulated and returned for the loop to execute.
 * Falls back to a buffered read when Hermes doesn't honor stream:true
 * (and remembers, so later rounds skip the attempt until process restart).
 */
async function callHermesStream(
  messages: ChatMessage[],
  opts: { tools?: ReturnType<typeof buildToolsForOpenAI>; hermes: { url: string; key: string | null } },
  write: (frame: string) => void,
): Promise<{ content: string; tool_calls?: ToolCall[] }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.hermes.key) headers.Authorization = `Bearer ${opts.hermes.key}`;
  const wantStream = hermesStreamingSupported;
  const res = await fetch(`${opts.hermes.url}/v1/chat/completions`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(HERMES_TIMEOUT_MS),
    body: JSON.stringify({
      model: HERMES_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 1024,
      tools: opts.tools,
      tool_choice: "auto",
      ...(wantStream ? { stream: true } : {}),
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Hermes ${res.status}: ${err || res.statusText}`);
  }

  const ctype = res.headers.get("content-type") || "";
  if (!wantStream || !ctype.includes("text/event-stream") || !res.body) {
    if (wantStream && !ctype.includes("text/event-stream")) hermesStreamingSupported = false;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    // Buffered answer — surface it downstream as one token frame so the
    // client's SSE contract holds either way.
    if (content) write(sseFrame(JSON.stringify({ t: content })));
    return {
      content,
      tool_calls: data.choices?.[0]?.message?.tool_calls,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const toolCalls: ToolCall[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const rawFrame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLines = rawFrame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""));
      if (dataLines.length === 0) continue;
      const payload = dataLines.join("\n");
      if (payload === "[DONE]") continue;
      let parsed: any;
      try { parsed = JSON.parse(payload); } catch { continue; }
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === "string" && delta.content.length > 0) {
        content += delta.content;
        write(sseFrame(JSON.stringify({ t: delta.content })));
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const i = tc.index ?? 0;
          if (!toolCalls[i]) toolCalls[i] = { id: tc.id, function: { name: "", arguments: "" } };
          if (tc.id) toolCalls[i].id = tc.id;
          if (tc.function?.name) toolCalls[i].function!.name += tc.function.name;
          if (tc.function?.arguments) toolCalls[i].function!.arguments += tc.function.arguments;
        }
      }
    }
  }
  return { content, tool_calls: toolCalls.length > 0 ? toolCalls : undefined };
}
```

Add the streamed handler (after `callHermesStream`). It reuses the exact same preamble as the buffered POST (session/role/tools/history/messages) — extract that preamble into a helper so both paths share it:

```ts
interface ChatRequestBody {
  message?: string; history?: any[]; role?: string; system?: string; agent?: string; stream?: boolean;
}

async function buildChatContext(request: NextRequest, body: ChatRequestBody) {
  const { history = [], system, agent } = body;
  const message = body.message ?? "";
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const role = session?.role ?? "child";
  const houseControl = role !== "child";
  const isClem = agent === "clem";
  const hermes = isClem
    ? { url: "http://hermes-agent-2:8643", key: (await resolveHermes()).key }
    : await resolveHermes();
  const tools = isClem
    ? buildToolsForOpenAI({ houseControl: false }).filter((t) => CLEM_TOOLS.includes(t.function.name))
    : buildToolsForOpenAI({ houseControl });
  const recentHistory = (history || [])
    .slice(-6)
    .filter((h: any) => h && typeof h.content === "string" && h.content.trim())
    .map((h: any) => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.content }));
  const baseSystem = isClem ? CLEM_SYSTEM_PROMPT : SYSTEM_PROMPT + (houseControl ? HOUSE_CONTROL_PROMPT_ADDENDUM : "");
  let addendum: string | null = null;
  if (typeof system === "string") {
    const trimmed = system.trim();
    if (trimmed) addendum = trimmed.slice(0, 2000);
  }
  const messages: ChatMessage[] = [
    { role: "system", content: baseSystem },
    ...(addendum ? [{ role: "system" as const, content: addendum }] : []),
    ...recentHistory,
    { role: "user", content: message },
  ];
  return { message, isClem, hermes, tools, messages, role };
}

async function handleStreamedChat(request: NextRequest, body: ChatRequestBody): Promise<Response> {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const write = (frame: string) => { writer.write(enc.encode(frame)).catch(() => { /* client gone */ }); };

  (async () => {
    try {
      const { message, isClem, hermes, tools, messages } = await buildChatContext(request, body);
      let finalContent = "";
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const { content, tool_calls } = await callHermesStream(messages, { tools, hermes }, write);
        if (!tool_calls || tool_calls.length === 0) {
          finalContent = content;
          break;
        }
        messages.push({ role: "assistant", content, tool_calls });
        for (const tc of tool_calls) {
          write(sseFrame(JSON.stringify({ label: toolStatusLabel(tc.function?.name) }), "status"));
        }
        const results = await Promise.all(tool_calls.map(async (tc) => {
          const name = tc.function?.name;
          const tool = name ? getTool(name) : undefined;
          if (!name || !tool) {
            const available = tools.map((t) => t.function.name).join(", ");
            return JSON.stringify({ error: `Unknown tool: ${name ?? "<missing name>"}. Available: ${available}` });
          }
          try {
            return await tool.handler(parseToolArgs(tc.function?.arguments));
          } catch (e: any) {
            return JSON.stringify({ error: e?.message || "Tool failed" });
          }
        }));
        results.forEach((result, i) =>
          messages.push({ role: "tool", tool_call_id: tool_calls[i].id || "", content: result }));
      }
      if (!finalContent) {
        finalContent = "I kept needing to look things up and ran out of steps — give me a moment and try again! 🔧";
      }
      if (!isClem) await persistChatPair(request, message!, finalContent);
      write(sseFrame("[DONE]"));
    } catch (error: any) {
      console.error("Consuela stream error:", error?.message || error);
      write(sseFrame(JSON.stringify({ message: "Hey, I hit a snag connecting to my brain right now. Give me a moment and try again! 🔧" }), "error"));
    } finally {
      writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

Wire it into `POST` — after the JSON body parse and the message-required guard (line ~144), before the existing try block:

```ts
  if (body.stream === true) {
    return handleStreamedChat(request, body);
  }
```

Also refactor the buffered `POST` to use `buildChatContext` (replace lines 152-184's inline preamble with `const { message, isClem, hermesForLog: hermes, tools, messages } = await buildChatContext(request, body);` — keep the `console.log` line, adapt variable names) and change its tool loop to `Promise.all` for the tool calls (same shape as the streaming loop above). The buffered response shape stays `{ content }`.

- [ ] **Step 4: Run the new + existing route tests**

Run: `cd Home-ai && npx vitest run tests/unit/hermes-chat-stream.test.ts tests/unit/hermes-chat-clem.test.ts tests/unit/hermes-chat-role.test.ts tests/unit/hermes-config-cache.test.ts`
Expected: all PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `cd Home-ai && npx vitest run && npm run typecheck`
Expected: green, clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/hermes/chat/route.ts tests/unit/hermes-chat-stream.test.ts
git commit -m "feat(chat): opt-in SSE streaming on /api/hermes/chat with buffered fallback + parallel tools"
```

---

### Task 7: Chat page renders streamed tokens

**Files:**
- Modify: `src/app/chat/page.tsx` (`sendMessage`, new `statusLine` state, typing indicator block)
- Create: `tests/unit/chat-page-stream.test.tsx`

**Interfaces:**
- Consumes: `streamConsuelaChat` from `@/lib/chat-stream` (Task 5).
- Produces: streamed assistant bubble appended per token; `statusLine` shown under the typing dots; buffered fallback keeps the 400ms floor.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/chat-page-stream.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const streamMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/chat-stream", () => ({ streamConsuelaChat: (opts: any) => streamMock.fn(opts) }));

let capturedSend: ((text: string) => void) | null = null;
vi.mock("@/components/chat/UnifiedInput", () => ({
  UnifiedInput: ({ onSendMessage }: { onSendMessage: (t: string) => void }) => {
    capturedSend = onSendMessage;
    return null;
  },
}));
vi.mock("@/components/ui/CapsuleNav", () => ({ default: () => null }));
vi.mock("@/components/ui/Avatar", () => ({ default: () => null }));
vi.mock("@/components/ui/SigmaImage", () => ({ default: () => null }));
vi.mock("@/components/3d", () => ({ Icon3D: () => null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ currentUser: null, isLoggedIn: false }) }));
vi.mock("@/hooks/usePendingChatQuery", () => ({ usePendingChatQuery: () => {} }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/db", () => ({ db: { selectMembers: () => [] } }));

import ChatPage from "@/app/chat/page";

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

beforeEach(() => {
  capturedSend = null;
  streamMock.fn.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, messages: [] }), {
    status: 200, headers: { "content-type": "application/json" },
  })));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("chat page streaming", () => {
  it("appends tokens progressively into one assistant bubble", async () => {
    streamMock.fn.mockImplementation(async ({ onToken }: any) => {
      onToken("Hel", "Hel");
      await new Promise((r) => setTimeout(r, 0));
      onToken("Hello", "lo");
      await new Promise((r) => setTimeout(r, 0));
      return { content: "Hello", streamed: true };
    });
    const el = render(<ChatPage />);
    await act(async () => { capturedSend!("hi"); });
    const bubbles = Array.from(el.querySelectorAll("[role='log'] *")).length; // render happened
    expect(el.textContent).toContain("Hello");
    // exactly one assistant bubble with the final content
    expect((el.textContent?.match(/Hello/g) || []).length).toBe(1);
    void bubbles;
  });

  it("shows the tool status line while waiting for the first token", async () => {
    let resolveStream: ((r: { content: string; streamed: boolean }) => void) | null = null;
    streamMock.fn.mockImplementation(({ onStatus }: any) => {
      onStatus("Checking the pantry…");
      return new Promise((res) => { resolveStream = res; });
    });
    const el = render(<ChatPage />);
    // Fire the send without awaiting the (still-pending) stream.
    act(() => { void capturedSend!("any low?"); });
    expect(el.textContent).toContain("Checking the pantry…");
    await act(async () => { resolveStream!({ content: "all stocked", streamed: true }); });
    expect(el.textContent).toContain("all stocked");
    // Status line clears once the reply lands.
    expect(el.textContent).not.toContain("Checking the pantry…");
  });

  it("shows the error bubble + Try again when the stream throws", async () => {
    streamMock.fn.mockRejectedValue(new Error("boom"));
    const el = render(<ChatPage />);
    await act(async () => { capturedSend!("hi"); });
    expect(el.textContent).toContain("Sorry, I'm having trouble right now.");
    expect(el.textContent).toContain("Try again");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd Home-ai && npx vitest run tests/unit/chat-page-stream.test.tsx`
Expected: FAIL — page still uses plain `fetch('/api/hermes/chat')` (no `@/lib/chat-stream` import).

- [ ] **Step 3: Implement in `src/app/chat/page.tsx`**

Add import: `import { streamConsuelaChat } from "@/lib/chat-stream";`

Add state next to `isTyping` (line ~208): `const [statusLine, setStatusLine] = useState<string | null>(null);`

Replace the body of `sendMessage` (lines 287-360) with:

```ts
  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isTyping) return;

    msgCounter.current += 1;
    const userMsg: Message = {
      id: msgCounter.current,
      role: "user",
      content: trimmed,
      timestamp: "Just now",
      speaker: activeSpeaker.name,
      speakerEmoji: activeSpeaker.emoji,
    };

    setMessages(prev => [...prev, userMsg]);
    setPinnedToBottom(true);
    setInput("");
    setIsTyping(true);
    setStatusLine(null);

    msgCounter.current += 1;
    const streamId = msgCounter.current;
    let bubbleOpen = false;

    try {
      const t0 = Date.now();
      const { content, streamed } = await streamConsuelaChat({
        message: trimmed,
        history: messagesRef.current.slice(-12).map(m => ({
          role: m.role,
          content: m.role === "assistant"
            ? m.content.replace(/\n\n✅[\s\S]*$/, "").trim()
            : m.content,
        })),
        onStatus: (label) => setStatusLine(label),
        onToken: (full) => {
          if (!bubbleOpen) { bubbleOpen = true; setIsTyping(false); }
          setMessages(prev => prev.some(m => m.id === streamId)
            ? prev.map(m => (m.id === streamId ? { ...m, content: full } : m))
            : [...prev, { id: streamId, role: "assistant" as const, content: full, timestamp: "Just now" }]);
        },
      });

      // Buffered fallback keeps a short beat so the orb doesn't flash;
      // streamed replies already rendered live.
      if (!streamed) {
        const elapsed = Date.now() - t0;
        if (elapsed < MIN_THINKING_DELAY) {
          await new Promise(r => setTimeout(r, MIN_THINKING_DELAY - elapsed));
        }
      }
      setIsTyping(false);
      setStatusLine(null);

      const finalContent = content || "I processed that.";
      setMessages(prev => prev.some(m => m.id === streamId)
        ? prev.map(m => (m.id === streamId ? { ...m, content: finalContent } : m))
        : [...prev, { id: streamId, role: "assistant" as const, content: finalContent, timestamp: "Just now" }]);

      // Reconcile against PB (picks up anything that arrived on other devices).
      const pbMsgs = await fetchPBThread();
      if (pbMsgs.length > 0) setMessages(prev => mergePBThread(prev, pbMsgs));
    } catch (error) {
      setIsTyping(false);
      setStatusLine(null);
      msgCounter.current += 1;
      setMessages(prev => [...prev, {
        id: msgCounter.current,
        role: "assistant",
        content: "Sorry, I'm having trouble right now.",
        timestamp: "Just now",
        errorFor: trimmed,
      }]);
    }
  };
```

Keep `const MIN_THINKING_DELAY = 400;` — move it to module scope above `ChatContent` (next to `todayISO`) since it's no longer inside the try block.

In the typing indicator block (line ~679), replace the `sr-only` span with a visible status line:

```tsx
              {statusLine ? (
                <span className="text-xs text-text-secondary whitespace-nowrap">{statusLine}</span>
              ) : (
                <span className="sr-only">Consuela is thinking…</span>
              )}
```

(Keep the three bouncing dots above it.)

- [ ] **Step 4: Run tests + typecheck**

Run: `cd Home-ai && npx vitest run tests/unit/chat-page-stream.test.tsx && npm run typecheck`
Expected: PASS (3/3), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/chat/page.tsx tests/unit/chat-page-stream.test.tsx
git commit -m "feat(chat): render Consuela replies token-by-token with a tool status line"
```

---

### Task 8: Clem streams too

**Files:**
- Modify: `src/components/meals/ClemAssistant.tsx` (`send`, lines 62-83)

**Interfaces:**
- Consumes: `streamConsuelaChat` (Task 5).

- [ ] **Step 1: Replace `send`**

```ts
  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || loading) return;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setLoading(true);
    setStatusText("Clem is thinking…");
    try {
      const { content } = await streamConsuelaChat({
        message: text,
        history: messages.slice(-6),
        system: systemPrompt,
        agent: "clem",
        onStatus: (label) => setStatusText(label),
        onToken: (full) => {
          setLoading(false);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && streamingRef.current) {
              return [...prev.slice(0, -1), { role: "assistant", content: full }];
            }
            return [...prev, { role: "assistant", content: full }];
          });
          streamingRef.current = true;
        },
      });
      streamingRef.current = false;
      setLoading(false);
      const reply = content || "Sorry, I didn't catch that.";
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant") return [...prev.slice(0, -1), { role: "assistant", content: reply }];
        return [...prev, { role: "assistant", content: reply }];
      });
    } catch {
      streamingRef.current = false;
      setLoading(false);
      showToast("Couldn't reach Clem right now — try again");
    }
  };
```

Add near the other state (line ~45): `const [statusText, setStatusText] = useState("Clem is thinking…");` and `const streamingRef = useRef(false);`

Replace the loading bubble text (line ~141) `{loading && ...}` block's `Clem is thinking…` with `{statusText}`.

Add import: `import { streamConsuelaChat } from "@/lib/chat-stream";`

- [ ] **Step 2: Verify**

Run: `cd Home-ai && npm run typecheck && npx vitest run tests/unit/hermes-chat-clem.test.ts`
Expected: clean + green (route contract unchanged for Clem's buffered callers).

- [ ] **Step 3: Commit**

```bash
git add src/components/meals/ClemAssistant.tsx
git commit -m "feat(clem): stream grocery answers token-by-token"
```

---

## Landing 3 — Cleanup + wiring hygiene

### Task 9: Delete the dead Consuela code

**Files:**
- Delete: `src/app/api/chat/process/route.ts`, `src/lib/consuela-ai-enhanced.ts`, `src/components/clarification/ClarificationModal.tsx` (and the dir if empty), `src/components/ui/ConsuelaFAB.tsx`
- Modify: `src/db/features/family-ai.ts` (remove `buildSystemPrompt` only)

**Interfaces:**
- Consumes: Task 3 removed the last importer of `ClarificationModal` and `/api/chat/process`.

- [ ] **Step 1: Confirm zero importers**

Run: `cd Home-ai && grep -rn "chat/process\|consuela-ai-enhanced\|ClarificationModal\|ConsuelaFAB\|buildSystemPrompt" src/ tests/ --include='*.ts' --include='*.tsx' | grep -v "src/app/api/chat/process/route.ts\|src/lib/consuela-ai-enhanced.ts\|src/components/clarification/\|src/components/ui/ConsuelaFAB.tsx\|src/db/features/family-ai.ts"`
Expected: no output (only the files being deleted reference themselves). If anything shows up, stop and fix that importer first.

- [ ] **Step 2: Delete the files**

```bash
cd Home-ai
git rm src/app/api/chat/process/route.ts
git rm src/lib/consuela-ai-enhanced.ts
git rm src/components/clarification/ClarificationModal.tsx
git rm src/components/ui/ConsuelaFAB.tsx
```

- [ ] **Step 3: Remove `buildSystemPrompt` from `src/db/features/family-ai.ts`**

Delete the `export function buildSystemPrompt(...)` block (line ~384 to its closing brace) and any imports it alone used. Keep all schema/type exports — `src/db/features/index.ts` re-exports them and `ALL_FEATURE_SCHEMAS` references the schemas (AGENTS.md: feature schemas stay in place).

- [ ] **Step 4: Verify**

Run: `cd Home-ai && npm run typecheck && npx vitest run`
Expected: clean + full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chat/process/route.ts src/lib/consuela-ai-enhanced.ts src/components/clarification/ClarificationModal.tsx src/components/ui/ConsuelaFAB.tsx src/db/features/family-ai.ts
git commit -m "chore(consuela): delete dead clarification stack, orphaned FAB, unused demo prompt builder"
```

---

### Task 10: Parallelize the suggestion engine + briefing reads

**Files:**
- Modify: `src/lib/consuela/engine.ts:208-218` (`runEngine` scanner loop)
- Modify: `src/lib/consuela/briefing.ts:20-42` (`generateBriefing` reads)
- Create: `tests/unit/consuela-parallel.test.ts`

**Interfaces:**
- Produces: `runEngine` runs its 5 scanners concurrently (each still individually failure-isolated); `generateBriefing` runs its 4 post-engine reads concurrently. Return shapes unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/consuela-parallel.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

let inFlight = 0;
let maxInFlight = 0;

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    try {
      return await fn({
        collection: () => ({
          getFullList: async () => [],
          getList: async () => [],
          getFirst: async () => null,
          create: async (d: any) => d,
          update: async (_id: string, d: any) => d,
        }),
      });
    } finally {
      inFlight -= 1;
    }
  }),
}));

vi.mock("@/db", () => ({
  db: {
    insertProactiveSuggestions: vi.fn(async () => ({ inserted: 0, rejected: 0 })),
    selectPendingSuggestions: vi.fn(async () => []),
    upsertMorningBriefing: vi.fn(async () => ({})),
  },
}));

vi.mock("./engine", () => ({ runEngine: vi.fn(async () => ({ scanned: 0, inserted: 0, rejected: 0 })) }));

import { runEngine } from "@/lib/consuela/engine";
import { generateBriefing } from "@/lib/consuela/briefing";

beforeEach(() => { inFlight = 0; maxInFlight = 0; });

describe("consuela background parallelism", () => {
  it("runEngine runs scanners concurrently", async () => {
    await runEngine({ scopeDate: "2026-09-02" });
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("generateBriefing runs its post-engine reads concurrently", async () => {
    await generateBriefing({ scopeDate: "2026-09-02" });
    expect(maxInFlight).toBeGreaterThan(1);
  });
});
```

Note: `generateBriefing`'s `runEngine` is mocked (relative path `./engine` as imported by briefing.ts) so its concurrency is measured independently. If the mock path doesn't intercept, use `vi.mock("@/lib/consuela/engine", ...)` matching briefing.ts's actual import specifier — check `briefing.ts:1`.

- [ ] **Step 2: Run to verify failure**

Run: `cd Home-ai && npx vitest run tests/unit/consuela-parallel.test.ts`
Expected: FAIL — `maxInFlight` is 1 (serial loops).

- [ ] **Step 3: Implement**

`engine.ts` — replace the `runEngine` loop (lines 210-218):

```ts
  const results = await Promise.all(scanners.map(async (s) => {
    try {
      return await s(scopeDate);
    } catch (e) {
      console.error("[consuela.engine] scanner failed:", (e as Error).message);
      return [] as NewSuggestion[];
    }
  }));
  const all = results.flat();
```

`briefing.ts` — replace lines 23-42 with concurrent reads:

```ts
  const currentWeekStart = weekStartForDate(todayISO());
  const [events, tasks, meals, suggestions] = await Promise.all([
    withAdmin(async (pb) =>
      pb.collection("events").getFullList({
        filter: `date="${scopeDate}"`,
        requestKey: null,
      }) as unknown as BriefingRow[]
    ),
    withAdmin(async (pb) =>
      pb.collection("tasks").getFullList({ requestKey: null })
    ) as unknown as BriefingRow[],
    withAdmin(async (pb) =>
      pb.collection("meal_plan_entries").getFullList({
        filter: `weekOf="${currentWeekStart}"`,
        requestKey: null,
      })
    ) as unknown as BriefingRow[],
    db.selectPendingSuggestions({ scopeDate, limit: 5 }),
  ]);
```

- [ ] **Step 4: Verify**

Run: `cd Home-ai && npx vitest run tests/unit/consuela-parallel.test.ts && npx vitest run`
Expected: new tests PASS; full suite green (existing briefing/suggestions tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/lib/consuela/engine.ts src/lib/consuela/briefing.ts tests/unit/consuela-parallel.test.ts
git commit -m "perf(consuela): run suggestion scanners and briefing reads concurrently"
```

---

### Task 11: Filtered + batched PB reads in hot tool handlers

**Files:**
- Modify: `src/lib/hermes-tools.ts` (`adminUpsertTask`, `adminUpsertWeekData`, `complete_task` week read, `remove_event`, `add_grocery_item`)
- Create: `tests/unit/hermes-tools-filters.test.ts`

**Interfaces:**
- Produces: same handler return strings; fewer PB rows transferred. `add_grocery_item` does ONE grocery-list read per call (was one per item). Scope note: `ha_list_devices`/`ha_control_device` full reads are left alone (HA is not configured live — AGENTS.md); `complete_task`'s tasks read stays full (fuzzy title matching needs the set).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/hermes-tools-filters.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: Array<{ collection: string; filter?: string }> = [];
const rows: Record<string, any[]> = {};

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) => fn({
    collection: (name: string) => ({
      getFullList: async (opts: any) => {
        calls.push({ collection: name, filter: opts?.filter });
        return rows[name] ?? [];
      },
      update: async (_id: string, d: any) => ({ id: _id, ...d }),
      create: async (d: any) => ({ id: `new-${calls.length}`, ...d }),
      delete: async () => true,
    }),
  })),
}));

vi.mock("@/db", () => ({
  db: {
    selectTodaysEvents: () => [], selectPendingTasks: () => [], selectPantry: () => [],
    selectGrocery: () => [], selectMeals: () => [], selectRecipes: () => [],
    selectMembers: () => [], selectTodaysSchedulesRaw: () => [],
  },
}));

import { getTool } from "@/lib/hermes-tools";

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(rows)) delete rows[k];
});

describe("hermes-tools — PB-side filters + batching", () => {
  it("complete_task reads week_data filtered to the current week", async () => {
    rows.tasks = [{ id: "t1", taskId: 7, title: "Walk Rocco", status: "pending", points: 10, assignee: "Emily" }];
    rows.week_data = [];
    const tool = getTool("complete_task")!;
    await tool.handler({ taskId: 7 });
    const weekCall = calls.find((c) => c.collection === "week_data");
    expect(weekCall?.filter).toContain("weekStart=");
  });

  it("add_grocery_item reads the grocery list ONCE for multiple items", async () => {
    rows.grocery_list_items = [];
    const tool = getTool("add_grocery_item")!;
    await tool.handler({ items: "milk, eggs, bread" });
    const groceryReads = calls.filter((c) => c.collection === "grocery_list_items" && c.filter === undefined);
    expect(groceryReads.length).toBeLessThanOrEqual(1);
  });

  it("remove_event filters events by title (and date when given)", async () => {
    rows.events = [{ id: "e1", title: "Soccer practice", date: "2026-09-05" }];
    const tool = getTool("remove_event")!;
    await tool.handler({ title: "Soccer practice", date: "2026-09-05" });
    const eventCall = calls.find((c) => c.collection === "events");
    expect(eventCall?.filter).toContain("title ~");
    expect(eventCall?.filter).toContain('date="2026-09-05"');
  });

  it("add_task upserts with a taskId filter (no full tasks scan)", async () => {
    rows.tasks = [];
    const tool = getTool("add_task")!;
    await tool.handler({ title: "Test chore", assigned_to: "Emily", points: 5 });
    const taskReads = calls.filter((c) => c.collection === "tasks");
    expect(taskReads.length).toBeGreaterThan(0);
    for (const c of taskReads) {
      expect(c.filter).toContain("taskId=");
    }
  });
});
```

(`add_task` builds `taskId: Date.now()` then calls `adminUpsertTask` — the filtered read is what this pins down.)

- [ ] **Step 2: Run to verify failure**

Run: `cd Home-ai && npx vitest run tests/unit/hermes-tools-filters.test.ts`
Expected: FAIL — week_data/grocery/events reads are unfiltered full lists; grocery read count = 3.

- [ ] **Step 3: Implement in `src/lib/hermes-tools.ts`**

`adminUpsertTask` (line 60):

```ts
async function adminUpsertTask(task: Record<string, unknown>): Promise<any | null> {
  try {
    return await withAdmin(async (pb) => {
      const records = await pb.collection("tasks").getFullList({
        filter: `taskId=${Number(task.taskId)}`,
        requestKey: null,
      });
      const existing = records.find((r: any) => r.taskId === task.taskId);
      return existing ? pb.collection("tasks").update(existing.id, task) : pb.collection("tasks").create(task);
    });
  } catch (e: any) {
    console.error("[hermes-tools] upsertTask failed:", e?.message);
    return null;
  }
}
```

`adminUpsertWeekData` (line 120):

```ts
      const records = await pb.collection("week_data").getFullList({
        filter: `weekStart="${data.weekStart}"`,
        requestKey: null,
      });
```

`complete_task` week read (line 435):

```ts
          const weekRecords = await pb.collection("week_data").getFullList({
            filter: `weekStart="${currentWeek}"`,
            requestKey: null,
          });
```

`remove_event` (line 254):

```ts
          const titleLike = title.replace(/"/g, "");
          const records = await pb.collection("events").getFullList({
            filter: `title ~ "${titleLike}"${date ? ` && date="${date}"` : ""}`,
            requestKey: null,
          });
```

(Keep the exact-match `.find` after it — the `~` filter is a coarse pre-narrowing, the client-side check preserves semantics.)

`add_grocery_item` — batch into one session. Replace the handler (lines 645-665):

```ts
    handler: async (args) => {
      const names = String(args.items ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
      if (names.length === 0) return summarize({ inserted: 0, items: [], error: "No item names provided" });
      const category = args.category || "pantry";
      let inserted: Array<{ name: string; emoji: string; category: string }> = [];
      try {
        inserted = await withAdmin(async (pb) => {
          const records = await pb.collection("grocery_list_items").getFullList({ requestKey: null });
          const byNorm = new Map<string, any>();
          for (const g of records as any[]) {
            if (g.name) byNorm.set(normalizeGroceryName(g.name), g);
          }
          const catDef = groceryCategories.find((c) => c.id === category);
          const emoji = catDef?.emoji || "📦";
          const aisle = catDef?.aisles?.[0]?.split("-")[0] || "1";
          const out: Array<{ name: string; emoji: string; category: string }> = [];
          for (const name of names) {
            const trimmed = name.trim();
            const existing = byNorm.get(normalizeGroceryName(trimmed));
            if (existing) {
              await pb.collection("grocery_list_items").update(existing.id, {
                needed: true,
                source: existing.source || "chat",
              });
              out.push({ name: existing.name || trimmed, emoji: existing.emoji || emoji, category: existing.category || category });
            } else {
              await pb.collection("grocery_list_items").create({
                userId: "demo",
                name: trimmed,
                emoji,
                category,
                aisle,
                quantity: "",
                priority: "medium",
                needed: true,
                source: "chat",
              });
              out.push({ name: trimmed, emoji, category });
            }
          }
          return out;
        });
      } catch (e: any) {
        return summarize({ inserted: 0, items: [], error: e?.message || "grocery add failed" });
      }
      return summarize({
        inserted: inserted.length,
        items: inserted,
        note: `${inserted.length} item(s) added to the grocery list. Check the Grocery tab in the dashboard.`,
      });
    },
```

- [ ] **Step 4: Verify**

Run: `cd Home-ai && npx vitest run tests/unit/hermes-tools-filters.test.ts && npx vitest run && npm run typecheck`
Expected: new PASS, full suite green, clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hermes-tools.ts tests/unit/hermes-tools-filters.test.ts
git commit -m "perf(consuela): PB-side filters + single-read batched grocery adds in chat tools"
```

---

### Task 12: Incremental thread reconcile + end-to-end probe

**Files:**
- Modify: `src/app/api/chat/messages/route.ts` (accept `?since=`)
- Modify: `src/app/chat/page.tsx` (`fetchPBThread` since-aware + `lastPBCreatedRef`)
- Create: `tests/unit/chat-messages-since.test.ts`
- Create: `scripts/consuela/verify-chat-speed.mjs`

**Interfaces:**
- Produces: `GET /api/chat/messages?threadId=…&since=<ISO>` → only rows with `createdAt > since` (existing `db.selectChatMessages(threadId, sinceISO)` already supports it — `pb-db.ts:659`). Invalid `since` (quote/backslash) → 400, same guard style as `threadId`.

- [ ] **Step 1: Write the failing route test**

Create `tests/unit/chat-messages-since.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const selectChatMessages = vi.hoisted(() => vi.fn(async () => [] as any[]));
vi.mock("@/db", () => ({ db: { selectChatMessages } }));

import { GET } from "@/app/api/chat/messages/route";

beforeEach(() => { selectChatMessages.mockClear(); });

describe("GET /api/chat/messages — since", () => {
  it("passes since through to selectChatMessages", async () => {
    await GET(new NextRequest("http://localhost/api/chat/messages?threadId=2026-09-02&since=2026-09-02T10:00:00.000Z"));
    expect(selectChatMessages).toHaveBeenCalledWith("2026-09-02", "2026-09-02T10:00:00.000Z");
  });

  it("omits since when absent", async () => {
    await GET(new NextRequest("http://localhost/api/chat/messages?threadId=2026-09-02"));
    expect(selectChatMessages).toHaveBeenCalledWith("2026-09-02", undefined);
  });

  it("rejects a quote-bearing since with 400", async () => {
    const res = await GET(new NextRequest("http://localhost/api/chat/messages?threadId=2026-09-02&since=x%22y"));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd Home-ai && npx vitest run tests/unit/chat-messages-since.test.ts`
Expected: FAIL — route ignores `since` (called with one arg).

- [ ] **Step 3: Implement the route change**

In `src/app/api/chat/messages/route.ts`, after the threadId guard (line 15), add:

```ts
  const since = request.nextUrl.searchParams.get("since");
  if (since !== null && (since.includes('"') || since.includes("\\"))) {
    return NextResponse.json({ error: "invalid since" }, { status: 400 });
  }
```

and change line 18:

```ts
    const messages = await db.selectChatMessages(threadId, since || undefined);
```

- [ ] **Step 4: Make the client reconcile incremental**

In `src/app/chat/page.tsx`, change `fetchPBThread` (lines 59-73) to:

```ts
async function fetchPBThread(sinceISO?: string): Promise<{ messages: Message[]; latest: string | null }> {
  try {
    const params = new URLSearchParams({ threadId: todayISO() });
    if (sinceISO) params.set("since", sinceISO);
    const res = await fetch(`/api/chat/messages?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return { messages: [], latest: null };
    const json = await res.json();
    if (!json.ok || !Array.isArray(json.messages)) return { messages: [], latest: null };
    let latest: string | null = null;
    const messages = json.messages.map((m: any, i: number) => {
      if (m.createdAt && (!latest || String(m.createdAt) > latest)) latest = String(m.createdAt);
      return {
        id: 1000000 + i,
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.content || "",
        timestamp: new Date(m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        ...(m.role === "user" && m.userId ? { speaker: m.userId } : {}),
      };
    });
    return { messages, latest };
  } catch { return { messages: [], latest: null }; }
}
```

Add a ref near the other refs (line ~211): `const lastPBCreatedRef = useRef<string | null>(null);`

Update the hydrate effect (lines 184-201): `const { messages: pbMsgs, latest } = await fetchPBThread(); if (latest) lastPBCreatedRef.current = latest;` (rest unchanged).

Update the post-send reconcile in `sendMessage` (Task 7's version):

```ts
      const { messages: fresh, latest } = await fetchPBThread(lastPBCreatedRef.current ?? undefined);
      if (latest) lastPBCreatedRef.current = latest;
      if (fresh.length > 0) setMessages(prev => mergePBThread(prev, fresh));
```

- [ ] **Step 5: Run tests**

Run: `cd Home-ai && npx vitest run tests/unit/chat-messages-since.test.ts tests/unit/chat-page-stream.test.tsx && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Write the Playwright probe**

Create `scripts/consuela/verify-chat-speed.mjs` (match the style of `verify-weather-features.mjs` — read it first for the BASE_URL/env conventions):

```js
#!/usr/bin/env node
// Chat speed probe: no pre-flight request, SSE reply renders, fast first paint.
// Run against a dev server: BASE_URL=http://localhost:3000 node scripts/consuela/verify-chat-speed.mjs
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const SSE_BODY =
  'data: {"t":"You have "\n\n' +
  'data: {"t":"3 chores "\n\n' +
  'data: {"t":"today."}\n\n' +
  "data: [DONE]\n\n";

const browser = await chromium.launch();
const page = await browser.newPage();
const requests = [];
page.on("request", (r) => requests.push(r.url()));
await page.route("**/api/chat/messages**", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, messages: [] }) }));
await page.route("**/api/hermes/chat", (route) =>
  route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: SSE_BODY }));

let failures = 0;
const check = (name, ok) => { console.log(`  ${ok ? "ok" : "FAIL"} - ${name}`); if (!ok) failures++; };

await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" });
const t0 = Date.now();
await page.locator("textarea").fill("what do I have today?");
await page.getByTitle("Send message").click();
await page.waitForFunction(() => document.body.innerText.includes("3 chores"), null, { timeout: 5000 });
const elapsed = Date.now() - t0;

check("reply rendered from SSE", await page.locator("text=You have 3 chores today.").count() > 0);
check("no /api/chat/process pre-flight", !requests.some((u) => u.includes("/api/chat/process")));
check(`first paint under 2s (${elapsed}ms)`, elapsed < 2000);

await browser.close();
console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 7: Run the probe against a dev server**

```bash
cd Home-ai && (npm run dev &) && sleep 8 && BASE_URL=http://localhost:3000 node scripts/consuela/verify-chat-speed.mjs; kill %1 2>/dev/null
```

Expected: `ALL CHECKS PASSED`. (If the dev server is already running on :3000, skip starting one.)

- [ ] **Step 8: Commit**

```bash
git add src/app/api/chat/messages/route.ts src/app/chat/page.tsx tests/unit/chat-messages-since.test.ts scripts/consuela/verify-chat-speed.mjs
git commit -m "perf(chat): incremental since-based thread reconcile + chat speed probe"
```

---

### Task 13: Telegram cadence + AGENTS.md + final gates

**Files:**
- Modify: `scripts/consuela/host-crontab.example` (telegram-poll line)
- Modify: `src/lib/services/registry.ts:55` (description text)
- Modify: `AGENTS.md` (snapshot, UI Change Record, §5.2 cron table, Change Log)

- [ ] **Step 1: Tighten the crontab example**

In `scripts/consuela/host-crontab.example`, change:

```
*/30 * * * * curl -fs -m 30 -H "Authorization: Bearer $CONSUELA_CRON_SECRET" http://localhost:3000/api/cron/consuela/telegram-poll  >> ~/consuela-cron.log 2>&1
```

to:

```
*/5 * * * * curl -fs -m 30 -H "Authorization: Bearer $CONSUELA_CRON_SECRET" http://localhost:3000/api/cron/consuela/telegram-poll  >> ~/consuela-cron.log 2>&1
```

- [ ] **Step 2: Update the registry description**

`src/lib/services/registry.ts` line 55: `"Mirrors family group messages into Ask Consuela (30-min poll)"` → `"Mirrors family group messages into Ask Consuela (5-min poll)"`.

- [ ] **Step 3: Update AGENTS.md (mandatory repo rule)**

- **Current Dashboard Snapshot**: new top entry dated 2026-09-02 — Consuela chat speed sweep: dead `/api/chat/process` pre-flight removed (route deleted), thinking floor 2s→0.4s (streamed replies bypass it), Hermes config cached 10min + 60s call timeout, SSE streaming end-to-end (chat page + Clem) with buffered auto-fallback, parallel tool rounds + engine scanners + briefing reads, filtered/batched tool-handler PB reads, since-based thread reconcile, Telegram mirror cron 30→5 min. Verified: suite N/N, typecheck clean, eslint clean on touched files, `verify-chat-speed.mjs` ALL CHECKS PASSED.
- **UI Change Record**: new record `2026-09-02 — Ask Consuela streams replies token-by-token` following the repo's record format (Added/Changed files, Visual/Motion: hero orb → first token replaces typing dots; status line "Checking your grocery list…" under the dots; Clem modal streams identically; Color sources: none; Agent action required; user-facing description).
- **§5.2 cron table**: telegram-poll row `every 30 min` → `every 5 min`.
- **§1.5 journey "How do Telegram and dashboard chat sync?"**: "30-minute poll" → "5-minute poll".
- **Change Log**: one entry summarizing the sweep.
- Grep AGENTS.md for remaining `30-min`/`30 min` Telegram mentions and update them.

- [ ] **Step 4: Final gates**

```bash
cd Home-ai && npm run typecheck && npx vitest run && npm run lint
```

Expected: typecheck clean; full suite green; eslint — 0 errors on touched files (pre-existing warnings elsewhere are acceptable per repo baseline).

- [ ] **Step 5: Commit**

```bash
git add scripts/consuela/host-crontab.example src/lib/services/registry.ts AGENTS.md
git commit -m "chore(consuela): telegram mirror 30min->5min + AGENTS.md chat-speed records"
```

- [ ] **Step 6: Ops note for the user**

Tell the user: the crontab change only takes effect after they apply it on the NAS host (`crontab -e` → update the telegram-poll line to `*/5 * * * *`), per `DEPLOY_NAS_LOCAL.md`.

---

## Verification Summary (all landings)

| Gate | Command | Expected |
|---|---|---|
| Typecheck | `npm run typecheck` | clean |
| Unit suite | `npx vitest run` | all green (baseline 729 + ~25 new) |
| Lint | `npm run lint` | 0 new errors on touched files |
| Chat probe | `node scripts/consuela/verify-chat-speed.mjs` | ALL CHECKS PASSED |
| Existing chat scripts | `npx tsx scripts/consuela/test-chat-route-mock.mjs` etc. | unchanged behavior (buffered mode intact) |
