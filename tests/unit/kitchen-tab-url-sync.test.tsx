// @vitest-environment jsdom
//
// The Kitchen's URL is part of its contract: `/grocery` redirects to
// `/meals?tab=grocery`, Home's "This Week" strip links to `/meals?day=<weekday>`,
// and `/meals/archive` is reached from the Plan tab. Two P1s lived in the gap
// between what the URL said and what the screen did:
//
//   - `?tab=` was READ but never WRITTEN. `/grocery → /meals?tab=grocery` landed on
//     Shop; tapping "Plan" changed the screen but left `?tab=grocery` in the URL,
//     so a reload or a Back snapped the family to Shop.
//   - `?day=` was LINKED from Home but read by nothing, so tapping a day in "This
//     Week" navigated to Meals with no visible change — a dead interaction.
//
// This suite renders the real `src/app/meals/page.tsx` (with the data hooks
// stubbed) and pins that tab state and URL agree in BOTH directions, that `day`
// selects the day it names, and that `/meals/archive` has a real inbound link.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({
  search: "tab=plan",
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => "/meals",
}));

// The shell is covered by route-shell-contract; stubbing it keeps this suite on
// the tab/day wiring instead of the dock.
vi.mock("@/components/ui/PageShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="shell">{children}</div>,
}));

const mealsState = vi.hoisted(() => ({ initialDay: "Mon" }));

vi.mock("@/hooks/useMeals", async () => {
  // Real `useState` in the stub: the page wires `setActiveDay` through to the
  // URL, so the day must actually re-render the way the real hook's does.
  const { useState } = await import("react");
  return {
    useMeals: () => {
      const [activeDay, setActiveDay] = useState(mealsState.initialDay);
      return {
        meals: [],
        setMeals: vi.fn(),
        syncBlocked: false,
        activeDay,
        setActiveDay,
        activeWeek: "2026-09-14",
        setActiveWeek: vi.fn(),
        activeMeals: [],
        saveMeal: vi.fn(),
        deleteMeal: vi.fn(),
        aiMealIdeas: [],
        aiMealLoading: false,
        aiMealError: null,
        showAiSuggestions: vi.fn(),
        generateAiMeals: vi.fn(),
        generateWeeklyPlan: vi.fn(),
        weeklyPlanLoading: false,
        weeklyPlanError: null,
        goToWeek: vi.fn(),
        archiveCurrentWeek: vi.fn(),
        isCurrentWeek: true,
      };
    },
    mealCreateWrite: vi.fn(),
    mealUpdateWrite: vi.fn(),
  };
});

vi.mock("@/hooks/useGrocery", () => ({
  useGrocery: () => ({
    groceryItems: [],
    activeCategory: "produce",
    setActiveCategory: vi.fn(),
    setGroceryItems: vi.fn(),
    addGroceryItem: vi.fn(),
    toggleGroceryNeeded: vi.fn(),
    deleteGroceryItem: vi.fn(),
    updateGroceryItem: vi.fn(),
    recentlyBought: [],
    parseManualGroceryInput: vi.fn(),
    guessCategory: () => "produce",
    toggleManualOverride: vi.fn(),
  }),
}));

vi.mock("@/hooks/usePantry", () => ({
  usePantry: () => ({
    pantryItems: [],
    addPantryItem: vi.fn(),
    updatePantryStatus: vi.fn(),
    removePantryItem: vi.fn(),
  }),
}));

vi.mock("@/hooks/useRecipes", () => ({
  useRecipes: () => ({
    recipes: [],
    saveCatalogRecipe: vi.fn(),
    deleteCatalogRecipe: vi.fn(),
    handleFileUpload: vi.fn(),
    syncBlocked: false,
  }),
}));

vi.mock("@/services/mealSync", () => ({
  mealSyncService: { previewMealPlanToGrocery: () => ({ items: [] }) },
}));

vi.mock("@/db", () => ({ db: {} }));

// The three panels only need to announce which one is mounted; their internals
// have their own suites. The PlanTab stub keeps one real control so the
// `setActiveDay` wrapper this page hands it can be driven.
vi.mock("@/components/meals/PlanTab", () => ({
  default: ({ activeDay, setActiveDay }: { activeDay: string; setActiveDay: (d: string) => void }) => (
    <div data-testid="plan-tab" data-active-day={activeDay}>
      <button type="button" onClick={() => setActiveDay("Thu")}>
        pick Thursday
      </button>
    </div>
  ),
}));
vi.mock("@/components/meals/ShopTab", () => ({ default: () => <div data-testid="shop-tab" /> }));
vi.mock("@/components/meals/StockTab", () => ({ default: () => <div data-testid="stock-tab" /> }));
vi.mock("@/components/meals/CookWithWhatYouHave", () => ({ default: () => null }));

import MealsHubPage from "@/app/meals/page";

let root: Root | null = null;

