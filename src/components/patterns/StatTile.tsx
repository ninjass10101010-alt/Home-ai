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
      className={`relative min-w-0 flex-1 overflow-hidden lg:flex lg:flex-col lg:items-center ${compact ? "p-3 lg:justify-center" : "p-4 lg:aspect-square lg:justify-center"}`}
    >
      <div className={`grid place-items-center rounded-2xl bg-white/10 ${compact ? "mb-2 h-8 w-8 text-base" : "mb-3 h-9 w-9 text-lg"}`} style={{ color: `color-mix(in srgb, var(--widget-tone) 85%, white)` }}>
        {icon}
      </div>
      <div className={`font-bold tracking-tight text-text-primary display-numeral ${compact ? "text-xl" : "text-2xl"}`}>{value}</div>
      <div className={`mt-1 font-medium text-text-secondary ${compact ? "text-[11px]" : "text-xs"}`}>{label}</div>
      {detail && <div className={`mt-1 text-text-muted ${compact ? "text-[10px]" : "text-[11px]"}`}>{detail}</div>}
      {clamped !== null && (
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-white/8">
          <div
            className="h-full rounded-r-full transition-[width] duration-1000"
            style={{ width: `${clamped * 100}%`, background: `color-mix(in srgb, var(--widget-tone) 70%, transparent)` }}
          />
        </div>
      )}
    </WidgetCard>
  );
}
