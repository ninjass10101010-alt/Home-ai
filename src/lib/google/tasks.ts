import { withAdmin } from "../pb-auth.ts";
import { executeComposioAction, ComposioError } from "./composio.ts";
import { COMPOSIO_ACTIONS } from "./composio-actions.ts";
import { readConnectionSnapshot, TASKS_SNAPSHOT_KEY } from "./connection-state.ts";
import type { GoogleTask, GoogleTaskList } from "./types.ts";

const CONSUELA_LIST_TITLE = "Consuela";
const TASKS_COLLECTION = "consuela_google_tasks";
const TASKLISTS_COLLECTION = "consuela_google_tasklists";
const SYNC_STATE_COLLECTION = "consuela_google_sync_state";
const CONSUMELA_TAG = "consuelaDashboard";

export interface TaskSyncResult {
  tasks: number;
  tasklists: number;
  deleted: number;
}

export interface TaskSyncSkipped {
  skipped: true;
  reason: string;
}

export type TaskSyncOutcome = TaskSyncResult | TaskSyncSkipped;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

// Composio execute responses are `{ data, successful, error }`. A tool that
// ran but failed reports HTTP 200 with `successful:false` — that must throw
// rather than read as an empty page.
function unwrapExecuteResult(payload: unknown): unknown {
  const record = asRecord(payload);
  if (record && record.successful === false) {
    const error = asRecord(record.error);
    const message =
      typeof error?.message === "string" && error.message
        ? error.message
        : "Composio tasks action failed";
    throw new ComposioError("api_error", message);
  }
  if (record && "data" in record) return record.data;
  return payload;
}

function collectItems(root: unknown, keys: string[]): unknown[] {
  if (Array.isArray(root)) return root;
  const record = asRecord(root);
  if (!record) return [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return [value];
  }
  // A bare single resource (e.g. an INSERT_TASK response) has no list key.
  if (typeof record.id === "string" || typeof record.id === "number") return [record];
  return [];
}

function nextPageToken(payload: unknown): string | undefined {
  const record = asRecord(unwrapExecuteResult(payload));
  const token = record?.nextPageToken ?? record?.next_page_token;
  return typeof token === "string" && token ? token : undefined;
}

// Pure mappers. Google keys tasklists under `items` and tasks under `tasks`;
// every wrapper variant is normalized defensively before reaching the caches.
export function mapTaskListsPayload(payload: unknown): GoogleTaskList[] {
  const lists: GoogleTaskList[] = [];
  for (const item of collectItems(unwrapExecuteResult(payload), ["items", "taskLists"])) {
    const record = asRecord(item);
    const id = typeof record?.id === "string" ? record.id : "";
    if (!id) continue;
    const list: GoogleTaskList = {
      id,
      title: typeof record?.title === "string" ? record.title : "",
    };
    if (typeof record?.updated === "string") list.updated = record.updated;
    if (typeof record?.selfLink === "string") list.selfLink = record.selfLink;
    lists.push(list);
  }
  return lists;
}

export function mapTasksPayload(payload: unknown): GoogleTask[] {
  const tasks: GoogleTask[] = [];
  for (const item of collectItems(unwrapExecuteResult(payload), ["tasks", "items", "task"])) {
    const record = asRecord(item);
    const id = typeof record?.id === "string" ? record.id : "";
    if (!id) continue;
    const task: GoogleTask = {
      id,
      title: typeof record?.title === "string" ? record.title : "",
      status: record?.status === "completed" ? "completed" : "needsAction",
    };
    if (typeof record?.notes === "string") task.notes = record.notes;
    if (typeof record?.due === "string") task.due = record.due;
    if (typeof record?.completed === "string") task.completed = record.completed;
    if (typeof record?.updated === "string") task.updated = record.updated;
    if (typeof record?.etag === "string") task.etag = record.etag;
    if (typeof record?.parent === "string") task.parent = record.parent;
    if (typeof record?.position === "string") task.position = record.position;
    if (Array.isArray(record?.links)) task.links = record.links as GoogleTask["links"];
    tasks.push(task);
  }
  return tasks;
}

function firstTask(payload: unknown): GoogleTask {
  const tasks = mapTasksPayload(payload);
  if (tasks.length === 0) throw new ComposioError("api_error", "Composio did not return a task");
  return tasks[0];
}

async function readTasksAccountId(): Promise<string> {
  const snapshot = await readConnectionSnapshot(TASKS_SNAPSHOT_KEY);
  if (!snapshot.connectedAccountId) {
    throw new ComposioError("not_connected", "Google Tasks account is not connected");
  }
  return snapshot.connectedAccountId;
}

