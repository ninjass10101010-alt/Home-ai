/**
 * In-process mutual exclusion for week_data ledger writes.
 *
 * PocketBase has no conditional (CAS) updates, and every points-ledger
 * writer in the app — /api/tasks/claim, /api/rewards/redeem, the approval
 * flows — does the same read-modify-write on the week_data row for the
 * current week. Two overlapping writers each append to their own snapshot
 * of the history, and the second write silently erases the first's
 * transaction (points vanish while the first client was told "success").
 * The per-route post-write verify only catches SOME interleavings.
 *
 * The NAS runs the dashboard as a single Next.js process, so serializing
 * every ledger writer in-process closes the window: a request that waits
 * for the lock re-reads the row fresh and sees the winner's transaction
 * before deciding anything.
 *
 * The mutex body lives in the generic src/lib/keyed-lock.ts; this module
 * names the key domain (weekStart) so ledger callers read clearly and
 * tests can reset the whole map in one place.
 */

import { withKeyedLock, __resetKeyedLockForTests } from "@/lib/keyed-lock";

export function withWeekLedgerLock<T>(
  weekStart: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withKeyedLock(`week-ledger:${weekStart}`, fn);
}

/** Test-only: clears the shared lock chains between vitest cases. */
export function __resetWeekLedgerLockForTests(): void {
  __resetKeyedLockForTests();
}
