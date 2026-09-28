import { describe, it, expect, vi, beforeEach } from "vitest";
// Task tools now operate on the SNAPSHOT (consuela_data_snapshots) — the store
// the dashboard renders — not the PB `tasks` collection. This harness seeds a
// snapshot blob and persists snapshot writes so read-after-write works.
const SNAP = "consuela_data_snapshots";
// The ledger write path reads its own week row back to VERIFY the transaction
// landed, so a created/updated week_data row has to persist in this fake too —
// otherwise any paying branch aborts with `ledger_write_conflict` and the test
// cannot tell "the seam paid" apart from "the harness could not".
const WEEK = "week_data";
const rows: Record<string, any[]> = {};
const writes: Array<{ op: string; collection: string; id?: string; data?: any }> = [];
const mocks = vi.hoisted(() => ({ execute: vi.fn(), getLiveMembers: vi.fn(), nextOperationId: vi.fn() }));
vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) => fn({
    collection: (name: string) => ({
      getFullList: async () => rows[name] ?? [],
      getFirstListItem: async () => { throw new Error("404"); },
      update: async (id: string, d: any) => {
        writes.push({ op: "update", collection: name, id, data: d });
        if (name === SNAP) { const r = (rows[SNAP] || []).find((x) => x.id === id); if (r) r.data = d.data; }
        if (name === WEEK) { const r = (rows[WEEK] || []).find((x) => x.id === id); if (r) Object.assign(r, d); }
        return { id, ...d };
      },
      create: async (d: any) => {
        writes.push({ op: "create", collection: name, data: d });
        if (name === SNAP) rows[SNAP] = [{ id: "snap1", key: "tasks-snapshot", data: d.data }];
        if (name === WEEK) rows[WEEK] = [{ id: "week1", ...d }];
        return { id: name === WEEK ? "week1" : "snap1", ...d };
      },
      delete: async (id: string) => { writes.push({ op: "delete", collection: name, id }); return true; },
    }),
  })),
}));
vi.mock("@/db", () => ({ db: new Proxy({}, { get: () => async () => [] }) }));
vi.mock("@/lib/task-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/task-commands")>();
  mocks.execute.mockImplementation(actual.executeInternalTaskCommand);
  return { ...actual, executeInternalTaskCommand: mocks.execute };
});
vi.mock("@/lib/live-member", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/live-member")>();
  return { ...actual, getLiveMembers: mocks.getLiveMembers };
});
vi.mock("@/lib/task-operation-outbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/task-operation-outbox")>();
  return { ...actual, createTaskOperationId: mocks.nextOperationId };
});
import { getTool } from "@/lib/hermes-tools";

const snapData = () => rows[SNAP]?.[0]?.data ?? {};
const snapTasks = () => snapData().tasks ?? [];
const byId = (id: number) => snapTasks().find((t: any) => Number(t.id) === id);
const lastCommand = () => mocks.execute.mock.calls.at(-1);

const parentCaller = {
  source: "hermes" as const,
  caller: { memberId: "mem-dad", name: "Dad", role: "parent" },
};
const childCaller = {
  source: "hermes" as const,
  caller: { memberId: "mem-emily", name: "Emily", role: "child" },
};

const crewPendingRow = () => ({
  id: 1,
  title: "Crew clean",
  assignee: "Crew",
  points: 10,
  due: "2026-09-30",
  completed: true,
  status: "done",
  completedBy: "Crew",
  completedAt: "2026-09-22T10:00:00.000Z",
  completedInWeek: "2026-09-21",
  universal: false,
  crewSize: 3,
  sentBackAt: null,
  crew: {
    members: [
      { name: "Member A", emoji: "\u{1F467}", joinedAt: "2026-09-21T08:00:00.000Z", checkedInAt: "2026-09-22T09:00:00.000Z" },
      { name: "Member B", emoji: "\u{1F9D2}", joinedAt: "2026-09-21T08:05:00.000Z", checkedInAt: "2026-09-22T09:05:00.000Z" },
    ],
    removed: ["Former Member"],
  },
  pendingApproval: {
    byName: "Crew",
    at: "2026-09-22T10:00:00.000Z",
    points: 10,
    crew: ["Member A", "Member B"],
  },
});

const seedTasks = (tasks: any[]) => {
  rows[SNAP][0].data.tasks = tasks;
};

beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k];
  writes.length = 0;
  mocks.execute.mockClear();
  mocks.getLiveMembers.mockReset();
  mocks.getLiveMembers.mockImplementation(async () =>
    (rows.members ?? [])
      .filter((row: any) => typeof row?.id === "string" && row.id && typeof row?.name === "string" && row.name && typeof row?.role === "string" && row.role)
      .map((row: any) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        ...(typeof row.emoji === "string" ? { emoji: row.emoji } : {}),
      })),
  );
  rows.members = [{ id: "mem-emily", name: "Emily", fullName: "Emily G", role: "child", emoji: "🎻" }];
  mocks.nextOperationId.mockReset();
  let operationSequence = 0;
  mocks.nextOperationId.mockImplementation(() => `op-fixture-${++operationSequence}`);
  rows[SNAP] = [{
    id: "snap1",
    key: "tasks-snapshot",
    data: {
      // `universal: false` is what the manage command writes for an assigned
      // chore; without it the canonical reader treats the row as open.
      tasks: [
        { id: 101, title: "Walk Rocco", assignee: "Emily G", points: 10, due: "2026-09-10", completed: false, universal: false },
        { id: 102, title: "Done Chore", assignee: "Emily G", points: 5, completed: true, universal: false },
      ],
      weekData: { weekStart: "2026-09-21", points: {}, history: [] },
      deletedTaskIds: [],
    },
  }];
  rows.week_data = [];
});

it("add_task refuses unknown members", async () => {
  const out = JSON.parse(await getTool("add_task")!.handler({ title: "X", assigned_to: "Bobgy" }, parentCaller));
  expect(out.ok).toBe(false);
  expect(out.error).toContain("get_family_members");
  expect(snapTasks()).toHaveLength(2);
});

it("add_task persists recurring + stealable fields on the snapshot", async () => {
  const out = JSON.parse(await getTool("add_task")!.handler({ title: "Feed dogs", assigned_to: "Emily", points: 8, recurring: "daily", stealable: true }, parentCaller));
  expect(out.ok).toBe(true);
  const added = snapTasks().find((t: any) => t.title === "Feed dogs")!;
  expect(added.recurring).toBe("daily");
  expect(added.stealable).toBe(true);
});

it("update_task patches by taskId and reports before/after", async () => {
  const out = JSON.parse(await getTool("update_task")!.handler({ taskId: 101, points: 15 }, parentCaller));
  expect(out.ok).toBe(true);
  expect(out.before.points).toBe(10);
  expect(out.after.points).toBe(15);
  expect(byId(101)!.points).toBe(15);
});

it("update_task refuses completed rows", async () => {
  const out = JSON.parse(await getTool("update_task")!.handler({ taskId: 102, points: 1 }, parentCaller));
  expect(out.ok).toBe(false);
  expect(out.error).toContain("pending");
});

it("update_task rejects non-numeric points without writing", async () => {
  const out = JSON.parse(await getTool("update_task")!.handler({ taskId: 101, points: "abc" }, parentCaller));
  expect(out.ok).toBe(false);
  expect(out.error).toContain("number");
  expect(snapTasks().find((t: any) => t.id === 101).points).toBe(10);
});

it("add_task writes through the Wave 1 command seam and reports its reconciled result", async () => {
  const out = JSON.parse(await getTool("add_task")!.handler({ title: "Walk Rocco", assigned_to: "Emily" }, parentCaller));
  expect(out.ok).toBe(true);
  expect(lastCommand()).toMatchObject([
    expect.objectContaining({ kind: "add", actor: expect.objectContaining({ role: "parent" }) }),
    { source: "hermes" },
  ]);
  expect(typeof out.reconciled).toBe("boolean");
  expect(byId(Number(out.taskId))!.title).toBe("Walk Rocco");
  expect(Number.isSafeInteger(Number(out.taskId))).toBe(true);
});

it("update_task writes through the same seam with the resolved task id", async () => {
  const out = JSON.parse(await getTool("update_task")!.handler({ taskId: 101, points: 12 }, parentCaller));
  expect(out.ok).toBe(true);
  const [command, context] = lastCommand()!;
  expect(context).toEqual({ source: "hermes" });
  expect(command).toMatchObject({ kind: "update" });
  expect(JSON.parse((command as any).payload.taskData)).toMatchObject({ taskId: 101 });
});

