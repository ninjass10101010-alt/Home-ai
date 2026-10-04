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
 *
 * `BAR_ALPHA` was 0.68, and a pixel scan across the dock at 1280px showed why
 * that was too thin: the dock's own contents sat on *page* pixels — the Tasks
 * member strip was still readable straight through the bar under the pills, and
 * on the wall the deep glass picked up so much of the wallpaper that the dock
 * read brown. 0.76 keeps the glass (colour and shape still come through the 24px
 * blur) while stopping text from competing with the seven caps.
 */
export const BAR_ALPHA = 0.76;
export const IDLE_CIRCLE_PCT = 58;

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
 * The dock stays visually compact — the circle is inset ≤2px inside its cell —
 * and the glyph is now **half** its circle (`/2`, was `3/7`). The old `3/7` was
 * inherited from a 24px glyph in a 56px circle and left a 17.5px glyph marooned
 * in a 40.8px ring at 320: the mark was a speck, and the *ring* was the loudest
 * thing in the dock. Half reads at every width (glyph: then → now):
 *
 *   width 320  360  390  428  480+
 *   then  17.5 18.5 18.9 19.9 24.0
 *   now   20.4 21.6 22.0 23.3 28.0
 *
 * The bar fills the viewport exactly by construction —
 * `7×cap + 6×gap + 2×pad + 2px border = 100vw − 2×edge`, which is why `--capsule-cap`
 * divides what is left after the three spacers rather than using a fixed
 * denominator. Below ~420px gap/pad/edge tighten towards zero, because 7×44px =
 * 308px already leaves only 12px of slack at a 320px viewport: the one place the
 * house 44px rule and "never make the dock huge" pull against each other, and the
 * 44px floor wins.
 *
 * **That tightness has a consequence, and it is the dock's one real usability
 * defect.** The expanding active pill needs horizontal slack to put the label in,
 * and `7 × 44px + 6 × gap + 2 × pad + 2px = 100vw − 2 × edge` leaves none. Measured
 * visible width of the active label's clipped column:
 *
 *   width      320  360  390  428  480  540  640+
 *   label px   2.1  2.2  2.2  2.1  4.0 62.0 68.0
 *
 * So on **every phone width** — 320 through 480, which is every iPhone and every
 * small phone in portrait — the dock showed seven icons and never named the
 * section you were standing in, and `0fr → 1fr` bought a 2px expansion that
 * nudged the active circle off centre and jogged its neighbours. The pill is not
 * broken; it is *unhoused*. Above ~500px the bar's own `clamp` has stopped
 * growing (the cap maxes at 56px), so the slack appears all at once and the column
 * is exactly `100vw − 478px`.
 *
 * The fix is one measured breakpoint at **560px**. 540px is where the label first
 * appears, but it is also where it first *clips*: `Calendar`, the longest of the
 * seven, needs 62px of column and 540px gives it 62px — zero margin, so one font
 * metric and it truncates. At 560px the column is 68px. Below the line the dock
 * names the active section in a **caption row inside the same capsule** (plus a
 * small accent tab that slides to the cap it names), and the pill stops
 * pretending to expand: below the breakpoint the active item's column is `0fr`
 * too, so all seven circles sit on one pixel-exact grid and nothing jogs. Above
 * it, and on the wall, the documented expanding pill is unchanged. The user never
 * sees both.
 */
