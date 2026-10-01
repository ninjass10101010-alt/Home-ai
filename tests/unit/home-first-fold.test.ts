import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALL_WIDGETS,
  DEFAULT_LAYOUT,
  FIRST_FOLD_WIDGETS,
  PHONE_WIDGET_FOLD,
  WIDGET_TIERS,
} from "@/lib/layout-config";

/**
 * UI audit Phase 4.5 — Home depth: 3,859px of default content at 390px
 * (~9.9 screens). The fix: rank what earns the first fold, render only that
 * fold on stacked layouts, and fold the rest behind Home's More… sheet.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const phone = DEFAULT_LAYOUT.phone.widgets;

describe("home first-fold ranking (audit 4.5)", () => {
  it("FIRST_FOLD is the ranked prefix of the phone default order", () => {
    expect(phone.slice(0, FIRST_FOLD_WIDGETS.length)).toEqual(FIRST_FOLD_WIDGETS);
  });

  it("every ranked id is a real widget", () => {
    const ids = new Set(ALL_WIDGETS.map((w) => w.id));
    for (const id of FIRST_FOLD_WIDGETS) expect(ids.has(id), `${id} must exist`).toBe(true);
  });

  it("the fold renders exactly the ranked first fold", () => {
    expect(PHONE_WIDGET_FOLD).toBe(FIRST_FOLD_WIDGETS.length);
  });

  it("tablet (the wall) fills exactly its 12 grid cells — no 5th row, no page overflow", () => {
    const { widgets, hidden } = DEFAULT_LAYOUT.tablet;
    const visible = widgets.filter((id) => !hidden.includes(id));
    // Measured on the panel: 3 columns × 4 rows. Anything past 12 cells forces a
    // 5th row and ~118px of overflow on a surface that must not scroll.
    const cells = visible.reduce(
      (total, id) => total + (WIDGET_TIERS[id].tablet.includes("row-span-2") ? 2 : 1),
      0,
    );
    expect(visible).toContain("photos");
    expect(cells).toBe(12);
  });

  it("photos is a display surface, so it does not displace a phone's actionable first fold", () => {
    expect(FIRST_FOLD_WIDGETS).not.toContain("photos");
    expect(phone.indexOf("photos")).toBe(FIRST_FOLD_WIDGETS.length);
  });

  it("home folds behind the More… sheet on stacked layouts and budgets motion", () => {
    const src = read("src/app", "page.tsx");
    expect(src, "fold constant gates the rendered slice").toContain("PHONE_WIDGET_FOLD");
    expect(src, "the grid maps the folded slice").toMatch(/renderedWidgets\.map\(/);
    expect(src, "the sheet receives the fold action").toContain("extraItems");
    expect(src, "ambient motion runs through the budget").toContain("AnimationBudgetProvider");
    expect(src, "the wall and desktop keep every widget").toMatch(/!wall && layoutMounted && orientation !== "desktop"/);
  });
});
