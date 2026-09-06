// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

const h = vi.hoisted(() => ({ state: { grocery: [] as any[] } }));

vi.mock("@/db", () => ({
  db: {
    selectGrocery: async () => h.state.grocery.map(r => ({ ...r })),
    upsertGroceryItem: async (item: any) => ({ ...item, id: item.id ?? "pb_1" }),
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

describe("useGrocery cross-device refresh", () => {
  beforeEach(() => {
    h.state.grocery = [];
    localStorage.clear();
    hookResult = null;
  });

  it("merges another device's item when consuela-data-refreshed fires", async () => {
    await mount();
    expect(hookResult.groceryItems).toHaveLength(0);
    // Another device writes directly to the server store:
    h.state.grocery.push({ id: "pb_9", name: "Phone Eggs", category: "dairy", needed: true });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
      await new Promise(r => setTimeout(r, 20));
    });
    expect(hookResult.groceryItems.some((i: any) => i.name === "Phone Eggs")).toBe(true);
  });
});
