// The assistant-path authorization invariant: a session's LIVE role must ride
// every tool call as `caller.role`, on BOTH the streamed and the buffered path.
//
// `hermes-chat-role.test.ts` pins the TOOL LIST (which tools a role may see) —
// not the caller. The caller is the half that actually decides whether a task
// command is allowed to move anything, so it gets its own suite that drives
// the real route and captures the context object the route hands each handler.
//
// pet is the sharp case: `pet` is a real roster role that is NOT an adult, so
// it must FOLD to the child caller rather than ride through as itself.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

type HandedCaller = {
  source: string;
  caller: { memberId: string; name: string; role: string };
};

const mocks = vi.hoisted(() => ({
  buildToolsForOpenAI: vi.fn(() => []),
  getTool: vi.fn((): unknown => undefined),
  insertChatMessage: vi.fn(async () => ({})),
  resolveChatTargets: vi.fn(async () => [testTarget()]),
  resetAiTargetsForTests: vi.fn(),
  buildMemoryContext: vi.fn(async () => ""),
  requireLiveSession: vi.fn(),
  authorizeCurrentMemberRequest: vi.fn(),
  recordChatOutcome: vi.fn(),
  handler: vi.fn(async (_args: Record<string, unknown>, _context?: unknown) => '{"ok":true}'),
}));

vi.mock("@/lib/server-auth", () => ({
  readSessionCookie: (request: Request) =>
    request.headers.get("cookie")?.match(/consuela_session=([^;]+)/)?.[1],
  requireLiveSession: mocks.requireLiveSession,
  // The conversational writer path resolves its identity through this helper.
  // Stubbed the same way as requireLiveSession above; the LIVE-vs-cookie drift
  // and the fail-closed outage are covered by chat-live-role-authority.test.ts.
  authorizeCurrentMemberRequest: mocks.authorizeCurrentMemberRequest,
}));

vi.mock("@/lib/hermes-tools", () => ({
  buildToolsForOpenAI: mocks.buildToolsForOpenAI,
  getTool: mocks.getTool,
}));

vi.mock("@/lib/family-memory", () => ({ buildMemoryContext: mocks.buildMemoryContext }));
vi.mock("@/lib/ai/targets", () => ({
  resolveChatTargets: mocks.resolveChatTargets,
  resetAiTargetsForTests: mocks.resetAiTargetsForTests,
}));
vi.mock("@/db", () => ({ db: { insertChatMessage: mocks.insertChatMessage } }));
vi.mock("@/lib/ai/health", () => ({ recordChatOutcome: mocks.recordChatOutcome }));

import { POST, resetAiChatForTests } from "@/app/api/hermes/chat/route";
import type { AiTarget } from "@/lib/ai/targets";
import { signSession, SESSION_COOKIE } from "@/lib/session";

function testTarget(over: Partial<AiTarget> = {}): AiTarget {
  return { url: "http://brain.local", key: "test-key", model: "test-model", provider: "test", fallback: false, ...over };
}

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

const DONE = "data: [DONE]\n\n";
const token = (t: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;
const toolCallRound = (id: string, name: string, args: string) =>
  [
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: "" } }] } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args } }] } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
    DONE,
  ].join("");
const bufferedToolCall = (id: string, name: string, args: string) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name, arguments: args } }] } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
const bufferedText = (t: string) =>
  new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: t } }] }), { status: 200 });

