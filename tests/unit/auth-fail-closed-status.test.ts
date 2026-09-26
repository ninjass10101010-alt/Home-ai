import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ authorizeAdminRequest: mocks.authorize }));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: vi.fn() }));
vi.mock("@/lib/ha/websocket-client", () => ({ getHAWebSocketClient: vi.fn() }));
vi.mock("@/lib/ha/notify", () => ({ sendHANotification: vi.fn() }));
vi.mock("@/lib/ha/bridge", () => ({ resetHABridge: vi.fn(), startHABridge: vi.fn() }));
vi.mock("@/lib/free-communication", () => ({ sendTelegramMessage: vi.fn() }));
vi.mock("@/lib/family-memory", () => ({
  queryMemories: vi.fn(async () => []),
  getFamilyMemories: vi.fn(async () => []),
  getMemoryStats: vi.fn(async () => ({ totalMemories: 0 })),
  updateMemory: vi.fn(async () => ({})),
  deleteMemory: vi.fn(async () => true),
  incrementMemoryUsage: vi.fn(async () => {}),
}));

import { POST as callServicePOST } from "@/app/api/ha/call-service/route";
import { POST as notifyConfigPOST } from "@/app/api/ha/notify-config/route";
import { POST as notifyPrefsPOST } from "@/app/api/ha/notify-prefs/route";
import { POST as notifyTestPOST } from "@/app/api/ha/notify-test/route";
import {
  GET as memoryGET,
  POST as memoryPOST,
} from "@/app/api/family-memory/route";
import {
  PATCH as memoryPATCH,
  DELETE as memoryDELETE,
  POST as memoryUsePOST,
} from "@/app/api/family-memory/[id]/route";
import { PUT as servicesConfigPUT, DELETE as servicesConfigDELETE } from "@/app/api/services/config/route";
import { POST as servicesImportPOST } from "@/app/api/services/import/route";
import { POST as haReconnectPOST } from "@/app/api/services/home-assistant/reconnect/route";
import { authorizeMuseRequest } from "@/lib/muse/auth";
import { verifyLiveParentSession } from "@/lib/live-member";

const ID_CTX = { params: Promise.resolve({ id: "m1" }) };

function post(url: string, body: unknown = {}, method = "POST"): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function put(url: string, body: unknown = {}): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function get(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: "GET" });
}

const SITES: Array<[string, () => Promise<Response>]> = [
  ["POST /api/ha/call-service", () => callServicePOST(post("/api/ha/call-service"))],
  ["POST /api/ha/notify-config", () => notifyConfigPOST(post("/api/ha/notify-config"))],
  ["POST /api/ha/notify-prefs", () => notifyPrefsPOST(post("/api/ha/notify-prefs"))],
  ["POST /api/ha/notify-test", () => notifyTestPOST(post("/api/ha/notify-test"))],
  ["GET /api/family-memory", () => memoryGET(get("/api/family-memory"))],
  ["POST /api/family-memory", () => memoryPOST(post("/api/family-memory", { content: "x" }))],
  ["PATCH /api/family-memory/[id]", () => memoryPATCH(post("/api/family-memory/m1", { content: "y" }, "PATCH"), ID_CTX)],
  ["DELETE /api/family-memory/[id]", () => memoryDELETE(post("/api/family-memory/m1", {}, "DELETE"), ID_CTX)],
  ["POST /api/family-memory/[id]/use", () => memoryUsePOST(post("/api/family-memory/m1"), ID_CTX)],
  ["PUT /api/services/config", () => servicesConfigPUT(put("/api/services/config"))],
  ["DELETE /api/services/config", () => servicesConfigDELETE(new NextRequest("http://localhost/api/services/config", { method: "DELETE" }))],
  ["POST /api/services/import", () => servicesImportPOST(post("/api/services/import"))],
  ["POST /api/services/home-assistant/reconnect", () => haReconnectPOST(post("/api/services/home-assistant/reconnect"))],
];

beforeEach(() => {
  mocks.authorize.mockReset().mockResolvedValue({ ok: true });
});

describe("authorizeAdminRequest refusals fail closed", () => {
  it.each(SITES)(
    "%s answers 401 when a refusal carries no status",
    async (_label, call) => {
      mocks.authorize.mockResolvedValue({ ok: false, error: "unauthorized" });
      const res = await call();
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe("unauthorized");
    }
  );

  it.each(SITES)(
    "%s keeps 403 on an adult_only refusal",
    async (_label, call) => {
      mocks.authorize.mockResolvedValue({
        ok: false,
        status: 403,
        error: "adult_only",
      });
      const res = await call();
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("adult_only");
    }
  );

  it.each(SITES)(
    "%s keeps 503 on an identity_unavailable refusal",
    async (_label, call) => {
      mocks.authorize.mockResolvedValue({
        ok: false,
        status: 503,
        error: "identity_unavailable",
      });
      const res = await call();
      expect(res.status).toBe(503);
    }
  );
});

describe("type-enforced authorizers cannot fail open", () => {
  it("authorizeMuseRequest returns a numeric status on every refusal branch", async () => {
    const refused = await authorizeMuseRequest(
      new NextRequest("http://localhost/api/muse/tool")
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("expected a refusal");
    expect(typeof refused.status).toBe("number");
    expect(refused.status).toBeGreaterThanOrEqual(400);
  });

  it("authorizeMuseRequest still refuses a bearer that resolves to nothing", async () => {
    const refused = await authorizeMuseRequest(
      new NextRequest("http://localhost/api/muse/tool", {
        headers: { authorization: "Bearer not-a-real-token" },
      })
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("expected a refusal");
    expect(typeof refused.status).toBe("number");
    expect(refused.status).toBeGreaterThanOrEqual(400);
  });

  it("verifyLiveParentSession returns a numeric status on every refusal branch", async () => {
    const refused = await verifyLiveParentSession(
      new NextRequest("http://localhost/api/tasks/manage")
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("expected a refusal");
    expect(typeof refused.status).toBe("number");
    expect(refused.status).toBeGreaterThanOrEqual(400);
  });
});
