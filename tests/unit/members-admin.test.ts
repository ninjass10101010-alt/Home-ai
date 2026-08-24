import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  findMemberByName: vi.fn(),
  listMembersSanitized: vi.fn(),
  createMemberRecord: vi.fn(),
  verifySession: vi.fn(),
  authorizeAdminRequest: vi.fn(),
}));

function fakePB(overrides: {
  members?: any[];
  onCreate?: (args: any) => any;
}) {
  return {
    collection: () => ({
      getFullList: async () => overrides.members ?? [],
      create: async (args: any) => overrides.onCreate?.(args),
    }),
  };
}

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/server-auth", () => ({
  findMemberByName: mocks.findMemberByName,
  listMembersSanitized: mocks.listMembersSanitized,
  createMemberRecord: mocks.createMemberRecord,
  sanitizeMember: (m: any) => {
    const { pin, ...rest } = m;
    return rest;
  },
}));

vi.mock("@/lib/session", () => ({
  SESSION_COOKIE: "consuela_session",
  verifySession: mocks.verifySession,
}));

vi.mock("@/lib/admin-auth", () => ({
  authorizeAdminRequest: mocks.authorizeAdminRequest,
}));

import { GET, PATCH, POST, DELETE } from "@/app/api/members/admin/route";

function req(init?: { method?: string; body?: unknown; cookie?: string }): NextRequest {
  return new NextRequest("http://localhost/api/members/admin", {
    method: init?.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(init?.cookie ? { cookie: `consuela_session=${init.cookie}` } : {}),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const ADULT = { ok: true };
const CHILD = { ok: false, status: 403, error: "adult_only" };

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

describe("GET /api/members/admin", () => {
  it("returns 401 without a valid session", async () => {
    mocks.verifySession.mockResolvedValue(null);

    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(mocks.listMembersSanitized).not.toHaveBeenCalled();
  });

  it("returns the sanitized member list for any valid session", async () => {
    mocks.verifySession.mockResolvedValue({ memberId: "m3", name: "Emily", role: "child" });
    mocks.listMembersSanitized.mockResolvedValue([
      { id: "m1", name: "Rebecca", role: "parent" },
      { id: "m3", name: "Emily", role: "child" },
    ]);

    const res = await GET(req({ cookie: "token" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toHaveLength(2);
    expect(body.members[0].pin).toBeUndefined();
  });
});

describe("PATCH /api/members/admin", () => {
  it("updates by found id and returns the sanitized row for an adult session", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue(ADULT);
    mocks.findMemberByName.mockResolvedValue({ id: "pb-row-1", name: "Rebecca", role: "parent", emoji: "🐱", pin: "9999" });
    let written: any = null;
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) =>
      fn({
        collection: () => ({
          update: async (_id: string, patch: any) => {
            written = patch;
            return { ...patch, id: _id };
          },
        }),
      })
    );

    const res = await PATCH(req({ method: "PATCH", body: { name: "Rebecca", patch: { emoji: "🦊" } } }));

    expect(res.status).toBe(200);
    expect(written).toEqual({ emoji: "🦊" });
    expect(mocks.findMemberByName).toHaveBeenCalledWith("Rebecca");
    const body = await res.json();
    expect(body.member.emoji).toBe("🦊");
    expect(body.member.pin).toBeUndefined();
  });

  it("rejects a child session with 403 before touching data", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue(CHILD);

    const res = await PATCH(req({ method: "PATCH", body: { name: "Emily", patch: { role: "parent" } } }));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "adult_only" });
    expect(mocks.findMemberByName).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown member", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue(ADULT);
    mocks.findMemberByName.mockResolvedValue(null);

    const res = await PATCH(req({ method: "PATCH", body: { name: "Nobody", patch: { emoji: "👻" } } }));

    expect(res.status).toBe(404);
  });

  it("returns 400 when name or patch are missing", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue(ADULT);
    expect((await PATCH(req({ method: "PATCH", body: { patch: {} } }))).status).toBe(400);
    expect((await PATCH(req({ method: "PATCH", body: { name: "Rebecca" } }))).status).toBe(400);
  });
});

