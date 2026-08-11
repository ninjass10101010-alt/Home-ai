"use client";

interface DayStripProps {
  days: Array<{ id: string; label: string; detail?: string; active?: boolean; accent?: string }>;
  onChange: (id: string) => void;
  value: string;
  className?: string;
  compact?: boolean;
}

export default function DayStrip({ days, onChange, value, className = "", compact = false }: DayStripProps) {
  return (
    <div className={`flex snap-x snap-mandatory gap-2 overflow-x-auto ${compact ? "pb-1" : "pb-2"} ${className}`}>
      {days.map((day) => {
        const isActive = day.id === value || day.label === value || Boolean(day.active);
        return (
          <button
            key={day.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(day.id)}
            className={`snap-start rounded-2xl border text-center transition-all active:scale-95 ${
              compact ? "min-w-12 p-2" : "min-w-16 p-3"
            } ${
              isActive
                ? "border-[var(--color-accent-button)] bg-[var(--color-accent-button)] text-white shadow-lg shadow-[var(--color-accent-button)]/20"
                : "border-white/10 bg-[var(--color-surface-0)]/30 text-text-primary hover:bg-[var(--color-surface-0)]/45"
            }`}
          >
            <span className={`block font-semibold uppercase tracking-[0.12em] ${compact ? "text-[10px]" : "text-[11px]"}`}>{day.label}</span>
            {day.detail && <span className={`mt-1 block font-bold display-numeral ${compact ? "text-base" : "text-lg"} ${isActive ? "text-white" : "text-text-primary"}`}>{day.detail}</span>}
          </button>
        );
      })}
    </div>
  );
}
