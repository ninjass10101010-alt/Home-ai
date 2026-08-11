"use client";

import type { ReactNode } from "react";
import WidgetCard from "@/components/patterns/WidgetCard";

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
}

export default function SectionCard({ title, description, icon, action, tone, children, footer, className = "", compact = false }: SectionCardProps) {
  return (
    <WidgetCard tone={tone} icon={icon} className={className}>
      <div className={`flex items-start justify-between gap-4 border-b border-white/10 ${compact ? "p-4 pl-14" : "p-5 pl-14"}`}>
        <div className="min-w-0">
          <h3 className={`font-bold text-text-primary ${compact ? "text-sm" : "text-base"}`}>{title}</h3>
          {description && <p className={`mt-0.5 text-text-secondary ${compact ? "text-[11px]" : "text-xs"}`}>{description}</p>}
        </div>
        {action && <div className="shrink-0 self-center">{action}</div>}
      </div>
      <div className={compact ? "p-4" : "p-5"}>{children}</div>
      {footer && <div className={`border-t border-white/10 ${compact ? "p-4" : "p-5"}`}>{footer}</div>}
    </WidgetCard>
  );
}
