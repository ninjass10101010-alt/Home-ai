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
    deleteGroceryItem: async () => true,
    toggleGroceryOverride: async () => null,
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

describe("useGrocery store assignment", () => {
  beforeEach(() => {
    h.state.grocery = [];
    localStorage.clear();
    hookResult = null;
  });

  it("store-pill change persists to state, PB, and back across a refresh", async () => {
    h.state.grocery.push({ id: "pb_1", name: "Milk", category: "dairy", needed: true, store: "aldi" });
    await mount();
    // The server's store assignment survives the read mapping.
    expect(hookResult.groceryItems[0].store).toBe("aldi");

    // Tapping a store pill sends a store-only update (ShopTab handleStoreSelect).
    await act(async () => { await hookResult.updateGroceryItem("pb_1", { store: "meijer" }); });
    expect(hookResult.groceryItems[0].store).toBe("meijer");
    expect(h.state.grocery[0].store).toBe("meijer");

    // A cross-device refresh keeps the assignment (no name/quantity clobber).
    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
      await new Promise(r => setTimeout(r, 20));
    });
    expect(hookResult.groceryItems[0].store).toBe("meijer");
    expect(hookResult.groceryItems[0].name).toBe("Milk");
  });
});
