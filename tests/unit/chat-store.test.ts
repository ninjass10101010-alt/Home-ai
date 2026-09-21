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
} from "@/lib/chat-store";

const SPEAKER = { name: "Rebecca", emoji: "🐱" };

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

  it("writes an honest error bubble with errorFor when the stream fails", async () => {
    streamMock.fn.mockRejectedValue(new Error("boom"));
    await ensureHydrated();
    await send("hi", SPEAKER);
    const err = getSnapshot().messages.find((m) => m.errorFor);
    expect(err).toBeTruthy();
    expect(err!.errorFor).toBe("hi");
    expect(err!.content).toContain("family server");
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

  it("persists hydrated history to localStorage without the seed greeting", async () => {
    streamMock.fn.mockResolvedValue({ content: "saved-reply", streamed: true });
    await ensureHydrated();
    await send("hi", SPEAKER);
    const stored = JSON.parse(localStorage.getItem("consuela-chat-messages")!);
    expect(stored.some((m: any) => m.content === "saved-reply")).toBe(true);
    expect(stored.some((m: any) => m.id === 1)).toBe(false);
  });
});
