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
  /** Center the icon above a centered title (Home widgets). Default: left-aligned header with the protruding icon. */
  centeredHeader?: boolean;
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
}: SectionCardProps) {
  if (centeredHeader) {
    return (
      <WidgetCard tone={tone} className={className}>
        <div className="relative shrink-0 border-b border-white/10 p-4 pb-3 text-center">
          {action && <div className="absolute right-3 top-3">{action}</div>}
          {icon && (
            <div className="relative mx-auto h-9 w-9">
              <div
                aria-hidden="true"
                className="absolute inset-0"
                style={{
                  background: `radial-gradient(circle, color-mix(in srgb, var(--widget-tone) 40%, transparent) 0%, color-mix(in srgb, var(--widget-tone) 0%, transparent) 70%)`,
                  filter: "blur(8px)",
                  animation: "weatherGlowPulse 7s ease-in-out infinite",
                }}
              />
              <div
                className="relative grid h-9 w-9 place-items-center text-xl leading-none"
                style={{ filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.35))" }}
              >
                {icon}
              </div>
            </div>
          )}
          <h3 className={`mt-1.5 font-bold text-text-primary ${compact ? "text-sm" : "text-base"}`}>{title}</h3>
          {description && <p className={`mt-0.5 text-text-secondary ${compact ? "text-[11px]" : "text-xs"}`}>{description}</p>}
        </div>
        <div className={`flex min-h-0 flex-1 flex-col ${compact ? "p-4" : "p-5"}`}>{children}</div>
        {footer && <div className={`border-t border-white/10 ${compact ? "p-4" : "p-5"}`}>{footer}</div>}
      </WidgetCard>
    );
  }

  // Default path: unchanged from today (icon passes through to WidgetCard's protruding slot).
  return (
    <WidgetCard tone={tone} icon={icon} className={className}>
      <div className={`flex items-start justify-between gap-4 border-b border-white/10 ${compact ? "p-4 pl-14" : "p-5 pl-14"}`}>
        <div className="min-w-0">
          <h3 className={`font-bold text-text-primary ${compact ? "text-sm" : "text-base"}`}>{title}</h3>
          {description && <p className={`mt-0.5 text-text-secondary ${compact ? "text-[11px]" : "text-xs"}`}>{description}</p>}
        </div>
        {action && <div className="shrink-0 self-center">{action}</div>}
      </div>
      <div className={`min-h-0 flex-1 ${compact ? "p-4" : "p-5"}`}>{children}</div>
      {footer && <div className={`border-t border-white/10 ${compact ? "p-4" : "p-5"}`}>{footer}</div>}
    </WidgetCard>
  );
}
