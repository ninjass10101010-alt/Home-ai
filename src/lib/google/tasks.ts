import { googleFetch } from "./oauth-client.ts";
import { withAdmin } from "../pb-auth.ts";
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

interface TasksListResponse {
  items?: GoogleTask[];
  nextPageToken?: string;
}

interface TaskListsListResponse {
  items?: GoogleTaskList[];
  nextPageToken?: string;
}

async function getTasklists(): Promise<GoogleTaskList[]> {
  const all: GoogleTaskList[] = [];
  let pageToken: string | undefined;
  while (true) {
    const q: Record<string, string> = { maxResults: "100" };
    if (pageToken) q.pageToken = pageToken;
    const res = await googleFetch<TaskListsListResponse>(
      "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
      { method: "GET", query: q, endpoint: "/tasks/v1/users/@me/lists" },
    );
    if (res.data.items) all.push(...res.data.items);
    if (res.data.nextPageToken) pageToken = res.data.nextPageToken;
    else break;
  }
  return all;
}

async function getOrCreateConsuelaListId(): Promise<string> {
  const lists = await getTasklists();
  const existing = lists.find((l) => l.title === CONSUELA_LIST_TITLE);
  if (existing) {
    await upsertTasklist(existing, true);
    return existing.id;
  }
  const res = await googleFetch<GoogleTaskList>(
    "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
    {
      method: "POST",
      body: { title: CONSUELA_LIST_TITLE },
      endpoint: "/tasks/v1/users/@me/lists",
    },
  );
  await upsertTasklist(res.data, true);
  return res.data.id;
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

async function listAllTasks(tasklistId: string): Promise<GoogleTask[]> {
  const all: GoogleTask[] = [];
  let pageToken: string | undefined;
  while (true) {
    const q: Record<string, string> = {
      showCompleted: "true",
      showDeleted: "true",
      showHidden: "true",
      maxResults: "100",
    };
    if (pageToken) q.pageToken = pageToken;
    const res = await googleFetch<TasksListResponse>(
      `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklistId)}/tasks`,
      { method: "GET", query: q, endpoint: "/tasks/v1/lists/{id}/tasks" },
    );
    if (res.data.items) all.push(...res.data.items);
    if (res.data.nextPageToken) pageToken = res.data.nextPageToken;
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

export async function syncTasks(): Promise<TaskSyncResult> {
  const consuelaListId = await getOrCreateConsuelaListId();
  const allLists = await getTasklists();
  let upserted = 0;
  let deleted = 0;

  for (const list of allLists) {
    if (list.id !== consuelaListId) {
      await upsertTasklist(list, false);
    }
    const tasks = await listAllTasks(list.id);
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

export async function createTask(tasklistId: string, input: TaskInput): Promise<GoogleTask> {
  const body: any = {
    title: input.title,
    notes: input.notes,
    status: input.status || "needsAction",
  };
  if (input.due) body.due = input.due;

  const res = await googleFetch<GoogleTask>(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklistId)}/tasks`,
    { method: "POST", body, endpoint: "/tasks/v1/lists/{id}/tasks" },
  );
  return res.data;
}

export async function updateTask(
  tasklistId: string,
  taskId: string,
  input: Partial<TaskInput>,
): Promise<GoogleTask> {
  const res = await googleFetch<GoogleTask>(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: "PATCH", body: input, endpoint: "/tasks/v1/lists/{id}/tasks/{taskId}" },
  );
  return res.data;
}

export async function deleteTask(tasklistId: string, taskId: string): Promise<void> {
  await googleFetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: "DELETE", endpoint: "/tasks/v1/lists/{id}/tasks/{taskId}" },
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
  const listId = await getOrCreateConsuelaListId();
  const task = await createTask(listId, {
    title: args.title,
    due: args.due,
    notes: args.notes,
  });
  return { listId, task };
}

export async function getConsuelaListId(): Promise<string> {
  return getOrCreateConsuelaListId();
}

export { CONSUMELA_TAG };
