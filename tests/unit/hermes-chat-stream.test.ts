import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  buildToolsForOpenAI: vi.fn(() => []),
  getTool: vi.fn(
    (_name: string): { handler: (args: Record<string, any>) => Promise<string> } | undefined => undefined,
  ),
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
    let aYieldedEarly = false;
    const handlerA = vi.fn(async () => {
      const deadline = Date.now() + 500;
      while (!bStarted && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
      // true only when B ran while A was still waiting — impossible if the
      // handlers were awaited sequentially.
      aYieldedEarly = bStarted;
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
    expect(aYieldedEarly).toBe(true);
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
