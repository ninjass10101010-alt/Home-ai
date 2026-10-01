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

  it("throws on an error frame after partial content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      sseResponse('data: {"t":"par"}\n\ndata: {"t":"tial"}\n\nevent: error\ndata: {"message":"boom"}\n\n')));
    const seen: string[] = [];
    await expect(
      streamConsuelaChat({ message: "hi", onToken: (full) => seen.push(full) })
    ).rejects.toThrow("boom");
    // the tokens that did land are still surfaced before the rejection
    expect(seen).toEqual(["par", "partial"]);
  });

  it("marks the route's own error frame with a distinguishable name", async () => {
    const routeMessage = "My brain isn't configured yet — add a provider in Settings → AI Models.";
    vi.stubGlobal("fetch", vi.fn(async () =>
      sseResponse(`event: error\ndata: ${JSON.stringify({ message: routeMessage })}\n\n`)));
    // The name is what chat-store discriminates on, so the frame's exact text
    // has to arrive on the very error that carries it.
    await expect(streamConsuelaChat({ message: "hi" }))
      .rejects.toMatchObject({ name: "RouteChatError", message: routeMessage });
  });

  it("falls back to the generic copy when the error frame's message is not a string", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      sseResponse('event: error\ndata: {"message":{}}\n\n')));
    const err = await streamConsuelaChat({ message: "hi" }).then(() => null, (e: unknown) => e as Error);
    // A `String()` coercion would put "[object Object]" in front of the family.
    expect(err?.message).toBe("Chat failed");
  });

  it("falls back to buffered JSON when the route answers non-SSE", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ content: "buffered" }), { status: 200, headers: { "content-type": "application/json" } })));
    const seen: string[] = [];
    const res = await streamConsuelaChat({ message: "hi", onToken: (full) => seen.push(full) });
    expect(res).toEqual({ content: "buffered", streamed: false });
    // the buffered fallback must NOT emit tokens: rendering is the caller's
    // decision after the await (the 400ms thinking floor lives there).
    expect(seen).toEqual([]);
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

  it("passes a client-side watchdog signal to the fetch", async () => {
    const fetchMock = vi.fn(async () => sseResponse("data: [DONE]\n\n"));
    vi.stubGlobal("fetch", fetchMock);
    await streamConsuelaChat({ message: "hi" });
    const init = (fetchMock.mock.calls[0] as any)[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("accepts an external abort signal and rejects when it fires", async () => {
    const fetchMock = vi.fn(async () => sseResponse("data: [DONE]\n\n"));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await streamConsuelaChat({ message: "hi", signal: controller.signal });
    const init = (fetchMock.mock.calls[0] as any)[1];
    // The route gets an abortable signal whose [DONE] fast path still resolves.
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal.aborted).toBe(false);
    expect(controller.signal.aborted).toBe(false);
    // Aborting mid-stream propagates as a rejection, not a silent hang.
    const neverStream = new ReadableStream<Uint8Array>({
      start() { /* never enqueues, never closes */ },
    });
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(neverStream, { status: 200, headers: { "content-type": "text/event-stream" } })));
    const pending = streamConsuelaChat({ message: "hi", signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow();
  });

  it("reports a user-intended abort distinctly from a network failure", async () => {
    // Stream delivers two tokens then stays open — the abort fires mid-flight.
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('data: {"t":"par"}\n\ndata: {"t":"tial"}\n\n'));
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } })));
    const controller = new AbortController();
    const seen: string[] = [];
    const pending = streamConsuelaChat({
      message: "hi",
      signal: controller.signal,
      onToken: (full) => seen.push(full),
    });
    await vi.waitFor(() => expect(seen).toEqual(["par", "partial"]));
    controller.abort();
    const err = await pending.then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("AbortError");
  });
});

