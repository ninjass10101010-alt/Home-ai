// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const streamMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/chat-stream", () => ({ streamConsuelaChat: (opts: any) => streamMock.fn(opts) }));

import {
  __resetChatStoreForTests,
  getSnapshot,
  subscribe,
  ensureHydrated,
  send,
  stop,
  startNewConversation,
  OPTIMISTIC_ID_CEILING,
} from "@/lib/chat-store";
import { SEED_GREETING_ID } from "@/lib/chat-thread";

const SPEAKER = { name: "Rebecca", emoji: "🐱" };

/** Only the rows a reply creates — the seed greeting is an assistant row too. */
function assistantBubbles() {
  return getSnapshot().messages.filter((m) => m.role === "assistant" && m.id !== SEED_GREETING_ID);
}

function okFetch(messages: any[] = []) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: true, messages }), {
    status: 200, headers: { "content-type": "application/json" },
  }));
}

beforeEach(() => {
  __resetChatStoreForTests();
  streamMock.fn.mockReset();
  localStorage.clear();
  vi.stubGlobal("fetch", okFetch());
});

describe("chat-store core", () => {
  it("hydrates exactly once per page load (remount reconcile does not re-run the full read)", async () => {
    const fetchMock = okFetch([{ role: "assistant", content: "pb-row", createdAt: "2026-09-20T10:00:00.000Z" }]);
    vi.stubGlobal("fetch", fetchMock);
    await ensureHydrated();
    expect(getSnapshot().hydrated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getSnapshot().messages.some((m) => m.content === "pb-row")).toBe(true);
    // Second call (a remount) must NOT do another full read.
    await ensureHydrated();
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 full + 1 incremental since-read
    expect(String(fetchMock.mock.calls[1][0])).toContain("since=");
  });

  it("streams tokens into one assistant bubble, then finalizes", async () => {
    streamMock.fn.mockImplementation(async ({ onToken }: any) => {
      onToken("Hel", "Hel");
      onToken("Hello", "lo");
      return { content: "Hello", streamed: true };
    });
    await ensureHydrated();
    await send("hi", SPEAKER);
    const msgs = getSnapshot().messages;
    expect(msgs.filter((m) => m.content === "Hello")).toHaveLength(1);
    expect(msgs.some((m) => m.role === "user" && m.content === "hi")).toBe(true);
    expect(getSnapshot().isTyping).toBe(false);
    expect(getSnapshot().streaming).toBe(false);
  });

  it("notifies subscribers on every write", async () => {
    const listener = vi.fn();
    subscribe(listener);
    streamMock.fn.mockResolvedValue({ content: "ok", streamed: true });
    await ensureHydrated();
    listener.mockClear();
    await send("hi", SPEAKER);
    expect(listener).toHaveBeenCalled();
  });

  it("keeps the partial reply when stopped, with no error bubble", async () => {
    streamMock.fn.mockImplementation(({ onToken, signal }: any) => {
      onToken("partial ", "partial ");
      return new Promise((_res, rej) => {
        signal.addEventListener("abort", () => {
          const e = new Error("Generation stopped");
          e.name = "AbortError";
          rej(e);
        });
      });
    });
    await ensureHydrated();
    const p = send("story", SPEAKER);
    stop();
    await p;
    const msgs = getSnapshot().messages;
    expect(msgs.some((m) => m.content.trim() === "partial")).toBe(true);
    expect(msgs.some((m) => m.errorFor)).toBe(false);
    expect(getSnapshot().streaming).toBe(false);
  });

  it("renders only the answering attempt's text after a mid-round failover", async () => {
    // The store's accumulator reset and its rendered bubble are two different
    // things: a bubble left showing a dead target's words is what the family
    // actually sees while the next attempt thinks, so the snapshot is read
    // INSIDE the stream — after the second attempt frame, before its first token.
    const atFirstAttempt: number[] = [];
    const atSecondAttempt: string[] = [];
    streamMock.fn.mockImplementation(async ({ onToken, onAttempt }: any) => {
      onAttempt?.({ round: 1, target: "t0" });
      // Pre-first-token state stays owned by `isTyping`: an attempt must never
      // leave an empty bubble behind as a hole in the thread.
      atFirstAttempt.push(assistantBubbles().length);
      onToken("orphaned half", "orphaned half");
      onAttempt?.({ round: 1, target: "t1" });
      atSecondAttempt.push(assistantBubbles().at(-1)!.content);
      onToken("Final answer.", "Final answer.");
      return { content: "Final answer.", streamed: true };
    });
    await ensureHydrated();
    await send("hi", SPEAKER);
    expect(atFirstAttempt).toEqual([0]);
    expect(atSecondAttempt).toEqual([""]);
    const msgs = getSnapshot().messages;
    expect(assistantBubbles().at(-1)!.content).toBe("Final answer.");
    expect(msgs.some((m) => m.content.includes("orphaned half"))).toBe(false);
  });

  it("keeps the thinking affordance up between an attempt frame and that attempt's first token", async () => {
    // The blank row IS the honest state (the words under it were superseded),
    // but chat/page renders every row unconditionally and gates the thinking
    // dots on isTyping alone — so an attempt frame that blanks without re-arming
    // it leaves a padded empty bubble for the whole reasoning phase.
    const gap: { isTyping: boolean; statusLine: string | null; blank: number }[] = [];
    const answering: (string | null)[] = [];
    streamMock.fn.mockImplementation(async ({ onToken, onStatus, onAttempt }: any) => {
      onAttempt?.({ round: 1, target: "t0" });
      onToken("orphaned half", "orphaned half");
      onStatus("Reading the pantry…");
      onAttempt?.({ round: 1, target: "t1" });
      gap.push({
        isTyping: getSnapshot().isTyping,
        // The dead attempt's label goes with it; the new one re-arms the line.
        statusLine: getSnapshot().statusLine,
        blank: assistantBubbles().filter((m) => m.content === "").length,
      });
      onStatus("Checking the pantry…");
      answering.push(getSnapshot().statusLine);
      onToken("Final answer.", "Final answer.");
      return { content: "Final answer.", streamed: true };
    });
    await ensureHydrated();
    await send("hi", SPEAKER);
    expect(gap).toEqual([{ isTyping: true, statusLine: null, blank: 1 }]);
    // The answering attempt's own label still reaches the line it renders on.
    expect(answering).toEqual(["Checking the pantry…"]);
    expect(getSnapshot().isTyping).toBe(false);
    expect(getSnapshot().statusLine).toBeNull();
  });

  it("leaves no orphan text in the thread when the stream fails after a failover", async () => {
    streamMock.fn.mockImplementation(async ({ onToken, onAttempt }: any) => {
      onAttempt?.({ round: 1, target: "t0" });
      onToken("orphaned half", "orphaned half");
      onAttempt?.({ round: 1, target: "t1" });
      throw new Error("boom");
    });
    await ensureHydrated();
    await send("hi", SPEAKER);
    const msgs = getSnapshot().messages;
    expect(msgs.some((m) => m.content.includes("orphaned half"))).toBe(false);
    // The honest failure copy still lands, with its retry affordance.
    expect(msgs.some((m) => m.errorFor === "hi")).toBe(true);
    // ...and the row the attempt frame blanked is gone with it: mergeThread only
    // appends and `retry` filters only the error bubble's id, so an empty row
    // would sit above the copy for the rest of the session — including on Try
    // again.
    expect(assistantBubbles()).toHaveLength(1);
    expect(assistantBubbles()[0].errorFor).toBe("hi");
  });

  it("drops the blanked row on the route's own error path too", async () => {
    streamMock.fn.mockImplementation(async ({ onToken, onAttempt }: any) => {
      onAttempt?.({ round: 1, target: "t0" });
      onToken("orphaned half", "orphaned half");
      onAttempt?.({ round: 1, target: "t1" });
      throw Object.assign(new Error("I hit a snag doing that"), { name: "RouteChatError" });
    });
    await ensureHydrated();
    await send("hi", SPEAKER);
    expect(assistantBubbles()).toHaveLength(1);
    expect(assistantBubbles()[0].content).toBe("I hit a snag doing that");
  });

  it("writes an honest error bubble with errorFor when the stream fails", async () => {
    streamMock.fn.mockRejectedValue(new Error("boom"));
    await ensureHydrated();
    await send("hi", SPEAKER);
    const err = getSnapshot().messages.find((m) => m.errorFor);
    expect(err).toBeTruthy();
    expect(err!.errorFor).toBe("hi");
    expect(err!.content).toContain("family server");
  });

  it("renders the route's own error text and still offers a retry", async () => {
    // Built by NAME, not as an instance of the class chat-stream exports: this
    // file mocks that module wholesale, so the store can only recognize the
    // route's failure by `name` — which is exactly what must keep working.
    streamMock.fn.mockRejectedValue(Object.assign(
      new Error("My brain isn't configured yet — add a provider in Settings → AI Models."),
      { name: "RouteChatError" },
    ));
    await ensureHydrated();
    await send("hi", SPEAKER);
    const routeMsg = "My brain isn't configured yet — add a provider in Settings → AI Models.";
    const bubble = getSnapshot().messages.find((m) => m.errorFor === "hi");
    // Exact equality, not `includes`: any prefix or suffix the store added would
    // still satisfy a clause check, and only the route's own sentence is honest.
    expect(bubble?.content).toBe(routeMsg);
  });

  it("keeps the server-outage copy for a real network failure", async () => {
    // The route never spoke, so there is no route text to show — the outage
    // copy is the only honest thing available.
    streamMock.fn.mockRejectedValue(new TypeError("Failed to fetch"));
    await ensureHydrated();
    await send("hi", SPEAKER);
    const msgs = getSnapshot().messages;
    expect(msgs.some((m) => m.content.includes("couldn't reach the family server"))).toBe(true);
    expect(msgs.some((m) => m.content.includes("add a provider in Settings"))).toBe(false);
  });

  it("keeps the offline copy when the browser reports no connection", async () => {
    // Restored in-test rather than in afterEach: a leak here would silently
    // flip every later failure in this file to the offline branch.
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    try {
      streamMock.fn.mockRejectedValue(new TypeError("Failed to fetch"));
      await ensureHydrated();
      await send("hi", SPEAKER);
      const msgs = getSnapshot().messages;
      expect(msgs.some((m) => m.content.includes("You're offline — I can't reach the family server"))).toBe(true);
      expect(msgs.some((m) => m.content.includes("add a provider in Settings"))).toBe(false);
    } finally {
      Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    }
  });

  it("startNewConversation appends the reset marker and POSTs the reset", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    await ensureHydrated();
    await startNewConversation();
    expect(getSnapshot().messages.some((m) => m.role === "system" && m.content === "New conversation")).toBe(true);
    const posted = fetchMock.mock.calls.some(
      ([u, init]: any) => String(u).includes("/api/chat/messages") && init?.method === "POST",
    );
    expect(posted).toBe(true);
  });

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
    expect(msgs.filter((m) => m.content === "today's answer")).toHaveLength(1);
    expect(msgs.find((m) => m.id === 101)?.content).toBe("yesterday's answer");
    expect(msgs.find((m) => m.id === 102)?.content).toBe("another stale row");
    expect(new Set(msgs.map((m) => m.id)).size).toBe(msgs.length);
  });

  it("keeps the optimistic range disjoint from the PB-assigned range in one snapshot", async () => {
    vi.stubGlobal("fetch", okFetch([{ role: "assistant", content: "pb", createdAt: "2026-09-20T10:00:00.000Z" }]));
    streamMock.fn.mockResolvedValue({ content: "ok", streamed: true });
    await ensureHydrated();
    await send("hi", SPEAKER);

    const msgs = getSnapshot().messages;
    // Selected by CONTENT, never by id range: filtering on the property under
    // test would make the assertion below true by construction.
    const optimistic = msgs.filter((m) => m.content === "hi" || m.content === "ok");
    const pbIds = msgs.filter((m) => m.content === "pb").map((m) => m.id);
    expect(optimistic).toHaveLength(2);
    expect(pbIds).toHaveLength(1);
    // The boundary comes from the hydrated snapshot itself — every id this load
    // allocated sits below the lowest PB-assigned id, so the two ranges can
    // never overlap and no allocation can overwrite a PB row.
    expect(Math.max(...optimistic.map((m) => m.id))).toBeLessThan(Math.min(...pbIds));
    expect(new Set(msgs.map((m) => m.id)).size).toBe(msgs.length);
  });

  it("refuses to allocate past the ceiling when a reseed lands the counter on it", async () => {
    // CEILING - 1 is IN range, so the reseed accepts it and sets msgCounter to
    // exactly CEILING — the state the reseed can reach on its own.
    localStorage.setItem("consuela-chat-messages", JSON.stringify([
      { id: OPTIMISTIC_ID_CEILING - 1, role: "assistant", content: "foreign row", timestamp: "Yesterday", at: 1 },
    ]));
    streamMock.fn.mockResolvedValue({ content: "ok", streamed: true });
    await ensureHydrated();
    // One allocation, so the saturated id stays unique and the thread can still
    // assert global id uniqueness.
    await startNewConversation();

    const msgs = getSnapshot().messages;
    const marker = msgs.find((m) => m.role === "system" && m.content === "New conversation");
    expect(marker?.id).toBe(OPTIMISTIC_ID_CEILING);
    const ids = msgs.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("clamps the reseed so a foreign stored id cannot push allocations into PB space", async () => {
    // The lowest id the range check rejects: above the ceiling, still far below
    // PB space, and in the same range a migration would land in.
    localStorage.setItem("consuela-chat-messages", JSON.stringify([
      { id: OPTIMISTIC_ID_CEILING + 1, role: "assistant", content: "migrated row", timestamp: "Yesterday", at: 1 },
    ]));
    vi.stubGlobal("fetch", okFetch([{ role: "assistant", content: "pb-row", createdAt: "2026-09-20T10:00:00.000Z" }]));
    streamMock.fn.mockResolvedValue({ content: "ok", streamed: true });
    await ensureHydrated();
    await send("hi", SPEAKER);
    const msgs = getSnapshot().messages;
    const fresh = msgs.filter((m) => m.content === "hi" || m.content === "ok");
    const pbIds = msgs.filter((m) => m.content === "pb-row").map((m) => m.id);
    expect(fresh).toHaveLength(2);
    expect(pbIds).toHaveLength(1);
    // Asserted against a PB row in the SAME snapshot, not a re-hardcoded base.
    expect(fresh.every((m) => m.id > 0 && m.id < Math.min(...pbIds))).toBe(true);
    const ids = msgs.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not re-issue an id reserved by a send that raced hydration", async () => {
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    let releaseHydrationFetch!: () => void;
    let rejectStream!: (e: Error) => void;
    // Hydration's PB read stays in flight across the send, so the reseed
    // computes its max from a thread that does not yet contain every id the
    // send handed out. The stream then fails WITHOUT emitting a token, so the
    // reply id it reserved never materializes as a row.
    vi.stubGlobal("fetch", vi.fn((url: string) =>
      String(url).includes("since=")
        ? Promise.resolve(json({ ok: true, messages: [] }))
        : new Promise<Response>((res) => { releaseHydrationFetch = () => res(json({ ok: true, messages: [] })); })));
    streamMock.fn.mockImplementation(() => new Promise((_res, rej) => { rejectStream = rej; }));

    const hydrating = ensureHydrated();
    const sending = send("hi", SPEAKER);
    releaseHydrationFetch();
    await hydrating;
    rejectStream(new Error("boom"));
    await sending;

    const ids = getSnapshot().messages.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("leaves a stopped reply standing: the stop path reconciles nothing over it", async () => {
    // The route stores a turn's user+assistant rows all-or-nothing, so a stopped
    // turn leaves PocketBase with nothing to reconcile over the stopped bubble.
    // This pins the store half of that contract: the stop path must not fetch the
    // server thread after the turn, and the words the user was left looking at
    // must survive a reload on their own. (The route half — refusing to store the
    // pair — is tests/unit/hermes-chat-stream.test.ts.)
    const fetchMock = okFetch([]);
    vi.stubGlobal("fetch", fetchMock);
    streamMock.fn.mockImplementation(({ onToken, signal }: any) => {
      onToken("partial", "partial");
      return new Promise((_res, rej) => {
        signal.addEventListener("abort", () => {
          const e = new Error("Generation stopped");
          e.name = "AbortError";
          rej(e);
        });
      });
    });
    await ensureHydrated();
    const readsBeforeSend = fetchMock.mock.calls.length;
    const sending = send("story", SPEAKER);
    stop();
    await sending;
    // No server-thread read of its own: the stop path never reconciles, so the
    // only thing that could replace these words is a later hydrate.
    expect(fetchMock.mock.calls.length).toBe(readsBeforeSend);

    // Reload: localStorage carries the stopped bubble, and the server thread
    // holds this turn's user row but no answer — so nothing replaces it.
    __resetChatStoreForTests();
    vi.stubGlobal("fetch", okFetch([{ role: "user", content: "story", createdAt: new Date().toISOString() }]));
    await ensureHydrated();
    expect(assistantBubbles().map((m) => m.content)).toEqual(["partial"]);
    expect(getSnapshot().messages.some((m) => m.content === "story")).toBe(true);
  });

  it("persists hydrated history to localStorage without the seed greeting", async () => {
    streamMock.fn.mockResolvedValue({ content: "saved-reply", streamed: true });
    await ensureHydrated();
    await send("hi", SPEAKER);
    const stored = JSON.parse(localStorage.getItem("consuela-chat-messages")!);
    expect(stored.some((m: any) => m.content === "saved-reply")).toBe(true);
    expect(stored.some((m: any) => m.id === 1)).toBe(false);
  });
});
