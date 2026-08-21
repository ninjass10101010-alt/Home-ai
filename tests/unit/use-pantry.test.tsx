// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

const h = vi.hoisted(() => ({ state: { pantry: [] as any[] } }));

vi.mock("@/db", () => ({
  db: {
    selectPantry: async () => h.state.pantry.map(r => ({ ...r })),
    upsertPantryItem: async (item: any) => {
      const existing = h.state.pantry.find(p => (p.item || p.name)?.toLowerCase() === item.name?.toLowerCase());
      if (existing) { Object.assign(existing, item, { item: item.name }); return { ...existing }; }
      const rec = { id: `pp_${h.state.pantry.length + 1}`, ...item, item: item.name };
      h.state.pantry.push(rec);
      return { ...rec };
    },
    deletePantryItem: async (id: any) => {
      const idx = h.state.pantry.findIndex(p => String(p.id) === String(id));
      if (idx === -1) return false;
      h.state.pantry.splice(idx, 1);
      return true;
    },
  },
}));

import { usePantry } from "@/hooks/usePantry";

let hookResult: any;
const toasts: string[] = [];
function Harness() {
  hookResult = usePantry((msg: string) => toasts.push(msg));
  return null;
}

async function mount() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<Harness />); });
  await act(async () => { await new Promise(r => setTimeout(r, 20)); });
}

describe("usePantry", () => {
  beforeEach(() => {
    h.state.pantry = [];
    localStorage.clear();
    hookResult = null;
    toasts.length = 0;
  });

  it("addPantryItem persists quantity and unit (BUG-4)", async () => {
    await mount();
    let saved: any;
    await act(async () => { saved = await hookResult.addPantryItem("Milk", "plenty", { quantity: 2, unit: "lb" }); });
    expect(saved.id).toBe("pp_1");
    expect(h.state.pantry[0].quantity).toBe(2);
    expect(h.state.pantry[0].unit).toBe("lb");
  });

  it("silent mode fires no toast (BUG-7)", async () => {
    await mount();
    await act(async () => { await hookResult.addPantryItem("Milk", "plenty", { silent: true }); });
    expect(toasts).toHaveLength(0);
    await act(async () => { await hookResult.addPantryItem("Eggs", "plenty"); });
    expect(toasts).toHaveLength(1);
  });

  it("persists an empty pantry after the last item is removed (BUG-5)", async () => {
    h.state.pantry.push({ id: "pp_1", name: "Milk", item: "Milk", status: "plenty" });
    await mount();
    await act(async () => { await hookResult.removePantryItem("pp_1"); });
    expect(localStorage.getItem("consuela-pantry")).toBe("[]");
  });

  it("removePantryItem works with PB string ids", async () => {
    h.state.pantry.push({ id: "pp_1", name: "Milk", item: "Milk", status: "plenty" });
    await mount();
    await act(async () => { await hookResult.removePantryItem("pp_1"); });
    expect(h.state.pantry).toHaveLength(0);
    expect(hookResult.pantryItems).toHaveLength(0);
  });
});
