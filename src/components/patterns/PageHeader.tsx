"use client";

import Link from "next/link";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
  backHref?: string;
  backLabel?: string;
}

export default function PageHeader({ title, subtitle, action, icon, className = "", backHref, backLabel = "Back" }: PageHeaderProps) {
  const content = (
    <div className="min-w-0">
      {subtitle && <p className="text-eyebrow mb-1">{subtitle}</p>}
      <div className="flex items-center gap-2.5">
        {icon && <span aria-hidden="true" className="text-2xl leading-none">{icon}</span>}
        <h1 className="truncate text-display text-[1.75rem] sm:text-[2rem] text-text-primary">{title}</h1>
      </div>
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
        className="mb-4 inline-flex min-h-16 min-w-16 items-center gap-2 rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/35 px-4 text-sm font-semibold text-text-secondary backdrop-blur-xl tap hover:text-text-primary"
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
