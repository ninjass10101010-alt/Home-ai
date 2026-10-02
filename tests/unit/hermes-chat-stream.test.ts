import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  buildToolsForOpenAI: vi.fn(() => []),
  getTool: vi.fn(
    (_name: string): { handler: (args: Record<string, any>) => Promise<string> } | undefined => undefined,
  ),
  insertChatMessage: vi.fn(async () => ({})),
  resolveChatTargets: vi.fn(async () => [
    { url: "http://brain.local", key: "test-key", model: "test-model", provider: "test", fallback: false },
  ]),
  resetAiTargetsForTests: vi.fn(),
  recordChatOutcome: vi.fn(),
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
vi.mock("@/lib/ai/health", () => ({ recordChatOutcome: mocks.recordChatOutcome }));

import { POST, resetAiChatForTests } from "@/app/api/hermes/chat/route";
import { parseSSEFrames, type SSEFrame } from "@/lib/chat-stream";

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
const reasoningToken = (t: string) => `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: t } }] })}\n\n`;
const DONE = "data: [DONE]\n\n";
// `id: undefined` is dropped by JSON.stringify — that is the real shape of a
// gateway that omits ids on stream deltas, not a test artifact.
const toolCallRound = (id: string | undefined, name: string, args: string, index = 0) => [
  `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index, id, function: { name, arguments: "" } }] } }] })}\n\n`,
  `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index, function: { arguments: args } }] } }] })}\n\n`,
  `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
  DONE,
].join("");

async function post(body: Record<string, unknown>, signal?: AbortSignal) {
  return POST(
    new NextRequest("http://localhost/api/hermes/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    })
  );
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  resetAiChatForTests();
  mocks.resolveChatTargets.mockReset().mockResolvedValue([
    { url: "http://brain.local", key: "test-key", model: "test-model", provider: "test", fallback: false },
  ]);
  mocks.insertChatMessage.mockClear();
  mocks.recordChatOutcome.mockClear();
  mocks.getTool.mockReset().mockReturnValue(undefined);
  mocks.buildToolsForOpenAI.mockReset().mockReturnValue([]);
});

afterEach(() => {
  vi.useRealTimers();
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
    // The route only executes tools in the session allowlist — declare it.
    mocks.buildToolsForOpenAI.mockReturnValue([
      { type: "function", function: { name: "get_pantry", parameters: {} } },
    ] as any);
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
    // The route only executes tools in the session allowlist — declare both.
    mocks.buildToolsForOpenAI.mockReturnValue([
      { type: "function", function: { name: "get_pantry", parameters: {} } },
      { type: "function", function: { name: "get_grocery_list", parameters: {} } },
    ] as any);
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

  // Wrap-up contract (2026-09-16): MAX_ROUNDS is 6 and the FINAL round is a
  // forced tool-free "answer now" call — a model that keeps tool-chaining must
  // be forced to summarize what it already gathered instead of the family
  // seeing the bare "ran out of steps" fallback on every broad question.
  it("forces a tool-free wrap-up answer on the final round", async () => {
    mocks.getTool.mockReturnValue({ handler: vi.fn(async () => '{"ok":true}') });
    mocks.buildToolsForOpenAI.mockReturnValue([
      { type: "function", function: { name: "get_pantry", parameters: {} } },
    ] as any);
    const fetchMock = vi.fn();
    // Rounds 0-4: the model keeps demanding a tool lookup.
    for (let i = 0; i < 5; i++) {
      fetchMock.mockImplementationOnce(async () => sseResponse([toolCallRound("c1", "get_pantry", "{}")]));
    }
    // Round 5 (the wrap-up): the model finally answers.
    fetchMock.mockImplementationOnce(async () => sseResponse([token("Here's the final rundown."), DONE]));
    vi.stubGlobal("fetch", fetchMock);
    const res = await post({ message: "dig into everything", stream: true });
    const body = await res.text();
    expect(body).toContain('data: {"t":"Here\'s the final rundown."}');
    expect(body).not.toContain("ran out of steps");
    expect(fetchMock).toHaveBeenCalledTimes(6);
    // The wrap-up call must NOT offer tools (forces a content answer) and must
    // carry the "answer now" system note.
    const wrapupBody = JSON.parse(fetchMock.mock.calls[5][1].body);
    expect("tools" in wrapupBody).toBe(false);
    expect("tool_choice" in wrapupBody).toBe(false);
    expect(
      wrapupBody.messages.some((m: any) => m.role === "system" && /all your research steps/.test(m.content))
    ).toBe(true);
    // The wrap-up answer — not the exhaustion text — is what persists.
    const assistantRow = mocks.insertChatMessage.mock.calls
      .map((c: any[]) => c[0])
      .find((r: any) => r.role === "assistant");
    expect(assistantRow?.content).toBe("Here's the final rundown.");
  });

  it("streams the exhaustion message ONLY when even the wrap-up round fails", async () => {
    // Every round — including the tool-free wrap-up — comes back with no
    // content. The synthesized fallback must reach the client as a token frame
    // (not just the DB) so the live view matches the persisted thread.
    const handler = vi.fn(async () => '{"ok":true}');
    mocks.getTool.mockReturnValue({ handler });
    mocks.buildToolsForOpenAI.mockReturnValue([
      { type: "function", function: { name: "get_pantry", parameters: {} } },
    ] as any);
    const fetchMock = vi.fn(async () => sseResponse([toolCallRound("c1", "get_pantry", "{}")]));
    vi.stubGlobal("fetch", fetchMock);
    const res = await post({ message: "keep going", stream: true });
    const body = await res.text();
    const exhaustion = "I kept needing to look things up and ran out of steps — give me a moment and try again! 🔧";
    const frame = `data: ${JSON.stringify({ t: exhaustion })}`;
    expect(body).toContain(frame);
    expect(body.indexOf(frame)).toBeLessThan(body.indexOf("data: [DONE]"));
    expect(fetchMock).toHaveBeenCalledTimes(6);
    // 5 tool rounds ran the handler; round 6's tool_calls must NOT execute —
    // the wrap-up offered no tools, so it must never run them either.
    expect(handler).toHaveBeenCalledTimes(5);
    const wrapupBody = JSON.parse(((fetchMock.mock.calls as any[])[5] as any[])[1].body as string);
    expect("tools" in wrapupBody).toBe(false);
    expect(
      wrapupBody.messages.some((m: any) => m.role === "system" && /all your research steps/.test(m.content))
    ).toBe(true);
    const assistantRow = mocks.insertChatMessage.mock.calls
      .map((c: any[]) => c[0])
      .find((r: any) => r.role === "assistant");
    expect(assistantRow?.content).toBe(exhaustion);
  });

  // Reasoning models (glm-5.3-flash) stream `reasoning_content` deltas BEFORE
  // any content. With a tight token budget the reasoning can consume the whole
  // round → zero content, zero tool_calls. That empty round must (a) announce
  // "Thinking deeply…" as a status frame so the client isn't showing dead
  // dots, (b) NOT be treated as a completed answer (the old bug surfaced the
  // misleading "ran out of steps" text), and (c) fail over to the next target.
  it("announces reasoning as a status frame and fails over when a round answers empty", async () => {
    mocks.resolveChatTargets.mockResolvedValue([
      { url: "http://brain.local", key: "k1", model: "reasoner", provider: "p1", fallback: false },
      { url: "http://backup.local", key: "k2", model: "backup", provider: "p2", fallback: true },
    ]);
    const reasoningOnlyRound = [
      reasoningToken("The"), reasoningToken(" user"), reasoningToken(" wants"),
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] })}\n\n`,
      DONE,
    ].join("");
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => sseResponse([reasoningOnlyRound]))
      // fallback targets stream BUFFERED (JSON, not SSE) — emulate the real shape
      .mockImplementationOnce(async () => new Response(
        JSON.stringify({ choices: [{ message: { content: "Here's the story." } }] }),
        { status: 200, headers: { "content-type": "application/json" } })));
    const res = await post({ message: "write a story", stream: true });
    const body = await res.text();
    expect(body).toContain("event: status");
    expect(body).toContain("Thinking deeply");
    expect(body).toContain('data: {"t":"Here\'s the story."}');
    expect(body).not.toContain("ran out of steps");
    // the fallback target actually got tried
    expect((globalThis.fetch as any).mock.calls[1][0]).toContain("backup.local");
  });

  it("emits the honest snag error when every target answers empty", async () => {
    const reasoningOnlyRound = [
      reasoningToken("Hmm"), `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] })}\n\n`, DONE,
    ].join("");
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([reasoningOnlyRound])));
    const res = await post({ message: "write a story", stream: true });
    const body = await res.text();
    expect(body).toContain("event: error");
    expect(body).not.toContain("ran out of steps");
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
  });

  it("gives reasoning models a workable token budget", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([token("ok"), DONE])));
    const res = await post({ message: "hi", stream: true });
    await res.text();
    const providerBody = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(providerBody.max_tokens).toBeGreaterThanOrEqual(3000);
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

  it("buffered mode forces the same tool-free wrap-up on the final round", async () => {
    mocks.getTool.mockReturnValue({ handler: vi.fn(async () => '{"ok":true}') });
    mocks.buildToolsForOpenAI.mockReturnValue([
      { type: "function", function: { name: "get_pantry", parameters: {} } },
    ] as any);
    const bufferedToolRound = () => new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "", tool_calls: [
          { id: "c1", type: "function", function: { name: "get_pantry", arguments: "{}" } },
        ] } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } });
    const fetchMock = vi.fn();
    for (let i = 0; i < 5; i++) fetchMock.mockImplementationOnce(async () => bufferedToolRound());
    fetchMock.mockImplementationOnce(async () => new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content: "Buffered final answer." } }] }),
      { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await post({ message: "dig into everything" });
    const json = await res.json();
    expect(json.content).toBe("Buffered final answer.");
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const wrapupBody = JSON.parse(fetchMock.mock.calls[5][1].body);
    expect("tools" in wrapupBody).toBe(false);
    expect("tool_choice" in wrapupBody).toBe(false);
    expect(
      wrapupBody.messages.some((m: any) => m.role === "system" && /all your research steps/.test(m.content))
    ).toBe(true);
  });
});

