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

/**
 * Four of the seven tones mix their ink 55% toward the theme's body text — the
 * `--color-accent-ink-*` formula, the same one `ui/Avatar.tsx` paints member
 * initials with, so one accent colour has one ink across the app.
 *
 * `success` / `warning` / `danger` are the exception and stay on the `chip-tone-*`
 * hooks: globals.css already deepens those three in light mode (72% toward
 * black, behind a `:not(.chip-selected)` guard) and those guards are UNLAYERED,
 * so they already win and already pass — 5.61–10.83:1. The other four had no
 * guard and read a RAW accent as ink on a wash of themselves:
 *
 *   `accent`  3.09–3.77:1 in light for cyan / mint / amber / apricot / sage
 *             (`widget-accent-text` resolves to `--widget-accent` = accent 72%
 *             black INSIDE a card, but only deepened for light there, and to the
 *             bare raw accent everywhere else)
 *   `cyan`    3.68:1 light (`#0891b2` on the frosted chip surface)
 *   `violet`  5.70:1 light — passing, but sharing the unguarded pattern
 *
 * All four on a 12px label, which is body text, so 4.5:1. Measured after the mix
 * in Chromium, on the frosted chip surface AND inside a `.widget-card`:
 * accent 8.37–13.05:1 dark / 6.75–11.46:1 light, cyan 10.83:1 dark / 7.65:1
 * light, violet 9.04:1 dark / 10.04:1 light.
 */
const toneMap: Record<ChipTone, string> = {
  neutral: "text-text-secondary border-border",
  accent: "text-[color-mix(in_srgb,var(--color-accent-selected)_55%,var(--color-text-primary))] border-[var(--color-accent-selected)]/25",
  success: "chip-tone-success text-[var(--color-accent-mint)] border-[var(--color-accent-mint)]/25",
  danger: "chip-tone-danger text-[var(--color-accent-rose)] border-[var(--color-accent-rose)]/25",
  warning: "chip-tone-warning text-[var(--color-accent-amber)] border-[var(--color-accent-amber)]/25",
  violet: "text-[color-mix(in_srgb,var(--color-accent-violet)_55%,var(--color-text-primary))] border-[var(--color-accent-violet)]/25",
  cyan: "text-[color-mix(in_srgb,var(--color-accent-cyan)_55%,var(--color-text-primary))] border-[var(--color-accent-cyan)]/25",
};

/**
 * Selected is a SURFACE + INK swap, and the tone's ink is **omitted** rather
 * than overridden — the same technique the fill below uses, one level deeper.
 *
 * The earlier fix removed the base translucent FILL when selected, and that was
 * necessary but not sufficient: `tone="accent"` also contributes
 * `.widget-accent-text`, which is **unlayered** CSS and therefore out-ranks
 * `@layer utilities` no matter where `text-white` sits in the class attribute.
 * So a selected accent chip painted `--color-accent-selected` on the deepened
 * accent fill and measured **2.21:1 dark / 1.99:1 light** — and **1.23:1**
 * inside a `.widget-card`, where the same hook resolves to `--widget-accent`
 * (the accent walked 45% toward white). It was both an AA failure and a chip
 * that looked unselected, which is the failure mode the previous wave recorded
 * twice already. Emitting no tone class at all leaves `text-white` uncontested:
 * 4.60–8.33:1 dark / 7.12–12.52:1 light across the ten accents.
 *
 * The fill is the accent deepened 60% toward black, written out rather than read
 * from `--color-accent-button`. White needs 4.5:1 and the RAW accent clears it
 * for none of the ten presets (mint 1.74:1); `--color-accent-button` was the
 * token for exactly this mix — but `useTheme` writes it as an INLINE style on
 * `<html>`, and an inline declaration out-ranks every `:root[data-theme="…"]`
 * rule, so it resolves to the LIGHT palette in both themes and to nori blue for
 * every accent (`src/hooks/useTheme.tsx` compares `defaultAccentHex.button`
 * against a preset table that holds the DARK hex, so `isPresetValue` never
 * fires). Spelling the mix out keeps the chip correct per theme AND per accent
 * regardless: white on the resulting fill measures 4.60–8.33:1 dark (worst:
 * mint) and 7.12–12.52:1 light (worst: sage) across the ten accents.
 */
const selectedClass =
  "chip-selected bg-[color-mix(in_srgb,var(--color-accent-selected)_60%,black)] text-white border-transparent";

/**
 * Disabled converges on the same neutral raised surface SoftButton uses, for
 * the same reason: `disabled:opacity-50` faded the whole chip toward its
 * backdrop, so an inert chip kept a coloured fill and lost its label — a control
 * that still looked pressable and no longer said what it said. The `!important`
 * modifiers are required, not defensive: the unlayered `.chip-tone-*:not(
 * .chip-selected)` light-mode guards in globals.css would otherwise win.
 * Measured `--color-text-secondary` on `--color-surface-2`: 5.04:1 dark,
 * 6.16:1 light. This is the same figure SoftButton's disabled map converges on,
 * so an inert control looks identical whichever primitive rendered it.
 */
const disabledClass =
  "disabled:!bg-[var(--color-surface-2)] disabled:!text-[var(--color-text-secondary)] disabled:!border-[var(--color-border)] disabled:!opacity-100";

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
      /* The base translucent fill AND the tone's ink are OMITTED when selected,
         not merely overridden. `bg-[var(--color-surface-0)]/20` and the
         selected fill are both Tailwind `bg-*` utilities in the same layer, so
         the later rule in the STYLESHEET wins — not the later class in the
         attribute. With both present the translucent surface won while
         `text-white` still applied, so a selected chip rendered as white ink on
         a 20%-opacity fill: an AA failure, and a chip that looked unselected.
         Same family as the two source-order traps already recorded in
         globals.css (`.calendar-empty-grow` behind `.calendar-empty`, and
         `.glass-strong`'s unlayered `position` beating `@layer utilities`).
         The ink had to go too, because `.widget-accent-text` is UNLAYERED and
         out-ranks `text-white` outright — see `selectedClass` above. */
      className={`inline-flex items-center justify-center gap-1.5 border tap-sm hit-44 disabled:pointer-events-none ${disabledClass} ${
        selected
          ? selectedClass
          : `bg-[var(--color-surface-0)]/20 backdrop-blur-xl ${toneMap[tone]}`
      } ${sizeMap[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
