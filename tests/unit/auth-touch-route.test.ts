import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  failure: null as unknown,
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) =>
    fn({
      collection: () => ({
        getOne: async (id: string) => {
          if (mocks.failure) throw mocks.failure;
          if (!mocks.row || String(mocks.row.id) !== String(id)) {
            throw { status: 404 };
          }
          return mocks.row;
        },
      }),
    }),
}));

import { POST } from "@/app/api/auth/touch/route";
import { SESSION_COOKIE, signSession, verifySession } from "@/lib/session";

function touchRequest(token?: string, init?: RequestInit): NextRequest {
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) || {}) };
  if (token) headers.cookie = `${SESSION_COOKIE}=${token}`;
  return new NextRequest("http://x/api/auth/touch", { ...(init as any), headers });
}

function setCookieHeader(res: Response): string | null {
  return res.headers.get("set-cookie");
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  mocks.row = { id: "m1", name: "Parent Current", role: "parent", pin: "credential-must-not-leak" };
  mocks.failure = null;
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/auth/touch", () => {
  it("rotates a parent session with a 1800 second cookie and the live identity", async () => {
    const token = await signSession({ memberId: "m1", name: "Parent Previous", role: "parent" });

    const res = await POST(touchRequest(token, { method: "POST" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      member: { memberId: "m1", name: "Parent Current", role: "parent" },
      expiresIn: 1800,
    });
    const setCookie = setCookieHeader(res)!;
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain("Max-Age=1800");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect(setCookie).toContain("Path=/");
  });

  it("rotates a child session with a 900 second cookie", async () => {
    mocks.row = { id: "m-kid", name: "Kid Live", role: "child" };
    const token = await signSession({ memberId: "m-kid", name: "Kid Signed", role: "child" });

    const res = await POST(touchRequest(token, { method: "POST" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      member: { memberId: "m-kid", name: "Kid Live", role: "child" },
      expiresIn: 900,
    });
    expect(setCookieHeader(res)).toContain("Max-Age=900");
  });

  it("rotates a pet session with a 900 second cookie", async () => {
    mocks.row = { id: "m-pet", name: "Pet Live", role: "pet" };
    const token = await signSession({ memberId: "m-pet", name: "Pet Signed", role: "pet" });

    const res = await POST(touchRequest(token, { method: "POST" }));

    expect(res.status).toBe(200);
    expect((await res.json()).expiresIn).toBe(900);
    expect(setCookieHeader(res)).toContain("Max-Age=900");
  });

  it("issues a brand-new token carrying the live identity, not the old cookie", async () => {
    const token = await signSession({ memberId: "m1", name: "Parent Previous", role: "parent" });

    const res = await POST(touchRequest(token, { method: "POST" }));

    const rotated = res.cookies.get(SESSION_COOKIE)?.value;
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(token);
    expect(await verifySession(rotated)).toMatchObject({
      memberId: "m1",
      name: "Parent Current",
      role: "parent",
    });
  });

  it("returns the live identity and never reads the request body", async () => {
    mocks.row = { id: "m-kid", name: "Kid Live", role: "child" };
    const token = await signSession({ memberId: "m-kid", name: "Kid Signed", role: "child" });
    const request = touchRequest(token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberId: "m1", name: "Parent Forged", role: "parent" }),
    });

    const res = await POST(request);

    expect(res.status).toBe(200);
    expect((await res.json()).member).toEqual({
      memberId: "m-kid",
      name: "Kid Live",
      role: "child",
    });
    expect(request.bodyUsed).toBe(false);
  });

  it("returns 401 and sets NO cookie without a session cookie", async () => {
    const res = await POST(touchRequest(undefined, { method: "POST" }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(setCookieHeader(res)).toBeNull();
  });

  it("returns 401 and sets NO cookie for an expired session", async () => {
    const token = await signSession({ memberId: "m1", name: "Parent", role: "parent" }, -60);

    const res = await POST(touchRequest(token, { method: "POST" }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(setCookieHeader(res)).toBeNull();
  });

  it("returns 401 and sets NO cookie when the live member row is gone", async () => {
    const token = await signSession({ memberId: "gone", name: "Gone", role: "parent" });

    const res = await POST(touchRequest(token, { method: "POST" }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(setCookieHeader(res)).toBeNull();
  });

  it("returns 403 and sets NO cookie when the live role drifted from the signed role", async () => {
    mocks.row = { id: "m1", name: "Demoted", role: "child" };
    const token = await signSession({ memberId: "m1", name: "Adult", role: "parent" });

    const res = await POST(touchRequest(token, { method: "POST" }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "session_role_changed" });
    expect(setCookieHeader(res)).toBeNull();
  });

  it("returns 503 and sets NO cookie when the live lookup fails", async () => {
    mocks.failure = new Error("private database failure");
    const token = await signSession({ memberId: "m1", name: "Parent", role: "parent" });

    const res = await POST(touchRequest(token, { method: "POST" }));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "identity_unavailable" });
    expect(setCookieHeader(res)).toBeNull();
  });
});
