"use client";

import type { CSSProperties, ReactNode } from "react";
import { usePathname } from "next/navigation";
import CapsuleNav from "./CapsuleNav";
import SyncStatusBanner from "./SyncStatusBanner";

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
 * and the dock.
 *
 * There is deliberately **no side rail and no top bar**. UI audit Phase 4
 * finding 7 briefly mounted a desktop `SidebarNav` here for parent sessions,
 * which gave parents two navigations with the same seven destinations at every
 * width ≥768px — and on 768–931px the fixed dock physically covered part of the
 * rail's Emergency link. The original 2026-08-06 responsive spec had already
 * ruled the rail out ("keep the bottom nav bar on desktop, no side rail"), so
 * the rail and its `md:pl-60` reservation are gone and the dock is the one
 * navigation surface on every device and every role.
 *
 * The content column (banner + `<main>`) keeps the pre-Phase-4 tiers
 * (`max-w-lg` → `md:max-w-3xl` → `lg:max-w-none`) and centres itself.
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

  return (
    <div
      className={`min-h-screen bg-[var(--color-canvas)] relative ${clip ? "overflow-hidden" : ""} ${className}`}
      style={style}
    >
      <div className="max-w-lg md:max-w-3xl lg:max-w-none mx-auto">
        <SyncStatusBanner message={bannerMessage} className={bannerClassName} />
        <main
          key={pathname}
          className={`page-settle relative z-10 ${bottomInset ? "pb-32" : ""} ${contentClassName}`}
        >
          {children}
        </main>
      </div>
      <CapsuleNav />
    </div>
  );
}

