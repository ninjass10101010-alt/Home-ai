"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ChipTone = "neutral" | "accent" | "success" | "danger" | "warning";
export type ChipSize = "sm" | "md" | "lg";

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  tone?: ChipTone;
  size?: ChipSize;
  selected?: boolean;
}

const toneMap: Record<ChipTone, string> = {
  neutral: "text-text-secondary border-white/10",
  accent: "widget-accent-text border-[var(--color-accent-selected)]/25",
  success: "chip-tone-success text-[var(--color-accent-mint)] border-[var(--color-accent-mint)]/25",
  danger: "chip-tone-danger text-[var(--color-accent-rose)] border-[var(--color-accent-rose)]/25",
  warning: "chip-tone-warning text-[var(--color-accent-amber)] border-[var(--color-accent-amber)]/25",
};

const sizeMap: Record<ChipSize, string> = {
  sm: "h-7 px-2.5 text-[11px] rounded-full",
  md: "h-9 px-3 text-xs rounded-full",
  lg: "h-10 px-4 text-sm rounded-full",
};

export default function Chip({ children, tone = "neutral", size = "md", selected = false, className = "", ...props }: ChipProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 border bg-[var(--color-surface-0)]/20 backdrop-blur-xl tap-sm disabled:pointer-events-none disabled:opacity-50 ${toneMap[tone]} ${sizeMap[size]} ${
        selected ? "chip-selected bg-[var(--color-accent-button)] text-white border-transparent" : ""
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
