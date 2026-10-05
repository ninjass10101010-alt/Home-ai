"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import Chip from "@/components/ui/Chip";
import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";
import { addDaysISO, getISO, getMonthGrid, monthLabel } from "@/lib/due-date-utils";
import { localTodayISO } from "@/lib/local-date";

/**
 * The Add/Edit sheet's due control. Presets are the same local-day `getISO.*`
 * getters the board uses; any other day comes from the Monday-first calendar
 * popover. Every day is local-day, noon-anchored (see `due-date-utils`), so the
 * picker never writes a UTC neighbour of the day the user tapped.
 */
interface DueDatePickerProps {
  value: string;
  onChange: (iso: string) => void;
}

/**
 * The Monday of NEXT week, as a local date — the app's own Monday-first week
 * start (`localWeekStartISO`), moved forward one week.
 *
 * This replaces `getISO.thisWeek`, which is `isoOffset(6)`: from a Monday that
 * is the coming SUNDAY, six days that are still THIS week. A parent adding a
 * chore on Monday morning tapped "Next week" and got it due Sunday night —
 * wrong on exactly the day the family is planning the week. "Next week" now
 * means the next Monday from every weekday, and because the family's week runs
 * Monday→Sunday, that label is honest from Sunday too.
 */
function nextMondayISO(): string {
  const today = new Date();
  // getDay() is 0 (Sun) … 6 (Sat); Monday-first offset is (day + 6) % 7.
  const mondayFirst = (today.getDay() + 6) % 7;
  const days = 7 - mondayFirst; // Monday -> 7 (not 0: "next", never "today")
  today.setDate(today.getDate() + days);
  return localTodayISO(today);
}

const PRESETS: { label: string; get: () => string }[] = [
  { label: "Today", get: () => getISO.today },
  { label: "Tomorrow", get: () => getISO.tomorrow },
  { label: "Fri", get: () => getISO.fri },
  { label: "Next week", get: () => nextMondayISO() },
];

/** "no due date" is a real server state, so it needs a control, not just a wording. */
const CLEAR_LABEL = "No due date";

const WEEKDAYS = [
  { short: "Mon", long: "Monday" },
  { short: "Tue", long: "Tuesday" },
  { short: "Wed", long: "Wednesday" },
  { short: "Thu", long: "Thursday" },
  { short: "Fri", long: "Friday" },
  { short: "Sat", long: "Saturday" },
  { short: "Sun", long: "Sunday" },
];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isDay(iso: string): boolean {
  return ISO_DAY.test(iso) && !Number.isNaN(new Date(`${iso}T12:00:00`).getTime());
}

