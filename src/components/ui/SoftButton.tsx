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

/**
 * The secondary LABEL is the `--color-accent-ink-*` formula applied to whichever
 * accent is live: 55% of `--color-accent-selected` walked toward the theme's body
 * ink (`--color-text-primary`), the same mix `ui/Avatar.tsx` paints member
 * initials with, so there is one ink convention in the app.
 *
 * It used to be `--color-accent-button`, which is the accent deepened 60% toward
 * black FOR A WHITE LABEL — a dark ink by construction. Paired with the dark
 * theme's accent palette that put it 1.88–3.41:1 on `--color-surface-2` (worst:
 * dark violet 1.88) against a 4.5:1 body floor. This is a SHARED primitive, so
 * the blast radius was every secondary button in the app: the calendar's
 * due-date trigger, the rewards Suggest/Add, and more. Measured after the fix in
 * Chromium across all ten accents: **6.96–10.85:1 dark** (worst: rose) and
 * **6.03–10.23:1 light** (worst: sage).
 *
 * The class is written out in full rather than interpolated, so Tailwind's
 * scanner sees it as one candidate (see the same note in Chip.tsx).
 */
/**
 * `primary`'s fill is the accent deepened 60% toward black, spelled out rather
 * than read from `--color-accent-button` — which is the token that was always
 * meant to hold this mix (globals.css: `--color-accent-button: color-mix(in
 * srgb, var(--color-accent-selected) 60%, black)`), and whose stated reason is
 * this very pairing: "~25 call sites pair it with a hard-coded `text-white` …
 * the raw accent clears 4.5:1 under white for NONE of the ten presets".
 *
 * Reading the token does not deliver that, because `useTheme` writes
 * `--color-accent-button` as an **inline** style on `<html>` and an inline
 * declaration out-ranks every `:root[data-theme="…"]` rule. On the DEFAULT
 * theme config `isPresetValue()` never fires for the `button` target — it
 * compares `defaultAccentHex.button` (`#2563eb`, the LIGHT palette) against
 * `warmGlassAccentOptions`, which stores the DARK hex — so the inline layer
 * pins the token to `#2563eb` in BOTH themes and for ALL ten accents. Measured
 * in the browser on a pristine `localStorage`: `data-theme="dark"`,
 * `--color-accent-button` = `#2563eb`. Every primary SoftButton was therefore a
 * light-palette nori blue — white on it measures 5.17:1 where the intended
 * dark-nori mix gives 8.11:1, and under the mint / violet / apricot accents it
 * is not the family's colour at all.
 *
 * Deriving from `--color-accent-selected` restores the token's intent per theme
 * AND per accent, independent of the override. White on the resulting fill
 * measures **4.60–8.33:1 dark** (worst: mint) and **7.12–12.52:1 light** (worst:
 * sage) across the ten accents, against 5.17:1 for the single pinned value. The
 * `border` and `shadow` beside it already read `--color-accent-selected`, so
 * this also stops the fill disagreeing with its own border.
 *
 * This is the one remaining consumer that can be corrected from inside the
 * primitive; ~40 other files read `--color-accent-button` directly and still
 * need the `useTheme` fix.
 */
const variantMap: Record<SoftButtonVariant, string> = {
  primary: "bg-[color-mix(in_srgb,var(--color-accent-selected)_60%,black)] text-white border border-[var(--color-accent-selected)]/20 shadow-[0_12px_24px_rgba(0,0,0,0.16)]",
  secondary: "bg-[var(--color-surface-2)] text-[color-mix(in_srgb,var(--color-accent-selected)_55%,var(--color-text-primary))] border border-[var(--color-accent-selected)]/25",
  ghost: "bg-transparent text-text-secondary hover:text-text-primary border border-transparent",
  danger: "bg-[color-mix(in_srgb,var(--color-accent-rose),#000_25%)] text-white border-[var(--color-accent-rose)]/20 shadow-[0_12px_24px_color-mix(in_srgb,var(--color-accent-rose)_18%,transparent)]",
  success: "bg-[color-mix(in_srgb,var(--color-accent-mint),#000_45%)] text-white border-[var(--color-accent-mint)]/20 shadow-[0_12px_24px_color-mix(in_srgb,var(--color-accent-mint)_18%,transparent)]",
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
