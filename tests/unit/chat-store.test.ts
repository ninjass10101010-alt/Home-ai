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

/** The unspied jsdom implementation, captured before any test replaces it. */
const originalSetItem = Storage.prototype.setItem;

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
        // See the stop test below for why `aborted` is checked before listening.
        const e = new Error("Generation stopped");
        e.name = "AbortError";
        if (signal.aborted) rej(e);
        else signal.addEventListener("abort", () => rej(e));
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

  it("seeds stale rows before the server read, so a send inside that window cannot overwrite one", async () => {
    // The reported bug, reproduced through the window it survives in: the store
    // merges the stale localStorage rows and then AWAITS the PocketBase read
    // before reseeding the counter, and the composer is live the whole time. A
    // send landing in that window allocates 101/102 — the exact ids the stale
    // rows hold — and the bubble overwrites them.
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    let reads = 0;
    let releaseHydrationFetch!: () => void;
    vi.stubGlobal("fetch", vi.fn(() => {
      reads += 1;
      // ONLY hydration's read is parked. Keyed on the URL instead would not
      // work: the watermark is still empty while hydration is in flight, so the
      // send's own reconcile carries no `since=` either and would park too.
      if (reads === 1) return new Promise<Response>((res) => { releaseHydrationFetch = () => res(json({ ok: true, messages: [] })); });
      return Promise.resolve(json({ ok: true, messages: [] }));
    }));
    localStorage.setItem("consuela-chat-messages", JSON.stringify([
      { id: 101, role: "assistant", content: "stale answer", timestamp: "Yesterday", at: 1 },
      { id: 102, role: "assistant", content: "another stale row", timestamp: "Yesterday", at: 2 },
    ]));
    streamMock.fn.mockImplementation(async ({ onToken }: any) => {
      onToken("today's answer", "today's answer");
      return { content: "today's answer", streamed: true };
    });

    // Not awaited: the send must land while hydration's server read is still
    // in flight, which is the whole window.
    const hydrating = ensureHydrated();
    const sending = send("hello", SPEAKER);
    releaseHydrationFetch();
    await hydrating;
    await sending;

    const msgs = getSnapshot().messages;
    expect(msgs.find((m) => m.id === 101)?.content).toBe("stale answer");
    expect(msgs.find((m) => m.id === 102)?.content).toBe("another stale row");
    expect(msgs.filter((m) => m.content === "today's answer")).toHaveLength(1);
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
      // If `stop()` already ran before this mock was reached, the abort listener
      // would attach to an already-aborted signal and never fire, so the promise
      // would never settle and the await below would hang the suite instead of
      // reporting. Check `aborted` before listening — do not rely on send() having
      // no await between the controller and this call.
      return new Promise((_res, rej) => {
        const e = new Error("Generation stopped");
        e.name = "AbortError";
        if (signal.aborted) rej(e);
        else signal.addEventListener("abort", () => rej(e));
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

  it("a stop after the answer is on screen cannot abort the turn the route is persisting", async () => {
    // The route writes `[DONE]` BEFORE `await persistChatPair`, so between the
    // terminator and the row actually being in PocketBase the answer is fully
    // rendered for the requester and the server is still mid-persist. The store
    // only nulled `abortController` in its `finally`, which runs after the
    // reconcile round trip - so the always-enabled stop button aborted a stream
    // that had already produced everything, the route saw request.signal.aborted
    // and skipped the persist, and the family thread never got an answer the
    // user was looking at in full. The window is the frame's flight time PLUS
    // the reconcile round trip PLUS the two PB inserts.
    //
    // Parked on the reconcile read so the stop lands in that window rather than
    // in a race with it. Keyed on the read COUNT, not on `since=`: the
    // watermark is still empty here (hydration read nothing back), so the
    // reconcile URL carries no `since=` either.
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    let reads = 0;
    let parked = false;
    let releaseReconcile!: () => void;
    vi.stubGlobal("fetch", vi.fn(() => {
      reads += 1;
      // Reads 1 = hydration, 2 = the send's post-stream reconcile.
      if (reads === 2) {
        parked = true;
        return new Promise<Response>((res) => { releaseReconcile = () => res(json({ ok: true, messages: [] })); });
      }
      return Promise.resolve(json({ ok: true, messages: [] }));
    }));
    let streamSignal: AbortSignal | undefined;
    streamMock.fn.mockImplementation(async ({ onToken, signal }: any) => {
      streamSignal = signal;
      onToken("We have chicken and rice.", "We have chicken and rice.");
      return { content: "We have chicken and rice.", streamed: true };
    });
    await ensureHydrated();

    const sending = send("what's for dinner?", SPEAKER);
    for (let i = 0; i < 50 && !parked; i += 1) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(parked, "the store parked on its post-stream reconcile").toBe(true);
    // Proof the stop below lands in the window and not before it: the answer is
    // already on the message and the turn is still flagged streaming.
    expect(getSnapshot().messages.some((m) => m.content === "We have chicken and rice.")).toBe(true);
    expect(getSnapshot().streaming).toBe(true);

    stop();

    expect(streamSignal!.aborted, "a settled stream is un-stoppable").toBe(false);

    releaseReconcile();
    await sending;
    expect(getSnapshot().messages.some((m) => m.content === "We have chicken and rice.")).toBe(true);
    expect(getSnapshot().streaming).toBe(false);
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

// A reasoning model thinks in front of the family, and the route forwards every
// reasoning delta plus one frame per tool execution (Task 8). What the store
// does with them is DISPLAY-ONLY (spec §4.2 / §8): they belong on screen and in
// memory, and nowhere else. `persistHistory()` runs on EVERY token tick, so an
// unstripped transcript would write hundreds of frames of thinking to
// localStorage on every keystroke of the think — and come back on the next page
// load as if it had been said.
describe("chat-store — live thinking + tool activity state", () => {
  /**
   * The route's frame order for a turn: an attempt frame before EVERY provider
   * call, so the round that runs tools and the ANSWERING round each get one. A
   * mock that never calls `onAttempt` asserts an order the route cannot produce,
   * and any assertion about the finished message's chips or transcript then
   * passes for the wrong reason.
   */
  function turnScript(
    answer: string,
    rounds: { tools?: (api: any) => void; reply?: (api: any) => void },
  ): (api: any) => Promise<{ content: string; streamed: boolean }> {
    return async (api: any) => {
      api.onAttempt?.({ round: 1, target: "t0" });
      rounds.tools?.(api);
      api.onAttempt?.({ round: 2, target: "t0" });
      rounds.reply?.(api);
      return { content: answer, streamed: true };
    };
  }

  /** Reasoning and a tool call, then the answer. Read INSIDE the stream so the
   *  mid-turn snapshot is observed, not the post-turn cleared one. */
  function thinkThenAnswer(answer = "Sure."): string[] {
    const live: string[] = [];
    streamMock.fn.mockImplementation(turnScript(answer, {
      tools: (api) => {
        api.onReasoning?.("thinking", "thinking");
        api.onToolEvent?.({ name: "get_weather", state: "running" });
        api.onToolEvent?.({ name: "get_weather", state: "ok" });
        live.push(getSnapshot().thinking);
      },
      reply: (api) => {
        // The answering round thinks for itself, so the transcript that lands on
        // the finished message is its own rather than the tool round's.
        api.onReasoning?.("thinking hard", "thinking hard");
        api.onToken(answer, answer);
      },
    }));
    return live;
  }

  it("accumulates reasoning into live thinking state", async () => {
    const live = thinkThenAnswer();
    await ensureHydrated();
    await send("hi", SPEAKER);
    expect(live).toEqual(["thinking"]);
  });

  it("records tool activity as it arrives and keeps the running chip until the result", async () => {
    const seen: unknown[][] = [];
    streamMock.fn.mockImplementation(turnScript("Rain.", {
      tools: (api) => {
        api.onToolEvent?.({ name: "get_weather", state: "running" });
        seen.push(getSnapshot().toolEvents.map((e: any) => e.state));
        api.onToolEvent?.({ name: "get_weather", state: "ok" });
      },
      reply: (api) => api.onToken("Rain.", "Rain."),
    }));
    await ensureHydrated();
    await send("hi", SPEAKER);
    expect(seen).toEqual([["running"]]);
    expect(getSnapshot().messages.find((m) => m.content === "Rain.")?.toolEvents)
      .toEqual([{ name: "get_weather", state: "ok" }]);
  });

  it("collapses one chip per tool rather than a row per frame", async () => {
    // The route writes a `running` frame per call before any call runs, then one
    // result frame per call in call order. Rendering both would show the same
    // tool twice — once spinning forever next to its own answer.
    streamMock.fn.mockImplementation(turnScript("Rain.", {
      tools: (api) => {
        api.onToolEvent?.({ name: "get_weather", state: "running" });
        api.onToolEvent?.({ name: "get_pantry", state: "running" });
        api.onToolEvent?.({ name: "get_weather", state: "ok" });
        api.onToolEvent?.({ name: "get_pantry", state: "error" });
      },
      reply: (api) => api.onToken("Rain.", "Rain."),
    }));
    await ensureHydrated();
    await send("hi", SPEAKER);
    expect(getSnapshot().messages.find((m) => m.content === "Rain.")?.toolEvents).toEqual([
      { name: "get_weather", state: "ok" },
      { name: "get_pantry", state: "error" },
    ]);
  });

  it("keeps the turn's tool activity on the answer, even though the ANSWERING round announces its own attempt", async () => {
    // The route writes an attempt frame before EVERY provider call — and the
    // answering round is a provider call like any other, so it gets one too.
    // Resetting the turn's chips on it made them unreachable: the answering
    // round runs no tools, so nothing ever put them back and the finished
    // message was chip-less (a ❌ tool error was visible for a few seconds and
    // then erased with no evidence on the answer).
    //
    // Frame order below is the route's real one: attempt → the round's tool
    // frames → the answering round's attempt → its tokens.
    const atAnswerStart: number[] = [];
    streamMock.fn.mockImplementation(async ({ onToolEvent, onAttempt, onToken }: any) => {
      onAttempt?.({ round: 1, target: "t0" });
      onToolEvent?.({ name: "get_pantry", state: "running" });
      onToolEvent?.({ name: "get_pantry", state: "error" });
      onAttempt?.({ round: 2, target: "t0" });
      atAnswerStart.push(getSnapshot().toolEvents.length);
      onToken("I could not check the pantry.", "I could not check the pantry.");
      return { content: "I could not check the pantry.", streamed: true };
    });
    await ensureHydrated();
    await send("what is in the pantry?", SPEAKER);
    expect(atAnswerStart, "the chips survive the answering round's attempt").toEqual([1]);
    const reply = assistantBubbles().at(-1)!;
    expect(reply.content).toBe("I could not check the pantry.");
    expect(reply.toolEvents).toEqual([{ name: "get_pantry", state: "error" }]);
  });

  it("keeps the transcript and chips in memory on the finished message", async () => {
    thinkThenAnswer();
    await ensureHydrated();
    await send("hi", SPEAKER);
    const reply = assistantBubbles().at(-1)!;
    expect(reply.content).toBe("Sure.");
    expect(reply.thinking).toBe("thinking hard");
    expect(reply.toolEvents).toEqual([{ name: "get_weather", state: "ok" }]);
  });

  it("NEVER persists reasoning or tool activity to localStorage", async () => {
    // The binding assertion of this whole task: reasoning text must never leave
    // the tab's memory. Every assertion below is checked against the RAW
    // payload, not a parsed copy, because a leak is a leak however it is
    // encoded — and the payload is only meaningful because the test also proves
    // the in-memory row DOES carry the same values.
    thinkThenAnswer("Sure.");
    await ensureHydrated();
    await send("hi", SPEAKER);
    const raw = localStorage.getItem("consuela-chat-messages")!;
    // Non-vacuous: the write this reads really happened, really holds this
    // turn's rows, and the reply in it is the one carrying the volatile fields.
    expect(raw).toContain("Sure.");
    const stored = JSON.parse(raw);
    expect(stored.some((m: any) => m.content === "Sure.")).toBe(true);
    // ...and the volatile fields are absent from every stored row.
    expect(raw).not.toContain("thinking hard");
    expect(raw).not.toContain("get_weather");
    expect(stored.some((m: any) => "thinking" in m)).toBe(false);
    expect(stored.some((m: any) => "toolEvents" in m)).toBe(false);
    // ...while the in-memory row carries them, so the strip is what removed
    // them rather than the values never having been produced.
    const reply = assistantBubbles().at(-1)!;
    expect(reply.content).toBe("Sure.");
    expect(reply.thinking).toBe("thinking hard");
    expect(reply.toolEvents).toEqual([{ name: "get_weather", state: "ok" }]);
  });

  it("keeps the transcript off localStorage across every write of the turn, not just the last", async () => {
    // `persistHistory()` runs per token tick. Stripping only at the end of the
    // turn would still have written the whole think to storage mid-stream, so
    // this watches every value the key was ever given.
    const written: string[] = [];
    const spy = vi.spyOn(Storage.prototype, "setItem");
    spy.mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === "consuela-chat-messages") written.push(value);
      return originalSetItem.call(this, key, value);
    } as typeof Storage.prototype.setItem);
    try {
      streamMock.fn.mockImplementation(turnScript("Sure.", {
        reply: (api) => {
          api.onReasoning?.("secret middle of the think", "secret middle of the think");
          api.onToken("Sure.", "Sure.");
        },
      }));
      await ensureHydrated();
      await send("hi", SPEAKER);
      expect(written.length).toBeGreaterThan(1);
      expect(written.some((v) => v.includes("secret middle of the think"))).toBe(false);
      // ...and the answer itself is persisted, so this is a real write stream.
      expect(written.some((v) => v.includes("Sure."))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("never sends the transcript back to the model as history", async () => {
    // The provider round-trip is the other place a think could leak: `history`
    // is built from the message list, so anything carried on a row rides along
    // unless the mapping drops it. Read on the SECOND turn, whose history
    // contains the first turn's finished reply — the row that carries the
    // transcript.
    const histories: string[] = [];
    streamMock.fn.mockImplementation(turnScript("Sure.", {
      tools: (api) => {
        histories.push(JSON.stringify(api.history));
        api.onToolEvent?.({ name: "get_weather", state: "ok" });
      },
      reply: (api) => {
        api.onReasoning?.("thinking hard", "thinking hard");
        api.onToken("Sure.", "Sure.");
      },
    }));
    await ensureHydrated();
    await send("one", SPEAKER);
    await send("two", SPEAKER);
    const secondTurn = histories.at(-1)!;
    expect(secondTurn).toContain("Sure.");
    expect(secondTurn).not.toContain("thinking hard");
    expect(secondTurn).not.toContain("get_weather");
  });

  it("clears thinking state at the start of the next turn", async () => {
    const starts: Array<{ thinking: string; chips: number }> = [];
    streamMock.fn.mockImplementation(turnScript("First answer.", {
      tools: (api) => api.onToolEvent?.({ name: "get_weather", state: "running" }),
      reply: (api) => {
        api.onReasoning?.("first turn", "first turn");
        api.onToken("First answer.", "First answer.");
      },
    }));
    await ensureHydrated();
    await send("one", SPEAKER);
    // Turn two reads the snapshot BEFORE it emits anything: a transcript left
    // over from turn one would be showing under this turn's dots.
    streamMock.fn.mockImplementation(turnScript("Second answer.", {
      tools: (api) => {
        starts.push({ thinking: getSnapshot().thinking, chips: getSnapshot().toolEvents.length });
      },
      reply: (api) => {
        api.onReasoning?.("second turn", "second turn");
        api.onToken("Second answer.", "Second answer.");
      },
    }));
    await send("two", SPEAKER);
    expect(starts).toEqual([{ thinking: "", chips: 0 }]);
    // Cleared again once the turn ends — a finished turn shows its transcript on
    // its own message, not as live state for whatever comes next.
    expect(getSnapshot().thinking).toBe("");
    expect(getSnapshot().toolEvents).toEqual([]);
    // ...and the first turn's message kept its own copy.
    expect(getSnapshot().messages.find((m) => m.content === "First answer.")!.thinking)
      .toBe("first turn");
  });

  it("drops a superseded attempt's transcript and chips, exactly as it drops that attempt's tokens", async () => {
    // A2: the route announces `target: "exhausted"` before the synthesized
    // fallback, and the client resets content on every attempt frame. Six rounds
    // of ✅/❌ chips and six rounds of thinking would otherwise stay attached
    // above the "I ran out of steps" answer as if they belonged to it.
    const atFailover: { thinking: string; chips: number; text: string }[] = [];
    streamMock.fn.mockImplementation(async ({ onReasoning, onToolEvent, onAttempt, onToken }: any) => {
      onAttempt?.({ round: 1, target: "t0" });
      onReasoning?.("dead target thinking", "dead target thinking");
      onToolEvent?.({ name: "get_pantry", state: "running" });
      onToolEvent?.({ name: "get_pantry", state: "ok" });
      onToken("Let me check", "Let me check");
      onAttempt?.({ round: 2, target: "exhausted" });
      atFailover.push({
        thinking: getSnapshot().thinking,
        chips: getSnapshot().toolEvents.length,
        text: assistantBubbles().at(-1)!.content,
      });
      onToken("I ran out of steps", "I ran out of steps");
      return { content: "I ran out of steps", streamed: true };
    });
    await ensureHydrated();
    await send("hi", SPEAKER);
    expect(atFailover).toEqual([{ thinking: "", chips: 0, text: "" }]);
    const reply = assistantBubbles().at(-1)!;
    expect(reply.content).toBe("I ran out of steps");
    // The answering attempt thought of nothing, so the message carries no
    // transcript at all rather than the dead target's.
    expect(reply.thinking).toBeUndefined();
    expect(reply.toolEvents).toBeUndefined();
    expect(getSnapshot().thinking).toBe("");
    expect(getSnapshot().toolEvents).toEqual([]);
  });

  it("keeps the transcript and chips on a stopped reply, which keeps its words", async () => {
    // The stop path is the other place a finished bubble is written. A stopped
    // turn persisted nothing, so dropping its transcript here would lose it
    // from a message the user is looking at.
    streamMock.fn.mockImplementation(({ onAttempt, onReasoning, onToolEvent, onToken, signal }: any) => {
      onAttempt?.({ round: 1, target: "t0" });
      onToolEvent?.({ name: "get_weather", state: "running" });
      onAttempt?.({ round: 2, target: "t0" });
      onReasoning?.("partial think", "partial think");
      onToken("partial", "partial");
      return new Promise((_res, rej) => {
        const e = new Error("Generation stopped");
        e.name = "AbortError";
        if (signal.aborted) rej(e);
        else signal.addEventListener("abort", () => rej(e));
      });
    });
    await ensureHydrated();
    const sending = send("story", SPEAKER);
    stop();
    await sending;
    const reply = assistantBubbles().at(-1)!;
    expect(reply.content).toBe("partial");
    expect(reply.thinking).toBe("partial think");
    expect(reply.toolEvents).toEqual([{ name: "get_weather", state: "running" }]);
    expect(getSnapshot().thinking).toBe("");
    expect(getSnapshot().toolEvents).toEqual([]);
  });

  it("keeps reasoning frames from opening the bubble", async () => {
    // Reasoning frames alone must NOT clear the typing dots: the affordance
    // belongs up until the answer's first content token, and a transcript
    // arriving is not an answer. Read mid-stream — after the turn ends the
    // state is cleared, so a post-send snapshot could not tell.
    const seen: Array<{ thinking: string; isTyping: boolean; bubbles: number }> = [];
    streamMock.fn.mockImplementation(async ({ onAttempt, onReasoning, onToken }: any) => {
      onAttempt?.({ round: 1, target: "t0" });
      onReasoning?.("thinking", "thinking");
      seen.push({ thinking: getSnapshot().thinking, isTyping: getSnapshot().isTyping, bubbles: assistantBubbles().length });
      onReasoning?.("thinking hard", " hard");
      onToken("Sure.", "Sure.");
      seen.push({ thinking: getSnapshot().thinking, isTyping: getSnapshot().isTyping, bubbles: assistantBubbles().length });
      return { content: "Sure.", streamed: true };
    });
    await ensureHydrated();
    await send("hi", SPEAKER);
    // The transcript is there and the dots are still up, and no bubble opened.
    expect(seen).toEqual([
      { thinking: "thinking", isTyping: true, bubbles: 0 },
      { thinking: "thinking hard", isTyping: false, bubbles: 1 },
    ]);
    expect(getSnapshot().isTyping).toBe(false);
  });

  it("mirrors the transcript the stream reports rather than the raw deltas", async () => {
    // onReasoning carries (transcript-so-far, new delta) so a caller can choose
    // either. The store must take the transcript: a delta-fed accumulator would
    // double-count every frame after the first. The client is what filters
    // empty/non-string deltas (chat-stream.test.ts), so the store trusts what it
    // is handed and does not re-validate it.
    const seen: string[] = [];
    streamMock.fn.mockImplementation(async ({ onAttempt, onReasoning, onToken }: any) => {
      onAttempt?.({ round: 1, target: "t0" });
      onReasoning?.("kept", "kept");
      onReasoning?.("kept and grown", " and grown");
      seen.push(getSnapshot().thinking);
      onToken("Sure.", "Sure.");
      return { content: "Sure.", streamed: true };
    });
    await ensureHydrated();
    await send("hi", SPEAKER);
    expect(seen).toEqual(["kept and grown"]);
  });

  it("does not leave live thinking state behind when the turn fails outright", async () => {
    streamMock.fn.mockImplementation(async ({ onAttempt, onReasoning, onToken }: any) => {
      onAttempt?.({ round: 1, target: "t0" });
      onReasoning?.("thinking hard", "thinking hard");
      onToken("half an answer", "half an answer");
      throw new Error("boom");
    });
    await ensureHydrated();
    await send("hi", SPEAKER);
    expect(getSnapshot().thinking).toBe("");
    expect(getSnapshot().toolEvents).toEqual([]);
    expect(getSnapshot().streaming).toBe(false);
    // The failure copy is a fresh row and carries nothing volatile.
    const err = getSnapshot().messages.find((m) => m.errorFor);
    expect("thinking" in err!).toBe(false);
    expect("toolEvents" in err!).toBe(false);
  });
});

// An adjustment and a redemption can share a member AND a reason while being two
// separate things for two separate people to confirm with their PINs. Dedupe is
// per-tool for exactly that reason: one key for both shapes would silently drop
// the redemption from a turn that proposed both, and the family would be told a
// reward awaits confirmation that no chip ever offered.
describe("chat-store — inert proposals dedupe per tool", () => {
  const ADJUST = {
    tool: "adjust_points" as const,
    operationId: "op-adjust-1",
    args: { member: "Emily G", delta: 5, reason: "great week" },
  };
  const REDEEM = {
    tool: "redeem_reward" as const,
    operationId: "op-redeem-1",
    args: { member: "Emily G", rewardId: "7", reward: "Movie night", cost: 25, reason: "great week" },
  };

  /** The buffered path and the streamed path both funnel through attachProposal. */
  async function sendProposals(proposals: unknown[], via: "buffered" | "streamed") {
    if (via === "buffered") {
      streamMock.fn.mockResolvedValue({ content: "Two things to confirm", streamed: false, proposals });
    } else {
      streamMock.fn.mockImplementation(async ({ onStatus, onToken }: any) => {
        for (const proposal of proposals) {
          onStatus("Working…", { label: "Working…", proposal });
        }
        onToken("Two things to confirm", "Two things to confirm");
        return { content: "Two things to confirm", streamed: true };
      });
    }
    await ensureHydrated();
    await send("Emily earned movie night", SPEAKER);
    return assistantBubbles().at(-1)!.proposals ?? [];
  }

  it("keeps an adjustment AND a redemption that share a member and a reason", async () => {
    for (const via of ["buffered", "streamed"] as const) {
      __resetChatStoreForTests();
      const attached = await sendProposals([ADJUST, REDEEM], via);
      expect(attached.map((p) => p.tool)).toEqual(["adjust_points", "redeem_reward"]);
    }
  });

  it("still collapses a TRUE duplicate of the same proposal", async () => {
    // The per-tool key must not become a no-op: the same redemption offered
    // twice in one turn is one thing to confirm, and two chips for it would ask
    // the family for the same PIN twice.
    const attached = await sendProposals([REDEEM, { ...REDEEM, operationId: "op-redeem-2" }], "streamed");
    expect(attached).toHaveLength(1);
    expect(attached[0].operationId).toBe("op-redeem-1");
  });
});
