// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import CookMode from "@/components/meals/CookMode";
import { localTodayISO } from "@/lib/local-date";
import { Recipe } from "@/types/meals";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let activeRoot: ReturnType<typeof createRoot> | null = null;

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

function render(ui: ReactElement) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => {
    activeRoot = createRoot(el);
    activeRoot.render(ui);
  });
}

function storageKey(id: number | string) {
  return `cookmode:${id}:${localTodayISO()}`;
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});
afterEach(() => {
  act(() => {
    activeRoot?.unmount();
  });
  activeRoot = null;
  document.body.innerHTML = "";
});

function checkboxFor(body: HTMLElement, labelText: string): HTMLInputElement | null {
  const labels = Array.from(body.querySelectorAll("label"));
  const label = labels.find((l) => l.textContent?.includes(labelText));
  return label?.querySelector("input") ?? null;
}

describe("CookMode", () => {
  it("renders ingredients with parsed quantities and numbered steps", () => {
    render(<CookMode recipe={recipe} onExit={() => {}} />);
    expect(document.body.textContent).toContain("chicken broth");
    expect(document.body.textContent).toContain("2");
    expect(document.body.textContent).toContain("cups");
    expect(document.body.textContent).toContain("Chop the vegetables.");
    expect(document.body.textContent).toContain("Simmer for 20 minutes.");
  });

  it("updates progress when a step is checked", () => {
    render(<CookMode recipe={recipe} onExit={() => {}} />);
    const first = checkboxFor(document.body, "Chop the vegetables.");
    expect(first).not.toBeNull();
    act(() => {
      first!.click();
    });
    expect(document.body.textContent).toContain("1 of 2 steps done");
  });

  it("persists checkbox state to localStorage and restores it on remount", async () => {
    render(<CookMode recipe={recipe} onExit={() => {}} />);
    const first = checkboxFor(document.body, "Chop the vegetables.");
    act(() => {
      first!.click();
    });
    const raw = localStorage.getItem(storageKey(1));
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).s).toEqual([0]);

    act(() => {
      activeRoot!.unmount();
    });
    render(<CookMode recipe={recipe} onExit={() => {}} />);
    expect(document.body.textContent).toContain("1 of 2 steps done");
  });

  it("shows the done card and clears storage when every step is checked", () => {
    render(<CookMode recipe={recipe} onExit={() => {}} />);
    for (const text of ["Chop the vegetables.", "Simmer for 20 minutes."]) {
      act(() => {
        checkboxFor(document.body, text)!.click();
      });
    }
    expect(document.body.textContent).toContain("Enjoy!");
    expect(localStorage.getItem(storageKey(1))).toBeNull();
  });

  it("calls onExit on Escape", () => {
    const onExit = vi.fn();
    render(<CookMode recipe={recipe} onExit={onExit} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("renders the no-steps empty state", () => {
    render(<CookMode recipe={{ ...recipe, ingredients: [], instructions: "" }} onExit={() => {}} />);
    expect(document.body.textContent).toContain("No ingredients saved");
    expect(document.body.textContent).toContain("No steps saved");
    expect(document.body.textContent).toContain("No steps to check");
    expect(document.body.textContent).toContain("Nothing to gather");
  });
});
