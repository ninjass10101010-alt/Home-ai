// @vitest-environment jsdom
// Task 9 — the Add/Edit sheet's due control: preset chips + a calendar popover.
//
// The 31-item native `<select>` is replaced by a picker whose presets are the
// same local-day `getISO.*` getters the board uses (Today / Tomorrow / Fri /
// Next week), plus a Monday-first month grid for any other day. All day math is
// local-day, noon-anchored (see `due-date-utils` / `local-date`), so selecting
// day 15 of the current month yields that local calendar day — never a UTC
// neighbour.
//
// Harness: no @testing-library/react in this repo — createRoot + act, clicking
// via `.click()`. The calendar is a house `Modal`, which portals to
// `document.body`, so queries read from there. A day cell SPEAKS a human date
// ("Mon, Oct 5", plus the year only for the out-of-month spill) and carries its
// local ISO on `data-date`, which is the query hook here: the announced name is
// for the family, the attribute is for the tests.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import DueDatePicker from "@/components/tasks/DueDatePicker";
import { getISO, getMonthGrid, monthLabel } from "@/lib/due-date-utils";
import { localTodayISO } from "@/lib/local-date";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// The shared Modal's exit phase reads matchMedia (reduced-motion check) —
// absent in jsdom (same stub idiom as shop-tab-mobile-actions.test.tsx).
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
}));

async function settle(ms = 200) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

function click(el: Element) {
  act(() => {
    (el as HTMLElement).click();
  });
}

function buttonByText(text: string): HTMLButtonElement {
  const el = Array.from(document.body.querySelectorAll("button")).find(
    (b) => (b.textContent || "").trim() === text
  );
  expect(el, `button "${text}"`).toBeTruthy();
  return el as HTMLButtonElement;
}

/** The trigger's accessible name carries the value, so match by prefix. */
function clickByLabelPrefix(prefix: string) {
  const el = document.body.querySelector(`[aria-label^="${prefix}"]`);
  expect(el, `control starting with "${prefix}"`).toBeTruthy();
  click(el!);
}

/** Tap one calendar day: the name is spoken as a human date, `data-date` is the hook. */
function clickDay(iso: string) {
  click(cellByDate(iso));
}

/** The value's visible/announced form, same options as the picker. */
function expectedValueLabel(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** The calendar day cells, identified by their machine-readable `data-date`. */
function dayCells(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>("button[data-date]"));
}

/** One day cell by its local ISO. */
function cellByDate(iso: string): HTMLButtonElement {
  const el = document.body.querySelector<HTMLButtonElement>(`button[data-date="${iso}"]`);
  expect(el, `day cell ${iso}`).toBeTruthy();
  return el!;
}

/**
 * Monday-first weeks a month actually needs. `getMonthGrid` always returns 42
 * cells, so the component trims the pad to this — the count under test is
 * derived here from the calendar rather than pinned to a constant, so the
 * assertion survives whichever month the suite happens to run in.
 */
