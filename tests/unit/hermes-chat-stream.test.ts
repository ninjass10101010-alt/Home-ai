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
      const { value } = await reader.read();
      return new TextDecoder().decode(value);
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
