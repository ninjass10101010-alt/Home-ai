"use client";

import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useWallMode } from "@/hooks/useWallMode";
import { isNavItemActive, navItemsForRole, navRoleForUser } from "@/lib/nav-items";
import NavIcon from "./NavIcon";
import SyncInit from "./SyncInit";

const EXPAND_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const LABEL_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/**
 * The dock's glass over the page, and the idle cap circle's fill share of
 * `--color-surface-2`. Exported (and interpolated into the CSS below) so
 * `tests/unit/capsule-nav-legibility.test.tsx` composites exactly the numbers
 * the browser composites, rather than a copy of them.
 */
export const BAR_ALPHA = 0.68;
export const IDLE_CIRCLE_PCT = 70;

/**
 * Responsive geometry, inherited from the `<nav>` so both the page-edge margin
 * and the capsule itself can read it.
 *
 * `--capsule-cap` is the cap **cell** — the hit box — not the visible circle,
 * and it never drops below 44px, so every one of the seven caps is a true
 * 44x44 in *rendered* CSS px at every width from 320px up. That used to be
 * false: the bar carried `transform: scale((100vw - 24px) / 452px)`, which
 * scales the whole subtree including `.hit-44`'s pseudo box, so the 44px hit box
 * measured 36.7px at 320, 41.6 at 360 and 43.5 at 375. The scale is gone; the
 * caps are sized instead of shrunk.
 *
 * The dock stays visually compact — the circle is inset ≤2px inside its cell and
 * the glyph keeps the old 24-in-56 ratio (`3/7`) — so a cap reads the size it
 * always did (circle: then → now):
 *
 *   width 320  360  390  428  452  480+
 *   then  36.7 41.6 45.4  50.0 53.0 56.0
 *   now   40.8 42.9 44.0 46.6 50.7 56.0
 *
 * The bar fills the viewport exactly by construction —
 * `7×cap + 6×gap + 2×pad + 2px border = 100vw − 2×edge`, which is why `--capsule-cap`
 * divides what is left after the three spacers rather than using a fixed
 * denominator. Below ~420px gap/pad/edge tighten towards zero, because 7×44px =
 * 308px already leaves only 12px of slack at a 320px viewport: the one place the
 * house 44px rule and "never make the dock huge" pull against each other, and the
 * 44px floor wins.
 */
export const GEOMETRY = {
  "--capsule-edge": "clamp(2px, calc((100vw - 320px) * 0.12), 12px)",
  "--capsule-pad": "clamp(1px, calc((100vw - 320px) * 0.12), 12px)",
  "--capsule-gap": "clamp(0px, calc((100vw - 320px) * 0.06), 6px)",
  "--capsule-cap": "clamp(44px, calc((100vw - 2 * var(--capsule-edge) - 2 * var(--capsule-pad) - 6 * var(--capsule-gap) - 2px) / 7), 56px)",
  "--capsule-inset": "clamp(0px, calc((56px - var(--capsule-cap)) / 6), 2px)",
  "--capsule-circle": "calc(var(--capsule-cap) - 2 * var(--capsule-inset))",
  "--capsule-glyph": "calc(var(--capsule-circle) * 3 / 7)",
} as const;

/**
 * The dock (phone, tablet and wall).
 *
 * Order, roles, icons and the active-item rule all come from `lib/nav-items.ts`
 * — this component owns only the capsule animation. The 2026-09 UI audit
 * (finding 6) found the dock keeping a private list with private inline SVGs and
 * a `pathname === href` check that disagreed with the desktop rail on
 * `/settings/me`, plus a hard-coded lime `rgba(120,240,90,…)` glow that ignored
 * the accent system. All four now live in one place.
 *
 * It also waits for auth before painting caps. `useAuth` fills `currentUser` in
 * from localStorage inside a mount effect, so before `hydrated` flips the role is
 * unknown and `navRoleForUser(null)` reports **guest** — which for a kid means a
 * frame with the parent's House cap on it (Home Assistant is `HOUSE_ROLES`, i.e.
 * deliberately withheld from kids), tappable in that frame. Both Settings
 * surfaces already gate on `hydrated`; this was the third and last one. The dock
 * is `fixed`, so rendering nothing first costs no layout, and it removes a
 * server/client cap mismatch besides.
 *
 * **Colour comes from tokens, not from a theme branch.** This used to pick a bar
 * colour and an ink per theme in JS (`rgba(8,10,12,0.60)` / `rgba(0,0,0,0.16)`,
 * `text-white/55`, `text-white/95`) behind a `data-theme` MutationObserver. In
 * Day mode that put the primary navigation of a wall-mounted family dashboard at
 * **1.27:1** for the inactive glyphs and **1.65:1** for the active label over the
 * real composited bar — invisible. Now `--color-surface-0` gives the deep glass on
 * Night and the white glass on Day, `--color-text-primary`/`-secondary` carry the
 * ink, and `--color-nav-active*` (the only active ink, AGENTS.md) still owns the
 * accent — so both themes are correct by construction. The ink is a token rather
 * than white because the *bar* now flips; the active glyph stays white on
 * `--color-nav-active-fill`, which globals.css deepens to hold ≥3:1 for every
 * accent preset.
 */
