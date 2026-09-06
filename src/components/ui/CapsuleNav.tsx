"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import SyncInit from "./SyncInit";

const navItems = [
  {
    href: "/",
    label: "Home",
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
      </svg>
    ),
  },
  {
    href: "/chat",
    label: "Ask",
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3a8 8 0 0 0-8 8c0 1.6.5 3.1 1.3 4.4L4 21l5.6-1.3A8 8 0 1 0 12 3Z" />
        <circle cx="8.5" cy="11" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="11" r="1" fill="currentColor" stroke="none" />
        <circle cx="15.5" cy="11" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    href: "/meals",
    label: "Meals",
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 3v8a4 4 0 0 0 4 4v6" />
        <path d="M8 3v8" />
        <path d="M8 15v6" />
        <path d="M17 3c-2 0-3 2-3 5s1 5 3 5v8" />
      </svg>
    ),
  },
  {
    href: "/tasks",
    label: "Tasks",
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="m8.5 12 2.5 2.5 4.5-5" />
      </svg>
    ),
  },
  {
    href: "/calendar",
    label: "Calendar",
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.5" y="4.5" width="17" height="16" rx="3" />
        <path d="M3.5 9.5h17" />
        <path d="M8 2.5v4" />
        <path d="M16 2.5v4" />
        <path d="M8.5 13.5h.01" />
        <path d="M12 13.5h.01" />
        <path d="M15.5 13.5h.01" />
        <path d="M8.5 17h.01" />
        <path d="M12 17h.01" />
        <path d="M15.5 17h.01" />
      </svg>
    ),
  },
  {
    href: "/ha",
    label: "House",
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 4v4" />
        <path d="M5 12v8" />
        <path d="M3 10h4" />
        <path d="M12 4v9" />
        <path d="M12 17v3" />
        <path d="M10 15h4" />
        <path d="M19 4v3" />
        <path d="M19 11v9" />
        <path d="M17 9h4" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1.5l.8 3.3a8.5 8.5 0 0 1 1.9.8l3.1-1.7 1.4 1.4-1.7 3.1a8.5 8.5 0 0 1 .8 1.9l3.3.8v1.8l-3.3.8a8.5 8.5 0 0 1-.8 1.9l1.7 3.1-1.4 1.4-3.1-1.7a8.5 8.5 0 0 1-1.9.8L12 22.5h-1l-.8-3.3a8.5 8.5 0 0 1-1.9-.8l-3.1 1.7-1.4-1.4 1.7-3.1a8.5 8.5 0 0 1-.8-1.9L1.5 12v-1l3.3-.8a8.5 8.5 0 0 1 .8-1.9l-1.7-3.1 1.4-1.4 3.1 1.7a8.5 8.5 0 0 1 1.9-.8L11 1.5z" />
      </svg>
    ),
  },
];

const EXPAND_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const LABEL_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/** Kid-mode-only tab: the gamified reward shop (mode "kid" = child/pet). */
const rewardsItem = {
  href: "/rewards",
  label: "Rewards",
  icon: (active: boolean) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="8" width="17" height="4" rx="1" />
      <path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
      <path d="M12 8v12" />
      <path d="M12 8s-1.2-4-4-4a2.2 2.2 0 0 0 0 4h4Z" />
      <path d="M12 8s1.2-4 4-4a2.2 2.2 0 0 1 0 4h-4Z" />
    </svg>
  ),
};

/**
 * Kid mode (mirrors useDashboardMode's resolveMode: any signed-in non-parent
 * — child or pet — gets the kid experience): hide House (Home Assistant is
 * adult tooling) and add Rewards. Both modes render exactly 7 items, which
 * is what the 44px-at-390px capsule sizing below is computed for.
 */
function visibleNavItems(currentUser: { role?: string } | null) {
  if (currentUser && currentUser.role !== "parent") {
    const items = navItems.filter((item) => item.href !== "/ha");
    const tasksIdx = items.findIndex((item) => item.href === "/tasks");
    items.splice(tasksIdx + 1, 0, rewardsItem);
    return items;
  }
  return navItems;
}

