"use client";

import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export default function PageHeader({ title, subtitle, action, icon, className = "" }: PageHeaderProps) {
  return (
    <div className={`flex items-center justify-between gap-4 px-4 pt-10 pb-5 ${className}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon && <span className="text-2xl">{icon}</span>}
          <h1 className="truncate text-3xl font-bold tracking-tight text-text-primary">{title}</h1>
        </div>
        {subtitle && <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
