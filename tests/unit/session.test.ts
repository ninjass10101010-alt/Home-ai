import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { signSession, verifySession } from "../../src/lib/session";

beforeEach(() => vi.stubEnv("SESSION_SECRET", "test-secret-0123456789"));
afterEach(() => vi.unstubAllEnvs());

describe("session tokens", () => {
  it("round-trips a signed payload", async () => {
    const token = await signSession({ memberId: "m1", name: "Rebecca", role: "parent" });
    const out = await verifySession(token);
    expect(out).toMatchObject({ memberId: "m1", name: "Rebecca", role: "parent" });
    expect(out!.exp).toBeGreaterThan(out!.iat!);
  });

  it("rejects tampered payloads", async () => {
    const token = await signSession({ memberId: "m1", name: "Rebecca", role: "child" });
    const [, body] = token.split(".");
    const forged = ["v1", btoa(JSON.stringify({ memberId: "m1", name: "X", role: "parent", iat: 1, exp: 9e15 })).replace(/=+$/, ""), body].join(".");
    expect(await verifySession(forged)).toBeNull();
  });

  it("rejects expired tokens", async () => {
    const token = await signSession({ memberId: "m1", name: "R", role: "parent" }, -10);
    expect(await verifySession(token)).toBeNull();
  });

  it("fails closed without SESSION_SECRET", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    const token = await signSession({ memberId: "m1", name: "R", role: "parent" });
    expect(await verifySession(token)).toBeNull();
  });
});
