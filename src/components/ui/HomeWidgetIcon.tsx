import type { ReactNode } from "react";
import { useId } from "react";

export const HOME_WIDGET_ICON_VARIANTS = [
  "briefing",
  "ask",
  "suggestions",
  "leaderboard",
  "events",
  "schedule",
  "meal",
  "tasks",
  "week",
  "security",
  "climate",
  "lights",
  "ledger",
] as const;

export type HomeWidgetIconVariant = (typeof HOME_WIDGET_ICON_VARIANTS)[number];
export type HomeWidgetIconState = "default" | "near" | "unread" | "on" | "attention";
export type HomeWidgetIconSize = "sm" | "md" | "lg";

interface HomeWidgetIconProps {
  variant: HomeWidgetIconVariant;
  state?: HomeWidgetIconState;
  size?: HomeWidgetIconSize;
  className?: string;
  title?: string;
}

const sizeClasses: Record<HomeWidgetIconSize, string> = {
  sm: "h-8 w-8",
  md: "h-12 w-12",
  lg: "h-16 w-16",
};

function accentOpacity(state?: HomeWidgetIconState) {
  return state && state !== "default" ? 0.95 : 0.6;
}

// ─── Clay palette ──────────────────────────────────────────────────────────
// Each widget owns an opaque, saturated family: hi = lit top, mid = body,
// lo = shaded base, detail = the element that carries the card's tone accent,
// ink = line work, glow = the halo behind the artwork. Opaque on purpose: the
// artwork sits on a translucent card wash, and a translucent icon loses a
// further contrast step in light mode.
type Palette = { hi: string; mid: string; lo: string; detail: string; ink: string; glow: string };

const PALETTES: Record<HomeWidgetIconVariant, Palette> = {
  briefing:    { hi: "#FFE9A8", mid: "#FB923C", lo: "#DB5A1E", detail: "#34D399", ink: "#5B2A0F", glow: "#FDBA74" },
  ask:         { hi: "#D9CCFF", mid: "#8B5CF6", lo: "#5B21B6", detail: "#FDE68A", ink: "#2E1065", glow: "#C4B5FD" },
  suggestions: { hi: "#FFF3B0", mid: "#FBBF24", lo: "#B45309", detail: "#F472B6", ink: "#5F3A06", glow: "#FDE68A" },
  leaderboard: { hi: "#FFE49A", mid: "#F59E0B", lo: "#B45309", detail: "#FFF7ED", ink: "#5F3A06", glow: "#FCD34D" },
  events:      { hi: "#BFE0FF", mid: "#3B82F6", lo: "#1D4ED8", detail: "#FB7185", ink: "#0B2A66", glow: "#93C5FD" },
  schedule:    { hi: "#B8F5EA", mid: "#14B8A6", lo: "#0F766E", detail: "#FDE68A", ink: "#0A3A36", glow: "#5EEAD4" },
  meal:        { hi: "#FFD5CB", mid: "#F1654D", lo: "#B3261E", detail: "#FDE68A", ink: "#5A150F", glow: "#FCA5A5" },
  tasks:       { hi: "#BFF3DC", mid: "#10B981", lo: "#047857", detail: "#FDE68A", ink: "#064E3B", glow: "#6EE7B7" },
  week:        { hi: "#CDD8FF", mid: "#6366F1", lo: "#3730A3", detail: "#F59E0B", ink: "#1E1B4B", glow: "#A5B4FC" },
  security:    { hi: "#C9E6FF", mid: "#2C7BE5", lo: "#123E8B", detail: "#FBBF24", ink: "#0A2A5E", glow: "#93C5FD" },
  climate:     { hi: "#DFF3FF", mid: "#60A5FA", lo: "#1E40AF", detail: "#F87171", ink: "#0C2A52", glow: "#BFDBFE" },
  lights:      { hi: "#FFF6CC", mid: "#FBBF24", lo: "#B45309", detail: "#FDE68A", ink: "#5F3A06", glow: "#FDE68A" },
  ledger:      { hi: "#C6F3D6", mid: "#22A55E", lo: "#14663A", detail: "#FBBF24", ink: "#0B3D22", glow: "#86EFAC" },
};

// Idle loops are transform/opacity only and live on a single group per icon,
// so the wall panel animates ~15 cheap layers instead of the 40+ it carried
// before. Timing, origin and the reduced-motion opt-out all live in
// globals.css (.hwi-m) — inline styles would outrank the media query.
const motion = (variant: HomeWidgetIconVariant) => ({ className: `hwi-m hwi-m-${variant}` });

