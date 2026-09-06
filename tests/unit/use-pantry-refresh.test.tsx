// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

const h = vi.hoisted(() => ({ state: { pantry: [] as any[] } }));

vi.mock("@/db", () => ({
  db: {
    selectPantry: async () => h.state.pantry.map(r => ({ ...r })),
    upsertPantryItem: async (item: any) => ({ ...item, id: item.id ?? "pp_1" }),
    deletePantryItem: async () => true,
  },
}));

import { usePantry } from "@/hooks/usePantry";

let hookResult: any;
function Harness() {
  hookResult = usePantry(() => {});
  return null;
}

async function mount() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<Harness />); });
  await act(async () => { await new Promise(r => setTimeout(r, 20)); });
}

describe("usePantry cross-device refresh", () => {
  beforeEach(() => {
    h.state.pantry = [];
    localStorage.clear();
    hookResult = null;
  });

  it("merges another device's item when consuela-data-refreshed fires", async () => {
    await mount();
    expect(hookResult.pantryItems).toHaveLength(0);
    // Another device writes directly to the server store:
    h.state.pantry.push({ id: "pp_9", name: "Phone Flour", status: "plenty" });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
      await new Promise(r => setTimeout(r, 20));
    });
    expect(hookResult.pantryItems.some((i: any) => (i.item || i.name) === "Phone Flour")).toBe(true);
  });
});
