"use client";

import type { CSSProperties, ReactNode } from "react";

interface WidgetCardProps {
  /** Identity color (hex or CSS var) that drives the gradient, glow, border and halo. */
  tone?: string;
  /** Emoji/element rendered protruding from the card's top-left corner with a glow halo. */
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export default function WidgetCard({ tone, icon, children, className = "", style }: WidgetCardProps) {
  return (
    <div
      className={`widget-card ${className}`}
      style={{ ...(tone ? ({ "--widget-tone": tone } as CSSProperties) : null), ...style }}
    >
      {icon && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-30 -top-3 -left-3 xl:-top-5 xl:-left-5 w-[88px] h-[88px]"
        >
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `radial-gradient(circle, color-mix(in srgb, var(--widget-tone) 32%, transparent) 0%, transparent 68%)`,
              filter: "blur(12px)",
            }}
          />
          <div
            className="relative grid h-full w-full place-items-center text-6xl leading-none"
            style={{ filter: "drop-shadow(0 8px 16px rgba(0,0,0,0.30))" }}
          >
            {icon}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
