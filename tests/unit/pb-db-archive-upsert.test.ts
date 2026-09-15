// Round-2 fix — db.archiveWeek must be an idempotent UPSERT by weekStart, not a
// blind create. The pre-read in archiveWeekIfMissing is only a fast path: the
// production adapters swallow read failures (safeList → [], clientListOrEmpty →
// []), so a transient failure used to let a successful create duplicate every
// archived week. The write itself now reads-then-updates/creates; and if that
// read genuinely fails it degrades to null instead of guessing "create".
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = { records: [] as any[], calls: [] as any[], readFails: false };
  const collectionMock = {
    getFullList: async () => {
      if (state.readFails) throw new Error("PB read down");
      state.calls.push(["list"]);
      return state.records.map((r) => ({ ...r }));
    },
    create: async (data: any) => {
      state.calls.push(["create", data]);
      const rec = { id: `pb_${state.records.length + 1}`, ...data };
      state.records.push(rec);
      return { ...rec };
    },
    update: async (id: string, data: any) => {
      state.calls.push(["update", id, data]);
      const rec = state.records.find((r) => r.id === id);
      if (!rec) throw new Error("404 not found");
      Object.assign(rec, data);
      return { ...rec };
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

describe("pb-db archiveWeek upsert", () => {
  beforeEach(() => {
    h.state.records = [];
    h.state.calls = [];
    h.state.readFails = false;
  });

  it("creates one row when the week is absent", async () => {
    const row = await db.archiveWeek({ weekStart: "2026-08-31", points: { A: 1 } });

    expect(row?.weekStart).toBe("2026-08-31");
    expect(h.state.records).toHaveLength(1);
    expect(h.state.calls.filter((c) => c[0] === "create")).toHaveLength(1);
    expect(h.state.calls.filter((c) => c[0] === "update")).toHaveLength(0);
  });

  it("updates the existing weekStart row instead of duplicating it", async () => {
    h.state.records.push({ id: "wa1", weekStart: "2026-08-31", points: { A: 1 } });

    const row = await db.archiveWeek({ weekStart: "2026-08-31", points: { A: 42 } });

    expect(h.state.records).toHaveLength(1);
    expect((row as any).points).toEqual({ A: 42 });
    expect(h.state.calls.filter((c) => c[0] === "create")).toHaveLength(0);
    expect(h.state.calls.filter((c) => c[0] === "update")).toHaveLength(1);
  });

  it("degrades to null without creating when the PB read fails", async () => {
    h.state.readFails = true;

    await expect(db.archiveWeek({ weekStart: "2026-08-31" })).resolves.toBeNull();
    expect(h.state.records).toHaveLength(0);
    expect(h.state.calls.filter((c) => c[0] === "create")).toHaveLength(0);
  });
});
