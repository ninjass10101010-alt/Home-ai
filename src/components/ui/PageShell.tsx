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
 * (`max-w-lg` → `md:max-w-3xl` → `lg:max-w-none`) and centres itself, and
 * every non-Home, non-Chat route additionally gets the `readColumn` read cap
 * below so a wall/landscape viewport is not one full-bleed column of
 * edge-to-edge cards.
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

  /**
   * Read column — the wall/landscape fix (audit: "a wall dashboard at 1920
   * with a single centred column and vast empty space is a real failure
   * mode"). The outer wrapper has been full-bleed since `lg`, so every data
   * route stretched edge to edge on a 1920 panel: one 1960px-wide card per
   * row, stat tiles 640px wide around 80px of content, a two-option
   * segmented control 1960px long, and the page's action button ~1900px from
   * its own title. The cap goes on `<main>` itself rather than on a wrapper
   * element, so the page's own first child stays a direct child of `main`
   * (`main > section` is a structural contract, and chat's flex-column shell
   * needs its composer to be one).
   *
   * Two routes opt out because they are not reading columns: Home paints its
   * own full-bleed bento / 3-column wall grid, and Chat passes its own centred
   * `max-w-lg` thread — opting out by "the caller brought its own width" also
   * means the cap can never collide with a caller's `max-w-*`.
   */
  const readColumn = pathname !== "/" && contentClassName.trim() === "";

  return (
    <div
      className={`min-h-screen bg-[var(--color-canvas)] relative ${clip ? "overflow-hidden" : ""} ${className}`}
      style={style}
    >
      <div className="max-w-lg md:max-w-3xl lg:max-w-none mx-auto">
        <SyncStatusBanner message={bannerMessage} className={bannerClassName} />
        <main
          key={pathname}
          className={`page-settle relative z-10 ${readColumn ? "mx-auto w-full max-w-lg md:max-w-3xl lg:max-w-5xl xl:max-w-7xl" : ""} ${bottomInset ? "pb-32" : ""} ${contentClassName}`}
        >
          {children}
        </main>
      </div>
      <CapsuleNav />
    </div>
  );
}