function weeksNeeded(year: number, monthIndex: number): number {
  const leading = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const days = new Date(year, monthIndex + 1, 0).getDate();
  return Math.ceil((leading + days) / 7);
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("DueDatePicker", () => {
  it("1. renders the presets and clicking Today calls onChange with getISO.today", () => {
    const onChange = vi.fn();
    render(<DueDatePicker value={getISO.today} onChange={onChange} />);

    for (const preset of ["Today", "Tomorrow", "Fri", "Next week"]) {
      expect(buttonByText(preset), `${preset} preset`).toBeTruthy();
    }

    click(buttonByText("Today"));
    expect(onChange).toHaveBeenCalledWith(getISO.today);
  });

  it("2. the calendar shows the current month and day 15 returns that local calendar day", async () => {
    const onChange = vi.fn();
    const today = getISO.today;
    render(<DueDatePicker value={today} onChange={onChange} />);

    // WCAG 2.5.3: the accessible name contains the visible value.
    const trigger = document.body.querySelector(`[aria-label^="Choose due date"]`);
    expect(trigger?.getAttribute("aria-label")).toContain(expectedValueLabel(today));

    clickByLabelPrefix("Choose due date");
    const now = new Date();
    expect(document.body.textContent).toContain(monthLabel(now.getFullYear(), now.getMonth()));

    const expected = localTodayISO(new Date(now.getFullYear(), now.getMonth(), 15));
    clickDay(expected);
    expect(onChange).toHaveBeenCalledWith(expected);

    await settle(); // let the Modal exit phase finish
    expect(document.body.querySelectorAll('[role="dialog"]'), "dialog closes on select").toHaveLength(0);
    expect(dayCells(), "day cells unmount after select").toHaveLength(0);
  });

  it("3. getMonthGrid is Monday-first and a Monday-start month opens on the 1st", () => {
    const october = getMonthGrid(2026, 9); // 2026-10-01 is a Thursday
    expect(october).toHaveLength(42);
    expect(new Date(`${october[0].iso}T12:00:00`).getDay()).toBe(1);
    expect(october.map((c) => c.iso)).toContain("2026-10-01");
    expect(october[0].iso).toBe("2026-09-28"); // leading Monday of the grid
    expect(october[0].inMonth).toBe(false);
    expect(october[3].iso).toBe("2026-10-01");
    expect(october[3].inMonth).toBe(true);

    // 2026-06-01 IS a Monday: no leading out-of-month day.
    const june = getMonthGrid(2026, 5);
    expect(june[0].iso).toBe("2026-06-01");
    expect(june[0].day).toBe(1);
    expect(june[0].inMonth).toBe(true);
  });

  it("4. every day cell carries the tap-target and 360px-fit class contract", () => {
    const now = new Date();
    render(<DueDatePicker value={getISO.today} onChange={vi.fn()} />);
    clickByLabelPrefix("Choose due date");

    const cells = dayCells();
    // The grid is trimmed to the weeks the month on screen actually needs
    // (5 rows = 35 cells), so the count is derived from the calendar here
    // instead of pinned to the old always-42 pad. That derived count is what
    // proves a whole month is laid out: a whole number of Monday-first weeks
    // with no phantom 6th row, and every day of the month on the grid exactly
    // once. (The 35-vs-42 rows themselves are pinned against a frozen October
    // in tasks-components-a11y-fixes.test.tsx.)
    const weeks = weeksNeeded(now.getFullYear(), now.getMonth());
    expect(weeks).toBeGreaterThanOrEqual(4);
    expect(weeks).toBeLessThanOrEqual(6);
    expect(cells).toHaveLength(weeks * 7);

    const shown = cells.map((c) => c.getAttribute("data-date")!);
    expect(new Set(shown).size, "no day rendered twice").toBe(shown.length);
    const monthDays = getMonthGrid(now.getFullYear(), now.getMonth())
      .filter((c) => c.inMonth)
      .map((c) => c.iso);
    expect(shown.filter((iso) => monthDays.includes(iso))).toEqual(monthDays);

    for (const cell of cells) {
      const label = cell.getAttribute("aria-label") || cell.getAttribute("data-date") || "";
      expect(cell.className, label).toContain("h-11");
      expect(cell.className, label).toContain("w-11");
      expect(cell.className, label).toContain("max-w-full");
      expect(cell.className, label).toContain("hit-44");
    }
  });

  it("5. the selected day is programmatically pressed, other days are not", () => {
    const today = getISO.today;
    render(<DueDatePicker value={today} onChange={vi.fn()} />);
    clickByLabelPrefix("Choose due date");

    const cells = dayCells();
    const selected = cells.find((c) => c.getAttribute("data-date") === today)!;
    expect(selected).toBeTruthy();
    expect(selected.getAttribute("aria-pressed")).toBe("true");

    const other = cells.find((c) => c.getAttribute("data-date") !== today)!;
    expect(other.getAttribute("aria-pressed")).toBe("false");
  });
});
