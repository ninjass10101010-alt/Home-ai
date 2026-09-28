// Snapshot-FIRST task authority for the briefing, the assistant live reads and
// the screensaver (Wave 3 Task 7).
//
// The bug this pins: all three read tasks from whichever source answered —
// `generateBriefing` read the PB `tasks` collection directly (a derived replica
// that diverged from the snapshot the dashboard actually renders), the live
// reads turned a TOTAL read failure into `[]` (which reads as "no tasks" when
// it means "unknown"), and the screensaver preferred the PB replica. Every
// surface now goes through the one canonical reader, which reads the snapshot
// first, APPLIES `deletedTaskIds`, and only touches PB when the snapshot read
// FAILS. A successful-but-empty snapshot stays an authoritative empty list —
// that distinction is the whole point of `source`.
//
// Mock convention: `rows[name] = null` means the read THREW (PB unreachable /
// collection missing). An array is a successful read (possibly empty). A key
// that is absent is an empty successful read.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { weekKey } from "@/lib/task-utils";

const rows: Record<string, any[] | null> = {};
const reads: string[] = [];
const briefingWrites: Array<{ scopeDate: string; summary: any }> = [];

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) =>
    fn({
      collection: (name: string) => ({
        getFullList: async () => {
          reads.push(name);
          const value = rows[name];
          if (value === null) throw new Error(`read failed: ${name}`);
          return Array.isArray(value) ? value : [];
        },
        getFirstListItem: async () => { throw new Error("404"); },
        update: async (id: string, data: any) => ({ id, ...data }),
        create: async (data: any) => ({ id: "new-row", ...data }),
        delete: async () => true,
      }),
    })
  ),
}));

vi.mock("@/db", () => ({
  db: {
    selectPendingSuggestions: vi.fn(async () => []),
    upsertMorningBriefing: vi.fn(async (scopeDate: string, summary: any) => {
      briefingWrites.push({ scopeDate, summary });
      return {};
    }),
  },
}));

vi.mock("@/lib/consuela/engine", () => ({
  runEngine: vi.fn(async () => ({ scanned: 0, inserted: 0, rejected: 0 })),
}));

vi.mock("@/lib/services/config", () => ({
  getServiceConfig: vi.fn(async () => null),
}));

import { generateBriefing } from "@/lib/consuela/briefing";
import {
  livePendingTasks,
  livePendingTasksForPack,
  readCanonicalTasks,
} from "@/lib/consuela/live-reads";
import { composeScreensaverPayload, __resetScreensaverCaches } from "@/lib/screensaver/payload";

const SCOPE = "2026-09-24";

function snapshotRow(tasks: any[], deletedTaskIds: number[] = []) {
  return [{ id: "snap1", key: "tasks-snapshot", data: { tasks, deletedTaskIds } }];
}

const SCREENSAVER_NOW = new Date(2026, 8, 7, 15, 0, 0);

beforeEach(() => {
  for (const key of Object.keys(rows)) delete rows[key];
  reads.length = 0;
  briefingWrites.length = 0;
  __resetScreensaverCaches();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("weather offline"); }));
});

