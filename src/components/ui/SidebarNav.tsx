/**
 * SidebarNav — the desktop/tablet rail (parent sessions; `md+` only).
 *
 * Reads `lib/nav-items.ts`, the same manifest the dock and the Home More… sheet
 * read, so both navs agree on order, roles, icons and — the bug the 2026-09 UI
 * audit found — the active item (`pathname === href` in the dock vs
 * `startsWith` here meant `/settings/me` highlighted Settings in one nav and
 * nothing in the other).
 *
 * Fixed here, per that audit's finding 6:
 *   - emoji icons ("🏠 Dashboard", "🍽️ Meals") → `NavIcon` (one SVG set),
 *   - the private 6-item list → the manifest (so a kid sees Rewards, not House),
 *   - the phantom `rgba(var(--color-accent-selected-rgb, 59,130,246), …)`: that
 *     variable is defined nowhere, so the hard-coded fallback blue always won —
 *     replaced by `--color-nav-active*`, the token the dock uses too.
 *
 * Phase 4: `PageShell` mounts it for a parent session on every route (it used to
 * live inside `AdultHome`, so leaving Home dropped the rail while the phone dock
 * stayed) and reserves its width, so content can never slide underneath. The
 * rail renders `hidden md:flex`; the shell's offset is `md:pl-60` — keep the two
 * in step (both are asserted by `tests/unit/page-shell-tiers.test.tsx`).
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import NavIcon from "@/components/ui/NavIcon";
import { useAuth } from "@/hooks/useAuth";
import { isNavItemActive, navItemsForRole, navRoleForUser } from "@/lib/nav-items";

export default function SidebarNav() {
  const pathname = usePathname();
  const { currentUser } = useAuth();
  const items = navItemsForRole(navRoleForUser(currentUser));

  return (
    <>
      {/* Desktop sidebar — hidden on mobile */}
      <aside
        className="hidden md:flex fixed left-0 top-0 bottom-0 z-40 flex-col w-60 border-r border-white/[0.06]"
        style={{
          background: "var(--color-surface-0)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      >
        {/* Logo / brand */}
        <div className="px-5 pt-6 pb-5 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-2xl grid place-items-center text-base shrink-0"
              style={{
                background: "linear-gradient(135deg, var(--color-accent-selected), var(--color-accent-violet))",
                boxShadow: "0 0 16px color-mix(in srgb, var(--color-accent-selected) 25%, transparent)",
              }}
            >
              ✨
            </div>
            <div>
              <h2 className="text-sm font-bold text-text-primary tracking-tight">Consuela</h2>
              <p className="text-xs text-text-muted">Family Dashboard</p>
            </div>
          </div>
        </div>

        {/* Navigation items — order, roles and icons come from the manifest */}
        <nav className="flex-1 px-3 py-4 space-y-1" aria-label="Main">
          {items.map((item) => {
            const isActive = isNavItemActive(pathname, item);

            return (
              <Link
                key={item.path}
                href={item.path}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 ${
                  isActive
                    ? "text-text-primary"
                    : "text-text-secondary hover:text-text-primary hover:bg-white/[0.04]"
                }`}
                style={isActive ? {
                  background: "linear-gradient(135deg, var(--color-nav-active-sheen), var(--color-nav-active-wash))",
                  border: "1px solid var(--color-nav-active-border)",
                } : {
                  border: "1px solid transparent",
                }}
              >
                <span className={`grid h-6 w-6 shrink-0 place-items-center ${isActive ? "text-[var(--color-nav-active)]" : ""}`}>
                  <NavIcon iconKey={item.iconKey} active={isActive} className="h-5 w-5" />
                </span>
                <span className="text-sm font-medium">{item.label}</span>
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="ml-auto w-1.5 h-1.5 rounded-full bg-[var(--color-nav-active)]"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Emergency button — not a dock cap, so deliberately not in the manifest
            (see EXEMPT_ROUTES); its emoji glyph is Phase 5's emoji-as-chrome sweep. */}
        <div className="px-3 pb-6 pt-2 border-t border-white/[0.06]">
          <Link
            href="/emergency"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-[var(--color-accent-rose)] hover:bg-[var(--color-accent-rose)]/[0.08] transition-colors"
          >
            <span className="text-base w-6 text-center" aria-hidden="true">🛡️</span>
            <span className="text-sm font-medium">Emergency</span>
          </Link>
        </div>
      </aside>
    </>
  );
}
