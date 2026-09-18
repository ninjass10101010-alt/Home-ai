import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = { records: [] as any[], deletes: [] as string[] };
  const collectionMock = {
    getFullList: async () => state.records.map((r) => ({ ...r })),
    create: async (data: any) => {
      const rec = { id: `pb_${state.records.length + 1}`, ...data };
      state.records.push(rec);
      return { ...rec };
    },
    update: async (id: string, data: any) => {
      const rec = state.records.find((r) => r.id === id);
      if (!rec) throw new Error("404 not found");
      Object.assign(rec, data);
      return { ...rec };
    },
    delete: async (id: string) => {
      state.deletes.push(id);
      state.records = state.records.filter((r) => r.id !== id);
      return true;
    },
  };
  return { state, collectionMock };
});

vi.mock("@/lib/pb", () => ({
  getPB: () => ({ collection: () => { throw new Error("public client forbidden"); } }),
  getAdminPB: () => ({ collection: () => h.collectionMock }),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: async (fn: any) => fn({ collection: () => h.collectionMock }),
}));

import { db } from "@/db/pb-db";
import { COLLECTIONS, dedupeHallOfFameRows } from "@/lib/pb-seed";

describe("hall_of_fame seed declaration", () => {
  it("pins one enshrinement per member+week via a UNIQUE index", () => {
    const col = COLLECTIONS.find((c) => c.name === "hall_of_fame");
    expect(col).toBeDefined();
    expect((col as { indexes?: string[] }).indexes).toContain(
      "CREATE UNIQUE INDEX idx_hall_of_fame_member_week ON hall_of_fame (member, weekStart)"
    );
  });
});

describe("dedupeHallOfFameRows — one-time heal before the unique index lands", () => {
  beforeEach(() => {
    h.state.records = [];
    h.state.deletes = [];
  });

  it("deletes duplicate (member, weekStart) rows, keeping the celebrated one", async () => {
    h.state.records.push(
      { id: "a", member: "Caspian Garcia", weekStart: "2026-09-07", points: 30, celebrated: false, created: "2026-09-07T10:00:00Z" },
      { id: "b", member: "Caspian Garcia", weekStart: "2026-09-07", points: 30, celebrated: true, created: "2026-09-07T09:00:00Z" },
      { id: "c", member: "Caspian Garcia", weekStart: "2026-09-14", points: 12, celebrated: false, created: "2026-09-14T10:00:00Z" },
      { id: "d", member: "Aurora Garcia", weekStart: "2026-09-07", points: 40, celebrated: false, created: "2026-09-07T11:00:00Z" }
    );
    const removed = await dedupeHallOfFameRows({ collection: () => h.collectionMock } as any);
    expect(removed).toBe(1);
    expect(h.state.deletes).toEqual(["a"]);
    expect(h.state.records.map((r) => r.id).sort()).toEqual(["b", "c", "d"]);
  });

  it("keeps the earliest created row when none of the dupes is celebrated", async () => {
    h.state.records.push(
      { id: "later", member: "Rebecca Garcia", weekStart: "2026-09-07", celebrated: false, created: "2026-09-08T00:00:00Z" },
      { id: "earlier", member: "Rebecca Garcia", weekStart: "2026-09-07", celebrated: false, created: "2026-09-07T00:00:00Z" }
    );
    const removed = await dedupeHallOfFameRows({ collection: () => h.collectionMock } as any);
    expect(removed).toBe(1);
    expect(h.state.deletes).toEqual(["later"]);
  });

  it("no-op when there is nothing to heal", async () => {
    h.state.records.push({ id: "solo", member: "Bailey", weekStart: "2026-09-07", celebrated: false });
    const removed = await dedupeHallOfFameRows({ collection: () => h.collectionMock } as any);
    expect(removed).toBe(0);
    expect(h.state.deletes).toEqual([]);
  });
});

describe("db.insertHallOfFameEntry — upsert by (member, weekStart)", () => {
  beforeEach(() => {
    h.state.records = [];
    h.state.deletes = [];
  });

  it("creates one row when the member+week is absent", async () => {
    const row = await db.insertHallOfFameEntry({ member: "Caspian Garcia", weekStart: "2026-09-14", points: 12, rank: 2 });
    expect(row?.member).toBe("Caspian Garcia");
    expect(h.state.records).toHaveLength(1);
  });

  it("updates the existing member+week row instead of duplicating it", async () => {
    await db.insertHallOfFameEntry({ member: "Caspian Garcia", weekStart: "2026-09-14", points: 12, rank: 3 });
    await db.insertHallOfFameEntry({ member: "Caspian Garcia", weekStart: "2026-09-14", points: 12, rank: 2, prize: "movie night" });
    expect(h.state.records).toHaveLength(1);
    expect(h.state.records[0].rank).toBe(2);
    expect(h.state.records[0].prize).toBe("movie night");
  });

  it("never loses a celebration: existing celebrated:true survives an incoming false", async () => {
    h.state.records.push({ id: "x1", member: "Caspian Garcia", weekStart: "2026-09-14", points: 12, celebrated: true });
    await db.insertHallOfFameEntry({ member: "Caspian Garcia", weekStart: "2026-09-14", points: 12, celebrated: false });
    expect(h.state.records).toHaveLength(1);
    expect(h.state.records[0].celebrated).toBe(true);
  });

  it("different member or weekStart still creates a fresh row", async () => {
    await db.insertHallOfFameEntry({ member: "Caspian Garcia", weekStart: "2026-09-14", points: 12 });
    await db.insertHallOfFameEntry({ member: "Aurora Garcia", weekStart: "2026-09-14", points: 12 });
    await db.insertHallOfFameEntry({ member: "Caspian Garcia", weekStart: "2026-09-21", points: 9 });
    expect(h.state.records).toHaveLength(3);
  });
});