// The route writes token frames from inside the provider call, so a superseded
// attempt's tokens are already on screen — but only the answering round is
// persisted. `attempt` is announced before every provider call (round × target)
// so the accumulator can drop the orphan. Three paths diverge without it: a
// preamble round superseded by an answer, a mid-round target failover (no round
// boundary between the targets), and the exhaustion fallback.
describe("streamConsuelaChat — attempt frames", () => {
  function stream(...frames: string[]) {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(frames.join(""))));
  }

  it("replaces a superseded attempt's tokens instead of concatenating them", async () => {
    stream(
      'event: attempt\ndata: {"round":1,"target":"first"}\n\n',
      'data: {"t":"first attempt text"}\n\n',
      'event: attempt\ndata: {"round":1,"target":"second"}\n\n',
      'data: {"t":"second attempt"}\n\n',
      "data: [DONE]\n\n",
    );
    const seen: string[] = [];
    const res = await streamConsuelaChat({ message: "hi", onToken: (full) => seen.push(full) });
    // What the bubble ends up holding must be exactly what the route persists.
    expect(res.content).toBe("second attempt");
    expect(seen).toEqual(["first attempt text", "second attempt"]);
    expect(seen).not.toContain("first attempt textsecond attempt");
  });

  it("replaces the tool rounds' tokens with the exhaustion fallback", async () => {
    stream(
      'event: attempt\ndata: {"round":1,"target":"brain"}\n\n',
      'data: {"t":"Let me check"}\n\n',
      'event: attempt\ndata: {"round":2,"target":"brain"}\n\n',
      'data: {"t":"Let me check on that too"}\n\n',
      'event: attempt\ndata: {"round":2,"target":"exhausted"}\n\n',
      'data: {"t":"I ran out of steps"}\n\n',
      "data: [DONE]\n\n",
    );
    const res = await streamConsuelaChat({ message: "hi" });
    expect(res.content).toBe("I ran out of steps");
  });

  it("reports every attempt's round and target to onAttempt", async () => {
    stream(
      'event: attempt\ndata: {"round":1,"target":"first"}\n\n',
      'data: {"t":"partial"}\n\n',
      'event: attempt\ndata: {"round":1,"target":"second"}\n\n',
      'data: {"t":"answer"}\n\n',
      "data: [DONE]\n\n",
    );
    const attempts: Array<{ round: number; target: string }> = [];
    await streamConsuelaChat({ message: "hi", onAttempt: (meta) => attempts.push(meta) });
    // Two targets in ONE round — the round number alone could not tell them apart.
    expect(attempts).toEqual([
      { round: 1, target: "first" },
      { round: 1, target: "second" },
    ]);
  });

  it("still drops the orphan when the attempt frame's data is malformed", async () => {
    // The reset is the load-bearing part: a parse failure must not leave the
    // superseded attempt's tokens on screen.
    stream(
      'event: attempt\ndata: {"round":1,"target":"first"}\n\n',
      'data: {"t":"first attempt text"}\n\n',
      "event: attempt\ndata: not-json\n\n",
      'data: {"t":"second attempt"}\n\n',
      "data: [DONE]\n\n",
    );
    const seen: string[] = [];
    const res = await streamConsuelaChat({
      message: "hi",
      onToken: (full) => seen.push(full),
      onAttempt: () => { throw new Error("onAttempt must not run on a malformed frame"); },
    });
    expect(res.content).toBe("second attempt");
    expect(seen).not.toContain("first attempt textsecond attempt");
  });

  it("coerces a missing round to 0 rather than reporting NaN", async () => {
    stream(
      'event: attempt\ndata: {"target":"only"}\n\n',
      'data: {"t":"ok"}\n\n',
      "data: [DONE]\n\n",
    );
    const attempts: Array<{ round: number; target: string }> = [];
    await streamConsuelaChat({ message: "hi", onAttempt: (meta) => attempts.push(meta) });
    expect(attempts).toEqual([{ round: 0, target: "only" }]);
  });
});

