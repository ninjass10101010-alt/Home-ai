import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  listAiProviders: vi.fn(async (): Promise<any[]> => []),
  upsertAiProvider: vi.fn(),
  deleteAiProvider: vi.fn(async () => true),
  // Mirror of the real normalizeBaseUrl (trim, strip trailing slashes + /v1).
  normalizeBaseUrl: vi.fn((raw: string) =>
    String(raw).trim().replace(/\/+$/, "").replace(/\/v1$/, "")
  ),
  authorizeAdminRequest: vi.fn(async (): Promise<{ ok: boolean; status?: number; error?: string }> => ({ ok: true })),
  verifySession: vi.fn(async (): Promise<{ name: string; role: string } | null> => ({ name: "Jeff", role: "parent" })),
  resolveChatTargets: vi.fn(async (): Promise<any[]> => []),
}));

vi.mock("@/lib/ai/providers", () => ({
  listAiProviders: mocks.listAiProviders,
  upsertAiProvider: mocks.upsertAiProvider,
  deleteAiProvider: mocks.deleteAiProvider,
  normalizeBaseUrl: mocks.normalizeBaseUrl,
}));
vi.mock("@/lib/ai/targets", () => ({
  resolveChatTargets: mocks.resolveChatTargets,
  resetAiTargetsCache: vi.fn(),
}));
vi.mock("@/lib/admin-auth", () => ({ authorizeAdminRequest: mocks.authorizeAdminRequest }));
vi.mock("@/lib/session", () => ({
  verifySession: mocks.verifySession,
  SESSION_COOKIE: "consuela_session",
}));

import { GET as providersGET, PUT as providersPUT, DELETE as providersDELETE } from "@/app/api/ai/providers/route";
import { POST as modelsPOST } from "@/app/api/ai/models/route";

function req(url: string, init?: RequestInit) {
  return new NextRequest(url, init as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mocks.verifySession.mockResolvedValue({ name: "Jeff", role: "parent" });
  mocks.authorizeAdminRequest.mockResolvedValue({ ok: true });
  mocks.resolveChatTargets.mockResolvedValue([]);
});

describe("GET /api/ai/providers", () => {
  it("401s without a session", async () => {
    mocks.verifySession.mockResolvedValue(null);
    const res = await providersGET(req("http://localhost/api/ai/providers"));
    expect(res.status).toBe(401);
  });

  it("returns masked providers with the active brain", async () => {
    mocks.listAiProviders.mockResolvedValue([
      { id: "1", displayName: "b.ai", baseUrl: "https://api.b.ai", apiKey: "sk-xyz", models: ["glm", "qwen"], enabled: true, order: 0 },
    ]);
    mocks.resolveChatTargets.mockResolvedValue([
      { url: "https://api.b.ai", key: "sk-xyz", model: "glm", provider: "b.ai", fallback: false },
      { url: "https://api.b.ai", key: "sk-xyz", model: "qwen", provider: "b.ai", fallback: true },
    ]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "glm" }] }), { status: 200 })));
    const res = await providersGET(req("http://localhost/api/ai/providers"));
    const body = await res.json();
    expect(body.active).toEqual({ provider: "b.ai", model: "glm" });
    expect(body.providers[0].keyPreview).toBe("yz"); // 2-char suffix of "sk-xyz", never the key
    expect(body.providers[0].apiKey).toBeUndefined();
    expect(body.providers[0].status).toBe("ok");
  });

  it("reports unreachable when the provider ping fails", async () => {
    mocks.listAiProviders.mockResolvedValue([
      { id: "1", displayName: "down", baseUrl: "https://down.ai", apiKey: null, models: ["m"], enabled: true, order: 0 },
    ]);
    mocks.resolveChatTargets.mockResolvedValue([
      { url: "https://down.ai", key: null, model: "m", provider: "down", fallback: false },
    ]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const res = await providersGET(req("http://localhost/api/ai/providers"));
    const body = await res.json();
    expect(body.providers[0].status).toBe("unreachable");
  });

  // The "No brain configured" LIE (2026-09-16): the old GET computed `active`
  // from the consuela_ai_providers table ONLY, so a working legacy/env fallback
  // chain (FALLBACK_* / AI_PROVIDER_*) rendered as "No brain configured — add a
  // provider below." while chat happily answered. `active` must come from
  // resolveChatTargets() — the same resolver chat uses — and the env chain
  // must be surfaceable as read-only pseudo-provider entries.
  it("reports the real active brain from the resolved chain, even when it is the env fallback", async () => {
    mocks.listAiProviders.mockResolvedValue([]); // no dashboard providers at all
    mocks.resolveChatTargets.mockResolvedValue([
      { url: "https://router.internal", key: "k1", model: "glm-5.3-flash", provider: "fallback", fallback: false },
      { url: "https://router.internal", key: "k1", model: "qwen3.8-flash", provider: "fallback", fallback: true },
    ]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "x" }] }), { status: 200 })));
    const res = await providersGET(req("http://localhost/api/ai/providers"));
    const body = await res.json();
    expect(body.active).toEqual({ provider: "fallback", model: "glm-5.3-flash" });
    // The env chain is exposed as a READ-ONLY pseudo-provider group so the card
    // can show what's actually answering instead of a bare "No brain" lie.
    const envGroup = body.envProviders?.[0];
    expect(envGroup).toBeDefined();
    expect(envGroup.readOnly).toBe(true);
    expect(envGroup.baseUrl).toBe("https://router.internal");
    expect(envGroup.models).toEqual(["glm-5.3-flash", "qwen3.8-flash"]);
    expect(envGroup.keyPreview).toBe("k1"); // 2-char preview only
  });

  it("omits envProviders entirely when the resolved chain IS a dashboard provider", async () => {
    mocks.listAiProviders.mockResolvedValue([
      { id: "1", displayName: "b.ai", baseUrl: "https://api.b.ai", apiKey: "sk-xyz", models: ["glm"], enabled: true, order: 0 },
    ]);
    mocks.resolveChatTargets.mockResolvedValue([
      { url: "https://api.b.ai", key: "sk-xyz", model: "glm", provider: "b.ai", fallback: false },
    ]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "glm" }] }), { status: 200 })));
    const res = await providersGET(req("http://localhost/api/ai/providers"));
    const body = await res.json();
    expect(body.envProviders).toBeUndefined();
  });

  it("sends the provider's key on the status probe so keyed providers don't read unreachable", async () => {
    mocks.listAiProviders.mockResolvedValue([
      { id: "1", displayName: "keyed", baseUrl: "https://api.b.ai", apiKey: "sk-key-42", models: ["m"], enabled: true, order: 0 },
    ]);
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ data: [{ id: "m" }] }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await providersGET(req("http://localhost/api/ai/providers"));
    const body = await res.json();
    expect(body.providers[0].status).toBe("ok");
    const probeCall = fetchMock.mock.calls.find((c: any[]) =>
      String(c[0]).endsWith("/v1/models")
    );
    expect(probeCall).toBeTruthy();
    expect((probeCall![1] as any).headers.Authorization).toBe("Bearer sk-key-42");
  });
});

