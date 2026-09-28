"use client";

import Link from "next/link";
import type { ReactNode } from "react";

interface MoreMenuItemProps {
  icon: ReactNode;
  title: string;
  description?: string;
  href: string;
  badge?: string;
}

export default function MoreMenuItem({ icon, title, description, href, badge }: MoreMenuItemProps) {
  // `next/link` (was a plain <a>): the More… sheet opened by manifest-driven
  // navigation should not do a full document load per tap.
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/30 p-4 backdrop-blur-xl transition hover:bg-[var(--color-surface-0)]/45"
    >
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--color-accent-selected)]/15 text-[var(--color-accent-selected)]">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-bold text-text-primary">{title}</h3>
          {badge && <span className="rounded-full bg-[var(--color-accent-selected)]/15 px-2 py-0.5 text-xs font-bold text-[var(--color-accent-selected)]">{badge}</span>}
        </div>
        {description && <p className="mt-0.5 truncate text-xs text-text-muted">{description}</p>}
      </div>
      <span className="text-text-muted transition group-hover:translate-x-0.5" aria-hidden="true">›</span>
    </Link>
  );
}

