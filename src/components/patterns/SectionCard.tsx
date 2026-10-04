"use client";

import type { ReactNode } from "react";
import WidgetCard from "@/components/patterns/WidgetCard";
import { InsideCardContext } from "@/components/ui/inside-card-context";

interface SectionCardProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  tone?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  compact?: boolean;
  /** Center the icon above a centered title (Home widgets). Default: left-aligned header with the protruding icon. */
  centeredHeader?: boolean;
  /** Heading tag for the title. Default "h3"; pages set "h2" on top-level cards directly under the page h1. Same classes — tag only. */
  headingLevel?: "h2" | "h3";
}

export default function SectionCard({
  title,
  description,
  icon,
  action,
  tone,
  children,
  footer,
  className = "",
  compact = false,
  centeredHeader = false,
  headingLevel = "h3",
}: SectionCardProps) {
  const Heading = headingLevel;
  // One hairline token for every internal divider. `border-white/10` is 10%
  // white: invisible against a white light-theme canvas, so a card's header
  // rule simply disappeared in light while the outer `.widget-card` border
  // (a tone-tinted mix) stayed visible — the divider and the frame disagreed.
  // `border-border` is `--color-text-primary` at 12%, so it reads in both.
  const rule = "border-b border-border";
  // The identity badge overhangs the card's top-left corner, so the header
  // reserved a 72px gutter to clear it. Icon-less cards paid that gutter for
  // nothing: on Settings and /ha a row of cards each indented its title 52px
  // past its own left edge, so the titles could not align with anything.
  const pad = compact ? "p-4" : "p-5";
  const headPad = icon ? (compact ? "p-4 pl-[72px]" : "p-5 pl-[72px]") : pad;

  // Publish "you are already inside a card body" so a nested surface (today:
  // `EmptyState`) drops its own border/fill instead of drawing a second card
  // within this one. Contextual rather than a children-shape sniff — the
  // Pending card on /tasks passes three children and only *renders* an empty
  // state, which a shape test cannot see.
  const body = <InsideCardContext.Provider value>{children}</InsideCardContext.Provider>;

  if (centeredHeader) {
    return (
      <WidgetCard tone={tone} icon={icon} className={className}>
        <div className={`relative shrink-0 ${rule} p-4 pb-3 text-center`}>
          {action && <div className="absolute right-3 top-3">{action}</div>}
          <Heading className={`mt-1 font-bold text-text-primary ${compact ? "text-sm" : "text-base"}`}>{title}</Heading>
          {description && <p className={`mt-0.5 text-text-secondary ${compact ? "text-xs" : "text-xs"}`}>{description}</p>}
        </div>
        <div className={`flex min-h-0 flex-1 flex-col ${pad}`}>{body}</div>
        {footer && <div className={`border-t border-border ${pad}`}>{footer}</div>}
      </WidgetCard>
    );
  }

  return (
    <WidgetCard tone={tone} icon={icon} className={className}>
      <div className={`flex items-start justify-between gap-4 ${rule} ${headPad}`}>
        <div className="min-w-0">
          <Heading className={`font-bold text-text-primary ${compact ? "text-sm" : "text-base"}`}>{title}</Heading>
          {description && <p className="mt-0.5 text-text-secondary text-xs">{description}</p>}
        </div>
        {action && <div className="shrink-0 self-center">{action}</div>}
      </div>
      <div className={`min-h-0 flex-1 ${pad}`}>{body}</div>
      {footer && <div className={`border-t border-border ${pad}`}>{footer}</div>}
    </WidgetCard>
  );
}