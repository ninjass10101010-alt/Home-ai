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

/** Live PB field defs for a seed schema: the typed-field shape PocketBase
 *  returns, so a state the seed leaves alone verifies clean. */
function liveFieldsFor(schema: readonly any[]): any[] {
  return schema.map((s: any) => {
    const field: any = { name: s.name, type: s.type || "text", required: !!s.required };
    if (s.type === "select") field.values = [...(s.options?.values ?? [])];
    if (s.type === "autodate") {
      field.onCreate = s.options?.onCreate !== false;
      if (s.options?.onUpdate) field.onUpdate = true;
    }
    if (s.options?.max !== undefined) field.max = s.options.max;
    if (s.options?.min !== undefined) field.min = s.options.min;
    return field;
  });
}

/** Reads reflect writes and hand back copies, so the seeder's own in-place field
 *  mutation can never masquerade as a landed `collections.update` patch. */
function makePb(existing: any[] = []) {
  const state = structuredClone(existing);
  return {
    collections: {
      getFullList: vi.fn(async () => structuredClone(state)),
      create: vi.fn(async (payload: any) => {
        const record = { id: `new_${payload.name}`, ...structuredClone(payload) };
        state.push(record);
        return record;
      }),
      update: vi.fn(async (id: string, body: any) => {
        const record = state.find((c: any) => c.id === id);
        if (record) Object.assign(record, structuredClone(body));
        return { id, ...body };
      }),
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
      fields: liveFieldsFor(eventsDef!.schema),
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
        ...liveFieldsFor(eventsDef!.schema),
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
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
