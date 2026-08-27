// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import ShopTab from "@/components/meals/ShopTab";

function makeProps(overrides: any = {}) {
  const calls = { addPantry: [] as any[], deleteGrocery: [] as any[], addGrocery: [] as any[], removePantry: [] as any[], toasts: [] as string[] };
  const props = {
    groceryItems: [
      { id: "g1", name: "Milk", emoji: "🥛", category: "dairy", priority: "medium", needed: false, quantity: "2 lb" },
      { id: "g2", name: "Bread", emoji: "🍞", category: "pantry", priority: "medium", needed: false },
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
    updateGroceryItem: async () => {},
    syncMealToGrocery: async () => {},
    syncPantryToGrocery: async () => {},
    parseManualGroceryInput: (s: string) => ({ name: s, quantity: "" }),
    guessCategory: () => "pantry",
    showToast: (m: string) => calls.toasts.push(m),
    pantryItems: [{ id: "p1", item: "Milk", status: "plenty" }],
    addPantryItem: async (name: string, status: string, opts: any) => { calls.addPantry.push({ name, status, opts }); return { id: `new_${name}`, item: name, status }; },
    removePantryItem: async (id: any) => { calls.removePantry.push(id); },
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

function findButton(root: HTMLElement, text: RegExp): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll("button")).find(b => text.test(b.textContent || ""));
  if (!btn) throw new Error(`button ${text} not found`);
  return btn as HTMLButtonElement;
}

describe("GroceryTab checked→pantry handoff", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("bulk send deletes ALL checked rows, including ones already in the pantry (BUG-1)", async () => {
    const { props, calls } = makeProps();
    const root = await render(props);
    const sendBtn = findButton(root, /Send 2 to pantry/);
    await act(async () => { sendBtn.click(); await new Promise(r => setTimeout(r, 30)); });
    expect(calls.deleteGrocery.sort()).toEqual(["g1", "g2"]);
    expect(calls.addPantry.map(c => c.name)).toEqual(["Bread"]);
    expect(calls.toasts.join(" ")).toMatch(/1 of 2/);
  });

  it("carries parsed quantity and unit into the pantry add (BUG-4)", async () => {
    const { props, calls } = makeProps();
    const root = await render(props);
    const sendBtn = findButton(root, /Send 2 to pantry/);
    await act(async () => { sendBtn.click(); await new Promise(r => setTimeout(r, 30)); });
    const bread = calls.addPantry.find(c => c.name === "Bread");
    expect(bread.opts).toMatchObject({ silent: true });
    const milkRow = props.groceryItems[0];
    expect(milkRow.quantity).toBe("2 lb");
  });

  it("bulk pantry adds are silent — exactly one summary toast (BUG-7)", async () => {
    const { props, calls } = makeProps({ pantryItems: [] });
    const root = await render(props);
    const sendBtn = findButton(root, /Send 2 to pantry/);
    await act(async () => { sendBtn.click(); await new Promise(r => setTimeout(r, 30)); });
    expect(calls.addPantry.every(c => c.opts?.silent === true)).toBe(true);
    expect(calls.toasts).toHaveLength(1);
  });

  it("undo re-adds rows with skipRecent and removes the created pantry items", async () => {
    const { props, calls } = makeProps({ pantryItems: [] });
    const root = await render(props);
    const sendBtn = findButton(root, /Send 2 to pantry/);
    await act(async () => { sendBtn.click(); await new Promise(r => setTimeout(r, 30)); });
    const undoBtn = findButton(root, /^Undo$/);
    await act(async () => { undoBtn.click(); await new Promise(r => setTimeout(r, 30)); });
    expect(calls.removePantry).toHaveLength(2);
    expect(calls.addGrocery).toHaveLength(2);
    expect(calls.addGrocery.every(args => args[7] === true)).toBe(true);
  });
});
