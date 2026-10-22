// F2 — the family-memory REST surface had NO auth check: middleware gates
// /api/** by session only, so any signed-in child could read/write/wipe the
// family memory bank. Every handler must run authorizeAdminRequest first
// (same idiom as /api/services/config PUT). F5 — the GET must not default to
// the 'demo-user' namespace (agent rows live under 'consuela'), and the POST
// defaults to the canonical MEMORY_USER_ID. F6.2 — client keys are slugged
// server-side before storage.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(async (): Promise<{ ok: boolean; status?: number; error?: string }> => ({ ok: true })),
  queryMemories: vi.fn(async (_q: any): Promise<any[]> => []),
  getMemoryStats: vi.fn(async () => ({ totalMemories: 0 })),
  storeMemory: vi.fn(async (..._a: any[]): Promise<any> => ({ id: "m1" })),
  updateMemory: vi.fn(async () => ({ id: "m1" })),
  deleteMemory: vi.fn(async () => true),
  incrementMemoryUsage: vi.fn(async () => {}),
}));

vi.mock("@/lib/admin-auth", () => ({ authorizeAdminRequest: mocks.authorize }));
vi.mock("@/lib/family-memory", () => ({
  queryMemories: mocks.queryMemories,
  getMemoryStats: mocks.getMemoryStats,
  storeMemory: mocks.storeMemory,
  updateMemory: mocks.updateMemory,
  deleteMemory: mocks.deleteMemory,
  incrementMemoryUsage: mocks.incrementMemoryUsage,
  // The store's own refusal check — the route asks it whether an error is a
  // REFUSAL (the schema is not live yet) or an outage.
  isMemoryRefusal: (error: any) => error?.name === "MemoryStoreError" && typeof error?.code === "string",
}));

import { GET, POST } from "@/app/api/family-memory/route";
import { subjectKey } from "@/lib/memory-subject";
import {
  PATCH,
  DELETE,
  POST as POST_USE,
} from "@/app/api/family-memory/[id]/route";

function getReq(url: string) {
  return new NextRequest(url, { method: "GET" });
}
function postReq(url: string, body: unknown, method = "POST") {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const idCtx = { params: Promise.resolve({ id: "m1" }) };

const ALL_UNAUTHORIZED: Array<[string, () => Promise<Response>]> = [
  ["GET /api/family-memory", () => GET(getReq("http://localhost/api/family-memory"))],
  ["POST /api/family-memory", async () => POST(postReq("http://localhost/api/family-memory", { content: "x" }))],
  ["PATCH /api/family-memory/[id]", async () => PATCH(postReq("http://localhost/api/family-memory/m1", { content: "y" }, "PATCH"), idCtx)],
  ["DELETE /api/family-memory/[id]", async () => DELETE(postReq("http://localhost/api/family-memory/m1", {}, "DELETE"), idCtx)],
  ["POST /api/family-memory/[id]/use", async () => POST_USE(postReq("http://localhost/api/family-memory/m1", {}), idCtx)],
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ ok: true });
  mocks.queryMemories.mockResolvedValue([]);
  mocks.storeMemory.mockResolvedValue({ id: "m1" });
});

describe("family-memory routes — parent gate (F2)", () => {
  it.each(ALL_UNAUTHORIZED)("%s 401s when authorizeAdminRequest denies", async (_name, call) => {
    mocks.authorize.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });
    const res = await call();
    expect(res.status).toBe(401);
  });

  it.each(ALL_UNAUTHORIZED)("%s 403s a child/pet session (adult_only)", async (_name, call) => {
    mocks.authorize.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
    const res = await call();
    expect(res.status).toBe(403);
  });

  it("no memory write/read happens before the gate is consulted", async () => {
    mocks.authorize.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });
    await GET(getReq("http://localhost/api/family-memory"));
    expect(mocks.queryMemories).not.toHaveBeenCalled();
    await POST(postReq("http://localhost/api/family-memory", { content: "x" }));
    expect(mocks.storeMemory).not.toHaveBeenCalled();
    await DELETE(postReq("http://localhost/api/family-memory/m1", {}, "DELETE"), idCtx);
    expect(mocks.deleteMemory).not.toHaveBeenCalled();
  });
});

