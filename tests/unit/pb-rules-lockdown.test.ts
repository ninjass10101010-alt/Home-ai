import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ withAdmin: vi.fn() }));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import { COLLECTIONS, seedCollections } from "@/lib/pb-seed";

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

describe("pb rules lockdown", () => {
  it("creates every app collection with all five API rules null (admin-only)", async () => {
    const pb = makePb([]);
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    await seedCollections();

    expect(pb.collections.create).toHaveBeenCalled();
    for (const call of (pb.collections.create as any).mock.calls) {
      const payload = call[0];
      expect(payload.listRule, `${payload.name}.listRule must be null`).toBeNull();
      expect(payload.viewRule, `${payload.name}.viewRule must be null`).toBeNull();
      expect(payload.createRule, `${payload.name}.createRule must be null`).toBeNull();
      expect(payload.updateRule, `${payload.name}.updateRule must be null`).toBeNull();
      expect(payload.deleteRule, `${payload.name}.deleteRule must be null`).toBeNull();
    }
    const createdNames = new Set(
      (pb.collections.create as any).mock.calls.map((c: any[]) => c[0].name)
    );
    for (const col of COLLECTIONS) {
      expect(createdNames.has(col.name), `${col.name} must be seeded`).toBe(true);
    }
  });

  it("self-heals a live collection with open rules back to locked (patch TO null, '(locked)')", async () => {
    const eventsDef = COLLECTIONS.find((c) => c.name === "events");
    expect(eventsDef).toBeDefined();
    const live = {
      id: "evt_live_1",
      name: "events",
      fields: eventsDef!.schema.map((s: any) => ({ name: s.name })),
      indexes: [],
      // pre-lockdown state: publicly open
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
    };
    const pb = makePb([live]);
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const result = await seedCollections();

    expect(pb.collections.update).toHaveBeenCalledWith("evt_live_1", LOCKED);
    expect(result.join(", ")).toContain("(locked)");
    expect(result.join(", ")).not.toContain("(rules opened)");
  });

  it("leaves an already-locked live collection untouched (rulesMatch true only when ALL five are null)", async () => {
    const eventsDef = COLLECTIONS.find((c) => c.name === "events")!;
    const live = {
      id: "evt_live_1",
      name: "events",
      // Include the autodate fields the seeder self-heals so this collection
      // is genuinely up-to-date and needs no patch.
      fields: [
        ...eventsDef.schema.map((s: any) => ({ name: s.name })),
        { name: "created" },
        { name: "updated" },
      ],
      indexes: [],
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    };
    const pb = makePb([live]);
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    await seedCollections();

    expect(pb.collections.update).not.toHaveBeenCalled();
  });
});