async function getTasklists(accountId: string): Promise<GoogleTaskList[]> {
  const all: GoogleTaskList[] = [];
  let pageToken: string | undefined;
  while (true) {
    const args: Record<string, unknown> = { maxResults: 100 };
    if (pageToken) args.pageToken = pageToken;
    const res = await executeComposioAction<unknown>(
      COMPOSIO_ACTIONS.TASKS_LIST_TASKLISTS,
      args,
      accountId,
    );
    all.push(...mapTaskListsPayload(res));
    const next = nextPageToken(res);
    if (next) pageToken = next;
    else break;
  }
  return all;
}

async function getOrCreateConsuelaListId(accountId: string): Promise<string> {
  const lists = await getTasklists(accountId);
  const existing = lists.find((l) => l.title === CONSUELA_LIST_TITLE);
  if (existing) {
    await upsertTasklist(existing, true);
    return existing.id;
  }
  // COMPOSIO_ACTIONS pins no "create task list" action, so the dashboard can
  // no longer mint its own list — fall back to the account's default list
  // instead of hardcoding an unpinned slug.
  const fallback = lists.find((l) => l.id === "@default") ?? lists[0];
  if (!fallback) throw new ComposioError("api_error", "No Google Tasks list is available");
  await upsertTasklist(fallback, false);
  return fallback.id;
}

async function upsertTasklist(list: GoogleTaskList, ownedByDashboard: boolean): Promise<void> {
  await withAdmin(async (pb) => {
    const rows = await pb
      .collection(TASKLISTS_COLLECTION)
      .getFullList({ requestKey: null, filter: `google_id = "${list.id}"` });
    const payload = {
      google_id: list.id,
      title: list.title,
      owned_by_dashboard: ownedByDashboard,
      updated_remote: list.updated || "",
    };
    if (rows.length > 0) {
      await pb.collection(TASKLISTS_COLLECTION).update(rows[0].id, payload, { requestKey: null });
    } else {
      await pb.collection(TASKLISTS_COLLECTION).create(payload, { requestKey: null });
    }
  });
}

async function listAllTasks(accountId: string, tasklistId: string): Promise<GoogleTask[]> {
  const all: GoogleTask[] = [];
  let pageToken: string | undefined;
  while (true) {
    const args: Record<string, unknown> = {
      tasklist_id: tasklistId,
      showCompleted: true,
      showDeleted: true,
      showHidden: true,
      maxResults: 100,
    };
    if (pageToken) args.pageToken = pageToken;
    const res = await executeComposioAction<unknown>(
      COMPOSIO_ACTIONS.TASKS_LIST_TASKS,
      args,
      accountId,
    );
    all.push(...mapTasksPayload(res));
    const next = nextPageToken(res);
    if (next) pageToken = next;
    else break;
  }
  return all;
}

async function getOwnedTasklists(): Promise<{ id: string; title: string }[]> {
  return withAdmin(async (pb) => {
    const rows = await pb
      .collection(TASKLISTS_COLLECTION)
      .getFullList({ requestKey: null });
    return rows
      .filter((r: any) => r.owned_by_dashboard)
      .map((r: any) => ({ id: r.google_id, title: r.title }));
  });
}

function taskToRow(t: GoogleTask, listId: string) {
  const isReminder = !!t.due;
  return {
    google_id: t.id,
    tasklist_id: listId,
    title: t.title || "(no title)",
    notes: t.notes || "",
    due: t.due || "",
    status: t.status,
    completed: t.completed || "",
    kind: isReminder ? "reminder" : "chore",
    etag: t.etag || "",
    updated_remote: t.updated || "",
    raw: t,
    source: "google",
  };
}

async function saveSyncState(token: string | null, error?: string): Promise<void> {
  await withAdmin(async (pb) => {
    const rows = await pb
      .collection(SYNC_STATE_COLLECTION)
      .getFullList({ requestKey: null, filter: `resource = "tasks"` });
    const payload = {
      resource: "tasks",
      sync_token: token,
      last_sync_at: new Date().toISOString(),
      last_status: error ? "error" : "ok",
      last_error: error || null,
    };
    if (rows.length > 0) {
      await pb
        .collection(SYNC_STATE_COLLECTION)
        .update(rows[0].id, payload, { requestKey: null });
    } else {
      await pb.collection(SYNC_STATE_COLLECTION).create(payload, { requestKey: null });
    }
  });
}

