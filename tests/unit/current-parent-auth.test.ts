import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifySession: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/session", () => ({
  SESSION_COOKIE: "consuela_session",
  verifySession: mocks.verifySession,
}));

import { authorizeCurrentMemberRequest, authorizeCurrentParentRequest } from "@/lib/server-auth";

function request(cookie = "consuela_session=token") {
  return new Request("http://localhost/api/admin/version", { headers: { cookie } });
}

function pbWithMember(member: Record<string, unknown> | null) {
  return {
    collection: vi.fn(() => ({
      getOne: vi.fn(async () => {
        if (!member) throw Object.assign(new Error("missing"), { status: 404 });
        return member;
      }),
    })),
  };
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.verifySession.mockReset().mockResolvedValue({ memberId: "m1", name: "Stale", role: "parent" });
});

describe("authorizeCurrentMemberRequest", () => {
  it("returns the current live role and sanitized row for a child", async () => {
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(pbWithMember({
      id: "m1",
      name: "Current Child",
      role: "child",
      pin: "1234",
    })));

    const result = await authorizeCurrentMemberRequest(request());

    expect(result).toMatchObject({ ok: true, member: { id: "m1", role: "child" } });
    expect(result.member).not.toHaveProperty("pin");
  });
});

describe("authorizeCurrentParentRequest", () => {
  it("uses the current PB row rather than the signed role or fallback roster", async () => {
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(pbWithMember({
      id: "m1",
      name: "Current Name",
      role: "parent",
      pin: "1234",
    })));

    const result = await authorizeCurrentParentRequest(request());

    expect(result).toMatchObject({ ok: true, member: { id: "m1", name: "Current Name", role: "parent" } });
    expect(result.member).not.toHaveProperty("pin");
  });

  it("rejects a current child even when the signed session says parent", async () => {
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(pbWithMember({
      id: "m1",
      name: "Current Child",
      role: "child",
    })));

    const result = await authorizeCurrentParentRequest(request());

    expect(result).toMatchObject({ ok: false, status: 403, error: "adult_only" });
  });

  it("rejects a deleted current member", async () => {
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(pbWithMember(null)));

    const result = await authorizeCurrentParentRequest(request());

    expect(result).toMatchObject({ ok: false, status: 401, error: "unauthorized" });
  });

  it("fails closed with 503 when PocketBase cannot re-read identity", async () => {
    mocks.withAdmin.mockRejectedValue(new Error("PB unavailable"));

    const result = await authorizeCurrentParentRequest(request());

    expect(result).toMatchObject({ ok: false, status: 503, error: "identity_unavailable" });
  });
});
