import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ verifyPinFromPB: vi.fn(), findMemberByName: vi.fn() }));
vi.mock("@/lib/server-auth", () => ({
  verifyPinFromPB: mocks.verifyPinFromPB,
  findMemberByName: mocks.findMemberByName,
  sanitizeMember: (m: any) => {
    const { pin, ...rest } = m;
    return rest;
  },
}));

import { POST as loginPOST } from "@/app/api/auth/login/route";
import { GET as whoamiGET } from "@/app/api/auth/whoami/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";

function req(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(url, init as any);
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  mocks.verifyPinFromPB.mockReset();
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
    expect((await res.json()).member.pin).toBeUndefined();
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

describe("GET /api/auth/whoami", () => {
  it("returns the member from a valid session cookie", async () => {
    const { signSession } = await import("@/lib/session");
    const token = await signSession({ memberId: "m1", name: "Rebecca", role: "parent" });
    mocks.findMemberByName.mockResolvedValue({ id: "m1", name: "Rebecca", role: "parent", pin: "9999" });
    const res = await whoamiGET(req("http://x/api/auth/whoami", { headers: { cookie: `consuela_session=${token}` } }));
    expect(res.status).toBe(200);
    expect((await res.json()).member.name).toBe("Rebecca");
  });

  it("returns 401 without a cookie", async () => {
    expect((await whoamiGET(req("http://x/api/auth/whoami"))).status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the cookie", async () => {
    const res = await logoutPOST(req("http://x/api/auth/logout", { method: "POST" }));
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
