// Credential comparisons that gate every privileged write must not leak, by
// their own timing, how much of a guess was right. The repo already ships the
// correct idiom — `timingSafePinEquals` in src/app/api/emergency/route.ts,
// credited as "fail-closed, timing-safe" in AGENTS.md — and three comparators
// still did a plain `===`:
//
//   src/lib/cron-auth.ts            the bearer on every /api/cron/** route
//   src/lib/member-pins.ts          the family PIN
//   src/lib/server-auth.ts          verifyPinAgainstAnyMember (the roster walk)
//
// Every secret in this file is an obvious dummy. Nothing here reads, and
// nothing here may print, a real credential.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  // A counting wrapper, not a replacement: the real compare still runs, so every
  // answer below is the shipped one — only the NUMBER of roster comparisons is
  // observable from outside.
  pinCompares: [] as unknown[][],
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: mocks.withAdmin,
}));

vi.mock("@/lib/member-pins", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/member-pins")>();
  return {
    ...actual,
    memberPinMatches: (member: { name?: string; pin?: string }, pin: string) => {
      mocks.pinCompares.push([member, pin]);
      return actual.memberPinMatches(member, pin);
    },
  };
});

import { isCronAuthorized } from "@/lib/cron-auth";
import { memberPinMatches, resolveMemberPin } from "@/lib/member-pins";
import {
  verifyPinAgainstAnyMember,
  __resetPinThrottleForTests,
} from "@/lib/server-auth";
import { sanitizeTaskOperationPayload } from "@/lib/task-command-store";

// Obvious dummies. The real family defaults live in pb-seed (server-only) and
// are deliberately not reproduced here.
const CRON_SECRET = "dummy-cron-secret-for-tests";
const OTHER_CRON_SECRET = "dummy-cron-secret-for-tests-2";
const MEMBER_PIN = "1111";
const OTHER_MEMBER_PIN = "2222";
const WRONG_PIN = "9999";

function cronRequest(authorization?: string): Request {
  return new Request("http://localhost/api/cron/consuela/briefing", {
    method: "POST",
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe("isCronAuthorized — timing-safe, still fail-closed", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("authorizes the exact bearer", () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    expect(isCronAuthorized(cronRequest(`Bearer ${CRON_SECRET}`))).toBe(true);
  });

  it("refuses a wrong bearer", () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    expect(isCronAuthorized(cronRequest(`Bearer ${OTHER_CRON_SECRET}`))).toBe(false);
    expect(isCronAuthorized(cronRequest("Bearer wrong"))).toBe(false);
    expect(isCronAuthorized(cronRequest(`bearer ${CRON_SECRET}`))).toBe(false);
    expect(isCronAuthorized(cronRequest(`Bearer ${CRON_SECRET} extra`))).toBe(false);
  });

  it("refuses a same-length bearer whose bytes differ", () => {
    // The case a timing-unsafe compare can also refuse: the ONLY thing that may
    // differ is the last character, so nothing shorter than the whole string can
    // settle it.
    const trailing = CRON_SECRET.slice(0, -1);
    const wrongLastByte = `${trailing}${CRON_SECRET.at(-1) === "Z" ? "Y" : "Z"}`;
    expect(wrongLastByte).toHaveLength(CRON_SECRET.length);
    expect(wrongLastByte).not.toBe(CRON_SECRET);

    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    expect(isCronAuthorized(cronRequest(`Bearer ${wrongLastByte}`))).toBe(false);
    expect(isCronAuthorized(cronRequest(`Bearer ${CRON_SECRET}`))).toBe(true);
  });

  it("refuses a length-mismatched header WITHOUT throwing", () => {
    // The regression a naive port introduces: `timingSafeEqual` throws on a
    // length mismatch, so a guard that hashes only the presented value would turn
    // a wrong bearer into a 500 instead of a 401.
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    expect(() =>
      isCronAuthorized(cronRequest("Bearer a")),
    ).not.toThrow();
    expect(isCronAuthorized(cronRequest("Bearer a"))).toBe(false);
    expect(
      isCronAuthorized(cronRequest(`Bearer ${"x".repeat(CRON_SECRET.length + 64)}`)),
    ).toBe(false);
  });

  it("refuses a missing header without throwing", () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    expect(() => isCronAuthorized(cronRequest())).not.toThrow();
    expect(isCronAuthorized(cronRequest())).toBe(false);
    expect(isCronAuthorized(cronRequest(""))).toBe(false);
  });

  it("fails closed when CRON_SECRET is unset — including 'Bearer undefined'", () => {
    // A digest-based compare must not re-open the hole the `if (!secret)` guard
    // closed: with no secret the literal string "undefined" must still be the
    // literal string.
    vi.stubEnv("CRON_SECRET", "");
    expect(isCronAuthorized(cronRequest("Bearer undefined"))).toBe(false);
    expect(isCronAuthorized(cronRequest(`Bearer ${CRON_SECRET}`))).toBe(false);
    expect(isCronAuthorized(cronRequest())).toBe(false);

    delete process.env.CRON_SECRET;
    expect(isCronAuthorized(cronRequest("Bearer undefined"))).toBe(false);
    expect(isCronAuthorized(cronRequest())).toBe(false);
  });
});

