import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * UI audit Phase 4.4 — wall composition per screen. The wall (ApoloSign
 * portrait, 12ft viewing, touch only) must: compose grids through
 * `WALL_GRID_CLASS` (Home) / the md two-column idiom (data screens, via
 * 4.3), keep body copy at ≥16px, floor interactive targets at 44×44, and
 * carry no hover-only affordances. Source-level contract (jsdom has no
 * wall viewport), in the style of nav-items.test.ts.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

describe("wall composition (audit 4.4)", () => {
  it("Home composes through WALL_GRID_CLASS when the wall profile resolves", () => {
    const src = read("src/app/page.tsx");
    expect(src, "the wall grid constant is used").toContain("WALL_GRID_CLASS");
    expect(src, "the resolved wall profile gates the swap").toMatch(
      /wallMounted && wall\s*\n?\s*\?\s*WALL_GRID_CLASS/,
    );
  });

  it("body copy floors at 16px on the wall, smaller utilities at 14px", () => {
    const css = read("src/app", "globals.css");
    expect(css, "text-sm is body copy → 16px").toMatch(
      /html\[data-wall="true"\] \.text-sm \{\s*font-size: 16px;/,
    );
    expect(css, "captions/micro floor at 14px").toMatch(
      /html\[data-wall="true"\] \.text-xs,[\s\S]{0,200}?font-size: 14px;/,
    );
  });

  it("every interactive control floors at 44×44 on the wall", () => {
    const css = read("src/app", "globals.css");
    expect(css).toContain("min-height: 44px");
    expect(css).toContain("min-width: 44px");
    expect(css, "hit-44 keeps expanding tap areas").toContain(".hit-44::before");
    expect(css, "settings keeps its stricter 64px").toContain("min-height: 64px");
  });

  it("the one hover-only action popup is withdrawn on the wall", () => {
    const css = read("src/app", "globals.css");
    expect(css, "group-hover:grid reveals are display:none under data-wall").toMatch(
      /html\[data-wall="true"\] \[class\*="group-hover:grid"\] \{\s*display: none;/,
    );
    const recipe = read("src/components/meals", "RecipeBox.tsx");
    expect(recipe, "the day-picker stays hover-revealed off the wall").toContain(
      "hidden group-hover:grid",
    );
    expect(recipe, "the always-working primary path remains").toContain("＋ Add to");
  });
});
