import { withAdmin } from "@/lib/pb-auth";
import { withKeyedLock } from "@/lib/keyed-lock";
import { persistedTaskEmoji, persistedCrewEmoji } from "@/lib/task-emoji";
import type { WeekData, Transaction } from "@/types/tasks";

/**
 * Server-side access to the TASKS SNAPSHOT — the single source of truth the
 * dashboard actually renders (`consuela_data_snapshots`, key `tasks-snapshot`).
 *
 * Background (2026-09-21): the chat task tools used to read/write the PB
 * `tasks` COLLECTION, while the dashboard renders the browser-owned snapshot.
 * The two never met: chat completions/deletes were invisible in the Tasks UI,
 * and the browser's periodic `syncTasksToPB()` re-upserted its snapshot rows
 * back into the collection, resurrecting whatever chat had deleted. These
 * helpers make the chat operate on the SAME store the UI reads.
 *
 * Deletions need a tombstone: the client merge is add-only, so a plainly
 * removed row is re-pushed by any device that still has it. `deletedTaskIds`
 * records removals so every device honours them (see `mergeTasksSnapshot`).
 */

export const SNAPSHOT_KEY = "tasks-snapshot";
export const SNAPSHOT_COLLECTION = "consuela_data_snapshots";

export type SnapshotTask = Record<string, any> & {
  id: number;
  title: string;
  assignee?: string;
};

export type SnapshotData = Record<string, any> & {
  tasks?: SnapshotTask[];
  deletedTaskIds?: number[];
};

/** Live (non-tombstoned) tasks from a snapshot blob. */
export function liveSnapshotTasks(data: SnapshotData | null | undefined): SnapshotTask[] {
  const tasks = Array.isArray(data?.tasks) ? (data!.tasks as SnapshotTask[]) : [];
  const dead = new Set((data?.deletedTaskIds || []).map((n) => Number(n)));
  return tasks.filter((t) => !dead.has(Number(t?.id)));
}

/** taskId-first, then exact title (case-insensitive), optional assignee filter. */
export function findSnapshotTask(
  tasks: SnapshotTask[],
  args: { taskId?: number; title?: string; assignee?: string }
): SnapshotTask | null {
  if (args.taskId !== undefined && args.taskId !== null) {
    const id = Number(args.taskId);
    return tasks.find((t) => Number(t.id) === id) || null;
  }
  if (args.title) {
    const t = String(args.title).trim().toLowerCase();
    const a = args.assignee ? String(args.assignee).trim().toLowerCase() : undefined;
    const matches = (row: SnapshotTask) =>
      String(row.title || "").trim().toLowerCase() === t &&
      (!a || String(row.assignee || "").toLowerCase().includes(a));
    return tasks.find(matches) || null;
  }
  return null;
}

/** Apply a patch to one task row (by id). Returns a new array. */
export function patchSnapshotTask(
  tasks: SnapshotTask[],
  id: number,
  patch: Partial<SnapshotTask>
): SnapshotTask[] {
  return tasks.map((t) => (Number(t.id) === Number(id) ? { ...t, ...patch } : t));
}

/**
 * Remove a task and record the tombstone so every device drops it. The row is
 * also pulled out of `tasks` (a tombstoned row must not re-enter via a merge).
 */
export function deleteSnapshotTask(data: SnapshotData, id: number): SnapshotData {
  const n = Number(id);
  const tomb = new Set((data.deletedTaskIds || []).map((x) => Number(x)));
  tomb.add(n);
  return {
    ...data,
    tasks: (data.tasks || []).filter((t) => Number(t?.id) !== n),
    deletedTaskIds: [...tomb],
  };
}

/** Add-or-replace a task row (upsert by id) and clear any tombstone on it. */
export function upsertSnapshotTask(data: SnapshotData, task: SnapshotTask): SnapshotData {
  const n = Number(task.id);
  const tasks = (data.tasks || []).filter((t) => Number(t?.id) !== n);
  const tomb = (data.deletedTaskIds || []).map((x) => Number(x)).filter((x) => x !== n);
  return { ...data, tasks: [...tasks, task], deletedTaskIds: tomb };
}

