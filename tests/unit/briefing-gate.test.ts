import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// F3 — /api/consuela/briefing was in the middleware API_EXEMPT list AND had no
// in-route check, so anyone could GET the family briefing and PATCH/ack it
// (hiding it for the family). It is now session-gated on BOTH verbs, and the
// ack records who acknowledged it.
const dbMock = vi.hoisted(() => ({
  selectMorningBriefing: vi.fn(async (): Promise<any> => null),
  ackMorningBriefing: vi.fn(async (..._a: any[]): Promise<any> => ({})),
}));

vi.mock("@/db", () => ({ db: dbMock }));

vi.mock("@/lib/session", () => ({
  verifySession: vi.fn(async (cookie?: string) =>
    cookie ? { memberId: "m1", name: "Rebecca Garcia", role: "parent" } : null
  ),
  SESSION_COOKIE: "consuela_session",
}));

const pbMocks = vi.hoisted(() => ({ update: vi.fn(), handle: null as any }));
vi.mock("@/lib/pb-auth", () => ({
  withAdmin: async (fn: (pb: any) => Promise<any>) => fn(pbMocks.handle),
}));

import { GET, PATCH } from "@/app/api/consuela/briefing/route";
import { db as pbDb } from "@/db/pb-db";

const COOKIE = "consuela_session=tok";

function getReq(cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/consuela/briefing", {
    headers: cookie ? { cookie } : {},
  });
}
function patchReq(body: unknown, cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/consuela/briefing", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  dbMock.selectMorningBriefing.mockReset();
  dbMock.selectMorningBriefing.mockResolvedValue(null);
  dbMock.ackMorningBriefing.mockReset();
  dbMock.ackMorningBriefing.mockResolvedValue({});
  pbMocks.update.mockReset();
  pbMocks.handle = { collection: () => ({ update: pbMocks.update }) };
});

describe("briefing gate (F3)", () => {
  it("401s a guest GET and never reads PocketBase", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(dbMock.selectMorningBriefing).not.toHaveBeenCalled();
  });

  it("allows a session GET and returns the briefing", async () => {
    dbMock.selectMorningBriefing.mockResolvedValueOnce({ id: "b1", scopeDate: "2026-09-15" });
    const res = await GET(getReq(COOKIE));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      briefing: { id: "b1", scopeDate: "2026-09-15" },
    });
  });

  it("401s a guest PATCH and never writes PocketBase", async () => {
    const res = await PATCH(patchReq({ id: "b1" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(dbMock.ackMorningBriefing).not.toHaveBeenCalled();
  });

  it("allows a session PATCH and records who acknowledged it", async () => {
    const res = await PATCH(patchReq({ id: "b1" }, COOKIE));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(dbMock.ackMorningBriefing).toHaveBeenCalledWith("b1", "Rebecca Garcia");
  });

  it("keeps the 400 when the PATCH body has no id (a session is still required first)", async () => {
    const guest = await PATCH(patchReq({}));
    expect(guest.status).toBe(401);
    const sessioned = await PATCH(patchReq({}, COOKIE));
    expect(sessioned.status).toBe(400);
    expect(await sessioned.json()).toEqual({ error: "id required" });
  });
});

describe("ackMorningBriefing PB payload carries acknowledgedBy", () => {
  it("stamps the name into the update payload", async () => {
    await pbDb.ackMorningBriefing("b1", "Rebecca Garcia");
    expect(pbMocks.update).toHaveBeenCalledWith("b1", {
      acknowledged: true,
      acknowledgedBy: "Rebecca Garcia",
    });
  });

  it("omits acknowledgedBy when no name is supplied", async () => {
    await pbDb.ackMorningBriefing("b1");
    expect(pbMocks.update).toHaveBeenCalledWith("b1", { acknowledged: true });
  });
});
