// @vitest-environment jsdom
// The 12px type floor is the project's own rule (AGENTS.md "UI Contracts"). The compact
// StatTile detail and compact DayStrip label used to sit at 10px as "deliberate compact
// choices"; a 2026-09-09 critique ruled the (then 11px) floor wins, and the 2026-09-26 UI
// audit (docs/UI_AUDIT_2026-09.md) measured those labels rendering too small on a phone and
// raised the floor to 12px — rem-based `text-xs`, so Dynamic Type still scales them.
// This test locks the floor so a future compaction pass cannot silently re-break it.
import { describe, it, expect } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import StatTile from "@/components/patterns/StatTile";
import DayStrip from "@/components/patterns/DayStrip";

function render(ui: React.ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

describe("calendar glass refresh (globals.css class contracts)", () => {
  it("month title uses the settle animation class", () => {
    const g = require("fs").readFileSync("src/app/globals.css", "utf8");
    expect(g).toContain("@keyframes calendarMonthSettle");
    expect(g).toContain(".calendar-month-title.is-animating");
  });
  it("strip + selected-day classes exist", () => {
    const g = require("fs").readFileSync("src/app/globals.css", "utf8");
    for (const c of [".calendar-day-strip-wrap", ".calendar-day-strip", ".calendar-strip-day", ".calendar-strip-day.is-selected", ".calendar-strip-day.is-today"]) expect(g).toContain(c);
  });
});

describe("12px type floor on compact patterns", () => {
  it("StatTile compact detail renders at text-xs (12px), never an arbitrary sub-12px size", () => {
    const el = render(<StatTile label="Events" value={3} detail="+2 today" compact />);
    const detail = Array.from(el.querySelectorAll("div")).find((d) => d.textContent === "+2 today")!;
    expect(detail.className).toContain("text-xs");
    expect(detail.className).not.toMatch(/text-\[\d+(?:\.\d+)?px\]/);
  });

  it("DayStrip compact labels render at text-xs (12px), never an arbitrary sub-12px size", () => {
    const el = render(
      <DayStrip
        value="mon"
        onChange={() => {}}
        compact
        days={[
          { id: "mon", label: "MON", detail: "3" },
          { id: "tue", label: "TUE", detail: "1" },
        ]}
      />
    );
    const labels = Array.from(el.querySelectorAll("span")).filter((s) => /^(MON|TUE)$/.test(s.textContent || ""));
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      expect(label.className).toContain("text-xs");
      expect(label.className).not.toMatch(/text-\[\d+(?:\.\d+)?px\]/);
    }
  });
});
