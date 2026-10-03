// The sync result used to be swallowed: every failure path in mealSync returned
// { added: 0, updated: 0, removed: 0 }, so useGrocery always toasted
// "✅ Synced +0 items to grocery" and the ❌ branch was unreachable. A failed
// sync must surface a real error state.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  grocery: [] as any[],
  sync: {
    ok: true,
    added: 0,
    updated: 0,
    removed: 0,
    writeFailures: 0,
  } as any,
  pantrySync: {
    ok: true,
    added: 0,
    updated: 0,
    removed: 0,
    writeFailures: 0,
  } as any,
  reject: null as Error | null,
}));

vi.mock("@/db", () => ({
  db: {
    selectGrocery: async () => h.grocery.map((r) => ({ ...r })),
    selectPantry: async () => [],
    selectMeals: async () => [],
    upsertGroceryItem: async (item: any) => {
      const byId = item.id != null ? h.grocery.find((g: any) => String(g.id) === String(item.id)) : undefined;
      const existing = byId || h.grocery.find((g: any) => g.name?.toLowerCase() === item.name?.toLowerCase());
      const { id: _omit, ...data } = item;
      if (existing) { Object.assign(existing, data); return { ...existing }; }
      if (!data.name) return null;
      const rec = { id: `pb_${h.grocery.length + 1}`, ...data };
      h.grocery.push(rec);
      return { ...rec };
    },
    deleteGroceryItem: async () => true,
    toggleGroceryOverride: async () => null,
  },
}));

vi.mock("@/services/mealSync", () => ({
  mealSyncService: {
    syncMealPlanToGrocery: async () => {
      if (h.reject) throw h.reject;
      return { ...h.sync };
    },
    syncPantryToGrocery: async () => {
      if (h.reject) throw h.reject;
      return { ...h.pantrySync };
    },
  },
}));

import { useGrocery } from "@/hooks/useGrocery";

let hookResult: any;
const toasts: string[] = [];

function Harness() {
  hookResult = useGrocery((msg: string) => { toasts.push(msg); });
  return null;
}

async function mount() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<Harness />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

const okSync = (over: Record<string, any> = {}) => ({
  ok: true, added: 2, updated: 1, removed: 0, writeFailures: 0, ...over,
});

beforeEach(() => {
  h.grocery = [];
  h.sync = okSync();
  h.pantrySync = okSync();
  h.reject = null;
  toasts.length = 0;
  hookResult = null;
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("useGrocery sync outcome is honest", () => {
  it("shows ❌ and sets syncError when the meal sync reports failure", async () => {
    h.sync = { ok: false, added: 0, updated: 0, removed: 0, writeFailures: 0, reason: "no_meals_planned", message: "No meals planned this week — nothing to sync." };
    await mount();

    await act(async () => { await hookResult.syncMealToGrocery(); });

    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatch(/^❌/);
    expect(toasts[0]).not.toMatch(/✅/);
    expect(toasts[0]).toContain("No meals planned this week");
    expect(hookResult.syncError).toBe("No meals planned this week — nothing to sync.");
  });

  it("does not merge a fresh read after a failed sync", async () => {
    h.grocery.push({ id: "pb_1", name: "Milk", category: "dairy", needed: true });
    h.sync = { ok: false, added: 0, updated: 0, removed: 0, writeFailures: 0, reason: "meals_read_blocked", message: "Sign in with your PIN to sync meals." };
    await mount();

    await act(async () => { await hookResult.syncMealToGrocery(); });

    expect(hookResult.groceryItems.map((i: any) => i.name)).toEqual(["Milk"]);
  });

  it("shows ❌ when the sync throws instead of a fake +0 success", async () => {
    h.reject = new Error("gateway exploded");
    await mount();

    await act(async () => { await hookResult.syncMealToGrocery(); });

    expect(toasts[0]).toMatch(/^❌/);
    expect(toasts[0]).toContain("gateway exploded");
    expect(hookResult.syncError).toBeTruthy();
  });

  it("shows ❌ for a failed pantry sync", async () => {
    h.pantrySync = { ok: false, added: 0, updated: 0, removed: 0, writeFailures: 0, reason: "pantry_read_failed", message: "Couldn't read the pantry — nothing was changed." };
    await mount();

    await act(async () => { await hookResult.syncPantryToGrocery(); });

    expect(toasts[0]).toMatch(/^❌/);
    expect(toasts[0]).toContain("Couldn't read the pantry");
    expect(hookResult.syncError).toBeTruthy();
  });

  it("reports a partial sync as partial, not as a clean ✅", async () => {
    h.sync = okSync({ added: 3, updated: 0, removed: 0, writeFailures: 2 });
    await mount();

    await act(async () => { await hookResult.syncMealToGrocery(); });

    expect(toasts[0]).toMatch(/⚠️/);
    expect(toasts[0]).toContain("2");
    expect(toasts[0]).not.toMatch(/^✅/);
  });

  it("still toasts a real ✅ on success and clears a previous error", async () => {
    h.sync = { ok: false, added: 0, updated: 0, removed: 0, writeFailures: 0, reason: "no_meals_planned", message: "nope" };
    await mount();
    await act(async () => { await hookResult.syncMealToGrocery(); });
    expect(hookResult.syncError).toBeTruthy();

    h.sync = okSync({ added: 4, updated: 0, removed: 0 });
    await act(async () => { await hookResult.syncMealToGrocery(); });

    expect(toasts[toasts.length - 1]).toMatch(/^✅/);
    expect(toasts[toasts.length - 1]).toContain("4");
    expect(hookResult.syncError).toBeNull();
  });

  it("honests a genuinely empty successful pantry sync without claiming items", async () => {
    h.pantrySync = okSync({ added: 0, updated: 0, removed: 0 });
    await mount();

    await act(async () => { await hookResult.syncPantryToGrocery(); });

    expect(toasts[0]).toMatch(/^✅/);
    expect(toasts[0]).toContain("+0");
    expect(hookResult.syncError).toBeNull();
  });
});