// Task 10 — Google Tasks syncs through Composio actions.
//
// Tasks is an optional SECOND Composio connection (`google_composio_tasks`),
// separate from calendar. `syncTasks()` must:
//   - map Composio payloads into the existing consuela_google_tasklists /
//     consuela_google_tasks caches (Google keys tasks under `tasks`, tasklists
//     under `items`),
//   - skip with `tasks_not_connected` and ZERO network calls when no tasks
//     account is connected,
//   - reject on failure so the caller's best-effort catch owns containment —
//     a tasks failure never fails calendar sync.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  executeComposioAction: vi.fn(),
  readConnectionSnapshot: vi.fn(),
}));

vi.mock("../../src/lib/pb-auth.ts", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("../../src/lib/google/composio.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/google/composio.ts")>();
  return { ...actual, executeComposioAction: mocks.executeComposioAction };
});

vi.mock("../../src/lib/google/connection-state.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/google/connection-state.ts")>();
  return { ...actual, readConnectionSnapshot: mocks.readConnectionSnapshot };
});

import { COMPOSIO_ACTIONS } from "../../src/lib/google/composio-actions.ts";
import { TASKS_SNAPSHOT_KEY } from "../../src/lib/google/connection-state.ts";
import {
  createTask,
  deleteTask,
  getConsuelaListId,
  mapTaskListsPayload,
  mapTasksPayload,
  syncTasks,
} from "../../src/lib/google/tasks.ts";

const TASKS_ACCOUNT = {
  connectedAccountId: "ca_tasks_1",
  status: "ACTIVE",
  accountEmail: "family@example.com",
  connectedAt: "2030-01-01T00:00:00.000Z",
  lastVerifiedAt: "2030-01-02T00:00:00.000Z",
};

const EMPTY_SNAPSHOT = {
  connectedAccountId: null,
  status: null,
  accountEmail: null,
  connectedAt: null,
  lastVerifiedAt: null,
};

const db = {
  tasklists: [] as any[],
  tasks: [] as any[],
  syncState: [] as any[],
};

function makeCollection(rows: any[]) {
  return {
    getFullList: vi.fn(async (args?: { filter?: string }) => {
      const match = /google_id = "((?:\\.|[^"])*)"/.exec(args?.filter || "");
      if (!match) return rows;
      const id = match[1].replace(/\\"/g, '"');
      return rows.filter((row) => row.google_id === id);
    }),
    create: vi.fn(async (payload: any) => {
      const row = { id: `row-${rows.length + 1}`, ...payload };
      rows.push(row);
      return row;
    }),
    update: vi.fn(async (id: string, payload: any) => {
      const row = rows.find((r) => r.id === id);
      if (row) Object.assign(row, payload);
      return { id, ...payload };
    }),
    delete: vi.fn(async (id: string) => {
      const index = rows.findIndex((r) => r.id === id);
      if (index >= 0) rows.splice(index, 1);
      return true;
    }),
  };
}

function makePb() {
  return {
    collection: (name: string) => {
      if (name === "consuela_google_tasklists") return makeCollection(db.tasklists);
      if (name === "consuela_google_tasks") return makeCollection(db.tasks);
      if (name === "consuela_google_sync_state") return makeCollection(db.syncState);
      return makeCollection([]);
    },
  };
}

beforeEach(() => {
  db.tasklists = [];
  db.tasks = [];
  db.syncState = [];
  mocks.withAdmin.mockReset();
  mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(makePb()));
  mocks.executeComposioAction.mockReset();
  mocks.readConnectionSnapshot.mockReset();
});