/**
 * Push-side guard for POST /api/tasks/sync's tasks leg (2026-09-23 review).
 *
 * The snapshot's completion state now has TWO writers: the browser push (a
 * device's full local list) and the server claim/approve routes (pending
 * taps land via persistSnapshotWeek). Kid devices never push the snapshot,
 * so a parent's stale local list — captured before a kid's claim landed —
 * used to REPLACE the tasks leg verbatim and silently erase the just-written
 * `pendingApproval`: the kid's "on the way" row never reached the parent
 * queue, the points were never paid, and nothing self-healed (the weekData
 * leg union-merges by tx id, the tasks leg did not).
 *
 * Mirrors the pull-side proof gates in `mergeTasksSnapshot` (task-utils): a
 * pushed row may only CLEAR a stored live pending when the PUSH carries
 * proof — an earn tx for that task in the pusher's own weekData.history
 * (approval happened on the pushing device) or a sentBackAt stamp that does
 * not pre-date the stored tap — or carries an even FRESHER claim
 * (newest-claim-wins). Symmetrically, a pushed row may not RE-INTRODUCE a
 * pending the stored row has already resolved (paid in the stored history,
 * or sent back after the pushed tap) — that is a stale device resurrecting a
 * ghost approval.
 *
 * Rows with no pendingApproval on either side pass through verbatim.
 */
export function protectPendingOnPush(args: {
  storedTasks: SnapshotTask[];
  pushedTasks: SnapshotTask[];
  /** Pusher's weekData.history — parent pushes only (kids never approve). */
  pushedHistory?: unknown[];
  /** The stored snapshot's weekData.history (server-side resolution proof). */
  storedHistory?: unknown[];
}): SnapshotTask[] {
  const { storedTasks, pushedTasks, pushedHistory, storedHistory } = args;
  const byId = new Map(storedTasks.map((t) => [Number(t?.id), t]));
  const hasEarnFor = (history: unknown[] | undefined, id: number) =>
    Array.isArray(history) &&
    history.some((tx: any) => tx?.type === "earn" && Number(tx?.taskId) === id);
  const ts = (v: unknown): number | null => {
    const n = Date.parse(String(v ?? ""));
    return Number.isNaN(n) ? null : n;
  };
  // The stored row's completion stamps travel with whichever pending wins —
  // a live pending implies its own completion, a resolved row implies its
  // own reopen. A protected pushed row keeps every OTHER pushed field (a
  // parent's legitimate title/points edits still land).
  const storedCompletion = (s: SnapshotTask) => ({
    completed: (s as any).completed ?? false,
    completedBy: (s as any).completedBy ?? null,
    completedAt: (s as any).completedAt ?? null,
    completedInWeek: (s as any).completedInWeek ?? null,
  });
  return pushedTasks.map((p) => {
    const s = byId.get(Number(p?.id));
    if (!s) return p; // fresh row the server doesn't know — the push owns it
    const id = Number(p.id);
    const storedPending = (s as any).pendingApproval ?? null;
    const pushedPending = (p as any).pendingApproval ?? null;
    if (!storedPending && !pushedPending) return p;

    if (storedPending && !pushedPending) {
      const storedAt = ts((storedPending as any)?.at);
      const pushedSentBack = ts((p as any).sentBackAt);
      const mayClear =
        hasEarnFor(pushedHistory, id) ||
        (pushedSentBack !== null && (storedAt === null || pushedSentBack >= storedAt));
      if (mayClear) return p;
      // Protect the live stored tap. sentBackAt: null — a live pending has
      // no send-back in effect (also clears pre-parity stale stamps).
      return {
        ...p,
        ...storedCompletion(s),
        pendingApproval: storedPending,
        sentBackAt: null,
      };
    }

    if (!storedPending && pushedPending) {
      const pushedAt = ts((pushedPending as any)?.at);
      const storedSentBack = ts((s as any).sentBackAt);
      const resolved =
        hasEarnFor(storedHistory, id) ||
        (storedSentBack !== null && (pushedAt === null || storedSentBack >= pushedAt));
      if (!resolved) return p; // genuinely fresh pending the server lacks — accept (self-heal)
      // Ghost: strip the stale pending and restore the stored resolution state.
      return {
        ...p,
        ...storedCompletion(s),
        pendingApproval: null,
        sentBackAt: (s as any).sentBackAt ?? null,
      };
    }

    // Both sides claim a pending — newest claim wins.
    const storedAt = ts((storedPending as any)?.at) ?? 0;
    const pushedAt = ts((pushedPending as any)?.at) ?? 0;
    if (pushedAt >= storedAt) return p;
    return {
      ...p,
      ...storedCompletion(s),
      pendingApproval: storedPending,
      sentBackAt: null,
    };
  });
}

