"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type IconButtonSize = "sm" | "md" | "lg";
export type IconButtonVariant = "glass" | "accent" | "danger" | "ghost";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  "aria-label"?: string;
}

const sizeMap: Record<IconButtonSize, string> = {
  sm: "h-9 w-9 hit-44 [&>svg]:h-4 [&>svg]:w-4",
  md: "h-11 w-11 [&>svg]:h-5 [&>svg]:w-5",
  lg: "h-12 w-12 [&>svg]:h-6 [&>svg]:w-6",
};

/**
 * `accent` mixes its ink 55% toward the theme's body text instead of painting
 * the raw accent — the `--color-accent-ink-*` formula, the same one
 * `ui/Avatar.tsx` uses for member initials and that `ui/Chip.tsx` /
 * `ui/Toast.tsx` now share, so one accent colour has one ink across the app.
 *
 * It read `text-[var(--color-accent-selected)]` on `bg-[…]/15` — a wash of the
 * same hue barely moves the value, so the glyph inherited the accent at nearly
 * full strength. Measured across all ten accents in both themes, **every one of
 * the sixty samples was under the bar**: 4.17–4.45:1 dark and 2.65–4.20:1 light,
 * worst at light sage 2.65 and light amber 2.72. A glyph is a graphical object,
 * so 1.4.11 asks 3:1 — amber and apricot failed even that. After the mix:
 * 7.25–9.74:1 dark and 5.80–8.94:1 light, worst at light sage (5.80) and dark
 * rose (7.25) — comfortably past both the 4.5:1 body floor and the 3:1
 * graphical-object bar.
 */
const variantMap: Record<IconButtonVariant, string> = {
  glass: "bg-[var(--color-surface-0)]/35 text-text-primary border border-border backdrop-blur-xl",
  accent: "bg-[var(--color-accent-selected)]/15 text-[color-mix(in_srgb,var(--color-accent-selected)_55%,var(--color-text-primary))] border border-[var(--color-accent-selected)]/25",
  // Token-driven danger (same light-safe recipe as SoftButton's danger:
  // color-mix darkens the theme-aware rose so white glyphs keep AA contrast
  // in both themes — raw bg-[var(--color-accent-rose)] ignored the light-theme token).
  danger: "bg-[color-mix(in_srgb,var(--color-accent-rose),#000_25%)] text-white border border-[var(--color-accent-rose)]/20",
  ghost: "bg-transparent text-text-secondary border border-transparent",
};

export default function IconButton({
  children,
  size = "md",
  variant = "glass",
  className = "",
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={`grid place-items-center rounded-full tap disabled:pointer-events-none disabled:opacity-50 ${sizeMap[size]} ${variantMap[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
