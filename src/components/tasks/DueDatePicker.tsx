"use client";

import { useState } from "react";
import Chip from "@/components/ui/Chip";
import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";
import { getISO, getMonthGrid, monthLabel } from "@/lib/due-date-utils";

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

const PRESETS: { label: string; get: () => string }[] = [
  { label: "Today", get: () => getISO.today },
  { label: "Tomorrow", get: () => getISO.tomorrow },
  { label: "Fri", get: () => getISO.fri },
  { label: "Next week", get: () => getISO.thisWeek },
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatDue(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "Pick a date";
  const d = new Date(`${iso}T12:00:00`); // local noon — no UTC slicing
  if (Number.isNaN(d.getTime())) return "Pick a date";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function DueDatePicker({ value, onChange }: DueDatePickerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const base = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date();
    return { year: base.getFullYear(), monthIndex: base.getMonth() };
  });

  const cells = getMonthGrid(view.year, view.monthIndex);

  const shiftMonth = (delta: number) => {
    setView((current) => {
      const next = new Date(current.year, current.monthIndex + delta, 1);
      return { year: next.getFullYear(), monthIndex: next.getMonth() };
    });
  };

  const selectDay = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map((preset) => (
        <Chip key={preset.label} size="sm" onClick={() => onChange(preset.get())}>
          {preset.label}
        </Chip>
      ))}
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
          <span className="text-sm font-semibold text-text-primary">{monthLabel(view.year, view.monthIndex)}</span>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => shiftMonth(1)}
            className="hit-44 tap-sm inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-lg text-text-primary"
          >
            ›
          </button>
        </div>
        <div className="mt-3 grid grid-cols-7 justify-items-center gap-0.5">
          {WEEKDAYS.map((day) => (
            <span key={day} className="flex h-8 items-center justify-center text-xs font-semibold text-text-muted">
              {day}
            </span>
          ))}
          {cells.map((cell) => {
            const selected = cell.iso === value;
            const tone = selected
              ? "bg-[var(--color-surface-2)] font-semibold text-[var(--color-accent-mint)]"
              : cell.inMonth
                ? "text-text-primary"
                : "text-text-dim";
            return (
              <button
                key={cell.iso}
                type="button"
                aria-label={cell.iso}
                aria-pressed={selected}
                onClick={() => selectDay(cell.iso)}
                className={`h-11 w-11 max-w-full rounded-full hit-44 text-sm ${tone}`}
              >
                {cell.day}
              </button>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}
