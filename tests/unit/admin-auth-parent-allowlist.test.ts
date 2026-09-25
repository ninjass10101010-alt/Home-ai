import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// F7 — admin-auth was a DENYLIST (`role === "child"`), so a `pet` session (or
// a pet's PIN) slipped through while every other adult gate in the app uses a
// parent ALLOWLIST. This pins the parent-only contract for both the session
// branch and the x-admin-pin branch.
const mocks = vi.hoisted(() => ({
  verifyPinAgainstAnyMember: vi.fn(),
  authorizeCurrentParentRequest: vi.fn(),
}));

vi.mock("../../src/lib/server-auth", () => ({
  verifyPinAgainstAnyMember: mocks.verifyPinAgainstAnyMember,
  authorizeCurrentParentRequest: mocks.authorizeCurrentParentRequest,
}));

import { authorizeAdminRequest } from "../../src/lib/admin-auth";

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/admin/x", { headers });
}

async function sessionCookie(role: string): Promise<string> {
  const { signSession, SESSION_COOKIE } = await import("../../src/lib/session");
  const token = await signSession({ memberId: `m-${role}`, name: `N-${role}`, role });
  return `${SESSION_COOKIE}=${token}`;
}

beforeEach(() => {
  mocks.verifyPinAgainstAnyMember.mockReset();
  mocks.authorizeCurrentParentRequest.mockReset().mockResolvedValue({ ok: true });
  vi.stubEnv("ADMIN_SECRET", "");
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("authorizeAdminRequest — parent allowlist (F7)", () => {
  describe("session cookie branch", () => {
    it("accepts a parent session", async () => {
      const result = await authorizeAdminRequest(req({ cookie: await sessionCookie("parent") }));
      expect(result.ok).toBe(true);
    });

    it("rejects a child session with 403 adult_only", async () => {
      mocks.authorizeCurrentParentRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
      const result = await authorizeAdminRequest(req({ cookie: await sessionCookie("child") }));
      expect(result).toMatchObject({ ok: false, status: 403, error: "adult_only" });
    });

    it("rejects a pet session with 403 adult_only", async () => {
      mocks.authorizeCurrentParentRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
      const result = await authorizeAdminRequest(req({ cookie: await sessionCookie("pet") }));
      expect(result).toMatchObject({ ok: false, status: 403, error: "adult_only" });
    });
  });

  describe("x-admin-pin branch", () => {
    it("accepts a valid parent PIN", async () => {
      mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m1", name: "Rebecca", role: "parent" });
      const result = await authorizeAdminRequest(req({ "x-admin-pin": "1234" }));
      expect(result.ok).toBe(true);
    });

    it("rejects a child's valid PIN with 403 adult_only", async () => {
      mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m2", name: "Kid", role: "child" });
      const result = await authorizeAdminRequest(req({ "x-admin-pin": "5678" }));
      expect(result).toMatchObject({ ok: false, status: 403, error: "adult_only" });
    });

    it("rejects a pet's valid PIN with 403 adult_only", async () => {
      mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "p1", name: "Rocco", role: "pet" });
      const result = await authorizeAdminRequest(req({ "x-admin-pin": "0000" }));
      expect(result).toMatchObject({ ok: false, status: 403, error: "adult_only" });
    });
  });

  it("fails closed with 401 when no credentials are present", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue(null);
    const result = await authorizeAdminRequest(req());
    expect(result).toMatchObject({ ok: false, status: 401, error: "unauthorized" });
  });
});
