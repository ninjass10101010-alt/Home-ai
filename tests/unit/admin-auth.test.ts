import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SessionRole } from "@/lib/session-policy";

// Credential order is exact: server bearer -> live parent session -> a present
// session's failure -> parent x-admin-pin. The bearer and PIN paths must never
// revalidate a session against PocketBase, and a present-but-failed session
// must not fall through to the PIN branch.
const mocks = vi.hoisted(() => ({
  verifyPinAgainstAnyMember: vi.fn(),
  requireLiveSession: vi.fn(),
}));

vi.mock("@/lib/server-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server-auth")>();
  return {
    ...actual,
    verifyPinAgainstAnyMember: mocks.verifyPinAgainstAnyMember,
    requireLiveSession: mocks.requireLiveSession,
  };
});

import { authorizeAdminRequest } from "@/lib/admin-auth";

const PARENT = { ok: true, identity: { memberId: "m1", name: "R", role: "parent" } };

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/admin/x", { headers });
}

async function sessionCookie(role: SessionRole): Promise<string> {
  const { signSession, SESSION_COOKIE } = await import("../../src/lib/session");
  const token = await signSession({ memberId: `m-${role}`, name: `N-${role}`, role });
  return `${SESSION_COOKIE}=${token}`;
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("authorizeAdminRequest", () => {
  it("accepts a parent/adult member PIN via x-admin-pin", async () => {
    vi.stubEnv("ADMIN_SECRET", "");
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m1", name: "Rebecca", role: "parent" });

    const result = await authorizeAdminRequest(req({ "x-admin-pin": "1234" }));

    expect(result.ok).toBe(true);
    expect(mocks.verifyPinAgainstAnyMember).toHaveBeenCalledWith("1234");
    expect(mocks.requireLiveSession).not.toHaveBeenCalled();
  });

  it("rejects a child member's PIN even when correct", async () => {
    vi.stubEnv("ADMIN_SECRET", "");
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m2", name: "Kid", role: "child" });

    const result = await authorizeAdminRequest(req({ "x-admin-pin": "5678" }));

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toBe("adult_only");
  });

  it("accepts the exact ADMIN_SECRET bearer for trusted internal callers", async () => {
    vi.stubEnv("ADMIN_SECRET", "internal-s3cret");

    const result = await authorizeAdminRequest(req({ authorization: "Bearer internal-s3cret" }));

    expect(result.ok).toBe(true);
    expect(mocks.verifyPinAgainstAnyMember).not.toHaveBeenCalled();
    expect(mocks.requireLiveSession).not.toHaveBeenCalled();
  });

  it("accepts a valid adult session cookie", async () => {
    const { SESSION_COOKIE } = await import("../../src/lib/session");
    vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
    const cookie = await sessionCookie("parent");
    mocks.requireLiveSession.mockResolvedValue(PARENT);

    const request = req({ cookie });
    const result = await authorizeAdminRequest(request);

    expect(result.ok).toBe(true);
    expect(mocks.requireLiveSession).toHaveBeenCalledWith(request, {
      requireRole: "parent",
    });
    expect(SESSION_COOKIE).toBe("consuela_session");
  });

  it("rejects a child session cookie with 403", async () => {
    vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
    mocks.requireLiveSession.mockResolvedValue({
      ok: false,
      status: 403,
      error: "adult_only",
    });

    const result = await authorizeAdminRequest(req({ cookie: await sessionCookie("child") }));

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toBe("adult_only");
  });

  it("does not fall through to the PIN branch when a present session fails", async () => {
    vi.stubEnv("ADMIN_SECRET", "");
    vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
    mocks.requireLiveSession.mockResolvedValue({
      ok: false,
      status: 403,
      error: "session_role_changed",
    });
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m1", name: "Rebecca", role: "parent" });

    const result = await authorizeAdminRequest(
      req({ cookie: await sessionCookie("parent"), "x-admin-pin": "1234" }),
    );

    expect(result).toEqual({ ok: false, status: 403, error: "session_role_changed" });
    expect(mocks.verifyPinAgainstAnyMember).not.toHaveBeenCalled();
  });

  it("propagates an unavailable live identity as 503", async () => {
    vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
    mocks.requireLiveSession.mockResolvedValue({
      ok: false,
      status: 503,
      error: "identity_unavailable",
    });

    const result = await authorizeAdminRequest(req({ cookie: await sessionCookie("parent") }));

    expect(result).toEqual({ ok: false, status: 503, error: "identity_unavailable" });
  });

  it("fails closed when neither credential is present or valid", async () => {
    vi.stubEnv("ADMIN_SECRET", "");
    mocks.verifyPinAgainstAnyMember.mockResolvedValue(null);
    expect((await authorizeAdminRequest(req())).ok).toBe(false);

    // Wrong bearer with unset secret must NOT pass (no "Bearer undefined")
    vi.stubEnv("ADMIN_SECRET", "");
    expect((await authorizeAdminRequest(req({ authorization: "Bearer undefined" }))).ok).toBe(false);

    // Wrong bearer while a secret IS set
    vi.stubEnv("ADMIN_SECRET", "real");
    expect((await authorizeAdminRequest(req({ authorization: "Bearer wrong" }))).ok).toBe(false);

    // Invalid pin while a secret IS set falls through to 401
    vi.stubEnv("ADMIN_SECRET", "real");
    mocks.verifyPinAgainstAnyMember.mockResolvedValue(null);
    const badPin = await authorizeAdminRequest(req({ "x-admin-pin": "9999" }));
    expect(badPin.ok).toBe(false);
    expect(badPin.status).toBe(401);
  });
});
