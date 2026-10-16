import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  requireLiveSession: vi.fn(),
  getServiceConfig: vi.fn(),
  pushFanout: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/server-auth", () => ({
  requireLiveSession: (...a: unknown[]) => mocks.requireLiveSession(...a),
}));

vi.mock("@/lib/services/config", () => ({
  getServiceConfig: (...a: unknown[]) => mocks.getServiceConfig(...a),
}));

vi.mock("@/lib/push/fanout", () => ({
  pushFanout: (...a: unknown[]) => mocks.pushFanout(...a),
}));

import { GET as vapidGET } from "@/app/api/push/vapid-public/route";
import { POST as subscribePOST, DELETE as subscribeDELETE } from "@/app/api/push/subscribe/route";
import { POST as testPOST } from "@/app/api/push/test/route";

function req(path: string, method: string, body?: unknown, cookie?: string) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function pbWith(collection: any) {
  return { collection: () => collection };
}

describe("push routes", () => {
  beforeEach(() => {
    vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
    mocks.withAdmin.mockReset();
    mocks.requireLiveSession.mockReset();
    mocks.getServiceConfig.mockReset();
    mocks.pushFanout.mockReset();
    mocks.requireLiveSession.mockResolvedValue({ ok: true, identity: { name: "Rebecca" }, status: 200 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("GET vapid-public returns configured key", async () => {
    mocks.getServiceConfig.mockResolvedValue("PUBKEY");
    const res = await vapidGET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, publicKey: "PUBKEY" });
  });

  it("POST subscribe creates when absent", async () => {
    const getFirstListItem = vi.fn().mockRejectedValue({ status: 404 });
    const create = vi.fn().mockResolvedValue({ id: "new" });
    const update = vi.fn();
    const getFullList = vi.fn().mockResolvedValue([]);
    const del = vi.fn();
    const collection = { getFirstListItem, create, update, getFullList, delete: del };
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(pbWith(collection)));

    const res = await subscribePOST(req("/api/push/subscribe", "POST", {
      endpoint: "https://e/1",
      keys: { p256dh: "p", auth: "a" },
      deviceLabel: "phone",
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(getFirstListItem).toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("POST subscribe updates when present", async () => {
    const getFirstListItem = vi.fn().mockResolvedValue({ id: "row1" });
    const create = vi.fn();
    const update = vi.fn().mockResolvedValue({ id: "row1" });
    const getFullList = vi.fn().mockResolvedValue([]);
    const del = vi.fn();
    const collection = { getFirstListItem, create, update, getFullList, delete: del };
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(pbWith(collection)));

    const res = await subscribePOST(req("/api/push/subscribe", "POST", {
      endpoint: "https://e/1",
      keys: { p256dh: "p", auth: "a" },
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith("row1", expect.any(Object));
    expect(create).not.toHaveBeenCalled();
  });

  it("DELETE removes", async () => {
    const getFirstListItem = vi.fn().mockResolvedValue({ id: "row1" });
    const del = vi.fn().mockResolvedValue({});
    const collection = { getFirstListItem, delete: del };
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(pbWith(collection)));

    const res = await subscribeDELETE(req("/api/push/subscribe", "DELETE", { endpoint: "https://e/1" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(del).toHaveBeenCalledWith("row1");
  });

  it("POST test rejected for non-parent", async () => {
    mocks.requireLiveSession.mockResolvedValueOnce({ ok: false, status: 403, error: "adult_only" });
    const res = await testPOST(req("/api/push/test", "POST", {}));
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toBe("adult_only");
    expect(mocks.pushFanout).not.toHaveBeenCalled();
  });

  it("POST test fans out for parent", async () => {
    mocks.requireLiveSession.mockResolvedValueOnce({ ok: true, identity: { name: "Rebecca" } });
    mocks.pushFanout.mockResolvedValue({ sent: 1, pruned: 0, failed: 0 });
    const res = await testPOST(req("/api/push/test", "POST", {}));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mocks.pushFanout).toHaveBeenCalled();
  });
});
