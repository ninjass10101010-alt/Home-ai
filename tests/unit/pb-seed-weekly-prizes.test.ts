import { describe, it, expect, vi } from "vitest";

// Importing pb-seed pulls @/lib/pb-auth (needs env); mock it like sibling seed tests.
vi.mock("@/lib/pb-auth", () => ({ withAdmin: vi.fn() }));

import { COLLECTIONS, seedWeeklyPrizes } from "@/lib/pb-seed";
import { DEFAULT_WEEKLY_PRIZES } from "@/lib/task-utils";

describe("weekly_prizes collection declaration", () => {
  it("declares the weekly_prizes collection with the rank/emoji/text schema", () => {
    const col = COLLECTIONS.find((c) => c.name === "weekly_prizes");
    expect(col).toBeDefined();
    const fields = Object.fromEntries(col!.schema.map((f: any) => [f.name, f]));
    expect(fields.rank).toMatchObject({ name: "rank", type: "number", required: true });
    expect(fields.emoji).toMatchObject({ name: "emoji", type: "text" });
    expect(fields.text).toMatchObject({ name: "text", type: "text" });
    // autodate created/updated come from the withAutodate() wrapper — the seed
    // declaration must NOT carry them manually.
    expect(fields.created).toBeUndefined();
    expect(fields.updated).toBeUndefined();
  });

  it("hall_of_fame carries the optional prize + celebrated fields", () => {
    const hall = COLLECTIONS.find((c) => c.name === "hall_of_fame");
    expect(hall).toBeDefined();
    const fields = Object.fromEntries(hall!.schema.map((f: any) => [f.name, f]));
    expect(fields.prize).toMatchObject({ name: "prize", type: "text", required: false });
    expect(fields.celebrated).toMatchObject({ name: "celebrated", type: "bool", required: false });
  });
});

function fakePB(rows: Record<string, unknown>[]) {
  const store = new Map(rows.map((r) => [Number((r as { rank: number }).rank), r]));
  const create = vi.fn(async (data: { rank: number }) => {
    store.set(data.rank, data);
  });
  const update = vi.fn(async () => {
    throw new Error("seedWeeklyPrizes must never update existing rows");
  });
  return {
    collection: () => ({
      getFirstListItem: async (filter: string) => {
        const m = /rank=(\d+)/.exec(filter);
        const hit = m ? store.get(Number(m[1])) : undefined;
        if (!hit) throw { status: 404 };
        return hit;
      },
      create,
      update,
    }),
    store,
    create,
    update,
  };
}

describe("seedWeeklyPrizes", () => {
  it("creates the three default prize rows when none exist", async () => {
    const pb = fakePB([]);
    await seedWeeklyPrizes(pb as never);
    expect(pb.create).toHaveBeenCalledTimes(3);
    expect([...pb.store.keys()].sort()).toEqual([1, 2, 3]);
    // Row contents come from DEFAULT_WEEKLY_PRIZES (single source of truth).
    for (const prize of DEFAULT_WEEKLY_PRIZES) {
      expect(pb.store.get(prize.rank)).toMatchObject({
        rank: prize.rank,
        emoji: prize.emoji,
        text: prize.text,
      });
    }
  });

  it("is a no-op when all three rows already exist", async () => {
    const pb = fakePB([
      { rank: 1, emoji: "🥇", text: "Picks Friday's family movie" },
      { rank: 2, emoji: "🥈", text: "Chooses the dessert night" },
      { rank: 3, emoji: "🥉", text: "+$2 allowance" },
    ]);
    await seedWeeklyPrizes(pb as never);
    expect(pb.create).not.toHaveBeenCalled();
    expect(pb.update).not.toHaveBeenCalled();
  });

  it("never overwrites a parent's edits (create-if-absent only)", async () => {
    // Parent customized the rank-1 prize text live; ranks 2–3 missing.
    const pb = fakePB([{ rank: 1, emoji: "🏆", text: "Parent's custom prize" }]);
    await seedWeeklyPrizes(pb as never);
    expect(pb.create).toHaveBeenCalledTimes(2); // ranks 2 + 3 only
    expect(pb.store.get(1)).toMatchObject({ emoji: "🏆", text: "Parent's custom prize" });
    expect(pb.update).not.toHaveBeenCalled();
    // And the two created rows still come from the defaults.
    expect(pb.store.get(2)).toMatchObject({ rank: 2, text: DEFAULT_WEEKLY_PRIZES[1].text });
    expect(pb.store.get(3)).toMatchObject({ rank: 3, text: DEFAULT_WEEKLY_PRIZES[2].text });
  });
});
