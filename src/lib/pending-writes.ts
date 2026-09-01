// localStorage-backed queue for meal/recipe writes that failed (expired
// session, offline, server down). Without this, a failed gateway write was
// swallowed by safeGatewayRow/upsertRecipe's catch and the UI showed a fake
// success toast while the data lived only in that browser's cache — the
// "vanishing meals" cross-device loss. Queued writes are retried by
// flushPendingWrites() on mount, tab-wake, the 60s cache refresh tick, and
// right after a successful sign-in.

export const PENDING_WRITES_KEY = "consuela-pending-writes";

export interface PendingWrite {
  key: string;
  collection: "meal_plan_entries" | "recipes" | "events";
  op: "create" | "update" | "delete";
  payload?: any;
  id?: string | number;
  queuedAt: string;
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function listPendingWrites(): PendingWrite[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(PENDING_WRITES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function queueWrite(write: PendingWrite): void {
  if (!isBrowser()) return;
  const pending = listPendingWrites().filter((w) => w.key !== write.key);
  pending.push(write);
  try {
    localStorage.setItem(PENDING_WRITES_KEY, JSON.stringify(pending));
  } catch {}
}

export function clearPendingWrite(key: string): void {
  if (!isBrowser()) return;
  const pending = listPendingWrites().filter((w) => w.key !== key);
  try {
    localStorage.setItem(PENDING_WRITES_KEY, JSON.stringify(pending));
  } catch {}
}

// Default runner replays a queued write through the dual-mode db client.
// Lazy import keeps this module (and its unit tests) free of the db
// module-load hydrate.
async function dbWriteRunner(w: PendingWrite): Promise<boolean> {
  try {
    const { db } = await import("@/db");
    if (w.collection === "meal_plan_entries") {
      if (w.op === "create") return !!(await db.insertMeal(w.payload));
      if (w.op === "update") return !!(await db.updateMeal(String(w.id), w.payload));
      return !!(await db.deleteMeal(String(w.id)));
    }
    if (w.collection === "recipes") {
      if (w.op === "delete") return !!(await db.deleteRecipe(String(w.id)));
      return !!(await db.upsertRecipe(w.payload));
    }
    if (w.collection === "events") {
      if (w.op === "create") return !!(await db.insertEvent(w.payload));
      if (w.op === "update") return !!(await db.updateEvent(String(w.id), w.payload));
      return !!(await db.deleteEvent(String(w.id)));
    }
    return false;
  } catch {
    return false;
  }
}

export async function flushPendingWrites(
  runner: (w: PendingWrite) => Promise<boolean> = dbWriteRunner
): Promise<{ flushed: number; remaining: number }> {
  const pending = listPendingWrites();
  let flushed = 0;
  for (const w of pending) {
    let ok = false;
    try {
      ok = await runner(w);
    } catch {
      ok = false;
    }
    if (ok) {
      clearPendingWrite(w.key);
      flushed++;
    }
  }
  return { flushed, remaining: pending.length - flushed };
}

// Run a save; on success clear any stale queued entry for the same key, on
// failure queue it for automatic replay. Returns whether the write landed.
export async function saveOrQueue(
  write: PendingWrite,
  save: () => Promise<any>
): Promise<boolean> {
  let result: any = null;
  try {
    result = await save();
  } catch {
    result = null;
  }
  if (result) {
    clearPendingWrite(write.key);
    return true;
  }
  queueWrite(write);
  return false;
}