it("rejects a pet assignee before any task command mutation", async () => {
  rows.members = [{ id: "mem-rocco", name: "Pet A", fullName: "Pet A", role: "pet", emoji: "🐾" }];
  const out = JSON.parse(await getTool("add_task")!.handler({ title: "Feed Pet A", assigned_to: "Pet A" }, parentCaller));
  expect(out).toMatchObject({ ok: false, reason: "pet_assignee" });
  expect(snapTasks()).toHaveLength(2);
  expect(mocks.execute).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "add" }));
  expect(writes.some((w) => w.collection === SNAP)).toBe(false);
});

it("update_task rejects a pet assignee before the command is reached", async () => {
  rows.members = [
    { id: "mem-emily", name: "Emily", fullName: "Emily G", role: "child", emoji: "🎻" },
    { id: "mem-rocco", name: "Rocco", fullName: "Rocco", role: "pet", emoji: "🐕" },
  ];
  const out = JSON.parse(await getTool("update_task")!.handler({ taskId: 101, newAssignee: "Rocco" }, parentCaller));
  expect(out).toMatchObject({ ok: false, reason: "pet_assignee" });
  expect(byId(101)!.assignee).toBe("Emily G");
  expect(mocks.execute).not.toHaveBeenCalled();
});

it("the command is the final authority — a stale Hermes roster still gets pet_assignee", async () => {
  rows.members = [{ id: "mem-stale", name: "Pet A", fullName: "Pet A", role: "child", emoji: "🐾" }];
  mocks.getLiveMembers.mockResolvedValueOnce([{ id: "mem-rocco", name: "Pet A", role: "pet", emoji: "🐾" }]);
  const out = JSON.parse(await getTool("add_task")!.handler({ title: "Feed Pet A", assigned_to: "Pet A" }, parentCaller));
  expect(out).toMatchObject({ ok: false, reason: "pet_assignee" });
  expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ kind: "add" }), { source: "hermes" });
  expect(snapTasks()).toHaveLength(2);
});

it("surfaces a command-side refusal verbatim instead of inventing success", async () => {
  mocks.execute.mockResolvedValueOnce({
    ok: false,
    operationId: "task-op-x",
    reason: "snapshot_write_failed",
    reconciled: false,
  });
  const out = JSON.parse(await getTool("add_task")!.handler({ title: "Feed dogs", assigned_to: "Emily" }, parentCaller));
  expect(out).toMatchObject({ ok: false, reason: "snapshot_write_failed" });
  expect(snapTasks()).toHaveLength(2);
});

it("delete_task removes the row and records a tombstone", async () => {
  const out = JSON.parse(await getTool("delete_task")!.handler({ taskId: 101 }, parentCaller));
  expect(out.ok).toBe(true);
  expect(byId(101)).toBeUndefined();
  expect(snapData().deletedTaskIds).toContain(101);
});

it("get_completed_tasks lists done rows from the snapshot", async () => {
  const out = JSON.parse(await getTool("get_completed_tasks")!.handler({}, parentCaller));
  expect(out.completed.map((t: any) => t.title)).toEqual(["Done Chore"]);
});

it("complete_task queues a PENDING APPROVAL instead of earning points", async () => {
  const out = JSON.parse(await getTool("complete_task")!.handler({ taskId: 101 }, parentCaller));
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
  const out = JSON.parse(await getTool("complete_task")!.handler({ taskId: 103 }, parentCaller));
  expect(out.ok).toBe(false);
  expect(out.error).toContain("approval");
});

it("reopen_task reopens a row still waiting for approval", async () => {
  rows[SNAP][0].data.tasks = [{ id: 103, title: "Queued", assignee: "Emily G", completed: true, completedBy: "Emily G", pendingApproval: { byName: "Emily G", at: "2026-09-10T10:00:00Z", points: 5 }, sentBackAt: null }];
  const out = JSON.parse(await getTool("reopen_task")!.handler({ taskId: 103 }, parentCaller));
  expect(out.ok).toBe(true);
  const row = byId(103)!;
  expect(row.completed).toBe(false);
  expect(row.completedBy).toBeNull();
  expect(row.pendingApproval).toBeNull();
  expect(writes.some((x) => x.collection === "week_data")).toBe(false);
});

