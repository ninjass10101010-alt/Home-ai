import { db } from "@/db";
import { canonicalMemberFallbacksEnabled } from "@/lib/member-fallback";

/**
 * Calendar member-chip roster snapshot — the getSnapshot/subscribe pair for
 * the page's useSyncExternalStore.
 *
 * Hydration safety: the server snapshot is always the deterministic fallback
 * (never the live roster cache), so SSR HTML and the client's first
 * render are identical; the live roster swaps in via the
 * `consuela-members-updated` window event (dispatched by db.refreshMembersCache
 * / patchMemberLocal) AND via a priming read at subscribe time — events that
 * fire while the page is unmounted would otherwise be lost forever. The
 * previous implementation listened for `storage`
 * events on the "consuela-members" key — dead: nothing in the codebase writes
 * that key, and storage events never fire cross-device anyway.
 *
 * Fallback gate (same seam as the server roster — src/lib/member-fallback.ts):
 * the fabricated roster below is a NON-PRODUCTION opt-in only. In production a
 * missing/unreadable PocketBase renders an EMPTY chip strip rather than
 * painting an invented family onto the dashboard; the "All" chip is hardcoded
 * in the page and every real name comes from the live PB roster. Both branches
 * return a module-level constant, so the snapshot identity is stable and
 * useSyncExternalStore never re-renders on a fresh array.
 */

export const DEFAULT_CALENDAR_MEMBERS = [
  { name: "All", color: "green", emoji: "👨‍👩‍👧‍👦" },
  { name: "Rebecca", color: "green", emoji: "🐱" },
  { name: "Jeffery", color: "cyan", emoji: "👨" },
  { name: "Emily", color: "violet", emoji: "👧" },
  { name: "Bailey", color: "amber", emoji: "👧" },
  { name: "Jasmine", color: "rose", emoji: "👧" },
  { name: "Aurora", color: "blue", emoji: "👧" },
  { name: "Caspian", color: "cyan", emoji: "🧒" },
];

/** Stable empty roster — a module constant so the snapshot identity never churns. */
const NO_CALENDAR_MEMBERS: typeof DEFAULT_CALENDAR_MEMBERS = [];

function fallbackMembersSnapshot() {
  return canonicalMemberFallbacksEnabled()
    ? DEFAULT_CALENDAR_MEMBERS
    : NO_CALENDAR_MEMBERS;
}

let cachedMembersSnapshot = fallbackMembersSnapshot();

export function getServerMembersSnapshot() {
  return fallbackMembersSnapshot();
}

export function getClientMembersSnapshot() {
  return cachedMembersSnapshot;
}

export function subscribeMembersSnapshot(onStoreChange: () => void) {
  // Prime from the live roster cache at subscribe time. Every dispatch that
  // fires while the Calendar is unmounted (startup hydrate, the 60s refresh,
  // profile-sheet saves — all on Home) is otherwise lost, leaving the chips
  // stuck on the hardcoded fallback for the whole session. subscribe runs
  // post-mount and React re-checks getSnapshot right after subscribing, so
  // the live roster swaps in without a hydration mismatch (the server
  // snapshot stays the deterministic fallback).
  cachedMembersSnapshot = db.selectMembersForCalendar();
  const handleMembersUpdated = () => {
    cachedMembersSnapshot = db.selectMembersForCalendar();
    onStoreChange();
  };
  window.addEventListener("consuela-members-updated", handleMembersUpdated);
  return () => window.removeEventListener("consuela-members-updated", handleMembersUpdated);
}

/** Test-only: reset the module-level cache between tests. */
export function resetClientMembersSnapshotForTests() {
  cachedMembersSnapshot = fallbackMembersSnapshot();
}
