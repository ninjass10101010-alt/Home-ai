"use client";

import Link from "next/link";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /**
   * How `subtitle` is set. `eyebrow` (the default, and what every existing call
   * site uses) is a short uppercase label ABOVE the title. `lede` is a
   * sentence BELOW the title in body type — for the routes whose subtitle is
   * real copy ("Insights and patterns to optimize your family schedule") rather
   * than a label. Those were being `truncate`d inside a hand-rolled bold-sans
   * header, which cut "Set goals, save money, climb mountai…" mid-word on a
   * phone; `lede` wraps instead and cannot truncate.
   */
  subtitleTone?: "eyebrow" | "lede";
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
  backHref?: string;
  backLabel?: string;
}

export default function PageHeader({ title, subtitle, subtitleTone = "eyebrow", action, icon, className = "", backHref, backLabel = "Back" }: PageHeaderProps) {
  const content = (
    <div className="min-w-0">
      {subtitle && subtitleTone === "eyebrow" && <p className="text-eyebrow mb-1">{subtitle}</p>}
      <div className="flex items-center gap-2.5">
        {icon && <span aria-hidden="true" className="text-2xl leading-none">{icon}</span>}
        <h1 className="truncate text-display text-[1.75rem] sm:text-[2rem] text-text-primary">{title}</h1>
      </div>
      {subtitle && subtitleTone === "lede" && (
        <p className="mt-1.5 max-w-prose text-pretty text-sm leading-relaxed text-text-secondary">{subtitle}</p>
      )}
    </div>
  );

  if (!backHref) {
    return (
      <div className={`flex items-start justify-between gap-4 px-4 pt-10 pb-6 ${className}`}>
        {content}
        {action && <div className="shrink-0 pt-1">{action}</div>}
      </div>
    );
  }

  return (
    <div className={`px-4 pt-10 pb-6 ${className}`}>
      <Link
        href={backHref}
        aria-label={backLabel}
        className="mb-4 inline-flex min-h-16 min-w-16 items-center gap-2 rounded-2xl border border-border bg-[var(--color-surface-0)]/35 px-4 text-sm font-semibold text-text-secondary backdrop-blur-xl tap hover:text-text-primary"
      >
        <span aria-hidden="true">←</span>
        <span>{backLabel}</span>
      </Link>
      <div className="flex items-start justify-between gap-4">
        {content}
        {action && <div className="shrink-0 pt-1">{action}</div>}
      </div>
    </div>
  );
}
