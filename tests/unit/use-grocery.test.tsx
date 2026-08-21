// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

const h = vi.hoisted(() => ({ state: { grocery: [] as any[] } }));

vi.mock("@/db", () => ({
  db: {
    selectGrocery: async () => h.state.grocery.map(r => ({ ...r })),
    upsertGroceryItem: async (item: any) => {
      const byId = item.id != null ? h.state.grocery.find(g => String(g.id) === String(item.id)) : undefined;
      const existing = byId || h.state.grocery.find(g => g.name?.toLowerCase() === item.name?.toLowerCase());
      const { id: _omit, ...data } = item;
      if (existing) { Object.assign(existing, data); return { ...existing }; }
      const rec = { id: `pb_${h.state.grocery.length + 1}`, ...data };
      h.state.grocery.push(rec);
      return { ...rec };
    },
    deleteGroceryItem: async (id: any) => {
      const idx = h.state.grocery.findIndex(g => String(g.id) === String(id));
      if (idx === -1) return false;
      h.state.grocery.splice(idx, 1);
      return true;
    },
    toggleGroceryOverride: async (id: any, override: boolean) => {
      const rec = h.state.grocery.find(g => String(g.id) === String(id));
      if (!rec) return null;
      rec.manualOverride = override;
      return { ...rec };
    },
  },
}));

import { useGrocery } from "@/hooks/useGrocery";

let hookResult: any;
function Harness() {
  hookResult = useGrocery(() => {});
  return null;
}

async function mount() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<Harness />); });
  await act(async () => { await new Promise(r => setTimeout(r, 20)); });
}

describe("useGrocery", () => {
  beforeEach(() => {
    h.state.grocery = [];
    localStorage.clear();
    hookResult = null;
  });

  it("hydrates state with real PB string ids", async () => {
    h.state.grocery.push({ id: "pb_1", name: "Milk", category: "dairy", needed: true });
    await mount();
    expect(hookResult.groceryItems[0].id).toBe("pb_1");
  });

  it("addGroceryItem appends with the real PB id (BUG-2)", async () => {
    h.state.grocery.push({ id: "pb_1", name: "Milk", category: "dairy", needed: true });
    await mount();
    await act(async () => { await hookResult.addGroceryItem("Bread", "pantry", "medium"); });
    const bread = hookResult.groceryItems.find((i: any) => i.name === "Bread");
    expect(bread.id).toBe("pb_2");
    expect(h.state.grocery).toHaveLength(2);
  });

  it("deleteGroceryItem removes the real PB record and the state row (BUG-2)", async () => {
    h.state.grocery.push({ id: "pb_1", name: "Milk", category: "dairy", needed: true });
    await mount();
    await act(async () => { await hookResult.deleteGroceryItem("pb_1"); });
    expect(h.state.grocery).toHaveLength(0);
    expect(hookResult.groceryItems).toHaveLength(0);
  });

  it("persists an empty list after the last item is deleted (BUG-5)", async () => {
    h.state.grocery.push({ id: "pb_1", name: "Milk", category: "dairy", needed: true });
    await mount();
    await act(async () => { await hookResult.deleteGroceryItem("pb_1"); });
    expect(localStorage.getItem("consuela-grocery")).toBe("[]");
  });

  it("skipRecent add does not touch Recently Bought (BUG-6)", async () => {
    h.state.grocery.push({ id: "pb_1", name: "Milk", category: "dairy", needed: true });
    await mount();
    await act(async () => { await hookResult.addGroceryItem("Undo Item", "pantry", "medium", undefined, "", "", true, true); });
    expect(hookResult.recentlyBought.some((r: any) => r.name === "Undo Item")).toBe(false);
    await act(async () => { await hookResult.addGroceryItem("Normal Item", "pantry", "medium"); });
    expect(hookResult.recentlyBought.some((r: any) => r.name === "Normal Item")).toBe(true);
  });

  it("toggleManualOverride flips the flag in state and PB", async () => {
    h.state.grocery.push({ id: "pb_1", name: "Milk", category: "dairy", needed: true });
    await mount();
    await act(async () => { await hookResult.toggleManualOverride("pb_1"); });
    expect(hookResult.groceryItems[0].manualOverride).toBe(true);
    expect(h.state.grocery[0].manualOverride).toBe(true);
    await act(async () => { await hookResult.toggleManualOverride("pb_1"); });
    expect(hookResult.groceryItems[0].manualOverride).toBe(false);
  });
});
