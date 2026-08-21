import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = { records: [] as any[] };
  const collectionMock = {
    getFullList: async () => state.records.map(r => ({ ...r })),
    create: async (data: any) => {
      const rec = { id: `pb_${state.records.length + 1}`, ...data };
      state.records.push(rec);
      return { ...rec };
    },
    update: async (id: string, data: any) => {
      const rec = state.records.find(r => r.id === id);
      if (!rec) throw new Error("404 not found");
      Object.assign(rec, data);
      return { ...rec };
    },
  };
  return { state, collectionMock };
});

vi.mock("@/lib/pb", () => ({
  getPB: () => ({ collection: () => h.collectionMock }),
  getAdminPB: () => ({ collection: () => h.collectionMock, autoCancellation: () => {} }),
}));

import { upsertGroceryItem, parseQuantityString } from "@/lib/grocery-service";

describe("parseQuantityString", () => {
  it("parses a bare number", () => {
    expect(parseQuantityString("2")).toEqual({ quantityValue: 2 });
  });
  it("parses number + unit", () => {
    expect(parseQuantityString("1.5 lb")).toEqual({ quantityValue: 1.5, unit: "lb" });
  });
  it("returns empty object for empty/whitespace input", () => {
    expect(parseQuantityString("")).toEqual({});
    expect(parseQuantityString("   ")).toEqual({});
  });
  it("returns unit-only when there is no leading number", () => {
    expect(parseQuantityString("a dozen")).toEqual({});
  });
});

describe("upsertGroceryItem real ids", () => {
  beforeEach(() => { h.state.records = []; });

  it("returns the real PB record id for a new item", async () => {
    const item = await upsertGroceryItem({ name: "Milk", category: "dairy" });
    expect(item.id).toBe("pb_1");
    expect(item.name).toBe("Milk");
    expect(item.needed).toBe(true);
  });

  it("reuses the existing PB record id for a duplicate name", async () => {
    const first = await upsertGroceryItem({ name: "Eggs", category: "dairy" });
    const second = await upsertGroceryItem({ name: "eggs", category: "dairy", quantity: "12" });
    expect(second.id).toBe(first.id);
    expect(h.state.records).toHaveLength(1);
    expect(second.quantity).toBe("12");
  });
});