async function readRow(): Promise<{ id: string | null; data: SnapshotData }> {
  return withAdmin(async (pb) => {
    const rows = await pb.collection(SNAPSHOT_COLLECTION).getFullList({
      requestKey: null,
      filter: `key = "${SNAPSHOT_KEY}"`,
    });
    const row = rows[0] as any;
    return { id: row?.id ?? null, data: (row?.data ?? {}) as SnapshotData };
  });
}

/** Read the live task list (tombstones already applied). */
export async function readSnapshotTasks(): Promise<SnapshotTask[]> {
  const { data } = await readRow();
  return liveSnapshotTasks(data);
}

/**
 * Read-modify-write the snapshot under the SAME keyed lock the sync route and
 * claim route use, so a chat mutation can never be interleaved away by a
 * browser push. `fn` receives the full blob and returns the next blob.
 */
export async function mutateSnapshot<T>(
  fn: (data: SnapshotData) => { data: SnapshotData; result: T }
): Promise<T> {
  return withKeyedLock(`snapshot:${SNAPSHOT_KEY}`, () =>
    withAdmin(async (pb) => {
      const rows = await pb.collection(SNAPSHOT_COLLECTION).getFullList({
        requestKey: null,
        filter: `key = "${SNAPSHOT_KEY}"`,
      });
      const row = rows[0] as any;
      const current = (row?.data ?? {}) as SnapshotData;
      const { data, result } = fn(current);
      const payload = { key: SNAPSHOT_KEY, data, updated_at: new Date().toISOString() };
      if (rows.length > 0) await pb.collection(SNAPSHOT_COLLECTION).update(row.id, payload, { requestKey: null });
      else await pb.collection(SNAPSHOT_COLLECTION).create(payload, { requestKey: null });
      return result;
    })
  );
}

/**
 * Best-effort mirror of a task mutation into the PB `tasks` collection so
 * server-side readers (Home widget SSR, crons) stay roughly consistent. The
 * snapshot is authoritative; a failure here is logged, never thrown.
 */
export async function mirrorTaskToCollection(
  op: "upsert" | "delete",
  task: SnapshotTask | { id: number }
): Promise<void> {
  try {
    await withAdmin(async (pb) => {
      const rows = await pb.collection("tasks").getFullList({ requestKey: null });
      const existing = rows.find((r: any) => Number(r.taskId) === Number((task as any).id));
      if (op === "delete") {
        if (existing) await pb.collection("tasks").delete((existing as any).id, { requestKey: null });
        return;
      }
      const t = task as SnapshotTask;
      const rec = {
        taskId: Number(t.id),
        title: t.title,
        assignee: t.assignee ?? "All",
        // Snapshot may hold a full photo avatar; PB tasks.assigneeEmoji max=5000.
        assigneeEmoji: persistedTaskEmoji(t.assigneeEmoji) || "👤",
        assigned: t.assignee ?? "All",
        status: t.completed ? "done" : "pending",
        due: t.due ?? null,
        points: t.points ?? 0,
        recurring: t.recurring ?? null,
        category: t.category ?? "chores",
        priority: t.priority ?? "medium",
        universal: t.universal ?? false,
        stealable: t.stealable ?? false,
        completed: t.completed ?? false,
        completedBy: t.completedBy ?? null,
        completedAt: t.completedAt ?? null,
        completedInWeek: t.completedInWeek ?? null,
        pendingApproval: t.pendingApproval ?? null,
        sentBackAt: t.sentBackAt ?? null,
        crewSize: t.crewSize ?? null,
        // Crew member emojis ride the same PB json field — photo avatars
        // from members.emoji must be gated exactly like assigneeEmoji.
        crew: persistedCrewEmoji(t.crew as any),
        speedBonus: t.speedBonus ?? null,
      };
      if (existing) await pb.collection("tasks").update((existing as any).id, rec, { requestKey: null });
      else await pb.collection("tasks").create(rec, { requestKey: null });
    });
  } catch (e: any) {
    console.warn("[snapshot-tasks] collection mirror failed:", e?.data ?? e?.message ?? e);
  }
}

