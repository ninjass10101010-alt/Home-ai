// P0 — the /api/emergency PIN gate must FAIL CLOSED.
//
// The shipped gate compared `String(providedPin)` against
// `process.env.EMERGENCY_PIN_BYPASS || ""`, whose default is "". Because an
// empty array is truthy and `String([])` is "", a body of {"type":"fire","pin":[]}
// sailed through: no PIN was required at all and the route fired a real SMS +
// email blast to every primary contact plus a Home Assistant broadcast —
// repeatable every 30 seconds.
//
// Contracts preserved here (docs/EMERGENCY_SETUP.md + AGENTS.md): live contacts
// with provenance, parent cooldown, duplicate-submit guard, honest partial
// delivery, and fail-closed when live contacts cannot be read.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  verifyPinAgainstAnyMember: vi.fn(),
  resolveGmailCredentials: vi.fn(),
  sendSMSViaEmail: vi.fn(),
  sendEmailAlert: vi.fn(),
  broadcastHouseAlert: vi.fn(),
  liveEmergencyContacts: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({
  verifyPinAgainstAnyMember: mocks.verifyPinAgainstAnyMember,
}));

vi.mock("@/lib/consuela/live-reads", () => ({
  liveEmergencyContacts: mocks.liveEmergencyContacts,
}));

vi.mock("@/lib/free-communication", () => ({
  resolveGmailCredentials: mocks.resolveGmailCredentials,
  sendSMSViaEmail: mocks.sendSMSViaEmail,
  sendEmailAlert: mocks.sendEmailAlert,
}));

vi.mock("@/lib/ha/notify", () => ({
  broadcastHouseAlert: mocks.broadcastHouseAlert,
}));

import {
  POST as emergencyPOST,
  emergencyPinCandidates,
  timingSafePinEquals,
  __resetEmergencyGuardsForTests,
} from "../../src/app/api/emergency/route";

function jsonRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/emergency", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function expectNoBlast() {
  expect(mocks.liveEmergencyContacts).not.toHaveBeenCalled();
  expect(mocks.broadcastHouseAlert).not.toHaveBeenCalled();
  expect(mocks.sendSMSViaEmail).not.toHaveBeenCalled();
  expect(mocks.sendEmailAlert).not.toHaveBeenCalled();
}

