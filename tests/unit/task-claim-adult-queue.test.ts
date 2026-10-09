import { describe, it, expect, vi, beforeEach } from "vitest";

// Option B (decided 2026-09-28). The claim seam — not the chat tool — decides
// queue-vs-pay, and it keys off `actor.authentication`, NEVER `actor.role`:
//
//   "internal"  → chat / MUSE / a server-side caller → QUEUES (no ledger write)
//   "pin"       → the Tasks screen with a verified member PIN → PAYS
//   "session"   → the Tasks screen under a member cookie; an adult is refused
//                 `pin_required` by sessionPolicyAllows, so it never pays either
//
// Because the branch never reads `role`, a member promoted child -> parent
// between two roster reads cannot change the outcome: the guarantee is
// unconditional rather than dependent on two reads agreeing.

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  getLiveMembers: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/live-member", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getLiveMembers: mocks.getLiveMembers };
});

// Importing the seam registers its command handlers, so
// executeInternalTaskCommand can dispatch to `complete` / `undo`.
import { ensureTaskApprovalHandlersRegistered } from "@/lib/task-approval";
import { ensureTaskClaimHandlersRegistered } from "@/lib/task-claim";
import { executeInternalTaskCommand } from "@/lib/task-commands";
import type { InternalTaskCommand } from "@/lib/task-commands";

const SNAP = "consuela_data_snapshots";
const WEEK = "week_data";

const liveMembers = [
  { id: "parent-alex", name: "Alex", role: "parent", emoji: "🦊", age: 40 },
  { id: "parent-rebecca", name: "Rebecca Garcia", role: "parent", emoji: "🐱", age: 40 },
  { id: "child-caspian", name: "Caspian Garcia", role: "child", emoji: "🧒", age: 5 },
];

function mondayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().split("T")[0];
}

const adultTask = {
  id: 42,
  title: "Take out the bins",
  assignee: "Alex",
  points: 7,
  universal: false,
  completed: false,
};

const childTask = {
  id: 43,
  title: "Walk Rocco",
  assignee: "Caspian Garcia",
  points: 5,
  universal: false,
  completed: false,
};

const claimableTask = {
  id: 44,
  title: "Unload the dishwasher",
  assignee: "Open",
  points: 6,
  universal: true,
  completed: false,
};

/** A fake PocketBase that round-trips the snapshot row and the week_data row,
 *  so both the queueing write and the paying write are observable. */
function makePb(options?: { task?: Record<string, unknown> }) {
  const task = options?.task ?? adultTask;
  const weekStart = mondayISO();
  let snapshotRow: Record<string, any> = {
    id: "snap-1",
    key: "tasks-snapshot",
    data: JSON.stringify({
      tasks: [task],
      deletedTaskIds: [],
      weekData: { weekStart, points: {}, streak: {}, lastActive: {}, history: [] },
    }),
  };
  let weekRow: Record<string, any> | null = null;
  const taskRows: Record<string, any>[] = [{ ...task, id: "task-row-1" }];
  const weekWrites: unknown[] = [];

  const collection = (name: string) => {
    if (name === SNAP) {
      return {
        getFullList: async () => [structuredClone(snapshotRow)],
        update: async (_id: string, payload: any) => {
          snapshotRow = { ...snapshotRow, ...payload };
          return snapshotRow;
        },
        create: async (payload: any) => {
          snapshotRow = { ...snapshotRow, ...payload };
          return snapshotRow;
        },
      };
    }
    if (name === WEEK) {
      return {
        getFullList: async () => (weekRow ? [structuredClone(weekRow)] : []),
        update: async (_id: string, payload: any) => {
          weekWrites.push(payload);
          weekRow = { id: "week-1", ...weekRow, ...payload };
          return weekRow;
        },
        create: async (payload: any) => {
          weekWrites.push(payload);
          weekRow = { id: "week-1", ...payload };
          return weekRow;
        },
      };
    }
    if (name === "week_archive") {
      return { getFullList: async () => [] };
    }
    return {
      getFullList: async () => structuredClone(taskRows),
      update: async (id: string, payload: any) => {
        const index = taskRows.findIndex((row) => row.id === id);
        if (index >= 0) taskRows[index] = { ...taskRows[index], ...payload };
        return taskRows[index] ?? { id };
      },
      create: async (payload: any) => {
        const created = { id: `task-row-${taskRows.length + 1}`, ...payload };
        taskRows.push(created);
        return created;
      },
    };
  };

  return {
    pb: { collection },
    weekWrites,
    snapshotTask: (id: number) => {
      const data = typeof snapshotRow.data === "string" ? JSON.parse(snapshotRow.data) : snapshotRow.data;
      return (data.tasks ?? []).find((row: any) => Number(row.id) === id);
    },
    snapshotWeekPoints: () => {
      const data = typeof snapshotRow.data === "string" ? JSON.parse(snapshotRow.data) : snapshotRow.data;
      return data.weekData?.points ?? {};
    },
  };
}

