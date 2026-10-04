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
  success: "var(--color-accent-mint)",
  warning: "var(--color-accent-amber)",
  danger: "var(--color-accent-rose)",
};

/**
 * `value`, `label` and `detail` are direct children of the tile, in that order —
 * a structural contract several callers and tests read (the label's previous
 * sibling is the value). Wide-layout grouping is therefore done with `order`
 * utilities on the flex tile, not by re-parenting.
 */
export default function StatTile({ label, value, detail, icon, tone = "accent", compact = false, progress = null }: StatTileProps) {
  const clamped = progress === null ? null : Math.max(0, Math.min(1, progress));
  return (
    <WidgetCard
      tone={toneHex[tone]}
      // A stat tile is a *row*, not a poster. Stacked, a 420px-wide tile at
      // 1920 held ~90px of content in its top-left corner and 300px of nothing,
      // and three tiles in a group could not baseline-align because one tile's
      // `detail` wrapped to a second line. From `lg` the numeral sits left and
      // the label right on one baseline row, so the group scans as a KPI row.
      className={`relative min-w-0 flex-1 overflow-hidden ${compact ? "gap-2 p-3.5" : "gap-2 p-4 lg:flex-row lg:flex-wrap lg:items-end lg:justify-start lg:gap-x-3 lg:px-5 lg:py-4"} flex flex-col`}
    >
      {icon && (
        <div
          className={`grid shrink-0 place-items-center self-start rounded-xl bg-white/[0.07] ring-1 ring-white/[0.06] ${compact ? "h-7 w-7 text-sm" : "h-8 w-8 text-base lg:order-1 lg:self-end"}`}
          style={{ color: `color-mix(in srgb, var(--widget-tone) 82%, white)` }}
        >
          {icon}
        </div>
      )}
      <div className={`font-bold tracking-tight text-text-primary text-numeral-hero leading-none ${compact ? "text-[1.7rem]" : "text-2xl lg:order-1"}`}>{value}</div>
      <div className={`text-xs font-medium text-text-secondary ${compact ? "" : "lg:order-2 lg:ml-auto lg:max-w-[45%] lg:text-right"}`}>{label}</div>
      {detail && <div className={`text-xs text-text-muted ${compact ? "" : "lg:order-2 lg:ml-auto lg:max-w-[45%] lg:text-right"}`}>{detail}</div>}
      {/* After `detail` in the DOM (the label's previous sibling is the value —
          a contract callers read) and lifted back beside the label at `lg`. */}
      {clamped !== null && (
        <span className={`text-eyebrow !tracking-[0.08em] opacity-60 ${compact ? "" : "lg:order-3 lg:pb-1"}`}>
          {Math.round(clamped * 100)}%
        </span>
      )}
      {clamped !== null && (
        <div className="h-[3px] overflow-hidden rounded-full bg-white/[0.07] lg:absolute lg:inset-x-0 lg:bottom-0 lg:rounded-b-2xl">
          <div
            className="h-full rounded-full transition-[width] duration-1000"
            style={{ width: `${clamped * 100}%`, background: `color-mix(in srgb, var(--widget-tone) 72%, white 8%)` }}
          />
        </div>
      )}
    </WidgetCard>
  );
}