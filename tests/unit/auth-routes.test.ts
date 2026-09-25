import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyPinFromPB: vi.fn(),
  findMemberByName: vi.fn(),
  requireLiveSession: vi.fn(),
}));
vi.mock("@/lib/server-auth", () => ({
  verifyPinFromPB: mocks.verifyPinFromPB,
  findMemberByName: mocks.findMemberByName,
  requireLiveSession: mocks.requireLiveSession,
  sanitizeMember: (m: any) => {
    const { pin, ...rest } = m;
    return rest;
  },
}));

import { POST as loginPOST } from "@/app/api/auth/login/route";
import { GET as whoamiGET } from "@/app/api/auth/whoami/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { sessionCookieSecure, verifySession } from "@/lib/session";

function req(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(url, init as any);
}

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  mocks.verifyPinFromPB.mockReset();
  mocks.requireLiveSession.mockReset().mockImplementation(async (request: Request) => {
    const token = request.headers.get("cookie")?.match(/consuela_session=([^;]+)/)?.[1];
    const signed = await verifySession(token);
    if (!signed) return { ok: false as const, status: 401 as const, error: "unauthorized" as const };
    return {
      ok: true as const,
      identity: { memberId: signed.memberId, name: signed.name, role: signed.role },
    };
  });
});

describe("POST /api/auth/login", () => {
  it("sets an httpOnly session cookie on valid PIN", async () => {
    mocks.verifyPinFromPB.mockResolvedValue({ id: "m1", name: "Rebecca", role: "parent", pin: "9999" });
    const res = await loginPOST(req("http://x/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberName: "Rebecca", pin: "1234" }),
    }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toContain("consuela_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect(setCookie).toContain("Path=/");
    expect((await res.json()).member.pin).toBeUndefined();
  });

  it("sets the role-aware Max-Age on the session cookie", async () => {
    mocks.verifyPinFromPB.mockResolvedValue({ id: "m1", name: "Rebecca", role: "parent", pin: "9999" });
    const parent = await loginPOST(req("http://x/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberName: "Rebecca", pin: "1234" }),
    }));
    expect(parent.headers.get("set-cookie")).toContain("Max-Age=1800");

    mocks.verifyPinFromPB.mockResolvedValue({ id: "m-kid", name: "Caspian", role: "child", pin: "1010" });
    const child = await loginPOST(req("http://x/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberName: "Caspian", pin: "1010" }),
    }));
    expect(child.headers.get("set-cookie")).toContain("Max-Age=900");
  });

  it("refuses a PocketBase role outside the session vocabulary and sets NO cookie", async () => {
    mocks.verifyPinFromPB.mockResolvedValue({ id: "m9", name: "Guest Admin", role: "guest-admin", pin: "1234" });

    const res = await loginPOST(req("http://x/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberName: "Guest Admin", pin: "1234" }),
    }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "unsupported_role" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("returns 401 on invalid PIN and 400 on missing fields", async () => {
    mocks.verifyPinFromPB.mockResolvedValue(null);
    expect((await loginPOST(req("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberName: "R", pin: "0000" }) }))).status).toBe(401);
    expect((await loginPOST(req("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }))).status).toBe(400);
  });

  it("returns 500 without issuing a cookie when SESSION_SECRET is unset", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    mocks.verifyPinFromPB.mockResolvedValue({ id: "m1", name: "Rebecca", role: "parent", pin: "9999" });

    const res = await loginPOST(req("http://x/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberName: "Rebecca", pin: "1234" }),
    }));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("SESSION_SECRET");
    expect(res.headers.get("set-cookie")).toBeNull();
    // Guard sits after PIN verification: bad config must not skip the auth check
    expect(mocks.verifyPinFromPB).toHaveBeenCalledWith("Rebecca", "1234");
  });
});

describe("sessionCookieSecure", () => {
  it("is Secure in production by default", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_COOKIE_SECURE", "");
    expect(sessionCookieSecure()).toBe(true);
  });

  it("is NOT Secure when SESSION_COOKIE_SECURE=false (LAN http deployments)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_COOKIE_SECURE", "false");
    expect(sessionCookieSecure()).toBe(false);
  });

  it("is NOT Secure in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SESSION_COOKIE_SECURE", "");
    expect(sessionCookieSecure()).toBe(false);
  });
});

describe("GET /api/auth/whoami", () => {
  it("returns the live member identity for a valid session cookie", async () => {
    const { signSession } = await import("@/lib/session");
    const token = await signSession({ memberId: "m1", name: "Rebecca", role: "parent" });
    const res = await whoamiGET(req("http://x/api/auth/whoami", { headers: { cookie: `consuela_session=${token}` } }));
    expect(res.status).toBe(200);
    const member = (await res.json()).member;
    expect(member.name).toBe("Rebecca");
    expect(member.memberId).toBe("m1");
    expect(member.role).toBe("parent");
  });

  it("returns 401 without a cookie", async () => {
    expect((await whoamiGET(req("http://x/api/auth/whoami"))).status).toBe(401);
  });

  it("returns 403 session_role_changed when the live row drifted from the signed role", async () => {
    const { signSession } = await import("@/lib/session");
    const token = await signSession({ memberId: "m1", name: "Rebecca", role: "parent" });
    mocks.requireLiveSession.mockResolvedValue({ ok: false, status: 403, error: "session_role_changed" });
    const res = await whoamiGET(req("http://x/api/auth/whoami", { headers: { cookie: `consuela_session=${token}` } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "session_role_changed" });
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the cookie", async () => {
    const res = await logoutPOST(req("http://x/api/auth/logout", { method: "POST" }));
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("expires the cookie with the same attributes the login route issues", async () => {
    mocks.verifyPinFromPB.mockResolvedValue({ id: "m1", name: "Rebecca", role: "parent", pin: "9999" });
    const login = await loginPOST(req("http://x/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberName: "Rebecca", pin: "1234" }),
    }));
    const logout = await logoutPOST(req("http://x/api/auth/logout", { method: "POST" }));

    const attributes = (value: string) =>
      value
        .split(";")
        .map((part) => part.trim())
        .filter(
          (part) =>
            !part.startsWith("Max-Age") &&
            !part.startsWith("Expires=") &&
            !part.startsWith("consuela_session="),
        )
        .sort();

    expect(attributes(logout.headers.get("set-cookie")!)).toEqual(
      attributes(login.headers.get("set-cookie")!),
    );
    expect(attributes(logout.headers.get("set-cookie")!)).toContain("HttpOnly");
    expect(attributes(logout.headers.get("set-cookie")!)).toContain("Path=/");
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
