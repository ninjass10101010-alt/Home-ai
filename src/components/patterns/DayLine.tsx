"use client";

import { useEffect, useState } from "react";

/** Parse "8:00 AM" | "2:30 PM" | "07:00" | ISO "2000-01-01T15:30" → minutes since midnight */
export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const iso = timeStr.match(/T(\d{1,2}):(\d{2})/);
  if (iso) return parseInt(iso[1], 10) * 60 + parseInt(iso[2], 10);
  const ampm = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = parseInt(ampm[2], 10);
    const period = ampm[3].toUpperCase();
    if (period === "PM" && h !== 12) h += 12;
    if (period === "AM" && h === 12) h = 0;
    return h * 60 + m;
  }
  const t24 = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (t24) return parseInt(t24[1], 10) * 60 + parseInt(t24[2], 10);
  return 0;
}

/** Fraction of the local day elapsed (0–1), null until mounted — SSR/hydration safe. */
export function useDayFraction(): number | null {
  const [fraction, setFraction] = useState<number | null>(null);
  useEffect(() => {
    const update = () => {
      const now = new Date();
      setFraction((now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60) / 1440);
    };
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, []);
  return fraction;
}

export interface DayLineMarker {
  /** minutes since midnight (day mode) or 0–1 fraction (week mode) */
  at: number;
  color?: string;
}

interface DayLineProps {
  markers?: DayLineMarker[];
  /** explicit 0–1 progress — required in week mode; omit in day mode for the live clock */
  progress?: number | null;
  tone?: string;
  mode?: "day" | "week";
  className?: string;
}

const MIN_GAP = 2.2; // % of width — below this, markers merge into a blob

/** Nudge markers right so no two sit closer than MIN_GAP; deterministic. */
function spread(positions: { position: number; color?: string }[]): { position: number; color?: string }[] {
  const sorted = [...positions].sort((a, b) => a.position - b.position);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].position - sorted[i - 1].position < MIN_GAP) {
      sorted[i].position = Math.min(100 - (sorted.length - 1 - i) * MIN_GAP, sorted[i - 1].position + MIN_GAP);
    }
  }
  return sorted;
}

/**
 * The household's shared clock as a hairline: the consumed part fills with
 * tone, markers sit at their times, and a soft now-glow travels the line.
 * Decorative by design — the same facts exist as real text nearby.
 */
export default function DayLine({ markers = [], progress, tone = "var(--color-accent-selected)", mode = "day", className = "" }: DayLineProps) {
  const dayFraction = useDayFraction();
  const fraction = mode === "week" ? (progress ?? 0) : (progress ?? dayFraction);
  const scale = (at: number) => (mode === "week" ? Math.max(0, Math.min(1, at)) : Math.max(0, Math.min(1, at / 1440)));
  const placed = spread(markers.map((marker) => ({ position: scale(marker.at) * 100, color: marker.color })))
    .filter((m) => m.position > 0 && m.position < 100);

  return (
    <div className={`relative h-4 ${className}`} aria-hidden="true" style={{ ["--dayline-tone" as string]: tone }}>
      <div className="dayline-track absolute inset-x-0 top-1/2 h-px -translate-y-1/2 rounded-full" />
      {fraction !== null && (
        <div
          className="dayline-fill absolute left-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full transition-[width] duration-1000"
          style={{ width: `${fraction * 100}%` }}
        />
      )}
      {placed.map((marker, index) =>
        mode === "week" ? (
          <span
            key={index}
            className="dayline-tick absolute top-1/2 h-[7px] w-px -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${marker.position}%`, background: marker.color ?? `color-mix(in srgb, ${tone} 55%, var(--color-text-primary))` }}
          />
        ) : (
          <span
            key={index}
            className="dayline-marker absolute top-1/2 h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${marker.position}%`, background: marker.color ?? `color-mix(in srgb, ${tone} 75%, transparent)` }}
          />
        )
      )}
      {fraction !== null && (
        <span
          className="dayline-now absolute top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left] duration-1000"
          style={{ left: `${fraction * 100}%`, background: tone }}
        />
      )}
    </div>
  );
}
