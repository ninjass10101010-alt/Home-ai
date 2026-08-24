import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  callService: vi.fn(),
  getHAWebSocketClient: vi.fn(),
  verifyPinAgainstAnyMember: vi.fn(),
}));

vi.mock("../../src/lib/ha/websocket-client", () => ({
  getHAWebSocketClient: mocks.getHAWebSocketClient,
}));

vi.mock("../../src/lib/server-auth", () => ({
  verifyPinAgainstAnyMember: mocks.verifyPinAgainstAnyMember,
}));

import { POST as alarmPOST } from "../../src/app/api/ha/alarm/route";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/ha/alarm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/ha/alarm (PIN-gated arm/disarm)", () => {
  beforeEach(() => {
    mocks.callService.mockReset();
    mocks.verifyPinAgainstAnyMember.mockReset();
    mocks.getHAWebSocketClient.mockReset();
    mocks.getHAWebSocketClient.mockReturnValue({
      status: "connected",
      connect: vi.fn(),
      callService: mocks.callService,
    });
  });

  it("returns 400 invalid_request for an unknown action", async () => {
    const res = await alarmPOST(
      jsonRequest({ action: "arm_away", entity_id: "alarm_control_panel.home", pin: "1234" })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "invalid_request" });
    expect(mocks.callService).not.toHaveBeenCalled();
    expect(mocks.verifyPinAgainstAnyMember).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request for a non-alarm entity_id", async () => {
    const res = await alarmPOST(
      jsonRequest({ action: "disarm", entity_id: "light.kitchen", pin: "1234" })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "invalid_request" });
    expect(mocks.callService).not.toHaveBeenCalled();
  });

  it("returns 401 when the pin is missing", async () => {
    const res = await alarmPOST(
      jsonRequest({ action: "disarm", entity_id: "alarm_control_panel.home" })
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "unauthorized" });
    expect(mocks.callService).not.toHaveBeenCalled();
  });

  it("returns 401 when the pin does not match any family member", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue(null);

    const res = await alarmPOST(
      jsonRequest({ action: "disarm", entity_id: "alarm_control_panel.home", pin: "9999" })
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "unauthorized" });
    expect(mocks.verifyPinAgainstAnyMember).toHaveBeenCalledWith("9999");
    expect(mocks.callService).not.toHaveBeenCalled();
  });

  it("forwards alarm_arm_home when a valid pin arms the house", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m1", name: "Rebecca", role: "parent" });
    mocks.callService.mockResolvedValue({ ok: true });

    const res = await alarmPOST(
      jsonRequest({ action: "arm_home", entity_id: "alarm_control_panel.home", pin: "1234" })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mocks.callService).toHaveBeenCalledWith("alarm_control_panel", "alarm_arm_home", {
      entity_id: "alarm_control_panel.home",
    });
  });

  it("forwards alarm_disarm when a valid pin disarms", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m2", name: "Dan", role: "member" });
    mocks.callService.mockResolvedValue({ ok: true });

    const res = await alarmPOST(
      jsonRequest({ action: "disarm", entity_id: "alarm_control_panel.home", pin: "4321" })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mocks.callService).toHaveBeenCalledWith("alarm_control_panel", "alarm_disarm", {
      entity_id: "alarm_control_panel.home",
    });
  });

  it("returns 502 when Home Assistant rejects the call", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m1", name: "Rebecca" });
    mocks.callService.mockRejectedValue(new Error("Not connected"));

    const res = await alarmPOST(
      jsonRequest({ action: "disarm", entity_id: "alarm_control_panel.home", pin: "1234" })
    );

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ success: false, error: "Not connected" });
  });
});