// AI Health wiring (2026-09-16): every chat request records ONE structured
// outcome (metadata only — never message content) so Settings → AI Models can
// tell "step exhaustion" apart from "LLM timeout" apart from "client gone".
describe("hermes chat — health outcome recording", () => {
  it("records outcome=ok with rounds + brain for a clean streamed answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([token("ok"), DONE])));
    await (await post({ message: "hi", stream: true })).text();
    expect(mocks.recordChatOutcome).toHaveBeenCalledTimes(1);
    const rec = mocks.recordChatOutcome.mock.calls[0][0];
    expect(rec.outcome).toBe("ok");
    expect(rec.rounds).toBe(1);
    expect(rec.brain).toBe("test/test-model");
    expect(rec.targets).toBe(1);
    expect(typeof rec.ms).toBe("number");
    expect(rec.message).toBeUndefined(); // never message content
  });

  it("records outcome=wrapup when the forced final round saves the answer", async () => {
    mocks.getTool.mockReturnValue({ handler: vi.fn(async () => '{"ok":true}') });
    mocks.buildToolsForOpenAI.mockReturnValue([
      { type: "function", function: { name: "get_pantry", parameters: {} } },
    ] as any);
    const fetchMock = vi.fn();
    for (let i = 0; i < 5; i++) {
      fetchMock.mockImplementationOnce(async () => sseResponse([toolCallRound("c1", "get_pantry", "{}")]));
    }
    fetchMock.mockImplementationOnce(async () => sseResponse([token("Wrapped up."), DONE]));
    vi.stubGlobal("fetch", fetchMock);
    await (await post({ message: "dig", stream: true })).text();
    const rec = mocks.recordChatOutcome.mock.calls[0][0];
    expect(rec.outcome).toBe("wrapup");
    expect(rec.rounds).toBe(6);
  });

  it("records outcome=exhausted when even the wrap-up round fails", async () => {
    mocks.getTool.mockReturnValue({ handler: vi.fn(async () => '{"ok":true}') });
    mocks.buildToolsForOpenAI.mockReturnValue([
      { type: "function", function: { name: "get_pantry", parameters: {} } },
    ] as any);
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([toolCallRound("c1", "get_pantry", "{}")])));
    await (await post({ message: "keep going", stream: true })).text();
    const rec = mocks.recordChatOutcome.mock.calls[0][0];
    expect(rec.outcome).toBe("exhausted");
    expect(rec.rounds).toBe(6);
  });

  it("records outcome=snag with the failure reason when every target fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new Error("aborted"), { name: "TimeoutError" }); }));
    await (await post({ message: "hi", stream: true })).text();
    const rec = mocks.recordChatOutcome.mock.calls[0][0];
    expect(rec.outcome).toBe("snag");
    expect(rec.reason).toBeTruthy();
  });

  it("records outcome=unconfigured when the target chain is empty", async () => {
    mocks.resolveChatTargets.mockResolvedValue([]);
    await (await post({ message: "hi", stream: true })).text();
    const rec = mocks.recordChatOutcome.mock.calls[0][0];
    expect(rec.outcome).toBe("unconfigured");
    expect(rec.targets).toBe(0);
  });

  it("records outcome=client_gone when the client drops the stream mid-flight", async () => {
    // Hand-controlled LLM stream: emit one token, wait for the client to drop
    // the response, then emit another token + DONE — the route's write() of
    // that second token rejects, which is exactly the client_gone signal.
    let emitNext: ((c: string) => void) | null = null;
    let resolveDone: (() => void) | null = null;
    const llmStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        emitNext = (s) => controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: s } }] })}\n\n`));
        resolveDone = () => { controller.enqueue(enc.encode("data: [DONE]\n\n")); controller.close(); };
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(llmStream, { status: 200, headers: { "content-type": "text/event-stream" } })));
    const res = await post({ message: "hi", stream: true });
    const reader = res.body!.getReader();
    const firstFrame = (async () => {
      emitNext!("Hel");
      const decoder = new TextDecoder();
      let seen = "";
      // Frames arrive one per write(), and the attempt frame is announced before
      // this turn's first token — read until the token itself lands.
      const deadline = Date.now() + 1000;
      while (!seen.includes('"t":"Hel"') && Date.now() < deadline) {
        const { value } = await reader.read();
        if (!value) break;
        seen += decoder.decode(value);
      }
      return seen;
    })();
    expect(await firstFrame).toContain('"t":"Hel"');
    await reader.cancel(); // client is gone
    // Route now tries to write the next token to a dead channel, then finishes.
    emitNext!("lo");
    resolveDone!();
    // Let the route's microtask queue drain so the outcome has been recorded.
    await new Promise((r) => setTimeout(r, 60));
    expect(mocks.recordChatOutcome).toHaveBeenCalledTimes(1);
    expect(mocks.recordChatOutcome.mock.calls[0][0].outcome).toBe("client_gone");
  });

  it("buffered path records outcome=ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content: "plain" } }] }),
      { status: 200, headers: { "content-type": "application/json" } })));
    await post({ message: "hi" });
    const rec = mocks.recordChatOutcome.mock.calls[0][0];
    expect(rec.outcome).toBe("ok");
    expect(rec.rounds).toBe(1);
  });
});
// Task 15 — the chat route must surface a propose_point_adjustment RESULT as
// an extra `event: status` frame carrying {label, proposal} (streamed) and a
// top-level `proposals:[…]` array (buffered), so the chat page can render the
// parent-PIN confirm chip on BOTH paths. The handler itself is inert.
describe("hermes chat — point-proposal surfacing", () => {
  const PROPOSAL_JSON = JSON.stringify({
    ok: true,
    proposal: { tool: "adjust_points", args: { member: "Emily G", delta: 10, reason: "helped" } },
    message: "Ask the parent to confirm with their PIN.",
  });

  it("streams an extra status frame with the proposal after the tool round", async () => {
    mocks.getTool.mockImplementation((name: string) =>
      name === "propose_point_adjustment" ? { handler: vi.fn(async () => PROPOSAL_JSON) } : undefined);
    mocks.buildToolsForOpenAI.mockReturnValue([
      { type: "function", function: { name: "propose_point_adjustment", parameters: {} } },
    ] as any);
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => sseResponse([toolCallRound("c1", "propose_point_adjustment", '{"member":"Emily","delta":10,"reason":"helped"}')]))
      .mockImplementationOnce(async () => sseResponse([token("Tap Confirm below."), DONE])));
    const res = await post({ message: "add 10 points to Emily", stream: true });
    const body = await res.text();
    const proposalFrames = body
      .split("event: status")
      .slice(1)
      .filter((chunk) => chunk.includes('"proposal"'));
    expect(proposalFrames.length).toBe(1);
    const frameData = /data: (\{[^\n]*\})/.exec(proposalFrames[0])![1];
    expect(JSON.parse(frameData).proposal).toEqual({
      tool: "adjust_points",
      args: { member: "Emily G", delta: 10, reason: "helped" },
    });
  });

  it("refusals (ok:false / no proposal) never grow a proposal frame", async () => {
    mocks.getTool.mockImplementation((name: string) =>
      name === "propose_point_adjustment" ? { handler: vi.fn(async () => '{"ok":false,"error":"unknown member"}') } : undefined);
    mocks.buildToolsForOpenAI.mockReturnValue([
      { type: "function", function: { name: "propose_point_adjustment", parameters: {} } },
    ] as any);
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => sseResponse([toolCallRound("c1", "propose_point_adjustment", "{}")]))
      .mockImplementationOnce(async () => sseResponse([token("Nope."), DONE])));
    const res = await post({ message: "add points to Zoe", stream: true });
    const body = await res.text();
    expect(body).not.toContain('"proposal"');
  });

  it("buffered mode includes a top-level proposals array", async () => {
    mocks.getTool.mockImplementation((name: string) =>
      name === "propose_point_adjustment" ? { handler: vi.fn(async () => PROPOSAL_JSON) } : undefined);
    mocks.buildToolsForOpenAI.mockReturnValue([
      { type: "function", function: { name: "propose_point_adjustment", parameters: {} } },
    ] as any);
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "", tool_calls: [
            { id: "c1", type: "function", function: { name: "propose_point_adjustment", arguments: '{"member":"Emily"}' } },
          ] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }))
      .mockImplementationOnce(async () => new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content: "A parent can confirm below." } }] }),
        { status: 200, headers: { "content-type": "application/json" } })));
    const res = await post({ message: "add 10 points to Emily" });
    const json = await res.json();
    expect(json.content).toBe("A parent can confirm below.");
    expect(json.proposals).toEqual([
      { tool: "adjust_points", args: { member: "Emily G", delta: 10, reason: "helped" } },
    ]);
  });

  it("buffered mode without proposals keeps the plain {content} shape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content: "plain" } }] }),
      { status: 200, headers: { "content-type": "application/json" } })));
    const res = await post({ message: "hi" });
    const json = await res.json();
    expect(json.content).toBe("plain");
    expect("proposals" in json).toBe(false);
  });
});

// Why the heartbeat exists, see `handleStreamedChat`'s `heartbeat` in route.ts.
describe("hermes chat — SSE heartbeat", () => {
  const HEARTBEAT_MS = 15_000;

  function silentProvider() {
    const enc = new TextEncoder();
    let emit: ((s: string) => void) | null = null;
    let finish: (() => void) | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        emit = (s) => controller.enqueue(enc.encode(token(s)));
        finish = () => { controller.enqueue(enc.encode(DONE)); controller.close(); };
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    })));
    return { emit: (s: string) => emit!(s), finish: () => finish!() };
  }

  it("emits a comment frame every 15s during a silent think, and stops with the stream", async () => {
    vi.useFakeTimers();
    const timersBefore = vi.getTimerCount();
    const provider = silentProvider();
    const res = await post({ message: "hi", stream: true });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let seen = "";
    let closed = false;
    const pump = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) { closed = true; return; }
          seen += decoder.decode(value);
        }
      } catch { /* reader cancelled */ }
    })();
    const pings = () => seen.split(": ping\n\n").length - 1;

    // Silent for a full heartbeat interval: the only bytes that can appear are
    // the heartbeat's own.
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(seen).toContain(": ping");
    expect(pings()).toBe(1);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(pings()).toBe(2);

    provider.emit("Finally.");
    provider.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toContain('data: {"t":"Finally."}');
    expect(seen).toContain("data: [DONE]");
    // Bound the drain: those two frames were already enqueued by write() before
    // the finally block, so only writer.close() ends the read loop.
    await Promise.race([pump, vi.advanceTimersByTimeAsync(1)]);
    expect(closed).toBe(true);
    // The interval dies with the stream: no extra frame, nothing left pending.
    expect(pings()).toBe(2);
    expect(vi.getTimerCount() - timersBefore).toBe(0);
  });

  it("marks the streamed response as unbuffered", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([token("ok"), DONE])));
    const res = await post({ message: "hi", stream: true });
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    await res.text();
  });
});

// Strict OpenAI-compatible servers validate the round-2 request: a
// `role:"tool"` message's tool_call_id must match an id on the PRECEDING
// assistant entry, and each assistant `tool_calls[]` entry needs a `type` beside
// its id. `normalizeToolCallIds` in route.ts is the single site that guarantees
// both, so these read what the provider actually received.
describe("hermes chat — tool_calls echoed on the assistant message", () => {
  function allowPantryTool() {
    mocks.buildToolsForOpenAI.mockReturnValue([
      { type: "function", function: { name: "get_pantry", parameters: {} } },
    ] as any);
    mocks.getTool.mockReturnValue({ handler: vi.fn(async () => '{"ok":true}') });
  }
  const streamedAnswer = () => sseResponse([token("Pantry looks stocked."), DONE]);
  const bufferedAnswer = () => new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content: "Pantry looks stocked." } }] }),
    { status: 200, headers: { "content-type": "application/json" } });

  // The rejection lands on the SECOND provider request — the one carrying the
  // tool results — so every assertion reads what the provider actually got.
  function roundTwoMessages(): any[] {
    const calls = (globalThis.fetch as any).mock.calls;
    expect(calls.length).toBeGreaterThan(1);
    return JSON.parse(calls[1][1].body).messages;
  }

  function toolRound(messages: any[]) {
    const assistantIds: string[] = [];
    const callNames: string[] = [];
    const callTypes: string[] = [];
    for (const m of messages) {
      if (m.role !== "assistant" || !Array.isArray(m.tool_calls)) continue;
      for (const tc of m.tool_calls) {
        expect(typeof tc.id).toBe("string");
        expect(tc.id.length).toBeGreaterThan(0);
        expect(tc.type).toBe("function");
        assistantIds.push(tc.id);
        callNames.push(tc.function?.name);
        callTypes.push(tc.type);
      }
    }
    const toolMsgs = messages.filter((m: any) => m.role === "tool");
    expect(assistantIds.length).toBeGreaterThan(0);
    expect(toolMsgs).toHaveLength(assistantIds.length);
    return { assistantIds, toolMsgs, callNames, callTypes };
  }

  it("replies with the very id the assistant message carries when the provider omits ids", async () => {
    allowPantryTool();
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => sseResponse([toolCallRound(undefined, "get_pantry", "{}")]))
      .mockImplementationOnce(async () => streamedAnswer()));
    await (await post({ message: "whats low?", stream: true })).text();
    const { assistantIds, toolMsgs } = toolRound(roundTwoMessages());
    expect(assistantIds[0]).toMatch(/^call_\d+_0_/);
    expect(toolMsgs.map((m: any) => m.tool_call_id)).toEqual(assistantIds);
  });

  it("keeps a provider-supplied id identical on the assistant and tool entries", async () => {
    allowPantryTool();
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => sseResponse([toolCallRound("call_abc123", "get_pantry", "{}")]))
      .mockImplementationOnce(async () => streamedAnswer()));
    await (await post({ message: "whats low?", stream: true })).text();
    const { assistantIds, toolMsgs } = toolRound(roundTwoMessages());
    expect(assistantIds).toEqual(["call_abc123"]);
    expect(toolMsgs.map((m: any) => m.tool_call_id)).toEqual(["call_abc123"]);
  });

  it("gives two calls in one round distinct ids, each paired with its own result", async () => {
    mocks.buildToolsForOpenAI.mockReturnValue([
      { type: "function", function: { name: "get_pantry", parameters: {} } },
      { type: "function", function: { name: "get_grocery_list", parameters: {} } },
    ] as any);
    mocks.getTool.mockImplementation((name: string) => ({ handler: vi.fn(async () => `{"tool":"${name}"}`) }));
    const round = [
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [
        { index: 0, function: { name: "get_pantry", arguments: "{}" } },
        { index: 1, function: { name: "get_grocery_list", arguments: "{}" } },
      ] } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
      DONE,
    ].join("");
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => sseResponse([round]))
      .mockImplementationOnce(async () => streamedAnswer()));
    await (await post({ message: "check both", stream: true })).text();
    const { assistantIds, toolMsgs, callNames } = toolRound(roundTwoMessages());
    expect(assistantIds).toHaveLength(2);
    expect(new Set(assistantIds).size).toBe(2);
    expect(toolMsgs.map((m: any) => m.tool_call_id)).toEqual(assistantIds);
    expect(callNames).toEqual(["get_pantry", "get_grocery_list"]);
    expect(toolMsgs.map((m: any) => m.content)).toEqual(callNames.map((n: string) => `{"tool":"${n}"}`));
  });

  it("agrees on the ids in buffered mode too", async () => {
    allowPantryTool();
    const bufferedToolRound = () => new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "", tool_calls: [
          { type: "function", function: { name: "get_pantry", arguments: "{}" } },
        ] } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => bufferedToolRound())
      .mockImplementationOnce(async () => bufferedAnswer()));
    await post({ message: "whats low?" });
    const { assistantIds, toolMsgs } = toolRound(roundTwoMessages());
    expect(assistantIds[0]).toMatch(/^call_\d+_0_/);
    expect(toolMsgs.map((m: any) => m.tool_call_id)).toEqual(assistantIds);
  });

  it("forwards a buffered provider tool_call verbatim", async () => {
    allowPantryTool();
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "", tool_calls: [
            { id: "call_abc123", type: "function", function: { name: "get_pantry", arguments: "{}" } },
          ] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }))
      .mockImplementationOnce(async () => bufferedAnswer()));
    await post({ message: "whats low?" });
    const { assistantIds, toolMsgs, callTypes } = toolRound(roundTwoMessages());
    expect(assistantIds).toEqual(["call_abc123"]);
    expect(toolMsgs.map((m: any) => m.tool_call_id)).toEqual(["call_abc123"]);
    expect(callTypes).toEqual(["function"]);
  });

  it("passes a provider-supplied tool_call type through unchanged", async () => {
    allowPantryTool();
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "", tool_calls: [
            { id: "call_abc123", type: "provider_type", function: { name: "get_pantry", arguments: "{}" } },
          ] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }))
      .mockImplementationOnce(async () => bufferedAnswer()));
    await post({ message: "whats low?" });
    const assistant = roundTwoMessages().find((m: any) => m.role === "assistant" && Array.isArray(m.tool_calls));
    expect(assistant.tool_calls[0].type).toBe("provider_type");
  });
});

// Token frames are written from INSIDE callAiStream, so a superseded attempt's
// tokens are already in the client's bubble and cannot be retracted — while the
// route persists only the answering round. An `attempt` frame announced before
// every provider call (round × target) is what lets the client drop them, and
// it is the only signal that covers a mid-round target failover, where no round
// boundary exists at all. See the protocol block in src/lib/chat-stream.ts.
describe("hermes chat — attempt frames", () => {
  function frames(body: string): SSEFrame[] {
    return parseSSEFrames(body).frames;
  }
  function attemptFrames(body: string): SSEFrame[] {
    return frames(body).filter((f) => f.event === "attempt");
  }
  function attemptPositions(body: string): number[] {
    return frames(body).map((f, i) => (f.event === "attempt" ? i : -1)).filter((i) => i >= 0);
  }
  // `attempt:<target>` for attempt frames, `frame` for everything else — the
  // whole wire protocol as the client sees it, in order.
  function shape(body: string): string[] {
    return frames(body).map((f) =>
      f.event === "attempt" ? `attempt:${JSON.parse(f.data).target}` : "frame");
  }

  it("emits an attempt frame before each provider call", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([token("Hello"), DONE])));
    const body = await (await post({ message: "hi", stream: true })).text();
    expect(attemptFrames(body).map((f) => JSON.parse(f.data)))
      .toEqual([{ round: 1, target: "t0" }]);
    // Announced before its own tokens, or the reset arrives too late to matter.
    expect(shape(body)).toEqual(["attempt:t0", "frame", "frame"]);
  });

  // `/api/hermes/` is on the middleware API_EXEMPT list, so this route answers
  // with no session at all — for a child or a guest as much as for a parent.
  // The model id is parent-gated everywhere else it surfaces (providers GET,
  // health ring), so the frame carries a chain INDEX and never the model: the
  // index is all the client does with it, and a self-hosted model name can
  // leak an internal-looking string.
  it("identifies the target by chain index, never by model name", async () => {
    mocks.resolveChatTargets.mockResolvedValue([
      { url: "http://brain.local", key: "k1", model: "internal-llm-v3-pro", provider: "p1", fallback: false },
    ]);
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([token("Hello"), DONE])));
    const body = await (await post({ message: "hi", stream: true })).text();
    expect(attemptFrames(body).map((f) => JSON.parse(f.data).target)).toEqual(["t0"]);
    expect(body).not.toContain("internal-llm-v3-pro");
    // Whatever a parent typed into Settings must not ride a pre-auth surface.
    expect(body).not.toContain("test-model");
  });

  it("emits a second attempt frame when a target dies mid-round and the next answers", async () => {
    let reads = 0;
    mocks.resolveChatTargets.mockResolvedValue([
      { url: "http://brain.local", key: "k1", model: "first", provider: "p1", fallback: false },
      { url: "http://backup.local", key: "k2", model: "second", provider: "p2", fallback: false },
    ]);
    // Target 1 streams a partial answer and then the socket dies. Nothing marks
    // a round boundary between the two targets, so round numbers alone cannot
    // express this — both attempts are round 1.
    const dying = () => new Response(
      new ReadableStream<Uint8Array>({
        // Error on the SECOND pull: enqueue-then-error() clears the queued
        // chunk, so the orphaned token would never reach the route at all.
        pull(c) {
          reads += 1;
          if (reads === 1) {
            c.enqueue(new TextEncoder().encode(token("orphaned half")));
            return;
          }
          c.error(new Error("socket died"));
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } });
    resetAiChatForTests();
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => dying())
      .mockImplementationOnce(async () => sseResponse([token("Backup answer."), DONE])));
    const body = await (await post({ message: "hi", stream: true })).text();
    expect(attemptFrames(body).map((f) => JSON.parse(f.data))).toEqual([
      { round: 1, target: "t0" },
      { round: 1, target: "t1" },
    ]);
    // The orphaned tokens land BETWEEN the two attempt frames, so the second
    // reset can retract them before the answering attempt's tokens arrive.
    expect(shape(body)).toEqual(["attempt:t0", "frame", "attempt:t1", "frame", "frame"]);
  });

  it("announces the exhaustion answer as its own attempt, before the text", async () => {
    mocks.getTool.mockReturnValue({ handler: vi.fn(async () => '{"ok":true}') });
    mocks.buildToolsForOpenAI.mockReturnValue([
      { type: "function", function: { name: "get_pantry", parameters: {} } },
    ] as any);
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([toolCallRound("c1", "get_pantry", "{}")])));
    const body = await (await post({ message: "keep going", stream: true })).text();
    const positions = attemptPositions(body);
    const exhaustionIdx = frames(body).findIndex((f) => f.data.includes("ran out of steps"));
    expect(exhaustionIdx).toBeGreaterThan(-1);
    // One per provider call, plus the synthesized answer's own attempt.
    expect(attemptFrames(body).map((f) => JSON.parse(f.data))).toEqual([
      { round: 1, target: "t0" },
      { round: 2, target: "t0" },
      { round: 3, target: "t0" },
      { round: 4, target: "t0" },
      { round: 5, target: "t0" },
      { round: 6, target: "t0" },
      { round: 6, target: "exhausted" },
    ]);
    // Without this the fallback is appended to whatever the tool rounds already
    // rendered and the bubble stops matching the persisted row.
    expect(positions[6]).toBeLessThan(exhaustionIdx);
  });

  it("numbers one attempt per round so the answering wrap-up is identifiable", async () => {
    mocks.getTool.mockReturnValue({ handler: vi.fn(async () => '{"ok":true}') });
    mocks.buildToolsForOpenAI.mockReturnValue([
      { type: "function", function: { name: "get_pantry", parameters: {} } },
    ] as any);
    const fetchMock = vi.fn();
    for (let i = 0; i < 5; i++) {
      fetchMock.mockImplementationOnce(async () => sseResponse([toolCallRound("c1", "get_pantry", "{}")]));
    }
    fetchMock.mockImplementationOnce(async () => sseResponse([token("Rundown."), DONE]));
    vi.stubGlobal("fetch", fetchMock);
    const body = await (await post({ message: "dig into everything", stream: true })).text();
    expect(attemptFrames(body).map((f) => JSON.parse(f.data).round)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("keeps the buffered path free of SSE frames entirely", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content: "plain" } }] }),
      { status: 200, headers: { "content-type": "application/json" } })));
    const res = await post({ message: "hi" });
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.text();
    // Nothing streams here, so there is no orphaned token to retract and an
    // attempt frame would have nothing to reset. Asserting the PARSED shape —
    // not the absence of the string "event:" — is what also proves the body is
    // the parseable JSON chat-stream.ts reads `content` off, which a bare
    // `data: {...}` token frame would silently break. Only `proposals` is
    // tolerated beyond `content`: the route adds it when a tool round surfaced
    // one, and pinning the exact shape would call that feature a regression.
    // This fixture reasons about nothing, so the allowlist here cannot police a
    // `reasoning` key — the reasoning-bearing fixture in "never puts a buffered
    // round's reasoning on the response body" is what guards that.
    const keys = Object.keys(JSON.parse(body));
    expect(keys).toContain("content");
    expect(keys.filter((k) => k !== "content" && k !== "proposals")).toEqual([]);
  });
});

// A stop is a promise. The client aborts its fetch and renders "Stopped." with
// whatever streamed, so if the route stores the answer anyway the store's next
// reconcile hands that row straight back and the reply the user cancelled
// reappears anyway — the one divergence no `attempt` frame can cover, because
// there is no frame left to send to a requester who has gone.
//
// Two disconnect signals exist, and neither is a cancel message the route
// awaits: `request.signal` (Next 16 App Router builds it from the response
// socket's `close`, so it fires without the route writing anything) and the
// route's own `write()` rejection (`clientGone`). The first test below is
// shaped so `clientGone` CANNOT flip — the silent phase of a long reasoning
// turn — so it fails if the guard ever regresses to the write-rejection signal
// alone.
describe("hermes chat — a stopped turn persists nothing", () => {
  /** Provider stream the test drives frame by frame, so "no frame after X" is expressible. */
  function handCrankedProvider() {
    const enc = new TextEncoder();
    let emit: ((s: string) => void) | null = null;
    let finish: (() => void) | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        emit = (s) => c.enqueue(enc.encode(token(s)));
        finish = () => { c.enqueue(enc.encode(DONE)); c.close(); };
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    })));
    return { emit: (s: string) => emit!(s), finish: () => finish!() };
  }

  /** Read until `needle` lands, so the abort happens strictly after that write. */
  async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string) {
    const decoder = new TextDecoder();
    let seen = "";
    // The deadline has to RACE the read, not merely bracket it: a read that
    // never resolves would otherwise sit past the deadline and hang the suite
    // instead of reporting, so the loop condition alone buys nothing.
    const deadline = Date.now() + 1000;
    for (;;) {
      let timer: ReturnType<typeof setTimeout>;
      const { value } = await Promise.race([
        reader.read(),
        new Promise<{ value?: undefined }>((r) => { timer = setTimeout(() => r({}), Math.max(0, deadline - Date.now())); }),
      ]);
      // Clear the loser's timer so a fast read leaves no armed handle behind —
      // harmless on real timers, a flake source the moment this file fakes them.
      clearTimeout(timer!);
      // When the timeout wins, `value` is undefined and this breaks at once, so
      // the orphaned read can never steal a chunk the loop still needed.
      if (!value) break;
      seen += decoder.decode(value);
      if (seen.includes(needle)) break;
    }
    return seen;
  }

  /** writer.close() runs in the route's finally, so a finished read is past the persist decision. */
  async function drain(reader: ReadableStreamDefaultReader<Uint8Array>) {
    for (;;) {
      const { done } = await reader.read();
      if (done) return;
    }
  }

  it("stores nothing when the request was aborted, even with no frame written after the stop", async () => {
    const controller = new AbortController();
    const provider = handCrankedProvider();
    const res = await post({ message: "hi", stream: true }, controller.signal);
    const reader = res.body!.getReader();
    provider.emit("Hel");
    // Every frame so far (the attempt reset and this token) was consumed, so no
    // write ever rejected. Nothing else is written before the persist decision
    // either — the provider ends on DONE with no further content, and the [DONE]
    // frame goes out after it. `clientGone` therefore stays false for the whole
    // turn and only `request.signal` can know the requester left.
    expect(await readUntil(reader, '"t":"Hel"')).toContain('"t":"Hel"');
    controller.abort();
    provider.finish();
    await drain(reader);
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
    // Anti-vacuity: `not.toHaveBeenCalled()` alone is also satisfied by a turn
    // that never got far enough to store anything — an error, or an exhaustion
    // branch that answered something else. Exactly one outcome recorded as `ok`
    // is the proof this turn ran to completion and reached the persist decision
    // the guard sits on. (`clientGone` is provably false here, so `ok` also pins
    // the deliberate split: persistence reads request.signal, health reads
    // clientGone alone.)
    expect(mocks.recordChatOutcome).toHaveBeenCalledTimes(1);
    expect(mocks.recordChatOutcome.mock.calls[0][0].outcome).toBe("ok");
  });

  it("stores nothing when the client drops the stream and the next write rejects", async () => {
    const controller = new AbortController();
    const provider = handCrankedProvider();
    const res = await post({ message: "hi", stream: true }, controller.signal);
    const reader = res.body!.getReader();
    provider.emit("Hel");
    await readUntil(reader, '"t":"Hel"');
    await reader.cancel(); // client is gone
    provider.emit("lo");
    provider.finish();
    await new Promise((r) => setTimeout(r, 60));
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
    // The health log keeps its own vocabulary: a gone requester is client_gone,
    // never a model outcome — the turn was abandoned, not answered badly.
    expect(mocks.recordChatOutcome).toHaveBeenCalledTimes(1);
    expect(mocks.recordChatOutcome.mock.calls[0][0].outcome).toBe("client_gone");
  });

  it("stores the pair when the client stays connected through [DONE]", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([token("Hello"), DONE])));
    // A signal that exists but never aborts is the normal turn's shape; the
    // guard must read it without mistaking it for a stop.
    const res = await post({ message: "hi", stream: true }, new AbortController().signal);
    expect(await res.text()).toContain("data: [DONE]");
    expect(mocks.insertChatMessage.mock.calls.map((c: any[]) => [c[0].role, c[0].content]))
      .toEqual([["user", "hi"], ["assistant", "Hello"]]);
  });
});

// Per-call provider timeout. `AI_TIMEOUT_MS` used to bound EVERY provider call,
// which killed a streamed round while a reasoning model was still re-planning
// after a tool error: the round died, the failover loop moved on, and a short
// chain left the family with the "hit a snag" fallback — the reported
// "if I had a tool call error, I do not get a response back". Only the STREAMED
// call gets the longer budget; buffered and planner calls stay at 60s, because
// holding a non-streaming call for two minutes only makes a dead provider slower
// to fail over.
//
// Node's real `AbortSignal.timeout` rides libuv's internal timer list, which
// `vi.useFakeTimers()` does not advance (a real 60s timeout is still unfired
// after 90s of fake time — verified in this project), so a fake-timer test
// written against it would pass before AND after the fix. The stand-in below
// keeps the one observable contract that matters — the signal aborts `ms` from
// now — and puts it on the faked clock, which is what lets 60s-vs-120s be
// asserted as BEHAVIOUR (the answer arrives) rather than as a claim about a
// constant's value.
const realAbortSignalTimeout = AbortSignal.timeout;

describe("hermes chat — per-call timeout budgets", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    AbortSignal.timeout = ((ms: number) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")),
        ms,
      );
      return controller.signal;
    }) as typeof AbortSignal.timeout;
  });

  afterEach(() => {
    AbortSignal.timeout = realAbortSignalTimeout;
  });

  /**
   * A provider that sits on the request — no response headers, like a gateway
   * holding a long reasoning turn behind a buffering intermediary — until
   * `answerAtMs`, and honors the route's abort signal the way a real one does,
   * so the round dies with the timeout instead of hanging.
   */
  function silentProvider(answerAtMs: number, answer: () => Response) {
    vi.stubGlobal("fetch", vi.fn((_url: string, init: { signal: AbortSignal }) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(answer()), answerAtMs);
        init.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(init.signal.reason ?? new Error("aborted"));
        }, { once: true });
      })));
  }

  /** Fake time only moves when a timer fires, so the request lands at t=0. */
  async function settleRequestToProvider() {
    await vi.advanceTimersByTimeAsync(0);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  }

  it("keeps a streamed round alive past 60s when the model is still reasoning", async () => {
    silentProvider(90_000, () => sseResponse([token("The slow answer."), DONE]));
    const res = await post({ message: "hi", stream: true });
    const bodyPromise = res.text();
    await settleRequestToProvider();
    await vi.advanceTimersByTimeAsync(90_000);
    const body = await bodyPromise;
    expect(body).toContain('data: {"t":"The slow answer."}');
    expect(body).not.toContain("hit a snag");
    expect(mocks.insertChatMessage.mock.calls.map((c: any[]) => [c[0].role, c[0].content]))
      .toEqual([["user", "hi"], ["assistant", "The slow answer."]]);
  });

  it("gives up on the buffered path at 60s — the longer budget is streamed-only", async () => {
    // Same provider, same 90s answer, buffered mode. Buffering a non-streaming
    // call for two minutes only makes a dead provider slower to fail over, so
    // this path must still be a snag.
    silentProvider(90_000, () => new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content: "plain" } }] }),
      { status: 200, headers: { "content-type": "application/json" } }));
    const pending = post({ message: "hi" });
    await settleRequestToProvider();
    await vi.advanceTimersByTimeAsync(90_000);
    const json = await (await pending).json();
    expect(json.content).toContain("hit a snag");
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
  });

  it("still gives up on a streamed round that is silent at 120s", async () => {
    // The upper bound, so the widened budget can't drift into "wait forever".
    silentProvider(130_000, () => sseResponse([token("Way too late."), DONE]));
    const res = await post({ message: "hi", stream: true });
    const bodyPromise = res.text();
    await settleRequestToProvider();
    await vi.advanceTimersByTimeAsync(120_000);
    const body = await bodyPromise;
    expect(body).toContain("event: error");
    expect(body).not.toContain("Way too late.");
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
    // The honest terminal state: a round the budget killed is a `snag`, not an
    // `exhausted` or a silent abort, so Settings → AI Models reads it as an
    // LLM timeout.
    expect(mocks.recordChatOutcome.mock.calls[0][0].outcome).toBe("snag");
  });

  // The sibling test proves the buffered budget is ≤ 90s, which no narrowing of
  // AI_TIMEOUT_MS(60s) could trip — 30s would pass it too. Pin the budget itself:
  // alive one tick before it, dead at it.
  it("gives up on the buffered path exactly at AI_TIMEOUT_MS(60s)", async () => {
    silentProvider(120_000, () => new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content: "plain" } }] }),
      { status: 200, headers: { "content-type": "application/json" } }));
    let settled = false;
    const pending = post({ message: "hi" }).then((r) => { settled = true; return r; });
    await settleRequestToProvider();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    // Assert the settle before awaiting, so a WIDENED budget reports a failure
    // instead of hanging the suite on a response that never comes.
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect((await (await pending).json()).content).toContain("hit a snag");
  });
});

// Two holes in what the user can see, one cause: the route knows both of these
// things and shows neither. A reasoning model streams `reasoning_content` deltas
// for the whole think and the route counted their characters and threw the text
// away — the one-shot "Thinking deeply…" status label was all that survived —
// and a failing tool was fed back to the model as JSON `{"error":…}` while
// surfacing to the user as nothing. That silence is most of what "if I had a
// tool call error, I do not get a response back" felt like.
//
// Both frame types are DISPLAY-ONLY (spec §4.2 / §8): they go to the client and
// nowhere else — never into `messages` (the array the provider sees) and never
// into PocketBase. `event: reasoning` and `event: tool` are a different frame
// kind from `event: attempt`: they must never reset the content accumulator, or
// displayed would stop equalling persisted.
describe("hermes chat — reasoning + tool activity frames", () => {
  /** Parsed payloads of one event kind; unparseable data (the `data: [DONE]`
   *  terminator and the bare token frames) is skipped, never thrown on. */
  function payloads(body: string, event: string): any[] {
    return parseSSEFrames(body).frames
      .filter((f) => f.event === event)
      .flatMap((f) => { try { return [JSON.parse(f.data)]; } catch { return []; } });
  }
  /** The tools the session may see — the route only executes an allowlisted call. */
  function allowlist(...names: string[]) {
    mocks.buildToolsForOpenAI.mockReturnValue(
      names.map((n) => ({ type: "function", function: { name: n, parameters: {} } })) as any,
    );
  }
  /** `runToolCalls` wraps a thrown handler as {"error":…}, so a throw is the
   *  real shape of a tool call error, not a JSON a handler chose to return. */
  const throwsWith = (message: string) => async () => { throw new Error(message); };
  function assistantRow(): any {
    return mocks.insertChatMessage.mock.calls.map((c: any[]) => c[0]).find((r: any) => r.role === "assistant");
  }

  it("forwards reasoning deltas as reasoning frames, once announced, and off the provider payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([
      reasoningToken("Let me check "),
      reasoningToken("the calendar."),
      token("You have soccer."),
      DONE,
    ])));
    const body = await (await post({ message: "when is soccer", stream: true })).text();
    expect(payloads(body, "reasoning").map((p) => p.r).join("")).toBe("Let me check the calendar.");
    // The one-shot dots-phase label is kept, and still fires exactly once.
    expect(payloads(body, "status")).toHaveLength(1);
    expect(payloads(body, "status")[0].label).toMatch(/Thinking deeply/);
    // DISPLAY-ONLY: the think never rides `messages` back to the provider…
    expect(JSON.stringify(JSON.parse((globalThis.fetch as any).mock.calls[0][1].body).messages))
      .not.toContain("Let me check");
    // …and never reaches PocketBase, so it cannot reappear from the thread.
    expect(assistantRow()?.content).toBe("You have soccer.");
  });

  it("emits every running frame before either tool executes, then one result frame each in call order", async () => {
    allowlist("get_pantry", "get_grocery_list");
    // The FIRST call finishes LAST, so results completing in reverse order is the
    // shape that catches a frame emitted per-completion instead of per-call-index.
    mocks.getTool.mockImplementation((name: string) =>
      name === "get_pantry"
        ? { handler: async () => { await new Promise((r) => setTimeout(r, 25)); throw new Error("pantry unavailable"); } }
        : { handler: async () => '{"ok":true}' });
    const round =
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [
        { index: 0, id: "c1", function: { name: "get_pantry", arguments: "{}" } },
        { index: 1, id: "c2", function: { name: "get_grocery_list", arguments: "{}" } },
      ] } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n` + DONE;
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => sseResponse([round]))
      .mockImplementationOnce(async () => sseResponse([token("Milk and pasta."), DONE])));
    const body = await (await post({ message: "what's in the pantry", stream: true })).text();
    expect(payloads(body, "tool")).toEqual([
      { name: "get_pantry", state: "running" },
      { name: "get_grocery_list", state: "running" },
      { name: "get_pantry", state: "error" },
      { name: "get_grocery_list", state: "ok" },
    ]);
    // Tool frames are a DIFFERENT frame kind from `attempt`: they must not reset
    // the content accumulator, or what the bubble shows stops being what the
    // thread persists.
    expect(payloads(body, "message").map((p) => p.t).join("")).toBe("Milk and pasta.");
    expect(assistantRow()?.content).toBe("Milk and pasta.");
  });

  it("marks a thrown tool handler as an error frame while still feeding the result to the model", async () => {
    allowlist("get_pantry");
    mocks.getTool.mockReturnValue({ handler: throwsWith("pantry unavailable") });
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => sseResponse([toolCallRound("c1", "get_pantry", "{}")]))
      .mockImplementationOnce(async () => sseResponse([token("I couldn't reach the pantry."), DONE])));
    const body = await (await post({ message: "what's in the pantry", stream: true })).text();
    expect(payloads(body, "tool").map((p) => p.state)).toEqual(["running", "error"]);
    // The failure still goes back to the model — the round can recover — so the
    // `{error}` JSON remains on `messages`; only its VISIBILITY is new.
    const messages = JSON.parse((globalThis.fetch as any).mock.calls[1][1].body).messages;
    expect(messages.at(-1)).toMatchObject({ role: "tool", content: '{"error":"pantry unavailable"}' });
  });

  it("marks a result that carries an error field as failed, and a clean one as ok", async () => {
    allowlist("get_pantry");
    mocks.getTool.mockReturnValue({ handler: vi.fn(async () => '{"ok":false,"error":"pantry unavailable"}') });
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => sseResponse([toolCallRound("c1", "get_pantry", "{}")]))
      .mockImplementationOnce(async () => sseResponse([token("Sorry."), DONE])));
    const body = await (await post({ message: "what's in the pantry", stream: true })).text();
    expect(payloads(body, "tool").map((p) => p.state)).toEqual(["running", "error"]);
  });

  it("reads a result that is not JSON as a success, not a failure", async () => {
    allowlist("get_pantry");
    // A handler may answer with prose; only a parsed `error` field is a failure,
    // so an unparseable result must not paint the chip red.
    mocks.getTool.mockReturnValue({ handler: vi.fn(async () => "8 items, all in date") });
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => sseResponse([toolCallRound("c1", "get_pantry", "{}")]))
      .mockImplementationOnce(async () => sseResponse([token("Plenty."), DONE])));
    const body = await (await post({ message: "what's in the pantry", stream: true })).text();
    expect(payloads(body, "tool").map((p) => p.state)).toEqual(["running", "ok"]);
  });

  // Fallback providers answer a stream:true request with one buffered JSON body
  // (see `aiStreamingSupported`). That branch writes the content as a single
  // token frame so the client's contract holds either way — the reasoning in the
  // same body was being dropped exactly like the streamed deltas were.
  it("forwards a buffered provider's reasoning as one reasoning frame", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content: "Done.", reasoning_content: "thought about it" } }] }),
      { status: 200, headers: { "content-type": "application/json" } })));
    const body = await (await post({ message: "hi", stream: true })).text();
    expect(payloads(body, "reasoning").map((p) => p.r)).toEqual(["thought about it"]);
    expect(payloads(body, "message").map((p) => p.t)).toEqual(["Done."]);
  });

  // `callAi` still reads `reasoning_content` — that read is what separates a
  // round whose reasoning ate the token budget from a provider that never
  // answered, and it is what a future consumer would build on. It does NOT put
  // the transcript on the wire: this body is the shape `chat-stream.ts` parses,
  // and it reads `content` and `proposals` and nothing else, so a reasoning round
  // answers the same plain `{content}` shape a non-reasoning one does.
  //
  // The fixture really does return a transcript, so "no `reasoning` key" is not
  // passing for the wrong reason the way the allowlist check above does on its
  // no-reasoning fixture. `json.content` proving the fixture was parsed is what
  // makes the allowlist below load-bearing rather than fixture-dependent.
  it("never puts a buffered round's reasoning on the response body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content: "Done.", reasoning_content: "thought about it" } }] }),
      { status: 200, headers: { "content-type": "application/json" } })));
    const res = await post({ message: "hi" });
    const json = await res.json();
    expect(json.content).toBe("Done.");
    expect("reasoning" in json).toBe(false);
    expect(Object.keys(json).filter((k) => k !== "content" && k !== "proposals")).toEqual([]);
    expect(assistantRow()?.content).toBe("Done.");
    expect(JSON.stringify(mocks.insertChatMessage.mock.calls)).not.toContain("thought about it");
  });
});
