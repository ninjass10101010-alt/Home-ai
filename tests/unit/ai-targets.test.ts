import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  listAiProviders: vi.fn(async (): Promise<any[]> => []),
  withAdmin: vi.fn(),
  decryptSecret: vi.fn((s: string | null | undefined) =>
    s && s.startsWith("enc:") ? s.slice(4) : null
  ),
}));

vi.mock("@/lib/ai/providers", () => ({ listAiProviders: mocks.listAiProviders }));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: mocks.withAdmin }));
vi.mock("@/lib/secret-box", () => ({ decryptSecret: mocks.decryptSecret }));

import { resolveChatTargets, resetAiTargetsForTests, resetAiTargetsCache } from "@/lib/ai/targets";

beforeEach(() => {
  vi.clearAllMocks();
  resetAiTargetsForTests();
  vi.unstubAllEnvs();
  mocks.listAiProviders.mockResolvedValue([]);
  mocks.withAdmin.mockResolvedValue([]);
});

describe("resolveChatTargets", () => {
  it("provider 0 model 0 is the brain; the rest are fallbacks", async () => {
    mocks.listAiProviders.mockResolvedValue([
      { id: "1", displayName: "b.ai", baseUrl: "https://api.b.ai", apiKey: "k1", models: ["glm", "qwen"], enabled: true, order: 0 },
      { id: "2", displayName: "groq", baseUrl: "https://api.groq.com", apiKey: "k2", models: ["llama"], enabled: true, order: 1 },
    ]);
    const t = await resolveChatTargets();
    expect(t).toEqual([
      { url: "https://api.b.ai", key: "k1", model: "glm", provider: "b.ai", fallback: false },
      { url: "https://api.b.ai", key: "k1", model: "qwen", provider: "b.ai", fallback: true },
      { url: "https://api.groq.com", key: "k2", model: "llama", provider: "groq", fallback: true },
    ]);
  });

  it("disabled providers drop out", async () => {
    mocks.listAiProviders.mockResolvedValue([
      { id: "1", displayName: "off", baseUrl: "https://x", apiKey: null, models: ["m"], enabled: false, order: 0 },
    ]);
    expect(await resolveChatTargets()).toEqual([]);
  });

  it("bootstrap: legacy ai_fallback PB rows when no providers exist", async () => {
    mocks.withAdmin.mockImplementation(async (fn: any) =>
      fn({
        collection: () => ({
          getFullList: async () => [
            { key: "FALLBACK_API_URL", value: "https://api.b.ai" },
            { key: "FALLBACK_API_KEY", value: "enc:legacy-key" },
            { key: "FALLBACK_MODELS", value: "glm-5.3-flash, qwen3.8-flash" },
          ],
        }),
      })
    );
    const t = await resolveChatTargets();
    expect(t).toEqual([
      { url: "https://api.b.ai", key: "legacy-key", model: "glm-5.3-flash", provider: "fallback", fallback: false },
      { url: "https://api.b.ai", key: "legacy-key", model: "qwen3.8-flash", provider: "fallback", fallback: true },
    ]);
  });

  it("bootstrap: env FALLBACK_* when PB has nothing", async () => {
    vi.stubEnv("FALLBACK_API_URL", "https://env.b.ai");
    vi.stubEnv("FALLBACK_API_KEY", "env-key");
    vi.stubEnv("FALLBACK_MODELS", "m1,m2");
    const t = await resolveChatTargets();
    expect(t.map((x) => x.model)).toEqual(["m1", "m2"]);
    expect(t[0]).toMatchObject({ url: "https://env.b.ai", key: "env-key", fallback: false });
  });

  it("bootstrap: AI_PROVIDER_* env for fresh installs", async () => {
    vi.stubEnv("AI_PROVIDER_URL", "https://fresh.ai/v1/");
    vi.stubEnv("AI_PROVIDER_KEY", "fresh-key");
    vi.stubEnv("AI_PROVIDER_MODELS", "fresh-model");
    const t = await resolveChatTargets();
    expect(t).toEqual([
      { url: "https://fresh.ai", key: "fresh-key", model: "fresh-model", provider: "env", fallback: false },
    ]);
  });

  it("caches for 10 minutes (provider list read once across calls)", async () => {
    mocks.listAiProviders.mockResolvedValue([
      { id: "1", displayName: "b.ai", baseUrl: "https://api.b.ai", apiKey: "k", models: ["m"], enabled: true, order: 0 },
    ]);
    await resolveChatTargets();
    await resolveChatTargets();
    expect(mocks.listAiProviders).toHaveBeenCalledTimes(1);
    resetAiTargetsForTests();
    await resolveChatTargets();
    expect(mocks.listAiProviders).toHaveBeenCalledTimes(2);
  });

  it("empty when nothing is configured", async () => {
    expect(await resolveChatTargets()).toEqual([]);
  });

  it("resetAiTargetsCache invalidates the chain (the save/delete coherence seam)", async () => {
    mocks.listAiProviders.mockResolvedValue([
      { id: "1", displayName: "b.ai", baseUrl: "https://api.b.ai", apiKey: "k", models: ["m"], enabled: true, order: 0 },
    ]);
    await resolveChatTargets();
    await resolveChatTargets();
    expect(mocks.listAiProviders).toHaveBeenCalledTimes(1);
    resetAiTargetsCache();
    await resolveChatTargets();
    expect(mocks.listAiProviders).toHaveBeenCalledTimes(2);
  });

  it("an EMPTY chain is cached for 30 seconds, not the full 10-minute TTL", async () => {
    vi.useFakeTimers();
    try {
      mocks.listAiProviders.mockResolvedValue([]);
      await resolveChatTargets();
      expect(mocks.listAiProviders).toHaveBeenCalledTimes(1);
      // still inside the 30s empty window
      vi.advanceTimersByTime(29_000);
      await resolveChatTargets();
      expect(mocks.listAiProviders).toHaveBeenCalledTimes(1);
      // past it — a just-configured brain must not stay invisible
      vi.advanceTimersByTime(2_000);
      await resolveChatTargets();
      expect(mocks.listAiProviders).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
