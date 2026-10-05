"use client";

import type { CSSProperties, ReactNode } from "react";
import WidgetCard from "@/components/patterns/WidgetCard";

interface StatTileProps {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  tone?: "accent" | "success" | "warning" | "danger";
  compact?: boolean;
  /** 0–1 fill drawn as a hairline along the card's base — honest fractions only */
  progress?: number | null;
  /**
   * Headline KPI treatment for a wide band (Home's stat row): the numeral is
   * the thing being read from across a room, so it steps up at `xl` and the
   * tile takes desktop padding.
   */
  wide?: boolean;
}

const toneHex = {
  accent: "var(--color-accent-selected)",
  success: "var(--color-accent-mint)",
  warning: "var(--color-accent-amber)",
  danger: "var(--color-accent-rose)",
};

/**
 * The label/detail ink per tone — the same `--color-accent-ink-*` recipe
 * Avatar.tsx and Chip.tsx use. The neutral `text-text-secondary`/`muted`
 * tokens sat on the widget's own tone wash (16%→5% accent over glass) and
 * measured 3.97–4.45:1 in dark on the tinted tiles. The ink token walks the
 * tone toward the theme's body ink, so it holds AA on the wash in both
 * themes (documented worst case 4.75:1 dark / 4.60:1 light). Literal class
 * strings — Tailwind's scanner cannot see an interpolated arbitrary value.
 */
const toneInkClass: Record<"accent" | "success" | "warning" | "danger", string> = {
  accent: "text-[var(--color-accent-ink)]",
  success: "text-[var(--color-accent-ink-mint)]",
  warning: "text-[var(--color-accent-ink-amber)]",
  danger: "text-[var(--color-accent-ink-rose)]",
};

/**
 * `.widget-card` declares `display: flex; flex-direction: column` in an
 * **unlayered** rule, and unlayered declarations out-rank Tailwind's
 * `@layer utilities`. Every layout utility on a tile therefore loses silently:
 * `flex-row` kept the compact KPI chip a stacked poster at every width, and
 * `grid` would lose the same way. `display` is set inline, which no class rule
 * can out-rank; the *track sizing* stays in utilities (`grid-template-columns`
 * is a property `.widget-card` never sets) so the wall treatment can still
 * change at `xl`.
 *
 * The compact placement is explicit rather than left to `flex-wrap`, which
 * packed icon + numeral + label differently on each of three near-identical
 * tiles and left the row ragged:
 *
 *   ┌───────────────┐   xl:  ┌────────────────────────────┐
 *   │ [icon]  0     │        │ [icon]  0   Events · Today  │
 *   │ Events        │        └────────────────────────────┘
 *   │ Today         │
 *   └───────────────┘
 */
const GRID: CSSProperties = { display: "grid", alignContent: "start", alignItems: "center" };

/**
 * `value`, `label` and `detail` are direct children of the tile, in that order —
 * a structural contract several callers and tests read (the label's previous
 * sibling is the value). Placement is therefore done with `col-start` /
 * `row-start` utilities and inline `display`, never by re-parenting.
 */
export default function StatTile({ label, value, detail, icon, tone = "accent", compact = false, progress = null, wide = false }: StatTileProps) {
  const clamped = progress === null ? null : Math.max(0, Math.min(1, progress));
  return (
    <WidgetCard
      tone={toneHex[tone]}
      style={compact ? GRID : undefined}
      className={`relative min-w-0 flex-1 overflow-hidden ${
        compact
          ? `grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-0.5 p-3 ${
              wide ? "md:grid-cols-[auto_auto_minmax(0,1fr)] md:gap-x-3 xl:gap-x-3.5 xl:p-5" : ""
            }`
          : "flex flex-col gap-2 p-4 lg:gap-x-3 lg:px-5 lg:py-4"
      }`}
    >
      {icon && (
        <div
          className={`grid shrink-0 place-items-center rounded-xl bg-white/[0.07] ring-1 ring-white/[0.06] ${compact ? "col-start-1 row-start-1 h-7 w-7 text-sm" : "h-8 w-8 text-base lg:order-1 lg:self-end"}`}
          style={{ color: `color-mix(in srgb, var(--widget-tone) 82%, white)` }}
        >
          {icon}
        </div>
      )}
      <div className={`font-bold tracking-tight text-text-primary text-numeral-hero leading-none ${compact ? `col-start-2 row-start-1 text-[1.5rem] ${wide ? "md:col-start-2 md:row-start-1 md:row-span-2 xl:text-[2.75rem] sm:text-[1.7rem]" : ""}` : "text-2xl lg:order-1"}`}>{value}</div>
      <div className={`text-xs font-medium ${toneInkClass[tone]} ${compact ? `col-start-1 row-start-2 col-span-2 ${wide ? "md:col-start-3 md:row-start-1 md:col-span-1 md:justify-self-end md:text-right" : ""}` : "lg:order-2 lg:ml-auto lg:max-w-[45%] lg:text-right"}`}>{label}</div>
      {detail && <div className={`text-xs ${toneInkClass[tone]} ${compact ? `col-start-1 row-start-3 col-span-2 ${wide ? "md:col-start-3 md:row-start-2 md:col-span-1 md:justify-self-end md:text-right" : ""}` : "lg:order-2 lg:ml-auto lg:max-w-[45%] lg:text-right"}`}>{detail}</div>}
      {/* After `detail` in the DOM (the label's previous sibling is the value —
          a contract callers read). */}
      {clamped !== null && (
        <span className={`text-eyebrow whitespace-nowrap !tracking-[0.08em] opacity-60 ${compact ? `col-start-1 row-start-4 col-span-2 ${wide ? "md:col-start-3 md:row-start-3 md:col-span-1 md:justify-self-end md:text-right" : ""}` : "lg:order-3 lg:pb-1"}`}>
          {Math.round(clamped * 100)}%
        </span>
      )}
      {/* The base hairline is absolute at every width. In flow it added an
          11px gap-plus-rule to a tile that is barely 90px tall, and on a wall
          it drew a 619px saturated rule under a single digit. */}
      {clamped !== null && (
        <div className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-white/[0.07]">
          <div
            className="h-full rounded-full transition-[width] duration-1000"
            style={{ width: `${clamped * 100}%`, background: `color-mix(in srgb, var(--widget-tone) 72%, white 8%)` }}
          />
        </div>
      )}
    </WidgetCard>
  );
}
