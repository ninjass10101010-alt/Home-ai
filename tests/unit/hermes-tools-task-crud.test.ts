import { describe, it, expect, vi, beforeEach } from "vitest";
// Task tools now operate on the SNAPSHOT (consuela_data_snapshots) — the store
// the dashboard renders — not the PB `tasks` collection. This harness seeds a
// snapshot blob and persists snapshot writes so read-after-write works.
const SNAP = "consuela_data_snapshots";
const rows: Record<string, any[]> = {};
const writes: Array<{ op: string; collection: string; id?: string; data?: any }> = [];
vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) => fn({
    collection: (name: string) => ({
      getFullList: async () => rows[name] ?? [],
      getFirstListItem: async () => { throw new Error("404"); },
      update: async (id: string, d: any) => {
        writes.push({ op: "update", collection: name, id, data: d });
        if (name === SNAP) { const r = (rows[SNAP] || []).find((x) => x.id === id); if (r) r.data = d.data; }
        return { id, ...d };
      },
      create: async (d: any) => {
        writes.push({ op: "create", collection: name, data: d });
        if (name === SNAP) rows[SNAP] = [{ id: "snap1", key: "tasks-snapshot", data: d.data }];
        return { id: "snap1", ...d };
      },
      delete: async (id: string) => { writes.push({ op: "delete", collection: name, id }); return true; },
    }),
  })),
}));
vi.mock("@/db", () => ({ db: new Proxy({}, { get: () => async () => [] }) }));
import { getTool } from "@/lib/hermes-tools";

const snapData = () => rows[SNAP]?.[0]?.data ?? {};
const snapTasks = () => snapData().tasks ?? [];
const byId = (id: number) => snapTasks().find((t: any) => Number(t.id) === id);

beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k];
  writes.length = 0;
  rows.members = [{ name: "Emily", fullName: "Emily G", role: "child", emoji: "🎻" }];
  rows[SNAP] = [{
    id: "snap1",
    key: "tasks-snapshot",
    data: {
      tasks: [
        { id: 101, title: "Walk Rocco", assignee: "Emily G", points: 10, due: "2026-09-10", completed: false },
        { id: 102, title: "Done Chore", assignee: "Emily G", points: 5, completed: true },
      ],
      weekData: { weekStart: "2026-09-21", points: {}, history: [] },
      deletedTaskIds: [],
    },
  }];
  rows.week_data = [];
});

it("add_task refuses unknown members", async () => {
  const out = JSON.parse(await getTool("add_task")!.handler({ title: "X", assigned_to: "Bobgy" }));
  expect(out.ok).toBe(false);
  expect(out.error).toContain("get_family_members");
  expect(snapTasks()).toHaveLength(2);
});

it("add_task persists recurring + stealable fields on the snapshot", async () => {
  const out = JSON.parse(await getTool("add_task")!.handler({ title: "Feed dogs", assigned_to: "Emily", points: 8, recurring: "daily", stealable: true }));
  expect(out.ok).toBe(true);
  const added = snapTasks().find((t: any) => t.title === "Feed dogs")!;
  expect(added.recurring).toBe("daily");
  expect(added.stealable).toBe(true);
});

it("update_task patches by taskId and reports before/after", async () => {
  const out = JSON.parse(await getTool("update_task")!.handler({ taskId: 101, points: 15 }));
  expect(out.ok).toBe(true);
  expect(out.before.points).toBe(10);
  expect(out.after.points).toBe(15);
  expect(byId(101)!.points).toBe(15);
});

it("update_task refuses completed rows", async () => {
  const out = JSON.parse(await getTool("update_task")!.handler({ taskId: 102, points: 1 }));
  expect(out.ok).toBe(false);
  expect(out.error).toContain("pending");
});

it("update_task rejects non-numeric points without writing", async () => {
  const out = JSON.parse(await getTool("update_task")!.handler({ taskId: 101, points: "abc" }));
  expect(out.ok).toBe(false);
  expect(out.error).toContain("number");
  expect(snapTasks().find((t: any) => t.id === 101).points).toBe(10);
});

it("delete_task removes the row and records a tombstone", async () => {
  const out = JSON.parse(await getTool("delete_task")!.handler({ taskId: 101 }));
  expect(out.ok).toBe(true);
  expect(byId(101)).toBeUndefined();
  expect(snapData().deletedTaskIds).toContain(101);
});

it("get_completed_tasks lists done rows from the snapshot", async () => {
  const out = JSON.parse(await getTool("get_completed_tasks")!.handler({}));
  expect(out.completed.map((t: any) => t.title)).toEqual(["Done Chore"]);
});

it("complete_task queues a PENDING APPROVAL instead of earning points", async () => {
  const out = JSON.parse(await getTool("complete_task")!.handler({ taskId: 101 }));
  expect(out.ok).toBe(true);
  expect(out.queuedForApproval).toBe(true);
  const row = byId(101)!;
  expect(row.completed).toBe(true);
  expect(row.pendingApproval).toBeTruthy();
  expect(row.sentBackAt).toBe(null);
  expect(typeof row.pendingApproval.byName).toBe("string");
  expect(typeof row.pendingApproval.points).toBe("number");
  // chat never moves points — no week_data write
  expect(writes.some((w) => w.collection === "week_data")).toBe(false);
});

it("complete_task answers an already-queued row with the honest approval refusal", async () => {
  rows[SNAP][0].data.tasks = [{ id: 103, title: "Queued", assignee: "Emily G", completed: true, pendingApproval: { byName: "Emily G", at: "2026-09-10T10:00:00Z", points: 5 }, sentBackAt: null }];
  const out = JSON.parse(await getTool("complete_task")!.handler({ taskId: 103 }));
  expect(out.ok).toBe(false);
  expect(out.error).toContain("approval");
});

it("reopen_task reopens a row still waiting for approval", async () => {
  rows[SNAP][0].data.tasks = [{ id: 103, title: "Queued", assignee: "Emily G", completed: true, completedBy: "Emily G", pendingApproval: { byName: "Emily G", at: "2026-09-10T10:00:00Z", points: 5 }, sentBackAt: null }];
  const out = JSON.parse(await getTool("reopen_task")!.handler({ taskId: 103 }));
  expect(out.ok).toBe(true);
  const row = byId(103)!;
  expect(row.completed).toBe(false);
  expect(row.completedBy).toBeNull();
  expect(row.pendingApproval).toBeNull();
  expect(writes.some((x) => x.collection === "week_data")).toBe(false);
});

it("reopen_task refuses an already-paid row with honest copy", async () => {
  rows[SNAP][0].data.tasks = [{ id: 102, title: "Done Chore", assignee: "Emily G", completed: true }];
  const out = JSON.parse(await getTool("reopen_task")!.handler({ taskId: 102 }));
  expect(out.ok).toBe(false);
  expect(out.error).toContain("Tasks UI");
});