let operationSequence = 0;

/** The brief's fixture signature: build a `complete` command whose actor
 *  authentication is the ONLY thing that decides queue-vs-pay. */
function buildCompleteCommand(
  actor: { authentication?: "internal" | "session" | "pin"; role?: string; name?: string; memberId?: string },
  taskId = adultTask.id,
): InternalTaskCommand {
  const role = actor.role ?? "parent";
  const parentish = role !== "child";
  return {
    operationId: `op-adult-queue-${++operationSequence}`,
    kind: "complete",
    actor: {
      memberId: actor.memberId ?? (parentish ? "parent-alex" : "child-caspian"),
      name: actor.name ?? (parentish ? "Alex" : "Caspian Garcia"),
      role,
      authentication: actor.authentication ?? "internal",
    },
    payload: { taskId },
  };
}

async function run(command: InternalTaskCommand, fixture = makePb()) {
  mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(fixture.pb));
  const result = await executeInternalTaskCommand(command, { source: "hermes" });
  return { result, fixture };
}

beforeEach(() => {
  ensureTaskClaimHandlersRegistered();
  ensureTaskApprovalHandlersRegistered();
  mocks.withAdmin.mockReset();
  mocks.getLiveMembers.mockReset().mockResolvedValue(liveMembers);
});

describe("Option B — who queues and who pays", () => {
  it("queues an adult actor arriving as authentication internal (chat) — the roster race cannot flip this", async () => {
    // A roster that says "grown-up" + authentication "internal" IS the
    // promoted-between-reads scenario. The branch never consults `role`, so it
    // queues and the ledger is untouched.
    const { result, fixture } = await run(buildCompleteCommand({ authentication: "internal", role: "parent" }));

    expect(result.ok).toBe(true);
    expect(result.task?.pendingApproval).toMatchObject({ byName: "Alex", points: 7 });
    expect(fixture.weekWrites).toHaveLength(0);
    expect(fixture.snapshotWeekPoints()).toEqual({});
  });

  it("pays an adult actor arriving as authentication pin (the Tasks screen)", async () => {
    const { result, fixture } = await run(buildCompleteCommand({ authentication: "pin", role: "parent" }));

    expect(result.ok).toBe(true);
    expect(result.task?.pendingApproval).toBeNull();
    // The claim seam reports movement through the ledger, not a `paid` field
    // (that one belongs to the approval seam) — so the observable is the write.
    expect(fixture.weekWrites.length).toBeGreaterThan(0);
    const weekWrite = fixture.weekWrites.at(-1) as any;
    expect(weekWrite.points.Alex).toBe(7);
    expect(weekWrite.history.some((tx: any) => tx.type === "earn" && tx.amount === 7)).toBe(true);
    expect(fixture.snapshotWeekPoints().Alex).toBe(7);
  });

  it("still queues a child actor on every authentication — the child path is unchanged", async () => {
    for (const authentication of ["internal", "pin"] as const) {
      const { result, fixture } = await run(
        buildCompleteCommand({ authentication, role: "child" }, childTask.id),
        makePb({ task: childTask }),
      );
      expect(result.ok).toBe(true);
      expect(result.task?.pendingApproval).toMatchObject({ byName: "Caspian Garcia", points: 5 });
      expect(fixture.weekWrites).toHaveLength(0);
    }
  });

  it("refuses an adult session-only caller with pin_required — a session never pays", async () => {
    // The adult Tasks-screen path is PIN-verified; a bare cookie is not enough.
    // This is a pre-existing sessionPolicyAllows rule, pinned here because the
    // queue/pay branch must not quietly widen it.
    const { result, fixture } = await run(buildCompleteCommand({ authentication: "session", role: "parent" }));

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("pin_required");
    expect(fixture.weekWrites).toHaveLength(0);
  });
});

