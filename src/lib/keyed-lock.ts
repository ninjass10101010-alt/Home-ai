/**
 * Generic in-process keyed mutex.
 *
 * Serializes async critical sections that PocketBase can't protect on its
 * own (no conditional updates): every section keyed by the same string runs
 * strictly one-at-a-time, FIFO by acquisition, within this Node process.
 * The dashboard runs as a single Next.js container, so in-process exclusion
 * closes the practical window; cross-instance safety needs CAS on top (see
 * e.g. src/lib/ha/alert-state.ts and db.setState's expectedPrev).
 *
 * A failure inside one section never blocks the chain.
 *
 * The section is also BOUNDED. Nothing inside a critical section can time out on
 * its own: the PocketBase client carries no `timeout`/`AbortSignal`, so a hung
 * socket or a NAS that stopped answering simply never settles. Because the
 * queue tail is the section's own promise, one unsettled section used to wedge
 * its key for the life of the process — every later caller of
 * `week-ledger:<weekStart>` queued behind it forever and never returned, so the
 * browser outbox burned its attempts and every points write in the app (ledger
 * operations, approval, claim-pay, penalty, adjust, redeem, the planner, the
 * week rollover, the day sweep, the projection reconciler) hung with them. A
 * rejected section releases the chain, and every caller already fails closed on
 * a throw, so expiry is strictly safer than an indefinite wedge.
 *
 * 120s is deliberately far above any honest duration: a points write is a
 * handful of PocketBase round-trips (read the week row, update/create, read the
 * snapshot, project the task) over the LAN, which is milliseconds-to-seconds,
 * while the browser outbox itself abandons a request after 30s. Expiry is a
 * last-resort escape from a dead socket, never a normal outcome — and a caller
 * that legitimately needs longer passes `timeoutMs`.
 */

const chains = new Map<string, Promise<void>>();

/** Default bound on one critical section, in milliseconds. */
export const KEYED_LOCK_SECTION_TIMEOUT_MS = 120_000;

export class KeyedLockTimeoutError extends Error {
  readonly code = "keyed_lock_timeout";

  constructor(key: string, timeoutMs: number) {
    super(`keyed_lock_timeout:${key}:${timeoutMs}ms`);
    this.name = "KeyedLockTimeoutError";
  }
}

export interface KeyedLockOptions {
  /** Bound for this section only. Non-positive / non-finite falls back to the default. */
  timeoutMs?: number;
}

function resolveTimeout(options: KeyedLockOptions | undefined): number {
  const candidate = options?.timeoutMs;
  return typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0
    ? candidate
    : KEYED_LOCK_SECTION_TIMEOUT_MS;
}

/**
 * Run `fn` under a deadline.
 *
 * `fn()` is invoked SYNCHRONOUSLY, exactly as the unbounded implementation did,
 * so adding the deadline cannot reorder a caller that is sensitive to
 * interleaving.
 *
 * The section promise is deliberately NOT cancelled on expiry — JavaScript
 * cannot un-settle a promise, and a PocketBase write that is already in flight
 * must be allowed to land so its own post-write verification still decides
 * whether it took. What expiry guarantees is that the CALLER stops waiting and
 * that the lock chain is released for the next acquirer.
 */
function withSectionDeadline<T>(
  key: string,
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let work: Promise<T>;
  try {
    work = Promise.resolve(fn());
  } catch (error) {
    work = Promise.reject(error);
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new KeyedLockTimeoutError(key, timeoutMs));
    }, timeoutMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    // Both handlers stay attached after expiry on purpose: an orphaned section
    // may reject long after its caller gave up, and an unhandled rejection would
    // take the whole process down instead of the one request.
    work.then(
      (value) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(error);
      },
    );
  });
}

export function withKeyedLock<T>(
  key: string,
  fn: () => Promise<T>,
  options?: KeyedLockOptions,
): Promise<T> {
  const timeoutMs = resolveTimeout(options);
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.then(() => withSectionDeadline(key, fn, timeoutMs));
  // The tail swallows errors so one failed or expired section can never wedge
  // the chain for the rest of the process lifetime.
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}

/** Test-only: clears the module-scope chains between vitest cases. */
export function __resetKeyedLockForTests(): void {
  chains.clear();
}
