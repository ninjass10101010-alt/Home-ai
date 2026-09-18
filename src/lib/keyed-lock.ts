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
 */

const chains = new Map<string, Promise<void>>();

export function withKeyedLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.then(() => fn());
  // The tail swallows errors so one failed section can never wedge the
  // chain for the rest of the process lifetime.
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
