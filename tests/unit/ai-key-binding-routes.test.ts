import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Fake credentials only — never a real key.
const STORED_KEY = "test-key-placeholder-stored";
const TYPED_KEY = "test-key-placeholder-typed";

const mocks = vi.hoisted(() => ({
  listAiProviders: vi.fn(async (): Promise<any[]> => []),
  upsertAiProvider: vi.fn(),
  deleteAiProvider: vi.fn(async () => true),
  normalizeBaseUrl: vi.fn((raw: string) => String(raw).trim().replace(/\/+$/, "").replace(/\/v1$/, "")),
  authorizeAdminRequest: vi.fn(async (): Promise<any> => ({ ok: true })),
  authorizeCurrentParentRequest: vi.fn(async (): Promise<any> => ({ ok: true, member: { id: "m1", role: "parent" } })),
  resolveChatTargets: vi.fn(async (): Promise<any[]> => []),
  getRecentOutcomes: vi.fn((): any[] => []),
  summarizeOutcomes: vi.fn((): any => ({ total: 0, lastFailure: null })),
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
vi.mock("@/lib/server-auth", () => ({ authorizeCurrentParentRequest: mocks.authorizeCurrentParentRequest }));
vi.mock("@/lib/ai/health", () => ({
  getRecentOutcomes: mocks.getRecentOutcomes,
  summarizeOutcomes: mocks.summarizeOutcomes,
}));

import { POST as modelsPOST } from "@/app/api/ai/models/route";
import { GET as providersGET, PUT as providersPUT } from "@/app/api/ai/providers/route";
import { GET as healthGET } from "@/app/api/ai/health/route";

function req(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  } as any);
}

/** Everything the route sent upstream, flattened for leak assertions. */
function outbound(fetchMock: any): string {
  return JSON.stringify(fetchMock.mock.calls ?? []);
}

const storedProviders = [
  { id: "1", displayName: "b.ai", baseUrl: "https://api.b.ai", apiKey: STORED_KEY, models: ["glm"], enabled: true, order: 0 },
];

let fetchMock: any;
let logs: string[];

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "glm" }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  logs = [];
  for (const level of ["error", "warn", "log"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => (typeof a === "string" ? a : safe(a))).join(" "));
    });
  }
  mocks.authorizeAdminRequest.mockResolvedValue({ ok: true });
  mocks.authorizeCurrentParentRequest.mockResolvedValue({ ok: true, member: { id: "m1", role: "parent" } });
  mocks.listAiProviders.mockResolvedValue(storedProviders);
  mocks.resolveChatTargets.mockResolvedValue([]);
  mocks.getRecentOutcomes.mockReturnValue([]);
  mocks.summarizeOutcomes.mockReturnValue({ total: 0, ok: 0, wrapup: 0, exhausted: 0, snag: 0, clientGone: 0, unconfigured: 0, avgMs: 0, lastFailure: null });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function safe(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

describe("POST /api/ai/models — a stored key is bound to its own provider", () => {
  it("uses the stored key against the provider's OWN endpoint", async () => {
    const res = await modelsPOST(req("http://localhost/api/ai/models", { providerId: "1", baseUrl: "https://api.b.ai" }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.b.ai/v1/models");
    expect((init as any).headers.Authorization).toBe(`Bearer ${STORED_KEY}`);
  });

  it("still works when the client omits the endpoint entirely", async () => {
    const res = await modelsPOST(req("http://localhost/api/ai/models", { providerId: "1" }));
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.b.ai/v1/models");
    expect((fetchMock.mock.calls[0][1] as any).headers.Authorization).toBe(`Bearer ${STORED_KEY}`);
  });

  // THE P1 BUG: providerId for the key + an attacker-chosen baseUrl.
  it("never transmits the stored key to a caller-supplied baseUrl", async () => {
    const res = await modelsPOST(
      req("http://localhost/api/ai/models", { providerId: "1", baseUrl: "https://attacker.example/collect" })
    );
    expect(res.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.code).toBe("stored_key_endpoint_conflict");
    expect(body.error).toMatch(/endpoint/i); // a sentence the card can show verbatim
    expect(JSON.stringify(body)).not.toContain(STORED_KEY);
  });

  it("never transmits the stored key when a typed key retargets the endpoint", async () => {
    const res = await modelsPOST(
      req("http://localhost/api/ai/models", {
        providerId: "1",
        baseUrl: "https://new-gateway.example",
        apiKey: TYPED_KEY,
      })
    );
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://new-gateway.example/v1/models");
    // The typed key goes out; the STORED secret must not, not even in another header.
    expect((fetchMock.mock.calls[0][1] as any).headers.Authorization).toBe(`Bearer ${TYPED_KEY}`);
    expect(outbound(fetchMock)).not.toContain(STORED_KEY);
  });

  it("does not probe unkeyed when the providerId is unknown", async () => {
    mocks.listAiProviders.mockResolvedValue([]);
    const res = await modelsPOST(req("http://localhost/api/ai/models", { providerId: "ghost", baseUrl: "https://api.b.ai" }));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-http(s) endpoint without fetching", async () => {
    const res = await modelsPOST(req("http://localhost/api/ai/models", { baseUrl: "javascript:alert(1)", apiKey: "k" }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still lists models for a brand-new unsaved draft (add-provider UX)", async () => {
    const res = await modelsPOST(
      req("http://localhost/api/ai/models", { baseUrl: "https://brand-new.example/v1", apiKey: TYPED_KEY })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.models.map((m: any) => m.id)).toEqual(["glm"]);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://brand-new.example/v1/models");
  });

  it("redacts an upstream error body echoing key material from both the response and the log", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { message: `Incorrect API key provided: ${STORED_KEY}. Check your dashboard.` },
        }),
        { status: 401 }
      )
    );
    const res = await modelsPOST(req("http://localhost/api/ai/models", { providerId: "1", baseUrl: "https://api.b.ai" }));
    expect(res.status).toBe(400);
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain(STORED_KEY);
    expect(raw).toContain("Incorrect API key provided"); // still actionable for the admin
    expect(logs.join("\n")).not.toContain(STORED_KEY);
  });

  it("does not echo a thrown upstream error message verbatim", async () => {
    fetchMock.mockRejectedValueOnce(new Error(`connect ECONNREFUSED with Authorization: Bearer ${STORED_KEY}`));
    const res = await modelsPOST(req("http://localhost/api/ai/models", { providerId: "1" }));
    expect(res.status).toBe(400);
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain(STORED_KEY);
    expect(logs.join("\n")).not.toContain(STORED_KEY);
  });

  it("keeps the admin gate", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
    const res = await modelsPOST(req("http://localhost/api/ai/models", { providerId: "1" }));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("PUT /api/ai/providers — blank key keeps the stored key bound to the stored endpoint", () => {
  const save = (body: unknown) => providersPUT(req("http://localhost/api/ai/providers", body));

  it("allows an unchanged endpoint with a blank key (unchanged contract)", async () => {
    mocks.upsertAiProvider.mockResolvedValue({ ...storedProviders[0] });
    const res = await save({ id: "1", displayName: "b.ai", baseUrl: "https://api.b.ai", models: ["glm"], apiKey: "" });
    expect(res.status).toBe(200);
    expect(mocks.upsertAiProvider).toHaveBeenCalledWith(expect.objectContaining({ id: "1", apiKey: "" }));
  });

  it("REFUSES to rebind a stored key to a different endpoint with a blank key", async () => {
    const res = await save({ id: "1", displayName: "b.ai", baseUrl: "https://attacker.example", models: ["glm"], apiKey: "" });
    expect(res.status).toBe(409);
    expect(mocks.upsertAiProvider).not.toHaveBeenCalled();
    expect(JSON.stringify(await res.json())).not.toContain(STORED_KEY);
  });

  it("allows the endpoint change when that endpoint's key is supplied", async () => {
    mocks.upsertAiProvider.mockResolvedValue({ ...storedProviders[0], baseUrl: "https://new-gateway.example", apiKey: TYPED_KEY });
    const res = await save({ id: "1", displayName: "b.ai", baseUrl: "https://new-gateway.example", models: ["glm"], apiKey: TYPED_KEY });
    expect(res.status).toBe(200);
    expect(mocks.upsertAiProvider).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://new-gateway.example", apiKey: TYPED_KEY })
    );
  });

  it("treats a whitespace-only key as blank (no smuggling the conflict past the gate)", async () => {
    const res = await save({ id: "1", displayName: "b.ai", baseUrl: "https://attacker.example", models: ["glm"], apiKey: "   " });
    expect(res.status).toBe(409);
    expect(mocks.upsertAiProvider).not.toHaveBeenCalled();
  });

  // Nothing to rebind: a provider with no stored secret may move freely.
  it("allows an endpoint change for a provider that has no stored key", async () => {
    mocks.listAiProviders.mockResolvedValue([
      { id: "2", displayName: "keyless", baseUrl: "https://router.internal", apiKey: null, models: ["m"], enabled: true, order: 0 },
    ]);
    mocks.upsertAiProvider.mockResolvedValue({ id: "2", baseUrl: "https://elsewhere.internal", apiKey: null, models: ["m"] });
    const res = await save({ id: "2", displayName: "keyless", baseUrl: "https://elsewhere.internal", models: ["m"], apiKey: "" });
    expect(res.status).toBe(200);
    expect(mocks.upsertAiProvider).toHaveBeenCalledWith(expect.objectContaining({ id: "2", apiKey: "" }));
  });

  // Fail closed: a store read that cannot confirm the provider must not become a
  // silent skip of the rebind check (upsert would keep the stored ciphertext).
  it("fails closed when the provider store cannot be read", async () => {
    mocks.listAiProviders.mockResolvedValue([]); // e.g. a PocketBase blip swallowed by the store layer
    const res = await save({ id: "1", displayName: "b.ai", baseUrl: "https://attacker.example", models: ["glm"], apiKey: "" });
    expect(res.status).toBe(409);
    expect(mocks.upsertAiProvider).not.toHaveBeenCalled();
  });

  it("still saves a brand-new provider (no id) with a typed key", async () => {
    mocks.upsertAiProvider.mockResolvedValue({ id: "new", baseUrl: "https://brand-new.example", apiKey: TYPED_KEY, models: ["m"] });
    const res = await save({ displayName: "new", baseUrl: "https://brand-new.example", models: ["m"], apiKey: TYPED_KEY });
    expect(res.status).toBe(200);
    expect(mocks.upsertAiProvider).toHaveBeenCalledWith(expect.objectContaining({ id: undefined, apiKey: TYPED_KEY }));
  });

  it("never returns key material in the PUT response", async () => {
    mocks.upsertAiProvider.mockResolvedValue({ ...storedProviders[0], apiKey: STORED_KEY });
    const res = await save({ id: "1", displayName: "b.ai", baseUrl: "https://api.b.ai", models: ["glm"] });
    const raw = JSON.stringify(await res.json());
    expect(res.status).toBe(200);
    expect(raw).not.toContain(STORED_KEY);
    expect(raw).not.toContain("apiKey");
  });

  it("redacts a store-layer error message that echoes key material", async () => {
    mocks.upsertAiProvider.mockRejectedValue(new Error(`pocketbase rejected key ${STORED_KEY}`));
    const res = await save({ displayName: "x", baseUrl: "https://x.example", models: ["m"], apiKey: "k" });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain(STORED_KEY);
  });

  it("keeps the admin gate", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
    const res = await save({ id: "1", displayName: "b.ai", baseUrl: "https://attacker.example", models: ["glm"], apiKey: "" });
    expect(res.status).toBe(403);
    expect(mocks.upsertAiProvider).not.toHaveBeenCalled();
  });
});

describe("GET /api/ai/providers — the health probe stays on the stored endpoint", () => {
  it("probes only the stored baseUrl and never echoes the stored key", async () => {
    mocks.resolveChatTargets.mockResolvedValue([
      { url: "https://api.b.ai", key: STORED_KEY, model: "glm", provider: "b.ai", fallback: false },
    ]);
    const res = await providersGET(req("http://localhost/api/ai/providers"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.b.ai/v1/models");
    expect((fetchMock.mock.calls[0][1] as any).headers.Authorization).toBe(`Bearer ${STORED_KEY}`);
    expect(JSON.stringify(body)).not.toContain(STORED_KEY);
    expect(body.providers[0].apiKey).toBeUndefined();
  });

  it("keeps a failing probe's key-echoing upstream body out of the panel and the log", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: `bad key ${STORED_KEY}` } }), { status: 401 })
    );
    const res = await providersGET(req("http://localhost/api/ai/providers"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.providers[0].status).toBe("unreachable");
    expect(JSON.stringify(body)).not.toContain(STORED_KEY);
    expect(logs.join("\n")).not.toContain(STORED_KEY);
  });

  it("does not leak key material through the store-failure path", async () => {
    mocks.listAiProviders.mockRejectedValue(new Error(`pocketbase down while decrypting ${STORED_KEY}`));
    const res = await providersGET(req("http://localhost/api/ai/providers"));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain(STORED_KEY);
    expect(logs.join("\n")).not.toContain(STORED_KEY);
  });
});

describe("GET /api/ai/health — the parent-facing panel is redacted", () => {
  it("redacts an upstream error body that reached recordChatOutcome via the chat route", async () => {
    const leaked = `AI glm 401: {"error":{"message":"Incorrect API key provided: ${STORED_KEY}"}}`;
    const failure = { ts: Date.now(), outcome: "snag", agent: "consuela", rounds: 1, ms: 5, brain: "b.ai/glm", targets: 1, reason: leaked };
    mocks.getRecentOutcomes.mockReturnValue([failure]);
    mocks.summarizeOutcomes.mockReturnValue({
      total: 1, ok: 0, wrapup: 0, exhausted: 0, snag: 1, clientGone: 0, unconfigured: 0, avgMs: 5, lastFailure: failure,
    });
    const res = await healthGET(req("http://localhost/api/ai/health"));
    const raw = JSON.stringify(await res.json());
    expect(res.status).toBe(200);
    expect(raw).not.toContain(STORED_KEY);
    expect(raw).toContain("Incorrect API key provided"); // the failure is still legible
  });

  it("keeps the parent gate", async () => {
    mocks.authorizeCurrentParentRequest.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });
    const res = await healthGET(req("http://localhost/api/ai/health"));
    expect(res.status).toBe(401);
  });
});