describe("streamConsuelaChat watchdog", () => {
  // A wedged intermediary: one frame lands, then the body never resolves and
  // never closes. Fetch has already resolved here, so only a watchdog raced
  // against the body reads can end this call.
  function wedgedSSE(firstFrame = 'data: {"t":"partial"}\n\n') {
    const enc = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(enc.encode(firstFrame)); },
    });
  }

  function wedgedJSON() {
    return new ReadableStream<Uint8Array>({ start() { /* never resolves */ } });
  }

  // A wedged body whose cancel algorithm also stalls or rejects — the runtime
  // shape that made awaiting reader.cancel() reintroduce the very hang the
  // watchdog removes. The honest error must land regardless.
  function uncancellableSSE(cancel: () => Promise<void>) {
    const enc = new TextEncoder();
    return new Response(
      new ReadableStream<Uint8Array>({
        start(c) { c.enqueue(enc.encode('data: {"t":"par"}\n\n')); },
        cancel,
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  }

  // A pre-response stall: the route never answers, so the fetch itself is the
  // only thing racing the fail signal. Rejects the way real fetch does — an
  // AbortError DOMException — so these tests pin which error we surface, not
  // merely that one was surfaced.
  function stalledFetch() {
    return vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, rej) => {
      // Non-optional on purpose: a dropped `signal:` must fail here and now, not
      // turn both pre-fetch tests into ambiguous 5s timeouts.
      init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    }));
  }

  function errOf(p: Promise<unknown>) {
    return p.then(() => null, (e: unknown) => e as Error);
  }

  it("rejects on the watchdog when the SSE body read wedges", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(wedgedSSE(), { status: 200, headers: { "content-type": "text/event-stream" } })));
    const err = await errOf(streamConsuelaChat({ message: "hi", watchdogMs: 50 }));
    expect(err?.message).toMatch(/timed out/i);
  });

  it("reports a watchdog expiry as a failure, never as a user stop", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(wedgedSSE(), { status: 200, headers: { "content-type": "text/event-stream" } })));
    const err = await errOf(streamConsuelaChat({ message: "hi", watchdogMs: 50 }));
    // chat-store renders "Stopped." whenever the caller's own controller is
    // aborted (it never reads the error name) — a timeout shown as a user stop
    // would be dishonest.
    expect(err).toBeInstanceOf(Error);
    expect(err?.name).not.toBe("AbortError");
  });

  it("still rejects when the body's cancel algorithm never settles", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      uncancellableSSE(() => new Promise<void>(() => { /* never settles */ }))));
    const err = await errOf(streamConsuelaChat({ message: "hi", watchdogMs: 50 }));
    expect(err?.message).toMatch(/timed out/i);
  });

  it("keeps a rejecting cancel algorithm from escaping as an unhandled rejection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      uncancellableSSE(() => Promise.reject(new Error("socket already dead")))));
    const err = await errOf(streamConsuelaChat({ message: "hi", watchdogMs: 50 }));
    expect(err?.message).toMatch(/timed out/i);
    // yield so a stray rejection surfaces inside this test, where vitest
    // attributes it, instead of after the file has torn down
    await new Promise((r) => setTimeout(r, 0));
  });

  it("keeps streaming tokens flowing until the watchdog fires", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(wedgedSSE('data: {"t":"par"}\n\n'), { status: 200, headers: { "content-type": "text/event-stream" } })));
    const err = await errOf(streamConsuelaChat({
      message: "hi",
      watchdogMs: 50,
      onToken: (full) => seen.push(full),
    }));
    expect(seen).toEqual(["par"]);
    expect(err?.message).toMatch(/timed out/i);
  });

  it("rejects on the watchdog when the buffered JSON body wedges", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(wedgedJSON(), { status: 200, headers: { "content-type": "application/json" } })));
    const err = await errOf(streamConsuelaChat({ message: "hi", watchdogMs: 50 }));
    expect(err?.message).toMatch(/timed out/i);
    expect(err?.name).not.toBe("AbortError");
  });

  it("still reports a user stop as AbortError, not a timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(wedgedSSE(), { status: 200, headers: { "content-type": "text/event-stream" } })));
    const controller = new AbortController();
    const pending = streamConsuelaChat({
      message: "hi",
      signal: controller.signal,
      watchdogMs: 60_000,
    });
    controller.abort();
    const err = await errOf(pending);
    expect(err?.name).toBe("AbortError");
    expect(err?.message).not.toMatch(/timed out/i);
  });

  it("still reports a user stop during the buffered read as AbortError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(wedgedJSON(), { status: 200, headers: { "content-type": "application/json" } })));
    const controller = new AbortController();
    const pending = streamConsuelaChat({
      message: "hi",
      signal: controller.signal,
      watchdogMs: 60_000,
    });
    controller.abort();
    const err = await errOf(pending);
    expect(err?.name).toBe("AbortError");
  });

  it("still reports a user stop before the response arrives as AbortError", async () => {
    vi.stubGlobal("fetch", stalledFetch());
    const controller = new AbortController();
    const pending = streamConsuelaChat({
      message: "hi",
      signal: controller.signal,
      watchdogMs: 60_000,
    });
    controller.abort();
    const err = await errOf(pending);
    expect(err?.name).toBe("AbortError");
    // the stop message we normalize to, not the raw fetch rejection
    expect(err?.message).not.toBe("aborted");
  });

  it("still reports a watchdog expiry before the response arrives as a timeout", async () => {
    vi.stubGlobal("fetch", stalledFetch());
    const err = await errOf(streamConsuelaChat({ message: "hi", watchdogMs: 50 }));
    expect(err?.message).toMatch(/timed out/i);
    expect(err?.name).not.toBe("AbortError");
  });

  it("defaults the watchdog to 5 minutes when no override is given", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    try {
      vi.stubGlobal("fetch", vi.fn(async () => sseResponse("data: [DONE]\n\n")));
      await streamConsuelaChat({ message: "hi" });
      expect(spy).toHaveBeenCalledWith(300_000);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not fire a short watchdog on a stream that completes in time", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      sseResponse('data: {"t":"done"}\n\ndata: [DONE]\n\n')));
    await expect(streamConsuelaChat({ message: "hi", watchdogMs: 50 }))
      .resolves.toEqual({ content: "done", streamed: true });
  });
});
