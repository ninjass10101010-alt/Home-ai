import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TEST_COPY = "CONSUELA TEST ALERT — Test only. No emergency.";

const mocks = vi.hoisted(() => ({
  verifyPinAgainstAnyMember: vi.fn(),
  authorizeCurrentParentRequest: vi.fn(),
  resolveGmailCredentials: vi.fn(),
  liveEmergencyContacts: vi.fn(),
  selectEmergencyContacts: vi.fn(),
  sendSMSViaEmail: vi.fn(),
  sendEmailAlert: vi.fn(),
  broadcastHouseAlert: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({
  verifyPinAgainstAnyMember: mocks.verifyPinAgainstAnyMember,
  authorizeCurrentParentRequest: mocks.authorizeCurrentParentRequest,
}));

vi.mock("@/lib/consuela/live-reads", () => ({
  liveEmergencyContacts: mocks.liveEmergencyContacts,
}));

vi.mock("@/db", () => ({
  db: {
    selectEmergencyContacts: mocks.selectEmergencyContacts,
  },
}));

vi.mock("@/lib/free-communication", () => ({
  resolveGmailCredentials: mocks.resolveGmailCredentials,
  sendSMSViaEmail: mocks.sendSMSViaEmail,
  sendEmailAlert: mocks.sendEmailAlert,
  TEST_ALERT_SUBJECT: "CONSUELA TEST ALERT — Test only. No emergency.",
}));

vi.mock("@/lib/ha/notify", () => ({
  broadcastHouseAlert: mocks.broadcastHouseAlert,
}));

import * as emergencyTestRoute from "@/app/api/emergency/test/route";
import { SESSION_COOKIE, signSession } from "@/lib/session";

const emergencyTestPOST = emergencyTestRoute.POST;

function bodyRequest(body: unknown, cookie?: string) {
  return new NextRequest("http://localhost/api/emergency/test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

const sessionFixtures = new Map<string, { memberId: string; name: string; role: string }>();

async function parentCookie(memberId = "m1") {
  const token = await signSession({ memberId, name: "Rebecca", role: "parent" });
  sessionFixtures.set(token, { memberId, name: "Rebecca", role: "parent" });
  return `${SESSION_COOKIE}=${token}`;
}

async function roleCookie(role: string) {
  const token = await signSession({ memberId: `m-${role}`, name: `Member-${role}`, role });
  sessionFixtures.set(token, { memberId: `m-${role}`, name: `Member-${role}`, role });
  return `${SESSION_COOKIE}=${token}`;
}

beforeEach(() => {
  (emergencyTestRoute as any).__resetEmergencyTestGuardsForTests?.();
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  vi.stubEnv("GMAIL_USER", "family@example.com");
  vi.stubEnv("GMAIL_APP_PASSWORD", "configured");
  mocks.verifyPinAgainstAnyMember.mockReset().mockResolvedValue({ id: "m1", name: "Rebecca", role: "parent" });
  sessionFixtures.clear();
  mocks.authorizeCurrentParentRequest.mockReset().mockImplementation(async (request: Request) => {
    const token = (request.headers.get("cookie") || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1) || "";
    const fixture = sessionFixtures.get(token);
    if (!fixture) return { ok: false, status: 401, error: "unauthorized" };
    if (fixture.role !== "parent") return { ok: false, status: 403, error: "adult_only" };
    return { ok: true, member: fixture, session: fixture };
  });
  mocks.resolveGmailCredentials.mockReset().mockResolvedValue({ user: "family@example.com", pass: "configured" });
  mocks.liveEmergencyContacts.mockReset().mockResolvedValue([
    { name: "Rebecca", phone: "+15551234567", email: "r@example.com", carrier: "verizon", isPrimary: true },
  ]);
  mocks.selectEmergencyContacts.mockReset().mockReturnValue([]);
  mocks.sendSMSViaEmail.mockReset().mockResolvedValue({ success: true });
  mocks.sendEmailAlert.mockReset().mockResolvedValue({ success: true });
  mocks.broadcastHouseAlert.mockReset().mockResolvedValue({ sent: 1, failed: 0, notes: [] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("POST /api/emergency/test", () => {
  it("uses a server-generated send timestamp and ignores malformed or stale client timestamps", async () => {
    const serverNow = new Date("2035-04-05T06:07:08.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(serverNow);
    const cookie = await parentCookie();
    const staleTimestamp = "2000-01-01T00:00:00.000Z";
    const malformedTimestamp = "not-a-real-timestamp";

    const response = await emergencyTestPOST(bodyRequest({
      pin: "1234",
      timestamp: staleTimestamp,
      malformedTimestamp,
    }, cookie));
    expect(response.status).toBe(200);

    const expectedTimestamp = serverNow.toISOString();
    expect(mocks.sendSMSViaEmail.mock.calls[0][1]).toContain(expectedTimestamp);
    expect(mocks.sendEmailAlert.mock.calls[0][2]).toContain(expectedTimestamp);
    expect(mocks.broadcastHouseAlert.mock.calls[0][1]).toContain(expectedTimestamp);
    expect(mocks.sendSMSViaEmail.mock.calls[0][1]).not.toContain(staleTimestamp);
    expect(mocks.sendEmailAlert.mock.calls[0][2]).not.toContain(staleTimestamp);
    expect(mocks.broadcastHouseAlert.mock.calls[0][1]).not.toContain(staleTimestamp);
    expect(mocks.sendSMSViaEmail.mock.calls[0][1]).not.toContain(malformedTimestamp);
    expect(mocks.sendEmailAlert.mock.calls[0][2]).not.toContain(malformedTimestamp);
    expect(mocks.broadcastHouseAlert.mock.calls[0][1]).not.toContain(malformedTimestamp);
  });

  it("uses registry-backed Gmail credentials when process env is empty", async () => {
    vi.stubEnv("GMAIL_USER", "");
    vi.stubEnv("GMAIL_APP_PASSWORD", "");
    mocks.resolveGmailCredentials.mockResolvedValueOnce({ user: "registry@example.com", pass: "registry-secret" });

    const response = await emergencyTestPOST(bodyRequest({ pin: "1234" }, await parentCookie()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mocks.resolveGmailCredentials).toHaveBeenCalledTimes(1);
    expect(mocks.sendSMSViaEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmailAlert).toHaveBeenCalledTimes(1);
  });

  it("returns a structured error without delivery work when PIN verification throws", async () => {
    mocks.verifyPinAgainstAnyMember.mockRejectedValueOnce(new Error("PB unavailable"));

    const response = await emergencyTestPOST(bodyRequest({ pin: "1234" }, await parentCookie()));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ ok: false, error: "pin_check_failed" });
    expect(mocks.resolveGmailCredentials).not.toHaveBeenCalled();
    expect(mocks.liveEmergencyContacts).not.toHaveBeenCalled();
    expect(mocks.broadcastHouseAlert).not.toHaveBeenCalled();
    expect(mocks.sendSMSViaEmail).not.toHaveBeenCalled();
  });

  it("fails closed when the current parent identity cannot be re-read from PB", async () => {
    mocks.authorizeCurrentParentRequest.mockResolvedValueOnce({ ok: false, status: 503, error: "identity_unavailable" });

    const response = await emergencyTestPOST(bodyRequest({ pin: "1234" }, await parentCookie()));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ ok: false, error: "identity_unavailable" });
    expect(mocks.verifyPinAgainstAnyMember).not.toHaveBeenCalled();
    expect(mocks.liveEmergencyContacts).not.toHaveBeenCalled();
    expect(mocks.broadcastHouseAlert).not.toHaveBeenCalled();
  });

  it("returns a structured configuration error before any delivery side effect", async () => {
    mocks.resolveGmailCredentials.mockResolvedValueOnce({ user: null, pass: null });

    const response = await emergencyTestPOST(bodyRequest({ pin: "1234" }, await parentCookie()));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ ok: false, error: "service_not_configured" });
    expect(mocks.broadcastHouseAlert).not.toHaveBeenCalled();
    expect(mocks.sendSMSViaEmail).not.toHaveBeenCalled();
    expect(mocks.sendEmailAlert).not.toHaveBeenCalled();
  });

  it("returns a structured configuration error for an invalid resolver result", async () => {
    mocks.resolveGmailCredentials.mockResolvedValueOnce(undefined as any);

    const response = await emergencyTestPOST(bodyRequest({ pin: "1234" }, await parentCookie()));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ ok: false, error: "config_resolution_failed" });
    expect(mocks.broadcastHouseAlert).not.toHaveBeenCalled();
  });

  it("blocks a real test when the live PB contact read is unavailable", async () => {
    mocks.liveEmergencyContacts.mockResolvedValueOnce(null);
    mocks.selectEmergencyContacts.mockReturnValueOnce([
      { name: "Cached", phone: "+15550000000", email: "cached@example.com", carrier: "verizon", isPrimary: true },
    ]);

    const response = await emergencyTestPOST(bodyRequest({ pin: "1234" }, await parentCookie()));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ ok: false, error: "contacts_unavailable" });
    expect(body.message).toMatch(/no test alert was sent/i);
    expect(mocks.selectEmergencyContacts).not.toHaveBeenCalled();
    expect(mocks.broadcastHouseAlert).not.toHaveBeenCalled();
    expect(mocks.sendSMSViaEmail).not.toHaveBeenCalled();
    expect(mocks.sendEmailAlert).not.toHaveBeenCalled();
  });

  it("allows only one concurrent real test per parent", async () => {
    let releaseHouse!: (value: { sent: number; failed: number; notes: string[] }) => void;
    mocks.broadcastHouseAlert.mockReturnValueOnce(new Promise((resolve) => {
      releaseHouse = resolve;
    }));
    const cookie = await parentCookie("concurrent-parent");
    const firstPromise = emergencyTestPOST(bodyRequest({ pin: "1234" }, cookie));
    await vi.waitFor(() => expect(mocks.broadcastHouseAlert).toHaveBeenCalledTimes(1));
    const second = await emergencyTestPOST(bodyRequest({ pin: "1234" }, cookie));

    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ ok: false, error: "test_alert_in_flight" });
    expect(mocks.sendSMSViaEmail).not.toHaveBeenCalled();
    expect(mocks.sendEmailAlert).not.toHaveBeenCalled();

    releaseHouse({ sent: 1, failed: 0, notes: [] });
    const first = await firstPromise;
    expect(first.status).toBe(200);
    expect(mocks.broadcastHouseAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendSMSViaEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmailAlert).toHaveBeenCalledTimes(1);
  });

  it("returns cooldown guidance after a completed real test", async () => {
    const cookie = await parentCookie("cooldown-parent");
    const first = await emergencyTestPOST(bodyRequest({ pin: "1234" }, cookie));
    const second = await emergencyTestPOST(bodyRequest({ pin: "1234" }, cookie));
    const body = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(body).toMatchObject({ ok: false, error: "test_alert_cooldown" });
    expect(body.retryAfterMs).toBeGreaterThan(0);
    expect(body.message).toMatch(/wait .* before trying again/i);
    expect(second.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(mocks.broadcastHouseAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendSMSViaEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmailAlert).toHaveBeenCalledTimes(1);
  });

  it("allows an immediate retry after a complete test delivery failure", async () => {
    mocks.broadcastHouseAlert.mockResolvedValue({ sent: 0, failed: 1, notes: ["house down"] });
    mocks.sendSMSViaEmail.mockResolvedValue({ success: false, error: "sms down" });
    mocks.sendEmailAlert.mockResolvedValue({ success: false, error: "email down" });
    const cookie = await parentCookie("retry-failure-parent");

    const first = await emergencyTestPOST(bodyRequest({ pin: "1234" }, cookie));
    const second = await emergencyTestPOST(bodyRequest({ pin: "1234" }, cookie));

    expect(first.status).toBe(502);
    expect(second.status).toBe(502);
    expect(mocks.broadcastHouseAlert).toHaveBeenCalledTimes(2);
    expect(mocks.sendSMSViaEmail).toHaveBeenCalledTimes(2);
  });

  it("tracks cooldown independently per parent", async () => {
    const first = await emergencyTestPOST(bodyRequest({ pin: "1234" }, await parentCookie("parent-a")));
    const second = await emergencyTestPOST(bodyRequest({ pin: "1234" }, await parentCookie("parent-b")));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.broadcastHouseAlert).toHaveBeenCalledTimes(2);
  });

  it("sends a parent-authorized real test through every configured recipient channel with test-only copy", async () => {
    const response = await emergencyTestPOST(bodyRequest({ pin: "1234", timestamp: new Date().toISOString() }, await parentCookie()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mocks.verifyPinAgainstAnyMember).toHaveBeenCalledWith("1234");
    expect(mocks.sendSMSViaEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmailAlert).toHaveBeenCalledTimes(1);
    expect(mocks.broadcastHouseAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendSMSViaEmail.mock.calls[0][1]).toContain(TEST_COPY);
    expect(mocks.sendEmailAlert.mock.calls[0][1]).toBe(TEST_COPY);
    expect(mocks.sendEmailAlert.mock.calls[0][2]).toContain(TEST_COPY);
    expect(mocks.broadcastHouseAlert.mock.calls[0][0]).toBe(TEST_COPY);
    expect(mocks.broadcastHouseAlert.mock.calls[0][1]).toContain(TEST_COPY);
    const deliveryText = JSON.stringify([
      mocks.sendSMSViaEmail.mock.calls,
      mocks.sendEmailAlert.mock.calls,
      mocks.broadcastHouseAlert.mock.calls,
    ]);
    expect(deliveryText).not.toContain("GENERAL EMERGENCY");
    expect(deliveryText).not.toContain("🚨 EMERGENCY");
  });

  it.each(["child", "pet"])("rejects a %s session even when its family PIN is valid", async (role) => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m2", name: "Bailey", role });
    const response = await emergencyTestPOST(bodyRequest({ pin: "1234" }, await roleCookie(role)));

    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("adult_only");
    expect(mocks.verifyPinAgainstAnyMember).not.toHaveBeenCalled();
    expect(mocks.sendSMSViaEmail).not.toHaveBeenCalled();
  });

  it("reaches the route when current-parent auth promotes a child-signed session", async () => {
    const cookie = await roleCookie("child");
    mocks.authorizeCurrentParentRequest.mockResolvedValueOnce({
      ok: true,
      member: { id: "m-child", name: "Member-child", role: "parent" },
      session: { memberId: "m-child", name: "Member-child", role: "child" },
    });

    const response = await emergencyTestPOST(bodyRequest({ pin: "1234" }, cookie));

    expect(response.status).toBe(200);
    expect(mocks.verifyPinAgainstAnyMember).toHaveBeenCalledWith("1234");
    expect(mocks.sendSMSViaEmail).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["null", null],
    ["array", []],
    ["string", "not-an-object"],
    ["number", 123],
    ["missing pin", {}],
    ["null pin", { pin: null }],
    ["numeric pin", { pin: 1234 }],
    ["short pin", { pin: "123" }],
    ["non-numeric pin", { pin: "12a4" }],
  ])("rejects malformed JSON shape %s with 400 before property access", async (_label, body) => {
    const response = await emergencyTestPOST(bodyRequest(body, await parentCookie()));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/invalid|json|pin/i);
    expect(mocks.verifyPinAgainstAnyMember).not.toHaveBeenCalled();
    expect(mocks.liveEmergencyContacts).not.toHaveBeenCalled();
  });

  it("rejects a guest without a valid parent session", async () => {
    const response = await emergencyTestPOST(bodyRequest({ pin: "1234" }));

    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("unauthorized");
    expect(mocks.verifyPinAgainstAnyMember).not.toHaveBeenCalled();
  });

  it("rejects a parent request with a wrong family PIN before reading contacts", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue(null);
    const response = await emergencyTestPOST(bodyRequest({ pin: "9999" }, await parentCookie()));

    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("Invalid PIN");
    expect(mocks.liveEmergencyContacts).not.toHaveBeenCalled();
    expect(mocks.sendSMSViaEmail).not.toHaveBeenCalled();
  });

  it("returns explicit partial details for a house-only delivery", async () => {
    mocks.broadcastHouseAlert.mockResolvedValue({ sent: 2, failed: 0, notes: ["telegram delivered"] });
    mocks.sendSMSViaEmail.mockResolvedValue({ success: false, error: "sms unavailable" });
    mocks.sendEmailAlert.mockResolvedValue({ success: false, error: "email unavailable" });

    const response = await emergencyTestPOST(bodyRequest({ pin: "1234" }, await parentCookie()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.partial).toBe(true);
    expect(body.warning).toMatch(/house|retry/i);
    expect(body.details).toMatchObject({
      total: 1,
      successful: 0,
      failed: 1,
      partial: true,
    });
    expect(body.details.results[0].results).toEqual([
      { method: "SMS", success: false, error: "sms unavailable" },
      { method: "Email", success: false, error: "email unavailable" },
    ]);
    expect(body.details.channelResults).toHaveLength(2);
    expect(body.details.houseAlert).toEqual({ sent: 2, failed: 0, notes: ["telegram delivered"] });
  });

  it("marks a full contact delivery as partial when the house channel fails", async () => {
    mocks.broadcastHouseAlert.mockResolvedValue({ sent: 0, failed: 1, notes: ["telegram unavailable"] });

    const response = await emergencyTestPOST(bodyRequest({ pin: "1234" }, await parentCookie()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.partial).toBe(true);
    expect(body.warning).toMatch(/house/i);
    expect(body.details).toMatchObject({ total: 1, successful: 1, failed: 0, partial: true });
  });

  it("fails honestly when no primary recipient is configured", async () => {
    mocks.liveEmergencyContacts.mockResolvedValue([{ name: "Reference", isPrimary: false }]);
    const response = await emergencyTestPOST(bodyRequest({ pin: "1234" }, await parentCookie()));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toMatchObject({ ok: false, error: "no_primary_contacts" });
    expect(mocks.sendSMSViaEmail).not.toHaveBeenCalled();
    expect(mocks.sendEmailAlert).not.toHaveBeenCalled();
    expect(mocks.broadcastHouseAlert).not.toHaveBeenCalled();
  });
});
