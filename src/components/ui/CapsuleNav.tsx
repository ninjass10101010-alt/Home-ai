"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useWallMode } from "@/hooks/useWallMode";
import { isNavItemActive, navItemsForRole, navRoleForUser } from "@/lib/nav-items";
import NavIcon from "./NavIcon";
import SyncInit from "./SyncInit";

const EXPAND_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const LABEL_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/**
 * The dock (phone, tablet and wall).
 *
 * Order, roles, icons and the active-item rule all come from `lib/nav-items.ts`
 * — this component owns only the capsule animation. The 2026-09 UI audit
 * (finding 6) found the dock keeping a private list with private inline SVGs and
 * a `pathname === href` check that disagreed with the desktop rail on
 * `/settings/me`, plus a hard-coded lime `rgba(120,240,90,…)` glow that ignored
 * the accent system. All four now live in one place.
 */
export default function CapsuleNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser } = useAuth();
  const { wall } = useWallMode();
  const [isLight, setIsLight] = useState(false);

  // 7 caps in both modes — a parent/guest gets House, a signed-in kid swaps it
  // for Rewards — which is what the `--capsule-scale` math below is sized for.
  const items = navItemsForRole(navRoleForUser(currentUser));

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
            {items.map((item) => {
              const isActive = isNavItemActive(pathname, item);

              return (
                <button
                  key={item.path}
                  type="button"
                  aria-label={item.label}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => router.push(item.path)}
                  onPointerEnter={() => router.prefetch(item.path)}
                  className={`capsule-item group relative grid ${
                    wall ? "h-[72px]" : "h-14"
                  } grid-flow-col items-center rounded-full border tap-sm ${
                    isActive ? "border-[var(--color-nav-active-border)]" : "border-transparent"
                  }`}
                  style={{
                    // Wall: labels are always visible, so both states keep the
                    // label column — the active item's accent styling is the focus.
                    gridTemplateColumns: wall
                      ? "72px 1fr"
                      : isActive
                        ? "56px 1fr"
                        : "56px 0fr",
                    background: isActive
                      ? "linear-gradient(135deg, var(--color-nav-active-sheen), var(--color-nav-active-wash))"
                      : "transparent",
                    boxShadow: isActive
                      ? "0 0 24px -4px var(--color-nav-active-glow), inset 0 1px 0 rgba(255,255,255,0.14)"
                      : "none",
                    transition: `grid-template-columns 0.38s ${EXPAND_EASE}, background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease, transform 0.15s ease`,
                  }}
                >
                  <span
                    className={`grid place-items-center rounded-full transition-all duration-300 ${
                      wall ? "h-[72px] w-[72px]" : "h-14 w-14"
                    } ${
                      isActive
                        ? "bg-[var(--color-nav-active-fill)] border border-transparent"
                        : "bg-white/[0.06] border border-white/10"
                    }`}
                    style={{
                      boxShadow: isActive
                        ? "inset 0 1px 0 rgba(255,255,255,0.35), 0 4px 12px -2px var(--color-nav-active-halo)"
                        : "inset 0 1px 2px rgba(0,0,0,0.35)",
                    }}
                  >
                    <span
                      className={`grid place-items-center ${
                        wall ? "h-8 w-8" : "h-6 w-6"
                      } ${
                        isActive ? "text-white" : "text-white/55 group-hover:text-white/90"
                      } transition-colors duration-300`}
                    >
                      <NavIcon iconKey={item.iconKey} active={isActive} className="h-full w-full" />
                    </span>
                  </span>
                  <span className="capsule-label min-w-0 overflow-hidden">
                    <span
                      className={`capsule-label-text block whitespace-nowrap pl-1 pr-4 ${
                        wall ? "text-base" : "text-sm"
                      } font-semibold tracking-tight transition-all duration-300 ${
                        isActive
                          ? "translate-x-0 opacity-100 text-white/95"
                          : wall
                            ? "translate-x-0 opacity-100"
                            : "-translate-x-3 opacity-0"
                      }`}
                      style={{
                        transitionTimingFunction: LABEL_EASE,
                        transitionDelay: isActive ? "60ms" : "0ms",
                        // The dock scales itself down (--capsule-scale ≈0.73 on a 390px
                        // phone) to stay inside the viewport, which used to shrink the
                        // active label to ~10px. Cancel the scale so the label always
                        // renders at ≈14px; wall mode keeps its fixed text-base.
                        fontSize: wall ? undefined : "clamp(0.9rem, calc(0.85rem / var(--capsule-scale)), 1.35rem)",
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