describe("memberPinMatches — same answers, no early exit", () => {
  it("accepts the stored PIN and refuses any other", () => {
    const member = { name: "Test Parent", pin: MEMBER_PIN };
    expect(memberPinMatches(member, MEMBER_PIN)).toBe(true);
    expect(memberPinMatches(member, OTHER_MEMBER_PIN)).toBe(false);
    expect(memberPinMatches(member, "")).toBe(false);
  });

  it("stringifies the candidate exactly as before", () => {
    const member = { name: "Test Parent", pin: MEMBER_PIN };
    // A numeric PIN the caller typed as a number still matches, as it always did.
    expect(memberPinMatches(member, Number(MEMBER_PIN) as unknown as string)).toBe(true);
    // A stored non-string PIN is still read through String().
    expect(memberPinMatches({ pin: MEMBER_PIN as unknown as string }, MEMBER_PIN)).toBe(true);
  });

  it("returns false — never true — for a pin-less member, a missing member, or an empty PIN", () => {
    expect(memberPinMatches({ name: "No Pin" }, MEMBER_PIN)).toBe(false);
    expect(memberPinMatches({ name: "No Pin", pin: "" }, MEMBER_PIN)).toBe(false);
    // The one combination an unguarded constant-time compare would wave through:
    // nothing stored on both sides is not a match.
    expect(memberPinMatches({ name: "No Pin", pin: "" }, "")).toBe(false);
    expect(memberPinMatches({}, "")).toBe(false);
    expect(memberPinMatches(undefined as unknown as { pin?: string }, MEMBER_PIN)).toBe(false);
  });

  it("keeps resolveMemberPin's normalization untouched", () => {
    expect(resolveMemberPin({ pin: MEMBER_PIN })).toBe(MEMBER_PIN);
    expect(resolveMemberPin({ pin: 1111 as unknown as string })).toBe("1111");
    expect(resolveMemberPin({})).toBe("");
    expect(resolveMemberPin(undefined as unknown as { pin?: string })).toBe("");
  });

  it("settles only after the WHOLE presented PIN has been inspected", () => {
    // A `===` returns at the first differing character, so a wrong PIN costs less
    // work the earlier it diverges: the time a request takes becomes a function of
    // how much of the guess was right. There is no black-box way to observe that
    // in JS, so this pins the mechanism a constant-time compare has to use — it
    // reads the candidate's characters, and it reads the SAME number of them
    // whether the PIN is wrong in the first character or in the last.
    const member = { name: "Test Parent", pin: MEMBER_PIN };
    const characterReads = (pin: string) => {
      const spy = vi.spyOn(String.prototype, "charCodeAt");
      try {
        expect(memberPinMatches(member, pin)).toBe(false);
        return spy.mock.calls.length;
      } finally {
        spy.mockRestore();
      }
    };

    const wrongFirstCharacter = characterReads(`9${MEMBER_PIN.slice(1)}`);
    const wrongLastCharacter = characterReads(`${MEMBER_PIN.slice(0, -1)}9`);
    expect(wrongFirstCharacter).toBeGreaterThan(0);
    expect(wrongLastCharacter).toBe(wrongFirstCharacter);
  });
});

function rosterFrom(members: Array<Record<string, unknown>>) {
  mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => unknown) =>
    fn({
      collection: () => ({
        getFullList: vi.fn().mockResolvedValue(members),
      }),
    }),
  );
}

const ROSTER = [
  { id: "m1", name: "Rebecca Garcia", role: "parent", pin: MEMBER_PIN },
  { id: "m2", name: "Caspian Garcia", role: "child", pin: OTHER_MEMBER_PIN },
];

