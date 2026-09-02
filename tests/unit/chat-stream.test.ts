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
