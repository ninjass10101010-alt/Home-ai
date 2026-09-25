"use client";

import type { ReactNode } from "react";

export interface SegmentedOption {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
}

interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  compact?: boolean;
  /** Active option gets the solid accent-gradient pill with white text + glow
   *  (the Calendar-tab treatment) instead of the quiet surface slide. */
  emphasize?: boolean;
  "aria-label"?: string;
}

export default function SegmentedControl({ options, value, onChange, className = "", compact = false, emphasize = false, "aria-label": ariaLabel }: SegmentedControlProps) {
  const activeIndex = Math.max(options.findIndex((option) => option.id === value), 0);
  const densityClass = compact
    ? "min-w-0 basis-0 gap-1 rounded-xl px-1 py-2 text-xs"
    : "gap-1.5 rounded-xl px-3 py-2 text-xs";

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`relative flex rounded-2xl bg-[var(--color-surface-2)] p-1 ${compact ? "min-w-0 " : ""}${className}`}
    >
      <span
        className={`absolute top-1 bottom-1 left-1 rounded-xl transition-all duration-200 ${
          emphasize
            ? "bg-[linear-gradient(135deg,var(--color-accent-button,var(--color-accent-selected)),color-mix(in_srgb,var(--color-accent-button,var(--color-accent-selected))_76%,#111827))] shadow-[0_6px_18px_color-mix(in_srgb,var(--color-accent-selected)_35%,transparent),inset_0_1px_0_rgba(255,255,255,0.22)]"
            : "bg-[var(--color-surface-0)] shadow"
        }`}
        style={{ width: `calc(100% / ${options.length})`, transform: `translateX(${activeIndex * 100}%)` }}
      />
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          onClick={() => onChange(option.id)}
          className={`relative z-10 flex min-h-[44px] flex-1 items-center justify-center ${densityClass} font-semibold tap-sm ${
            option.id === value
              ? emphasize ? "text-white" : "text-text-primary"
              : "text-text-muted hover:text-text-secondary"
          }`}
        >
          {option.icon}
          <span className={compact ? "min-w-0 truncate" : "whitespace-nowrap"}>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