describe("generateBriefing — snapshot-first task authority", () => {
  it("uses snapshot tasks when snapshot and PB disagree", async () => {
    rows.consuela_data_snapshots = snapshotRow([
      { id: 1, title: "Snapshot task", assignee: "Member A", completed: false },
      { id: 2, title: "Tombstoned", completed: false },
    ], [2]);
    rows.tasks = [{ taskId: 3, title: "PB-only task", status: "pending" }];
    const summary = await generateBriefing({ scopeDate: SCOPE });
    expect(summary.tasks.map((task: any) => task.title)).toEqual(["Snapshot task"]);
    expect(summary.taskSource).toBe("snapshot");
  });

  it("falls back to PB only when snapshot reads fail", async () => {
    rows.consuela_data_snapshots = null;
    rows.tasks = [{ taskId: 3, title: "PB task", status: "pending" }];
    const summary = await generateBriefing({ scopeDate: SCOPE });
    expect(summary.tasks[0].title).toBe("PB task");
    expect(summary.taskSource).toBe("pb");
  });

  it("says unavailable when both task sources fail — never an empty task list", async () => {
    rows.consuela_data_snapshots = null;
    rows.tasks = null;
    const summary = await generateBriefing({ scopeDate: SCOPE });
    expect(summary.taskSource).toBe("unavailable");
    expect(summary.tasks).toEqual([]);
  });

  it("an empty snapshot is an authoritative empty list and PB is never merged in", async () => {
    rows.consuela_data_snapshots = snapshotRow([]);
    rows.tasks = [{ taskId: 3, title: "PB-only task", status: "pending" }];
    const summary = await generateBriefing({ scopeDate: SCOPE });
    expect(summary.taskSource).toBe("snapshot");
    expect(summary.tasks).toEqual([]);
  });

  it("slices six unresolved rows and drops completed / pending-approval rows", async () => {
    const unresolved = Array.from({ length: 8 }, (_, index) => ({
      id: index + 1,
      title: `Open ${index + 1}`,
      completed: false,
    }));
    rows.consuela_data_snapshots = snapshotRow([
      ...unresolved,
      { id: 99, title: "Done already", completed: true },
      { id: 100, title: "Waiting on a parent", completed: false, pendingApproval: { byName: "Member A", at: SCOPE, points: 5 } },
    ]);
    const summary = await generateBriefing({ scopeDate: SCOPE });
    expect(summary.tasks.map((task: any) => task.title)).toEqual([
      "Open 1", "Open 2", "Open 3", "Open 4", "Open 5", "Open 6",
    ]);
    expect(summary.taskSource).toBe("snapshot");
  });

  it("stores the task source in the persisted briefing", async () => {
    rows.consuela_data_snapshots = snapshotRow([
      { id: 1, title: "Snapshot task", assignee: "Member A", completed: false },
    ]);
    await generateBriefing({ scopeDate: SCOPE });
    expect(briefingWrites).toHaveLength(1);
    expect(briefingWrites[0].scopeDate).toBe(SCOPE);
    expect(briefingWrites[0].summary.taskSource).toBe("snapshot");
  });
});

describe("readCanonicalTasks — the one task reader", () => {
  it("reads the snapshot, applies tombstones, and never merges the PB replica", async () => {
    rows.consuela_data_snapshots = snapshotRow([
      { id: 1, title: "Live row", completed: false },
      { id: 2, title: "Deleted row", completed: false },
    ], [2]);
    rows.tasks = [{ taskId: 3, title: "PB-only task", status: "pending" }];
    const read = await readCanonicalTasks();
    expect(read.source).toBe("snapshot");
    expect(read.tasks.map((task: any) => task.id)).toEqual([1]);
    expect(reads).toContain("consuela_data_snapshots");
    expect(reads).not.toContain("tasks");
  });

  it("maps a PB fallback row onto the snapshot row shape", async () => {
    rows.consuela_data_snapshots = null;
    rows.tasks = [{ taskId: 3, title: "PB task", status: "pending", due: SCOPE, points: 7 }];
    const read = await readCanonicalTasks();
    expect(read.source).toBe("pb");
    expect(read.tasks).toEqual([{
      id: 3,
      title: "PB task",
      assignee: "",
      assigned: "",
      due: SCOPE,
      points: 7,
      completed: false,
      completedInWeek: null,
    }]);
  });

  it("maps a PB row with status done onto completed", async () => {
    rows.consuela_data_snapshots = null;
    rows.tasks = [{ taskId: 4, title: "PB done", status: "done" }];
    const read = await readCanonicalTasks();
    expect(read.tasks[0].completed).toBe(true);
  });

  it("reports unavailable when the snapshot read fails and PB is unreachable too", async () => {
    rows.consuela_data_snapshots = null;
    rows.tasks = null;
    const read = await readCanonicalTasks();
    expect(read.source).toBe("unavailable");
    expect(read.tasks).toEqual([]);
  });

  it("an absent snapshot row is a successful empty read, not a failure", async () => {
    rows.tasks = [{ taskId: 3, title: "PB-only task", status: "pending" }];
    const read = await readCanonicalTasks();
    expect(read.source).toBe("snapshot");
    expect(read.tasks).toEqual([]);
  });
});