describe("DELETE /api/members/admin", () => {
  function pbWithDelete(deleted: { id: string }[]) {
    return {
      collection: () => ({
        delete: async (id: string) => {
          deleted.push({ id });
          return true;
        },
      }),
    };
  }

  it("blocks deleting the last parent-role member with last_parent", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue(ADULT);
    mocks.findMemberByName.mockResolvedValue({ id: "pb-row-1", name: "Rebecca", role: "parent" });
    mocks.listMembersSanitized.mockResolvedValue([
      { id: "m1", name: "Rebecca", role: "parent" },
      { id: "m3", name: "Emily", role: "child" },
    ]);

    const res = await DELETE(req({ method: "DELETE", body: { name: "Rebecca" } }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "last_parent" });
  });

  it("deletes a member when another parent remains", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue(ADULT);
    mocks.findMemberByName.mockResolvedValue({ id: "pb-row-2", name: "Jeffery", role: "parent" });
    mocks.listMembersSanitized.mockResolvedValue([
      { id: "m1", name: "Rebecca", role: "parent" },
      { id: "m2", name: "Jeffery", role: "parent" },
    ]);
    const deleted: { id: string }[] = [];
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pbWithDelete(deleted)));

    const res = await DELETE(req({ method: "DELETE", body: { name: "Jeffery" } }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
    expect(deleted).toEqual([{ id: "pb-row-2" }]);
  });

  it("deletes a child freely regardless of parent count", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue(ADULT);
    mocks.findMemberByName.mockResolvedValue({ id: "pb-row-3", name: "Emily", role: "child" });
    mocks.listMembersSanitized.mockResolvedValue([
      { id: "m1", name: "Rebecca", role: "parent" },
      { id: "m3", name: "Emily", role: "child" },
    ]);
    const deleted: { id: string }[] = [];
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pbWithDelete(deleted)));

    const res = await DELETE(req({ method: "DELETE", body: { name: "Emily" } }));

    expect(res.status).toBe(200);
    expect(deleted).toEqual([{ id: "pb-row-3" }]);
  });

  it("rejects a child session with 403 and returns 404 for unknown members", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue(CHILD);
    expect((await DELETE(req({ method: "DELETE", body: { name: "Emily" } }))).status).toBe(403);

    mocks.authorizeAdminRequest.mockResolvedValue(ADULT);
    mocks.findMemberByName.mockResolvedValue(null);
    expect((await DELETE(req({ method: "DELETE", body: { name: "Nobody" } }))).status).toBe(404);
  });
});

describe("POST /api/members/admin (route)", () => {
  it("creates a member for an adult session and returns the sanitized row", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue(ADULT);
    mocks.createMemberRecord.mockResolvedValue({
      id: "pb-row-new",
      name: "Nova Garcia",
      role: "child",
      emoji: "🦄",
      pin: "1234",
    });

    const res = await POST(
      req({ method: "POST", body: { name: "Nova Garcia", role: "child", emoji: "🦄" } })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.member).toMatchObject({ id: "pb-row-new", name: "Nova Garcia" });
    expect(body.member.pin).toBeUndefined();
    expect(mocks.createMemberRecord).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Nova Garcia" })
    );
  });

  it("rejects a child session with 403 before touching data", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue(CHILD);

    const res = await POST(req({ method: "POST", body: { name: "Sneaky Kid", role: "parent" } }));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "adult_only" });
    expect(mocks.createMemberRecord).not.toHaveBeenCalled();
  });

  it("returns 409 duplicate when a matching member already exists", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue(ADULT);
    mocks.createMemberRecord.mockResolvedValue(null);

    const res = await POST(req({ method: "POST", body: { name: "Rebecca" } }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "duplicate" });
  });

  it("returns 400 when name is missing", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue(ADULT);

    const res = await POST(req({ method: "POST", body: { role: "child" } }));

    expect(res.status).toBe(400);
    expect(mocks.createMemberRecord).not.toHaveBeenCalled();
  });
});

describe("createMemberRecord (real server-auth helper)", () => {
  async function realHelper() {
    const actual = await vi.importActual<typeof import("@/lib/server-auth")>("@/lib/server-auth");
    return actual.createMemberRecord;
  }

  it("ignores a client-supplied pin and stores the seed-side default so the member can log in", async () => {
    const createMemberRecord = await realHelper();
    let created: any = null;
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) =>
      fn(fakePB({ members: [], onCreate: (args) => ((created = args), { ...args, id: "new-1" }) }))
    );

    const row = await createMemberRecord({ name: "Rebecca", role: "parent", emoji: "🦊", pin: "9999" });

    expect(row).toMatchObject({ id: "new-1", name: "Rebecca", role: "parent", emoji: "🦊" });
    // The client's pin never wins; the server-side resolved default does.
    expect(created.pin).toBe("0202");
    expect(JSON.stringify(created)).not.toContain("9999");
  });

  it("returns null without creating when an existing PB record matches the name", async () => {
    const createMemberRecord = await realHelper();
    let created: any = null;
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) =>
      fn(fakePB({
        members: [{ id: "r1", name: "Rebecca Garcia", role: "parent" }],
        onCreate: (args) => ((created = args), args),
      }))
    );

    const row = await createMemberRecord({ name: "Rebecca" });

    expect(row).toBeNull();
    expect(created).toBeNull();
  });
});
