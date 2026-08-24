import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyPinAgainstAnyMember: vi.fn(),
}));

vi.mock("../../src/lib/server-auth", () => ({
  verifyPinAgainstAnyMember: mocks.verifyPinAgainstAnyMember,
}));

import { authorizeAdminRequest } from "../../src/lib/admin-auth";

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/admin/x", { headers });
}

beforeEach(() => {
  mocks.verifyPinAgainstAnyMember.mockReset();
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
  });

  it("accepts a valid adult session cookie", async () => {
    const { signSession, SESSION_COOKIE } = await import("../../src/lib/session");
    vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
    const token = await signSession({ memberId: "m1", name: "R", role: "parent" });
    const result = await authorizeAdminRequest(req({ cookie: `${SESSION_COOKIE}=${token}` }));
    expect(result.ok).toBe(true);
  });

  it("rejects a child session cookie with 403", async () => {
    const { signSession, SESSION_COOKIE } = await import("../../src/lib/session");
    vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
    const token = await signSession({ memberId: "m2", name: "Kid", role: "child" });
    const result = await authorizeAdminRequest(req({ cookie: `${SESSION_COOKIE}=${token}` }));
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
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
