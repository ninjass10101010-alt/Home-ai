import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  MUSE_TOKEN_TTL_SECONDS,
  signMuseToken,
  verifyMuseToken,
} from "../../src/lib/muse/token";
import { signSession, verifySession } from "../../src/lib/session";

beforeEach(() => vi.stubEnv("SESSION_SECRET", "test-secret-0123456789"));
afterEach(() => vi.unstubAllEnvs());

const OK_CTX = { currentVersion: 1, enabled: true };

describe("muse tokens", () => {
  it("exposes a 24h TTL", () => {
    expect(MUSE_TOKEN_TTL_SECONDS).toBe(86400);
  });

  it("round-trips a signed token for both admin values", () => {
    for (const adm of [true, false]) {
      const { token, expiresAt } = signMuseToken({ ver: 1, adm });
      const parts = token.split(".");
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe("v1");
      expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(verifyMuseToken(token, OK_CTX)).toEqual({ ok: true, adm });
    }
  });

  it("rejects a tampered payload with bad_signature", () => {
    const { token } = signMuseToken({ ver: 1, adm: false });
    const [v, body, sig] = token.split(".");
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    decoded.adm = true;
    const forgedBody = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    const forged = [v, forgedBody, sig].join(".");
    expect(verifyMuseToken(forged, OK_CTX)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects an expired token", () => {
    const past = Date.now() - (MUSE_TOKEN_TTL_SECONDS + 60) * 1000;
    const { token } = signMuseToken({ ver: 1, adm: false }, past);
    expect(verifyMuseToken(token, OK_CTX)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a version mismatch as revoked", () => {
    const { token } = signMuseToken({ ver: 1, adm: false });
    expect(
      verifyMuseToken(token, { currentVersion: 2, enabled: true })
    ).toEqual({ ok: false, reason: "revoked" });
  });

  it("rejects a disabled identity", () => {
    const { token } = signMuseToken({ ver: 1, adm: false });
    expect(
      verifyMuseToken(token, { currentVersion: 1, enabled: false })
    ).toEqual({ ok: false, reason: "disabled" });
  });

  it("never throws on garbage input, always returning a reason", () => {
    const sessionShaped = `v1.${Buffer.from(
      JSON.stringify({ memberId: "m1", name: "x", role: "parent", exp: 9e15 })
    ).toString("base64url")}.${Buffer.from("a".repeat(32)).toString("base64url")}`;
    for (const bad of ["", "v1.!!!.???", sessionShaped, "not-a-token", "v1.only-two", null, undefined]) {
      const out = verifyMuseToken(bad as any, OK_CTX);
      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(["malformed", "bad_signature"]).toContain(out.reason);
      }
    }
  });
});

describe("context separation from dashboard sessions (fold-in, Task 7 review)", () => {
  it("rejects a REAL session token minted by signSession", async () => {
    const session = await signSession({ memberId: "m1", name: "Rebecca", role: "parent" });
    expect(session.startsWith("v1.")).toBe(true);
    expect(verifyMuseToken(session, OK_CTX).ok).toBe(false);
  });

  it("the inverse holds: verifySession rejects a MUSE token", async () => {
    const { token } = signMuseToken({ ver: 1, adm: true });
    expect(await verifySession(token)).toBeNull();
  });
});

describe("muse tokens fail closed without SESSION_SECRET", () => {
  it("throws at sign time and refuses at verify time", () => {
    vi.stubEnv("SESSION_SECRET", "");
    expect(() => signMuseToken({ ver: 1, adm: false })).toThrow();
    expect(verifyMuseToken("v1.abc.def", OK_CTX).ok).toBe(false);
  });
});