it("reopen_task refuses an already-paid row with honest copy", async () => {
  rows[SNAP][0].data.tasks = [{ id: 102, title: "Done Chore", assignee: "Emily G", completed: true }];
  const out = JSON.parse(await getTool("reopen_task")!.handler({ taskId: 102 }, parentCaller));
  expect(out.ok).toBe(false);
  expect(out.error).toContain("Tasks UI");
});

it("complete_task refuses an open (universal) row with the claim instruction", async () => {
  seedTasks([{ id: 201, title: "Race to the bins", assignee: "Open", points: 5, due: "2026-09-30", completed: false, universal: true, speedBonus: 2 }]);
  const out = JSON.parse(await getTool("complete_task")!.handler({ taskId: 201 }, parentCaller));
  expect(out).toMatchObject({ ok: false, reason: "assigned_only" });
  expect(out.error).toContain("claim");
  expect(mocks.execute).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "complete" }));
  expect(byId(201)!.completed).toBe(false);
});

it("complete_task refuses a late-stealable row with the claim instruction", async () => {
  seedTasks([{ id: 202, title: "Late chore", assignee: "Emily G", points: 5, due: "2020-01-01", completed: false, universal: false, stealable: true }]);
  const out = JSON.parse(await getTool("complete_task")!.handler({ taskId: 202 }, parentCaller));
  expect(out).toMatchObject({ ok: false, reason: "assigned_only" });
  expect(out.error).toContain("claim");
  expect(mocks.execute).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "complete" }));
  expect(byId(202)!.completed).toBe(false);
});

it("complete_task refuses a crew row with the crew instruction", async () => {
  rows.members = [
    { id: "mem-dad", name: "Dad", fullName: "Dad", role: "parent", emoji: "🧔" },
    { id: "mem-a", name: "Member A", fullName: "Member A", role: "child", emoji: "👧" },
  ];
  seedTasks([{
    id: 203, title: "Crew clean", assignee: "Crew", points: 10, due: "2026-09-30",
    completed: false, universal: false, crewSize: 3,
    crew: { members: [{ name: "Member A", emoji: "👧", joinedAt: "2026-09-21T08:00:00.000Z" }], removed: [] },
  }]);
  const out = JSON.parse(await getTool("complete_task")!.handler({ taskId: 203 }, parentCaller));
  expect(out).toMatchObject({ ok: false, reason: "assigned_only" });
  expect(out.error).toContain("crew");
  expect(mocks.execute).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "complete" }));
  expect(byId(203)!.completed).toBe(false);
});

it("queues an assigned completion through the internal command with the canonical payee", async () => {
  const out = JSON.parse(await getTool("complete_task")!.handler({ taskId: 101 }, parentCaller));
  expect(out.ok).toBe(true);
  const [command, context] = lastCommand()!;
  expect(context).toEqual({ source: "hermes" });
  expect(command).toMatchObject({
    kind: "complete",
    operationId: expect.any(String),
    actor: { memberId: "mem-emily", name: "Emily", role: "child" },
  });
  expect(command.payload).toEqual({ taskId: 101 });
  expect(out.queuedForApproval).toBe(true);
  expect(out.reconciled).toBe(true);
  expect(byId(101)!.pendingApproval).toMatchObject({ byName: "Emily", points: 10 });
});

it("derives the payee and points from canonical state, never the assignee argument", async () => {
  const out = JSON.parse(await getTool("complete_task")!.handler({ taskId: 101, assignee: "Not A Member" }, parentCaller));
  expect(out.ok).toBe(true);
  const row = byId(101)!;
  expect(row.pendingApproval).toMatchObject({ byName: "Emily", points: 10 });
  expect(String(row.pendingApproval.byName)).not.toContain("Not A Member");
  expect(lastCommand()![0].payload).toEqual({ taskId: 101 });
});

it("a queued completion writes no week_data row and no transaction", async () => {
  await getTool("complete_task")!.handler({ taskId: 101 }, parentCaller);
  expect(writes.some((w) => w.collection === "week_data")).toBe(false);
  expect(snapData().weekData?.history ?? []).toHaveLength(0);
});

