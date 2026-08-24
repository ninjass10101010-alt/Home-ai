import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  sendSMSViaEmail: vi.fn(),
  sendEmailAlert: vi.fn(),
  broadcastHouseAlert: vi.fn(),
  verifyPinAgainstAnyMember: vi.fn(),
  selectEmergencyContacts: vi.fn(),
}));

vi.mock("@/lib/free-communication", () => ({
  sendSMSViaEmail: mocks.sendSMSViaEmail,
  sendEmailAlert: mocks.sendEmailAlert,
}));

vi.mock("@/lib/ha/notify", () => ({
  broadcastHouseAlert: mocks.broadcastHouseAlert,
}));

// Task 9: the route verifies PINs server-side via verifyPinAgainstAnyMember.
vi.mock("@/lib/server-auth", () => ({
  verifyPinAgainstAnyMember: mocks.verifyPinAgainstAnyMember,
}));

vi.mock("@/db", () => ({
  db: {
    selectEmergencyContacts: mocks.selectEmergencyContacts,
  },
}));

import { POST as emergencyPOST } from "../../src/app/api/emergency/route";

function jsonRequest(body: unknown) {
  return new NextRequest("http://localhost/api/emergency", {
    method: "POST",
    headers: { "content-type": "application/json", "x-emergency-pin": "1234" },
    body: JSON.stringify(body),
  });
}

describe("emergency route × house-alert channels", () => {
  beforeEach(() => {
    vi.stubEnv("GMAIL_USER", "fam@gmail.com");
    vi.stubEnv("GMAIL_APP_PASSWORD", "app-pass");
    mocks.verifyPinAgainstAnyMember.mockReset().mockResolvedValue({ name: "Jeffery", role: "parent" });
    mocks.selectEmergencyContacts.mockReset().mockReturnValue([
      { name: "Rebecca", phone: "+15551234567", email: "r@x.com", carrier: "verizon", isPrimary: true },
    ]);
    mocks.sendSMSViaEmail.mockReset();
    mocks.sendEmailAlert.mockReset();
    mocks.broadcastHouseAlert.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("still returns 500 when SMS+email all fail but house alert was attempted", async () => {
    mocks.sendSMSViaEmail.mockRejectedValue(new Error("carrier down"));
    mocks.sendEmailAlert.mockResolvedValue({ success: false });
    mocks.broadcastHouseAlert.mockResolvedValue({ sent: 2, failed: 0, notes: [] });

    const res = await emergencyPOST(await jsonRequest({ type: "general", timestamp: new Date().toISOString() }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(mocks.broadcastHouseAlert).toHaveBeenCalledTimes(1);
    expect(mocks.broadcastHouseAlert.mock.calls[0][0]).toContain("EMERGENCY");
    expect(JSON.stringify(body)).not.toContain("undefined");
  });

  it("includes notify channel outcome in the success payload without changing its shape", async () => {
    mocks.sendSMSViaEmail.mockResolvedValue({ success: true });
    mocks.sendEmailAlert.mockResolvedValue({ success: true });
    mocks.broadcastHouseAlert.mockResolvedValue({ sent: 1, failed: 1, notes: ["telegram: down"] });

    const res = await emergencyPOST(await jsonRequest({ type: "fire", timestamp: new Date().toISOString() }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.details.total).toBe(1);
    expect(body.details.houseAlert).toEqual({ sent: 1, failed: 1, notes: ["telegram: down"] });
  });

  it("succeeds end-to-end even when every house-alert channel throws", async () => {
    mocks.sendSMSViaEmail.mockResolvedValue({ success: true });
    mocks.sendEmailAlert.mockResolvedValue({ success: true });
    mocks.broadcastHouseAlert.mockRejectedValue(new Error("boom"));

    const res = await emergencyPOST(await jsonRequest({ type: "water", timestamp: new Date().toISOString() }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
