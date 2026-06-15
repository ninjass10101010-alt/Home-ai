"use client";

import type { ReactNode } from "react";

interface ListRowProps {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  leftRailColor?: string;
  onClick?: () => void;
  className?: string;
  "aria-label"?: string;
}

export default function ListRow({ leading, title, subtitle, trailing, leftRailColor, onClick, className = "", "aria-label": ariaLabel }: ListRowProps) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!onClick) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className={`group relative flex items-center gap-3 rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/30 p-3 backdrop-blur-xl transition-all duration-200 hover:bg-[var(--color-surface-0)]/45 active:scale-[0.99] ${onClick ? "cursor-pointer" : ""} ${className}`}
    >
      {leftRailColor && <span className="absolute left-0 top-3 bottom-3 w-1 rounded-full" style={{ backgroundColor: leftRailColor }} />}
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-text-primary">{title}</div>
        {subtitle && <div className="mt-0.5 truncate text-xs text-text-muted">{subtitle}</div>}
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  );
}