function formatDue(iso: string): string {
  if (!isDay(iso)) return "Pick a date";
  const d = new Date(`${iso}T12:00:00`); // local noon — no UTC slicing
  if (Number.isNaN(d.getTime())) return "Pick a date";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/**
 * A day cell's announced name. The raw `2026-10-05` is not a date a
 * screen-reader user can hold in their head, and it carries no month context at
 * all, so cells speak the same human form the trigger uses and only add the
 * year when it is not the month on screen (the trailing/leading days that
 * belong to a neighbouring month).
 */
function formatCell(iso: string, viewYear: number): string {
  const base = formatDue(iso);
  const year = Number(iso.slice(0, 4));
  return year === viewYear ? base : `${base}, ${year}`;
}

/** Monday-first week count for a month: 5 or 6, never a phantom 7th row. */
function weeksInMonth(year: number, monthIndex: number): number {
  const leading = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const days = new Date(year, monthIndex + 1, 0).getDate();
  return Math.ceil((leading + days) / 7);
}

const ARROW_DAYS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

export default function DueDatePicker({ value, onChange }: DueDatePickerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const base = isDay(value) ? new Date(`${value}T12:00:00`) : new Date();
    return { year: base.getFullYear(), monthIndex: base.getMonth() };
  });
  // Roving tabindex: exactly ONE day is in the tab order, so the calendar is a
  // single tab stop instead of 42 (or 35). The focused day is also where arrow
  // keys start from.
  const [focusIso, setFocusIso] = useState<string>(() => (isDay(value) ? value : localTodayISO()));
  const pendingFocus = useRef<string | null>(null);
  const dayRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const monthHeadingId = useId();

  const cells = useMemo(() => {
    // `getMonthGrid` always returns 42 cells, so a 5-row month rendered a
    // phantom 6th week — an empty row of unselectable days under the real ones.
    return getMonthGrid(view.year, view.monthIndex).slice(0, weeksInMonth(view.year, view.monthIndex) * 7);
  }, [view.year, view.monthIndex]);

  const rows = useMemo(() => {
    const out: typeof cells[] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [cells]);

  const visible = useMemo(() => new Set(cells.map((cell) => cell.iso)), [cells]);
  // Never leave the grid with zero tab stops: if the focused day is not on
  // screen (the user paged months), fall back to today, then to the 1st.
  const activeIso = visible.has(focusIso)
    ? focusIso
    : (visible.has(localTodayISO()) ? localTodayISO() : cells[0]?.iso ?? "");

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target || !open) return;
    const node = dayRefs.current[target];
    if (!node) return;
    pendingFocus.current = null;
    node.focus();
  }, [activeIso, open]);

  const shiftMonth = (delta: number) => {
    setView((current) => {
      const next = new Date(current.year, current.monthIndex + delta, 1);
      return { year: next.getFullYear(), monthIndex: next.getMonth() };
    });
  };

  /** Move the roving focus `delta` days, following the day into its own month. */
  const moveDay = (fromIso: string, delta: number) => {
    const next = addDaysISO(fromIso, delta);
    if (!next) return;
    pendingFocus.current = next;
    setFocusIso(next);
    setView({ year: Number(next.slice(0, 4)), monthIndex: Number(next.slice(5, 7)) - 1 });
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const delta = ARROW_DAYS[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    moveDay(activeIso, delta);
  };

  const selectDay = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Each preset reports whether it IS the chosen day. Without it every chip
          rendered identically forever, so a parent who tapped "Today" could only
          confirm it by reading the calendar trigger further along the row — the
          one piece of state the control exists to set had no visible owner.
          `aria-pressed` states it to a screen reader too. */}
      {PRESETS.map((preset) => {
        const iso = preset.get();
        return (
          <Chip
            key={preset.label}
            size="sm"
            tone="accent"
            selected={value === iso}
            aria-pressed={value === iso}
            onClick={() => onChange(iso)}
          >
            {preset.label}
          </Chip>
        );
      })}
      {/* A task due in 2027 otherwise blocks its own expiry tombstone forever:
          every other path through this control SET a date, and "no due date"
          meant "never" server-side with no way to reach it.
          The SELECTED state is `primary`, not `secondary`: SoftButton's
          secondary ink (`--color-accent-button` on `--color-surface-2`) measures
          1.88–3.42:1 in dark across the ten accents, so the one state a parent
          most needs to read would be the one they could not. Primary is
          `--color-accent-button` under white, 4.58–12.49:1 in both themes. */}
      <SoftButton
        variant={value === "" ? "primary" : "ghost"}
        size="sm"
        aria-label={CLEAR_LABEL}
        aria-pressed={value === ""}
        onClick={() => onChange("")}
      >
        <span aria-hidden="true">✕</span>
        {CLEAR_LABEL}
      </SoftButton>
      <SoftButton
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Choose due date, ${formatDue(value)}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span aria-hidden="true">📅</span>
        <span>{formatDue(value)}</span>
      </SoftButton>

      <Modal open={open} onClose={() => setOpen(false)} title="Due date">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => shiftMonth(-1)}
            className="hit-44 tap-sm inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-lg text-text-primary"
          >
            ‹
          </button>
          <span id={monthHeadingId} className="text-sm font-semibold text-text-primary">
            {monthLabel(view.year, view.monthIndex)}
          </span>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => shiftMonth(1)}
            className="hit-44 tap-sm inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-lg text-text-primary"
          >
            ›
          </button>
        </div>
        {/* A real `grid` — the weekday row was a set of bare <span>s sharing the
            day cells' `grid-cols-7`, and the day cells announced raw ISO
            strings. The month heading names the grid, so a screen reader says
            "October 2026" before it reads a single day. */}
        <table
          role="grid"
          aria-labelledby={monthHeadingId}
          onKeyDown={onGridKeyDown}
          className="mt-3 w-full table-fixed border-separate border-spacing-y-0.5"
        >
          <thead>
            <tr role="row">
              {WEEKDAYS.map((day) => (
                <th
                  key={day.short}
                  scope="col"
                  role="columnheader"
                  aria-label={day.long}
                  className="h-8 p-0 text-center text-xs font-semibold text-text-muted"
                >
                  {day.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`week-${rowIndex}`} role="row">
                {row.map((cell) => {
                  const selected = cell.iso === value;
                  // The selected day used to be `--color-surface-2` fill (1.06:1
                  // on the panel in light) with `--color-accent-mint` ink
                  // (3.36:1), so the only signals were font weight and a colour
                  // below the body floor: on a light device a parent could not
                  // see which day was already picked. This is the app's own
                  // "selected option" idiom (Chip selected, the emphasized
                  // SegmentedControl): a deepened accent fill that clears 4.5:1
                  // under `--color-text-on-accent` for all ten accents in both
                  // themes. `aria-pressed` stays the programmatic signal.
                  const tone = selected
                    ? "bg-[var(--color-accent-button)] text-[var(--color-text-on-accent)] font-semibold"
                    : cell.inMonth
                      ? "text-text-primary"
                      : "text-text-dim";
                  return (
                    <td key={cell.iso} role="gridcell" className="p-0 text-center">
                      <button
                        ref={(node) => {
                          dayRefs.current[cell.iso] = node;
                        }}
                        type="button"
                        data-date={cell.iso}
                        aria-label={formatCell(cell.iso, view.year)}
                        aria-pressed={selected}
                        tabIndex={cell.iso === activeIso ? 0 : -1}
                        onFocus={() => setFocusIso(cell.iso)}
                        onClick={() => selectDay(cell.iso)}
                        className={`mx-auto h-11 w-11 max-w-full rounded-full hit-44 text-sm tap-sm ${tone}`}
                      >
                        {cell.day}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Modal>
    </div>
  );
}