describe("syncTasks through Composio", () => {
  it("maps tasklists (items) and tasks (tasks key) into the two caches", async () => {
    mocks.readConnectionSnapshot.mockResolvedValue(TASKS_ACCOUNT);
    mocks.executeComposioAction.mockImplementation(
      async (action: string, args: Record<string, unknown>) => {
        if (action === COMPOSIO_ACTIONS.TASKS_LIST_TASKLISTS) {
          return {
            data: {
              items: [
                { id: "list_consuela", title: "Consuela", updated: "2026-10-01T00:00:00.000Z" },
                { id: "list_school", title: "School", updated: "2026-10-02T00:00:00.000Z" },
              ],
            },
            successful: true,
            error: null,
          };
        }
        if (action === COMPOSIO_ACTIONS.TASKS_LIST_TASKS) {
          if (args.tasklist_id === "list_consuela") {
            return {
              data: {
                tasks: [
                  {
                    id: "t_reminder",
                    title: "Pack lunches",
                    notes: "for tomorrow",
                    due: "2026-10-06T00:00:00.000Z",
                    status: "needsAction",
                    etag: "etag-1",
                    updated: "2026-10-05T00:00:00.000Z",
                  },
                  {
                    id: "t_chore",
                    title: "Sweep the porch",
                    status: "completed",
                    completed: "2026-10-04T12:00:00.000Z",
                  },
                ],
              },
              successful: true,
              error: null,
            };
          }
          return {
            data: { tasks: [{ id: "t_school", title: "Permission slip", status: "needsAction" }] },
            successful: true,
            error: null,
          };
        }
        throw new Error(`unexpected action: ${action}`);
      },
    );

    const result = await syncTasks();

    expect(result).toEqual({ tasks: 3, tasklists: 2, deleted: 0 });
    expect(mocks.readConnectionSnapshot).toHaveBeenCalledWith(TASKS_SNAPSHOT_KEY);

    const lists = Object.fromEntries(db.tasklists.map((row) => [row.google_id, row]));
    expect(lists.list_consuela).toMatchObject({
      title: "Consuela",
      owned_by_dashboard: true,
      updated_remote: "2026-10-01T00:00:00.000Z",
    });
    expect(lists.list_school).toMatchObject({
      title: "School",
      owned_by_dashboard: false,
      updated_remote: "2026-10-02T00:00:00.000Z",
    });

    const reminder = db.tasks.find((row) => row.google_id === "t_reminder");
    expect(reminder).toMatchObject({
      tasklist_id: "list_consuela",
      title: "Pack lunches",
      notes: "for tomorrow",
      due: "2026-10-06T00:00:00.000Z",
      status: "needsAction",
      kind: "reminder",
      etag: "etag-1",
      updated_remote: "2026-10-05T00:00:00.000Z",
      source: "google",
    });
    expect(reminder.raw).toMatchObject({ id: "t_reminder", title: "Pack lunches" });

    const chore = db.tasks.find((row) => row.google_id === "t_chore");
    expect(chore).toMatchObject({
      tasklist_id: "list_consuela",
      kind: "chore",
      status: "completed",
      completed: "2026-10-04T12:00:00.000Z",
    });
    expect(db.tasks.find((row) => row.google_id === "t_school")).toMatchObject({
      tasklist_id: "list_school",
    });

    expect(db.syncState).toHaveLength(1);
    expect(db.syncState[0]).toMatchObject({ resource: "tasks", last_status: "ok", last_error: null });

    expect(mocks.executeComposioAction).toHaveBeenCalledWith(
      COMPOSIO_ACTIONS.TASKS_LIST_TASKLISTS,
      expect.objectContaining({ maxResults: 100 }),
      "ca_tasks_1",
    );
    expect(mocks.executeComposioAction).toHaveBeenCalledWith(
      COMPOSIO_ACTIONS.TASKS_LIST_TASKS,
      expect.objectContaining({ tasklist_id: "list_consuela", showCompleted: true }),
      "ca_tasks_1",
    );
  });

  it("follows nextPageToken when listing tasks", async () => {
    mocks.readConnectionSnapshot.mockResolvedValue(TASKS_ACCOUNT);
    let taskPages = 0;
    mocks.executeComposioAction.mockImplementation(async (action: string) => {
      if (action === COMPOSIO_ACTIONS.TASKS_LIST_TASKLISTS) {
        return { data: { items: [{ id: "list_consuela", title: "Consuela" }] }, successful: true };
      }
      if (action === COMPOSIO_ACTIONS.TASKS_LIST_TASKS) {
        taskPages += 1;
        if (taskPages === 1) {
          return {
            data: { tasks: [{ id: "t_page_1", title: "First", status: "needsAction" }], nextPageToken: "page-2" },
            successful: true,
          };
        }
        return {
          data: { tasks: [{ id: "t_page_2", title: "Second", status: "needsAction" }] },
          successful: true,
        };
      }
      throw new Error(`unexpected action: ${action}`);
    });

    const result = await syncTasks();

    expect(result).toMatchObject({ tasks: 2 });
    expect(result).not.toHaveProperty("skipped");
    expect(mocks.executeComposioAction).toHaveBeenCalledWith(
      COMPOSIO_ACTIONS.TASKS_LIST_TASKS,
      expect.objectContaining({ pageToken: "page-2" }),
      "ca_tasks_1",
    );
  });

  it("skips with no network call when no tasks account is connected", async () => {
    mocks.readConnectionSnapshot.mockResolvedValue(EMPTY_SNAPSHOT);

    const result = await syncTasks();

    expect(result).toEqual({ skipped: true, reason: "tasks_not_connected" });
    expect(mocks.readConnectionSnapshot).toHaveBeenCalledWith(TASKS_SNAPSHOT_KEY);
    expect(mocks.executeComposioAction).not.toHaveBeenCalled();
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("skips a FAILED tasks account without a Composio call", async () => {
    mocks.readConnectionSnapshot.mockResolvedValue({ ...TASKS_ACCOUNT, status: "FAILED" });

    const result = await syncTasks();

    expect(result).toEqual({ skipped: true, reason: "tasks_not_connected" });
    expect(mocks.executeComposioAction).not.toHaveBeenCalled();
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("rejects a task action for a FAILED tasks account without a Composio call", async () => {
    mocks.readConnectionSnapshot.mockResolvedValue({ ...TASKS_ACCOUNT, status: "FAILED" });

    await expect(createTask("list_consuela", { title: "Nope" })).rejects.toMatchObject({
      code: "not_connected",
    });
    expect(mocks.executeComposioAction).not.toHaveBeenCalled();
  });

  it("rejects on a tasks failure so the caller can contain it (never calendar)", async () => {
    mocks.readConnectionSnapshot.mockResolvedValue(TASKS_ACCOUNT);
    mocks.executeComposioAction.mockRejectedValue(new Error("Composio error (500)"));

    await expect(syncTasks()).rejects.toThrow("Composio error (500)");
  });

  it("treats a Composio 200 successful:false execution as a failure, not an empty sync", async () => {
    mocks.readConnectionSnapshot.mockResolvedValue(TASKS_ACCOUNT);
    mocks.executeComposioAction.mockResolvedValue({
      data: null,
      successful: false,
      error: { message: "tool execution failed" },
    });

    await expect(syncTasks()).rejects.toThrow("tool execution failed");
  });
});

describe("tasks CRUD envelope handling", () => {
  it("returns an INSERT_TASK result nested under data.response_data", async () => {
    mocks.readConnectionSnapshot.mockResolvedValue(TASKS_ACCOUNT);
    mocks.executeComposioAction.mockResolvedValue({
      data: { response_data: { id: "t_new", title: "Created", status: "needsAction" } },
      successful: true,
      error: null,
    });

    await expect(createTask("list_consuela", { title: "Created" })).resolves.toMatchObject({
      id: "t_new",
      title: "Created",
    });
  });

  it("deleteTask rejects a tool-level unsuccessful envelope", async () => {
    mocks.readConnectionSnapshot.mockResolvedValue(TASKS_ACCOUNT);
    mocks.executeComposioAction.mockResolvedValue({
      data: null,
      successful: false,
      error: { message: "delete failed" },
    });

    await expect(deleteTask("list_consuela", "t_1")).rejects.toThrow("delete failed");
  });

  it("deleteTask resolves on a successful envelope", async () => {
    mocks.readConnectionSnapshot.mockResolvedValue(TASKS_ACCOUNT);
    mocks.executeComposioAction.mockResolvedValue({ data: { success: true }, successful: true });

    await expect(deleteTask("list_consuela", "t_1")).resolves.toBeUndefined();
  });
});

describe("getOrCreateConsuelaListId", () => {
  it("creates the Consuela list when no matching list exists", async () => {
    mocks.readConnectionSnapshot.mockResolvedValue(TASKS_ACCOUNT);
    mocks.executeComposioAction.mockImplementation(async (action: string) => {
      if (action === COMPOSIO_ACTIONS.TASKS_LIST_TASKLISTS) {
        return {
          data: { items: [{ id: "list_school", title: "School" }] },
          successful: true,
          error: null,
        };
      }
      if (action === COMPOSIO_ACTIONS.TASKS_CREATE_TASK_LIST) {
        return {
          data: { response_data: { id: "list_consuela", title: "Consuela" } },
          successful: true,
          error: null,
        };
      }
      throw new Error(`unexpected action: ${action}`);
    });

    await expect(getConsuelaListId()).resolves.toBe("list_consuela");

    expect(mocks.executeComposioAction).toHaveBeenCalledWith(
      COMPOSIO_ACTIONS.TASKS_CREATE_TASK_LIST,
      expect.objectContaining({ title: "Consuela" }),
      "ca_tasks_1",
    );
    expect(db.tasklists.find((row) => row.google_id === "list_consuela")).toMatchObject({
      title: "Consuela",
      owned_by_dashboard: true,
    });
  });

  it("reuses an existing Consuela list without creating another", async () => {
    mocks.readConnectionSnapshot.mockResolvedValue(TASKS_ACCOUNT);
    mocks.executeComposioAction.mockResolvedValue({
      data: { items: [{ id: "list_consuela", title: "Consuela" }] },
      successful: true,
      error: null,
    });

    await expect(getConsuelaListId()).resolves.toBe("list_consuela");
    expect(mocks.executeComposioAction).not.toHaveBeenCalledWith(
      COMPOSIO_ACTIONS.TASKS_CREATE_TASK_LIST,
      expect.anything(),
      expect.anything(),
    );
  });
});

describe("Composio payload mappers", () => {
  it("normalizes wrapper and shape variants defensively", () => {
    expect(
      mapTaskListsPayload({ data: { items: [{ id: "l1", title: "Home" }] }, successful: true }),
    ).toMatchObject([{ id: "l1", title: "Home" }]);
    expect(mapTaskListsPayload({ data: [{ id: "l2", title: "Work" }] })).toMatchObject([{ id: "l2" }]);
    expect(
      mapTasksPayload({ data: { tasks: [{ id: "t1", title: "A" }] }, successful: true })[0],
    ).toMatchObject({ id: "t1", title: "A", status: "needsAction" });
    expect(
      mapTasksPayload({ data: { items: [{ id: "t2", title: "B", status: "completed" }] } })[0],
    ).toMatchObject({ id: "t2", status: "completed" });
  });

  it("unwraps a response_data-nested INSERT/PATCH resource", () => {
    expect(
      mapTasksPayload({
        data: { response_data: { id: "t_new", title: "Created", status: "needsAction" } },
        successful: true,
        error: null,
      }),
    ).toMatchObject([{ id: "t_new", title: "Created" }]);
    expect(
      mapTaskListsPayload({
        data: { response_data: { id: "list_new", title: "Consuela" } },
        successful: true,
        error: null,
      }),
    ).toMatchObject([{ id: "list_new", title: "Consuela" }]);
  });

  it("throws on a failed Composio execution instead of mapping it as empty", () => {
    const failed = { data: null, successful: false, error: { message: "tool execution failed" } };
    expect(() => mapTaskListsPayload(failed)).toThrow("tool execution failed");
    expect(() => mapTasksPayload(failed)).toThrow("tool execution failed");
  });
});
