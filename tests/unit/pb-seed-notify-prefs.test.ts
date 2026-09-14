import { describe, it, expect, vi } from "vitest";

// Importing pb-seed pulls @/lib/pb-auth (needs env); mock it like sibling seed tests.
vi.mock("@/lib/pb-auth", () => ({ withAdmin: vi.fn() }));

import { seedNotifyPrefs } from "@/lib/pb-seed";

function fakePB(rows: Record<string, unknown>[]) {
  const store = new Map(rows.map((r) => [String((r as { key: string }).key), r]));
  const create = vi.fn(async (data: { key: string }) => {
    store.set(data.key, data);
  });
  return {
    collection: () => ({
      getFirstListItem: async (filter: string) => {
        const m = /key="([^"]+)"/.exec(filter);
        const hit = m ? store.get(m[1]) : undefined;
        if (!hit) throw { status: 404 };
        return hit;
      },
      create,
    }),
    store,
    create,
  };
}

describe("seedNotifyPrefs", () => {
  it("creates the three default OFF rows when none exist", async () => {
    const pb = fakePB([]);
    await seedNotifyPrefs(pb as never);
    expect([...pb.store.keys()].sort()).toEqual(["briefing", "calendar", "weather"]);
    expect([...pb.store.values()].every((r) => (r as { enabled: boolean }).enabled === false)).toBe(true);
  });

  it("never flips an existing row (create-if-absent only)", async () => {
    const pb = fakePB([{ key: "weather", enabled: true }]);
    await seedNotifyPrefs(pb as never);
    expect(pb.create).toHaveBeenCalledTimes(2); // briefing + calendar only
    expect((pb.store.get("weather") as { enabled: boolean }).enabled).toBe(true);
  });
});
