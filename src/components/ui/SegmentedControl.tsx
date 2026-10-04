"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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

interface PillBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export default function SegmentedControl({ options, value, onChange, className = "", compact = false, emphasize = false, "aria-label": ariaLabel }: SegmentedControlProps) {
  const activeIndex = Math.max(options.findIndex((option) => option.id === value), 0);
  const densityClass = compact
    ? "min-w-0 basis-0 gap-1 rounded-xl px-1 py-2 text-xs"
    : "gap-1.5 rounded-xl px-3 py-2 text-xs";

  const trackRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [pill, setPill] = useState<PillBox | null>(null);

  const measure = useCallback(() => {
    const track = trackRef.current;
    const active = optionRefs.current[activeIndex];
    if (!track || !active) return;
    const trackBox = track.getBoundingClientRect();
    const activeBox = active.getBoundingClientRect();
    // A zero-width box means the control is not laid out yet (SSR, jsdom, or a
    // hidden ancestor). Keep the equal-segment fallback rather than collapsing
    // the indicator to nothing.
    if (!activeBox.width || !trackBox.width) return;
    setPill({
      left: activeBox.left - trackBox.left + 4,
      top: activeBox.top - trackBox.top + 4,
      width: activeBox.width,
      height: activeBox.height,
    });
  }, [activeIndex]);

  // The indicator is positioned from the measured option box rather than from
  // `width: 100% / options.length`. The percentage formula only holds while
  // the segments are equal *and* the track is not scrolled — with five tabs on
  // a 390px phone the track scrolls, the options size to their labels, and the
  // pill drifted off the active segment. Before the first measurement (SSR and
  // the first paint) it falls back to the equal-segment formula, which is
  // exactly right in the common non-scrolling case.
  useLayoutEffect(measure, [measure, options.length, compact, className]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    for (const node of optionRefs.current) if (node) observer.observe(node);
    return () => observer.disconnect();
  }, [measure, options.length]);

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={ariaLabel}
      // The track caps its own width. It used to be a plain flex row, so on a
      // 1920 panel a two-option control measured 1280px — 640px of chrome per
      // six-character label, with the active pill a lozenge rather than a
      // control. Below `sm` it fills the row and *wraps*: Home's five tabs used
      // to run off the right edge of a 390px phone with "Automat…" clipped
      // mid-word and no way to reach it. A `w-fit` track is deliberately not
      // used — the segments must stay equal — which is why the indicator below
      // is positioned from the measured box instead of from a percentage.
      className={`relative flex w-full flex-wrap rounded-2xl bg-[var(--color-surface-2)] p-1 sm:max-w-lg sm:flex-nowrap ${compact ? "min-w-0 " : ""}${className}`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-1 left-1 rounded-xl transition-all duration-200 ${
          emphasize
            ? "bg-[linear-gradient(135deg,var(--color-accent-button,var(--color-accent-selected)),color-mix(in_srgb,var(--color-accent-button,var(--color-accent-selected))_76%,#111827))] shadow-[0_6px_18px_color-mix(in_srgb,var(--color-accent-selected)_35%,transparent),inset_0_1px_0_rgba(255,255,255,0.22)]"
            : "bg-[var(--color-surface-0)] shadow"
        }`}
        style={
          pill
            ? { left: pill.left, top: pill.top, width: pill.width, height: pill.height }
            : {
                width: `calc(100% / ${options.length})`,
                transform: `translateX(${activeIndex * 100}%)`,
              }
        }
      />
      {options.map((option, index) => (
        <button
          key={option.id}
          ref={(node) => {
            optionRefs.current[index] = node;
          }}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          onClick={() => onChange(option.id)}
          className={`relative z-10 flex min-h-[44px] flex-1 items-center justify-center ${densityClass} font-semibold tap-sm ${
            compact ? "min-w-0" : "min-w-max sm:min-w-0"
          } ${
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