async function post(body: Record<string, unknown>, cookie?: string) {
  return POST(
    new NextRequest("http://localhost/api/hermes/chat", {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

const cookieFor = async (memberId: string, name: string, role: "parent" | "child" | "pet") =>
  `${SESSION_COOKIE}=${await signSession({ memberId, name, role })}`;

/** The single context the route handed the tool handler. */
const handedContext = (): HandedCaller => {
  expect(mocks.handler).toHaveBeenCalledTimes(1);
  return mocks.handler.mock.calls[0][1] as HandedCaller;
};

async function beforeTest() {
  resetAiChatForTests();
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  mocks.buildToolsForOpenAI.mockReset().mockReturnValue([
    { type: "function", function: { name: "get_pending_tasks", parameters: {} } },
  ] as any);
  mocks.getTool.mockReset().mockReturnValue({ handler: mocks.handler });
  mocks.insertChatMessage.mockClear();
  mocks.buildMemoryContext.mockClear().mockResolvedValue("");
  mocks.handler.mockClear();
  mocks.recordChatOutcome.mockClear();
  mocks.resolveChatTargets.mockReset().mockImplementation(async () => [testTarget()]);
  const { verifySession } = await import("@/lib/session");
  const liveIdentity = async (request: Request) => {
    const token = request.headers.get("cookie")?.match(/consuela_session=([^;]+)/)?.[1];
    return verifySession(token);
  };
  mocks.requireLiveSession.mockReset().mockImplementation(async (request: Request) => {
    const signed = await liveIdentity(request);
    if (!signed) return { ok: false as const, status: 401 as const, error: "unauthorized" as const };
    return { ok: true as const, identity: { memberId: signed.memberId, name: signed.name, role: signed.role } };
  });
  mocks.authorizeCurrentMemberRequest.mockReset().mockImplementation(async (request: Request) => {
    const signed = await liveIdentity(request);
    if (!signed) return { ok: false as const, status: 401 as const, error: "unauthorized" as const };
    return {
      ok: true as const,
      member: { id: signed.memberId, name: signed.name, role: signed.role },
      session: signed,
    };
  });
}

beforeEach(beforeTest);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("hermes chat — the caller identity rides every tool call (buffered)", () => {
  it("a child session hands the tool a child caller", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => bufferedToolCall("c1", "get_pending_tasks", "{}"))
      .mockImplementationOnce(async () => bufferedText("All done.")));
    const res = await post({ message: "what's left?" }, await cookieFor("mem-emily", "Emily", "child"));
    expect(res.status).toBe(200);
    expect(handedContext()).toEqual({
      source: "hermes",
      caller: { memberId: "mem-emily", name: "Emily", role: "child" },
    });
  });

  it("a PET session folds to a child caller", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => bufferedToolCall("c1", "get_pending_tasks", "{}"))
      .mockImplementationOnce(async () => bufferedText("Woof.")));
    const res = await post({ message: "what's left?" }, await cookieFor("mem-rocco", "Rocco", "pet"));
    expect(res.status).toBe(200);
    const context = handedContext();
    expect(context.caller.role).toBe("child");
    expect(context.caller.role).not.toBe("pet");
    expect(context.caller).toMatchObject({ memberId: "mem-rocco", name: "Rocco" });
  });

  it("a parent session hands the tool a parent caller", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => bufferedToolCall("c1", "get_pending_tasks", "{}"))
      .mockImplementationOnce(async () => bufferedText("Two left.")));
    const res = await post({ message: "what's left?" }, await cookieFor("mem-dad", "Dad", "parent"));
    expect(res.status).toBe(200);
    expect(handedContext()).toEqual({
      source: "hermes",
      caller: { memberId: "mem-dad", name: "Dad", role: "parent" },
    });
  });
});

describe("hermes chat — the caller identity rides every tool call (streamed)", () => {
  it("a child session hands the tool a child caller", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => sseResponse([toolCallRound("c1", "get_pending_tasks", "{}")]))
      .mockImplementationOnce(async () => sseResponse([token("Nothing left."), DONE])));
    const res = await post({ message: "what's left?", stream: true }, await cookieFor("mem-emily", "Emily", "child"));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    await res.text();
    expect(handedContext()).toEqual({
      source: "hermes",
      caller: { memberId: "mem-emily", name: "Emily", role: "child" },
    });
  });

  it("a PET session folds to a child caller", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => sseResponse([toolCallRound("c1", "get_pending_tasks", "{}")]))
      .mockImplementationOnce(async () => sseResponse([token("Woof!"), DONE])));
    const res = await post({ message: "what's left?", stream: true }, await cookieFor("mem-rocco", "Rocco", "pet"));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    await res.text();
    const context = handedContext();
    expect(context.caller.role).toBe("child");
    expect(context.caller.role).not.toBe("pet");
    expect(context.caller).toMatchObject({ memberId: "mem-rocco", name: "Rocco" });
  });

  it("a parent session hands the tool a parent caller", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => sseResponse([toolCallRound("c1", "get_pending_tasks", "{}")]))
      .mockImplementationOnce(async () => sseResponse([token("Two left."), DONE])));
    const res = await post({ message: "what's left?", stream: true }, await cookieFor("mem-dad", "Dad", "parent"));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    await res.text();
    expect(handedContext()).toEqual({
      source: "hermes",
      caller: { memberId: "mem-dad", name: "Dad", role: "parent" },
    });
  });
});