// Tasks is an optional second Composio connection: with no
// `google_composio_tasks` snapshot this is a no-op (no Composio/Google call).
// Failures reject — the caller's best-effort catch keeps them out of calendar
// sync.
export async function syncTasks(): Promise<TaskSyncOutcome> {
  const snapshot = await readConnectionSnapshot(TASKS_SNAPSHOT_KEY);
  const accountId = snapshot.connectedAccountId;
  if (!accountId) return { skipped: true, reason: "tasks_not_connected" };

  const consuelaListId = await getOrCreateConsuelaListId(accountId);
  const allLists = await getTasklists(accountId);
  let upserted = 0;
  let deleted = 0;

  for (const list of allLists) {
    if (list.id !== consuelaListId) {
      await upsertTasklist(list, false);
    }
    const tasks = await listAllTasks(accountId, list.id);
    await withAdmin(async (pb) => {
      for (const t of tasks) {
        if (t.status === "completed" && !t.completed) {
          continue;
        }
        if (t.title === "" && !t.notes && !t.due) {
          const existing = await pb
            .collection(TASKS_COLLECTION)
            .getFullList({ requestKey: null, filter: `google_id = "${t.id.replace(/"/g, '\\"')}"` });
          for (const row of existing) {
            await pb.collection(TASKS_COLLECTION).delete(row.id, { requestKey: null });
            deleted++;
          }
          continue;
        }
        const row = taskToRow(t, list.id);
        const existing = await pb
          .collection(TASKS_COLLECTION)
          .getFullList({ requestKey: null, filter: `google_id = "${t.id.replace(/"/g, '\\"')}"` });
        if (existing.length > 0) {
          await pb.collection(TASKS_COLLECTION).update(existing[0].id, row, { requestKey: null });
        } else {
          await pb.collection(TASKS_COLLECTION).create(row, { requestKey: null });
        }
        upserted++;
      }
    });
  }

  await saveSyncState(new Date().toISOString());

  return { tasks: upserted, tasklists: allLists.length, deleted };
}

export async function readCachedTasks(): Promise<any[]> {
  return withAdmin(async (pb) => {
    const rows = await pb.collection(TASKS_COLLECTION).getFullList({ requestKey: null });
    return rows;
  });
}

export async function readCachedReminders(): Promise<any[]> {
  return withAdmin(async (pb) => {
    const rows = await pb
      .collection(TASKS_COLLECTION)
      .getFullList({ requestKey: null, filter: `kind = "reminder"` });
    return rows;
  });
}

export interface TaskInput {
  title: string;
  notes?: string;
  due?: string;
  status?: "needsAction" | "completed";
}

async function createTaskForAccount(
  accountId: string,
  tasklistId: string,
  input: TaskInput,
): Promise<GoogleTask> {
  const args: Record<string, unknown> = {
    tasklist_id: tasklistId,
    title: input.title,
    status: input.status || "needsAction",
  };
  if (input.notes !== undefined) args.notes = input.notes;
  if (input.due) args.due = input.due;

  const res = await executeComposioAction<unknown>(
    COMPOSIO_ACTIONS.TASKS_CREATE_TASK,
    args,
    accountId,
  );
  return firstTask(res);
}

export async function createTask(tasklistId: string, input: TaskInput): Promise<GoogleTask> {
  return createTaskForAccount(await readTasksAccountId(), tasklistId, input);
}

export async function updateTask(
  tasklistId: string,
  taskId: string,
  input: Partial<TaskInput>,
): Promise<GoogleTask> {
  const accountId = await readTasksAccountId();
  const args: Record<string, unknown> = { tasklist_id: tasklistId, task_id: taskId };
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) args[key] = value;
  }
  const res = await executeComposioAction<unknown>(
    COMPOSIO_ACTIONS.TASKS_UPDATE_TASK,
    args,
    accountId,
  );
  return firstTask(res);
}

export async function deleteTask(tasklistId: string, taskId: string): Promise<void> {
  const accountId = await readTasksAccountId();
  await executeComposioAction(
    COMPOSIO_ACTIONS.TASKS_DELETE_TASK,
    { tasklist_id: tasklistId, task_id: taskId },
    accountId,
  );
}

export async function completeTask(
  tasklistId: string,
  taskId: string,
): Promise<GoogleTask> {
  return updateTask(tasklistId, taskId, {
    status: "completed",
  });
}

export async function uncompleteTask(
  tasklistId: string,
  taskId: string,
): Promise<GoogleTask> {
  return updateTask(tasklistId, taskId, {
    status: "needsAction",
  });
}

export async function createReminder(args: {
  title: string;
  due: string;
  notes?: string;
}): Promise<{ listId: string; task: GoogleTask }> {
  const accountId = await readTasksAccountId();
  const listId = await getOrCreateConsuelaListId(accountId);
  const task = await createTaskForAccount(accountId, listId, {
    title: args.title,
    due: args.due,
    notes: args.notes,
  });
  return { listId, task };
}

export async function getConsuelaListId(): Promise<string> {
  return getOrCreateConsuelaListId(await readTasksAccountId());
}

export { CONSUMELA_TAG };
