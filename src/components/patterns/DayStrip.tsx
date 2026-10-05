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
            className={`snap-start rounded-2xl border text-center transition-all active:scale-95 min-h-11 ${
              compact ? "min-w-12 p-2" : "min-w-16 p-3"
            } ${
              isActive
                /* The active day is the accent deepened 60% toward black, spelled
                   out rather than read from `--color-accent-button` — the same
                   reasoning as `SoftButton`'s primary and `Chip`'s selected fill.
                   `useTheme` writes that token as an INLINE style on <html>, which
                   out-ranks every `:root[data-theme="…"]` rule, so on a pristine
                   `localStorage` it resolves to `#2563eb` (the LIGHT palette) in
                   BOTH themes and to nori blue for every accent: the family picks
                   mint and their selected day is still blue. White on the intended
                   mix measures 4.60–8.33:1 dark / 7.12–12.52:1 light. */
                ? "border-[color-mix(in_srgb,var(--color-accent-selected)_60%,black)] bg-[color-mix(in_srgb,var(--color-accent-selected)_60%,black)] text-white shadow-lg shadow-[color-mix(in_srgb,var(--color-accent-selected)_60%,black)]/20"
                : "border-border bg-[var(--color-surface-0)]/30 text-text-primary hover:bg-[var(--color-surface-0)]/45"
            }`}
          >
            <span className="block text-xs font-semibold uppercase tracking-[0.12em]">{day.label}</span>
            {day.detail && <span className={`mt-1 block font-bold display-numeral ${compact ? "text-base" : "text-lg"} ${isActive ? "text-white" : "text-text-primary"}`}>{day.detail}</span>}
          </button>
        );
      })}
    </div>
  );
}
