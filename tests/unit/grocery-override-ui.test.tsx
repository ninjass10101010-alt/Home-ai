// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import ShopTab from "@/components/meals/ShopTab";

function makeProps(overrides: any = {}) {
  const calls = { toggleOverride: [] as any[] };
  const props = {
    groceryItems: [
      { id: "g1", name: "Milk", emoji: "🥛", category: "dairy", priority: "medium", needed: true, manualOverride: false },
      { id: "g2", name: "Bread", emoji: "🍞", category: "pantry", priority: "medium", needed: true, manualOverride: true },
    ],
    meals: [],
    flowSummary: "",
    activeCategory: "all",
    setActiveCategory: () => {},
    isSyncing: false,
    recentlyBought: [],
    clearRecentlyBought: () => {},
    addGroceryItem: async () => true,
    toggleGroceryNeeded: async () => {},
    deleteGroceryItem: async () => {},
    updateGroceryItem: async () => {},
    syncMealToGrocery: async () => {},
    syncPantryToGrocery: async () => {},
    parseManualGroceryInput: (s: string) => ({ name: s, quantity: "" }),
    guessCategory: () => "pantry",
    showToast: () => {},
    pantryItems: [],
    addPantryItem: async () => false,
    removePantryItem: async () => {},
    toggleManualOverride: async (id: any) => { calls.toggleOverride.push(id); },
    ...overrides,
  };
  return { props, calls };
}

async function render(props: any) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<ShopTab {...props} />); });
  return el;
}

describe("GroceryTab manual-override pin", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("renders a pin button on every row", async () => {
    const { props } = makeProps();
    const root = await render(props);
    const pins = Array.from(root.querySelectorAll("button")).filter(b => (b.getAttribute("aria-label") || "").includes("lock"));
    expect(pins).toHaveLength(2);
  });

  it("tapping the pin calls toggleManualOverride with the row id", async () => {
    const { props, calls } = makeProps();
    const root = await render(props);
    const pin = Array.from(root.querySelectorAll("button")).find(b => b.getAttribute("aria-label") === "lock Milk from auto-sync");
    expect(pin).toBeTruthy();
    await act(async () => { (pin as HTMLButtonElement).click(); });
    expect(calls.toggleOverride).toEqual(["g1"]);
  });

  it("shows the locked state for manualOverride rows", async () => {
    const { props } = makeProps();
    const root = await render(props);
    const locked = Array.from(root.querySelectorAll("button")).find(b => b.getAttribute("aria-label") === "unlock Bread for auto-sync");
    expect(locked).toBeTruthy();
  });
});
