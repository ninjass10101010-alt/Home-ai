// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const SNAP = "consuela_data_snapshots";
const rows: Record<string, any[]> = {};
const writes: Array<{ op: string; collection: string; id?: string; data?: any }> = [];
const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

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

vi.mock("@/lib/task-commands", () => ({
  executeInternalTaskCommand: mocks.execute,
  registerInternalTaskCommandHandler: vi.fn(() => () => {}),
}));

import { executeMuseTool } from "@/lib/muse/execute";

const snapTasks = () => rows[SNAP]?.[0]?.data?.tasks ?? [];
const lastCommand = () => mocks.execute.mock.calls.at(-1);
const museResult = (out: Awaited<ReturnType<typeof executeMuseTool>>) => {
  expect(out).toHaveProperty("result");
  return (out as { result: any }).result;
};

beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k];
  writes.length = 0;
  mocks.execute.mockReset();
  rows.members = [{ id: "mem-alex", name: "Member A", fullName: "Member A", role: "child", emoji: "🎻" }];
  rows[SNAP] = [{
    id: "snap1",
    key: "tasks-snapshot",
    data: {
      tasks: [{ id: 42, title: "Existing chore", assignee: "Member A", points: 5, due: "2026-09-24", completed: false }],
      weekData: { weekStart: "2026-09-21", points: {}, history: [] },
      deletedTaskIds: [],
    },
  }];
});

it("uses the canonical internal command for an MUSE task write", async () => {
  mocks.execute.mockResolvedValue({
    ok: true,
    operationId: "task-op-1",
    task: { id: 10, title: "Assigned task", assignee: "Member A", completed: false },
    reconciled: true,
  });
  const out = await executeMuseTool("add_task", { title: "Assigned task", assigned_to: "Member A" }, { admin: false });
  expect(lastCommand()).toMatchObject([
    expect.objectContaining({
      kind: "add",
      actor: expect.objectContaining({ role: "parent" }),
      operationId: expect.any(String),
    }),
    { source: "muse" },
  ]);
  const [command] = lastCommand()!;
  expect(JSON.parse((command as any).payload.taskData)).toMatchObject({
    task: { title: "Assigned task", assignee: "Member A" },
  });
  expect(museResult(out)).toMatchObject({ ok: true, taskId: 10, reconciled: true });
});

it("an MUSE update_task rides the same seam with the resolved task id", async () => {
  mocks.execute.mockResolvedValue({
    ok: true,
    operationId: "task-op-2",
    task: { id: 42, title: "Existing chore", assignee: "Member A", points: 8, completed: false },
    reconciled: false,
  });
  const out = await executeMuseTool("update_task", { taskId: 42, points: 8 }, { admin: false });
  const [command, context] = lastCommand()!;
  expect(context).toEqual({ source: "muse" });
  expect(command).toMatchObject({ kind: "update" });
  expect(JSON.parse((command as any).payload.taskData)).toMatchObject({ taskId: 42, patch: { points: 8 } });
  expect(museResult(out)).toMatchObject({ ok: true, taskId: 42, reconciled: false });
});

it("MUSE never writes a task row itself — the seam is the only writer", async () => {
  mocks.execute.mockResolvedValue({
    ok: true,
    operationId: "task-op-3",
    task: { id: 11, title: "Assigned task", assignee: "Member A", completed: false },
    reconciled: true,
  });
  await executeMuseTool("add_task", { title: "Assigned task", assigned_to: "Member A" }, { admin: false });
  expect(writes.filter((w) => w.collection === SNAP || w.collection === "tasks")).toHaveLength(0);
  expect(snapTasks()).toHaveLength(1);
});

it("rejects a pet assignee before any task command mutation", async () => {
  rows.members = [{ id: "mem-pet", name: "Pet A", fullName: "Pet A", role: "pet", emoji: "🐾" }];
  const out = await executeMuseTool("add_task", { title: "Feed Pet A", assigned_to: "Pet A" }, { admin: false });
  expect(museResult(out)).toMatchObject({ ok: false, reason: "pet_assignee" });
  expect(snapTasks()).toHaveLength(1);
  expect(mocks.execute).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "add" }), expect.anything());
  expect(writes.filter((w) => w.collection === SNAP || w.collection === "tasks")).toHaveLength(0);
});

it("rejects a pet assignee on an MUSE update before the command is reached", async () => {
  rows.members = [
    { id: "mem-alex", name: "Member A", fullName: "Member A", role: "child", emoji: "🎻" },
    { id: "mem-pet", name: "Rocco", fullName: "Rocco", role: "pet", emoji: "🐕" },
  ];
  const out = await executeMuseTool("update_task", { taskId: 42, newAssignee: "Rocco" }, { admin: false });
  expect(museResult(out)).toMatchObject({ ok: false, reason: "pet_assignee" });
  expect(snapTasks()[0].assignee).toBe("Member A");
  expect(mocks.execute).not.toHaveBeenCalled();
});

it("surfaces the command's own pet refusal — the seam is the final authority", async () => {
  mocks.execute.mockResolvedValue({
    ok: false,
    operationId: "task-op-4",
    reason: "pet_assignee",
    reconciled: false,
  });
  const out = await executeMuseTool("add_task", { title: "Assigned task", assigned_to: "Member A" }, { admin: false });
  expect(museResult(out)).toMatchObject({ ok: false, reason: "pet_assignee" });
  expect(museResult(out).error).toContain("pet");
  expect(snapTasks()).toHaveLength(1);
});
