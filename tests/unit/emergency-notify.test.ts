import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  resolveGmailCredentials: vi.fn(),
  sendSMSViaEmail: vi.fn(),
  sendEmailAlert: vi.fn(),
  broadcastHouseAlert: vi.fn(),
  verifyPinAgainstAnyMember: vi.fn(),
  liveEmergencyContacts: vi.fn(),
  selectEmergencyContacts: vi.fn(),
}));

vi.mock("@/lib/free-communication", () => ({
  resolveGmailCredentials: mocks.resolveGmailCredentials,
  sendSMSViaEmail: mocks.sendSMSViaEmail,
  sendEmailAlert: mocks.sendEmailAlert,
}));

vi.mock("@/lib/consuela/live-reads", () => ({
  liveEmergencyContacts: mocks.liveEmergencyContacts,
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

import * as emergencyRoute from "../../src/app/api/emergency/route";

const emergencyPOST = emergencyRoute.POST;

function jsonRequest(body: unknown) {
  return new NextRequest("http://localhost/api/emergency", {
    method: "POST",
    headers: { "content-type": "application/json", "x-emergency-pin": "1234" },
    body: JSON.stringify(body),
  });
}

describe("emergency route × house-alert channels", () => {
  beforeEach(() => {
    (emergencyRoute as any).__resetEmergencyGuardsForTests?.();
    vi.stubEnv("GMAIL_USER", "fam@gmail.com");
    vi.stubEnv("GMAIL_APP_PASSWORD", "app-pass");
    mocks.verifyPinAgainstAnyMember.mockReset().mockResolvedValue({ name: "Jeffery", role: "parent" });
    mocks.resolveGmailCredentials.mockReset().mockResolvedValue({ user: "configured@example.com", pass: "configured" });
    mocks.liveEmergencyContacts.mockReset().mockResolvedValue([
      { name: "Rebecca", phone: "+15551234567", email: "r@x.com", carrier: "verizon", isPrimary: true },
    ]);
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

  it("returns structured partial success when house delivery succeeds but SMS and email fail", async () => {
    mocks.sendSMSViaEmail.mockRejectedValue(new Error("carrier down"));
    mocks.sendEmailAlert.mockResolvedValue({ success: false });
    mocks.broadcastHouseAlert.mockResolvedValue({ sent: 2, failed: 0, notes: ["telegram delivered"] });

    const res = await emergencyPOST(await jsonRequest({ type: "general", timestamp: new Date().toISOString() }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, partial: true });
    expect(body.message).toMatch(/house/i);
    expect(body.details).toMatchObject({
      total: 1,
      successful: 0,
      failed: 1,
      houseAlert: { sent: 2, failed: 0, notes: ["telegram delivered"] },
    });
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

  it("uses registry-backed Gmail credentials when process env is empty", async () => {
    vi.stubEnv("GMAIL_USER", "");
    vi.stubEnv("GMAIL_APP_PASSWORD", "");
    mocks.resolveGmailCredentials.mockResolvedValueOnce({ user: "registry@example.com", pass: "registry-secret" });
    mocks.sendSMSViaEmail.mockResolvedValue({ success: true });
    mocks.sendEmailAlert.mockResolvedValue({ success: true });
    mocks.broadcastHouseAlert.mockResolvedValue({ sent: 1, failed: 0, notes: [] });

    const res = await emergencyPOST(await jsonRequest({ type: "general", timestamp: new Date().toISOString() }));

    expect(res.status).toBe(200);
    expect(mocks.resolveGmailCredentials).toHaveBeenCalledTimes(1);
    expect(mocks.sendSMSViaEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmailAlert).toHaveBeenCalledTimes(1);
  });

  it("returns house-only partial success when effective Gmail configuration is unavailable", async () => {
    vi.stubEnv("GMAIL_USER", "");
    vi.stubEnv("GMAIL_APP_PASSWORD", "");
    mocks.resolveGmailCredentials.mockResolvedValueOnce({ user: null, pass: null });
    mocks.broadcastHouseAlert.mockResolvedValue({ sent: 1, failed: 0, notes: ["telegram delivered"] });

    const res = await emergencyPOST(await jsonRequest({ type: "fire", timestamp: new Date().toISOString() }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, partial: true });
    expect(body.warning).toMatch(/gmail|sms|email/i);
    expect(body.details.houseAlert).toEqual({ sent: 1, failed: 0, notes: ["telegram delivered"] });
    expect(mocks.sendSMSViaEmail).not.toHaveBeenCalled();
    expect(mocks.sendEmailAlert).not.toHaveBeenCalled();
  });

  it("returns a structured PIN-read failure before alert side effects", async () => {
    mocks.verifyPinAgainstAnyMember.mockRejectedValueOnce(new Error("PB unavailable"));

    const res = await emergencyPOST(await jsonRequest({ type: "general", timestamp: new Date().toISOString() }));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toMatchObject({ ok: false, error: "pin_check_failed" });
    expect(mocks.liveEmergencyContacts).not.toHaveBeenCalled();
    expect(mocks.broadcastHouseAlert).not.toHaveBeenCalled();
    expect(mocks.sendSMSViaEmail).not.toHaveBeenCalled();
  });

  it("rejects a concurrent real alert for the same member before a second delivery", async () => {
    let releaseHouse!: (value: { sent: number; failed: number; notes: string[] }) => void;
    mocks.broadcastHouseAlert.mockReturnValueOnce(new Promise((resolve) => {
      releaseHouse = resolve;
    }));

    const firstPromise = emergencyPOST(await jsonRequest({ type: "general", timestamp: new Date().toISOString() }));
    await vi.waitFor(() => expect(mocks.broadcastHouseAlert).toHaveBeenCalledTimes(1));
    const second = await emergencyPOST(await jsonRequest({ type: "fire", timestamp: new Date().toISOString() }));

    expect(second.status).toBe(409);
    expect((await second.json()).error).toMatch(/in_flight/);
    expect(mocks.broadcastHouseAlert).toHaveBeenCalledTimes(1);

    releaseHouse({ sent: 1, failed: 0, notes: [] });
    expect((await firstPromise).status).toBe(200);
  });

  it("releases the in-flight guard when a delivery attempt throws", async () => {
    mocks.broadcastHouseAlert.mockRejectedValue(new Error("house channel unavailable"));
    mocks.sendSMSViaEmail.mockResolvedValue({ success: true });
    mocks.sendEmailAlert.mockResolvedValue({ success: true });

    const first = await emergencyPOST(await jsonRequest({ type: "general" }));
    const second = await emergencyPOST(await jsonRequest({ type: "fire" }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(mocks.broadcastHouseAlert).toHaveBeenCalledTimes(1);
  });

  it("returns 429 with Retry-After after a completed real alert", async () => {
    mocks.broadcastHouseAlert.mockResolvedValue({ sent: 1, failed: 0, notes: [] });
    mocks.sendSMSViaEmail.mockResolvedValue({ success: true });
    mocks.sendEmailAlert.mockResolvedValue({ success: true });

    const first = await emergencyPOST(await jsonRequest({ type: "general", timestamp: new Date().toISOString() }));
    const second = await emergencyPOST(await jsonRequest({ type: "fire", timestamp: new Date().toISOString() }));
    const body = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(body.error).toMatch(/cooldown/);
    expect(second.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(mocks.broadcastHouseAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendSMSViaEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmailAlert).toHaveBeenCalledTimes(1);
  });

  it("tracks the real-alert guard per member", async () => {
    mocks.verifyPinAgainstAnyMember.mockImplementation(async (pin: string) => ({ id: `member-${pin}`, name: "Member", role: "parent" }));
    mocks.broadcastHouseAlert.mockResolvedValue({ sent: 1, failed: 0, notes: [] });
    mocks.sendSMSViaEmail.mockResolvedValue({ success: true });
    mocks.sendEmailAlert.mockResolvedValue({ success: true });

    const first = await emergencyPOST(await jsonRequest({ type: "general", pin: "1111" }));
    const second = await emergencyPOST(await jsonRequest({ type: "general", pin: "2222" }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.broadcastHouseAlert).toHaveBeenCalledTimes(2);
  });

  it("does not put a member into cooldown when no delivery was possible", async () => {
    mocks.liveEmergencyContacts.mockResolvedValue([
      { name: "Reference", phone: "+15550000000", email: "reference@example.com", isPrimary: false },
    ]);

    const first = await emergencyPOST(await jsonRequest({ type: "general" }));
    const second = await emergencyPOST(await jsonRequest({ type: "fire" }));

    expect(first.status).toBe(500);
    expect(second.status).toBe(500);
    expect(second.headers.get("Retry-After")).toBeNull();
    expect(mocks.broadcastHouseAlert).not.toHaveBeenCalled();
  });

  it("fails closed instead of delivering from an unsafe cached roster", async () => {
    mocks.liveEmergencyContacts.mockResolvedValueOnce(null);
    mocks.selectEmergencyContacts.mockReturnValue([
      { name: "Synthetic", phone: "+15550000000", email: "synthetic@example.com", carrier: "verizon", isPrimary: true },
    ]);
    mocks.sendSMSViaEmail.mockResolvedValue({ success: true });
    mocks.sendEmailAlert.mockResolvedValue({ success: true });
    mocks.broadcastHouseAlert.mockResolvedValue({ sent: 1, failed: 0, notes: [] });

    const res = await emergencyPOST(await jsonRequest({ type: "general" }));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toMatchObject({ ok: false, error: "contacts_unavailable" });
    expect(mocks.selectEmergencyContacts).not.toHaveBeenCalled();
    expect(mocks.sendSMSViaEmail).not.toHaveBeenCalled();
    expect(mocks.sendEmailAlert).not.toHaveBeenCalled();
    expect(mocks.broadcastHouseAlert).not.toHaveBeenCalled();
  });

  it("permits an immediate retry after a complete delivery failure", async () => {
    mocks.broadcastHouseAlert.mockResolvedValue({ sent: 0, failed: 1, notes: ["house down"] });
    mocks.sendSMSViaEmail.mockResolvedValue({ success: false, error: "sms down" });
    mocks.sendEmailAlert.mockResolvedValue({ success: false, error: "email down" });

    const first = await emergencyPOST(await jsonRequest({ type: "general" }));
    const second = await emergencyPOST(await jsonRequest({ type: "fire" }));

    expect(first.status).toBe(502);
    expect(second.status).toBe(502);
    expect(mocks.broadcastHouseAlert).toHaveBeenCalledTimes(2);
  });
});
