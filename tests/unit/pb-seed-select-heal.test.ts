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

function suggestionsDef() {
  return COLLECTIONS.find((c) => c.name === "proactive_suggestions")!;
}

function seedKindValues() {
  const kind = suggestionsDef().schema.find((s: any) => s.name === "kind");
  return (kind as any).options.values as string[];
}

/** Live PB field defs for every seed schema field; select-field `values` can be
 * overridden per field name to simulate live drift. */
function liveFieldsFor(schema: any[], selectOverrides: Record<string, string[]> = {}): any[] {
  const seen = new Set<string>();
  const fields: any[] = schema.map((s: any) => {
    seen.add(s.name);
    if (s.type === "select") {
      return {
        name: s.name,
        type: "select",
        values: selectOverrides[s.name] ? [...selectOverrides[s.name]] : [...(s.options?.values ?? [])],
      };
    }
    return { name: s.name, type: s.type || "text", max: s.options?.max ?? 0, required: !!s.required };
  });
  if (!seen.has("created")) fields.push({ name: "created" });
  if (!seen.has("updated")) fields.push({ name: "updated" });
  return fields;
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

beforeEach(() => {
  mocks.withAdmin.mockReset();
});

describe("proactive_suggestions.kind select values heal", () => {
  it("includes grocery_store_optimization in the seed kind values (live order)", () => {
    expect(seedKindValues()).toEqual([
      "pantry_low",
      "task_penalty_streak",
      "calendar_conflict",
      "stale_data",
      "custom",
      "grocery_store_optimization",
    ]);
  });

  it("patches a live kind select missing the value on re-seed (exact match to seed values)", async () => {
    const live = {
      id: "sgg_live_1",
      name: "proactive_suggestions",
      fields: liveFieldsFor(suggestionsDef().schema, {
        kind: ["pantry_low", "task_penalty_streak", "calendar_conflict", "stale_data", "custom"],
      }),
      indexes: suggestionsDef().indexes || [],
      ...LOCKED,
    };
    const pb = makePb([live]);
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const result = await seedCollections();

    const updateCall = (pb.collections.update as any).mock.calls.find(
      (c: any[]) => c[0] === "sgg_live_1"
    );
    expect(updateCall).toBeDefined();
    const fields = updateCall[1].fields as any[];
    expect(fields.find((f: any) => f.name === "kind").values).toEqual(seedKindValues());
    expect(result.join(", ")).toContain("kind");
  });

  it("patches a live kind select whose values drifted out-of-band (exact match, not union)", async () => {
    const live = {
      id: "sgg_live_2",
      name: "proactive_suggestions",
      fields: liveFieldsFor(suggestionsDef().schema, {
        kind: ["pantry_low", "custom", "some_out_of_band_kind"],
      }),
      indexes: suggestionsDef().indexes || [],
      ...LOCKED,
    };
    const pb = makePb([live]);
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    await seedCollections();

    const updateCall = (pb.collections.update as any).mock.calls.find(
      (c: any[]) => c[0] === "sgg_live_2"
    );
    expect(updateCall).toBeDefined();
    expect((updateCall[1].fields as any[]).find((f: any) => f.name === "kind").values).toEqual(
      seedKindValues()
    );
  });

  it("leaves an already-correct kind select untouched", async () => {
    const live = {
      id: "sgg_live_3",
      name: "proactive_suggestions",
      fields: liveFieldsFor(suggestionsDef().schema),
      indexes: suggestionsDef().indexes || [],
      ...LOCKED,
    };
    const pb = makePb([live]);
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    await seedCollections();

    const updateCall = (pb.collections.update as any).mock.calls.find(
      (c: any[]) => c[0] === "sgg_live_3"
    );
    expect(updateCall).toBeUndefined();
  });
});
