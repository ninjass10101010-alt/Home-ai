"use client";

import type { CSSProperties, ReactNode } from "react";
import { usePathname } from "next/navigation";
import CapsuleNav from "./CapsuleNav";
import SyncStatusBanner from "./SyncStatusBanner";
import { BOARD_MEASURE_CLASS, READ_MEASURE_CLASS } from "@/lib/layout-config";

/** How wide this route's `<main>` is allowed to get. See `layout-config.ts`. */
export type PageMeasure = "read" | "board";

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
   * layout. Chat keeps its own centred thread plus a flex-column shell.
   *
   * Passing this means "this page owns its column": the shell's own measure is
   * skipped entirely, so a page can never end up with two competing widths.
   */
  contentClassName?: string;
  /**
   * Which measure to apply when the page does NOT bring its own column.
   *
   * `board` is the default because it is the one that cannot narrow anything:
   * it keeps the pre-existing `lg`/`xl` steps and only opens out on the wall
   * board, so a route that never heard of this prop renders exactly as it did.
   * A route that renders prose passes `read` — /rewards' grown-up explainer is
   * one card, and a 1664px measure turns one honest card into a stranded slab.
   */
  measure?: PageMeasure;
  /**
   * Reserve dock clearance (`pb-32` = 128px) under the content — the dock's own
   * measured height is 94px on a 1920 canvas and 110px under the wall profile,
   * so 128 clears both. Pages that already pad for the fixed dock themselves
   * (chat's composer) pass `false` so the extra inset doesn't create dead
   * scroll space.
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
 * The content column (banner + `<main>`) centres itself and takes its width
 * from the route's declared `measure` — `read` for prose, `board` for anything
 * that lays itself out in columns. Home and Chat bring their own width and
 * declare neither.
 */
export default function PageShell({
  children,
  className = "",
  style,
  bannerMessage,
  bannerClassName,
  contentClassName = "",
  measure = "board",
  bottomInset = true,
  clip = true,
}: PageShellProps) {
  const pathname = usePathname();

  /**
   * Measure — the wall/landscape fix. The outer wrapper has been full-bleed
   * since `lg`, so every data route stretched edge to edge on a 1920 panel:
   * one 1960px-wide card per row, stat tiles 640px wide around 80px of
   * content, a two-option segmented control 1960px long, and the page's action
   * button ~1900px from its own title. A single later cap fixed the bleed but
   * left every route at one measure, so the dense routes stayed stranded at a
   * prose width. The classes go on `<main>` itself rather than on a wrapper
   * element, so the page's own first child stays a direct child of `main`
   * (`main > section` is a structural contract, and chat's flex-column shell
   * needs its composer to be one).
   *
   * Two routes bring their own width and are skipped by that rule: Home paints
   * its own full-bleed bento, and Chat passes its own centred thread.
   */
  const ownColumn = contentClassName.trim() !== "";
  const measureClass = ownColumn ? "" : measure === "board" ? BOARD_MEASURE_CLASS : READ_MEASURE_CLASS;

  return (
    <div
      className={`min-h-screen bg-[var(--color-canvas)] relative ${clip ? "overflow-hidden" : ""} ${className}`}
      style={style}
    >
      <div className="max-w-lg md:max-w-3xl lg:max-w-none mx-auto">
        <SyncStatusBanner message={bannerMessage} className={bannerClassName} />
        <main
          key={pathname}
          className={`page-settle relative z-10 ${measureClass} ${bottomInset ? "pb-32" : ""} ${contentClassName}`}
        >
          {children}
        </main>
      </div>
      <CapsuleNav />
    </div>
  );
}

