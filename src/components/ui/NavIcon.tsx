/**
 * NavIcon — the single icon set for navigation (UI audit 2026-09 Phase 3).
 *
 * Before this file the dock drew inline SVGs, the desktop rail drew emoji
 * ("🏠 Dashboard", "🍽️ Meals") and 25 other files reached for `lucide-react`:
 * three icon languages for the same destinations, and the audit's finding 12
 * (emoji as UI chrome — platform-dependent, untintable, no contrast control).
 *
 * One set, keyed to `NavIconKey` from `lib/nav-items.ts`, so the manifest can
 * never ask for an icon that does not exist: `tests/unit/nav-icon.test.tsx`
 * asserts the key set and this map are identical.
 *
 * Icons are decorative — every control that uses them carries an `aria-label`
 * (the manifest's `label`) — so the SVG is `aria-hidden`.
 */
import type { ReactNode } from "react";
import type { NavIconKey } from "@/lib/nav-items";

export const NAV_ICON_PATHS: Record<NavIconKey, ReactNode> = {
  home: (
    <>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
    </>
  ),
  ask: (
    <>
      <path d="M12 3a8 8 0 0 0-8 8c0 1.6.5 3.1 1.3 4.4L4 21l5.6-1.3A8 8 0 1 0 12 3Z" />
      <circle cx="8.5" cy="11" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="11" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="11" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  meals: (
    <>
      <path d="M4 3v8a4 4 0 0 0 4 4v6" />
      <path d="M8 3v8" />
      <path d="M8 15v6" />
      <path d="M17 3c-2 0-3 2-3 5s1 5 3 5v8" />
    </>
  ),
  tasks: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  rewards: (
    <>
      <rect x="3.5" y="8" width="17" height="4" rx="1" />
      <path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
      <path d="M12 8v12" />
      <path d="M12 8s-1.2-4-4-4a2.2 2.2 0 0 0 0 4h4Z" />
      <path d="M12 8s1.2-4 4-4a2.2 2.2 0 0 1 0 4h-4Z" />
    </>
  ),
  calendar: (
    <>
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
    </>
  ),
  house: (
    <>
      <path d="M5 4v4" />
      <path d="M5 12v8" />
      <path d="M3 10h4" />
      <path d="M12 4v9" />
      <path d="M12 17v3" />
      <path d="M10 15h4" />
      <path d="M19 4v3" />
      <path d="M19 11v9" />
      <path d="M17 9h4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1.5l.8 3.3a8.5 8.5 0 0 1 1.9.8l3.1-1.7 1.4 1.4-1.7 3.1a8.5 8.5 0 0 1 .8 1.9l3.3.8v1.8l-3.3.8a8.5 8.5 0 0 1-.8 1.9l1.7 3.1-1.4 1.4-3.1-1.7a8.5 8.5 0 0 1-1.9.8L12 22.5h-1l-.8-3.3a8.5 8.5 0 0 1-1.9-.8l-3.1 1.7-1.4-1.4 1.7-3.1a8.5 8.5 0 0 1-.8-1.9L1.5 12v-1l3.3-.8a8.5 8.5 0 0 1 .8-1.9l-1.7-3.1 1.4-1.4 3.1 1.7a8.5 8.5 0 0 1 1.9-.8L11 1.5z" />
    </>
  ),
  grocery: (
    <>
      <path d="M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.8L20 7H6" />
      <circle cx="9.5" cy="19" r="1.4" />
      <circle cx="17" cy="19" r="1.4" />
    </>
  ),
  skill: (
    <>
      <path d="m12 3 2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.8Z" />
    </>
  ),
  capsule: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="2.5" />
      <path d="m4.5 8 7.5 5 7.5-5" />
    </>
  ),
  analytics: (
    <>
      <path d="M4 5v14h16" />
      <path d="M8.5 16v-4" />
      <path d="M12.5 16V9" />
      <path d="M16.5 16v-6" />
    </>
  ),
  mountain: (
    <>
      <path d="M3 19h18" />
      <path d="m4.5 19 6-11 3.2 5.8L16 10l4 9" />
    </>
  ),
  memory: (
    <>
      <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v16H7.5A2.5 2.5 0 0 0 5 21.5Z" />
      <path d="M10 7h5" />
      <path d="M10 11h5" />
    </>
  ),
};

interface NavIconProps {
  iconKey: NavIconKey;
  /** Active items draw the icon heavier (the dock's existing 2 → 2.5 step). */
  active?: boolean;
  className?: string;
}

export default function NavIcon({ iconKey, active = false, className }: NavIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.5 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {NAV_ICON_PATHS[iconKey]}
    </svg>
  );
}