function Artwork({ variant, p, id }: { variant: HomeWidgetIconVariant; p: Palette; id: string }): ReactNode {
  const body = `url(#${id}-body)`;
  const soft = `url(#${id}-soft)`;
  const shine = `url(#${id}-shine)`;
  const tone = (opacity: number) => ({ fill: "var(--home-widget-icon-accent)", opacity });

  switch (variant) {
    // Sunrise over hills: the sun climbs a few pixels on its own loop.
    case "briefing":
      return (
        <g filter={soft}>
          <circle cx="24" cy="21" r="10" fill={body} />
          <g {...motion("briefing")}>
            <circle cx="24" cy="21" r="10" fill={shine} opacity="0.55" />
            <path d="M24 5v4M24 33v4M8 21h4M36 21h4M12.7 9.7l2.8 2.8M32.5 29.5l2.8 2.8M35.3 9.7l-2.8 2.8M15.5 29.5l-2.8 2.8"
              stroke={p.hi} strokeWidth="2.4" strokeLinecap="round" opacity="0.9" />
          </g>
          <path d="M4 40c6-9 12-9 18-2 5 6 12 5 18-2v6H4v-2Z" fill={p.detail} />
          <path d="M4 44h40v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2Z" fill={p.lo} opacity="0.5" />
          <rect x="31" y="35" width="10" height="10" rx="3" {...tone(accentOpacity(undefined))} />
        </g>
      );

    // Chat bubble with a typing cadence across three dots.
    case "ask":
      return (
        <g filter={soft}>
          <path d="M11 8h26a6 6 0 0 1 6 6v15a6 6 0 0 1-6 6H24l-9 8v-8a6 6 0 0 1-6-6V14a6 6 0 0 1 6-6Z" fill={body} />
          <path d="M13 11h20a5 5 0 0 1 5 5v3c-8-3-19-2-25 2-3 2-6 2-8 1v-5a5 5 0 0 1 5-5Z" fill={shine} opacity="0.45" />
          <g {...motion("ask")} fill={p.detail}>
            <circle cx="16" cy="22" r="2.6" />
            <circle cx="24" cy="22" r="2.6" />
            <circle cx="32" cy="22" r="2.6" />
          </g>
          <circle cx="35" cy="34" r="6" {...tone(accentOpacity(undefined))} />
        </g>
      );

    // Big sparkle with a small companion: the classic "we noticed something".
    case "suggestions":
      return (
        <g filter={soft}>
          <g {...motion("suggestions")}>
            <path d="M20 4c1.6 7.8 4.2 10.4 12 12-7.8 1.6-10.4 4.2-12 12-1.6-7.8-4.2-10.4-12-12 7.8-1.6 10.4-4.2 12-12Z" fill={body} />
          </g>
          <path d="M36 24c.9 4.4 2.3 5.8 6.7 6.7-4.4.9-5.8 2.3-6.7 6.7-.9-4.4-2.3-5.8-6.7-6.7 4.4-.9 5.8-2.3 6.7-6.7Z" fill={p.detail} />
          <circle cx="11" cy="38" r="4" {...tone(accentOpacity(undefined))} />
          <circle cx="17" cy="11" r="2.2" fill={p.hi} opacity="0.85" />
        </g>
      );

    // Trophy with a light sweeping the cup.
    case "leaderboard":
      return (
        <g filter={soft}>
          <path d="M14 7h20v11c0 7-4.5 11-10 11S14 25 14 18V7Z" fill={body} />
          <path d="M14 11H8v3c0 5 3 8 7 8M34 11h6v3c0 5-3 8-7 8" stroke={p.lo} strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M24 29v7M16 42h16l-2-6H18l-2 6Z" fill={p.lo} />
          <g clipPath={`url(#${id}-clip)`}>
            <g {...motion("leaderboard")}>
              <rect x="4" y="4" width="7" height="26" rx="3" fill="#FFFFFF" opacity="0.5" transform="rotate(18 24 18)" />
            </g>
          </g>
          <path d="m24 11 2 4.2 4.6.7-3.3 3.2.8 4.6L24 21.6l-4.1 2.1.8-4.6-3.3-3.2 4.6-.7L24 11Z" fill={p.detail} />
          <rect x="33" y="33" width="9" height="9" rx="3" {...tone(accentOpacity(undefined))} />
        </g>
      );

    // Calendar with the today chip lifting.
    case "events":
      return (
        <g filter={soft}>
          <rect x="6" y="10" width="36" height="32" rx="7" fill={body} />
          <path d="M6 17h36v-3a7 7 0 0 0-7-7H13a7 7 0 0 0-7 7v3Z" fill={p.detail} />
          <path d="M15 5v9M33 5v9" stroke={p.ink} strokeWidth="3.4" strokeLinecap="round" />
          <g {...motion("events")}>
            <rect x="20" y="24" width="11" height="11" rx="3.5" fill={p.hi} />
          </g>
          <g fill={p.hi} opacity="0.6">
            <rect x="11" y="24" width="6" height="6" rx="2" />
            <rect x="33" y="24" width="6" height="6" rx="2" />
            <rect x="11" y="33" width="6" height="6" rx="2" />
            <rect x="33" y="33" width="6" height="6" rx="2" />
          </g>
          <rect x="11" y="33" width="6" height="6" rx="2" {...tone(accentOpacity(undefined))} />
        </g>
      );

    // Clock: the minute hand keeps time.
    case "schedule":
      return (
        <g filter={soft}>
          <circle cx="24" cy="25" r="18" fill={body} />
          <circle cx="24" cy="25" r="13" fill={shine} opacity="0.4" />
          <path d="M24 10V6M39 25h4M24 40v4M9 25H5" stroke={p.lo} strokeWidth="2.6" strokeLinecap="round" />
          <path d="M24 25V15" stroke={p.ink} strokeWidth="3" strokeLinecap="round" />
          <g {...motion("schedule")}>
            <path d="M24 25l8 5" stroke={p.ink} strokeWidth="3" strokeLinecap="round" />
          </g>
          <circle cx="24" cy="25" r="2.6" fill={p.detail} />
          <circle cx="38" cy="11" r="5" {...tone(accentOpacity(undefined))} />
        </g>
      );

    // Noodle bowl with steam rising on a stagger.
    case "meal":
      return (
        <g filter={soft}>
          <g {...motion("meal")} stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity="0.75" fill="none">
            <path d="M17 15c0-4 3-4 3-8" />
            <path d="M24 14c0-4 3-4 3-8" />
            <path d="M31 15c0-4 3-4 3-8" />
          </g>
          <path d="M5 24h38c0 11-8 18-19 18S5 35 5 24Z" fill={body} />
          <path d="M5 24h38c0 3-.5 5.4-1.5 7.5H6.5C5.5 29.4 5 27 5 24Z" fill={p.hi} opacity="0.6" />
          <path d="M14 21c2-6 8-8 14-6 4 1.4 7 4 9 6" stroke={p.detail} strokeWidth="3.2" fill="none" strokeLinecap="round" />
          <path d="M8 44h32v2a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-2Z" fill={p.lo} opacity="0.55" />
          <circle cx="40" cy="16" r="5" {...tone(accentOpacity(undefined))} />
        </g>
      );

    // Checklist: the second check marks itself in.
    case "tasks":
      return (
        <g filter={soft}>
          <rect x="7" y="6" width="34" height="38" rx="7" fill={body} />
          <path d="M17 6V4h14v2" stroke={p.lo} strokeWidth="3" fill="none" strokeLinecap="round" />
          <g stroke={p.hi} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.85">
            <path d="m13 18 3 3 6-6" />
            <path d="M26 19h8" />
          </g>
          <g {...motion("tasks")} stroke={p.detail} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" fill="none">
            <path d="m13 30 3 3 6-6" />
          </g>
          <path d="M26 31h8" stroke={p.hi} strokeWidth="3" strokeLinecap="round" opacity="0.7" />
          <rect x="11" y="36" width="12" height="5" rx="2.5" {...tone(accentOpacity(undefined))} />
        </g>
      );

    // Week strip with the load bars growing in sequence.
    case "week":
      return (
        <g filter={soft}>
          <rect x="5" y="11" width="38" height="28" rx="7" fill={body} />
          <path d="M5 18h38v-3a7 7 0 0 0-7-7H12a7 7 0 0 0-7 7v3Z" fill={p.lo} opacity="0.65" />
          <g {...motion("week")} fill={p.detail}>
            <rect x="11" y="29" width="5" height="6" rx="2" />
            <rect x="21" y="23" width="5" height="12" rx="2" />
            <rect x="31" y="26" width="5" height="9" rx="2" />
          </g>
          <g fill={p.hi} opacity="0.55">
            <rect x="12" y="14" width="5" height="3" rx="1.5" />
            <rect x="22" y="14" width="5" height="3" rx="1.5" />
            <rect x="32" y="14" width="5" height="3" rx="1.5" />
          </g>
          <circle cx="41" cy="36" r="5" {...tone(accentOpacity(undefined))} />
        </g>
      );

    // Shield that breathes when the state asks for attention.
    case "security":
      return (
        <g filter={soft}>
          <path d="M24 3 41 9v13c0 11-7 19-17 23-10-4-17-12-17-23V9L24 3Z" fill={body} />
          <path d="M24 6 38 11v9c0 9-5.6 15.6-14 19.4V6Z" fill={shine} opacity="0.28" />
          <g {...motion("security")}>
            <rect x="19" y="20" width="10" height="11" rx="3" fill={p.detail} />
            <path d="M21 20v-3a3 3 0 0 1 6 0v3" stroke={p.detail} strokeWidth="2.4" fill="none" strokeLinecap="round" />
          </g>
          <path d="M24 3v40" stroke={p.lo} strokeWidth="1.4" opacity="0.35" />
          <circle cx="40" cy="38" r="5" {...tone(accentOpacity(undefined))} />
        </g>
      );

    // Thermometer: the column swells with the reading.
    case "climate":
      return (
        <g filter={soft}>
          <path d="M19 27V10a6 6 0 0 1 12 0v17a9.5 9.5 0 1 1-12 0Z" fill={body} />
          <path d="M22 26V11a3 3 0 0 1 6 0v15a7 7 0 1 1-6 0Z" fill={p.hi} opacity="0.5" />
          <g {...motion("climate")}>
            <path d="M25 34V16" stroke={p.detail} strokeWidth="4.4" strokeLinecap="round" />
            <circle cx="25" cy="35" r="5" fill={p.detail} />
          </g>
          <g stroke={p.hi} strokeWidth="2.2" strokeLinecap="round" opacity="0.8">
            <path d="M34 8h7M34 14h5M34 20h7" />
          </g>
          <circle cx="10" cy="12" r="4.5" {...tone(accentOpacity(undefined))} />
        </g>
      );

    // Bulb with a filament halo that breathes.
    case "lights":
      return (
        <g filter={soft}>
          <circle cx="24" cy="20" r="13" fill={body} />
          <circle cx="24" cy="20" r="8" fill={shine} opacity="0.5" />
          <g {...motion("lights")}>
            <circle cx="24" cy="20" r="5.5" fill={p.hi} opacity="0.9" />
          </g>
          <path d="M20 32h8v4a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3v-4Z" fill={p.lo} />
          <path d="M20 35h8M21 39h6" stroke={p.ink} strokeWidth="1.8" strokeLinecap="round" opacity="0.6" />
          <path d="M24 2v4M6 20h4M38 20h4M11 7l3 3M34 10l3-3" stroke={p.detail} strokeWidth="2.4" strokeLinecap="round" />
          <rect x="31" y="33" width="9" height="9" rx="3" {...tone(accentOpacity(undefined))} />
        </g>
      );

    // Ledger: the coin settles on the balance.
    case "ledger":
      return (
        <g filter={soft}>
          <path d="M9 6h26a5 5 0 0 1 5 5v31H14a5 5 0 0 1-5-5V6Z" fill={body} />
          <path d="M9 10h-3v27a5 5 0 0 0 5 5h3v-2H11a5 5 0 0 1-5-5V10h3Z" fill={p.lo} />
          <g stroke={p.hi} strokeWidth="2.6" strokeLinecap="round" opacity="0.8">
            <path d="M17 15h16M17 22h16M17 29h10" />
          </g>
          <path d="M34 4h9v14l-4.5-3.4L34 18V4Z" {...tone(accentOpacity(undefined))} />
          <g {...motion("ledger")}>
            <circle cx="32" cy="35" r="7" fill={p.detail} />
            <path d="M32 31.5v7M29.8 33.4h4.4M29.8 36.6h4.4" stroke={p.lo} strokeWidth="1.6" strokeLinecap="round" />
          </g>
        </g>
      );
  }
}

