// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

const h = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push }),
}));

import RecipeBox from "@/components/meals/RecipeBox";

let activeRoot: ReturnType<typeof createRoot> | null = null;

function render(ui: ReactElement) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => {
    activeRoot = createRoot(el);
    activeRoot.render(ui);
  });
  return el;
}

const noop = vi.fn();

const props = {
  recipes: [
    {
      id: 5,
      name: "Taco Night",
      emoji: "🌮",
      prepTime: "20 min",
      tags: ["Quick"],
      ingredients: ["tortillas"],
      instructions: "",
      servings: 4,
      calories: 500,
      createdAt: "2026-09-19T00:00:00.000Z",
    },
  ],
  activeDay: "Mon",
  saveCatalogRecipe: noop,
  deleteCatalogRecipe: noop,
  addRecipeToPlan: noop,
  addRecipeToGrocery: noop,
  startAddRecipe: noop,
  startEditRecipe: noop,
  handleFileUpload: noop,
  openImportModal: noop,
  openSearchModal: noop,
  syncBlocked: false,
};

beforeEach(() => {
  document.body.innerHTML = "";
  h.push.mockClear();
});
afterEach(() => {
  act(() => {
    activeRoot?.unmount();
  });
  activeRoot = null;
  document.body.innerHTML = "";
});

describe("RecipeBox navigation", () => {
  it("navigates to the recipe page when the card body is tapped", () => {
    const el = render(<RecipeBox {...props} />);
    const card = el.querySelector("[role='button'][aria-label='View Taco Night recipe']") as HTMLElement;
    act(() => {
      card.click();
    });
    expect(h.push).toHaveBeenCalledWith("/meals/recipes/5?from=recipes");
  });

  it("supports Enter on the card for keyboard users", () => {
    const el = render(<RecipeBox {...props} />);
    const card = el.querySelector("[role='button'][aria-label='View Taco Night recipe']") as HTMLElement;
    act(() => {
      card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(h.push).toHaveBeenCalledWith("/meals/recipes/5?from=recipes");
  });

  it("supports Space on the card for keyboard users", () => {
    const el = render(<RecipeBox {...props} />);
    const card = el.querySelector("[role='button'][aria-label='View Taco Night recipe']") as HTMLElement;
    act(() => {
      card.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    expect(h.push).toHaveBeenCalledWith("/meals/recipes/5?from=recipes");
  });

  it("does not navigate when the edit action is tapped", () => {
    const el = render(<RecipeBox {...props} />);
    const editBtn = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "✏️") as HTMLButtonElement;
    act(() => {
      editBtn.click();
    });
    expect(h.push).not.toHaveBeenCalled();
  });

  it("does not navigate when add-to-day or grocery is tapped", () => {
    const el = render(<RecipeBox {...props} />);
    const addBtn = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("Add to")) as HTMLButtonElement;
    act(() => {
      addBtn.click();
    });
    const groceryBtn = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "🛒") as HTMLButtonElement;
    act(() => {
      groceryBtn.click();
    });
    expect(h.push).not.toHaveBeenCalled();
  });

  it("does not navigate when Enter is pressed on a focused inner action", () => {
    const el = render(<RecipeBox {...props} />);
    const editBtn = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "✏️") as HTMLButtonElement;
    act(() => {
      editBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(h.push).not.toHaveBeenCalled();
  });
});
