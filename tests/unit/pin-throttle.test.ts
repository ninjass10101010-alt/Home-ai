import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Fix #1 — PIN brute-force protection. The shared server-side verifiers must
// throttle repeated failures per source: 5 consecutive wrong PINs lock the
// source out for 30s (escalating on continued failures), and a successful
// verification resets the counter.

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: mocks.withAdmin,
}));

import {
  verifyPinFromPB,
  verifyPinAgainstAnyMember,
  __resetPinThrottleForTests,
} from "../../src/lib/server-auth";

const MEMBERS = [
  { id: "m1", name: "Rebecca Garcia", role: "parent", pin: "4321" },
];

function adminReturnsMembers() {
  mocks.withAdmin.mockImplementation(async (fn: (pb: any) => any) =>
    fn({
      collection: () => ({
        getFullList: vi.fn().mockResolvedValue(MEMBERS),
      }),
    })
  );
}

describe("PIN verification throttling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetPinThrottleForTests();
    adminReturnsMembers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("locks verifyPinFromPB after 5 consecutive failures, even for the correct pin", async () => {
    for (let i = 0; i < 5; i++) {
      expect(await verifyPinFromPB("Rebecca", "9999")).toBeNull();
    }
    // Correct pin must now be rejected by the throttle.
    expect(await verifyPinFromPB("Rebecca", "4321")).toBeNull();
  });

  it("locks verifyPinAgainstAnyMember after 5 consecutive failures", async () => {
    for (let i = 0; i < 5; i++) {
      expect(await verifyPinAgainstAnyMember("9999")).toBeNull();
    }
    expect(await verifyPinAgainstAnyMember("4321")).toBeNull();
  });

  it("unlocks after the 30s lockout window", async () => {
    for (let i = 0; i < 5; i++) {
      await verifyPinFromPB("Rebecca", "9999");
    }
    expect(await verifyPinFromPB("Rebecca", "4321")).toBeNull();

    vi.advanceTimersByTime(31_000);
    expect(await verifyPinFromPB("Rebecca", "4321")).not.toBeNull();
  });

  it("resets the failure counter after a successful verification", async () => {
    for (let i = 0; i < 4; i++) {
      await verifyPinFromPB("Rebecca", "9999");
    }
    // 4 failures — not locked yet; success resets.
    expect(await verifyPinFromPB("Rebecca", "4321")).not.toBeNull();

    for (let i = 0; i < 4; i++) {
      await verifyPinFromPB("Rebecca", "9999");
    }
    // Still only 4 consecutive failures since the reset.
    expect(await verifyPinFromPB("Rebecca", "4321")).not.toBeNull();
  });

  it("escalates: a failure during lockout extends the window", async () => {
    for (let i = 0; i < 5; i++) {
      await verifyPinAgainstAnyMember("9999");
    }
    expect(await verifyPinAgainstAnyMember("4321")).toBeNull();

    // 20s in — still locked; the rejected attempt extends the lockout.
    vi.advanceTimersByTime(20_000);
    expect(await verifyPinAgainstAnyMember("4321")).toBeNull();

    // 10s later (30s since the first lockout, but only 10s since the extension).
    vi.advanceTimersByTime(10_000);
    expect(await verifyPinAgainstAnyMember("4321")).toBeNull();

    // 31s after the extension, it unlocks.
    vi.advanceTimersByTime(31_000);
    expect(await verifyPinAgainstAnyMember("4321")).not.toBeNull();
  });

  it("does not count a successful verification toward the lockout", async () => {
    for (let i = 0; i < 3; i++) {
      await verifyPinFromPB("Rebecca", "9999");
      expect(await verifyPinFromPB("Rebecca", "4321")).not.toBeNull();
    }
    // Still under the failure threshold after alternating good/bad tries.
    expect(await verifyPinFromPB("Rebecca", "4321")).not.toBeNull();
  });
});
