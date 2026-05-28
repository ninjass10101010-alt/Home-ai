"use client";

/**
 * AtmosphericBridge — visual connector that flows between widgets.
 * Renders a gradient wash + drifting particles that spill downward
 * from the weather widget into the Consuela card below.
 */

import { useAtmosphericTheme } from "@/hooks/useAtmosphericTheme";

export default function AtmosphericBridge() {
  const theme = useAtmosphericTheme();

  return (
    <div
      className="atmospheric-bridge pointer-events-none relative"
      style={{ height: "18px", marginTop: "-2px", marginBottom: "-4px", zIndex: 5 }}
    >
      {/* Gradient wash flowing down */}
      <div
        className="absolute inset-0"
        style={{
          background: theme.bridgeGradient,
          opacity: theme.atmosphereOpacity + 0.05,
          filter: "blur(8px)",
        }}
      />

      {/* Drifting particles */}
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(4)].map((_, i) => (
          <span
            key={i}
            className="drift-down-particle"
            style={{
              position: "absolute",
              left: `${15 + i * 25}%`,
              top: "50%",
              fontSize: `${8 + i * 2}px`,
              opacity: theme.atmosphereOpacity * 1.5,
              animationDelay: `${i * 0.8}s`,
              animationDuration: `${4 + i * 1.2}s`,
            }}
          >
            {theme.particleEmoji}
          </span>
        ))}
      </div>

      {/* Subtle glow line */}
      <div
        className="absolute bottom-0 left-[10%] right-[10%] h-px"
        style={{
          background: `linear-gradient(90deg, transparent, ${theme.bridgeGlow}, transparent)`,
        }}
      />
    </div>
  );
}