it("queues an adult-owned chore instead of refusing it (Option B) — chat never pays", async () => {
  rows.members = [{ id: "mem-dad", name: "Dad", fullName: "Dad", role: "parent", emoji: "🧔" }];
  seedTasks([{ id: 205, title: "Dad's chore", assignee: "Dad", points: 5, due: "2026-09-30", completed: false, universal: false }]);

  const out = JSON.parse(await getTool("complete_task")!.handler({ taskId: 205 }, parentCaller));

  expect(out.ok).toBe(true);
  expect(out.queuedForApproval).toBe(true);
  expect(byId(205)!.pendingApproval).toMatchObject({ byName: "Dad", points: 5 });
  expect(writes.some((w) => w.collection === "week_data")).toBe(false);
  expect(snapData().weekData?.history ?? []).toHaveLength(0);
  expect(out.error).toBeUndefined();
});

it("reopens a crew row while preserving members, joinedAt, and removed", async () => {
  rows.members = [
    { id: "mem-dad", name: "Dad", fullName: "Dad", role: "parent", emoji: "🧔" },
    { id: "mem-a", name: "Member A", fullName: "Member A", role: "child", emoji: "👧" },
    { id: "mem-b", name: "Member B", fullName: "Member B", role: "child", emoji: "🧒" },
  ];
  seedTasks([crewPendingRow()]);
  const out = JSON.parse(await getTool("reopen_task")!.handler({ taskId: 1 }, parentCaller));
  expect(out.ok).toBe(true);
  expect(out.reopened).toBe(true);
  expect(out.reconciled).toBe(true);
  expect(out.task.completed).toBe(false);
  expect(out.task.crew.members).toEqual([
    { name: "Member A", emoji: "👧", joinedAt: "2026-09-21T08:00:00.000Z" },
    { name: "Member B", emoji: "🧒", joinedAt: "2026-09-21T08:05:00.000Z" },
  ]);
  expect(out.task.crew.removed).toEqual(["Former Member"]);
  expect(out.task.pendingApproval).toBeNull();
  const row = byId(1)!;
  expect(row.crew.members.every((m: any) => m.checkedInAt === undefined)).toBe(true);
  expect(row.crew.removed).toEqual(["Former Member"]);
  expect(writes.some((w) => w.collection === "week_data")).toBe(false);
});

it("reopen_task refuses a queued row whose canonical earn was never reversed", async () => {
  seedTasks([{ id: 104, title: "Paid", assignee: "Emily G", points: 5, universal: false, completed: true, completedBy: "Emily", completedInWeek: "2026-09-21", pendingApproval: { byName: "Emily", at: "2026-09-22T10:00:00.000Z", points: 5 }, sentBackAt: null }]);
  snapData().weekData = {
    weekStart: "2026-09-21",
    points: { Emily: 5 },
    history: [{ id: 1, timestamp: "2026-09-22T10:00:00.000Z", member: "Emily", type: "earn", amount: 5, description: "Completed: Paid", taskId: 104 }],
  };
  const out = JSON.parse(await getTool("reopen_task")!.handler({ taskId: 104 }, parentCaller));
  expect(out.ok).toBe(false);
  expect(mocks.execute).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "undo" }));
  expect(byId(104)!.completed).toBe(true);
});

it("reopen_task refuses a CREW queued row whose per-member earn was never reversed", async () => {
  // A crew approval is written PER MEMBER: `pendingApproval.byName` is the
  // literal "Crew" and `pendingApproval.crew` names the payees. A guard that
  // only looks at `byName` can never see a crew earn.
  rows.members = [
    { id: "mem-dad", name: "Dad", fullName: "Dad", role: "parent", emoji: "🧔" },
    { id: "mem-a", name: "Member A", fullName: "Member A", role: "child", emoji: "👧" },
    { id: "mem-b", name: "Member B", fullName: "Member B", role: "child", emoji: "🧒" },
  ];
  seedTasks([crewPendingRow()]);
  snapData().weekData = {
    weekStart: "2026-09-21",
    points: { "Member A": 10 },
    history: [
      { id: 1, timestamp: "2026-09-22T10:00:00.000Z", member: "Member A", type: "earn", amount: 10, description: "Completed: Crew clean", taskId: 1 },
    ],
  };
  const out = JSON.parse(await getTool("reopen_task")!.handler({ taskId: 1 }, parentCaller));
  expect(out.ok).toBe(false);
  expect(out.error).toContain("Tasks UI");
  expect(mocks.execute).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "undo" }));
  expect(byId(1)!.completed).toBe(true);
});