describe("live task reads — empty is not unknown", () => {
  it("livePendingTasks reports unavailable when both sources fail", async () => {
    rows.consuela_data_snapshots = null;
    rows.tasks = null;
    expect(await livePendingTasks()).toBeNull();
  });

  it("livePendingTasks returns an empty list when the snapshot read succeeds with no tasks", async () => {
    rows.consuela_data_snapshots = snapshotRow([]);
    rows.tasks = [{ taskId: 3, title: "PB-only task", status: "pending" }];
    expect(await livePendingTasks()).toEqual([]);
  });

  it("livePendingTasks returns the snapshot's pending rows and drops tombstones", async () => {
    rows.consuela_data_snapshots = snapshotRow([
      { id: 1, title: "Walk Rocco", assignee: "Member A", points: 10, completed: false },
      { id: 2, title: "Deleted chore", assignee: "Member A", completed: false },
      { id: 3, title: "Already done", assignee: "Member A", completed: true },
    ], [2]);
    const pending = await livePendingTasks();
    expect(pending!.map((task: any) => task.title)).toEqual(["Walk Rocco"]);
  });

  it("livePendingTasksForPack preserves the unavailable signal", async () => {
    rows.consuela_data_snapshots = null;
    rows.tasks = null;
    expect(await livePendingTasksForPack()).toBeNull();
  });

  it("livePendingTasksForPack keeps an authoritative empty list empty", async () => {
    rows.consuela_data_snapshots = snapshotRow([]);
    expect(await livePendingTasksForPack()).toEqual([]);
  });
});

describe("screensaver — the same snapshot-first reader", () => {
  it("scores the week from the snapshot, never the PB replica", async () => {
    rows.consuela_data_snapshots = snapshotRow([
      { id: 1, title: "Swept the porch", completed: true, completedInWeek: weekKey(SCREENSAVER_NOW) },
      { id: 2, title: "Water the plants", completed: false, due: "2026-09-13" },
    ]);
    rows.tasks = [
      { taskId: 8, title: "PB replica row", status: "pending", due: "2026-09-13" },
    ];
    const payload = await composeScreensaverPayload(SCREENSAVER_NOW);
    expect(payload.tasks).toEqual({ done: 1, total: 2 });
  });

  it("falls back to PB rows when the snapshot read fails", async () => {
    rows.consuela_data_snapshots = null;
    rows.tasks = [
      { taskId: 8, title: "PB chore", status: "done", completedInWeek: weekKey(SCREENSAVER_NOW) },
      { taskId: 9, title: "PB open chore", status: "pending", due: "2026-09-13" },
    ];
    const payload = await composeScreensaverPayload(SCREENSAVER_NOW);
    expect(payload.tasks).toEqual({ done: 1, total: 2 });
  });

  it("an empty successful snapshot scores an empty week and PB is never consulted", async () => {
    rows.consuela_data_snapshots = snapshotRow([]);
    rows.tasks = [
      { taskId: 8, title: "PB replica row", status: "pending", due: "2026-09-13" },
    ];
    const payload = await composeScreensaverPayload(SCREENSAVER_NOW);
    expect(payload.tasks).toEqual({ done: 0, total: 0 });
  });

  it("a stored unavailable briefing never claims 'No chores open' on a later healthy compose", async () => {
    rows.consuela_data_snapshots = snapshotRow([
      { id: 1, title: "Swept the porch", completed: true, completedInWeek: weekKey(SCREENSAVER_NOW) },
      { id: 2, title: "Water the plants", completed: false, due: "2026-09-13" },
    ]);
    rows.morning_briefing = [{
      summary: { events: [{}, {}, {}], tasks: [], meals: [], suggestions: [], taskSource: "unavailable" },
    }];
    const payload = await composeScreensaverPayload(SCREENSAVER_NOW);
    expect(payload.tasks).toEqual({ done: 1, total: 2 });
    expect(payload.briefing.join(" ")).not.toContain("No chores open");
    expect(payload.briefing).toContain("❓ Chores unavailable — do not guess");
  });

  it("throws (route 503) when both task sources fail", async () => {
    rows.consuela_data_snapshots = null;
    rows.tasks = null;
    await expect(composeScreensaverPayload(SCREENSAVER_NOW)).rejects.toThrow();
  });
});