describe("PUT /api/ai/providers", () => {
  it("requires admin", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
    const res = await providersPUT(req("http://localhost/api/ai/providers", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "x", baseUrl: "https://x", models: ["m"] }),
    }));
    expect(res.status).toBe(403);
  });

  it("400s on invalid input and 200s on success", async () => {
    mocks.upsertAiProvider.mockRejectedValue(new Error("at least one model is required"));
    const bad = await providersPUT(req("http://localhost/api/ai/providers", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "x", baseUrl: "https://x", models: [] }),
    }));
    expect(bad.status).toBe(400);

    mocks.upsertAiProvider.mockResolvedValue({ id: "1", displayName: "b.ai", baseUrl: "https://api.b.ai", apiKey: "k", models: ["glm"], enabled: true, order: 0 });
    const ok = await providersPUT(req("http://localhost/api/ai/providers", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "b.ai", baseUrl: "https://api.b.ai", models: ["glm"] }),
    }));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.provider.keyPreview).toBeUndefined(); // PUT response must not leak previews either
    expect(body.provider.models).toEqual(["glm"]);
  });
});

describe("DELETE /api/ai/providers", () => {
  it("requires admin and deletes by id", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
    const denied = await providersDELETE(req("http://localhost/api/ai/providers?id=1"));
    expect(denied.status).toBe(403);
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: true });
    const ok = await providersDELETE(req("http://localhost/api/ai/providers?id=1"));
    expect(ok.status).toBe(200);
    expect(mocks.deleteAiProvider).toHaveBeenCalledWith("1");
  });
});

describe("POST /api/ai/models", () => {
  it("requires admin", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
    const res = await modelsPOST(req("http://localhost/api/ai/models", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://x" }),
    }));
    expect(res.status).toBe(403);
  });

  it("lists models from the provider (OpenAI shape)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      expect(url).toBe("https://api.b.ai/v1/models");
      return new Response(JSON.stringify({ data: [{ id: "glm-5.3-flash" }, { id: "qwen3.8-flash" }] }), { status: 200 });
    }));
    const res = await modelsPOST(req("http://localhost/api/ai/models", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://api.b.ai/v1", apiKey: "sk" }),
    }));
    const body = await res.json();
    expect(body.models.map((m: any) => m.id)).toEqual(["glm-5.3-flash", "qwen3.8-flash"]);
  });

  it("400s when the upstream listing fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    const res = await modelsPOST(req("http://localhost/api/ai/models", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://api.b.ai" }),
    }));
    expect(res.status).toBe(400);
  });
});
