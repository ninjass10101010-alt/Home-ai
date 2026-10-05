// @vitest-environment jsdom
//
// ShopTab surface hierarchy — the three things /grocery got wrong, pinned.
//
// 1. The meal-sync action was a `w-full` primary `SoftButton`: on the 1920 wall a
//    ~600px solid accent bar that made a *tertiary* "pull in ingredients" action
//    the loudest object on the route — the same disease `ConsuelaWeekCard` had on
//    /calendar. Fixed by the lead-in sentence + content-width pill idiom.
// 2. The nine category filters were hand-rolled `<button>`s measuring 30px tall.
//    `.hit-44` is invisible to the class-string scan in
//    `tap-target-contract.test.ts` only because padding-sized controls carry no
//    `h-*` at all, so this suite asserts the mechanism explicitly. The filters now
//    ARE the shared `Chip` primitive, which carries `tap-sm hit-44` itself.
// 3. The empty list renders the shared `EmptyState` primitive, and — the case that
//    used to ship as a BLANK region — it still does when a category filter hides
//    every row.
//
// Why class strings and not `getBoundingClientRect()`: jsdom returns 0×0 for every
// element, so a measured `<44` assertion passes vacuously. Same idiom as contract B
// and the tap-target suite.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import ShopTab from "@/components/meals/ShopTab";
import { groceryCategories } from "@/data/meals";

vi.stubGlobal("matchMedia", (query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
}));

function makeProps(overrides: any = {}) {
  return {
    groceryItems: [
      { id: "g1", name: "Milk", emoji: "🥛", category: "dairy", priority: "medium", needed: true, quantity: "2 lb" },
      { id: "g2", name: "Cereal", emoji: "🥣", category: "pantry", priority: "medium", needed: false },
    ],
    meals: [],
    flowSummary: "",
    activeCategory: "all",
    setActiveCategory: () => {},
    recentlyBought: [],
    addGroceryItem: async () => true,
    toggleGroceryNeeded: async () => {},
    deleteGroceryItem: async () => {},
    updateGroceryItem: async () => {},
    parseManualGroceryInput: (s: string) => ({ name: s, quantity: "" }),
    guessCategory: () => "pantry",
    showToast: () => {},
    pantryItems: [],
    addPantryItem: async () => null,
    removePantryItem: async () => {},
    toggleManualOverride: () => {},
    ...overrides,
  };
}

let reactRoot: Root | null = null;

async function render(props: any) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  reactRoot = createRoot(el);
  await act(async () => { reactRoot!.render(<ShopTab {...props} />); });
  return el;
}

function buttons(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll("button")) as HTMLButtonElement[];
}

function byText(root: HTMLElement, text: string): HTMLButtonElement {
  const found = buttons(root).find((b) => (b.textContent || "").replace(/\s+/g, " ").trim().includes(text));
  if (!found) throw new Error(`No button whose text includes "${text}"`);
  return found;
}

/**
 * Tailwind `bottom-N` → px. `N` is a SPACING step, not rem: one step is 0.25rem,
 * so `bottom-24` is 96px and `bottom-28` is 112px.
 */
function bottomOffsetPx(el: Element): number | null {
  const m = /(?<![\w-])bottom-(\d+(?:\.\d+)?)(?![\w-])/.exec(el.getAttribute("class") || "");
  return m ? Math.round(Number(m[1]) * 4) : null;
}

/** The `.widget-card` that owns `heading` — ShopTab's "Sync and order" card. */
function owningCard(heading: Element): Element {
  const card = heading.closest(".widget-card");
  if (!card) throw new Error("heading is not inside a .widget-card");
  return card;
}

describe("ShopTab category filters carry the 44px hit region", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  afterEach(async () => {
    await act(async () => { reactRoot?.unmount(); });
    reactRoot = null;
    document.body.innerHTML = "";
  });

  it("every category filter — All plus all nine aisles — carries .hit-44", async () => {
    const root = await render(makeProps());
    const filters = [
      byText(root, "All"),
      ...groceryCategories.map((c) => byText(root, c.name)),
    ];
    expect(filters).toHaveLength(groceryCategories.length + 1);
    const missing = filters.filter((b) => !/\bhit-44\b/.test(b.getAttribute("class") || ""));
    expect(missing.map((b) => b.textContent)).toEqual([]);
  });

  it("the filters are the shared Chip primitive, so the selected one is .chip-selected", async () => {
    const root = await render(makeProps({ activeCategory: "dairy" }));
    expect(/\bchip-selected\b/.test(byText(root, "Dairy").getAttribute("class") || "")).toBe(true);
    // The inactive sibling must NOT carry the selected state.
    expect(/\bchip-selected\b/.test(byText(root, "All").getAttribute("class") || "")).toBe(false);
  });

  it("filters stay wrapped, not a scroller — every aisle remains reachable", async () => {
    const root = await render(makeProps());
    const row = byText(root, "All").parentElement!;
    expect(row.className).toMatch(/\bflex-wrap\b/);
    expect(row.className).not.toMatch(/overflow-x-auto/);
  });

  it("the selected chip's accent fill is not shadowed by Chip's own base background", async () => {
    // `Chip`'s base class list carries `bg-[var(--color-surface-0)]/20` and its
    // selected branch adds its own accent fill. Both are Tailwind `bg-*`
    // utilities in ONE layer, so the later rule in the STYLESHEET wins — not the
    // later class in the attribute. Measured in the browser before this fix: the
    // selected filter resolved to `oklab(... / 0.2)` (the translucent surface)
    // while `text-white` DID apply — white ink on a 20%-opacity fill, an AA
    // failure and a selected chip that looked unselected. The base fill has to
    // be ABSENT when selected, not merely overridden. The tone's INK has to go
    // with it: `.widget-accent-text` is unlayered and out-ranks `text-white`.
    //
    // The fill is asserted by SHAPE (accent deepened 60% toward black) rather
    // than by the old `--color-accent-button` token name, because `useTheme`
    // writes that token inline on <html> and it no longer carries a per-theme
    // or per-accent value — see SoftButton.tsx.
    const ACCENT_FILL = /bg-\[color-mix\(in_srgb,var\(--color-accent-selected\)_60%,black\)\]/;
    const root = await render(makeProps({ activeCategory: "dairy" }));
    const chip = byText(root, "Dairy");
    expect(chip.className).toMatch(ACCENT_FILL);
    expect(chip.className).not.toMatch(/bg-\[var\(--color-surface-0\)\]/);
    expect(chip.className).toMatch(/text-white/);
    expect(chip.className).not.toMatch(/widget-accent-text/);
    // And the unselected sibling keeps its surface fill.
    expect(byText(root, "All").className).toMatch(/bg-\[var\(--color-surface-0\)\]/);
    expect(byText(root, "All").className).not.toMatch(ACCENT_FILL);
  });
});