export const GEOMETRY = {
  "--capsule-edge": "clamp(2px, calc((100vw - 320px) * 0.12), 12px)",
  "--capsule-pad": "clamp(1px, calc((100vw - 320px) * 0.12), 12px)",
  "--capsule-gap": "clamp(0px, calc((100vw - 320px) * 0.06), 6px)",
  "--capsule-cap": "clamp(44px, calc((100vw - 2 * var(--capsule-edge) - 2 * var(--capsule-pad) - 6 * var(--capsule-gap) - 2px) / 7), 56px)",
  "--capsule-inset": "clamp(0px, calc((56px - var(--capsule-cap)) / 6), 2px)",
  "--capsule-circle": "calc(var(--capsule-cap) - 2 * var(--capsule-inset))",
  "--capsule-glyph": "calc(var(--capsule-circle) / 2)",
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
 *
 * **The frost tokens are shorthands, not colours.** `--border-frost-1/2` are
 * `1px solid rgba(…)`, so inlining one — `border: 1px solid var(--border-frost-2)`,
 * `border-color: var(--border-frost-1)` — is a declaration the browser DROPS, and
 * two things followed that nobody had measured: the bar shipped with **no edge at
 * all** (the glass had no boundary, and page content read straight through it),
 * and every idle cap fell back to `currentColor`, i.e. a 1px ring at 100%
 * `--color-text-primary` — seven hard near-white circles on Night and seven hard
 * near-black circles on Day, both louder than the active state. The dock now uses
 * its own `--capsule-*` hairlines, derived from `--color-text-primary` because
 * that is the one token that inverts with the theme, so one alpha is right in both.
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

  // The caption only exists where the pill has no room for the label. The
  // breakpoint itself lives in globals.css (it is a width question, not a state
  // question) — this only decides whether the row is in the tree at all, so the
  // wall never mounts a second name for the place it is already labelling.
  const activeIndex = items.findIndex((item) => isNavItemActive(pathname, item));
  const caption = !wall && activeIndex >= 0 ? items[activeIndex].label : null;

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
          style={
            {
              background: `color-mix(in srgb, var(--color-surface-0) ${BAR_ALPHA * 100}%, transparent)`,
              border: "1px solid var(--capsule-edge-ink)",
              boxShadow:
                "0 24px 48px -12px var(--neu-dark), inset 0 1px 0 var(--glass-tint-strong)",
              backdropFilter: "blur(24px) saturate(1.4)",
              WebkitBackdropFilter: "blur(24px) saturate(1.4)",
              // Read by `.capsule-tick`'s `translate`, so the marker slides to the
              // cap it names instead of teleporting.
              "--capsule-index": activeIndex,
            } as React.CSSProperties
          }
        >
          {/* The name of where you are, and the tab that points at the cap it
              names. `aria-hidden` because the active cap already carries this exact
              string as its accessible name plus `aria-current` — announcing it twice
              is how a dock talks over its own screen reader. */}
          {caption !== null ? (
            <>
              <div className="capsule-heading" aria-hidden="true">
                <span className="capsule-caption" key={caption}>
                  {caption}
                </span>
              </div>
              <span className="capsule-tick" aria-hidden="true" />
            </>
          ) : null}
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
                    // Otherwise the columns are *variables*, because below 540px
                    // the active column has to collapse to `0fr` too: with no room
                    // for the label, a 2px expansion only knocked the active circle
                    // off centre and shuffled its neighbours on every route change.
                    // globals.css owns that switch — it is a width question.
                    gridTemplateColumns: wall
                      ? "72px 1fr"
                      : isActive
                        ? "var(--capsule-col-active)"
                        : "var(--capsule-col-idle)",
                    // Flat `--color-nav-active-sheen` (accent 20%), not a
                    // 20%→6% ramp. The ramp's far end fell under the perceptual
                    // floor about three quarters of the way across, so the pill's
                    // right half read as a 1px outline around *nothing* with the
                    // label sitting on bare glass — the active state looked
                    // unfinished on every width ≥540px, and on the wall. One flat
                    // tint fills the whole lozenge; the `inset 0 1px 0` specular
                    // below still supplies the light.
                    background: isActive ? "var(--color-nav-active-sheen)" : "transparent",
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
                      isActive
                        ? "border-transparent"
                        : "border-[var(--capsule-ring)] group-hover:border-[var(--capsule-ring-hover)]"
                    }`}
                    style={{
                      height: wall ? undefined : "var(--capsule-circle)",
                      width: wall ? undefined : "var(--capsule-circle)",
                      background: isActive
                        ? "var(--color-nav-active-fill)"
                        : `color-mix(in srgb, var(--color-surface-2) ${IDLE_CIRCLE_PCT}%, transparent)`,
                      // One soft outward feather, not a hard ring. The active
                      // disc sits inside the accent wash, and at the old
                      // `--color-nav-active-halo` (accent 50%) its edge read as a
                      // violet bruise on Day's white glass rather than as light;
                      // 16px blurred at -4px melts the disc into the wash on both
                      // themes and doubles as the phone's focus cue.
                      boxShadow: isActive
                        ? "inset 0 1px 0 rgba(255,255,255,0.35), 0 0 16px -4px var(--color-nav-active-glow)"
                        : "none",
                    }}
                  >
                    <span
                      className={`grid place-items-center transition-colors duration-300 ${
                        wall ? "h-9 w-9" : ""
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
                      // The paddings are not cosmetic, and they are budgeted.
                      // `pr-4` was the expanding pill's end-cap: on the wall — where
                      // every label is always visible — it pushed each label 16px
                      // from the next cap while gluing it 4px to its own icon, so
                      // the row's rhythm visibly skewed right. But the phone's label
                      // column is the scarcest thing in the dock (see the geometry
                      // note: `Calendar` needs 62px of a 68px column at 560px), so
                      // the pill gets a 14px budget split 6/8 and the wall — which
                      // has all the room it needs — gets a symmetric 10px.
                      className={`capsule-label-text block whitespace-nowrap ${
                        wall ? "px-2.5 text-lg" : "pl-1.5 pr-2 text-sm"
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