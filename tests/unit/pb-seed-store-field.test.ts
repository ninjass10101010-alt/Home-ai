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

/** Build a faithful live PB field def from a seed schema field (select fields
 * carry their live `values` so the select-value heal sees them as correct). */
function liveFieldFor(s: any) {
  if (s.type === "select") {
    return { name: s.name, type: "select", values: [...(s.options?.values ?? [])] };
  }
  return { name: s.name, type: s.type || "text", max: s.options?.max ?? 0, required: !!s.required };
}

function makePb(existing: any[] = []) {
  return {
    collections: {
      getFullList: vi.fn(async () => existing),
      create: vi.fn(async (payload: any) => ({ id: `new_${payload.name}`, ...payload })),
      update: vi.fn(async (id: string, body: any) => ({ id, ...body })),
    },
  };
}

function groceryDef() {
  return COLLECTIONS.find((c) => c.name === "grocery_list_items")!;
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
});

describe("grocery_list_items.store field", () => {
  it("includes an optional store text field in the seed schema", () => {
    const store = groceryDef().schema.find((s: any) => s.name === "store");
    expect(store).toBeDefined();
    expect((store as any).type).toBe("text");
    expect((store as any).required).toBeFalsy();
  });

  it("patches a live grocery_list_items collection missing the store field on re-seed", async () => {
    // Live collection predates the multi-store feature: every seed field
    // except `store` exists (selects carry correct values, autodates present).
    const live = {
      id: "grc_live_1",
      name: "grocery_list_items",
      fields: [
        ...groceryDef()
          .schema.filter((s: any) => s.name !== "store")
          .map(liveFieldFor),
        { name: "created" },
        { name: "updated" },
      ],
      indexes: [],
      ...LOCKED,
    };
    const pb = makePb([live]);
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const result = await seedCollections();

    const updateCall = (pb.collections.update as any).mock.calls.find(
      (c: any[]) => c[0] === "grc_live_1"
    );
    expect(updateCall).toBeDefined();
    const fields = updateCall[1].fields as any[];
    expect(fields.find((f: any) => f.name === "store")).toEqual({
      name: "store",
      type: "text",
      required: false,
    });
    expect(result.join(", ")).toContain("+1 fields: store");
  });
});
