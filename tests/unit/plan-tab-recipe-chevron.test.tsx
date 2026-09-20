// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push }),
}));

vi.mock("@/db", () => ({
  db: {
    selectMembers: vi.fn(() => [
      { id: 1, name: "Rebecca", emoji: "👩", color: "violet" },
    ]),
    selectMembersFallback: vi.fn(() => [
      { id: 1, name: "Rebecca", emoji: "👩", color: "violet" },
    ]),
    pantryStore: [],
  },
}));

vi.mock("@/hooks/useAtmosphericTheme", () => ({
  useAtmosphericTheme: () => ({ colors: {}, accentRgb: "99,102,241" }),
}));

import PlanTab from "@/components/meals/PlanTab";

let activeRoot: ReturnType<typeof createRoot> | null = null;

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => {
    activeRoot = createRoot(el);
    activeRoot.render(ui);
  });
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
  h.push.mockClear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })));
});
afterEach(() => {
  act(() => {
    activeRoot?.unmount();
  });
  activeRoot = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const dinner = {
  id: 1,
  name: "Baked Salmon",
  emoji: "🐟",
  time: "Wed",
  mealType: "dinner",
  recipeId: "42",
  prepTime: "30 min",
  tags: [],
  ingredients: ["salmon"],
  servings: 4,
  calories: 500,
  weekOf: "2026-09-14",
};

describe("PlanTab recipe chevron", () => {
  it("navigates to the linked recipe page when the chevron is tapped", async () => {
    const el = render(<PlanTab meals={[dinner]} activeDay="Wed" activeMeals={[dinner]} recipes={[]} />);
    await act(async () => {
      await Promise.resolve();
    });
    const chevron = el.querySelector("button[aria-label='View Baked Salmon recipe']") as HTMLButtonElement;
    expect(chevron).not.toBeNull();
    await act(async () => {
      chevron.click();
    });
    expect(h.push).toHaveBeenCalledWith("/meals/recipes/42?from=plan");
  });

  it("renders no chevron for a meal without a linked recipe", async () => {
    const plain = { ...dinner, recipeId: undefined, name: "Takeout" };
    const el = render(<PlanTab meals={[plain]} activeDay="Wed" activeMeals={[plain]} recipes={[]} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(el.querySelector("button[aria-label='View Takeout recipe']")).toBeNull();
  });
});
