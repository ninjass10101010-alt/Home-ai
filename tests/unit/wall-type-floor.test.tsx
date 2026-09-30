import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(__dirname, "../../src/app/globals.css"), "utf8");

describe("wall CSS contract (globals.css)", () => {
  it("raises the compact type floor to 14px under data-wall", () => {
    expect(css).toMatch(/html\[data-wall="true"\] \.text-\\\[10px\\\]/);
    expect(css).toMatch(/html\[data-wall="true"\] \.text-\\\[11px\\\]/);
    expect(css).toContain("font-size: 14px");
  });

  it("expands hit-44 to ≥56px effective on the wall", () => {
    expect(css).toMatch(/html\[data-wall="true"\] \.hit-44::before/);
    expect(css).toContain("inset: -12px");
  });

  /**
   * The wall profile is size/layout only — any motion must stay under the
   * shared reduced-motion contract. The old check sliced "first wall selector
   * → end of file", which assumed the wall block is the last section in
   * globals.css; the `hwi-*` icon keyframes appended after it are artwork
   * motion already gated by `prefers-reduced-motion`. Inspect each wall rule
   * instead: no `html[data-wall="true"]` declaration may introduce animation of
   * its own. `animation: none` is allowed — suspending motion is the point
   * (that is the wall motion budget).
   */
  it("keeps wall additions inside the reduced-motion block coverage (no new keyframes)", () => {
    expect(css).not.toMatch(/html\[data-wall="true"\][^{]*\{[^}]*@keyframes/);
    const declarations = [...css.matchAll(/html\[data-wall="true"\][^{]*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(declarations.length).toBeGreaterThan(10);
    const introduced = declarations
      .flatMap((decl) => [...decl.matchAll(/(?:^|[;\s])animation(?:-name)?\s*:\s*([^;]+)/g)].map((m) => m[1].trim()))
      .filter((value) => !/^none\b/.test(value) && !/^0s/.test(value));
    expect(introduced).toEqual([]);
  });

  it("scales card numerals and titles per spec §7", () => {
    expect(css).toMatch(/html\[data-wall="true"\] \.display-numeral/);
    expect(css).toMatch(/html\[data-wall="true"\] \.widget-card \.text-sm/);
  });
});