it("reopen_task honors the caller's VERIFIED memberId even when their name points at someone else", async () => {
  // Two Rebuttas on the roster. The route verified `memberId`, so THAT is the
  // authority: a first-name collision (or any name drift) must not silently
  // hand the crew send-back to a different grown-up.
  rows.members = [
    { id: "mem-rj", name: "Rebecca Jones", fullName: "Rebecca Jones", role: "parent", emoji: "👩" },
    { id: "mem-rs", name: "Rebecca Smith", fullName: "Rebecca Smith", role: "parent", emoji: "👩" },
    { id: "mem-a", name: "Member A", fullName: "Member A", role: "child", emoji: "👧" },
    { id: "mem-b", name: "Member B", fullName: "Member B", role: "child", emoji: "🧒" },
  ];
  seedTasks([crewPendingRow()]);
  const out = JSON.parse(await getTool("reopen_task")!.handler({ taskId: 1 }, {
    source: "hermes" as const,
    caller: { memberId: "mem-rj", name: "Rebecca Smith", role: "parent" },
  }));
  expect(out.ok).toBe(true);
  const [command] = lastCommand()!;
  expect(command.actor).toMatchObject({ memberId: "mem-rj", name: "Rebecca Jones", role: "parent" });
  expect(command.actor.memberId).not.toBe("mem-rs");
});

it("reopen_task refuses when the caller's verified memberId is not on the roster", async () => {
  rows.members = [
    { id: "mem-a", name: "Member A", fullName: "Member A", role: "child", emoji: "👧" },
    { id: "mem-b", name: "Member B", fullName: "Member B", role: "child", emoji: "🧒" },
  ];
  seedTasks([crewPendingRow()]);
  const out = JSON.parse(await getTool("reopen_task")!.handler({ taskId: 1 }, {
    source: "hermes" as const,
    caller: { memberId: "mem-not-on-roster", name: "Ghost", role: "parent" },
  }));
  expect(out).toMatchObject({ ok: false, reason: "adult_only" });
  expect(mocks.execute).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "undo" }));
  expect(byId(1)!.completed).toBe(true);
});

it("reopen_task still reopens a crew row whose earn was reversed", async () => {
  rows.members = [
    { id: "mem-dad", name: "Dad", fullName: "Dad", role: "parent", emoji: "🧔" },
    { id: "mem-a", name: "Member A", fullName: "Member A", role: "child", emoji: "👧" },
    { id: "mem-b", name: "Member B", fullName: "Member B", role: "child", emoji: "🧒" },
  ];
  seedTasks([crewPendingRow()]);
  snapData().weekData = {
    weekStart: "2026-09-21",
    points: {},
    history: [
      { id: 1, timestamp: "2026-09-22T10:00:00.000Z", member: "Member A", type: "earn", amount: 10, description: "Completed: Crew clean", taskId: 1 },
      { id: 2, timestamp: "2026-09-22T11:00:00.000Z", member: "Member A", type: "adjust", amount: -10, description: "Reversed: Crew clean", taskId: 1 },
    ],
  };
  const out = JSON.parse(await getTool("reopen_task")!.handler({ taskId: 1 }, parentCaller));
  expect(out.ok).toBe(true);
  expect(out.reopened).toBe(true);
});

it("reopen_task refuses a queued row whose earn carries a STRING taskId", async () => {
  // The ledger stores `taskId` as a number, but a snapshot round-trip through
  // a JSON-typed column can hand back a string. A strict pre-filter
  // (`t.taskId === Number(row.id)`) skipped the guard entirely. The canonical
  // checker is what now catches it: `parseCanonicalTransactions` REJECTS a
  // non-numeric taskId (task-ledger.ts), so it throws and the guard's catch
  // fails closed. (Not numeric normalization — the string never survives
  // parsing.)
  seedTasks([{ id: 104, title: "Paid", assignee: "Emily G", points: 5, universal: false, completed: true, completedBy: "Emily", completedInWeek: "2026-09-21", pendingApproval: { byName: "Emily", at: "2026-09-22T10:00:00.000Z", points: 5 }, sentBackAt: null }]);
  snapData().weekData = {
    weekStart: "2026-09-21",
    points: { Emily: 5 },
    history: [{ id: 1, timestamp: "2026-09-22T10:00:00.000Z", member: "Emily", type: "earn", amount: 5, description: "Completed: Paid", taskId: "104" }],
  };
  const out = JSON.parse(await getTool("reopen_task")!.handler({ taskId: 104 }, parentCaller));
  expect(out.ok).toBe(false);
  expect(out.error).toContain("Tasks UI");
  expect(mocks.execute).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "undo" }));
  expect(byId(104)!.completed).toBe(true);
});

