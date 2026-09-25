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
      <div className="flex items-center gap-2">
          {icon && <span aria-hidden="true" className="text-2xl">{icon}</span>}
        <h1 className="truncate text-3xl font-bold tracking-tight text-text-primary">{title}</h1>
      </div>
      {subtitle && <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>}
    </div>
  );

  if (!backHref) {
    return (
      <div className={`flex items-center justify-between gap-4 px-4 pt-10 pb-5 ${className}`}>
        {content}
        {action && <div className="shrink-0">{action}</div>}
      </div>
    );
  }

  return (
    <div className={`px-4 pt-10 pb-5 ${className}`}>
      <Link
        href={backHref}
        aria-label={backLabel}
        className="mb-3 inline-flex min-h-16 min-w-16 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/35 px-4 text-sm font-semibold text-text-secondary backdrop-blur-xl tap hover:text-text-primary"
      >
        <span aria-hidden="true">←</span>
        <span>{backLabel}</span>
      </Link>
      <div className="flex items-center justify-between gap-4">
        {content}
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}
