import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// F7 — admin-auth was a DENYLIST (`role === "child"`), so a `pet` session (or
// a pet's PIN) slipped through while every other adult gate in the app uses a
// parent ALLOWLIST. This pins the parent-only contract for both the session
// branch and the x-admin-pin branch. The session branch now revalidates against
// a live PocketBase row, so the signed role alone can never authorize.
const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifyPinAgainstAnyMember: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/server-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server-auth")>();
  return { ...actual, verifyPinAgainstAnyMember: mocks.verifyPinAgainstAnyMember };
});

import { authorizeAdminRequest } from "@/lib/admin-auth";

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/admin/x", { headers });
}

async function sessionCookie(role: string): Promise<string> {
  const { signSession, SESSION_COOKIE } = await import("@/lib/session");
  const token = await signSession({ memberId: `m-${role}`, name: `N-${role}`, role });
  return `${SESSION_COOKIE}=${token}`;
}

function liveRow(role: string): Record<string, unknown> {
  return { id: `m-${role}`, name: `N-${role}`, role, pin: "1234" };
}

function serveLiveRow(row: Record<string, unknown>) {
  mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) =>
    fn({
      collection: () => ({
        getOne: async () => row,
      }),
    }),
  );
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  vi.stubEnv("ADMIN_SECRET", "");
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("authorizeAdminRequest — parent allowlist (F7)", () => {
  describe("live session cookie branch", () => {
    it("accepts a parent session whose live role is parent", async () => {
      serveLiveRow(liveRow("parent"));
      const result = await authorizeAdminRequest(req({ cookie: await sessionCookie("parent") }));
      expect(result.ok).toBe(true);
      expect(mocks.verifyPinAgainstAnyMember).not.toHaveBeenCalled();
    });

    it("rejects a child session with 403 adult_only", async () => {
      serveLiveRow(liveRow("child"));
      const result = await authorizeAdminRequest(req({ cookie: await sessionCookie("child") }));
      expect(result).toMatchObject({ ok: false, status: 403, error: "adult_only" });
    });

    it("rejects a pet session with 403 adult_only", async () => {
      serveLiveRow(liveRow("pet"));
      const result = await authorizeAdminRequest(req({ cookie: await sessionCookie("pet") }));
      expect(result).toMatchObject({ ok: false, status: 403, error: "adult_only" });
    });

    it("rejects a signed parent whose live role drifted to child", async () => {
      serveLiveRow({ ...liveRow("parent"), role: "child" });
      const result = await authorizeAdminRequest(req({ cookie: await sessionCookie("parent") }));
      expect(result).toMatchObject({
        ok: false,
        status: 403,
        error: "session_role_changed",
      });
    });

    it("rejects a session whose member no longer exists in PocketBase", async () => {
      mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) =>
        fn({
          collection: () => ({
            getOne: async () => {
              throw { status: 404 };
            },
          }),
        }),
      );
      const result = await authorizeAdminRequest(req({ cookie: await sessionCookie("parent") }));
      expect(result).toMatchObject({ ok: false, status: 401, error: "unauthorized" });
    });
  });

  describe("x-admin-pin branch", () => {
    it("accepts a valid parent PIN", async () => {
      mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m1", name: "Rebecca", role: "parent" });
      const result = await authorizeAdminRequest(req({ "x-admin-pin": "1234" }));
      expect(result.ok).toBe(true);
      expect(mocks.withAdmin).not.toHaveBeenCalled();
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
