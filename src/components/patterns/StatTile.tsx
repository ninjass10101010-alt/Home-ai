"use client";

import type { ReactNode } from "react";
import Surface from "@/components/ui/Surface";

interface StatTileProps {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  tone?: "accent" | "success" | "warning" | "danger";
}

const toneMap = {
  accent: "bg-[var(--color-accent-selected)]/15 text-[var(--color-accent-selected)]",
  success: "bg-emerald-400/15 text-emerald-300",
  warning: "bg-amber-400/15 text-amber-300",
  danger: "bg-rose-400/15 text-rose-300",
};

export default function StatTile({ label, value, detail, icon, tone = "accent" }: StatTileProps) {
  return (
    <Surface variant="glass-subtle" radius="xl" padding="sm" className="min-w-0 flex-1">
      <div className={`mb-3 grid h-9 w-9 place-items-center rounded-2xl ${toneMap[tone]}`}>{icon}</div>
      <div className="text-2xl font-bold tracking-tight text-text-primary display-numeral">{value}</div>
      <div className="mt-1 text-xs font-medium text-text-secondary">{label}</div>
      {detail && <div className="mt-1 text-[11px] text-text-muted">{detail}</div>}
    </Surface>
  );
}