describe("ShopTab has no full-width accent bar on the fold", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  afterEach(async () => {
    await act(async () => { reactRoot?.unmount(); });
    reactRoot = null;
    document.body.innerHTML = "";
  });

  it("'Add missing from meal plan' is content-width, not a w-full accent bar", async () => {
    const root = await render(makeProps());
    const btn = byText(root, "Add missing from meal plan");
    expect(btn.className).not.toMatch(/(?<![\w-])w-full(?![\w-])/);
    // It stays the primary action — just sized by its own label. Asserted by
    // the SHAPE of the primary fill (accent deepened 60% toward black), not by
    // the old `--color-accent-button` token name, which `useTheme` now pins
    // inline to one palette (see SoftButton.tsx).
    expect(btn.className).toMatch(/bg-\[color-mix\(in_srgb,var\(--color-accent-selected\)_60%,black\)\]/);
    expect(btn.className).toMatch(/text-white/);
  });

  it("no control in the Sync and order card is w-full", async () => {
    const root = await render(makeProps());
    const heading = Array.from(root.querySelectorAll("h3")).find((h) => h.textContent === "Sync and order")!;
    const card = owningCard(heading);
    expect(card.querySelectorAll("button").length).toBeGreaterThanOrEqual(3);
    const wide = Array.from(card.querySelectorAll("button"))
      .filter((b) => /(?<![\w-])w-full(?![\w-])/.test(b.getAttribute("class") || ""))
      .map((b) => (b.textContent || "").trim());
    expect(wide).toEqual([]);
  });

  it("the card leads in with a sentence, so the button is not the only content", async () => {
    const root = await render(makeProps());
    const heading = Array.from(root.querySelectorAll("h3")).find((h) => h.textContent === "Sync and order")!;
    const card = owningCard(heading);
    // The card's own copy, minus the button labels — a lead-in sentence has to be
    // prose, not a restatement of the actions below it.
    const prose = Array.from(card.querySelectorAll("p"))
      .map((p) => (p.textContent || "").trim())
      .filter((t) => t.length > 0);
    expect(prose.length).toBeGreaterThan(0);
    expect(prose.join(" ")).toMatch(/meal plan/i);
  });
});

describe("ShopTab empty states converge on the shared EmptyState primitive", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  afterEach(async () => {
    await act(async () => { reactRoot?.unmount(); });
    reactRoot = null;
    document.body.innerHTML = "";
  });

  it("an empty list renders [data-empty-state], not a hand-rolled dashed box", async () => {
    const root = await render(makeProps({ groceryItems: [] }));
    expect(root.querySelector("[data-empty-state]")).toBeTruthy();
    expect(root.querySelector("[data-empty-state]")!.textContent).toContain("Nothing on your list");
  });

  it("a category filter that hides every row still renders a state — this used to be blank", async () => {
    const root = await render(makeProps({ activeCategory: "frozen" }));
    const state = root.querySelector("[data-empty-state]")!;
    expect(state).toBeTruthy();
    expect(state.textContent).toMatch(/frozen/i);
  });

  it("that filtered state offers a way back to the whole list", async () => {
    const seen: string[] = [];
    const root = await render(makeProps({ activeCategory: "frozen", setActiveCategory: (c: string) => seen.push(c) }));
    const back = root.querySelector<HTMLButtonElement>("[data-empty-state] button");
    expect(back).toBeTruthy();
    await act(async () => { back!.click(); });
    expect(seen).toEqual(["all"]);
  });

  it("a list with rows shows no empty state at all", async () => {
    const root = await render(makeProps());
    expect(root.querySelector("[data-empty-state]")).toBeFalsy();
  });
});

describe("ShopTab mobile bulk bar clears the floating Ask-Clem button", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  afterEach(async () => {
    await act(async () => { reactRoot?.unmount(); });
    reactRoot = null;
    document.body.innerHTML = "";
  });

  it("the sticky bar sits above ClemAssistant's fixed bottom-24 + 56px FAB", async () => {
    // g2 is checked off, so checkedCount > 0 and the sticky bar renders.
    const root = await render(makeProps());
    const sticky = Array.from(root.querySelectorAll(".sticky")).find((el) => bottomOffsetPx(el) !== null)!;
    expect(sticky).toBeTruthy();
    // FAB: `fixed bottom-24` (96px) with `h-14` (56px) → occupies 96..152px.
    // z-40 over z-30, so anything below 152px underneath it is untappable.
    expect(bottomOffsetPx(sticky)!).toBeGreaterThanOrEqual(152);
  });
});