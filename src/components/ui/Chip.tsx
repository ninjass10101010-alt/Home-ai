"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ChipTone = "neutral" | "accent" | "success" | "danger" | "warning" | "violet" | "cyan";
export type ChipSize = "sm" | "md" | "lg";

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  tone?: ChipTone;
  size?: ChipSize;
  selected?: boolean;
  /**
   * `"span"` renders a static label instead of a control (UI audit 5.2: the
   * legacy `Badge` converged here). No button semantics, no tap/hit-44
   * affordance — a passive member/type label must not read as tappable.
   */
  as?: "button" | "span";
}

const toneMap: Record<ChipTone, string> = {
  neutral: "text-text-secondary border-border",
  accent: "widget-accent-text border-[var(--color-accent-selected)]/25",
  success: "chip-tone-success text-[var(--color-accent-mint)] border-[var(--color-accent-mint)]/25",
  danger: "chip-tone-danger text-[var(--color-accent-rose)] border-[var(--color-accent-rose)]/25",
  warning: "chip-tone-warning text-[var(--color-accent-amber)] border-[var(--color-accent-amber)]/25",
  violet: "text-[var(--color-accent-violet)] border-[var(--color-accent-violet)]/25",
  cyan: "text-[var(--color-accent-cyan)] border-[var(--color-accent-cyan)]/25",
};

const sizeMap: Record<ChipSize, string> = {
  sm: "h-7 px-2.5 text-xs rounded-full",
  md: "h-9 px-3 text-xs rounded-full",
  lg: "h-10 px-4 text-sm rounded-full",
};

export default function Chip({ children, tone = "neutral", size = "md", selected = false, as = "button", className = "", ...props }: ChipProps) {
  if (as === "span") {
    return (
      <span className={`inline-flex items-center justify-center gap-1.5 border bg-[var(--color-surface-0)]/20 backdrop-blur-xl ${toneMap[tone]} ${sizeMap[size]} ${className}`}>
        {children}
      </span>
    );
  }

  return (
    <button
      type="button"
      /* The base translucent fill is OMITTED when selected, not merely
         overridden. `bg-[var(--color-surface-0)]/20` and
         `bg-[var(--color-accent-button)]` are both Tailwind `bg-*` utilities in
         the same layer, so the later rule in the STYLESHEET wins — not the later
         class in the attribute. With both present the translucent surface won
         while `text-white` still applied, so a selected chip rendered as white
         ink on a 20%-opacity fill: an AA failure, and a chip that looked
         unselected. Same family as the two source-order traps already recorded
         in globals.css (`.calendar-empty-grow` behind `.calendar-empty`, and
         `.glass-strong`'s unlayered `position` beating `@layer utilities`). */
      className={`inline-flex items-center justify-center gap-1.5 border ${selected ? "" : "bg-[var(--color-surface-0)]/20"} backdrop-blur-xl tap-sm hit-44 disabled:pointer-events-none disabled:opacity-50 ${toneMap[tone]} ${sizeMap[size]} ${
        selected ? "chip-selected bg-[var(--color-accent-button)] text-white border-transparent" : ""
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
