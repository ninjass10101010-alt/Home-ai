"use client";

import type { CSSProperties, ReactNode } from "react";

interface WidgetCardProps {
  /** Identity color (hex or CSS var) that drives the gradient, glow, border and halo. */
  tone?: string;
  /** Element rendered as the card's identity badge, seated on its top-left corner. */
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
          className="pointer-events-none absolute z-30 -top-1 -left-1 grid h-14 w-14 place-items-center rounded-full xl:-top-2 xl:-left-2"
          style={{
            // A seated glass disc rather than a free-floating glyph. The badge
            // was an 88px box holding a 60px emoji hung off the corner on a
            // blurred halo: a multi-colour photographic sticker that overhung
            // the card's own radius, collided with its border, and read as an
            // image pasted onto the surface. On the disc the glyph is a
            // consistent 30px everywhere and the card's silhouette stays
            // intact — so the motif survives without the sticker. The fill is
            // mixed toward the theme's own surface (not toward white) so the
            // badge stays a quiet tint in light instead of a neon blob, and the
            // glow is kept tight enough not to bleed past the card edge.
            background:
              "radial-gradient(circle at 32% 26%, color-mix(in srgb, var(--widget-tone) 34%, var(--color-surface-1)) 0%, color-mix(in srgb, var(--widget-tone) 20%, var(--color-surface-1)) 62%, color-mix(in srgb, var(--widget-tone) 30%, var(--color-surface-1)) 100%)",
            boxShadow:
              "0 0 0 1px color-mix(in srgb, var(--widget-tone) 42%, transparent), 0 8px 18px -10px color-mix(in srgb, var(--widget-tone) 60%, transparent), inset 0 1px 0 color-mix(in srgb, white 30%, transparent)",
          }}
        >
          <div className="grid h-full w-full place-items-center text-[30px] leading-none">{icon}</div>
        </div>
      )}
      {children}
    </div>
  );
}