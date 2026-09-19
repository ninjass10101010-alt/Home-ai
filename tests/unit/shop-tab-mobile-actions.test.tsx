// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import ShopTab from "@/components/meals/ShopTab";

// The shared Modal's exit phase reads matchMedia (reduced-motion check) —
// absent in jsdom (same stub idiom as weekly-win-modal.test.tsx).
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
}));

function makeProps(overrides: any = {}) {
  const calls = {
    addPantry: [] as any[],
    deleteGrocery: [] as any[],
    addGrocery: [] as any[],
    removePantry: [] as any[],
    toasts: [] as string[],
    toggleOverride: [] as any[],
    updateGrocery: [] as any[],
  };
  const props = {
    groceryItems: [
      { id: "g1", name: "Milk", emoji: "🥛", category: "dairy", priority: "medium", needed: true, quantity: "2 lb" },
      { id: "g2", name: "Cereal", emoji: "🥣", category: "pantry", priority: "medium", needed: false, quantity: "12 oz" },
      { id: "g3", name: "Keep Me", emoji: "🧀", category: "dairy", priority: "medium", needed: true },
    ],
    meals: [],
    flowSummary: "",
    activeCategory: "all",
    setActiveCategory: () => {},
    isSyncing: false,
    recentlyBought: [],
    clearRecentlyBought: () => {},
    addGroceryItem: async (...args: any[]) => { calls.addGrocery.push(args); return true; },
    toggleGroceryNeeded: async () => {},
    deleteGroceryItem: async (id: any) => { calls.deleteGrocery.push(id); },
    updateGroceryItem: async (...args: any[]) => { calls.updateGrocery.push(args); },
    syncMealToGrocery: async () => {},
    syncPantryToGrocery: async () => {},
    parseManualGroceryInput: (s: string) => ({ name: s, quantity: "" }),
    guessCategory: () => "pantry",
    showToast: (m: string) => calls.toasts.push(m),
    pantryItems: [{ id: "p1", item: "Milk", status: "plenty" }],
    addPantryItem: async (name: string, status: string, opts: any) => { calls.addPantry.push({ name, status, opts }); return { id: `new_${name}`, item: name, status }; },
    removePantryItem: async (id: any) => { calls.removePantry.push(id); },
    toggleManualOverride: (id: any) => { calls.toggleOverride.push(id); },
    ...overrides,
  };
  return { props, calls };
}

let reactRoot: Root | null = null;

async function render(props: any) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  reactRoot = createRoot(el);
  await act(async () => { reactRoot!.render(<ShopTab {...props} />); });
  return el;
}

function rootButtons(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll("button")) as HTMLButtonElement[];
}

function sheetButtons(root: HTMLElement): HTMLButtonElement[] {
  return (Array.from(document.body.querySelectorAll("button")) as HTMLButtonElement[]).filter(b => !root.contains(b));
}

async function openSheet(root: HTMLElement, name: string) {
  const btn = rootButtons(root).find(b => b.getAttribute("aria-label") === `More actions for ${name}`);
  if (!btn) throw new Error(`More actions for ${name} button not found`);
  await act(async () => { btn.click(); });
}

describe("ShopTab mobile row actions", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  afterEach(async () => {
    await act(async () => { reactRoot?.unmount(); });
    reactRoot = null;
    document.body.innerHTML = "";
  });

  it("renders the ⋯ overflow button and StorePill; desktop cluster still in DOM", async () => {
    const { props } = makeProps();
    const root = await render(props);
    expect(rootButtons(root).find(b => b.getAttribute("aria-label") === "More actions for Milk")).toBeTruthy();
    expect(rootButtons(root).find(b => b.getAttribute("aria-label") === "lock Milk from auto-sync")).toBeTruthy();
    expect(rootButtons(root).find(b => b.getAttribute("aria-label") === "Edit Milk")).toBeTruthy();
  });

  it("tapping ⋯ opens the portaled sheet; Delete removes the row and closes", async () => {
    const { props, calls } = makeProps();
    const root = await render(props);
    await act(async () => { rootButtons(root).find(b => b.getAttribute("aria-label") === "More actions for Milk")!.click(); });
    await act(async () => { sheetButtons(root).find(b => b.getAttribute("aria-label") === "Delete Milk")!.click(); });
    expect(calls.deleteGrocery).toContain("g1");
  });

  it("Lock via sheet toggles the override", async () => {
    const { props, calls } = makeProps();
    const root = await render(props);
    await openSheet(root, "Milk");
    await act(async () => { sheetButtons(root).find(b => b.getAttribute("aria-label") === "lock Milk from auto-sync")!.click(); });
    expect(calls.toggleOverride).toContain("g1");
  });

  it("Edit via sheet opens the inline editor", async () => {
    const { props } = makeProps();
    const root = await render(props);
    await openSheet(root, "Milk");
    await act(async () => { sheetButtons(root).find(b => b.getAttribute("aria-label") === "Edit Milk")!.click(); });
    expect(document.querySelector('input[placeholder="Name"]')).toBeTruthy();
  });

  it("checked item's sheet offers Pantry; needed item's does not", async () => {
    const { props } = makeProps();
    const root = await render(props);
    await openSheet(root, "Milk");
    expect(sheetButtons(root).find(b => /send Milk to pantry/i.test(b.getAttribute("aria-label") || ""))).toBeFalsy();
    await openSheet(root, "Cereal");
    expect(sheetButtons(root).find(b => /send Cereal to pantry/i.test(b.getAttribute("aria-label") || ""))).toBeTruthy();
  });
});
