import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  buildToolsForOpenAI: vi.fn(() => []),
  getTool: vi.fn(
    (_name: string): { handler: (args: Record<string, any>) => Promise<string> } | undefined => undefined,
  ),
  insertChatMessage: vi.fn(async () => ({})),
  resolveChatTargets: vi.fn(async () => [
    { url: "http://brain.local", key: "k1", model: "brain-model", provider: "brain", fallback: false },
    { url: "http://backup.local", key: "k2", model: "backup-model", provider: "backup", fallback: true },
  ]),
  resetAiTargetsForTests: vi.fn(),
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

async function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/hermes/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

const fail500 = () =>
  new Response("upstream exploded", { status: 500, headers: { "content-type": "text/plain" } });

const buffered200 = (content: string) =>
  new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const BRAIN_URL = "http://brain.local/v1/chat/completions";
const BACKUP_URL = "http://backup.local/v1/chat/completions";

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  resetAiChatForTests();
  mocks.resolveChatTargets.mockClear();
  mocks.insertChatMessage.mockClear();
  mocks.getTool.mockReset().mockReturnValue(undefined);
  mocks.buildToolsForOpenAI.mockReset().mockReturnValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("hermes chat — route-level failover", () => {
  it("buffered: a 500 on the brain falls through to the backup target", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockImplementationOnce(async () => fail500())
        .mockImplementationOnce(async () => buffered200("fallback ok")),
    );
    const res = await post({ message: "hi" });
    const data = await res.json();
    expect(data.content).toBe("fallback ok");

    const calls = (globalThis.fetch as any).mock.calls as [string, any][];
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe(BRAIN_URL);
    expect(JSON.parse(String(calls[0][1].body)).model).toBe("brain-model");
    expect(calls[1][0]).toBe(BACKUP_URL);
    expect(JSON.parse(String(calls[1][1].body)).model).toBe("backup-model");
    expect(calls[1][1].headers.Authorization).toBe("Bearer k2");
  });

  it("streamed: a 500 on the brain falls through to the backup target", async () => {
    // Contract (route.ts callAiStream): fallback:true targets are asked for
    // JSON (no stream:true — their SSE dialects vary) and the route wraps the
    // answer in the SSE token frame itself, so the backup answers buffered
    // here while the client still sees the streamed contract below.
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockImplementationOnce(async () => fail500())
        .mockImplementationOnce(async () => buffered200("fallback ok")),
    );
    const res = await post({ message: "hi", stream: true });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await res.text();
    expect(body).toContain('data: {"t":"fallback ok"}');
    expect(body).toContain("data: [DONE]");

    const calls = (globalThis.fetch as any).mock.calls as [string, any][];
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe(BRAIN_URL);
    expect(JSON.parse(String(calls[0][1].body)).model).toBe("brain-model");
    expect(calls[1][0]).toBe(BACKUP_URL);
    expect(JSON.parse(String(calls[1][1].body)).model).toBe("backup-model");
    expect(calls[1][1].headers.Authorization).toBe("Bearer k2");
  });

  it("buffered no-config: empty chain returns the honest configure message", async () => {
    mocks.resolveChatTargets.mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn());
    const res = await post({ message: "hi" });
    const data = await res.json();
    expect(data.content).toContain("My brain isn't configured yet");
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("streamed no-config: empty chain emits an error frame with the configure message", async () => {
    mocks.resolveChatTargets.mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn());
    const res = await post({ message: "hi", stream: true });
    const body = await res.text();
    expect(body).toContain("event: error");
    expect(body).toContain("My brain isn't configured yet");
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
