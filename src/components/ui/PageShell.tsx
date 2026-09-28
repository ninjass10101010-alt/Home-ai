"use client";

import type { CSSProperties, ReactNode } from "react";
import { usePathname } from "next/navigation";
import CapsuleNav from "./CapsuleNav";
import SidebarNav from "./SidebarNav";
import SyncStatusBanner from "./SyncStatusBanner";
import { useAuth } from "@/hooks/useAuth";
import { navRoleForUser } from "@/lib/nav-items";

interface PageShellProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Surface-specific sync copy (chat's signed-out thread warning, etc.). */
  bannerMessage?: string;
  /** Positioning classes for the sync banner (defaults to `mx-4 mt-3`). */
  bannerClassName?: string;
  /**
   * Extra classes for the `<main>` content column — per-page width caps or
   * layout. Chat keeps `max-w-lg mx-auto` on every breakpoint (a thread must
   * not stretch to full width on desktop) plus its own flex-column shell.
   */
  contentClassName?: string;
  /**
   * Reserve dock clearance (`pb-32`) under the content. Pages that already
   * pad for the fixed dock themselves (chat's composer uses
   * `env(safe-area-inset-bottom) + 5.5rem`) pass `false` so the extra inset
   * doesn't create dead scroll space.
   */
  bottomInset?: boolean;
  /**
   * Clip the page root (`overflow-hidden`). `false` keeps the document as the
   * scrollport for descendants — required by pages whose layout relies on
   * document-scroll `position: sticky` (chat's pinned top bar and composer);
   * under the shell's own clipping box, sticky would pin to that box instead
   * of the viewport and simply scroll away. Rail and dock are `fixed`, so
   * they are unaffected either way.
   */
  clip?: boolean;
}

/**
 * PageShell — the one shell for every data route: sync banner, page transition,
 * the dock, and (for a parent session) the desktop rail.
 *
 * UI audit Phase 4, finding 7: the rail used to be mounted inside `AdultHome`
 * alone, so a parent who left Home on a tablet or desktop lost the rail
 * entirely while the phone dock stayed. The shell now owns it, at `md+` only,
 * and reserves its width (`md:pl-60`) so the fixed 15rem rail can never sit on
 * top of the content column. Kids and the signed-out family screen keep the dock
 * alone — nav *roles* decide that, not this shell.
 *
 * The content column (banner + `<main>`) keeps the pre-Phase-4 tiers
 * (`max-w-lg` → `md:max-w-3xl` → `lg:max-w-none`) and centres inside whatever
 * width the rail leaves.
 */
export default function PageShell({
  children,
  className = "",
  style,
  bannerMessage,
  bannerClassName,
  contentClassName = "",
  bottomInset = true,
  clip = true,
}: PageShellProps) {
  const pathname = usePathname();
  const { currentUser } = useAuth();
  const showRail = navRoleForUser(currentUser) === "parent";

  return (
    <div
      className={`min-h-screen bg-[var(--color-canvas)] relative ${clip ? "overflow-hidden" : ""} ${className}`}
      style={style}
    >
      {showRail && <SidebarNav />}
      <div className={showRail ? "md:pl-60" : undefined} data-page-rail={showRail ? "true" : "false"}>
        <div className="max-w-lg md:max-w-3xl lg:max-w-none mx-auto">
          <SyncStatusBanner message={bannerMessage} className={bannerClassName} />
          <main
            key={pathname}
            className={`page-settle relative z-10 ${bottomInset ? "pb-32" : ""} ${contentClassName}`}
          >
            {children}
          </main>
        </div>
      </div>
      <CapsuleNav />
    </div>
  );
}

