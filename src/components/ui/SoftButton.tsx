"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type SoftButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
export type SoftButtonSize = "sm" | "md" | "lg" | "icon";

interface SoftButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: SoftButtonVariant;
  size?: SoftButtonSize;
  loading?: boolean;
  children: ReactNode;
}

const variantMap: Record<SoftButtonVariant, string> = {
  primary: "bg-[var(--color-accent-button)] text-white border border-[var(--color-accent-selected)]/20 shadow-[0_12px_24px_rgba(0,0,0,0.16)]",
  secondary: "bg-[var(--color-surface-2)] text-[var(--color-accent-button)] border border-[var(--color-accent-selected)]/25",
  ghost: "bg-transparent text-text-secondary hover:text-text-primary border border-transparent",
  danger: "bg-[color-mix(in_srgb,var(--color-accent-rose),#000_25%)] text-white border border-[var(--color-accent-rose)]/20 shadow-[0_12px_24px_color-mix(in_srgb,var(--color-accent-rose)_18%,transparent)]",
  success: "bg-[color-mix(in_srgb,var(--color-accent-mint),#000_45%)] text-white border border-[var(--color-accent-mint)]/20 shadow-[0_12px_24px_color-mix(in_srgb,var(--color-accent-mint)_18%,transparent)]",
};

const sizeMap: Record<SoftButtonSize, string> = {
  sm: "h-9 px-3.5 text-xs rounded-xl gap-1.5 hit-44",
  md: "h-11 px-4 text-sm rounded-2xl gap-2",
  lg: "h-12 px-5 text-sm font-semibold rounded-2xl gap-2",
  icon: "h-11 w-11 px-0 text-sm rounded-2xl",
};

/**
 * Disabled is a SURFACE change, not a fade.
 *
 * `disabled:opacity-50` composited the whole button toward its backdrop, so a
 * disabled primary landed at ~1.8:1 for its own white label — a "Save" you
 * literally cannot read. Opacity also destroyed the accent, so a disabled
 * control was indistinguishable from a broken one.
 *
 * A disabled button now drops to the neutral raised surface with
 * `--color-text-secondary` ink and no shadow. Measured: 5.00:1 in dark,
 * 6.16:1 in light — clear of AA while still unmistakably inert, because every
 * trace of accent (fill, glow, coloured border) is gone. All five variants
 * converge on it, because that IS the signal.
 */
const disabledMap =
  "!bg-[var(--color-surface-2)] !text-[var(--color-text-secondary)] !border-[var(--color-border)] !shadow-none";

export default function SoftButton({
  variant = "primary",
  size = "md",
  loading = false,
  children,
  className = "",
  disabled,
  type = "button",
  ...props
}: SoftButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled ?? loading}
      className={`inline-flex items-center justify-center gap-2 font-medium tap disabled:pointer-events-none disabled:cursor-not-allowed ${variantMap[variant]} ${sizeMap[size]} ${className} ${disabled || loading ? disabledMap : ""}`}
      {...props}
    >
      {loading && (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
        </svg>
      )}
      {children}
    </button>
  );
}
