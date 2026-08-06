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
        <div className="absolute z-30 pointer-events-none" style={{ top: -14, left: -14 }}>
          <div className="relative h-14 w-14">
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
              className="grid h-14 w-14 place-items-center text-3xl leading-none"
              style={{ filter: "drop-shadow(0 8px 14px rgba(0,0,0,0.35))" }}
            >
              {icon}
            </div>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