describe("verifyPinAgainstAnyMember — constant work across the roster", () => {
  beforeEach(() => {
    __resetPinThrottleForTests();
    mocks.withAdmin.mockReset();
    rosterFrom(ROSTER.map((member) => ({ ...member })));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetPinThrottleForTests();
    mocks.pinCompares.length = 0;
  });

  it("returns the member whose PIN was presented", async () => {
    expect(await verifyPinAgainstAnyMember(MEMBER_PIN)).toMatchObject({ id: "m1" });
    expect(await verifyPinAgainstAnyMember(OTHER_MEMBER_PIN)).toMatchObject({ id: "m2" });
  });

  it("returns null for a wrong PIN and for an empty PIN", async () => {
    expect(await verifyPinAgainstAnyMember(WRONG_PIN)).toBeNull();
    // Empty: refused before PocketBase is touched at all, exactly as before.
    const getFullList = vi.fn().mockResolvedValue(ROSTER);
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => unknown) =>
      fn({ collection: () => ({ getFullList }) }),
    );
    expect(await verifyPinAgainstAnyMember("")).toBeNull();
    expect(getFullList).not.toHaveBeenCalled();
  });

  it("returns null when the roster holds no match", async () => {
    rosterFrom([]);
    expect(await verifyPinAgainstAnyMember(WRONG_PIN)).toBeNull();
  });

  it("returns the FIRST member holding a duplicated PIN", async () => {
    rosterFrom([
      { id: "m3", name: "Bailey Garcia", role: "child", pin: MEMBER_PIN },
      { id: "m1", name: "Rebecca Garcia", role: "parent", pin: MEMBER_PIN },
    ]);
    expect(await verifyPinAgainstAnyMember(MEMBER_PIN)).toMatchObject({ id: "m3" });
  });

  it("compares the whole roster even when the FIRST member matched", async () => {
    // The old `merged.find(...)` stopped at the first match, so the time taken
    // said WHICH member matched and how far down the roster it sat. Every member
    // must be compared on every call, whichever member wins.
    const comparedIds = () =>
      mocks.pinCompares
        .map(([member]) => String((member as { id?: unknown })?.id ?? ""))
        .filter((id) => id === "m1" || id === "m2");

    // First row matches.
    mocks.pinCompares.length = 0;
    expect(await verifyPinAgainstAnyMember(MEMBER_PIN)).toMatchObject({ id: "m1" });
    const firstMatch = comparedIds().sort();
    expect(firstMatch).toEqual(["m1", "m2"]);

    // Last row matches: the same comparisons, so the time taken cannot say which
    // member was verified.
    __resetPinThrottleForTests();
    mocks.pinCompares.length = 0;
    expect(await verifyPinAgainstAnyMember(OTHER_MEMBER_PIN)).toMatchObject({ id: "m2" });
    expect(comparedIds().sort()).toEqual(firstMatch);

    // And a wrong PIN costs the same again.
    __resetPinThrottleForTests();
    mocks.pinCompares.length = 0;
    expect(await verifyPinAgainstAnyMember(WRONG_PIN)).toBeNull();
    expect(comparedIds().sort()).toEqual(firstMatch);
  });
});

describe("ledger payload sanitization keeps an offline child target", () => {
  it("keeps targetMemberName on a queued penalty aimed at a child", () => {
    expect(
      sanitizeTaskOperationPayload("/api/tasks/ledger", "penalty", {
        memberName: "Rebecca Garcia",
        targetMemberName: "Caspian Garcia",
        itemId: "penalty-late",
      }),
    ).toEqual({
      memberName: "Rebecca Garcia",
      targetMemberName: "Caspian Garcia",
      itemId: "penalty-late",
    });
  });

  it("keeps targetMemberName on a queued adjust aimed at a child", () => {
    expect(
      sanitizeTaskOperationPayload("/api/tasks/ledger", "adjust", {
        memberName: "Rebecca Garcia",
        targetMemberName: "Caspian Garcia",
        amount: -5,
        reason: "made his own bed",
      }),
    ).toEqual({
      memberName: "Rebecca Garcia",
      targetMemberName: "Caspian Garcia",
      amount: -5,
      reason: "made his own bed",
    });
  });

  it("still strips everything that is not on the command's own contract", () => {
    const sanitized = sanitizeTaskOperationPayload("/api/tasks/ledger", "penalty", {
      memberName: "Rebecca Garcia",
      targetMemberName: "Caspian Garcia",
      itemId: "penalty-late",
      // A parent-authoritative movement: the server re-derives the balance and
      // refuses a client `points`, and no authority, credential or history may be
      // queued.
      points: -99,
      balance: 500,
      weekStart: "2026-09-21",
      pin: MEMBER_PIN,
      role: "parent",
      authority: "session",
      weekData: { points: { "Caspian Garcia": 500 } },
      // A computed key so this stays a plain object: a literal `__proto__:` would
      // set the prototype instead of adding a key.
      ["__proto__"]: { injected: true },
    });
    expect(sanitized).toEqual({
      memberName: "Rebecca Garcia",
      targetMemberName: "Caspian Garcia",
      itemId: "penalty-late",
    });
    expect(Object.keys(sanitized).sort()).toEqual([
      "itemId",
      "memberName",
      "targetMemberName",
    ]);
    expect(Object.getPrototypeOf(sanitized)).toBe(Object.prototype);
  });

  it("leaves a same-member (no target) command exactly as it was", () => {
    // The default is the actor, so a command with no target must be byte-identical
    // to the pre-split shape — no synthesized key, no reordering.
    expect(
      sanitizeTaskOperationPayload("/api/tasks/ledger", "penalty", {
        memberName: "Rebecca Garcia",
        itemId: "penalty-late",
      }),
    ).toEqual({ memberName: "Rebecca Garcia", itemId: "penalty-late" });
    expect(
      sanitizeTaskOperationPayload("/api/tasks/ledger", "adjust", {
        memberName: "Rebecca Garcia",
        amount: 10,
        reason: "helped with the recycling",
      }),
    ).toEqual({
      memberName: "Rebecca Garcia",
      amount: 10,
      reason: "helped with the recycling",
    });
  });

  it("does not admit a target on any other ledger action", () => {
    expect(
      sanitizeTaskOperationPayload("/api/tasks/ledger", "unknown-action", {
        memberName: "Rebecca Garcia",
        targetMemberName: "Caspian Garcia",
      }),
    ).toEqual({});
  });
});