describe("family-memory GET — one namespace (F5)", () => {
  it("without a userId param returns ALL demo-family rows (no 'demo-user' default filter)", async () => {
    const res = await GET(getReq("http://localhost/api/family-memory"));
    expect(res.status).toBe(200);
    const query = mocks.queryMemories.mock.calls[0][0];
    expect(query.userId).toBeUndefined();
    expect(query.familyId).toBe("demo-family");
  });

  it("an explicit userId still narrows the query", async () => {
    await GET(getReq("http://localhost/api/family-memory?userId=consuela"));
    expect(mocks.queryMemories.mock.calls[0][0].userId).toBe("consuela");
  });
});

describe("family-memory POST — canonical default + server-side key slug (F5/F6.2)", () => {
  it("defaults userId to the canonical agent namespace, not 'demo-user'", async () => {
    const res = await POST(postReq("http://localhost/api/family-memory", { content: "Bailey loves the vet" }));
    expect(res.status).toBe(201);
    expect(mocks.storeMemory.mock.calls[0][0].userId).toBe("consuela");
  });

  it("slugs a client-supplied key with the ONE shared key grammar", async () => {
    await POST(postReq("http://localhost/api/family-memory", { key: "Caspian Bedtime!", content: "x" }));
    // No trailing separator: the shared slugify trims, so a key never ends
    // in "_" (the old local slug cut at 50 characters and left one behind).
    expect(mocks.storeMemory.mock.calls[0][0].key).toBe("caspian_bedtime");
  });

  it("folds an accented client key instead of cutting the name in half", async () => {
    await POST(postReq("http://localhost/api/family-memory", { key: "person_begoña", content: "x" }));
    expect(mocks.storeMemory.mock.calls[0][0].key).toBe("person_begona");
  });

  it("derives the SAME key the agent's tool would when none is supplied", async () => {
    await POST(postReq("http://localhost/api/family-memory", { content: "Rocco hides socks" }));
    // The topic, not the wording: the console and the agent must land on one
    // key for one fact, or the same fact becomes two rows.
    expect(mocks.storeMemory.mock.calls[0][0].key).toBe("note_rocco_socks");
    expect(subjectKey({ category: "note", person: "", content: "Rocco hides socks" })).toBe("note_rocco_socks");
  });
});

/**
 * F7 — the store-failure contract at the HTTP layer.
 *
 * The house convention for an unreachable store is a 503 with a MACHINE
 * code (34 call sites under src/app/api do exactly that). The route used to
 * answer a 500 with the raw PocketBase message, which says "we have a bug"
 * when the truth is "the bank is down" — and it handed the client the
 * driver's error text.
 */
describe("family-memory routes — the store is down (F7)", () => {
  it("GET answers 503 with a machine code", async () => {
    mocks.queryMemories.mockRejectedValue(new Error("Failed to connect to the PocketBase server."));
    const res = await GET(getReq("http://localhost/api/family-memory"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("memory_store_unreachable");
    expect(JSON.stringify(body)).not.toContain("PocketBase");
  });

  it("GET ?stats=true answers 503 too", async () => {
    mocks.getMemoryStats.mockRejectedValue(new Error("Failed to connect to the PocketBase server."));
    const res = await GET(getReq("http://localhost/api/family-memory?stats=true"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("memory_store_unreachable");
  });

  it("POST answers 503 when the store could not write the fact", async () => {
    mocks.storeMemory.mockResolvedValue(null);
    const res = await POST(postReq("http://localhost/api/family-memory", { content: "x" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("memory_store_unreachable");
  });

  it("POST answers 503 with the refusal's own code when the store refused the write", async () => {
    const refusal: any = new Error("schema not live");
    refusal.name = "MemoryStoreError";
    refusal.code = "memory_schema_not_ready";
    mocks.storeMemory.mockRejectedValue(refusal);
    const res = await POST(postReq("http://localhost/api/family-memory", { content: "x" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("memory_schema_not_ready");
  });

  it("POST answers 400 for a missing content — a client error is not an outage", async () => {
    const res = await POST(postReq("http://localhost/api/family-memory", {}));
    expect(res.status).toBe(400);
    expect(mocks.storeMemory).not.toHaveBeenCalled();
  });
});
