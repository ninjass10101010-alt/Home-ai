import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  callService: vi.fn(),
  getHAWebSocketClient: vi.fn(),
  fetchHADeviceStates: vi.fn(),
}));

vi.mock("../../src/lib/ha/websocket-client", () => ({
  getHAWebSocketClient: mocks.getHAWebSocketClient,
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
});

describe("GET /api/ha/health", () => {
  beforeEach(() => {
    mocks.getHAWebSocketClient.mockReset();
  });

  it("reports wsStatus and wsConnected true when the client is connected", async () => {
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
