import { describe, it, expect, vi, beforeEach } from "vitest";
const rows: Record<string, any[]> = {};
const writes: Array<{ op: string; collection: string; id?: string; data?: any }> = [];
vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) => fn({
    collection: (name: string) => ({
      getFullList: async () => rows[name] ?? [],
      getFirstListItem: async () => { throw new Error("404"); },
      update: async (id: string, d: any) => { writes.push({ op: "update", collection: name, id, data: d }); return { id, ...d }; },
      create: async (d: any) => { writes.push({ op: "create", collection: name, data: d }); return { id: "n1", ...d }; },
      delete: async (id: string) => { writes.push({ op: "delete", collection: name, id }); return true; },
    }),
  })),
}));
vi.mock("@/db", () => ({ db: new Proxy({}, { get: () => async () => [] }) }));
import { getTool } from "@/lib/hermes-tools";

beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k];
  writes.length = 0;
  rows.members = [{ name: "Emily", fullName: "Emily G", role: "child", emoji: "🎻" }];
  rows.tasks = [
    { id: "t1", taskId: 101, title: "Walk Rocco", assignee: "Emily G", status: "pending", points: 10, due: "2026-09-10" },
    { id: "t2", taskId: 102, title: "Done Chore", assignee: "Emily G", status: "done", points: 5 },
  ];
  rows.week_data = [];
});

it("add_task refuses unknown members", async () => {
  const out = JSON.parse(await getTool("add_task")!.handler({ title: "X", assigned_to: "Bobgy" }));
  expect(out.ok).toBe(false);
  expect(out.error).toContain("get_family_members");
  expect(writes).toHaveLength(0);
});

it("add_task persists recurring + stealable fields", async () => {
  const out = JSON.parse(await getTool("add_task")!.handler({ title: "Feed dogs", assigned_to: "Emily", points: 8, recurring: "daily", stealable: true }));
  expect(out.ok).toBe(true);
  const created = writes.find((w) => w.op === "create")!;
  expect(created.data.recurring).toBe("daily");
  expect(created.data.stealable).toBe(true);
});

it("update_task patches by taskId and reports before/after", async () => {
  const out = JSON.parse(await getTool("update_task")!.handler({ taskId: 101, points: 15 }));
  expect(out.ok).toBe(true);
  expect(out.before.points).toBe(10);
  expect(out.after.points).toBe(15);
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
  expect(writes).toHaveLength(0);
});

it("delete_task removes and echoes", async () => {
  const out = JSON.parse(await getTool("delete_task")!.handler({ taskId: 101 }));
  expect(out.ok).toBe(true);
  expect(writes.some((w) => w.op === "delete" && w.id === "t1")).toBe(true);
});

it("get_completed_tasks lists done rows", async () => {
  const out = JSON.parse(await getTool("get_completed_tasks")!.handler({}));
  expect(out.completed.map((t: any) => t.title)).toEqual(["Done Chore"]);
});

it("reopen_task reopens a row still waiting for approval", async () => {
  rows.tasks = [{ id: "t3", taskId: 103, title: "Queued", assignee: "Emily G", status: "done", pendingApproval: { byName: "Emily G", at: "2026-09-10T10:00:00Z", points: 5 }, sentBackAt: null }];
  const out = JSON.parse(await getTool("reopen_task")!.handler({ taskId: 103 }));
  expect(out.ok).toBe(true);
  const w = writes.find((x) => x.op === "update" && x.collection === "tasks")!;
  expect(w.data.status).toBe("pending");
  expect(w.data.pendingApproval).toBeNull();
  expect(writes.some((x) => x.collection === "week_data")).toBe(false);
});

it("reopen_task refuses an already-paid row with honest copy", async () => {
  rows.tasks = [{ id: "t2", taskId: 102, title: "Done Chore", assignee: "Emily G", status: "done" }];
  rows.week_data = [{ weekStart: "2026-09-07", points: JSON.stringify({ "Emily G": 5 }), history: JSON.stringify([{ taskId: 102, type: "earn", amount: 5, member: "Emily G" }]) }];
  const out = JSON.parse(await getTool("reopen_task")!.handler({ taskId: 102 }));
  expect(out.ok).toBe(false);
  expect(out.error).toContain("Tasks UI");
  expect(writes.filter((x) => x.op === "update")).toHaveLength(0);
});
