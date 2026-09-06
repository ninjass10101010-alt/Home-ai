import { db } from "@/db";

/**
 * Calendar member-chip roster snapshot — the getSnapshot/subscribe pair for
 * the page's useSyncExternalStore.
 *
 * Hydration safety: the server snapshot is always the deterministic fallback
 * list (never the live roster cache), so SSR HTML and the client's first
 * render are identical; the live roster swaps in via the
 * `consuela-members-updated` window event (dispatched by db.refreshMembersCache
 * / patchMemberLocal) AND via a priming read at subscribe time — events that
 * fire while the page is unmounted would otherwise be lost forever. The
 * previous implementation listened for `storage`
 * events on the "consuela-members" key — dead: nothing in the codebase writes
 * that key, and storage events never fire cross-device anyway.
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

let cachedMembersSnapshot = DEFAULT_CALENDAR_MEMBERS;

export function getServerMembersSnapshot() {
  return DEFAULT_CALENDAR_MEMBERS;
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
  cachedMembersSnapshot = DEFAULT_CALENDAR_MEMBERS;
}
