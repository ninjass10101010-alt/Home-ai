"use client";

import type { ReactNode } from "react";
import WidgetCard from "@/components/patterns/WidgetCard";

interface StatTileProps {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  tone?: "accent" | "success" | "warning" | "danger";
}

const toneHex = {
  accent: "var(--color-accent-selected)",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#f43f5e",
};

export default function StatTile({ label, value, detail, icon, tone = "accent" }: StatTileProps) {
  return (
    <WidgetCard tone={toneHex[tone]} className="min-w-0 flex-1 p-4 lg:aspect-square lg:flex lg:flex-col lg:items-center lg:justify-center">
      <div className="mb-3 grid h-9 w-9 place-items-center rounded-2xl bg-white/10 text-lg" style={{ color: `color-mix(in srgb, var(--widget-tone) 85%, white)` }}>
        {icon}
      </div>
      <div className="text-2xl font-bold tracking-tight text-text-primary display-numeral">{value}</div>
      <div className="mt-1 text-xs font-medium text-text-secondary">{label}</div>
      {detail && <div className="mt-1 text-[11px] text-text-muted">{detail}</div>}
    </WidgetCard>
  );
}
