"use client";

import type { ReactNode } from "react";
import WidgetCard from "@/components/patterns/WidgetCard";

interface StatTileProps {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  tone?: "accent" | "success" | "warning" | "danger";
  compact?: boolean;
  /** 0–1 fill drawn as a hairline along the card's base — honest fractions only */
  progress?: number | null;
}

const toneHex = {
  accent: "var(--color-accent-selected)",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#f43f5e",
};

export default function StatTile({ label, value, detail, icon, tone = "accent", compact = false, progress = null }: StatTileProps) {
  const clamped = progress === null ? null : Math.max(0, Math.min(1, progress));
  return (
    <WidgetCard
      tone={toneHex[tone]}
      className={`relative min-w-0 flex-1 overflow-hidden ${compact ? "p-3.5" : "p-4 lg:aspect-square lg:justify-center lg:items-center"} flex flex-col`}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className={`grid place-items-center rounded-xl bg-white/[0.07] ring-1 ring-white/[0.06] ${compact ? "h-7 w-7 text-sm" : "h-8 w-8 text-base"}`}
          style={{ color: `color-mix(in srgb, var(--widget-tone) 82%, white)` }}
        >
          {icon}
        </div>
        {clamped !== null && (
          <span className="text-eyebrow !tracking-[0.08em] opacity-60">
            {Math.round(clamped * 100)}%
          </span>
        )}
      </div>
      <div className={`mt-3 font-bold tracking-tight text-text-primary text-numeral-hero leading-none ${compact ? "text-[1.7rem]" : "text-2xl"}`}>{value}</div>
      <div className="mt-1 text-xs font-medium text-text-secondary">{label}</div>
      {detail && <div className="mt-0.5 text-xs text-text-muted">{detail}</div>}
      {clamped !== null && (
        <div className="mt-3 h-[3px] rounded-full bg-white/[0.07] overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-1000"
            style={{ width: `${clamped * 100}%`, background: `color-mix(in srgb, var(--widget-tone) 72%, white 8%)` }}
          />
        </div>
      )}
    </WidgetCard>
  );
}
