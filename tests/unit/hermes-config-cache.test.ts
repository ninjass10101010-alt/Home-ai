import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  buildToolsForOpenAI: vi.fn(() => []),
  getTool: vi.fn(() => undefined),
  insertChatMessage: vi.fn(async () => ({})),
  resolveChatTargets: vi.fn(async () => [
    { url: "http://brain.local", key: "test-key", model: "test-model", provider: "test", fallback: false },
  ]),
  resetAiTargetsForTests: vi.fn(),
}));

// A conversation needs a verified LIVE identity to write the thread; a bare
// `{message}` with no cookie is the internal, non-conversational completion.
vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/hermes-tools", () => ({
  buildToolsForOpenAI: mocks.buildToolsForOpenAI,
  getTool: mocks.getTool,
}));
vi.mock("@/lib/ai/targets", () => ({
  resolveChatTargets: mocks.resolveChatTargets,
  resetAiTargetsForTests: mocks.resetAiTargetsForTests,
}));
vi.mock("@/db", () => ({ db: { insertChatMessage: mocks.insertChatMessage } }));

import { POST, resetAiChatForTests } from "@/app/api/hermes/chat/route";

function hermesReply(content = "ok") {
  const enc = new TextEncoder();
  const frame = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(frame));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A streamed family-thread turn, signed in as a live parent. */
async function post(message: string) {
  const { signSession, SESSION_COOKIE } = await import("@/lib/session");
  const cookie = `${SESSION_COOKIE}=${await signSession({ memberId: "m1", name: "Rebecca", role: "parent" })}`;
  return POST(
    new NextRequest("http://localhost/api/hermes/chat", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ message, stream: true }),
    })
  ).then(async (res) => {
    // Drain the SSE body so the route's async loop (the provider call and the
    // persist decision) has finished before the assertions read the mocks.
    await res.text();
    return res;
  });
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  mocks.withAdmin.mockReset().mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) =>
    fn({
      collection: () => ({
        getOne: async (id: string) => {
          if (id !== "m1") throw Object.assign(new Error("not found"), { status: 404 });
          return { id: "m1", name: "Rebecca", role: "parent" };
        },
      }),
    }),
  );
  resetAiChatForTests();
  mocks.resolveChatTargets.mockClear();
  mocks.insertChatMessage.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => hermesReply()));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("hermes chat — target resolution + resilience", () => {
  it("calls resolveChatTargets exactly once per message — the resolver owns cross-message caching", async () => {
    // The 10-minute TTL cache lives inside resolveChatTargets (covered in
    // ai-targets.test.ts); the route resolves the chain once per request and
    // never re-reads per tool round or fallback attempt.
    await post("one");
    await post("two");
    expect(mocks.resolveChatTargets).toHaveBeenCalledTimes(2);
  });

  it("still resolves on every message after the old 10-minute TTL window — no route-level cache remains to go stale", async () => {
    await post("one");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await post("two");
    vi.useRealTimers();
    expect(mocks.resolveChatTargets).toHaveBeenCalledTimes(2);
  });

  it("sends an AbortSignal timeout on every AI call", async () => {
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
