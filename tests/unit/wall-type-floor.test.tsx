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

  it("keeps wall additions inside the reduced-motion block coverage (no new keyframes)", () => {
    const wallBlock = css.slice(css.indexOf('html[data-wall="true"]'));
    expect(wallBlock).not.toMatch(/@keyframes/);
  });

  it("scales card numerals and titles per spec §7", () => {
    expect(css).toMatch(/html\[data-wall="true"\] \.display-numeral/);
    expect(css).toMatch(/html\[data-wall="true"\] \.widget-card \.text-sm/);
  });
});
