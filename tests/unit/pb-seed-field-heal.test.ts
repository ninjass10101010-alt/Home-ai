import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ withAdmin: vi.fn() }));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import { COLLECTIONS, seedCollections } from "@/lib/pb-seed";
import { MAX_AVATAR_CHARS } from "@/app/api/members/profile/route";

const LOCKED = {
  listRule: null,
  viewRule: null,
  createRule: null,
  updateRule: null,
  deleteRule: null,
};

function makePb(existing: any[] = []) {
  return {
    collections: {
      getFullList: vi.fn(async () => existing),
      create: vi.fn(async (payload: any) => ({ id: `new_${payload.name}`, ...payload })),
      update: vi.fn(async (id: string, body: any) => ({ id, ...body })),
    },
  };
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
});

describe("members.emoji text-field max", () => {
  it("seeds the emoji field with an explicit 400000-char max (matches the profile route's MAX_AVATAR_CHARS)", () => {
    const membersDef = COLLECTIONS.find((c) => c.name === "members")!;
    const emoji = membersDef.schema.find((s: any) => s.name === "emoji");
    expect(emoji).toBeDefined();
    expect((emoji as any).options?.max).toBe(400000);
  });

  it("heals a live members collection whose emoji.max drifted back to the 5000-char default", async () => {
    const membersDef = COLLECTIONS.find((c) => c.name === "members")!;
    const schema = [
      ...membersDef.schema,
      { name: "created" },
      { name: "updated" },
    ];
    const live = {
      id: "mbr_live_1",
      name: "members",
      fields: schema.map((s: any) => ({
        name: s.name,
        type: s.type || "text",
        max: s.name === "emoji" ? 0 : (s.options?.max ?? 0),
        required: !!s.required,
      })),
      indexes: [],
      ...LOCKED,
    };
    const pb = makePb([live]);
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    await seedCollections();

    const updateCall = (pb.collections.update as any).mock.calls.find(
      (c: any[]) => c[0] === "mbr_live_1"
    );
    expect(updateCall).toBeDefined();
    const fields = updateCall[1].fields as any[];
    const emoji = fields.find((f: any) => f.name === "emoji");
    expect(emoji.max).toBe(400000);
  });

  it("leaves an already-correct emoji.max untouched", async () => {
    const membersDef = COLLECTIONS.find((c) => c.name === "members")!;
    const schema = [
      ...membersDef.schema,
      { name: "created" },
      { name: "updated" },
    ];
    const live = {
      id: "mbr_live_2",
      name: "members",
      fields: schema.map((s: any) => ({
        name: s.name,
        type: s.type || "text",
        max: s.name === "emoji" ? 400000 : (s.options?.max ?? 0),
        required: !!s.required,
      })),
      indexes: [],
      ...LOCKED,
    };
    const pb = makePb([live]);
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    await seedCollections();

    const updateCall = (pb.collections.update as any).mock.calls.find(
      (c: any[]) => c[0] === "mbr_live_2"
    );
    // No rules drift, no missing fields, no missing indexes, no field drift -> no update.
    expect(updateCall).toBeUndefined();
  });

  it("keeps the route's avatar cap in lockstep with the seed's emoji field max", () => {
    const membersDef = COLLECTIONS.find((c) => c.name === "members")!;
    const emoji = membersDef.schema.find((s: any) => s.name === "emoji");
    expect((emoji as any).options?.max).toBe(MAX_AVATAR_CHARS);
  });

  it("tasks collection carries the stealable bool field", () => {
    const tasksDef = COLLECTIONS.find((c) => c.name === "tasks")!;
    const f = tasksDef.schema.find((s: any) => s.name === "stealable");
    expect(f).toBeDefined();
    expect(f!.type).toBe("bool");
  });

  it("tasks collection carries the pendingApproval json field", () => {
    const tasksDef = COLLECTIONS.find((c) => c.name === "tasks")!;
    const f = tasksDef.schema.find((s: any) => s.name === "pendingApproval");
    expect(f).toBeDefined();
    expect(f!.type).toBe("json");
  });

  it("tasks collection carries the sentBackAt text field", () => {
    const tasksDef = COLLECTIONS.find((c) => c.name === "tasks")!;
    const f = tasksDef.schema.find((s: any) => s.name === "sentBackAt");
    expect(f).toBeDefined();
    expect(f!.type).toBe("text");
  });

  it("seeds consuela_ai_providers with the provider schema", () => {
    const col = COLLECTIONS.find((c) => c.name === "consuela_ai_providers");
    expect(col).toBeDefined();
    const names = col!.schema.map((f) => f.name);
    for (const f of ["displayName", "baseUrl", "apiKey", "models", "enabled", "order"]) {
      expect(names).toContain(f);
    }
    const req = Object.fromEntries(col!.schema.map((f) => [f.name, !!f.required]));
    expect(req.displayName).toBe(true);
    expect(req.baseUrl).toBe(true);
    expect(req.apiKey).toBe(false); // key optional at seed level; upsert layer enforces
    // `order` is a SQLite reserved word — PocketBase runs this index SQL on
    // collection save, so an unquoted column aborts the whole seed run.
    const idxSql = col!.indexes?.[0] ?? "";
    expect(idxSql).toContain('("order")');
    expect(idxSql).not.toMatch(/\(\s*order\s*\)/);
  });
});