function render(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => {
    root = createRoot(el);
    root.render(<MealsHubPage />);
  });
  return el;
}

/** The `aria-checked` radio button whose label contains `fragment`. */
function tabButton(el: HTMLElement, fragment: string): HTMLButtonElement {
  const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  const match = buttons.find((b) => b.textContent?.includes(fragment));
  if (!match) throw new Error(`no Kitchen tab labelled ${fragment}`);
  return match;
}

function selectedTab(el: HTMLElement): string {
  const checked = el.querySelector('[role="radio"][aria-checked="true"]');
  return checked?.textContent?.trim() ?? "";
}

beforeEach(() => {
  document.body.innerHTML = "";
  nav.search = "tab=plan";
  nav.replace.mockClear();
  nav.push.mockClear();
  mealsState.initialDay = "Mon";
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
});

describe("Kitchen tab state and the ?tab= param agree", () => {
  it("opens on the tab the URL names, including the /grocery redirect's legacy value", () => {
    nav.search = "tab=grocery";
    const el = render();
    expect(selectedTab(el)).toContain("Shop");
    expect(el.querySelector('[data-testid="shop-tab"]')).toBeTruthy();
  });

  it("writes the new tab back to the URL when a tab is tapped", () => {
    nav.search = "tab=grocery";
    const el = render();

    act(() => {
      tabButton(el, "Plan").click();
    });

    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(String(nav.replace.mock.calls[0][0])).toContain("tab=plan");
    expect(selectedTab(el)).toContain("Plan");
  });

  it("replaces rather than pushes, so Back leaves the screen instead of re-entering a tab", () => {
    const el = render();
    act(() => {
      tabButton(el, "Stock").click();
    });
    expect(nav.push).not.toHaveBeenCalled();
    expect(nav.replace).toHaveBeenCalledTimes(1);
  });

  it("does not rewrite the URL when the tapped tab is already active", () => {
    const el = render();
    act(() => {
      tabButton(el, "Plan").click();
    });
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("follows the URL when the tab param changes underneath it (Back, deep link, share)", () => {
    const el = render();
    expect(selectedTab(el)).toContain("Plan");

    nav.search = "tab=shop";
    act(() => {
      root!.render(<MealsHubPage />);
    });

    expect(selectedTab(el)).toContain("Shop");
    expect(el.querySelector('[data-testid="shop-tab"]')).toBeTruthy();
  });

  it("keeps the ?day= param when it rewrites ?tab=, and vice versa", () => {
    nav.search = "tab=shop&day=Fri";
    const el = render();

    act(() => {
      tabButton(el, "Plan").click();
    });

    const written = String(nav.replace.mock.calls[0][0]);
    expect(written).toContain("tab=plan");
    expect(written).toContain("day=Fri");
  });
});

describe("the ?day= deep link from Home's This Week strip is honoured", () => {
  it("selects the named weekday in the Plan tab", () => {
    nav.search = "day=Sat";
    const el = render();
    const plan = el.querySelector('[data-testid="plan-tab"]');
    expect(plan?.getAttribute("data-active-day")).toBe("Sat");
  });

  it("switches to the Plan tab so the day is actually visible", () => {
    nav.search = "tab=stock&day=Sat";
    const el = render();
    expect(selectedTab(el)).toContain("Plan");
    expect(el.querySelector('[data-testid="plan-tab"]')?.getAttribute("data-active-day")).toBe("Sat");
  });

  it("ignores a day it cannot map rather than selecting nothing", () => {
    nav.search = "day=notaday";
    const el = render();
    expect(el.querySelector('[data-testid="plan-tab"]')?.getAttribute("data-active-day")).toBe("Mon");
  });

  it("writes the day back to the URL so a reload does not snap back", () => {
    const el = render();
    const pick = el.querySelector<HTMLButtonElement>('[data-testid="plan-tab"] button');
    expect(pick).toBeTruthy();

    act(() => {
      pick!.click();
    });

    expect(el.querySelector('[data-testid="plan-tab"]')?.getAttribute("data-active-day")).toBe("Thu");
    const written = nav.replace.mock.calls.map((call) => String(call[0])).join(" ");
    expect(written).toContain("day=Thu");
  });
});

describe("/meals/archive has a real entry point", () => {
  it("links to the archive from the Meals page", () => {
    const el = render();
    const link = el.querySelector<HTMLAnchorElement>('a[href="/meals/archive"]');
    expect(link, "the week-restore screen must be reachable from Meals").toBeTruthy();
    expect(link!.textContent?.trim()).toBeTruthy();
  });

  it("shows that link on the Plan tab, where archiving happens", () => {
    const el = render();
    expect(el.querySelector('a[href="/meals/archive"]')).toBeTruthy();

    act(() => {
      tabButton(el, "Shop").click();
    });
    expect(el.querySelector('a[href="/meals/archive"]')).toBeNull();
  });
});