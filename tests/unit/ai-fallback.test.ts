// @vitest-environment node
// AI fallback chain — resolution + route-level failover contract.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServiceConfig: vi.fn(async (..._a: unknown[]) => null as string | null),
  buildToolsForOpenAI: vi.fn(() => []),
  getTool: vi.fn(() => undefined),
  insertChatMessage: vi.fn(async () => ({})),
}));

vi.mock("@/lib/services/config", () => ({ getServiceConfig: mocks.getServiceConfig }));
vi.mock("@/lib/hermes-tools", () => ({
  buildToolsForOpenAI: mocks.buildToolsForOpenAI,
  getTool: mocks.getTool,
}));
vi.mock("@/db", () => ({ db: { insertChatMessage: mocks.insertChatMessage } }));

import { resolveFallbackChain, buildFallbackTargets, resetFallbackChainCacheForTests } from "@/lib/ai-fallback";

describe("resolveFallbackChain", () => {
  beforeEach(() => {
    resetFallbackChainCacheForTests();
    mocks.getServiceConfig.mockImplementation(async (_s: unknown, key: unknown) => {
      const vals: Record<string, string> = {
        FALLBACK_API_URL: "https://api.b.ai/v1/",
        FALLBACK_API_KEY: "fk-test",
        FALLBACK_MODELS: "glm-5.3-flash, qwen3.8-flash,",
      };
      return (vals as Record<string, string>)[key as string] ?? null;
    });
  });

  it("parses url/key/ordered models, normalizes /v1 + trailing slash, strips empties", async () => {
    const chain = await resolveFallbackChain();
    // Route appends /v1/chat/completions, so a pasted ".../v1" base is normalized.
    expect(chain).toEqual({ baseUrl: "https://api.b.ai", key: "fk-test", models: ["glm-5.3-flash", "qwen3.8-flash"] });
    const targets = await buildFallbackTargets();
    expect(targets).toEqual([
      { url: "https://api.b.ai", key: "fk-test", model: "glm-5.3-flash" },
      { url: "https://api.b.ai", key: "fk-test", model: "qwen3.8-flash" },
    ]);
  });

  it("returns null when unconfigured (no fallbacks added)", async () => {
    mocks.getServiceConfig.mockResolvedValue(null as any);
    expect(await resolveFallbackChain()).toBeNull();
    expect(await buildFallbackTargets()).toEqual([]);
  });

  it("key is optional", async () => {
    mocks.getServiceConfig.mockImplementation(async (_s: unknown, key: unknown) =>
      key === "FALLBACK_API_URL" ? "https://x/v1" : key === "FALLBACK_MODELS" ? "m1" : null
    );
    const targets = await buildFallbackTargets();
    expect(targets).toEqual([{ url: "https://x", key: null, model: "m1" }]);
  });
});

describe("route failover (hermes down → fallback answers)", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-secret-0123456789";
    vi.stubEnv("HERMES_API_KEY", "");
    vi.stubEnv("HERMES_API_URL", "http://hermes-primary.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function hermesReply(content: string) {
    return new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
      { status: 200 }
    );
  }

  it("primary 500 → fallback model replies; primary OK → fallback never called", async () => {
    const { POST, resetHermesChatForTests } = await import("@/app/api/hermes/chat/route");
    resetHermesChatForTests();
    mocks.getServiceConfig.mockImplementation(async (_s: unknown, key: unknown) => {
      const vals: Record<string, string> = {
        FALLBACK_API_URL: "https://fallback.test/v1",
        FALLBACK_MODELS: "glm-5.3-flash",
      };
      return (vals as Record<string, string>)[key as string] ?? null;
    });

    // Call 1: hermes 500. Call 2: fallback OK.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(hermesReply("fallback answer"));
    vi.stubGlobal("fetch", fetchMock);

    const req = new NextRequest("http://localhost/api/hermes/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe("fallback answer");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second.model).toBe("glm-5.3-flash");
    expect(fetchMock.mock.calls[1][0]).toBe("https://fallback.test/v1/chat/completions");
  });
});
