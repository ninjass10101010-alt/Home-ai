import { db } from "@/db";

/**
 * Calendar member-chip roster snapshot — the getSnapshot/subscribe pair for
 * the page's useSyncExternalStore.
 *
 * Hydration safety: the server snapshot is always the deterministic fallback
 * list (never the live roster cache), so SSR HTML and the client's first
 * render are identical; the live roster swaps in via the
 * `consuela-members-updated` window event (dispatched by db.refreshMembersCache
 * / patchMemberLocal). The previous implementation listened for `storage`
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
