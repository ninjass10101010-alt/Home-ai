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
  "aria-label"?: string;
}

export default function SegmentedControl({ options, value, onChange, className = "", "aria-label": ariaLabel }: SegmentedControlProps) {
  const activeIndex = Math.max(options.findIndex((option) => option.id === value), 0);

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`relative flex rounded-2xl bg-[var(--color-surface-2)] p-1 ${className}`}
    >
      <span
        className="absolute top-1 bottom-1 left-1 rounded-xl bg-[var(--color-surface-0)] shadow transition-all duration-200"
        style={{ width: `calc(100% / ${options.length})`, transform: `translateX(${activeIndex * 100}%)` }}
      />
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          onClick={() => onChange(option.id)}
          className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold tap-sm ${
            option.id === value ? "text-text-primary" : "text-text-muted hover:text-text-secondary"
          }`}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
