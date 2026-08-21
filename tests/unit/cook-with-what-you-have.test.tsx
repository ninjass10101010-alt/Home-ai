// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import CookWithWhatYouHave from "@/components/meals/CookWithWhatYouHave";
import type { Recipe, PantryItem } from "@/types/meals";

const recipes: Recipe[] = [
  { id: 1, name: "Pasta", emoji: "🍝", prepTime: "20 min", tags: [], ingredients: ["Pasta", "Tomato sauce", "Parmesan"], instructions: "", servings: 4, calories: 400, createdAt: "" },
  { id: 2, name: "Salad", emoji: "🥗", prepTime: "10 min", tags: [], ingredients: ["Lettuce", "Tomato"], instructions: "", servings: 2, calories: 150, createdAt: "" },
];
const pantry: PantryItem[] = [
  { id: "p1", item: "Pasta", status: "plenty" },
  { id: "p2", item: "Tomato sauce", status: "plenty" },
  { id: "p3", item: "Lettuce", status: "plenty" },
  { id: "p4", item: "Tomato", status: "plenty" },
];

async function render(props: any) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<CookWithWhatYouHave {...props} />); });
  return el;
}

describe("CookWithWhatYouHave", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("ranks recipes by readiness and shows percentages", async () => {
    const root = await render({ recipes, pantryItems: pantry, onAddMissing: () => {} });
    const text = root.textContent || "";
    expect(text).toContain("Salad");
    expect(text).toContain("100%");
    expect(text).toContain("Pasta");
    expect(text).toContain("67%");
  });

  it("lists missing ingredients for partial matches", async () => {
    const root = await render({ recipes, pantryItems: pantry, onAddMissing: () => {} });
    expect(root.textContent).toContain("Parmesan");
  });

  it("fires onAddMissing with the missing ingredient names", async () => {
    const onAddMissing = vi.fn();
    const root = await render({ recipes, pantryItems: pantry, onAddMissing });
    const btn = Array.from(root.querySelectorAll("button")).find(b => /Add missing/i.test(b.textContent || ""));
    expect(btn).toBeTruthy();
    await act(async () => { (btn as HTMLButtonElement).click(); });
    expect(onAddMissing).toHaveBeenCalledWith(["Parmesan"]);
  });

  it("renders an empty state when no recipes have ingredients", async () => {
    const root = await render({ recipes: [], pantryItems: pantry, onAddMissing: () => {} });
    expect(root.textContent).toMatch(/no recipes/i);
  });
});