it("reopen_task refuses when the ledger history cannot be parsed (fail closed)", async () => {
  seedTasks([{ id: 105, title: "Queued", assignee: "Emily G", universal: false, completed: true, completedBy: "Emily G", pendingApproval: { byName: "Emily G", at: "2026-09-10T10:00:00Z", points: 5 }, sentBackAt: null }]);
  snapData().weekData = {
    weekStart: "2026-09-21",
    points: {},
    history: [{ member: "Emily G", type: "earn" }],
  };
  const out = JSON.parse(await getTool("reopen_task")!.handler({ taskId: 105 }, parentCaller));
  expect(out.ok).toBe(false);
  expect(mocks.execute).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "undo" }));
  expect(byId(105)!.completed).toBe(true);
});

it("reopen_task routes through the internal command and reports the reconciler state", async () => {
  seedTasks([{ id: 103, title: "Queued", assignee: "Emily G", universal: false, completed: true, completedBy: "Emily G", pendingApproval: { byName: "Emily G", at: "2026-09-10T10:00:00Z", points: 5 }, sentBackAt: null }]);
  const out = JSON.parse(await getTool("reopen_task")!.handler({ taskId: 103 }, parentCaller));
  expect(out.ok).toBe(true);
  const [command, context] = lastCommand()!;
  expect(context).toEqual({ source: "hermes" });
  expect(command).toMatchObject({
    kind: "undo",
    operationId: expect.any(String),
    payload: { taskId: 103 },
  });
  expect(out.reconciled).toBe(true);
});

it("delete_task writes through the command seam with an operationId and the reconciler result", async () => {
  const out = JSON.parse(await getTool("delete_task")!.handler({ taskId: 101 }, parentCaller));
  expect(out.ok).toBe(true);
  const [command, context] = lastCommand()!;
  expect(context).toEqual({ source: "hermes" });
  expect(command).toMatchObject({
    kind: "delete",
    operationId: expect.any(String),
  });
  expect(JSON.parse((command as any).payload.taskData)).toMatchObject({ taskId: 101 });
  expect(out.reconciled).toBe(true);
  expect(out.deleted).toBe(true);
  expect(byId(101)).toBeUndefined();
  expect(snapData().deletedTaskIds).toContain(101);
});

it("delete_task is idempotent under a replayed operationId", async () => {
  mocks.nextOperationId.mockReturnValue("op-delete-replay");
  const first = JSON.parse(await getTool("delete_task")!.handler({ taskId: 101 }, parentCaller));
  const second = JSON.parse(await getTool("delete_task")!.handler({ taskId: 101 }, parentCaller));
  expect(first.ok).toBe(true);
  expect(second.ok).toBe(true);
  expect(second.taskId).toBe(101);
  expect(second.deleted).toBe(true);
  expect(second.reconciled).toBe(true);
  expect(snapData().deletedTaskIds.filter((id: number) => Number(id) === 101)).toHaveLength(1);
  expect(snapTasks().some((t: any) => Number(t.id) === 101)).toBe(false);
  expect(mocks.execute.mock.calls.filter(([c]: any[]) => c.kind === "delete")).toHaveLength(2);
});

it("delete_task refuses a completed row", async () => {
  const out = JSON.parse(await getTool("delete_task")!.handler({ taskId: 102 }, parentCaller));
  expect(out.ok).toBe(false);
  expect(mocks.execute).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "delete" }));
  expect(byId(102)).toBeDefined();
});