describe("emergency PIN gate — fail-closed (no bypass without an explicit PIN)", () => {
  beforeEach(() => {
    __resetEmergencyGuardsForTests();
    vi.stubEnv("GMAIL_USER", "fam@gmail.com");
    vi.stubEnv("GMAIL_APP_PASSWORD", "app-pass");
    mocks.verifyPinAgainstAnyMember.mockReset().mockResolvedValue(null);
    mocks.resolveGmailCredentials.mockReset().mockResolvedValue({ user: "configured@example.com", pass: "configured" });
    mocks.sendSMSViaEmail.mockReset().mockResolvedValue({ success: true });
    mocks.sendEmailAlert.mockReset().mockResolvedValue({ success: true });
    mocks.broadcastHouseAlert.mockReset().mockResolvedValue({ sent: 1, failed: 0, notes: [] });
    mocks.liveEmergencyContacts.mockReset().mockResolvedValue([
      { name: "Rebecca", phone: "+15551234567", email: "r@x.com", carrier: "verizon", isPrimary: true },
    ]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects {\"pin\":[]} with 401 and sends nothing when EMERGENCY_PIN_BYPASS is unset", async () => {
    vi.stubEnv("EMERGENCY_PIN_BYPASS", undefined);

    const res = await emergencyPOST(await jsonRequest({ type: "fire", pin: [] }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toMatchObject({ ok: false });
    expect(mocks.verifyPinAgainstAnyMember).not.toHaveBeenCalled();
    expectNoBlast();
  });

  it("rejects {\"pin\":[]} with 401 and sends nothing even when a bypass IS configured", async () => {
    vi.stubEnv("EMERGENCY_PIN_BYPASS", "9999");

    const res = await emergencyPOST(await jsonRequest({ type: "fire", pin: [] }));

    expect(res.status).toBe(401);
    expect(mocks.verifyPinAgainstAnyMember).not.toHaveBeenCalled();
    expectNoBlast();
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["whitespace-only", "   "],
  ])("treats a %s EMERGENCY_PIN_BYPASS as OFF — a wrong PIN is still 401", async (_label, value) => {
    vi.stubEnv("EMERGENCY_PIN_BYPASS", value as string | undefined);

    const res = await emergencyPOST(await jsonRequest({ type: "general", pin: "0000" }));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Invalid PIN");
    expectNoBlast();
  });

  it.each([
    ["undefined", undefined, 401],
    ["null", null, 401],
    ["an empty string", "", 401],
    ["an empty array", [], 401],
    ["an array of empty strings", ["", ""], 401],
    ["a whitespace-only string", "   ", 401],
    ["an object", {}, 401],
    ["a boolean", true, 401],
  ])("asks for a real PIN when pin is %s", async (_label, pin, status) => {
    const res = await emergencyPOST(await jsonRequest({ type: "general", pin }));

    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe("PIN required to trigger emergency alert");
    // A shape that carries no usable PIN must never reach the verifier — it
    // must not be coerced into one.
    expect(mocks.verifyPinAgainstAnyMember).not.toHaveBeenCalled();
    expectNoBlast();
  });

  it("normalizes a single-element numeric array [1234] to the PIN string", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m1", name: "Rebecca", role: "parent" });

    const res = await emergencyPOST(await jsonRequest({ type: "general", pin: [1234] }));

    expect(res.status).toBe(200);
    expect(mocks.verifyPinAgainstAnyMember).toHaveBeenCalledWith("1234");
  });

  it("normalizes a bare number pin to its digit string", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m1", name: "Rebecca", role: "parent" });

    const res = await emergencyPOST(await jsonRequest({ type: "general", pin: 1234 }));

    expect(res.status).toBe(200);
    expect(mocks.verifyPinAgainstAnyMember).toHaveBeenCalledWith("1234");
  });

  it("trims a string pin instead of comparing it raw", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m1", name: "Rebecca", role: "parent" });

    const res = await emergencyPOST(await jsonRequest({ type: "general", pin: " 1234 " }));

    expect(res.status).toBe(200);
    expect(mocks.verifyPinAgainstAnyMember).toHaveBeenCalledWith("1234");
  });

  it("accepts a candidate array and verifies each candidate in order", async () => {
    mocks.verifyPinAgainstAnyMember
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "m2", name: "Dad", role: "parent" });

    const res = await emergencyPOST(await jsonRequest({ type: "water", pin: ["1111", "2222"] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mocks.verifyPinAgainstAnyMember.mock.calls.map((call) => call[0])).toEqual(["1111", "2222"]);
  });

  it("falls back to the x-emergency-pin header when the body pin carries no candidate", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m1", name: "Rebecca", role: "parent" });

    const res = await emergencyPOST(
      jsonRequest({ type: "fire", pin: [] }, { "x-emergency-pin": "1234" }),
    );

    expect(res.status).toBe(200);
    expect(mocks.verifyPinAgainstAnyMember).toHaveBeenCalledWith("1234");
  });

  it("still accepts the header-only form (documented x-emergency-pin contract)", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m1", name: "Rebecca", role: "parent" });

    const res = await emergencyPOST(jsonRequest({ type: "fire" }, { "x-emergency-pin": "1234" }));

    expect(res.status).toBe(200);
    expect(mocks.verifyPinAgainstAnyMember).toHaveBeenCalledWith("1234");
  });

  it("honors an explicitly configured bypass PIN", async () => {
    vi.stubEnv("EMERGENCY_PIN_BYPASS", "9999");

    const res = await emergencyPOST(await jsonRequest({ type: "water", pin: "9999" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("matches a whitespace-padded configured bypass after trimming", async () => {
    vi.stubEnv("EMERGENCY_PIN_BYPASS", "  9999  ");

    const res = await emergencyPOST(await jsonRequest({ type: "water", pin: "9999" }));

    expect(res.status).toBe(200);
  });

  it("rejects a wrong PIN while a bypass is configured", async () => {
    vi.stubEnv("EMERGENCY_PIN_BYPASS", "9999");

    const res = await emergencyPOST(await jsonRequest({ type: "water", pin: "1111" }));

    expect(res.status).toBe(401);
    expectNoBlast();
  });

  it("never matches a bypass prefix or an empty candidate against the configured bypass", async () => {
    vi.stubEnv("EMERGENCY_PIN_BYPASS", "9999");

    for (const pin of ["", "99", "99990", "0"]) {
      const res = await emergencyPOST(await jsonRequest({ type: "water", pin }));
      expect(res.status).toBe(401);
    }
    expectNoBlast();
  });

  it("bounds how many candidate PINs one request can make the server verify", async () => {
    const flood = Array.from({ length: 200 }, (_, index) => String(1000 + index));

    const res = await emergencyPOST(await jsonRequest({ type: "water", pin: flood }));

    expect(res.status).toBe(401);
    // Unbounded candidate arrays would turn one request into N PocketBase
    // full-list reads — a DoS amplifier on the emergency path.
    expect(mocks.verifyPinAgainstAnyMember.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("returns 503 pin_check_failed when the verifier itself is unavailable", async () => {
    mocks.verifyPinAgainstAnyMember.mockRejectedValue(new Error("PB unavailable"));

    const res = await emergencyPOST(await jsonRequest({ type: "general", pin: "1234" }));

    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("pin_check_failed");
    expectNoBlast();
  });
});

describe("emergencyPinCandidates — deliberate normalization, never String() coercion", () => {
  it.each([
    [undefined, []],
    [null, []],
    ["", []],
    [[], []],
    [{}, []],
    [true, []],
    [1234, ["1234"]],
    ["1234", ["1234"]],
    [" 1234 ", ["1234"]],
    [[1234], ["1234"]],
    [["1234"], ["1234"]],
    [["", null, "4321"], ["4321"]],
    [["1111", "2222", 3333], ["1111", "2222", "3333"]],
    ["1234", ["1234"]], // duplicates collapse
    [["1234", "1234"], ["1234"]],
    ["12ab", []],
    [1.5, []],
    [Number.NaN, []],
    ["1234567890123", []], // absurd length is not a PIN
  ])("normalizes %j to %j", (input, expected) => {
    expect(emergencyPinCandidates(input)).toEqual(expected);
  });

  it("does not zero-pad a number, so a leading-zero PIN cannot be forged", () => {
    expect(emergencyPinCandidates(123)).toEqual(["123"]);
    expect(emergencyPinCandidates(["0123"])).toEqual(["0123"]);
  });

  it("caps the candidate list", () => {
    const many = Array.from({ length: 50 }, (_, index) => String(1000 + index));
    expect(emergencyPinCandidates(many).length).toBeLessThanOrEqual(4);
  });
});

describe("timingSafePinEquals — equal-length buffers only", () => {
  it("is true only for identical values", () => {
    expect(timingSafePinEquals("9999", "9999")).toBe(true);
    expect(timingSafePinEquals("9999", "9998")).toBe(false);
    expect(timingSafePinEquals("9999", "99")).toBe(false);
    // An empty side is never a match — fail closed, never "both empty, equal".
    expect(timingSafePinEquals("", "")).toBe(false);
    expect(timingSafePinEquals("", "9999")).toBe(false);
  });

  it("never matches a truncated or extended value", () => {
    expect(timingSafePinEquals("9999", "999")).toBe(false);
    expect(timingSafePinEquals("9999", "99999")).toBe(false);
  });

  it("handles values of different byte lengths without throwing", () => {
    expect(() => timingSafePinEquals("9", "999999999999999999999")).not.toThrow();
    expect(timingSafePinEquals("9", "999999999999999999999")).toBe(false);
  });
});

describe("source contract — the gate compares with timingSafeEqual, not ===", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/app/api/emergency/route.ts"),
    "utf8",
  );

  it("imports timingSafeEqual and routes the bypass comparison through the hashed helper", () => {
    expect(source).toMatch(/import\s*\{[^}]*timingSafeEqual[^}]*\}\s*from\s*"node:crypto"/);
    expect(source).toContain("timingSafePinEquals");
    // The old, exploitable comparison must be gone.
    expect(source).not.toMatch(/providedPin\s*!==\s*emergencyPinBypass/);
    expect(source).not.toMatch(/String\(providedPin\)/);
    // The empty default may never stand in for "no PIN required".
    expect(source).not.toMatch(/EMERGENCY_PIN_BYPASS\s*\|\|\s*""/);
  });
});