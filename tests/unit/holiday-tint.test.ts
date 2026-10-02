// @vitest-environment jsdom
//
// Task 3 holiday glaze — source-pin + selector-contract tests. jsdom cannot
// compute color-mix(), so the real assertions read globals.css directly (the
// repo precedent is weather-widget.test.tsx reading the same file). The DOM
// block only proves the shipped components satisfy the [data-holiday]
// descendant selectors the CSS relies on, and that a non-holiday render can
// never match them (HomeShell sets data-holiday and the --holiday-* vars
// together, or not at all).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import WidgetCard from "@/components/patterns/WidgetCard";
import SectionCard from "@/components/patterns/SectionCard";
import StatTile from "@/components/patterns/StatTile";
import HomeWidgetIcon from "@/components/ui/HomeWidgetIcon";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const lines = css.split("\n");

describe("holiday tint rules (globals.css)", () => {
  it("glazes .widget-card only under [data-holiday]", () => {
    expect(css).toContain("[data-holiday] .widget-card");
    expect(css).toContain("color-mix(in srgb, var(--holiday-accent) 14%");
  });

  it("shifts the widget-icon accent only under [data-holiday]", () => {
    expect(css).toContain("[data-holiday] .home-widget-icon");
    expect(css).toContain("color-mix(in srgb, var(--holiday-accent) 22%");
  });

  it("never consumes a --holiday-* var outside a [data-holiday]-scoped selector", () => {
    const consumers = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => line.includes("var(--holiday-"));
    // The glaze rules must exist for this contract to mean anything.
    expect(consumers.length).toBeGreaterThan(0);
    // globals.css never declares the --holiday-* vars themselves — HomeShell
    // injects them inline on the PageShell root, always with data-holiday.
    // (Declaration shape only: prose comments may mention the var names.)
    expect(css).not.toMatch(/^\s*--holiday-[a-z-]+\s*:/m);
    for (const { i } of consumers) {
      // Walk up to the declaration block's opening brace, then back up
      // through comma continuations to the full selector group.
      let open = i;
      while (open >= 0 && !lines[open].includes("{")) open--;
      expect(open, `consumer on line ${i + 1} sits inside a CSS block`).toBeGreaterThanOrEqual(0);
      let first = open;
      while (first - 1 >= 0 && lines[first - 1].trim().endsWith(",")) first--;
      const selectorGroup = lines.slice(first, open + 1).join(" ");
      expect(
        selectorGroup.includes("[data-holiday]"),
        `line ${i + 1} is governed by an unguarded selector: ${selectorGroup.trim()}`
      ).toBe(true);
    }
  });
});

describe("holiday tint selector contract (DOM)", () => {
  it("every Home card class satisfies the [data-holiday] descendant selectors", () => {
    const html = renderToString(
      createElement(
        "div",
        { "data-holiday": "christmas" },
        createElement(WidgetCard, { tone: "#3b82f6", children: "x" }),
        createElement(SectionCard, { title: "S", children: "x" }),
        createElement(StatTile, { label: "T", value: "3" }),
        createElement(HomeWidgetIcon, { variant: "briefing" })
      )
    );
    const el = document.createElement("div");
    el.innerHTML = html;
    expect(el.querySelector("[data-holiday] .widget-card")).not.toBeNull();
    expect(el.querySelector("[data-holiday] .home-widget-icon")).not.toBeNull();
  });

  it("non-holiday: no data-holiday attribute or --holiday var in the render, so no tint rule can match", () => {
    const html = renderToString(createElement(WidgetCard, { tone: "#3b82f6", children: "x" }));
    expect(html).not.toContain("data-holiday");
    expect(html).not.toContain("--holiday");
  });
});