it("delete_task deletes an open and a crew row too — the description claims no classification", async () => {
  seedTasks([
    { id: 301, title: "Race to the bins", assignee: "Open", points: 5, due: "2026-09-30", completed: false, universal: true },
    { id: 302, title: "Crew clean", assignee: "Crew", points: 10, due: "2026-09-30", completed: false, universal: false, crewSize: 2, crew: { members: [{ name: "Member A", emoji: "👧", joinedAt: "2026-09-21T08:00:00.000Z" }] } },
  ]);
  const open = JSON.parse(await getTool("delete_task")!.handler({ taskId: 301 }, parentCaller));
  expect(open.ok).toBe(true);
  expect(open.deleted).toBe(true);
  const crew = JSON.parse(await getTool("delete_task")!.handler({ taskId: 302 }, parentCaller));
  expect(crew.ok).toBe(true);
  expect(crew.deleted).toBe(true);
  expect(byId(301)).toBeUndefined();
  expect(byId(302)).toBeUndefined();
  expect(snapData().deletedTaskIds).toEqual(expect.arrayContaining([301, 302]));
});

it("delete_task's description makes no assigned-only claim", () => {
  const description = getTool("delete_task")!.definition.description;
  expect(description).not.toContain("not open");
  expect(description).not.toContain("not crew");
  expect(description).not.toContain("ASSIGNED");
});

it("the manage command — not the tool list — refuses a child caller with adult_only", async () => {
  const out = JSON.parse(await getTool("add_task")!.handler({ title: "Feed dogs", assigned_to: "Emily" }, childCaller));
  expect(out).toMatchObject({ ok: false, reason: "adult_only" });
  expect(out.error).toContain("grown-up");
  const [command] = lastCommand()!;
  expect(command.actor).toMatchObject({ memberId: "mem-emily", name: "Emily", role: "child" });
  expect(snapTasks()).toHaveLength(2);
  expect(writes.some((w) => w.collection === SNAP)).toBe(false);
});

it("delete_task re-checks the caller's adulthood inside the command", async () => {
  const out = JSON.parse(await getTool("delete_task")!.handler({ taskId: 101 }, childCaller));
  expect(out).toMatchObject({ ok: false, reason: "adult_only" });
  expect(lastCommand()![0].actor).toMatchObject({ role: "child" });
  expect(byId(101)).toBeDefined();
  expect(snapData().deletedTaskIds).not.toContain(101);
});

it("a context-free call is not an adult — the missing context fails closed", async () => {
  const add = JSON.parse(await getTool("add_task")!.handler({ title: "Feed dogs", assigned_to: "Emily" }));
  expect(add).toMatchObject({ ok: false, reason: "adult_only" });
  const del = JSON.parse(await getTool("delete_task")!.handler({ taskId: 101 }));
  expect(del).toMatchObject({ ok: false, reason: "adult_only" });
  const complete = JSON.parse(await getTool("complete_task")!.handler({ taskId: 101 }));
  expect(complete).toMatchObject({ ok: false, reason: "adult_only" });
  const reopen = JSON.parse(await getTool("reopen_task")!.handler({ taskId: 103 }));
  expect(reopen).toMatchObject({ ok: false, reason: "adult_only" });
  // add/delete still reach the seam — with a NON-adult actor it refuses.
  expect(mocks.execute).not.toHaveBeenCalledWith(expect.objectContaining({ actor: expect.objectContaining({ role: "parent" }) }));
  expect(mocks.execute).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "complete" }));
  expect(mocks.execute).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "undo" }));
  expect(byId(101)!.completed).toBe(false);
  expect(byId(101)).toBeDefined();
  expect(snapData().deletedTaskIds).not.toContain(101);
});

it("a child caller cannot queue a completion or reopen one", async () => {
  const completion = JSON.parse(await getTool("complete_task")!.handler({ taskId: 101 }, childCaller));
  expect(completion).toMatchObject({ ok: false, reason: "adult_only" });
  expect(mocks.execute).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "complete" }));
  expect(byId(101)!.completed).toBe(false);
  seedTasks([{ id: 103, title: "Queued", assignee: "Emily G", universal: false, completed: true, completedBy: "Emily G", pendingApproval: { byName: "Emily G", at: "2026-09-10T10:00:00Z", points: 5 }, sentBackAt: null }]);
  const reopen = JSON.parse(await getTool("reopen_task")!.handler({ taskId: 103 }, childCaller));
  expect(reopen).toMatchObject({ ok: false, reason: "adult_only" });
  expect(mocks.execute).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "undo" }));
  expect(byId(103)!.completed).toBe(true);
});
