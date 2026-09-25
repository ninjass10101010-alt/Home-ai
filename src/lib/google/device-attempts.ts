import { randomUUID } from "node:crypto";
import { withKeyedLock } from "@/lib/keyed-lock";

interface DeviceAttempt {
  id: string;
  deviceCode: string;
  createdAt: number;
  cancelled: boolean;
  completed: boolean;
  grantWritten: boolean;
}

const attempts = new Map<string, DeviceAttempt>();
let latestAttemptId: string | null = null;
const ATTEMPT_TTL_MS = 15 * 60 * 1000;
const LIFECYCLE_LOCK = "google-device-lifecycle";

function pruneExpired() {
  const cutoff = Date.now() - ATTEMPT_TTL_MS;
  for (const [id, attempt] of attempts) {
    if (attempt.createdAt < cutoff) attempts.delete(id);
  }
}

export function withGoogleDeviceLifecycle<T>(fn: () => Promise<T>): Promise<T> {
  return withKeyedLock(LIFECYCLE_LOCK, fn);
}

export function createDeviceAttempt(deviceCode: string): Promise<string> {
  return withGoogleDeviceLifecycle(async () => {
    pruneExpired();
    for (const attempt of attempts.values()) {
      if (!attempt.cancelled && !attempt.completed) attempt.cancelled = true;
    }
    const id = randomUUID();
    attempts.set(id, { id, deviceCode, createdAt: Date.now(), cancelled: false, completed: false, grantWritten: false });
    latestAttemptId = id;
    return id;
  });
}

export function getDeviceAttempt(id: string | undefined): DeviceAttempt | null {
  pruneExpired();
  if (!id) return null;
  return attempts.get(id) || null;
}

export function isDeviceAttemptActive(id: string | undefined, deviceCode?: string): boolean {
  const attempt = getDeviceAttempt(id);
  return Boolean(attempt && !attempt.cancelled && !attempt.completed && (!deviceCode || attempt.deviceCode === deviceCode));
}

export function cancelDeviceAttempt<T = undefined>(
  id: string | undefined,
  cleanup?: () => Promise<T>,
): Promise<{ found: boolean; shouldClearGrant: boolean; cleanupResult?: T }> {
  return withGoogleDeviceLifecycle(async () => {
    const attempt = getDeviceAttempt(id);
    if (!attempt || !id) return { found: false, shouldClearGrant: false };
    attempt.cancelled = true;
    const shouldClearGrant = Boolean(attempt.grantWritten && latestAttemptId === id);
    const cleanupResult = shouldClearGrant && cleanup ? await cleanup() : undefined;
    return { found: true, shouldClearGrant, cleanupResult };
  });
}

export async function invalidateDeviceAttempt(id: string | undefined): Promise<boolean> {
  return (await cancelDeviceAttempt(id)).found;
}

export function invalidateAllDeviceAttempts<T = undefined>(cleanup?: () => Promise<T>): Promise<T | undefined> {
  return withGoogleDeviceLifecycle(async () => {
    pruneExpired();
    for (const attempt of attempts.values()) attempt.cancelled = true;
    latestAttemptId = null;
    return cleanup ? cleanup() : undefined;
  });
}

export function withDeviceAttemptCommit<T>(id: string, fn: () => Promise<T>): Promise<T | null> {
  return withGoogleDeviceLifecycle(async () => {
    if (!isDeviceAttemptActive(id)) return null;
    const result = await fn();
    if (result === null || result === undefined) return null;
    const attempt = getDeviceAttempt(id);
    if (!attempt || attempt.cancelled) return null;
    attempt.grantWritten = true;
    attempt.completed = true;
    latestAttemptId = id;
    return result;
  });
}

export function __resetDeviceAttemptsForTests(): void {
  attempts.clear();
  latestAttemptId = null;
}
