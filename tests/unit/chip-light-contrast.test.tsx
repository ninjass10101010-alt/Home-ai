// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import Chip from "@/components/ui/Chip";

function renderChip(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el.querySelector("button") as HTMLElement;
}

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

describe("Chip light-mode AA contrast (deepened tone text)", () => {
  it("success chip carries the chip-tone-success hook", () => {
    const chip = renderChip(<Chip tone="success">Done</Chip>);
    expect(chip.className).toContain("chip-tone-success");
  });

  it("warning chip carries the chip-tone-warning hook", () => {
    const chip = renderChip(<Chip tone="warning">Soon</Chip>);
    expect(chip.className).toContain("chip-tone-warning");
  });

  it("danger chip carries the chip-tone-danger hook", () => {
    const chip = renderChip(<Chip tone="danger">Alert</Chip>);
    expect(chip.className).toContain("chip-tone-danger");
  });

  it("selected chips opt out of the deepened tone (white text on accent fill)", () => {
    const chip = renderChip(<Chip tone="success" selected>Done</Chip>);
    expect(chip.className).toContain("chip-selected");
  });

  it("globals.css deepens success chip text to mint 72% black (widget-accent precedent)", () => {
    const rule = css.match(/[^{}]*\.chip-tone-success[^{]*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("color-mix(in srgb, var(--color-accent-mint) 72%, black)");
  });

  it("globals.css deepens warning chip text to amber 72% black", () => {
    const rule = css.match(/[^{}]*\.chip-tone-warning[^{]*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("color-mix(in srgb, var(--color-accent-amber) 72%, black)");
  });

  it("globals.css deepens danger chip text to rose 72% black", () => {
    const rule = css.match(/[^{}]*\.chip-tone-danger[^{]*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("color-mix(in srgb, var(--color-accent-rose) 72%, black)");
  });

  it("deepening rules are light-scoped only — dark theme stays byte-identical", () => {
    const blocks = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1].includes(".chip-tone-"));
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    for (const [, selector] of blocks) {
      expect(selector).toMatch(/:root\[data-theme="light"\]|:root:not\(\[data-theme="dark"\]\)/);
    }
  });

  it("deepening excludes the selected state so white-on-accent stays intact", () => {
    const blocks = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1].includes(".chip-tone-"));
    for (const [, selector] of blocks) {
      expect(selector).toContain(":not(.chip-selected)");
    }
  });
});
