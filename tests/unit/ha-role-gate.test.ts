import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// F4 — the four MUTATING /api/ha/* routes were session-gated by middleware but
// had no role check, so a child or a pet session could control devices and fire
// real notifications. Each mutating handler now runs authorizeAdminRequest
// (the parent allowlist from F7). Read-only HA routes (health, notify-prefs GET)
// stay session-level.
const mocks = vi.hoisted(() => ({
  authorize: vi.fn(async (): Promise<{ ok: boolean; status?: number; error?: string }> => ({ ok: true })),
  callService: vi.fn(async (..._a: any[]): Promise<any> => ({ ok: true })),
  getHAWebSocketClient: vi.fn(),
  getHABridgeStatus: vi.fn(() => ({ started: true, wsConnected: true, mqttStatus: "connected", lastEventAt: null })),
  sendHANotification: vi.fn(async (..._a: any[]): Promise<any> => undefined),
  sendTelegramMessage: vi.fn(async (..._a: any[]): Promise<any> => ({ success: true })),
  create: vi.fn(async (..._a: any[]): Promise<any> => ({ id: "new" })),
  update: vi.fn(async (..._a: any[]): Promise<any> => ({ id: "x" })),
  getFullList: vi.fn(async (): Promise<any[]> => []),
  getFirstListItem: vi.fn(async (): Promise<any> => {
    throw { status: 404 };
  }),
}));

vi.mock("@/lib/admin-auth", () => ({ authorizeAdminRequest: mocks.authorize }));
vi.mock("@/lib/ha/websocket-client", () => ({ getHAWebSocketClient: mocks.getHAWebSocketClient }));
vi.mock("@/lib/ha/bridge", () => ({ getHABridgeStatus: mocks.getHABridgeStatus }));
vi.mock("@/lib/ha/notify", () => ({ sendHANotification: mocks.sendHANotification }));
vi.mock("@/lib/free-communication", () => ({ sendTelegramMessage: mocks.sendTelegramMessage }));
vi.mock("@/lib/pb-auth", () => ({
  withAdmin: async (fn: (pb: any) => Promise<any>) =>
    fn({
      collection: () => ({
        getFullList: mocks.getFullList,
        getFirstListItem: mocks.getFirstListItem,
        create: mocks.create,
        update: mocks.update,
      }),
    }),
}));

import { POST as callServicePOST } from "@/app/api/ha/call-service/route";
import { POST as notifyConfigPOST } from "@/app/api/ha/notify-config/route";
import { GET as notifyPrefsGET, POST as notifyPrefsPOST } from "@/app/api/ha/notify-prefs/route";
import { POST as notifyTestPOST } from "@/app/api/ha/notify-test/route";
import { GET as healthGET } from "@/app/api/ha/health/route";

type Role = "parent" | "child" | "pet" | "guest";

function gate(role: Role) {
  if (role === "parent") mocks.authorize.mockResolvedValue({ ok: true });
  else if (role === "guest") mocks.authorize.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });
  else mocks.authorize.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
}

function post(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ ok: true });
  mocks.getHAWebSocketClient.mockResolvedValue({
    status: "connected",
    callService: mocks.callService,
  });
  mocks.getFirstListItem.mockRejectedValue({ status: 404 });
});

const CALL_BODY = { domain: "light", service: "turn_on", serviceData: { entity_id: "light.kitchen" } };

describe("POST /api/ha/call-service — parent gate (F4)", () => {
  it("403s a child session (adult_only) without touching HA", async () => {
    gate("child");
    const res = await callServicePOST(post("/api/ha/call-service", CALL_BODY));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "adult_only" });
    expect(mocks.callService).not.toHaveBeenCalled();
  });

  it("403s a pet session (adult_only)", async () => {
    gate("pet");
    const res = await callServicePOST(post("/api/ha/call-service", CALL_BODY));
    expect(res.status).toBe(403);
    expect(mocks.callService).not.toHaveBeenCalled();
  });

  it("401s a guest session", async () => {
    gate("guest");
    const res = await callServicePOST(post("/api/ha/call-service", CALL_BODY));
    expect(res.status).toBe(401);
    expect(mocks.callService).not.toHaveBeenCalled();
  });

  it("lets a parent through and forwards the call", async () => {
    gate("parent");
    const res = await callServicePOST(post("/api/ha/call-service", CALL_BODY));
    expect(res.status).toBe(200);
    expect(mocks.callService).toHaveBeenCalledWith("light", "turn_on", { entity_id: "light.kitchen" });
  });
});

describe("POST /api/ha/notify-config — parent gate (F4)", () => {
  const BODY = { target: "mobile_app_phone", enabled: true };
  it("403s child / pet", async () => {
    for (const role of ["child", "pet"] as const) {
      gate(role);
      const res = await notifyConfigPOST(post("/api/ha/notify-config", BODY));
      expect(res.status).toBe(403);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("lets a parent write the config", async () => {
    gate("parent");
    const res = await notifyConfigPOST(post("/api/ha/notify-config", BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.create).toHaveBeenCalled();
  });
});

describe("POST /api/ha/notify-prefs — parent gate (F4); GET stays session-level", () => {
  const BODY = { key: "weather", enabled: true };
  it("403s child / pet and 401s a guest", async () => {
    for (const role of ["child", "pet"] as const) {
      gate(role);
      const res = await notifyPrefsPOST(post("/api/ha/notify-prefs", BODY));
      expect(res.status).toBe(403);
    }
    gate("guest");
    expect((await notifyPrefsPOST(post("/api/ha/notify-prefs", BODY))).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("lets a parent write a pref", async () => {
    gate("parent");
    const res = await notifyPrefsPOST(post("/api/ha/notify-prefs", BODY));
    expect(res.status).toBe(200);
    expect(mocks.create).toHaveBeenCalled();
  });
  it("GET is ungated by role (no authorizeAdminRequest call)", async () => {
    mocks.getFullList.mockResolvedValueOnce([]);
    const res = await notifyPrefsGET();
    expect(res.status).toBe(200);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
});

describe("POST /api/ha/notify-test — parent gate (F4)", () => {
  const BODY = { target: "mobile_app_phone" };
  it("403s child / pet without sending", async () => {
    for (const role of ["child", "pet"] as const) {
      gate(role);
      const res = await notifyTestPOST(post("/api/ha/notify-test", BODY));
      expect(res.status).toBe(403);
    }
    expect(mocks.sendHANotification).not.toHaveBeenCalled();
  });
  it("lets a parent fire the test", async () => {
    gate("parent");
    const res = await notifyTestPOST(post("/api/ha/notify-test", BODY));
    expect(res.status).toBe(200);
    expect(mocks.sendHANotification).toHaveBeenCalledWith(
      "mobile_app_phone",
      "🔔 Test from Consuela",
      "This is a notification test from your family dashboard 🏠"
    );
  });
});

describe("GET /api/ha/health — read-only, reaches even a child session", () => {
  it("returns 200 and never consults the role gate", async () => {
    gate("child");
    const res = await healthGET();
    expect(res.status).toBe(200);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
});
