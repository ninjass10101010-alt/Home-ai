import { withAdmin } from "@/lib/pb-auth";
import { withKeyedLock } from "@/lib/keyed-lock";

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
        assigneeEmoji: t.assigneeEmoji ?? "👤",
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
        crew: t.crew ?? null,
        speedBonus: t.speedBonus ?? null,
      };
      if (existing) await pb.collection("tasks").update((existing as any).id, rec, { requestKey: null });
      else await pb.collection("tasks").create(rec, { requestKey: null });
    });
  } catch (e: any) {
    console.warn("[snapshot-tasks] collection mirror failed:", e?.message);
  }
}
