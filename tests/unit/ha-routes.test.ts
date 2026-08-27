import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  callService: vi.fn(),
  getHAWebSocketClient: vi.fn(),
  fetchHADeviceStates: vi.fn(),
  getHABridgeStatus: vi.fn(),
}));

vi.mock("../../src/lib/ha/websocket-client", () => ({
  getHAWebSocketClient: mocks.getHAWebSocketClient,
}));

vi.mock("../../src/lib/ha/bridge", () => ({
  getHABridgeStatus: mocks.getHABridgeStatus,
}));

vi.mock("../../src/lib/ha/rest-client", () => ({
  fetchHADeviceStates: mocks.fetchHADeviceStates,
}));

import { POST as callServicePOST } from "../../src/app/api/ha/call-service/route";
import { GET as healthGET } from "../../src/app/api/ha/health/route";
import { POST as syncPOST } from "../../src/app/api/ha/sync/route";

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/ha/call-service", () => {
  beforeEach(() => {
    mocks.callService.mockReset();
    mocks.getHAWebSocketClient.mockReset();
    mocks.getHAWebSocketClient.mockReturnValue({
      status: "connected",
      connect: vi.fn(),
      callService: mocks.callService,
    });
  });

  it("returns 400 invalid_request when domain is missing", async () => {
    const res = await callServicePOST(
      jsonRequest("http://localhost/api/ha/call-service", { service: "turn_on" })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "invalid_request" });
    expect(mocks.callService).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request when service fails validation", async () => {
    const res = await callServicePOST(
      jsonRequest("http://localhost/api/ha/call-service", {
        domain: "light",
        service: "turn on!",
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "invalid_request" });
    expect(mocks.callService).not.toHaveBeenCalled();
  });

  it("returns success and forwards (domain, service, serviceData) to the client", async () => {
    mocks.callService.mockResolvedValue({ ok: true });

    const res = await callServicePOST(
      jsonRequest("http://localhost/api/ha/call-service", {
        domain: "light",
        service: "turn_on",
        serviceData: { entity_id: "light.kitchen", brightness: 255 },
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, result: { ok: true } });
    expect(mocks.callService).toHaveBeenCalledTimes(1);
    expect(mocks.callService).toHaveBeenCalledWith("light", "turn_on", {
      entity_id: "light.kitchen",
      brightness: 255,
    });
  });

  it("returns 502 with the error message when the client rejects", async () => {
    mocks.callService.mockRejectedValue(new Error("Not connected"));

    const res = await callServicePOST(
      jsonRequest("http://localhost/api/ha/call-service", {
        domain: "light",
        service: "turn_on",
      })
    );

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ success: false, error: "Not connected" });
  });

  it("allows a legitimate House tab call through to the client", async () => {
    mocks.callService.mockResolvedValue({ ok: true });

    const res = await callServicePOST(
      jsonRequest("http://localhost/api/ha/call-service", {
        domain: "light",
        service: "toggle",
        serviceData: { entity_id: "light.kitchen" },
      })
    );

    expect(res.status).toBe(200);
    expect(mocks.callService).toHaveBeenCalledWith("light", "toggle", {
      entity_id: "light.kitchen",
    });
  });

  it.each([
    ["lock", "unlock"],
    ["alarm_control_panel", "alarm_arm_home"],
    ["alarm_control_panel", "alarm_disarm"],
    ["alarm_control_panel", "alarm_arm_away"],
    ["script", "turn_on"],
    ["automation", "trigger"],
    ["shell_command", "run"],
    ["notify", "mobile_app_phone"],
  ])("returns 403 and does not forward %s.%s", async (domain, service) => {
    const res = await callServicePOST(
      jsonRequest("http://localhost/api/ha/call-service", {
        domain,
        service,
        serviceData: { entity_id: `${domain}.x` },
      })
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: "service_not_allowed" });
    expect(mocks.callService).not.toHaveBeenCalled();
  });
});

describe("GET /api/ha/health", () => {
  beforeEach(() => {
    mocks.getHAWebSocketClient.mockReset();
    mocks.getHABridgeStatus.mockReset();
    mocks.getHABridgeStatus.mockReturnValue({
      started: true,
      wsConnected: true,
      mqttStatus: "connected",
      lastEventAt: null,
    });
  });

  it("reports wsStatus, wsConnected and bridge status when the client is connected", async () => {
    mocks.getHAWebSocketClient.mockReturnValue({
      status: "connected",
      connect: vi.fn(),
      callService: vi.fn(),
    });

    const res = await healthGET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      wsStatus: "connected",
      wsConnected: true,
      bridge: {
        started: true,
        wsConnected: true,
        mqttStatus: "connected",
        lastEventAt: null,
      },
    });
  });

  it("reports wsConnected false when the client is not connected", async () => {
    mocks.getHAWebSocketClient.mockReturnValue({
      status: "disconnected",
      connect: vi.fn(),
      callService: vi.fn(),
    });

    const res = await healthGET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      wsStatus: "disconnected",
      wsConnected: false,
      bridge: {
        started: true,
        wsConnected: true,
        mqttStatus: "connected",
        lastEventAt: null,
      },
    });
  });

  it("reports not_configured (200) instead of throwing when HA config is absent", async () => {
    mocks.getHAWebSocketClient.mockRejectedValue(new Error("HA_HOST is not set"));

    const res = await healthGET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      configured: false,
      reason: "not_configured",
      wsStatus: "disconnected",
      wsConnected: false,
    });
  });
});

describe("POST /api/ha/sync", () => {
  beforeEach(() => {
    mocks.fetchHADeviceStates.mockReset();
  });

  it("returns count and states from the REST snapshot", async () => {
    const states = [
      {
        entity_id: "light.kitchen",
        state: "on",
        attributes: { friendly_name: "Kitchen" },
        last_updated: "2026-08-21T12:00:00Z",
      },
      {
        entity_id: "switch.tv",
        state: "off",
        attributes: {},
        last_updated: "2026-08-21T12:05:00Z",
      },
    ];
    mocks.fetchHADeviceStates.mockResolvedValue(states);

    const res = await syncPOST();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, count: 2, states });
    expect(mocks.fetchHADeviceStates).toHaveBeenCalledTimes(1);
  });

  it("returns 502 with the error message when the REST fetch fails", async () => {
    mocks.fetchHADeviceStates.mockRejectedValue(new Error("HA REST fetch failed: 401"));

    const res = await syncPOST();

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      success: false,
      error: "HA REST fetch failed: 401",
    });
  });
});
