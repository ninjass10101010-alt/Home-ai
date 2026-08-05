"use client";

interface DayStripProps {
  days: Array<{ id: string; label: string; detail?: string; active?: boolean; accent?: string }>;
  onChange: (id: string) => void;
  value: string;
  className?: string;
}

export default function DayStrip({ days, onChange, value, className = "" }: DayStripProps) {
  return (
    <div className={`flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2 ${className}`}>
      {days.map((day) => {
        const isActive = day.id === value || day.label === value || Boolean(day.active);
        return (
          <button
            key={day.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(day.id)}
            className={`snap-start min-w-16 rounded-2xl border p-3 text-center transition-all active:scale-95 ${
              isActive
                ? "border-[var(--color-accent-selected)] bg-[var(--color-accent-selected)] text-white shadow-lg shadow-[var(--color-accent-selected)]/20"
                : "border-white/10 bg-[var(--color-surface-0)]/30 text-text-primary hover:bg-[var(--color-surface-0)]/45"
            }`}
          >
            <span className="block text-[11px] font-semibold uppercase tracking-[0.12em]">{day.label}</span>
            {day.detail && <span className={`mt-1 block text-lg font-bold display-numeral ${isActive ? "text-white" : "text-text-primary"}`}>{day.detail}</span>}
          </button>
        );
      })}
    </div>
  );
}