type PB = ReturnType<typeof import("@/lib/pb").getAdminPB>;

export type SnapshotWeekTaskPatch = {
  id: number;
  crew?: unknown;
  completed?: boolean;
  completedBy?: string;
  completedAt?: string;
  completedInWeek?: string;
  pendingApproval?: unknown;
  sentBackAt?: unknown;
};

/**
 * Persist weekData (and/or a task-row patch) into the snapshot blob under the
 * SNAPSHOT keyed lock. Callers MUST already hold the week-ledger lock so the
 * global order stays week-ledger → snapshot (never reversed).
 *
 * Union-merges history by transaction id so a concurrent claim's tx is never
 * dropped, and only adopts a week at least as new as what's stored.
 * Best-effort: week_data stays authoritative; failures are logged.
 */
export async function persistSnapshotWeek(
  pb: PB,
  weekData: WeekData | null,
  taskRow?: SnapshotWeekTaskPatch
): Promise<void> {
  await withKeyedLock(`snapshot:${SNAPSHOT_KEY}`, async () => {
    try {
      const rows = await pb.collection(SNAPSHOT_COLLECTION).getFullList({
        requestKey: null,
        filter: `key = "${SNAPSHOT_KEY}"`,
      });
      const row: any = rows[0];
      const raw = row?.data;
      let data: any = {};
      if (typeof raw === "string") {
        try { data = JSON.parse(raw) || {}; } catch { data = {}; }
      } else if (raw && typeof raw === "object") {
        data = raw;
      }
      if (weekData) {
        const stored: any = data.weekData ?? {};
        const storedStart = typeof stored.weekStart === "string" ? stored.weekStart : "";
        let mergedWeek: WeekData = weekData;
        if (storedStart && storedStart > weekData.weekStart) {
          mergedWeek = stored;
        } else if (storedStart === weekData.weekStart) {
          const byId = new Map<number, Transaction>();
          for (const t of Array.isArray(stored.history) ? stored.history : []) byId.set(t.id, t);
          for (const t of weekData.history) byId.set(t.id, t);
          const history = [...byId.values()].sort((a, b) =>
            String(a.timestamp).localeCompare(String(b.timestamp))
          );
          const points: Record<string, number> = {};
          for (const t of history) {
            if (t.type === "earn") points[t.member] = (points[t.member] || 0) + t.amount;
            else if (t.type === "redeem" || t.type === "penalty" || (t.type === "adjust" && t.amount < 0)) {
              points[t.member] = Math.max(0, (points[t.member] || 0) + t.amount);
            } else if (t.type === "adjust") {
              points[t.member] = (points[t.member] || 0) + t.amount;
            }
          }
          mergedWeek = { ...weekData, history, points };
        }
        data.weekData = mergedWeek;
      }
      if (taskRow && Array.isArray(data.tasks)) {
        data.tasks = data.tasks.map((t: any) =>
          Number(t.id) === Number(taskRow.id)
            ? {
                ...t,
                ...(taskRow.crew !== undefined ? { crew: taskRow.crew } : {}),
                ...(taskRow.completed !== undefined ? { completed: taskRow.completed } : {}),
                ...(taskRow.completedBy !== undefined ? { completedBy: taskRow.completedBy } : {}),
                ...(taskRow.completedAt !== undefined ? { completedAt: taskRow.completedAt } : {}),
                ...(taskRow.completedInWeek !== undefined ? { completedInWeek: taskRow.completedInWeek } : {}),
                ...(taskRow.pendingApproval !== undefined ? { pendingApproval: taskRow.pendingApproval } : {}),
                ...(taskRow.sentBackAt !== undefined ? { sentBackAt: taskRow.sentBackAt } : {}),
              }
            : t
        );
      }
      const payload = { key: SNAPSHOT_KEY, data, updated_at: new Date().toISOString() };
      if (row) await pb.collection(SNAPSHOT_COLLECTION).update(row.id, payload, { requestKey: null });
      else await pb.collection(SNAPSHOT_COLLECTION).create(payload, { requestKey: null });
    } catch (e: any) {
      console.warn("[persistSnapshotWeek] snapshot persist failed:", e?.message);
    }
  });
}
