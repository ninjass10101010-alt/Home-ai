import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import { requireLiveSession } from "@/lib/server-auth";
import { SESSION_TTL_SECONDS_BY_ROLE, isSessionRole, sessionTtlSeconds } from "@/lib/session-policy";
import { SESSION_COOKIE, signSession } from "@/lib/session";

function requestWithToken(token: string): Request {
  return new Request("http://localhost/api/db/members", {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
}

function pbWithRow(row: Record<string, unknown>) {
  return {
    collection: () => ({
      getOne: async () => row,
    }),
  };
}

function pbThatThrows(error: unknown) {
  return {
    collection: () => ({
      getOne: async () => {
        throw error;
      },
    }),
  };
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requireLiveSession", () => {
  it("returns only sanitized live identity", async () => {
    mocks.withAdmin.mockImplementation((fn) =>
      fn({
        collection: () => ({
          getOne: async () => ({
            id: "m1",
            name: "Parent Current",
            role: "parent",
            pin: "credential-must-not-leak",
            phone: "private-contact-data",
          }),
        }),
      }),
    );

    const result = await requireLiveSession(
      requestWithToken(
        await signSession({
          memberId: "m1",
          name: "Parent Previous",
          role: "parent",
        }),
      ),
    );

    expect(result).toEqual({
      ok: true,
      identity: {
        memberId: "m1",
        name: "Parent Current",
        role: "parent",
      },
    });
  });

  it("returns the sanitized member only when withMember is asked for", async () => {
    mocks.withAdmin.mockImplementation((fn) =>
      fn({
        collection: () => ({
          getOne: async () => ({
            id: "m1",
            name: "Parent Current",
            role: "parent",
            pin: "credential-must-not-leak",
            phone: "private-contact-data",
          }),
        }),
      }),
    );
    const request = requestWithToken(
      await signSession({ memberId: "m1", name: "Parent Previous", role: "parent" }),
    );

    // Default: minimal identity, no private contact fields.
    expect(await requireLiveSession(request)).not.toHaveProperty("member");

    // Opt-in: the row, sanitized — the PIN is still stripped.
    const withMember = await requireLiveSession(request, { withMember: true });
    expect(withMember).toMatchObject({
      ok: true,
      identity: { memberId: "m1", name: "Parent Current", role: "parent" },
      member: { id: "m1", pbId: "m1", name: "Parent Current", role: "parent" },
    });
    const member = (withMember as { member?: Record<string, unknown> }).member!;
    expect(member.pin).toBeUndefined();
  });

  it("returns 401 when no session cookie is present", async () => {
    const result = await requireLiveSession(
      new Request("http://localhost/api/db/members"),
    );

    expect(result).toEqual({ ok: false, status: 401, error: "unauthorized" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("returns 401 when the session cookie is expired", async () => {
    const token = await signSession(
      { memberId: "m1", name: "Parent", role: "parent" },
      -60,
    );

    const result = await requireLiveSession(requestWithToken(token));

    expect(result).toEqual({ ok: false, status: 401, error: "unauthorized" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("returns 401 when PocketBase no longer has the member", async () => {
    mocks.withAdmin.mockImplementation((fn) =>
      fn(pbThatThrows({ status: 404 })),
    );

    const result = await requireLiveSession(
      requestWithToken(
        await signSession({ memberId: "gone", name: "Gone", role: "parent" }),
      ),
    );

    expect(result).toEqual({ ok: false, status: 401, error: "unauthorized" });
  });

  it("returns 503 identity_unavailable when the live lookup throws", async () => {
    mocks.withAdmin.mockImplementation((fn) =>
      fn(pbThatThrows(new Error("private database failure"))),
    );

    const result = await requireLiveSession(
      requestWithToken(
        await signSession({ memberId: "m1", name: "Parent", role: "parent" }),
      ),
    );

    expect(result).toEqual({
      ok: false,
      status: 503,
      error: "identity_unavailable",
    });
  });

  it("returns 403 session_role_changed for a role outside the session vocabulary", async () => {
    mocks.withAdmin.mockImplementation((fn) =>
      fn(pbWithRow({ id: "m1", name: "Parent", role: "grandparent" })),
    );

    const result = await requireLiveSession(
      requestWithToken(
        await signSession({ memberId: "m1", name: "Parent", role: "parent" }),
      ),
    );

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: "session_role_changed",
    });
  });

  it("returns 403 session_role_changed when the live role drifted from the signed role", async () => {
    mocks.withAdmin.mockImplementation((fn) =>
      fn(pbWithRow({ id: "m1", name: "Demoted", role: "child" })),
    );

    const result = await requireLiveSession(
      requestWithToken(
        await signSession({ memberId: "m1", name: "Adult", role: "parent" }),
      ),
    );

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: "session_role_changed",
    });
  });

  it("returns 403 adult_only when requireRole parent is asked of a live child", async () => {
    mocks.withAdmin.mockImplementation((fn) =>
      fn(pbWithRow({ id: "m-kid", name: "Kid", role: "child" })),
    );

    const result = await requireLiveSession(
      requestWithToken(
        await signSession({ memberId: "m-kid", name: "Kid", role: "child" }),
      ),
      { requireRole: "parent" },
    );

    expect(result).toEqual({ ok: false, status: 403, error: "adult_only" });
  });

  it("returns the live identity for a child session with no role requirement", async () => {
    mocks.withAdmin.mockImplementation((fn) =>
      fn(
        pbWithRow({
          id: "m-kid",
          name: "Kid Live",
          role: "child",
          pin: "credential-must-not-leak",
        }),
      ),
    );

    const result = await requireLiveSession(
      requestWithToken(
        await signSession({ memberId: "m-kid", name: "Kid Signed", role: "child" }),
      ),
    );

    expect(result).toEqual({
      ok: true,
      identity: { memberId: "m-kid", name: "Kid Live", role: "child" },
    });
  });
});

describe("session policy vocabulary", () => {
  it("accepts only the three family session roles", () => {
    expect(isSessionRole("parent")).toBe(true);
    expect(isSessionRole("child")).toBe(true);
    expect(isSessionRole("pet")).toBe(true);
    expect(isSessionRole("grandparent")).toBe(false);
    expect(isSessionRole(undefined)).toBe(false);
  });

  it("keeps the per-role session TTLs", () => {
    expect(SESSION_TTL_SECONDS_BY_ROLE).toEqual({
      parent: 1800,
      child: 900,
      pet: 900,
    });
    expect(sessionTtlSeconds("parent")).toBe(1800);
    expect(sessionTtlSeconds("child")).toBe(900);
    expect(sessionTtlSeconds("pet")).toBe(900);
  });
});
