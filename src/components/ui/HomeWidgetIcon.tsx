import type { ReactNode } from "react";

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
  return state && state !== "default" ? 0.72 : 0.38;
}

function IconArtwork({ variant, state }: { variant: HomeWidgetIconVariant; state?: HomeWidgetIconState }): ReactNode {
  const accent = accentOpacity(state);

  switch (variant) {
    case "briefing":
      return (
        <g stroke="var(--home-widget-icon-ink)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3">
          <rect x="9" y="7" width="30" height="34" rx="5" fill="#fff" />
          <path d="M16 17h16M16 24h11M16 31h8" fill="none" />
          <circle cx="32" cy="32" r="3" fill="var(--home-widget-icon-accent)" opacity={accent} stroke="none" />
        </g>
      );
    case "ask":
      return (
        <g stroke="var(--home-widget-icon-ink)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3">
          <path d="M13 9h22a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5h-9l-8 6v-6h-5a5 5 0 0 1-5-5V14a5 5 0 0 1 5-5Z" fill="#fff" />
          <circle cx="17" cy="21" r="2" fill="var(--home-widget-icon-accent)" opacity={accent} stroke="none" />
          <circle cx="24" cy="21" r="2" fill="var(--home-widget-icon-accent)" stroke="none" />
          <circle cx="31" cy="21" r="2" fill="var(--home-widget-icon-accent)" stroke="none" />
        </g>
      );
    case "suggestions":
      return (
        <g stroke="var(--home-widget-icon-ink)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3">
          <rect x="8" y="11" width="25" height="25" rx="5" fill="#fff" />
          <rect x="16" y="17" width="24" height="24" rx="5" fill="#fff" />
          <path d="m36 6 1.8 4.2L42 12l-4.2 1.8L36 18l-1.8-4.2L30 12l4.2-1.8L36 6Z" fill="var(--home-widget-icon-accent)" opacity={accent} stroke="none" />
        </g>
      );
    case "leaderboard":
      return (
        <g stroke="var(--home-widget-icon-ink)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3">
          <path d="M15 10h18v10c0 7-4 11-9 11s-9-4-9-11V10Z" fill="#fff" />
          <path d="M15 14h-5v3c0 5 3 8 8 8M33 14h5v3c0 5-3 8-8 8M24 31v7M17 40h14" fill="none" />
          <path d="m24 15 2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7-3.4-3.3 4.7-.7 2.2-4.3Z" fill="var(--home-widget-icon-accent)" opacity={accent} stroke="none" />
        </g>
      );
    case "events":
      return (
        <g stroke="var(--home-widget-icon-ink)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3">
          <rect x="8" y="10" width="32" height="30" rx="5" fill="#fff" />
          <path d="M8 19h32M16 7v7M32 7v7" fill="none" />
          <rect x="21" y="25" width="8" height="8" rx="2" fill="var(--home-widget-icon-accent)" opacity={accent} stroke="none" />
        </g>
      );
    case "schedule":
      return (
        <g stroke="var(--home-widget-icon-ink)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3">
          <circle cx="24" cy="24" r="17" fill="#fff" />
          <path d="M24 14v11l7 4" fill="none" />
          <circle cx="24" cy="24" r="3" fill="var(--home-widget-icon-accent)" opacity={accent} stroke="none" />
        </g>
      );
    case "meal":
      return (
        <g stroke="var(--home-widget-icon-ink)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3">
          <circle cx="24" cy="25" r="14" fill="#fff" />
          <circle cx="24" cy="25" r="7" fill="var(--home-widget-icon-accent)" opacity={accent} stroke="none" />
          <path d="M11 9v8c0 3 2 5 4 5s4-2 4-5V9M15 9v31M34 9c4 4 5 10 5 16h-5M34 9v31" fill="none" />
        </g>
      );
    case "tasks":
      return (
        <g stroke="var(--home-widget-icon-ink)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3">
          <rect x="10" y="8" width="28" height="34" rx="5" fill="#fff" />
          <path d="M18 8V6h12v2M16 19l2 2 4-4M16 30l2 2 4-4M26 19h7M26 30h7" fill="none" />
          <circle cx="36" cy="36" r="4" fill="var(--home-widget-icon-accent)" opacity={accent} stroke="none" />
        </g>
      );
    case "week":
      return (
        <g stroke="var(--home-widget-icon-ink)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3">
          <rect x="7" y="11" width="34" height="28" rx="5" fill="#fff" />
          <path d="M14 18h20M14 25h6M14 32h6" fill="none" />
          <rect x="28" y="22" width="7" height="13" rx="2" fill="var(--home-widget-icon-accent)" opacity={accent} stroke="none" />
        </g>
      );
    case "security":
      return (
        <g stroke="var(--home-widget-icon-ink)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3">
          <path d="M24 6 39 11v11c0 10-6 17-15 21-9-4-15-11-15-21V11l15-5Z" fill="#fff" />
          <path d="M24 15v10" fill="none" />
          <circle cx="24" cy="32" r="2.5" fill="var(--home-widget-icon-accent)" opacity={accent} stroke="none" />
        </g>
      );
    case "climate":
      return (
        <g stroke="var(--home-widget-icon-ink)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3">
          <path d="M18 29V12a6 6 0 0 1 12 0v17a9 9 0 1 1-12 0Z" fill="#fff" />
          <path d="M24 19v15" fill="none" />
          <circle cx="24" cy="34" r="4" fill="var(--home-widget-icon-accent)" opacity={accent} stroke="none" />
          <path d="M34 9v4M30 11h8M36 17l3-3M36 23h4" fill="none" />
        </g>
      );
    case "lights":
      return (
        <g stroke="var(--home-widget-icon-ink)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3">
          <path d="M15 27a10 10 0 1 1 18 0c0 5-4 7-5 11H20c-1-4-5-6-5-11Z" fill="#fff" />
          <path d="M20 38h8M22 42h4" fill="none" />
          <circle cx="24" cy="24" r="5" fill="var(--home-widget-icon-accent)" opacity={state === "on" ? 1 : accent} stroke="none" />
        </g>
      );
    case "ledger":
      return (
        <g stroke="var(--home-widget-icon-ink)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3">
          <path d="M10 8h25a4 4 0 0 1 4 4v29H14a4 4 0 0 1-4-4V8Z" fill="#fff" />
          <path d="M10 12H8v26M18 16h13M18 24h13M18 32h8" fill="none" />
          <path d="M32 36v10l4-3 4 3V36" fill="var(--home-widget-icon-accent)" opacity={accent} stroke="none" />
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
      data-variant={variant}
      data-state={state}
    >
      {IconArtwork({ variant, state })}
    </svg>
  );
}
