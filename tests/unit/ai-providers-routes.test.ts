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
}));

vi.mock("@/lib/ai/providers", () => ({
  listAiProviders: mocks.listAiProviders,
  upsertAiProvider: mocks.upsertAiProvider,
  deleteAiProvider: mocks.deleteAiProvider,
  normalizeBaseUrl: mocks.normalizeBaseUrl,
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
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const res = await providersGET(req("http://localhost/api/ai/providers"));
    const body = await res.json();
    expect(body.providers[0].status).toBe("unreachable");
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
