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
// `document.body`, so queries read from there. Day cells expose their local ISO
// as `aria-label`, which is both the query hook and the screen-reader name.
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

function clickByLabel(label: string) {
  const el = document.body.querySelector(`[aria-label="${label}"]`);
  expect(el, `control "${label}"`).toBeTruthy();
  click(el!);
}

/** The 42 calendar day buttons, identified by their ISO aria-label. */
function dayCells(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>("button[aria-label]")).filter((b) =>
    /^\d{4}-\d{2}-\d{2}$/.test(b.getAttribute("aria-label") || "")
  );
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
    render(<DueDatePicker value={getISO.today} onChange={onChange} />);

    clickByLabel("Choose due date");
    const now = new Date();
    expect(document.body.textContent).toContain(monthLabel(now.getFullYear(), now.getMonth()));

    const expected = localTodayISO(new Date(now.getFullYear(), now.getMonth(), 15));
    clickByLabel(expected);
    expect(onChange).toHaveBeenCalledWith(expected);
    await settle(); // let the Modal exit phase finish
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

  it("4. every day cell carries the h-11 w-11 tap-target contract", () => {
    render(<DueDatePicker value={getISO.today} onChange={vi.fn()} />);
    clickByLabel("Choose due date");

    const cells = dayCells();
    expect(cells).toHaveLength(42);
    for (const cell of cells) {
      const label = cell.getAttribute("aria-label") || "";
      expect(cell.className, label).toContain("h-11");
      expect(cell.className, label).toContain("w-11");
    }
  });
});
