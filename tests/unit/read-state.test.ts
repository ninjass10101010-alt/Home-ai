// @vitest-environment jsdom
/**
 * Audit P0-4 (phase 2) — the classification matrix behind every honest read.
 *
 * The bug being prevented is not a crash, it is a *wrong explanation*: a dead
 * NAS rendered as "Quiet day" is worse than an error, because the family acts on
 * it. So every row here pins one real failure shape to exactly one state and to
 * the copy a person would see.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  READ_COPY,
  READ_COPY_STALE,
  ReadError,
  assertReadable,
  classifyReadError,
  classifyStatus,
  isBrowserOffline,
  readMessageFor,
  readStateForRows,
  stateForGatewayRead,
  type ReadFailure,
} from "@/lib/read-state";

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value, configurable: true });
}

afterEach(() => setOnline(true));

describe("classifyStatus", () => {
  it("maps 401/403 to a session state, never to 'try again'", () => {
    expect(classifyStatus(401)).toBe("unauthorised");
    expect(classifyStatus(403)).toBe("unauthorised");
  });

  it("maps status 0 (request never reached a server) to offline", () => {
    expect(classifyStatus(0)).toBe("offline");
  });

  it("maps server and client faults to error", () => {
    expect(classifyStatus(500)).toBe("error");
    expect(classifyStatus(502)).toBe("error");
    expect(classifyStatus(404)).toBe("error");
  });
});

describe("classifyReadError", () => {
  it("honours an already-classified ReadError", () => {
    expect(classifyReadError(new ReadError("offline", "queued while offline"))).toBe("offline");
    expect(classifyReadError(new ReadError("unauthorised", "blocked"))).toBe("unauthorised");
  });

  it("reads a status-carrying rejection the same as a response", () => {
    expect(classifyReadError(Object.assign(new Error("nope"), { status: 403 }))).toBe("unauthorised");
    expect(classifyReadError({ status: 500 })).toBe("error");
  });

  it("calls a dropped connection offline only when the browser agrees", () => {
    setOnline(false);
    expect(classifyReadError(new TypeError("Failed to fetch"))).toBe("offline");
    expect(classifyReadError(new Error("NetworkError when attempting to fetch resource."))).toBe("offline");
  });

  it("does NOT blame the family's network for a transport failure while the browser is online", () => {
    // The realistic wall-display case: Wi-Fi is up, the NAS is not. "Offline —
    // showing your saved copy" would send someone to the router.
    setOnline(true);
    expect(classifyReadError(new TypeError("Failed to fetch"))).toBe("error");
  });

  it("treats a host that cannot report connectivity as offline", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    try {
      // @ts-expect-error - deliberately removing navigator to model a non-browser host
      delete globalThis.navigator;
      expect(classifyReadError(new TypeError("fetch failed"))).toBe("offline");
    } finally {
      if (original) Object.defineProperty(globalThis, "navigator", original);
    }
  });

  it("falls back to the connectivity hint for an unrecognised throw", () => {
    setOnline(false);
    expect(classifyReadError(new Error("something odd"))).toBe("offline");
    setOnline(true);
    expect(classifyReadError(new Error("something odd"))).toBe("error");
    expect(classifyReadError("plain string")).toBe("error");
  });

  it("classifies a deliberate abort as an error so it never renders as empty", () => {
    expect(classifyReadError({ name: "AbortError", message: "The operation was aborted." })).toBe("error");
  });
});

describe("assertReadable", () => {
  it("passes ok responses through untouched", () => {
    const res = { ok: true, status: 200, body: "x" };
    expect(assertReadable(res)).toBe(res);
  });

  it("throws a ReadError carrying both the state and the status", () => {
    let caught: unknown;
    try {
      assertReadable({ ok: false, status: 401 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ReadError);
    expect((caught as ReadError).state).toBe("unauthorised");
    expect((caught as ReadError).status).toBe(401);
  });
});

describe("readStateForRows / stateForGatewayRead", () => {
  it("separates a successful empty read from a missing one", () => {
    expect(readStateForRows([])).toBe("empty");
    expect(readStateForRows([{ id: "a" }])).toBe("ready");
    expect(readStateForRows(null)).toBe("empty");
  });

  it("reports a BLOCKED gateway read as unauthorised, not empty", () => {
    // This is the `gatewayReadStatus` case that `clientListOrEmpty` used to hide.
    expect(stateForGatewayRead({ items: [], blocked: true })).toBe("unauthorised");
    expect(stateForGatewayRead({ items: [], blocked: false })).toBe("empty");
    expect(stateForGatewayRead({ items: [{ id: "1" }], blocked: false })).toBe("ready");
  });
});

describe("copy", () => {
  const FAILURES: ReadFailure[] = ["empty", "offline", "unauthorised", "error"];

  it("has copy for every failure state and nothing else", () => {
    expect(Object.keys(READ_COPY).sort()).toEqual([...FAILURES].sort());
  });

  it("speaks human, not stack trace", () => {
    for (const state of FAILURES) {
      const copy = READ_COPY[state];
      expect(copy.length).toBeGreaterThan(10);
      expect(copy).not.toMatch(/\b(undefined|null|NaN|HTTP|fetch|Error|40[13]|500)\b/);
    }
  });

  it("says the copy is stale rather than fresh once data is on screen", () => {
    expect(readMessageFor("offline", true)).toBe(READ_COPY_STALE);
    expect(readMessageFor("error", true)).toBe(READ_COPY_STALE);
    // With nothing loaded there is no "saved copy" to promise — never claim one.
    expect(readMessageFor("offline", false)).toBe(READ_COPY.offline);
    expect(readMessageFor("error", false)).toBe(READ_COPY.error);
    expect(readMessageFor("error", false)).not.toContain("saved copy");
    // A signed-out browser still has to be told to sign in, data or not.
    expect(readMessageFor("unauthorised", true)).toBe(READ_COPY.unauthorised);
    expect(readMessageFor("unauthorised", false)).toBe(READ_COPY.unauthorised);
  });

  it("isBrowserOffline only trusts a real boolean", () => {
    setOnline(false);
    expect(isBrowserOffline()).toBe(true);
    setOnline(true);
    expect(isBrowserOffline()).toBe(false);
  });
});
