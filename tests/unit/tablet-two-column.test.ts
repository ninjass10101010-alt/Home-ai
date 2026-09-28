import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * UI audit Phase 4.3 — tablet two-column for Tasks / Meals / Calendar /
 * Settings. The rule: reuse Home's grid idiom (`grid-cols-1 md:grid-cols-2
 * gap-*`, `col-span-*`, `order-*` at `md:`) rather than inventing one-off
 * breakpoints or column templates per screen. These are source-level
 * contracts (jsdom cannot lay out columns) in the style of nav-items.test.ts.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

describe("tablet two-column (audit 4.3)", () => {
  it("the meals tabs converge on the md two-column idiom (no arbitrary lg/xl templates)", () => {
    const tabs = [
      "src/components/meals/PlanTab.tsx",
      "src/components/meals/ShopTab.tsx",
      "src/components/meals/StockTab.tsx",
    ];
    for (const file of tabs) {
      const src = read(...file.split("/"));
      expect(src, `${file} keeps the phone stack first`).toContain("grid-cols-1");
      expect(src, `${file} tiers to two columns at md`).toContain("md:grid-cols-2");
      expect(src, `${file} invents no column templates`).not.toMatch(/(?:lg|xl):grid-cols-\[/);
      expect(src, `${file} uses no xl-only hooks`).not.toContain("xl:");
    }
  });

  it("the recipe catalog drops its xl-only third column", () => {
    expect(read("src/components/meals", "RecipeBox.tsx")).not.toContain("xl:grid-cols-3");
  });

  it("tasks pairs its controls with the active panel and lets PageShell own width", () => {
    const src = read("src/app/tasks/page.tsx");
    expect(src, "two-column at md").toContain("md:grid-cols-2");
    expect(src, "stat row spans both columns above the split").toContain("md:col-span-2");
    expect(src, "PageShell owns the width tiers now").not.toContain("lg:max-w-3xl");
  });

  it("calendar pins the day agenda beside the month grid at md", () => {
    const src = read("src/app/calendar/page.tsx");
    expect(src, "two-column at md").toContain("md:grid-cols-2");
    expect(src, "agenda placed beside the month grid").toContain("md:col-start-2 md:row-start-1");
    expect(src, "the week card flows full-width underneath").toContain("md:col-span-2");
  });

  it("the settings launcher tiers to two columns at or below md", () => {
    const src = read("src/components/settings/SettingsLauncher.tsx");
    expect(src, "single column on phones, two from the sm tier").toMatch(
      /grid-cols-1[^"]*(sm|md):grid-cols-2/,
    );
  });
});
