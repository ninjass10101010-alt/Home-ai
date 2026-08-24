import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Task 9 — the emergency route must verify PINs server-side via
// verifyPinAgainstAnyMember (PocketBase truth), NOT via the client-cache
// member list that used to be read with db.selectMembers().
const mocks = vi.hoisted(() => ({
  verifyPinAgainstAnyMember: vi.fn(),
  sendSMSViaEmail: vi.fn(),
  sendEmailAlert: vi.fn(),
  broadcastHouseAlert: vi.fn(),
  selectEmergencyContacts: vi.fn(),
  selectMembers: vi.fn(), // old path — must never be consulted anymore
}));

vi.mock("@/lib/server-auth", () => ({
  verifyPinAgainstAnyMember: mocks.verifyPinAgainstAnyMember,
}));

vi.mock("@/lib/free-communication", () => ({
  sendSMSViaEmail: mocks.sendSMSViaEmail,
  sendEmailAlert: mocks.sendEmailAlert,
}));

vi.mock("@/lib/ha/notify", () => ({
  broadcastHouseAlert: mocks.broadcastHouseAlert,
}));

vi.mock("@/db", () => ({
  db: {
    selectMembers: mocks.selectMembers,
    selectEmergencyContacts: mocks.selectEmergencyContacts,
  },
}));

import { POST as emergencyPOST } from "../../src/app/api/emergency/route";

function jsonRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/emergency", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("emergency route — server-side PIN verification", () => {
  beforeEach(() => {
    vi.stubEnv("GMAIL_USER", "fam@gmail.com");
    vi.stubEnv("GMAIL_APP_PASSWORD", "app-pass");
    vi.stubEnv("EMERGENCY_PIN_BYPASS", "");
    mocks.verifyPinAgainstAnyMember.mockReset();
    mocks.sendSMSViaEmail.mockReset().mockResolvedValue({ success: true });
    mocks.sendEmailAlert.mockReset().mockResolvedValue({ success: true });
    mocks.broadcastHouseAlert.mockReset().mockResolvedValue({ sent: 0, failed: 0, notes: [] });
    mocks.selectEmergencyContacts.mockReset().mockReturnValue([
      { name: "Rebecca", phone: "+15551234567", email: "r@x.com", carrier: "verizon", isPrimary: true },
    ]);
    // The legacy client-cache path: empty on a fresh PB install. A pin that
    // only verifies against PocketBase would be rejected by the old code.
    mocks.selectMembers.mockReset().mockReturnValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a PB-valid pin even when the old client cache is empty", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m1", name: "Jeffery Garcia", role: "parent" });

    const res = await emergencyPOST(
      await jsonRequest({ type: "general", timestamp: new Date().toISOString(), pin: "4321" })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mocks.verifyPinAgainstAnyMember).toHaveBeenCalledWith("4321");
    // The old client-cache lookup must be gone entirely.
    expect(mocks.selectMembers).not.toHaveBeenCalled();
  });

  it("honors the x-emergency-pin header through the same server verification", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m2", name: "Rebecca (Mom)", role: "parent" });

    const res = await emergencyPOST(
      jsonRequest(
        { type: "fire", timestamp: new Date().toISOString() },
        { "x-emergency-pin": "4321" }
      )
    );

    expect(res.status).toBe(200);
    expect(mocks.verifyPinAgainstAnyMember).toHaveBeenCalledWith("4321");
  });

  it("rejects an unresolvable pin with 401 Invalid PIN", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue(null);

    const res = await emergencyPOST(
      await jsonRequest({ type: "general", timestamp: new Date().toISOString(), pin: "0000" })
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Invalid PIN");
    expect(mocks.selectEmergencyContacts).not.toHaveBeenCalled();
  });

  it("keeps the EMERGENCY_PIN_BYPASS test escape working unchanged", async () => {
    vi.stubEnv("EMERGENCY_PIN_BYPASS", "9999");
    mocks.verifyPinAgainstAnyMember.mockResolvedValue(null);

    const bypassed = await emergencyPOST(
      await jsonRequest({ type: "water", timestamp: new Date().toISOString(), pin: "9999" })
    );
    expect(bypassed.status).toBe(200);
    expect((await bypassed.json()).success).toBe(true);

    // A wrong pin that does not match the bypass is still rejected even when
    // the escape hatch is configured.
    const rejected = await emergencyPOST(
      await jsonRequest({ type: "water", timestamp: new Date().toISOString(), pin: "1111" })
    );
    expect(rejected.status).toBe(401);
    expect((await rejected.json()).error).toBe("Invalid PIN");
  });
});
