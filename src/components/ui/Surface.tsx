"use client";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

export type SurfaceVariant =
  | "glass"
  | "glass-strong"
  | "glass-subtle"
  | "material-regular"
  | "material-thick"
  | "warm"
  | "flat";

export type SurfacePadding = "none" | "sm" | "md" | "lg" | "xl";

export type SurfaceRadius = "sm" | "md" | "lg" | "xl" | "2xl" | "pill" | "none";

interface SurfaceProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  children: ReactNode;
  className?: string;
  variant?: SurfaceVariant;
  padding?: SurfacePadding;
  radius?: SurfaceRadius;
  glow?: boolean;
  interactive?: boolean;
  style?: CSSProperties;
  as?: "div" | "section" | "article";
  role?: string;
  "aria-label"?: string;
}

/**
 * A native `<input type="date">` needs ~150px for `MM/DD/YYYY` plus Chrome's
 * picker indicator. In a `flex-wrap` row that lets it shrink (`min-w-0
 * flex-1`) it silently clipped its own year and rendered "09/0" — a shipped
 * date range the family could not read. The primitive that owns the row floors
 * the control at its intrinsic measure so it wraps instead of truncating.
 */

const paddingMap: Record<SurfacePadding, string> = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
  xl: "p-8",
};

const radiusMap: Record<SurfaceRadius, string> = {
  none: "rounded-none",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
  pill: "rounded-full",
};

/**
 * The `glass*` prop values are KEPT (many call sites pass them) but they now
 * emit the `material-*` TIER names. The two families are byte-identical in
 * globals.css — `.material-thin, .glass-subtle`, `.material-regular, .glass`
 * and `.material-thick, .glass-strong` share one declaration block each — so
 * this is a pure rename with zero rendering change, and it stops the primitive
 * from being the last thing in the app still reaching for a legacy alias.
 */
const variantMap: Record<SurfaceVariant, string> = {
  glass: "material-regular",
  "glass-strong": "material-thick",
  "glass-subtle": "material-thin",
  "material-regular": "material-regular",
  "material-thick": "material-thick",
  warm: "warm-glass-card",
  /**
   * `flat` used to list `material-regular` FIRST and `bg-[var(--color-surface-2)]`
   * after it, which never did anything: `.material-*` is **unlayered** CSS, so
   * its `background` out-ranks the Tailwind `bg-*` utility outright and the
   * "flat" surface silently rendered as glass. The tier is dropped, not
   * reordered. `border-white/8` also went: 8% white is invisible against the
   * light theme's near-white canvas, which is the same reason
   * `patterns/SectionCard.tsx` moved its internal rules to `border-border`.
   */
  flat: "border border-border bg-[var(--color-surface-2)]",
};

export default function Surface({
  children,
  className = "",
  variant = "warm",
  padding = "md",
  radius = "xl",
  glow = false,
  interactive = false,
  style,
  as: Component = "div",
  role,
  "aria-label": ariaLabel,
  ...rest
}: SurfaceProps) {
  const combinedStyle: CSSProperties = {
    ...style,
    ...(glow ? { boxShadow: `0 0 32px var(--color-accent-glow, var(--color-accent-selected))` } : {}),
  };

  return (
    <Component
      role={role}
      aria-label={ariaLabel}
      className={`overflow-hidden ${paddingMap[padding]} ${radiusMap[radius]} ${variantMap[variant]} ${
        interactive ? "cursor-pointer tap" : ""
      } [&_input[type="date"]]:min-w-[9.5rem] ${className}`}
      style={combinedStyle}
      {...rest}
    >
      {children}
    </Component>
  );
}
