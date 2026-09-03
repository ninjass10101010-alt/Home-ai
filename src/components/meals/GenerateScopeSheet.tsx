"use client";
import Modal from "@/components/ui/Modal";

const dayFullNames: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday",
  Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

interface GenerateScopeSheetProps {
  open: boolean;
  dayName: string;
  dayEmpty: number;
  weekEmpty: number;
  onDay: () => void;
  onWeek: () => void;
  onCancel: () => void;
}

export default function GenerateScopeSheet({ open, dayName, dayEmpty, weekEmpty, onDay, onWeek, onCancel }: GenerateScopeSheetProps) {
  const full = dayEmpty === 0;
  return (
    <Modal open={open} onClose={onCancel} title="Generate meals" description="Consuela fills only empty slots — planned meals stay put.">
      <div className="space-y-3">
        <button
          type="button"
          disabled={full}
          onClick={onDay}
          className={`w-full rounded-2xl border p-4 text-left transition-colors ${
            full
              ? "cursor-not-allowed border-white/5 bg-[var(--color-surface-2)]/40 opacity-60"
              : "border-[var(--color-accent-selected)]/25 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]/70"
          }`}
        >
          <span className="block text-sm font-semibold text-text-primary">✨ Just {dayFullNames[dayName] || dayName}</span>
          <span className="mt-0.5 block text-xs text-text-secondary">
            {full ? "This day is already full" : `Fills ${dayEmpty} empty slot${dayEmpty === 1 ? "" : "s"} on this day`}
          </span>
        </button>
        <button
          type="button"
          disabled={weekEmpty === 0}
          onClick={onWeek}
          className={`w-full rounded-2xl border p-4 text-left transition-colors ${
            weekEmpty === 0
              ? "cursor-not-allowed border-white/5 bg-[var(--color-surface-2)]/40 opacity-60"
              : "border-[var(--color-accent-selected)]/25 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]/70"
          }`}
        >
          <span className="block text-sm font-semibold text-text-primary">🗓️ Whole week</span>
          <span className="mt-0.5 block text-xs text-text-secondary">
            {weekEmpty === 0 ? "The week is already full" : `Fills ${weekEmpty} empty slot${weekEmpty === 1 ? "" : "s"} across Mon–Sun`}
          </span>
        </button>
      </div>
    </Modal>
  );
}