// The same invariant, on the OTHER paying branch. `kind: "claim"` (an open or
// late-stealable chore) is registered as an internal command kind, so the seam
// itself must hold the "chat never moves points" rule — not just the single
// caller that currently uses it (`hermes-tools.runClaimTaskCommand` is typed
// "complete" | "undo"). Without this the guarantee is one rename away from
// being false.
describe("Option B — the CLAIM branch queues an internal adult too", () => {
  const buildClaimCommand = (
    authentication: "internal" | "pin",
  ): InternalTaskCommand => ({
    operationId: `op-claim-branch-${authentication}`,
    kind: "claim",
    actor: {
      memberId: "parent-alex",
      name: "Alex",
      role: "parent",
      authentication,
    },
    payload: { taskId: claimableTask.id },
  });

  it("queues an adult claim arriving as authentication internal (chat) — no ledger write", async () => {
    const { result, fixture } = await run(buildClaimCommand("internal"), makePb({ task: claimableTask }));

    expect(result.ok).toBe(true);
    expect(result.task?.pendingApproval).toMatchObject({ byName: "Alex", points: 6 });
    expect(fixture.snapshotTask(claimableTask.id)?.pendingApproval).toMatchObject({
      byName: "Alex",
      points: 6,
    });
    expect(fixture.weekWrites).toHaveLength(0);
    expect(fixture.snapshotWeekPoints()).toEqual({});
  });

  it("still pays an adult claim arriving as authentication pin (the Tasks screen)", async () => {
    const { result, fixture } = await run(buildClaimCommand("pin"), makePb({ task: claimableTask }));

    expect(result.ok).toBe(true);
    expect(result.task?.pendingApproval).toBeNull();
    expect(fixture.weekWrites.length).toBeGreaterThan(0);
    const weekWrite = fixture.weekWrites.at(-1) as any;
    expect(weekWrite.points.Alex).toBe(6);
    expect(weekWrite.history.some((tx: any) => tx.type === "earn" && tx.amount === 6)).toBe(true);
  });
});

describe("Option B — reopen clears an ADULT payee's pendingApproval", () => {
  it("reopens an adult-queued row: pendingApproval null and the completed fields null (never \"\")", async () => {
    const queuedAdult = {
      id: 42,
      title: "Take out the bins",
      assignee: "Alex",
      points: 7,
      universal: false,
      completed: true,
      status: "done",
      completedBy: "Alex",
      completedAt: "2026-09-28T10:00:00.000Z",
      completedInWeek: mondayISO(),
      pendingApproval: { byName: "Alex", at: "2026-09-28T10:00:00.000Z", points: 7 },
      sentBackAt: null,
    };
    const fixture = makePb({ task: queuedAdult });
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(fixture.pb));

    const result = await executeInternalTaskCommand(
      {
        operationId: "op-adult-queue-reopen",
        kind: "undo",
        actor: { memberId: "parent-alex", name: "Alex", role: "parent", authentication: "internal" },
        payload: { taskId: 42 },
      },
      { source: "hermes" },
    );

    expect(result.ok).toBe(true);
    const row = fixture.snapshotTask(42)!;
    expect(row.completed).toBe(false);
    expect(row.pendingApproval).toBeNull();
    // "" is not nullish — it would persist as a lie.
    expect(row.completedBy).toBeNull();
    expect(row.completedAt).toBeNull();
    expect(row.completedInWeek).toBeNull();
    // A queued row was never paid, so reopening it moves no points.
    expect(fixture.weekWrites).toHaveLength(0);
  });
});

describe("Option B — approve pays an ADULT payee, idempotent on taskId + member", () => {
  const queuedAdult = () => ({
    id: 42,
    title: "Take out the bins",
    assignee: "Alex",
    points: 7,
    universal: false,
    completed: true,
    status: "done",
    completedBy: "Alex",
    completedAt: "2026-09-28T10:00:00.000Z",
    completedInWeek: mondayISO(),
    pendingApproval: { byName: "Alex", at: "2026-09-28T10:00:00.000Z", points: 7 },
    sentBackAt: null,
  });

  // A DIFFERENT parent approves, so the payee ("Alex") and the approver
  // ("Rebecca Garcia") are distinct: nothing here can pass by self-approval.
  const approveAs = (operationId: string) => ({
    operationId,
    kind: "approve" as const,
    actor: { memberId: "parent-rebecca", name: "Rebecca Garcia", role: "parent" },
    payload: { taskId: 42 },
  });

  it("pays the adult payee named in pendingApproval and clears the queue", async () => {
    const fixture = makePb({ task: queuedAdult() });
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(fixture.pb));

    const result = await executeInternalTaskCommand(approveAs("op-adult-approve-1"), { source: "server" });

    expect(result.ok).toBe(true);
    const weekWrite = fixture.weekWrites.at(-1) as any;
    expect(weekWrite.points.Alex).toBe(7);
    expect(weekWrite.history.filter((tx: any) => tx.taskId === 42 && tx.member === "Alex")).toHaveLength(1);
    const row = fixture.snapshotTask(42)!;
    expect(row.pendingApproval).toBeNull();
  });

  it("a replayed approve on the same operationId does not double-pay the adult", async () => {
    const fixture = makePb({ task: queuedAdult() });
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(fixture.pb));

    await executeInternalTaskCommand(approveAs("op-adult-approve-replay"), { source: "server" });
    const second = await executeInternalTaskCommand(approveAs("op-adult-approve-replay"), { source: "server" });

    expect(second.ok).toBe(true);
    const weekWrite = fixture.weekWrites.at(-1) as any;
    expect(weekWrite.points.Alex).toBe(7);
    expect(weekWrite.history.filter((tx: any) => tx.taskId === 42 && tx.member === "Alex")).toHaveLength(1);
  });
});
