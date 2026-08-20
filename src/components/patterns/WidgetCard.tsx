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
          className="pointer-events-none absolute z-30 top-[-12px] left-[-12px] xl:top-[-24px] xl:left-[-24px] w-[88px] h-[88px]"
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `radial-gradient(circle, color-mix(in srgb, var(--widget-tone) 40%, transparent) 0%, color-mix(in srgb, var(--widget-tone) 0%, transparent) 70%)`,
              filter: "blur(10px)",
              animation: "weatherGlowPulse 7s ease-in-out infinite",
            }}
          />
          <div
            className="relative grid h-full w-full place-items-center text-6xl leading-none"
            style={{ filter: "drop-shadow(0 10px 18px rgba(0,0,0,0.35))" }}
          >
            {icon}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