export default function HomeWidgetIcon({
  variant,
  state,
  size = "md",
  className,
  title,
}: HomeWidgetIconProps) {
  // Gradient ids are per-instance: 12 icons on one dashboard would otherwise
  // collide on the same url(#…) and every card would borrow the first palette.
  const id = `hwi-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const p = PALETTES[variant];
  const classes = [
    "home-widget-icon",
    state ? `home-widget-icon-state-${state}` : undefined,
    "shrink-0",
    sizeClasses[size],
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const decorative = !title;

  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden={decorative ? "true" : undefined}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : title}
      focusable="false"
      className={classes}
      style={{ transformBox: "view-box", transformOrigin: "24px 24px" }}
      data-variant={variant}
      data-state={state}
    >
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor={p.hi} />
          <stop offset="52%" stopColor={p.mid} />
          <stop offset="100%" stopColor={p.lo} />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <rect x="12" y="5" width="24" height="27" rx="6" />
        </clipPath>
        <filter id={`${id}-soft`} x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="0" dy="1.6" stdDeviation="1.3" floodColor="#0B1020" floodOpacity="0.32" />
        </filter>
      </defs>
      <circle cx="24" cy="24" r="22" fill={p.glow} opacity="0.16" />
      {Artwork({ variant, p, id })}
    </svg>
  );
}

