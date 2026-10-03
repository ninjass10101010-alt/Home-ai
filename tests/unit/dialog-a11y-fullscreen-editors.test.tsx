// @vitest-environment jsdom
// P1: the full-screen recipe/cook editors were `aria-modal` in name only. The
// recipe editor had a bare Escape listener but no focus trap and no focus
// return; cook mode had neither the trap nor the return.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, type ReactNode } from "react";
import type { Recipe } from "@/types/meals";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.stubGlobal("matchMedia", (query: string) => ({
  matches: true,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

import CookMode from "@/components/meals/CookMode";
import RecipeModal from "@/components/meals/RecipeModal";

const recipe: Recipe = {
  id: 1,
  name: "Test Soup",
  emoji: "🍲",
  prepTime: "10 min",
  tags: [],
  ingredients: ["2 cups chicken broth", "salt"],
  instructions: "Chop the vegetables.\nSimmer for 20 minutes.",
  servings: 4,
  calories: 300,
  createdAt: "2026-09-19T00:00:00.000Z",
};

let root: Root | null = null;
let show: (open: boolean) => void = () => {};

function Page({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <>
      <main>
        <button id="trigger">open</button>
        <p id="page-copy">week plan behind the editor</p>
      </main>
      {open ? children : null}
    </>
  );
}

function renderPage(children: ReactNode): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  show = (open) => { act(() => { root!.render(<Page open={open}>{children}</Page>); }); };
  show(false);
  return document.getElementById("trigger") as HTMLButtonElement;
}

async function openVia(trigger: HTMLElement) {
  trigger.focus();
  expect(document.activeElement).toBe(trigger);
  await act(async () => { show(true); });
}

async function close() {
  await act(async () => { show(false); });
}

async function pressKey(key: string, shiftKey = false) {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true }));
  });
}

function dialog(): HTMLElement | null {
  return document.querySelector('[role="dialog"]');
}

function focusables(): HTMLElement[] {
  const panel = dialog()!;
  return Array.from(
    panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
  ).filter((el) => !el.matches(":disabled"));
}

async function assertTrapCyclesWithin() {
  const items = focusables();
  expect(items.length).toBeGreaterThan(1);
  const first = items[0];
  const last = items[items.length - 1];

  last.focus();
  await pressKey("Tab");
  expect(document.activeElement).toBe(first);

  first.focus();
  await pressKey("Tab", true);
  expect(document.activeElement).toBe(last);
  expect(dialog()!.contains(document.activeElement)).toBe(true);
}

beforeEach(() => { show = () => {}; });

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  document.body.innerHTML = "";
});

describe("CookMode — shared dialog a11y", () => {
  const ui = (onExit: () => void) => <CookMode recipe={recipe} onExit={onExit} />;

  it("moves focus into the editor on open", async () => {
    const onExit = vi.fn();
    const trigger = renderPage(ui(onExit));
    await openVia(trigger);
    expect(dialog()!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement!.getAttribute("aria-label")).toBe("Exit cook mode");
  });

  it("keeps Tab and Shift+Tab inside the editor", async () => {
    const onExit = vi.fn();
    const trigger = renderPage(ui(onExit));
    await openVia(trigger);
    await assertTrapCyclesWithin();
  });

  it("makes the page behind inert while cook mode is up", async () => {
    const onExit = vi.fn();
    const trigger = renderPage(ui(onExit));
    await openVia(trigger);
    // The editors portal to <body>, so the inert root is the app container.
    expect(document.querySelector("main")!.closest("[inert]")).not.toBeNull();
    expect(document.querySelector("main")!.getAttribute("aria-hidden")).toBeNull();
    expect(dialog()!.closest("[inert]")).toBeNull();
  });

  it("exits on Escape", async () => {
    const onExit = vi.fn();
    const trigger = renderPage(ui(onExit));
    await openVia(trigger);
    await pressKey("Escape");
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the trigger when cook mode exits", async () => {
    const onExit = vi.fn();
    const trigger = renderPage(ui(onExit));
    await openVia(trigger);
    expect(document.activeElement).not.toBe(trigger);
    await close();
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelector("main")!.hasAttribute("inert")).toBe(false);
  });

  it("keeps its ≥44px tap targets", async () => {
    const onExit = vi.fn();
    const trigger = renderPage(ui(onExit));
    await openVia(trigger);
    expect(focusables().every((el) => el.className.includes("min-h-[44px]") || el.tagName === "INPUT")).toBe(true);
  });
});

describe("RecipeModal — shared dialog a11y", () => {
  function recipeUi(open: boolean) {
    return (
      <RecipeModal
        recipe={{ name: "Soup", emoji: "🍲", time: "Mon", mealType: "dinner", servings: 4, ingredients: ["salt"], tags: [], instructions: "Stir", calories: 1, protein: 1, carbs: 1, fat: 1 }}
        setRecipe={() => {}}
        editingMealId={null}
        saveRecipe={() => {}}
        setShowRecipeModal={open}
        mode="catalog"
      />
    );
  }

  it("moves focus into the editor on open", async () => {
    const trigger = renderPage(recipeUi(true));
    await openVia(trigger);
    expect(dialog()!.contains(document.activeElement)).toBe(true);
    expect((document.activeElement as HTMLElement).tagName).toBe("BUTTON");
  });

  it("keeps Tab and Shift+Tab inside the editor", async () => {
    const trigger = renderPage(recipeUi(true));
    await openVia(trigger);
    await assertTrapCyclesWithin();
  });

  it("makes the page behind inert while the editor is up", async () => {
    const trigger = renderPage(recipeUi(true));
    await openVia(trigger);
    // The editors portal to <body>, so the inert root is the app container.
    expect(document.querySelector("main")!.closest("[inert]")).not.toBeNull();
    expect(document.querySelector("main")!.getAttribute("aria-hidden")).toBeNull();
    expect(dialog()!.closest("[inert]")).toBeNull();
  });

  it("still closes on Escape (audit 5.4 behaviour preserved)", async () => {
    const onClose = vi.fn();
    const ui = (
      <RecipeModal
        recipe={{ name: "Soup", emoji: "🍲", time: "Mon", mealType: "dinner", servings: 4, ingredients: ["salt"], tags: [], instructions: "Stir" }}
        setRecipe={() => {}}
        editingMealId={null}
        saveRecipe={() => {}}
        setShowRecipeModal={onClose}
        mode="catalog"
      />
    );
    const trigger = renderPage(ui);
    await openVia(trigger);
    await pressKey("Escape");
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it("returns focus to the trigger on close", async () => {
    const trigger = renderPage(recipeUi(true));
    await openVia(trigger);
    expect(document.activeElement).not.toBe(trigger);
    await close();
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelector("main")!.hasAttribute("inert")).toBe(false);
  });

  it("keeps the 44px hit target on its close control", async () => {
    const trigger = renderPage(recipeUi(true));
    await openVia(trigger);
    const closeButton = dialog()!.querySelector('button[aria-label="Close"]') as HTMLElement;
    expect(closeButton.className).toContain("hit-44");
  });
});