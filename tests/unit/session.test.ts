import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  sessionCookieOptions,
  signSession,
  verifySession,
} from "../../src/lib/session";

beforeEach(() => vi.stubEnv("SESSION_SECRET", "test-secret-0123456789"));
afterEach(() => vi.unstubAllEnvs());

async function lifetimeSeconds(token: string): Promise<number> {
  const payload = await verifySession(token);
  if (!payload) throw new Error("token did not verify");
  return payload.exp - (payload.iat ?? 0);
}

describe("session tokens", () => {
  it("round-trips a signed payload", async () => {
    const token = await signSession({ memberId: "m1", name: "Rebecca", role: "parent" });
    const out = await verifySession(token);
    expect(out).toMatchObject({ memberId: "m1", name: "Rebecca", role: "parent" });
    expect(out!.exp).toBeGreaterThan(out!.iat!);
  });

  it("uses role-aware signed lifetimes", async () => {
    const parent = await signSession({
      memberId: "p",
      name: "Parent One",
      role: "parent",
    });
    const child = await signSession({
      memberId: "c",
      name: "Child One",
      role: "child",
    });
    const pet = await signSession({
      memberId: "r",
      name: "Pet One",
      role: "pet",
    });

    expect(await lifetimeSeconds(parent)).toBe(1800);
    expect(await lifetimeSeconds(child)).toBe(900);
    expect(await lifetimeSeconds(pet)).toBe(900);
  });

  it("lets an explicit ttl override the role default", async () => {
    const token = await signSession({ memberId: "p", name: "Parent One", role: "parent" }, -10);
    expect(await verifySession(token)).toBeNull();
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

  it("refuses to sign at all without SESSION_SECRET", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    await expect(
      signSession({ memberId: "m1", name: "R", role: "parent" }),
    ).rejects.toThrow(/SESSION_SECRET/);
  });

  it("fails closed without SESSION_SECRET", async () => {
    const token = await signSession({ memberId: "m1", name: "R", role: "parent" });
    vi.stubEnv("SESSION_SECRET", "");
    expect(await verifySession(token)).toBeNull();
  });
});

describe("sessionCookieOptions", () => {
  it("returns the shared attributes with a role-aware Max-Age", () => {
    expect(sessionCookieOptions("parent")).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 1800,
    });
    expect(sessionCookieOptions("child")).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 900,
    });
    expect(sessionCookieOptions("pet")).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 900,
    });
  });

  it("honors an explicit maxAge so logout can expire the same cookie", () => {
    expect(sessionCookieOptions("parent", 0)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 0,
    });
    expect(sessionCookieOptions("child", 45).maxAge).toBe(45);
  });

  it("marks the cookie Secure in production unless the LAN override disables it", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_COOKIE_SECURE", "");
    expect(sessionCookieOptions("parent").secure).toBe(true);
    vi.stubEnv("SESSION_COOKIE_SECURE", "false");
    expect(sessionCookieOptions("parent").secure).toBe(false);
  });
});