export default function CapsuleNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser, hydrated } = useAuth();
  const { wall } = useWallMode();

  // 7 caps in both modes — a parent/guest gets House, a signed-in kid swaps it
  // for Rewards — which is what `--capsule-cap`'s /7 divisor is sized for.
  // Declared after the gate below so no cap list is ever built from a guess.
  const items = hydrated ? navItemsForRole(navRoleForUser(currentUser)) : [];

  if (!hydrated) return null;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none"
      style={GEOMETRY as React.CSSProperties}
    >
      <div
        className="pointer-events-auto mb-3 pb-safe"
        style={{ marginInline: "var(--capsule-edge)" }}
      >
        <div
          className="capsule-nav relative rounded-full"
          style={{
            background: `color-mix(in srgb, var(--color-surface-0) ${BAR_ALPHA * 100}%, transparent)`,
            border: "1px solid var(--border-frost-2)",
            boxShadow:
              "0 24px 48px -12px var(--neu-dark), inset 0 1px 0 var(--glass-tint-strong)",
            backdropFilter: "blur(24px) saturate(1.4)",
            WebkitBackdropFilter: "blur(24px) saturate(1.4)",
          }}
        >
          <div
            className="flex items-center"
            style={{ gap: "var(--capsule-gap)", padding: "var(--capsule-pad)" }}
          >
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
                  // `.hit-44` documents the 44px floor the cell already meets,
                  // and keeps meeting it if the geometry is ever retuned. The wall
                  // profile opts out: its caps are 72px and globals.css expands
                  // `.hit-44::before` a further 12px there, which on a 72px cell
                  // would only steal taps from its neighbours. No `border`: the
                  // active ring is an inset shadow, because a 1px border on seven
                  // caps is 14px the 320px viewport does not have.
                  className={`capsule-item group relative grid ${
                    wall ? "h-[72px]" : "hit-44"
                  } grid-flow-col items-center rounded-full tap-sm`}
                  style={{
                    height: wall ? undefined : "var(--capsule-cap)",
                    // Wall: labels are always visible, so both states keep the
                    // label column — the active item's accent styling is the focus.
                    gridTemplateColumns: wall
                      ? "72px 1fr"
                      : isActive
                        ? "var(--capsule-cap) 1fr"
                        : "var(--capsule-cap) 0fr",
                    background: isActive
                      ? "linear-gradient(135deg, var(--color-nav-active-sheen), var(--color-nav-active-wash))"
                      : "transparent",
                    boxShadow: isActive
                      ? `inset 0 0 0 1px var(--color-nav-active-border), 0 0 24px -4px var(--color-nav-active-glow), inset 0 1px 0 rgba(255,255,255,0.14)`
                      : "none",
                    transition: `grid-template-columns 0.38s ${EXPAND_EASE}, background 0.3s ease, box-shadow 0.3s ease, transform 0.15s ease`,
                  }}
                >
                  <span
                    className={`grid place-items-center place-self-center rounded-full transition-all duration-300 ${
                      wall ? "h-[72px] w-[72px]" : ""
                    } border ${
                      isActive ? "border-transparent" : "border-[var(--border-frost-1)]"
                    }`}
                    style={{
                      height: wall ? undefined : "var(--capsule-circle)",
                      width: wall ? undefined : "var(--capsule-circle)",
                      background: isActive
                        ? "var(--color-nav-active-fill)"
                        : `color-mix(in srgb, var(--color-surface-2) ${IDLE_CIRCLE_PCT}%, transparent)`,
                      boxShadow: isActive
                        ? "inset 0 1px 0 rgba(255,255,255,0.35), 0 4px 12px -2px var(--color-nav-active-halo)"
                        : "none",
                    }}
                  >
                    <span
                      className={`grid place-items-center transition-colors duration-300 ${
                        wall ? "h-8 w-8" : ""
                      } ${
                        isActive
                          ? "text-white"
                          : "text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]"
                      }`}
                      style={{
                        height: wall ? undefined : "var(--capsule-glyph)",
                        width: wall ? undefined : "var(--capsule-glyph)",
                      }}
                    >
                      <NavIcon iconKey={item.iconKey} active={isActive} className="h-full w-full" />
                    </span>
                  </span>
                  <span className="capsule-label min-w-0 overflow-hidden">
                    <span
                      className={`capsule-label-text block whitespace-nowrap pl-1 pr-4 ${
                        wall ? "text-base" : "text-sm"
                      } font-semibold tracking-tight transition-all duration-300 ${
                        isActive || wall
                          ? "translate-x-0 opacity-100 text-[var(--color-text-primary)]"
                          : "-translate-x-3 opacity-0"
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