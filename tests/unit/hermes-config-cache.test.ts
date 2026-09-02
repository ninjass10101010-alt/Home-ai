import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  buildToolsForOpenAI: vi.fn(() => []),
  getTool: vi.fn(() => undefined),
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

function hermesReply(content = "ok") {
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), { status: 200 });
}

async function post(message: string) {
  return POST(
    new NextRequest("http://localhost/api/hermes/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
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
  vi.stubGlobal("fetch", vi.fn(async () => hermesReply()));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("hermes chat — config cache + resilience", () => {
  it("reads service config once across two messages (URL + KEY)", async () => {
    await post("one");
    await post("two");
    expect(mocks.getServiceConfig).toHaveBeenCalledTimes(2);
  });

  it("re-reads config after the 10-minute TTL expires", async () => {
    await post("one");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await post("two");
    vi.useRealTimers();
    expect(mocks.getServiceConfig).toHaveBeenCalledTimes(4);
  });

  it("sends an AbortSignal timeout on every Hermes call", async () => {
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
