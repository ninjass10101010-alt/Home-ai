// In-process rate limiting for the MUSE inbound surface (Task 8 / B2).
//
// A single dashboard container serves the whole family, so module-level Maps
// are the right scope: no shared store, no cross-instance coordination. The
// state is deliberately resettable for tests (`__resetMuseLimits`).

export const DEFAULT_KEY_LIMIT = 120;

// Token-bucket capacity = rate + burst headroom (rate/4, min 5). The headroom
// gives a key its advertised "burst" (120/min → 150 capacity) while the refill
// rate enforces the sustained per-minute average.
function capacityFor(rate: number): number {
  return rate + Math.max(5, Math.floor(rate / 4));
}

interface Bucket {
  tokens: number;
  updated: number;
  capacity: number;
  refillPerSec: number;
}

const keyBuckets = new Map<string, Bucket>();
const loginBuckets = new Map<string, Bucket>();

const loginFailures = new Map<string, { count: number; lockedUntil: number }>();

const LOGIN_LIMIT_PER_MIN = 5;
const LOCK_AFTER_FAILURES = 10;
const LOCK_MS = 15 * 60_000;

// Hard cap per map so a client-forgeable key (XFF is advisory on the direct
// deployment) cannot grow the in-process state without bound. A Map preserves
// insertion order, so the first key is always the oldest.
const MAX_ENTRIES = 10_000;

function evictToCap<K, V>(map: Map<K, V>): void {
  while (map.size > MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) return;
    map.delete(oldest);
  }
}

function take(bucket: Bucket, now: number): boolean {
  const elapsedSec = Math.max(0, (now - bucket.updated) / 1000);
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsedSec * bucket.refillPerSec);
  bucket.updated = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }
  return false;
}

function check(
  store: Map<string, Bucket>,
  key: string,
  rate: number,
  capacity: number,
  now = Date.now()
): boolean {
  let bucket = store.get(key);
  if (!bucket || bucket.capacity !== capacity) {
    bucket = { tokens: capacity, updated: now, capacity, refillPerSec: rate / 60 };
    store.set(key, bucket);
    evictToCap(store);
  }
  return take(bucket, now);
}

/** Per-key-prefix tool-call bucket. `perMin` falsy → the 120/min default. */
export function checkKeyLimit(keyPrefix: string, perMin?: number): boolean {
  const rate = perMin && perMin > 0 ? perMin : DEFAULT_KEY_LIMIT;
  return check(keyBuckets, keyPrefix || "unknown", rate, capacityFor(rate));
}

/** Login attempts are per-IP only (never per-key): exactly 5/min (no burst). */
export function checkLoginLimit(ip: string): boolean {
  return check(loginBuckets, ip || "unknown", LOGIN_LIMIT_PER_MIN, LOGIN_LIMIT_PER_MIN);
}

export function registerLoginFailure(ip: string): void {
  const key = ip || "unknown";
  const rec = loginFailures.get(key) ?? { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= LOCK_AFTER_FAILURES) rec.lockedUntil = Date.now() + LOCK_MS;
  loginFailures.set(key, rec);
  evictToCap(loginFailures);
}

export function clearLoginFailures(ip: string): void {
  loginFailures.delete(ip || "unknown");
}

export function isLoginLocked(ip: string): boolean {
  const rec = loginFailures.get(ip || "unknown");
  return !!rec && rec.lockedUntil > Date.now();
}

/** Test seam — module state must start clean per vitest case. */
export function __resetMuseLimits(): void {
  keyBuckets.clear();
  loginBuckets.clear();
  loginFailures.clear();
}
