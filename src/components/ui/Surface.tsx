"use client";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

export type SurfaceVariant =
  | "glass"
  | "glass-strong"
  | "glass-subtle"
  | "warm"
  | "warm-strong"
  | "neu"
  | "neu-pressed"
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

const variantMap: Record<SurfaceVariant, string> = {
  glass: "glass",
  "glass-strong": "glass-strong",
  "glass-subtle": "glass-subtle",
  warm: "warm-glass-card",
  "warm-strong": "warm-glass-card bg-[var(--color-surface-0)]/75",
  neu: "neu-raised",
  "neu-pressed": "neu-pressed",
  flat: "neu-flat",
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
        interactive ? "cursor-pointer hover:scale-[1.015] active:scale-[0.99]" : ""
      } ${className}`}
      style={combinedStyle}
      {...rest}
    >
      {children}
    </Component>
  );
}
