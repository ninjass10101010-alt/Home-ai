import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = { records: [] as any[], calls: [] as any[] };
  const collectionMock = {
    getFullList: async () => state.records.map(r => ({ ...r })),
    create: async (data: any) => {
      state.calls.push(["create", data]);
      const rec = { id: `pb_${state.records.length + 1}`, ...data };
      state.records.push(rec);
      return { ...rec };
    },
    update: async (id: string, data: any) => {
      state.calls.push(["update", id, data]);
      const rec = state.records.find(r => r.id === id);
      if (!rec) throw new Error("404 not found");
      Object.assign(rec, data);
      return { ...rec };
    },
    delete: async (id: string) => {
      state.calls.push(["delete", id]);
      const idx = state.records.findIndex(r => r.id === id);
      if (idx === -1) throw new Error("404 not found");
      state.records.splice(idx, 1);
    },
  };
  return { state, collectionMock };
});

vi.mock("@/lib/pb", () => ({
  getPB: () => ({ collection: () => h.collectionMock }),
  getAdminPB: () => ({ collection: () => h.collectionMock, autoCancellation: () => {} }),
}));

import { db } from "@/db/pb-db";

describe("pb-db grocery id handling", () => {
  beforeEach(() => {
    h.state.records = [];
    h.state.calls = [];
  });

  it("updates the record matched by id and omits id from the payload", async () => {
    h.state.records.push({ id: "pb_1", name: "Milk", needed: true });
    const saved = await db.upsertGroceryItem({ id: "pb_1", name: "Milk", needed: false });
    const updateCall = h.state.calls.find(c => c[0] === "update");
    expect(updateCall).toBeTruthy();
    expect(updateCall![1]).toBe("pb_1");
    expect(updateCall![2]).not.toHaveProperty("id");
    expect(saved?.needed).toBe(false);
  });

  it("falls back to name matching when no id is provided", async () => {
    h.state.records.push({ id: "pb_2", name: "Eggs", needed: true });
    await db.upsertGroceryItem({ name: "eggs", needed: false });
    const updateCall = h.state.calls.find(c => c[0] === "update");
    expect(updateCall![1]).toBe("pb_2");
  });

  it("creates a new record without id in the payload when nothing matches", async () => {
    const saved = await db.upsertGroceryItem({ name: "Bread", needed: true });
    const createCall = h.state.calls.find(c => c[0] === "create");
    expect(createCall).toBeTruthy();
    expect(createCall![1]).not.toHaveProperty("id");
    expect(saved?.id).toBeTruthy();
  });

  it("deleteGroceryItem removes the record by string id", async () => {
    h.state.records.push({ id: "pb_3", name: "Butter" });
    const ok = await db.deleteGroceryItem("pb_3");
    expect(ok).toBe(true);
    expect(h.state.records).toHaveLength(0);
  });

  it("deleteGroceryItem returns false for an unknown id instead of throwing", async () => {
    const ok = await db.deleteGroceryItem("does_not_exist");
    expect(ok).toBe(false);
  });
});