export default function CapsuleNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser } = useAuth();
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    const checkTheme = () => setIsLight(document.documentElement.getAttribute("data-theme") === "light");
    checkTheme();
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const barBg = isLight ? "rgba(0, 0, 0, 0.16)" : "rgba(8, 10, 12, 0.60)";
  const barBorder = isLight ? "1px solid rgba(0, 0, 0, 0.08)" : "1px solid rgba(255, 255, 255, 0.10)";
  const barShadow = isLight
    ? "0 18px 40px -12px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.55)"
    : "0 24px 48px -12px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.12)";

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
      <div className="pointer-events-auto mx-3 mb-3 pb-safe">
        <div
          className="capsule-nav relative rounded-full"
          style={{
            background: barBg,
            border: barBorder,
            boxShadow: barShadow,
            backdropFilter: "blur(24px) saturate(1.4)",
            WebkitBackdropFilter: "blur(24px) saturate(1.4)",
            // Tap-target sizing: the globals.css default (500px denominator)
            // scaled 56px buttons down to ~41px at a 390px viewport. The dock
            // is 7 items in BOTH modes (kid swaps House for Rewards), so the
            // natural width is 7×56 + 6×6 gap + 24 padding = 452px — with
            // this denominator the 390px scale is 366/452 ≈ 0.81 and every
            // button measures ≈45×45 CSS px (≥44), on one line.
            "--capsule-scale": "min(1, calc((100vw - 1.5rem) / 452px))",
            transform: "scale(var(--capsule-scale))",
            transformOrigin: "bottom center",
          } as React.CSSProperties}
        >
          <div className="flex items-center gap-1.5 px-3 py-2">
            {visibleNavItems(currentUser).map((item) => {
              const isActive = pathname === item.href;

              return (
                <button
                  key={item.href}
                  type="button"
                  aria-label={item.label}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => router.push(item.href)}
                  onPointerEnter={() => router.prefetch(item.href)}
                  className={`capsule-item group relative grid h-14 grid-flow-col items-center rounded-full border tap-sm ${
                    isActive ? "border-[rgba(120,240,90,0.38)]" : "border-transparent"
                  }`}
                  style={{
                    gridTemplateColumns: isActive ? "56px 1fr" : "56px 0fr",
                    background: isActive
                      ? "linear-gradient(135deg, rgba(120,240,90,0.20), rgba(120,240,90,0.06))"
                      : "transparent",
                    boxShadow: isActive
                      ? "0 0 24px -4px rgba(120,240,90,0.35), inset 0 1px 0 rgba(255,255,255,0.14)"
                      : "none",
                    transition: `grid-template-columns 0.38s ${EXPAND_EASE}, background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease, transform 0.15s ease`,
                  }}
                >
                  <span
                    className={`grid h-14 w-14 place-items-center rounded-full transition-all duration-300 ${
                      isActive
                        ? "bg-[var(--capsule-accent)] border border-transparent"
                        : "bg-white/[0.06] border border-white/10"
                    }`}
                    style={{
                      boxShadow: isActive
                        ? "inset 0 1px 0 rgba(255,255,255,0.35), 0 4px 12px -2px rgba(120,240,90,0.50)"
                        : "inset 0 1px 2px rgba(0,0,0,0.35)",
                    }}
                  >
                    <span
                      className={`grid h-6 w-6 place-items-center transition-colors duration-300 ${
                        isActive ? "text-white drop-shadow-sm" : "text-white/55 group-hover:text-white/90"
                      }`}
                    >
                      {item.icon(isActive)}
                    </span>
                  </span>
                  <span className="capsule-label min-w-0 overflow-hidden">
                    <span
                      className={`capsule-label-text block whitespace-nowrap pl-1 pr-4 text-sm font-semibold tracking-tight transition-all duration-300 ${
                        isActive ? "translate-x-0 opacity-100 text-white/95" : "-translate-x-3 opacity-0"
                      }`}
                      style={{
                        transitionTimingFunction: LABEL_EASE,
                        transitionDelay: isActive ? "60ms" : "0ms",
                      }}
                    >
                      {item.label}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <SyncInit />
    </nav>
  );
}
