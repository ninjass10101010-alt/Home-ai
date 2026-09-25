import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const randomInt = vi.hoisted(() => vi.fn(() => 1234));

vi.mock("node:crypto", () => ({ randomInt }));

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  findMemberByName: vi.fn(),
  findLiveMemberByName: vi.fn(),
  findLiveMemberByExactName: vi.fn(),
  findLiveMemberById: vi.fn(),
  listMembersSanitized: vi.fn(),
  listLiveMembersSanitized: vi.fn(),
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
  findMemberByName: mocks.findLiveMemberByName,
  findLiveMemberByName: mocks.findLiveMemberByName,
  findLiveMemberByExactName: mocks.findLiveMemberByExactName,
  findLiveMemberById: mocks.findLiveMemberById,
  listMembersSanitized: mocks.listMembersSanitized,
  listLiveMembersSanitized: mocks.listLiveMembersSanitized,
  createMemberRecord: mocks.createMemberRecord,
  withMemberAdminOperation: (fn: () => Promise<unknown>) => fn(),
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

function req(init?: { method?: string; body?: unknown; cookie?: string; query?: string }): NextRequest {
  return new NextRequest(`http://localhost/api/members/admin${init?.query ?? ""}`, {
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
  randomInt.mockReset().mockReturnValue(1234);
  mocks.findLiveMemberByExactName.mockImplementation((name: string) => mocks.findLiveMemberByName(name));
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
  it("returns an explicitly labeled live roster without fallback merging", async () => {
    mocks.verifySession.mockResolvedValue({ memberId: "m3", name: "Emily", role: "child" });
    mocks.listLiveMembersSanitized.mockResolvedValue([{ id: "live-1", name: "Live Parent", role: "parent" }]);

    const res = await GET(req({ cookie: "token", query: "?source=live" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ source: "live", members: [{ id: "live-1", name: "Live Parent" }] });
    expect(mocks.listLiveMembersSanitized).toHaveBeenCalledTimes(1);
    expect(mocks.listMembersSanitized).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/members/admin", () => {
  it("updates by found id and returns the sanitized row for an adult session", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue(ADULT);
    mocks.findLiveMemberByName.mockResolvedValue({ id: "pb-row-1", name: "Rebecca", role: "parent", emoji: "🐱", pin: "9999" });
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
    expect(mocks.findLiveMemberByName).toHaveBeenCalledWith("Rebecca");
    const body = await res.json();
    expect(body.member.emoji).toBe("🦊");
    expect(body.member.pin).toBeUndefined();
  });

  it.each([
    ["null", null],
    ["numeric", 42],
    ["empty", ""],
    ["unknown", "admin"],
  ])("rejects an invalid %s role before mutation or final-parent protection", async (_label, role) => {
    mocks.authorizeAdminRequest.mockResolvedValue(ADULT);
    mocks.findLiveMemberByName.mockResolvedValue({ id: "live-parent", name: "Rebecca", role: "parent" });

    const res = await PATCH(req({ method: "PATCH", body: { name: "Rebecca", patch: { role } } }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_role" });
    expect(mocks.findLiveMemberByName).not.toHaveBeenCalled();
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("blocks demoting the final live parent", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue(ADULT);
    mocks.findLiveMemberByName.mockResolvedValue({ id: "live-parent", name: "Rebecca", role: "parent" });
    mocks.listLiveMembersSanitized.mockResolvedValue([
      { id: "live-parent", name: "Rebecca", role: "parent" },
    ]);

    const res = await PATCH(req({ method: "PATCH", body: { name: "Rebecca", patch: { role: "child" } } }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "last_parent" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("rejects a child session with 403 before touching data", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue(CHILD);

    const res = await PATCH(req({ method: "PATCH", body: { name: "Emily", patch: { role: "parent" } } }));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "adult_only" });
    expect(mocks.findLiveMemberByName).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown member", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue(ADULT);
    mocks.findLiveMemberByName.mockResolvedValue(null);

    const res = await PATCH(req({ method: "PATCH", body: { name: "Nobody", patch: { emoji: "👻" } } }));

    expect(res.status).toBe(404);
  });

  it("returns 400 when name or patch are missing", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue(ADULT);
    expect((await PATCH(req({ method: "PATCH", body: { patch: {} } }))).status).toBe(400);
    expect((await PATCH(req({ method: "PATCH", body: { name: "Rebecca" } }))).status).toBe(400);
  });

  it("rejects a case-insensitive full-name duplicate on rename", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue(ADULT);
    mocks.findLiveMemberById.mockResolvedValue({ id: "pb-jon", name: "Jon", role: "child" });
    let updated: any = null;
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn({
      collection: () => ({
        getFullList: async () => [
          { id: "pb-jon", name: "Jon" },
          { id: "pb-jonathan", name: "Jonathan" },
        ],
        update: async (_id: string, patch: any) => ((updated = patch), { ...patch, id: "pb-jon" }),
      }),
    }));

    const res = await PATCH(req({ method: "PATCH", body: { id: "pb-jon", patch: { name: "JONATHAN" } } }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "duplicate" });
    expect(updated).toBeNull();
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
    mocks.findLiveMemberByName.mockResolvedValue({ id: "pb-row-1", name: "Rebecca", role: "parent" });
    mocks.listLiveMembersSanitized.mockResolvedValue([
      { id: "m1", name: "Rebecca", role: "parent" },
      { id: "m3", name: "Emily", role: "child" },
    ]);

    const res = await DELETE(req({ method: "DELETE", body: { name: "Rebecca" } }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "last_parent" });
  });

  it("does not count fallback parents when protecting the final live parent", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue(ADULT);
    mocks.findLiveMemberByName.mockResolvedValue({ id: "live-parent", name: "Rebecca", role: "parent" });
    mocks.listLiveMembersSanitized.mockResolvedValue([
      { id: "live-parent", name: "Rebecca", role: "parent" },
    ]);

    const res = await DELETE(req({ method: "DELETE", body: { name: "Rebecca" } }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "last_parent" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("deletes a member when another parent remains", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue(ADULT);
    mocks.findLiveMemberByName.mockResolvedValue({ id: "pb-row-2", name: "Jeffery", role: "parent" });
    mocks.listLiveMembersSanitized.mockResolvedValue([
      { id: "m1", name: "Rebecca", role: "parent" },
      { id: "m2", name: "Jeffery", role: "parent" },
      { id: "m3", name: "Emily", role: "child" },
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
    mocks.findLiveMemberByName.mockResolvedValue({ id: "pb-row-3", name: "Emily", role: "child" });
    mocks.listLiveMembersSanitized.mockResolvedValue([
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
    mocks.findLiveMemberByName.mockResolvedValue(null);
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

  it.each([
    ["missing", { name: "Nova Garcia" }],
    ["null", { name: "Nova Garcia", role: null }],
    ["numeric", { name: "Nova Garcia", role: 42 }],
    ["empty", { name: "Nova Garcia", role: "" }],
    ["unknown", { name: "Nova Garcia", role: "admin" }],
  ])("rejects a %s create role before calling the server helper", async (_label, body) => {
    mocks.authorizeAdminRequest.mockResolvedValue(ADULT);

    const res = await POST(req({ method: "POST", body }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_role" });
    expect(mocks.createMemberRecord).not.toHaveBeenCalled();
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

    const res = await POST(req({ method: "POST", body: { name: "Rebecca", role: "child" } }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "duplicate" });
  });

  it("returns the starter PIN once without exposing it in the member row", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue(ADULT);
    mocks.createMemberRecord.mockResolvedValue({
      id: "pb-row-new",
      name: "Nova Garcia",
      role: "child",
      emoji: "🦄",
      pin: "1234",
    });

    const res = await POST(req({ method: "POST", body: { name: "Nova Garcia", role: "child" } }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.starterPin).toBe("1234");
    expect(body.member.pin).toBeUndefined();
    expect(body.member).not.toHaveProperty("starterPin");
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

  it("ignores a client-supplied pin and stores a collision-safe four-digit PIN", async () => {
    const createMemberRecord = await realHelper();
    let created: any = null;
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) =>
      fn(fakePB({ members: [], onCreate: (args) => ((created = args), { ...args, id: "new-1" }) }))
    );

    const row = await createMemberRecord({ name: "Rebecca", role: "parent", emoji: "🦊", pin: "9999" });

    expect(row).toMatchObject({ id: "new-1", name: "Rebecca", role: "parent", emoji: "🦊" });
    // The client's pin never wins; the server resolves a collision-safe PIN.
    expect(created.pin).toMatch(/^\d{4}$/);
    expect(JSON.stringify(created)).not.toContain("9999");
  });

  it("generates a four-digit starter PIN for an arbitrary name", async () => {
    const createMemberRecord = await realHelper();
    let created: any = null;
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) =>
      fn(fakePB({ members: [], onCreate: (args) => ((created = args), { ...args, id: "new-1" }) }))
    );

    const row = await createMemberRecord({ name: "Nova Garcia", role: "child" });

    expect(row).toMatchObject({ id: "new-1", name: "Nova Garcia" });
    expect(created.pin).toMatch(/^\d{4}$/);
    expect(created.pin).not.toBe("");
  });

  it("retries a generated PIN when it collides with an existing credential", async () => {
    const createMemberRecord = await realHelper();
    randomInt.mockReturnValueOnce(12).mockReturnValueOnce(12).mockReturnValueOnce(34);
    let created: any = null;
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) =>
      fn(fakePB({ members: [{ id: "r1", name: "Existing", pin: "0012" }], onCreate: (args) => ((created = args), { ...args, id: "new-1" }) }))
    );

    await createMemberRecord({ name: "Nova Garcia", role: "child" });

    expect(created.pin).toBe("0034");
    expect(randomInt).toHaveBeenCalledTimes(3);
  });

  it("avoids a seeded fallback credential when PB has no rows", async () => {
    const createMemberRecord = await realHelper();
    randomInt.mockReturnValueOnce(202).mockReturnValueOnce(303);
    let created: any = null;
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) =>
      fn(fakePB({ members: [], onCreate: (args) => ((created = args), { ...args, id: "new-1" }) }))
    );

    await createMemberRecord({ name: "Nova Garcia", role: "child" });

    expect(created.pin).toBe("0303");
    expect(randomInt).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid and blank admin PIN patch values before PB mutation", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue(ADULT);
    mocks.findLiveMemberByName.mockResolvedValue({ id: "pb-1", name: "Rebecca", role: "parent" });

    const invalid = await PATCH(req({ method: "PATCH", body: { name: "Rebecca", patch: { pin: "12x" } } }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "invalid_pin" });

    let written: any = null;
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn({
      collection: () => ({ update: async (_id: string, patch: any) => ((written = patch), { ...patch, id: "pb-1" }) }),
    }));
    const blank = await PATCH(req({ method: "PATCH", body: { name: "Rebecca", patch: { pin: "   ", emoji: "🦊" } } }));
    expect(blank.status).toBe(200);
    expect(written).toEqual({ emoji: "🦊" });
  });

  it("checks live and fallback PIN collisions while allowing the target's own PIN", async () => {
    const actual = await vi.importActual<typeof import("@/lib/server-auth")>("@/lib/server-auth");
    const pb = { collection: () => ({ getFullList: async () => [{ id: "pb-1", name: "One", pin: "1234" }, { id: "pb-2", name: "Two" }] }) };
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    await expect(actual.isMemberPinAvailable("1234", "pb-2")).resolves.toBe(false);
    await expect(actual.isMemberPinAvailable("1234", "pb-1")).resolves.toBe(true);
  });

  it("allows Jon and Jonathan but rejects case-insensitive exact duplicates", async () => {
    const createMemberRecord = await realHelper();
    const members = [{ id: "r1", name: "Jonathan", role: "child", pin: "1111" }];
    const created: any[] = [];
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(fakePB({
      members,
      onCreate: (args) => {
        const row = { ...args, id: `new-${created.length + 1}` };
        members.push(row);
        created.push(args);
        return row;
      },
    })));

    const jon = await createMemberRecord({ name: "Jon", role: "child" });
    expect(jon).toMatchObject({ name: "Jon" });
    expect(created).toHaveLength(1);

    const duplicate = await createMemberRecord({ name: "jon", role: "child" });
    expect(duplicate).toBeNull();
  });

  it("rejects ambiguous prefix candidates during PIN verification", async () => {
    const actual = await vi.importActual<typeof import("@/lib/server-auth")>("@/lib/server-auth");
    actual.__resetPinThrottleForTests();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(fakePB({
      members: [
        { id: "r1", name: "Jon", pin: "1111" },
        { id: "r2", name: "Jonathan", pin: "2222" },
      ],
    })));

    await expect(actual.verifyPinFromPB("Jo", "1111")).resolves.toBeNull();
  });

  it("resolves the server default for an exact live member without a stored PIN", async () => {
    const actual = await vi.importActual<typeof import("@/lib/server-auth")>("@/lib/server-auth");
    actual.__resetPinThrottleForTests();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn({
      collection: () => ({
        getOne: async () => ({ id: "r1", name: "Rebecca", role: "parent" }),
      }),
    }));

    await expect(actual.verifyPinForMemberId("r1", "0202")).resolves.toMatchObject({ id: "r1", pin: "0202" });
  });

  it("allows a unique case-insensitive fuzzy PIN lookup", async () => {
    const actual = await vi.importActual<typeof import("@/lib/server-auth")>("@/lib/server-auth");
    actual.__resetPinThrottleForTests();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(fakePB({
      members: [{ id: "r1", name: "Jon", pin: "1111" }],
    })));

    await expect(actual.verifyPinFromPB("jo", "1111")).resolves.toMatchObject({ id: "r1", name: "Jon" });
  });

  it("matches an exact live member name case-insensitively", async () => {
    const actual = await vi.importActual<typeof import("@/lib/server-auth")>("@/lib/server-auth");
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(fakePB({
      members: [{ id: "r1", name: "Jonathan" }],
    })));

    await expect(actual.findLiveMemberByExactName("jOnAtHaN")).resolves.toMatchObject({ id: "r1", name: "Jonathan" });
  });

  it("allows a distinct full name beside a similar prefix", async () => {
    const createMemberRecord = await realHelper();
    let created: any = null;
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) =>
      fn(fakePB({
        members: [{ id: "r1", name: "Rebecca Garcia", role: "parent" }],
        onCreate: (args) => ((created = args), { ...args, id: "new-1" }),
      }))
    );

    const row = await createMemberRecord({ name: "Rebecca" });

    expect(row).toMatchObject({ name: "Rebecca" });
    expect(created).toBeTruthy();
  });

  it("updates an exact live PB ID instead of fuzzy first-name matching", async () => {
    const actual = await vi.importActual<typeof import("@/lib/server-auth")>("@/lib/server-auth");
    const updated: any[] = [];
    const pb = {
      collection: () => ({
        getOne: async (id: string) => ({ id, name: id === "pb-jon" ? "Jon" : "Jonathan" }),
        getFullList: async () => [
          { id: "pb-jon", name: "Jon" },
          { id: "pb-jonathan", name: "Jonathan" },
        ],
        update: async (id: string, patch: any) => {
          updated.push({ id, patch });
          return { id, ...patch };
        },
        create: async () => { throw new Error("unexpected create"); },
      }),
    };

    const row = await actual.findOrCreateMemberRecord(pb as any, { id: "pb-jon", name: "Jon" }, { emoji: "🦊" });

    expect(row).toMatchObject({ id: "pb-jon", emoji: "🦊" });
    expect(updated).toEqual([{ id: "pb-jon", patch: { emoji: "🦊" } }]);
  });

  it("does not turn a synthetic fallback ID into a PB mutation", async () => {
    const actual = await vi.importActual<typeof import("@/lib/server-auth")>("@/lib/server-auth");
    let created = false;
    const pb = {
      collection: () => ({
        getOne: async () => { throw new Error("unexpected getOne"); },
        getFullList: async () => [],
        create: async () => { created = true; return {}; },
      }),
    };

    await expect(actual.findOrCreateMemberRecord(pb as any, { id: 3, name: "Jon" }, { emoji: "🦊" })).resolves.toBeNull();
    expect(created).toBe(false);
  });
});
