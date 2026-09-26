import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifyPinFromPB: vi.fn(),
  verifySession: vi.fn(),
  requireLiveSession: vi.fn(),
  findMemberByName: vi.fn(),
  getLiveMemberById: vi.fn(),
  getLiveMembers: vi.fn(),
  namesMatch: (recordName: string, query: string) => {
    const firstName = query.split(" ")[0];
    return (
      recordName === query ||
      recordName.startsWith(`${query} `) ||
      recordName.split(" ")[0] === query ||
      recordName === firstName ||
      firstName.startsWith(recordName)
    );
  },
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/server-auth", () => ({
  verifyPinFromPB: mocks.verifyPinFromPB,
  findMemberByName: mocks.findMemberByName,
  namesMatch: mocks.namesMatch,
  requireLiveSession: mocks.requireLiveSession,
}));

vi.mock("@/lib/session", () => ({
  SESSION_COOKIE: "consuela_session",
  verifySession: (token?: string) => mocks.verifySession(token),
}));

vi.mock("@/lib/live-member", () => ({
  getLiveMemberById: mocks.getLiveMemberById,
  getLiveMembers: mocks.getLiveMembers,
}));

import { POST } from "@/app/api/tasks/claim/route";
import { executeInternalTaskCommand } from "@/lib/task-commands";
import { taskClaimInternalPayload, type ClaimAction } from "@/lib/task-claim";
import { taskManageInternalPayload } from "@/lib/task-manage";
import { localWeekStartISO } from "@/lib/local-date";

function mondayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().split("T")[0];
}

let requestSequence = 0;

function jsonReq(body: unknown, cookie?: string): NextRequest {
  const payload =
    body && typeof body === "object" && !Array.isArray(body) &&
    (!("operationId" in body) || (body as Record<string, unknown>).operationId === undefined)
      ? { operationId: `op-test-${++requestSequence}`, ...(body as Record<string, unknown>) }
      : body;
  return new NextRequest("http://localhost/api/tasks/claim", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `consuela_session=${cookie}` } : {}),
    },
    body: JSON.stringify(payload),
  });
}

function rawReq(body: string): NextRequest {
  return new NextRequest("http://localhost/api/tasks/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

/** Builds a fake pb whose week_data row reflects writes, unless the caller
 * overrides getOne to simulate losing a concurrent write race. */
function makePb(opts?: {
  taskPoints?: number | null;
  weekHistoryAfterWrite?: string;
  taskRow?: Record<string, unknown>;
  taskRows?: Record<string, unknown>[];
  weekHistory?: string;
  snapshotTasks?: Record<string, unknown>[];
  deletedTaskIds?: number[];
  snapshotData?: Record<string, unknown>;
  failTaskWrite?: boolean;
  failSnapshotWriteAfter?: number;
  snapshotReadStarted?: () => void;
  snapshotReadGate?: Promise<void>;
}) {
  const weekRow = {
    id: "w1",
    weekStart: mondayISO(),
    points: "{}",
    streak: "{}",
    lastActive: "{}",
    history: "[]",
    ...(opts?.weekHistory !== undefined ? { history: opts.weekHistory } : {}),
  };
  const taskRowBase = opts?.taskRows ?? (opts?.taskPoints === null ? [] : [
    { id: "task-row-1", taskId: 42, title: "Dishes", points: opts?.taskPoints ?? 5, ...(opts?.taskRow || {}) },
  ]);
  const taskRow = taskRowBase;
  const updateCalls: { tasks: any[]; week_data?: any[] } = { tasks: [] };
  let taskCollectionReads = 0;
  let failTaskWrite = Boolean(opts?.failTaskWrite);
  let weekWritten = false;
  let written: any = null;
  // The dashboard reads points from the snapshot blob, not week_data — the
  // claim route must persist BOTH (points-display bug).
  const defaultSnapshotTask = {
    id: 42,
    title: "Dishes",
    points: opts?.taskPoints ?? 5,
    completed: false,
    ...(opts?.taskRow || {}),
  };
  const defaultSnapshotTasks = opts?.taskPoints === null
    ? []
    : opts?.snapshotTasks ?? [defaultSnapshotTask];
  let snapshotRow: any = {
    id: "snap-1",
    key: "tasks-snapshot",
    data: JSON.stringify(opts?.snapshotData ?? {
      tasks: defaultSnapshotTasks,
      deletedTaskIds: opts?.deletedTaskIds ?? [],
      weekData: { weekStart: mondayISO(), points: {}, streak: {}, lastActive: {}, history: [] },
    }),
  };
  let snapshotWritten: any = null;
  let snapshotWrites = 0;
  let snapshotReads = 0;
  return {
    updateCalls,
    taskCollectionReads: () => taskCollectionReads,
    weekUpdates: () => written,
    snapshotUpdates: () => snapshotWritten,
    snapshotData: () => typeof snapshotRow.data === "string" ? JSON.parse(snapshotRow.data) : structuredClone(snapshotRow.data),
    updateSnapshotTask: (id: number, patch: Record<string, unknown>) => {
      const data = typeof snapshotRow.data === "string" ? JSON.parse(snapshotRow.data) : structuredClone(snapshotRow.data);
      data.tasks = (data.tasks || []).map((task: any) => Number(task.id) === id ? { ...task, ...patch } : task);
      snapshotRow = { ...snapshotRow, data: JSON.stringify(data) };
    },
    tombstoneSnapshotTask: (id: number) => {
      const data = typeof snapshotRow.data === "string" ? JSON.parse(snapshotRow.data) : structuredClone(snapshotRow.data);
      data.tasks = (data.tasks || []).filter((task: any) => Number(task.id) !== id);
      data.deletedTaskIds = [...new Set([...(data.deletedTaskIds || []), id])];
      snapshotRow = { ...snapshotRow, data: JSON.stringify(data) };
    },
    updateWeekHistory: (history: unknown[]) => {
      weekRow.history = JSON.stringify(history);
      weekRow.points = JSON.stringify({});
    },
    pb: {
      collection: (name: string) => {
        if (name === "consuela_data_snapshots") {
          return {
            getFullList: async () => {
              const value = structuredClone(snapshotRow);
              const read = snapshotReads++;
              if (read === 0) {
                opts?.snapshotReadStarted?.();
                if (opts?.snapshotReadGate) await opts.snapshotReadGate;
              }
              return [value];
            },
            update: async (_id: string, payload: any) => {
              snapshotWrites += 1;
              if (opts?.failSnapshotWriteAfter === snapshotWrites) {
                throw new Error("snapshot projection failed");
              }
              snapshotWritten = payload;
              snapshotRow = { ...snapshotRow, ...payload };
              return snapshotRow;
            },
            create: async (payload: any) => {
              snapshotWrites += 1;
              if (opts?.failSnapshotWriteAfter === snapshotWrites) {
                throw new Error("snapshot projection failed");
              }
              snapshotWritten = payload;
              snapshotRow = { ...snapshotRow, ...payload };
              return snapshotRow;
            },
          };
        }
        if (name === "week_data") {
          return {
            getFullList: async () => [
              opts?.weekHistoryAfterWrite !== undefined && weekWritten
                ? { ...weekRow, history: opts.weekHistoryAfterWrite }
                : weekRow,
            ],
            update: async (_id: string, payload: any) => {
              weekWritten = true;
              written = payload;
              (updateCalls.week_data ??= []).push(payload);
              Object.assign(weekRow, payload);
              return weekRow;
            },
            create: async (payload: any) => {
              weekWritten = true;
              written = payload;
              (updateCalls.week_data ??= []).push(payload);
              Object.assign(weekRow, payload);
              return weekRow;
            },
            getOne: async () =>
              opts?.weekHistoryAfterWrite !== undefined
                ? { ...weekRow, history: opts.weekHistoryAfterWrite }
                : weekRow,
          };
        }
        return {
          getFullList: async () => {
            taskCollectionReads += 1;
            return taskRow;
          },
          update: async (id: string, payload: any) => {
            if (failTaskWrite) {
              failTaskWrite = false;
              throw new Error("task projection failed");
            }
            updateCalls.tasks.push(payload);
            const index = taskRow.findIndex((row: any) => String(row.id) === String(id));
            if (index >= 0) taskRow[index] = { ...taskRow[index], ...payload };
            return taskRow[index] ?? { id };
          },
          create: async (payload: any) => {
            if (failTaskWrite) {
              failTaskWrite = false;
              throw new Error("task projection failed");
            }
            const created = { id: `task-row-${taskRow.length + 1}`, ...payload };
            taskRow.push(created);
            return created;
          },
          delete: async (id: string) => {
            if (failTaskWrite) {
              failTaskWrite = false;
              throw new Error("task projection failed");
            }
            const index = taskRow.findIndex((row: any) => String(row.id) === String(id));
            if (index >= 0) taskRow.splice(index, 1);
            return true;
          },
        };
      },
    },
  };
}

const defaultLiveMembers = [
  { id: "parent-alex", name: "Alex", role: "parent", emoji: "🦊", age: 40 },
  { id: "parent-rebecca", name: "Rebecca Garcia", role: "parent", emoji: "🐱", age: 40 },
  { id: "child-caspian", name: "Caspian Garcia", role: "child", emoji: "🧒", age: 5 },
  { id: "child-bailey", name: "Bailey Garcia", role: "child", emoji: "👧", age: 12 },
  { id: "child-emily", name: "Emily Garcia", role: "child", emoji: "👧", age: 8 },
  { id: "child-lily", name: "Lily Garcia", role: "child", emoji: "🌸", age: 7 },
  { id: "pet-rex", name: "Rex", role: "pet", emoji: "🐶", age: 3 },
];

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.verifyPinFromPB.mockReset();
  mocks.verifySession.mockReset().mockResolvedValue(null);
  mocks.findMemberByName.mockReset().mockResolvedValue(null);
  mocks.getLiveMemberById.mockReset();
  mocks.getLiveMembers.mockReset().mockResolvedValue(defaultLiveMembers);
  mocks.getLiveMemberById.mockImplementation(async (id: string) =>
    defaultLiveMembers.find((member) => member.id === id) ?? null
  );
  mocks.verifyPinFromPB.mockImplementation(async (name: string) => {
    const member = defaultLiveMembers.find((candidate: any) =>
      candidate.name === name || candidate.name.split(" ")[0] === name
    );
    return member ?? null;
  });
  // The PIN-free session path revalidates the cookie against the LIVE roster:
  // the same contract as requireLiveSession, built from this suite's own
  // verifySession + getLiveMemberById seams.
  mocks.requireLiveSession.mockReset().mockImplementation(async (request: NextRequest, options?: { requireRole?: string }) => {
    const token = request.headers.get("cookie")?.match(/consuela_session=([^;]+)/)?.[1];
    const signed = await mocks.verifySession(token);
    if (!signed) return { ok: false as const, status: 401 as const, error: "unauthorized" as const };
    const live = await mocks.getLiveMemberById(signed.memberId);
    if (!live) return { ok: false as const, status: 401 as const, error: "unauthorized" as const };
    if (live.role !== signed.role) {
      return { ok: false as const, status: 403 as const, error: "session_role_changed" as const };
    }
    if (options?.requireRole && live.role !== options.requireRole) {
      return { ok: false as const, status: 403 as const, error: "adult_only" as const };
    }
    return {
      ok: true as const,
      identity: { memberId: live.id, name: live.name, role: live.role },
    };
  });
});

describe("POST /api/tasks/claim", () => {
  it("awards the task row's stored points", async () => {
    const { pb, weekUpdates } = makePb({ taskPoints: 5 });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(
      jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" })
    );

    expect(res.status).toBe(200);
    expect(mocks.verifyPinFromPB).toHaveBeenCalledWith("Alex", "1234");
    const written = weekUpdates();
    const history = written.history;
    expect(history).toHaveLength(1);
    expect(history[0].amount).toBe(5);
    expect(written.points["Alex"]).toBe(5);
  });

  it("returns 404 for an unknown taskId instead of minting points", async () => {
    const { pb } = makePb({ taskPoints: null });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 999999, claimantName: "Alex", claimantPin: "1234" }));

    expect(await res.json()).toMatchObject({ success: false, reason: "unknown_task" });
    expect(res.status).toBe(404);
  });

  it("detects a lost concurrent write and reports 409 instead of silent point loss", async () => {
    const siblingHistory = JSON.stringify([
      { id: 111, timestamp: "2026-08-24T10:00:00Z", member: "Sam", type: "earn", amount: 5, description: "Completed: Dishes (+5pts)", taskId: 42 },
    ]);
    const { pb } = makePb({ taskPoints: 5, weekHistoryAfterWrite: siblingHistory });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(
      jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" })
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.reason).toBe("ledger_unavailable");
  });

  it("keeps the happy path: valid pin, unclaimed task, existing week row", async () => {
    const { pb } = makePb({ taskPoints: 7 });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    const res = await POST(jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.weekData.history[0].amount).toBe(7);
  });

  it("also persists the earn into the SNAPSHOT the dashboard reads", async () => {
    // Points-display bug: the dashboard reads consuela_data_snapshots' weekData
    // leg, but the claim route only wrote week_data — so earned points never
    // showed unless a PARENT browser later pushed its own snapshot.
    const { pb, snapshotUpdates } = makePb({ taskPoints: 5 });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" }));

    expect(res.status).toBe(200);
    const snap = snapshotUpdates();
    expect(snap).toBeTruthy();
    const data = typeof snap.data === "string" ? JSON.parse(snap.data) : snap.data;
    expect(data.weekData.points["Alex"]).toBe(5);
    expect(data.weekData.history.some((t: any) => t.taskId === 42 && t.type === "earn")).toBe(true);
  });

  it("writes a crew join into the snapshot's tasks leg too", async () => {
    const { pb, snapshotUpdates } = makePb({
      taskPoints: 10,
      taskRow: { universal: false, crewSize: 3, crew: { members: [] } },
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "crew-join", taskId: 42, memberName: "Alex", pin: "1234" }));

    expect(res.status).toBe(200);
    const snap = snapshotUpdates();
    expect(snap).toBeTruthy();
    const data = typeof snap.data === "string" ? JSON.parse(snap.data) : snap.data;
    const row = (data.tasks || []).find((t: any) => t.id === 42);
    expect(row.crew.members.map((m: any) => m.name)).toEqual(["Alex"]);
  });

  it("treats a last-week status=done task as claimable again (not blocked)", async () => {
    // Stale-row bug: the rollover clears `completed` but leaves `status:"done"`
    // on the PB row; the guard blocked every such task forever.
    const { pb, weekUpdates } = makePb({
      taskPoints: 5,
      taskRow: { universal: true, completed: false, status: "done", completedInWeek: "2026-09-07" },
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" }));

    expect(res.status).toBe(200);
    expect(weekUpdates().points["Alex"]).toBe(5);
  });

  it("accepts a stealable task whose due date passed (universal false)", async () => {
    const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
    const { pb } = makePb({ taskPoints: 5, taskRow: { universal: false, stealable: true, due: yesterday } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.weekData.history[0].description).toMatch(/^Snatched:/);
  });

  it("rejects a stealable task that is not late yet", async () => {
    const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
    const { pb } = makePb({ taskPoints: 5, taskRow: { universal: false, stealable: true, due: tomorrow } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, reason: "not_late_yet" });
  });

  it("rejects a non-universal, non-stealable task", async () => {
    const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
    const { pb } = makePb({ taskPoints: 5, taskRow: { universal: false, stealable: false, due: yesterday } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" }));

    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe("not_universal");
  });

  it("child claimant → pendingApproval on the task row, no week_data earn", async () => {
    mocks.verifyPinFromPB.mockResolvedValue({ id: "child-caspian", name: "Caspian Garcia", role: "child", emoji: "🧒" });
    const { pb, updateCalls, snapshotUpdates } = makePb({ taskPoints: 5 });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 42, claimantName: "Caspian", claimantPin: "1010" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, pending: true, claimedBy: "Caspian Garcia" });
    expect(body.weekData).toBeUndefined();
    expect(updateCalls.week_data).toBeUndefined(); // no earn written
    const taskPatch = updateCalls.tasks.find((p: any) => p.pendingApproval);
    expect(taskPatch).toBeTruthy();
    expect(taskPatch.pendingApproval).toMatchObject({ byName: "Caspian Garcia", points: 5 });
    // The claim still lands as a real completion (race-safe single-winner).
    expect(taskPatch).toMatchObject({ completed: true, status: "done", assignee: "Caspian Garcia", completedBy: "Caspian Garcia" });
    // A fresh claim supersedes any earlier send-back: the stale stamp MUST be
    // cleared, or the 60s snapshot pull delivers sentBackAt as "proof" the
    // pending row was reopened (mergeTasksSnapshot's sentBackElsewhere gate),
    // wiping the kid's optimistic pending row and clobbering the claim back
    // to unclaimed.
    expect(taskPatch.sentBackAt).toBeNull();
    // SNAPSHOT PARITY (2026-09-23 review): the same stamp clear must land on
    // the snapshot row the dashboard actually renders — a stale send-back
    // stamp surviving there resurrects the same merge-gate wipe.
    const snap = snapshotUpdates();
    const snapData = typeof snap?.data === "string" ? JSON.parse(snap.data) : snap?.data;
    const snapTask = (snapData?.tasks || []).find((x: any) => x.id === 42);
    expect(snapTask?.pendingApproval).toMatchObject({ byName: "Caspian Garcia", points: 5 });
    expect(snapTask?.sentBackAt).toBeNull();
  });

  it("a second claim on the kid's pending row is still rejected", async () => {
    mocks.verifyPinFromPB.mockResolvedValue({ id: "child-caspian", name: "Caspian Garcia", role: "child", emoji: "🧒" });
    const { pb } = makePb({
      taskPoints: 5,
      taskRow: { completed: true, status: "done", pendingApproval: { byName: "Caspian Garcia", points: 5 } },
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 42, claimantName: "Caspian", claimantPin: "1010" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, reason: "already_completed" });
  });

  it("adult claim keeps the immediate-earn contract and never sets pending", async () => {
    const { pb, updateCalls } = makePb({ taskPoints: 5 });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" }));

    const body = await res.json();
    expect(body).toMatchObject({ success: true });
    expect(body.pending).toBeUndefined();
    expect(body.weekData).toBeTruthy();
    // Adults never write pendingApproval on the task row.
    expect(updateCalls.tasks.some((p: any) => p.pendingApproval)).toBe(false);
  });

  it("open task adult claim adds the speed bonus and labels it 'Fast grab'", async () => {
    const { pb, weekUpdates } = makePb({ taskPoints: 5, taskRow: { universal: true, speedBonus: 2 } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" }));

    expect(res.status).toBe(200);
    const written = weekUpdates();
    expect(written.history[0].amount).toBe(7);
    expect(written.history[0].description).toMatch(/^Fast grab:/);
    expect(written.points["Alex"]).toBe(7);
  });

  it("kid open claim lands pendingApproval WITH the speed bonus (no points moved)", async () => {
    mocks.verifyPinFromPB.mockResolvedValue({ id: "child-caspian", name: "Caspian Garcia", role: "child", emoji: "🧒" });
    const { pb, updateCalls, weekUpdates } = makePb({ taskPoints: 5, taskRow: { universal: true, speedBonus: 3 } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 42, claimantName: "Caspian", claimantPin: "1010" }));

    expect(res.status).toBe(200);
    expect(weekUpdates()).toBeNull();
    const taskPatch = updateCalls.tasks.find((p: any) => p.pendingApproval);
    expect(taskPatch.pendingApproval).toMatchObject({ byName: "Caspian Garcia", points: 8 });
  });

  it("rejects a single claim on a crew task", async () => {
    const { pb } = makePb({ taskPoints: 5, taskRow: { universal: false, crewSize: 2, crew: null } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, reason: "crew_task" });
  });
});

describe("POST /api/tasks/claim — crew actions", () => {
  const crewTaskRow = (overrides: Record<string, unknown> = {}) => ({
    universal: false,
    crewSize: 3,
    crew: { members: [] },
    ...overrides,
  });

  it("crew-join appends the member and is idempotent", async () => {
    const { pb, updateCalls } = makePb({ taskPoints: 10, taskRow: crewTaskRow() });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "crew-join", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.crew.members.map((m: any) => m.name)).toEqual(["Alex"]);
    expect(updateCalls.tasks[0].crew.members).toHaveLength(1);

    // A second join by the same person is a no-op 200.
    const patch = updateCalls.tasks[0].crew.members[0];
    const pb2 = makePb({ taskPoints: 10, taskRow: crewTaskRow({ crew: { members: [patch] } }) });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb2.pb));
    const res2 = await POST(jsonReq({ action: "crew-join", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res2.status).toBe(200);
    expect((await res2.json()).alreadyJoined).toBe(true);
  });

  it("crew-join returns 409 crew_full on the last slot", async () => {
    const filled = crewTaskRow({
      crewSize: 2,
      crew: { members: [{ name: "Lily", emoji: "", joinedAt: "x" }, { name: "Bailey", emoji: "", joinedAt: "y" }] },
    });
    const { pb } = makePb({ taskPoints: 10, taskRow: filled });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "crew-join", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, reason: "crew_full" });
  });

  it("crew-join gates a photo avatar down to the fallback glyph (PB json field, same class as assigneeEmoji)", async () => {
    // 2026-09-23 review: crew members' emojis come from members.emoji — a
    // photo member there is a 100KB+ base64 data URL. crewJoin stored it
    // verbatim into the PB tasks row (and the crew rides the snapshot write /
    // mirrorTaskToCollection raw), the same photo-bloat class the emoji gate
    // closed for assigneeEmoji.
    const photo = `data:image/webp;base64,${"A".repeat(80_000)}`;
    const roster = defaultLiveMembers.map((member) =>
      member.id === "child-emily" ? { ...member, emoji: photo } : member
    );
    mocks.getLiveMembers.mockResolvedValue(roster);
    mocks.getLiveMemberById.mockImplementation(async (id: string) => roster.find((member) => member.id === id) ?? null);
    mocks.verifyPinFromPB.mockResolvedValue({ id: "child-emily", name: "Emily Garcia", role: "child", emoji: photo });
    const { pb, updateCalls } = makePb({ taskPoints: 10, taskRow: crewTaskRow({ crewSize: 3, crew: { members: [] } }) });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "crew-join", taskId: 42, memberName: "Emily", pin: "1010" }));
    expect(res.status).toBe(200);
    const patch = updateCalls.tasks.find((p: any) => p.crew);
    const joined = patch.crew.members.find((m: any) => m.name === "Emily Garcia");
    expect(joined).toBeTruthy();
    expect(joined.emoji).toBe("👤");
    expect(JSON.stringify(patch.crew).length).toBeLessThan(5000);
  });

  it("crew-join keeps a short glyph emoji as-is", async () => {
    mocks.verifyPinFromPB.mockResolvedValue({ id: "child-lily", name: "Lily", role: "child", emoji: "🌸" });
    const { pb, updateCalls } = makePb({ taskPoints: 10, taskRow: crewTaskRow({ crewSize: 3, crew: { members: [] } }) });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "crew-join", taskId: 42, memberName: "Lily", pin: "1010" }));
    expect(res.status).toBe(200);
    const patch = updateCalls.tasks.find((p: any) => p.crew);
    expect(patch.crew.members.find((m: any) => m.name === "Lily Garcia").emoji).toBe("🌸");
  });

  it("crew-join rejects a non-crew task", async () => {
    const { pb } = makePb({ taskPoints: 5, taskRow: { universal: true } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "crew-join", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ reason: "not_crew_task" });
  });

  it("crew-checkin sets checkedInAt once and flips needs-approval only when full", async () => {
    const row = crewTaskRow({
      crewSize: 2,
      crew: { members: [{ name: "Alex", emoji: "", joinedAt: "x" }, { name: "Lily", emoji: "", joinedAt: "y" }] },
    });
    // Alex checks in first — no approval yet.
    const first = makePb({ taskPoints: 12, taskRow: row });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(first.pb));
    const res1 = await POST(jsonReq({ action: "crew-checkin", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res1.status).toBe(200);
    expect(first.updateCalls.tasks[0].pendingApproval).toBeNull();
    expect(first.updateCalls.tasks[0].crew.members.find((m: any) => m.name === "Alex").checkedInAt).toBeTruthy();

    // Bailey checks in last — the task flips to Crew pending with full points.
    mocks.verifyPinFromPB.mockResolvedValue({ id: "child-bailey", name: "Bailey Garcia", role: "child", emoji: "👧" });
    const second = makePb({
      taskPoints: 12,
      taskRow: crewTaskRow({
        crewSize: 2,
        crew: {
          members: [
            { name: "Alex", emoji: "", joinedAt: "x", checkedInAt: "t" },
            { name: "Bailey Garcia", emoji: "", joinedAt: "y" },
          ],
        },
      }),
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(second.pb));
    const res2 = await POST(jsonReq({ action: "crew-checkin", taskId: 42, memberName: "Bailey", pin: "1234" }));
    expect(res2.status).toBe(200);
    const patch = second.updateCalls.tasks[0];
    expect(patch.completed).toBe(true);
    expect(patch.pendingApproval).toMatchObject({ byName: "Crew", points: 12, crew: ["Alex", "Bailey Garcia"] });
    expect(patch.sentBackAt).toBeNull();
    // The snapshot mirror carries the same sentBackAt clear (parity).
    const snap = second.snapshotUpdates();
    const snapData = typeof snap?.data === "string" ? JSON.parse(snap.data) : snap?.data;
    const snapTask = (snapData?.tasks || []).find((x: any) => x.id === 42);
    expect(snapTask?.sentBackAt).toBeNull();
    // No points were moved by a check-in.
    expect(second.weekUpdates()).toBeNull();
  });

  it("crew-checkin rejects a member not in the crew", async () => {
    const row = crewTaskRow({ crew: { members: [{ name: "Lily", emoji: "", joinedAt: "x" }] } });
    const { pb } = makePb({ taskPoints: 5, taskRow: row });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "crew-checkin", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "not_in_crew" });
  });

  it("crew-remove is parent-gated and refuses a checked-in member", async () => {
    // Non-parent caller is rejected.
    mocks.verifyPinFromPB.mockResolvedValue({ id: "child-caspian", name: "Caspian Garcia", role: "child", emoji: "🧒" });
    const child = makePb({ taskPoints: 5, taskRow: crewTaskRow({ crew: { members: [] } }) });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(child.pb));
    const res1 = await POST(jsonReq({ action: "crew-remove", taskId: 42, memberName: "Caspian", pin: "1010", targetName: "Lily" }));
    expect(res1.status).toBe(403);
    expect(await res1.json()).toMatchObject({ reason: "adult_only" });

    // Parent can't remove someone who already checked in.
    mocks.verifyPinFromPB.mockResolvedValue({ id: "parent-rebecca", name: "Rebecca Garcia", role: "parent", emoji: "🐱" });
    const parent = makePb({
      taskPoints: 5,
      taskRow: crewTaskRow({ crew: { members: [{ name: "Lily", emoji: "", joinedAt: "y", checkedInAt: "t" }] } }),
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(parent.pb));
    const res2 = await POST(jsonReq({ action: "crew-remove", taskId: 42, memberName: "Rebecca", pin: "1234", targetName: "Lily" }));
    expect(res2.status).toBe(409);
    expect(await res2.json()).toMatchObject({ reason: "member_checked_in" });

    // Parent removes a non-checked-in member successfully.
    const parent2 = makePb({
      taskPoints: 5,
      taskRow: crewTaskRow({
        crew: { members: [{ name: "Lily", emoji: "", joinedAt: "y" }, { name: "Bailey", emoji: "", joinedAt: "z" }] },
      }),
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(parent2.pb));
    const res3 = await POST(jsonReq({ action: "crew-remove", taskId: 42, memberName: "Rebecca", pin: "1234", targetName: "Lily" }));
    expect(res3.status).toBe(200);
    expect(parent2.updateCalls.tasks[0].crew.members.map((m: any) => m.name)).toEqual(["Bailey Garcia"]);
  });
});

describe("POST /api/tasks/claim — server-authoritative assigned completions", () => {
  // The kitchen display is usually a GUEST (30-min auto-logout) — assigned-task
  // completions must be server-authoritative like claims, or an earn lands on
  // one device's localStorage and never propagates.
  beforeEach(() => {
    mocks.verifyPinFromPB.mockResolvedValue({ id: "parent-alex", name: "Alex", role: "parent", emoji: "🦊" });
  });

  it("complete: adult earns instantly and BOTH stores are written (week_data + snapshot)", async () => {
    const { pb, weekUpdates, snapshotUpdates, updateCalls } = makePb({
      taskPoints: 8,
      taskRow: { universal: false, completed: false, assignee: "Alex" },
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "complete", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(await res.json()).toMatchObject({ success: true });
    expect(res.status).toBe(200);
    const written = weekUpdates();
    expect(written.points["Alex"]).toBe(8);
    expect(written.history[0]).toMatchObject({ type: "earn", amount: 8, taskId: 42 });
    expect(written.history[0].description).toMatch(/^Completed:/);
    // Task row flipped done.
    expect(updateCalls.tasks.some((p: any) => p.completed === true)).toBe(true);
    // The snapshot the dashboard READS carries the earn too.
    const snap = snapshotUpdates();
    const data = typeof snap.data === "string" ? JSON.parse(snap.data) : snap.data;
    expect(data.weekData.points["Alex"]).toBe(8);
  });

  it("complete: child lands pendingApproval — no points move, snapshot mirrors the row", async () => {
    mocks.verifyPinFromPB.mockResolvedValue({ id: "child-caspian", name: "Caspian Garcia", role: "child", emoji: "🧒" });
    const { pb, weekUpdates, snapshotUpdates, updateCalls } = makePb({
      taskPoints: 6,
      taskRow: { universal: false, completed: false, assignee: "Caspian Garcia" },
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "complete", taskId: 42, memberName: "Caspian", pin: "1010" }));

    expect(res.status).toBe(200);
    expect((await res.json()).pending).toBe(true);
    expect(weekUpdates()).toBeNull(); // zero points moved
    const patch = updateCalls.tasks.find((p: any) => p.pendingApproval);
    expect(patch.pendingApproval).toMatchObject({ byName: "Caspian Garcia", points: 6 });
    const snap = snapshotUpdates();
    const data = typeof snap.data === "string" ? JSON.parse(snap.data) : snap.data;
    const snapTask = (data.tasks || []).find((t: any) => t.id === 42);
    expect(snapTask.pendingApproval).toMatchObject({ byName: "Caspian Garcia" });
    // SNAPSHOT PARITY (2026-09-23 review): the completeTask path clears the
    // stale send-back stamp on the snapshot row too.
    expect(snapTask.sentBackAt).toBeNull();
  });

  it("complete rejects universal tasks (they go through claim) and crew tasks", async () => {
    const uni = makePb({ taskPoints: 5, taskRow: { universal: true } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(uni.pb));
    const res1 = await POST(jsonReq({ action: "complete", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res1.status).toBe(400);
    expect(await res1.json()).toMatchObject({ reason: "not_assigned" });

    const crew = makePb({ taskPoints: 5, taskRow: { universal: false, crewSize: 2, crew: { members: [] } } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(crew.pb));
    const res2 = await POST(jsonReq({ action: "complete", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res2.status).toBe(400);
    expect(await res2.json()).toMatchObject({ reason: "crew_task" });
  });

  it("complete is idempotent within the week: an existing unreversed earn → 409", async () => {
    const monday = mondayISO();
    const seededHistory = JSON.stringify([
      { id: 1, timestamp: "2026-09-18T10:00:00.000Z", member: "Alex", type: "earn", amount: 5, description: "Completed: Dishes (+5pts)", taskId: 42 },
    ]);
    const { pb } = makePb({
      taskPoints: 5,
      taskRow: { universal: false, completed: true, completedInWeek: monday },
      weekHistory: seededHistory,
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "complete", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(["already_completed", "already-claimed"]).toContain(body.reason);
  });

  it("undo: reverses the earn server-side (adjust -N, points reduced, row reopened, snapshot updated)", async () => {
    const monday = mondayISO();
    const seededHistory = JSON.stringify([
      { id: 1, timestamp: "2026-09-18T10:00:00.000Z", member: "Alex", type: "earn", amount: 8, description: "Completed: Dishes (+8pts)", taskId: 42 },
    ]);
    const { pb, updateCalls, snapshotUpdates } = makePb({
      taskPoints: 8,
      taskRow: { universal: false, completed: true, completedBy: "Alex", completedAt: "2026-09-18T10:00:00.000Z", completedInWeek: monday, assignee: "Alex" },
      weekHistory: seededHistory,
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "undo", taskId: 42, memberName: "Alex", pin: "1234" }));

    expect(res.status).toBe(200);
    // The week write carried the adjust tx and reduced points.
    const weekWrite = updateCalls.week_data?.[0];
    expect(weekWrite).toBeTruthy();
    expect(weekWrite.points["Alex"]).toBe(0);
    expect(weekWrite.history.some((t: any) => t.type === "adjust" && t.amount === -8)).toBe(true);
    // The snapshot the UI reads shows the reversal too.
    const snap = snapshotUpdates();
    const data = typeof snap.data === "string" ? JSON.parse(snap.data) : snap.data;
    const adj = (data.weekData.history || []).find((t: any) => t.type === "adjust" && t.amount === -8);
    expect(adj).toBeTruthy();
    expect(data.weekData.points["Alex"]).toBe(0);
    // Task row reopened.
    const reopenPatch = updateCalls.tasks.find((p: any) => p.completed === false);
    expect(reopenPatch).toBeTruthy();
  });

  // Task 10 B1: a session-only undo is a KID'S self-cancel of their own
  // pending tap. A paid undo (one that reverses real points) is a different,
  // more dangerous command and must never be reachable without the member PIN.
  describe("session-only undo is a child self-cancel, never a paid undo", () => {
    const pendingRow = {
      universal: false,
      completed: true,
      status: "done",
      completedBy: "Caspian Garcia",
      completedInWeek: mondayISO(),
      pendingApproval: { byName: "Caspian Garcia", at: "2026-09-19T18:00:00.000Z", points: 5 },
    };
    const paidRow = (completedBy: string) => ({
      universal: false,
      completed: true,
      status: "done",
      completedBy,
      completedInWeek: mondayISO(),
      assignee: completedBy,
    });
    const paidHistory = (member: string) => JSON.stringify([
      {
        id: 1,
        timestamp: "2026-09-18T10:00:00.000Z",
        member,
        type: "earn",
        amount: 8,
        description: "Completed: Dishes (+8pts)",
        taskId: 42,
      },
    ]);

    it("a child's session self-cancel of their OWN pending tap reopens with no PIN", async () => {
      const { pb, updateCalls } = makePb({ taskPoints: 5, taskRow: pendingRow });
      mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
      mocks.verifySession.mockResolvedValue({ memberId: "child-caspian", name: "Caspian Garcia", role: "child" });

      const res = await POST(
        jsonReq({ action: "undo", taskId: 42, memberName: "Caspian Garcia" }, "session-caspian"),
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ success: true, action: "undo" });
      // A session self-cancel never touches the ledger: no points existed yet.
      expect(updateCalls.week_data ?? []).toHaveLength(0);
      expect(updateCalls.tasks.some((patch: any) => patch.completed === false)).toBe(true);
      expect(mocks.verifyPinFromPB).not.toHaveBeenCalled();
    });

    it("a PARENT paid undo with authentication session and no PIN is refused", async () => {
      const { pb, updateCalls, weekUpdates } = makePb({
        taskPoints: 8,
        taskRow: paidRow("Alex"),
        weekHistory: paidHistory("Alex"),
      });
      mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
      mocks.verifySession.mockResolvedValue({ memberId: "parent-alex", name: "Alex", role: "parent" });

      const res = await POST(
        jsonReq({ action: "undo", taskId: 42, memberName: "Alex" }, "session-alex"),
      );

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toMatchObject({ success: false, reason: "pin_required" });
      // No ledger write, no row reopen: nothing moved.
      expect(weekUpdates()).toBeNull();
      expect(updateCalls.tasks).toHaveLength(0);
    });

    it("a CHILD paid undo with authentication session and no PIN is refused", async () => {
      // Bailey is 12: a paid reversal is a real point movement, so it needs a
      // PIN even from the kid's own session.
      const { pb, updateCalls, weekUpdates } = makePb({
        taskPoints: 8,
        taskRow: paidRow("Bailey Garcia"),
        weekHistory: paidHistory("Bailey Garcia"),
      });
      mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
      mocks.verifySession.mockResolvedValue({ memberId: "child-bailey", name: "Bailey Garcia", role: "child" });

      const res = await POST(
        jsonReq({ action: "undo", taskId: 42, memberName: "Bailey Garcia" }, "session-bailey"),
      );

      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ success: false, reason: "pin_required" });
      expect(weekUpdates()).toBeNull();
      expect(updateCalls.tasks).toHaveLength(0);
    });

    it("a session undo of ANOTHER kid's pending tap is refused", async () => {
      const { pb, updateCalls } = makePb({ taskPoints: 5, taskRow: pendingRow });
      mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
      mocks.verifySession.mockResolvedValue({ memberId: "child-bailey", name: "Bailey Garcia", role: "child" });

      const res = await POST(
        jsonReq({ action: "undo", taskId: 42, memberName: "Caspian Garcia" }, "session-bailey"),
      );

      // The session actor is Bailey but the body names Caspian: the route
      // refuses the mismatch before any write.
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ success: false, reason: "unknown_actor" });
      expect(updateCalls.tasks).toHaveLength(0);
    });

    it("a paid undo WITH the member PIN still works (the PIN path is untouched)", async () => {
      const { pb, updateCalls } = makePb({
        taskPoints: 8,
        taskRow: paidRow("Alex"),
        weekHistory: paidHistory("Alex"),
      });
      mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

      const res = await POST(
        jsonReq({ action: "undo", taskId: 42, memberName: "Alex", pin: "1234" }),
      );

      expect(res.status).toBe(200);
      expect(updateCalls.week_data?.[0]?.history.some((t: any) => t.type === "adjust" && t.amount === -8)).toBe(true);
    });
  });

  it("pending undo (unpaid kid tap) stamps sentBackAt on BOTH the collection row and the snapshot", async () => {
    const { pb, updateCalls, snapshotUpdates } = makePb({
      taskPoints: 5,
      taskRow: {
        universal: false,
        completed: true,
        status: "done",
        completedBy: "Caspian Garcia",
        completedInWeek: mondayISO(),
        pendingApproval: { byName: "Caspian Garcia", at: "2026-09-19T18:00:00.000Z", points: 5 },
        sentBackAt: "2026-09-19T17:00:00.000Z",
      },
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "undo", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res.status).toBe(200);

    const coll = updateCalls.tasks.find((p: any) => p.completed === false);
    expect(coll).toBeTruthy();
    expect(typeof coll.sentBackAt).toBe("string");
    expect(coll.sentBackAt).not.toBe("2026-09-19T17:00:00.000Z");

    const snap = snapshotUpdates();
    expect(snap).toBeTruthy();
    const data = typeof snap.data === "string" ? JSON.parse(snap.data) : snap.data;
    const t = (data.tasks || []).find((x: any) => x.id === 42);
    expect(t.completed).toBe(false);
    expect(typeof t.sentBackAt).toBe("string");
    expect(t.sentBackAt).not.toBe("2026-09-19T17:00:00.000Z");
  });

  it("undo with nothing to undo → 409, and a reversed earn → 409 already_undone", async () => {
    const monday = mondayISO();
    const noEarn = makePb({ taskPoints: 5, taskRow: { universal: false, completed: true, completedBy: "Alex", completedInWeek: monday } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(noEarn.pb));
    const res1 = await POST(jsonReq({ action: "undo", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res1.status).toBe(409);
    expect(await res1.json()).toMatchObject({ reason: "nothing_to_undo" });

    const seededHistory = JSON.stringify([
      { id: 1, timestamp: "2026-09-18T10:00:00.000Z", member: "Alex", type: "earn", amount: 5, description: "x", taskId: 42 },
      { id: 2, timestamp: "2026-09-18T12:00:00.000Z", member: "Alex", type: "adjust", amount: -5, description: "Undo", taskId: 42 },
    ]);
    const undone = makePb({ taskPoints: 5, taskRow: { universal: false, completed: false }, weekHistory: seededHistory });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(undone.pb));
    const res2 = await POST(jsonReq({ action: "undo", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res2.status).toBe(409);
    expect(await res2.json()).toMatchObject({ reason: "already_undone" });
  });
});

describe("POST /api/tasks/claim — snapshot authority and replay", () => {
  it("serializes competing claims so one task cannot pay twice", async () => {
    const task = { id: 75, title: "Race", assignee: "Open", points: 5, universal: true, completed: false };
    const { pb, updateCalls } = makePb({ taskPoints: 5, taskRow: task, snapshotTasks: [task] });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const [firstResponse, secondResponse] = await Promise.all([
      POST(jsonReq({ action: "claim", operationId: "op-race-a", taskId: 75, memberName: "Alex", pin: "1234" })),
      POST(jsonReq({ action: "claim", operationId: "op-race-b", taskId: 75, memberName: "Alex", pin: "1234" })),
    ]);
    const winner = firstResponse.status === 200 ? firstResponse : secondResponse;
    const loser = firstResponse.status === 200 ? secondResponse : firstResponse;

    expect([firstResponse.status, secondResponse.status].sort()).toEqual([200, 409]);
    expect(updateCalls.week_data).toHaveLength(1);
    expect((await loser.json()).claimedBy).toBe((await winner.json()).claimedBy);
  });

  it("uses PB only when the snapshot has no live task and no tombstone", async () => {
    const task = { id: 73, title: "Fallback", assignee: "Open", points: 4, universal: true, completed: false };
    const { pb, snapshotData, weekUpdates } = makePb({
      taskPoints: 4,
      taskRows: [{ ...task, taskId: 73 }],
      snapshotTasks: [],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const response = await POST(jsonReq({
      action: "claim",
      operationId: "op-pb-fallback",
      taskId: 73,
      memberName: "Alex",
      pin: "1234",
    }));

    expect(response.status).toBe(200);
    expect(weekUpdates().history).toHaveLength(1);
    expect(snapshotData().tasks.find((row: any) => row.id === 73)).toMatchObject({
      completed: true,
      assignee: "Alex",
    });
  });

  it("uses the snapshot assignee for ownership", async () => {
    const snapshotTask = {
      id: 42,
      title: "Dishes",
      assignee: "Caspian Garcia",
      points: 7,
      universal: false,
      completed: false,
    };
    const { pb, updateCalls } = makePb({
      taskPoints: 1,
      taskRow: { universal: false, completed: false, assignee: "Alex" },
      snapshotTasks: [snapshotTask],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const response = await POST(jsonReq({
      action: "complete",
      operationId: "op-complete-owner",
      taskId: 42,
      memberName: "Alex",
      pin: "1234",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ reason: "not_task_owner" });
    expect(updateCalls.week_data).toBeUndefined();
  });

  it("allows only the matching child session to clear a pending row", async () => {
    const task = {
      id: 55,
      title: "Trash",
      assignee: "Caspian Garcia",
      points: 5,
      universal: false,
      completed: true,
      status: "done",
      completedBy: "Caspian Garcia",
      completedInWeek: mondayISO(),
      pendingApproval: { byName: "Caspian Garcia", at: "2026-09-24T10:00:00.000Z", points: 5 },
    };
    mocks.verifySession.mockImplementation(async (token?: string) =>
      token === "member-a"
        ? { role: "child", name: "Caspian", memberId: "child-caspian" }
        : { role: "child", name: "Bailey", memberId: "child-bailey" }
    );

    // Each attempt reads a fresh still-pending row, so the second refusal is
    // about WHO is asking (not about the row having been reopened).
    const firstPb = makePb({ taskPoints: 5, taskRow: task, snapshotTasks: [task] });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(firstPb.pb));
    const first = await POST(jsonReq({
      action: "undo",
      operationId: "op-undo-a",
      taskId: 55,
    }, "member-a"));

    const secondPb = makePb({ taskPoints: 5, taskRow: task, snapshotTasks: [task] });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(secondPb.pb));
    const second = await POST(jsonReq({
      action: "undo",
      operationId: "op-undo-b",
      taskId: 55,
    }, "member-b"));

    expect(first.status).toBe(200);
    expect(second.status).toBe(403);
    expect(firstPb.updateCalls.week_data).toBeUndefined();
    expect(secondPb.updateCalls.tasks).toHaveLength(0);
  });

  it("rejects removed crew names and preserves tombstones", async () => {
    const task = {
      id: 60,
      title: "Wash the van",
      assignee: "Crew",
      points: 10,
      universal: false,
      completed: false,
      crewSize: 3,
      crew: {
        members: [{ name: "Bailey Garcia", emoji: "👧", joinedAt: "2026-09-24T09:00:00.000Z" }],
        removed: ["Caspian Garcia"],
      },
    };
    const { pb, snapshotData } = makePb({ taskPoints: 10, taskRow: task, snapshotTasks: [task] });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const rejected = await POST(jsonReq({
      action: "crew-join",
      operationId: "op-join-removed",
      taskId: 60,
      memberName: "Caspian",
      pin: "1010",
    }));
    const removed = await POST(jsonReq({
      action: "crew-remove",
      operationId: "op-remove-1",
      taskId: 60,
      targetName: "Bailey",
      memberName: "Alex",
      pin: "1234",
    }));

    expect(rejected.status).toBe(403);
    expect(removed.status).toBe(200);
    expect(snapshotData().tasks[0].crew.removed).toContain("Caspian Garcia");
  });

  it("rejects malformed JSON before authentication or PB reads", async () => {
    const response = await POST(rawReq("{"));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: "invalid_body" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, "42", null])("rejects invalid task id %s before PB reads", async (taskId) => {
    const { pb, taskCollectionReads } = makePb();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const response = await POST(jsonReq({
      action: "claim",
      operationId: `op-invalid-${String(taskId)}`,
      taskId,
      memberName: "Alex",
      pin: "1234",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: "invalid_task_id" });
    expect(taskCollectionReads()).toBe(0);
  });

  it("rejects authority fields in the HTTP payload", async () => {
    const { pb, updateCalls } = makePb();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const response = await POST(jsonReq({
      action: "claim",
      operationId: "op-authority-bypass",
      taskId: 42,
      memberName: "Alex",
      pin: "1234",
      role: "parent",
      points: 999,
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: "forbidden_claim_payload" });
    expect(updateCalls.week_data).toBeUndefined();
  });

  it("never falls back to PB for a tombstoned task id", async () => {
    const { pb, taskCollectionReads, updateCalls } = makePb({
      taskPoints: 5,
      snapshotTasks: [],
      deletedTaskIds: [42],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const response = await POST(jsonReq({
      action: "claim",
      operationId: "op-tombstoned-claim",
      taskId: 42,
      memberName: "Alex",
      pin: "1234",
    }));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ reason: "unknown_task" });
    expect(taskCollectionReads()).toBe(0);
    expect(updateCalls.week_data).toBeUndefined();
  });

  it("rejects a reused operation ID with a different target", async () => {
    const task = {
      id: 74,
      title: "Crew",
      assignee: "Crew",
      points: 1,
      universal: false,
      completed: false,
      crewSize: 3,
      crew: {
        members: [
          { name: "Emily Garcia", emoji: "", joinedAt: "x" },
          { name: "Bailey Garcia", emoji: "", joinedAt: "x" },
        ],
      },
    };
    const { pb, updateCalls } = makePb({ taskPoints: 1, taskRow: task, snapshotTasks: [task] });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    const first = await POST(jsonReq({
      action: "crew-remove",
      operationId: "op-remove-conflict",
      taskId: 74,
      targetName: "Emily Garcia",
      memberName: "Alex",
      pin: "1234",
    }));
    const before = updateCalls.tasks.length;
    const second = await POST(jsonReq({
      action: "crew-remove",
      operationId: "op-remove-conflict",
      taskId: 74,
      targetName: "Bailey Garcia",
      memberName: "Alex",
      pin: "1234",
    }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ reason: "operation_conflict" });
    expect(updateCalls.tasks).toHaveLength(before);
  });

  it("returns 202 after ledger success when projection fails and repairs the same operation without replaying points", async () => {
    const task = { id: 70, title: "Race", assignee: "Open", points: 5, universal: true, completed: false };
    const { pb, updateCalls, weekUpdates } = makePb({
      taskPoints: 5,
      taskRow: task,
      snapshotTasks: [task],
      failTaskWrite: true,
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    const body = {
      action: "claim",
      operationId: "op-projection-retry",
      taskId: 70,
      memberName: "Alex",
      pin: "1234",
    };

    const first = await POST(jsonReq(body));
    const firstBody = await first.json();
    const second = await POST(jsonReq(body));
    const secondBody = await second.json();

    expect(first.status).toBe(202);
    expect(firstBody).toMatchObject({ success: true, reconciled: false, operationId: body.operationId });
    expect(second.status).toBe(200);
    expect(secondBody).toMatchObject({ success: true, reconciled: true });
    expect(updateCalls.week_data).toHaveLength(1);
    expect(weekUpdates().history).toHaveLength(1);
  });

  it("repairs a failed snapshot week projection on the same ledger operation", async () => {
    const task = { id: 71, title: "Race", assignee: "Open", points: 5, universal: true, completed: false };
    const { pb, updateCalls, weekUpdates, snapshotData } = makePb({
      taskPoints: 5,
      taskRow: task,
      snapshotTasks: [task],
      failSnapshotWriteAfter: 2,
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    const body = {
      action: "claim",
      operationId: "op-snapshot-week-retry",
      taskId: 71,
      memberName: "Alex",
      pin: "1234",
    };

    const first = await POST(jsonReq(body));
    const second = await POST(jsonReq(body));

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(updateCalls.week_data).toHaveLength(1);
    expect(weekUpdates().history).toHaveLength(1);
    expect(snapshotData().weekData.history).toHaveLength(1);
  });

  it("reopens a zero-point completed task with a zero adjustment", async () => {
    const task = {
      id: 76,
      title: "Nothing",
      assignee: "Alex",
      points: 0,
      universal: false,
      completed: true,
      status: "done",
      completedBy: "Alex",
      completedInWeek: mondayISO(),
    };
    const { pb, weekUpdates, snapshotData } = makePb({
      taskPoints: 0,
      taskRow: task,
      snapshotTasks: [task],
      weekHistory: JSON.stringify([{
        id: 1,
        timestamp: "2026-09-21T10:00:00.000Z",
        member: "Alex",
        type: "earn",
        amount: 0,
        description: "Completed: Nothing (+0pts)",
        taskId: 76,
      }]),
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const response = await POST(jsonReq({
      action: "undo",
      operationId: "op-zero-undo",
      taskId: 76,
      memberName: "Alex",
      pin: "1234",
    }));

    expect(response.status).toBe(200);
    expect(weekUpdates().history).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "adjust", amount: 0, taskId: 76 }),
    ]));
    expect(snapshotData().tasks[0]).toMatchObject({ completed: false, status: "pending" });
  });

  it("clears checked-in state on a paid crew undo", async () => {
    const task = {
      id: 86,
      title: "Crew",
      assignee: "Crew",
      points: 5,
      universal: false,
      completed: true,
      status: "done",
      completedBy: "Alex",
      completedInWeek: mondayISO(),
      crewSize: 2,
      crew: {
        members: [
          { name: "Alex", emoji: "", joinedAt: "join-a", checkedInAt: "check-a" },
          { name: "Bailey Garcia", emoji: "", joinedAt: "join-b", checkedInAt: "check-b" },
        ],
        removed: ["Former"],
      },
    };
    const { pb, weekUpdates, snapshotData } = makePb({
      taskPoints: 5,
      taskRow: task,
      snapshotTasks: [task],
      weekHistory: JSON.stringify([{
        id: 1,
        timestamp: "2026-09-21T10:00:00.000Z",
        member: "Alex",
        type: "earn",
        amount: 5,
        description: "Completed: Crew (+5pts)",
        taskId: 86,
      }]),
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const response = await POST(jsonReq({
      action: "undo",
      operationId: "op-paid-crew-undo-reset",
      taskId: 86,
      memberName: "Alex",
      pin: "1234",
    }));

    expect(response.status).toBe(200);
    expect(weekUpdates().history.some((entry: any) => entry.type === "adjust" && entry.amount === -5)).toBe(true);
    expect(snapshotData().tasks[0].crew).toEqual({
      members: [
        { name: "Alex", emoji: "", joinedAt: "join-a" },
        { name: "Bailey Garcia", emoji: "", joinedAt: "join-b" },
      ],
      removed: ["Former"],
    });
  });

  it("clears crew check-ins on pending undo while preserving members and tombstones", async () => {
    const task = {
      id: 77,
      title: "Crew",
      assignee: "Crew",
      points: 5,
      universal: false,
      completed: true,
      status: "done",
      completedBy: "Crew",
      completedInWeek: mondayISO(),
      crewSize: 2,
      crew: {
        members: [
          { name: "Caspian Garcia", emoji: "🧒", joinedAt: "join-a", checkedInAt: "check-a" },
          { name: "Bailey Garcia", emoji: "👧", joinedAt: "join-b", checkedInAt: "check-b" },
        ],
        removed: ["Former Member"],
      },
      pendingApproval: { byName: "Crew", at: "2026-09-24T10:00:00.000Z", points: 5, crew: ["Caspian Garcia", "Bailey Garcia"] },
    };
    const { pb, snapshotData } = makePb({ taskPoints: 5, taskRow: task, snapshotTasks: [task] });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const response = await POST(jsonReq({
      action: "undo",
      operationId: "op-crew-undo-reset",
      taskId: 77,
      memberName: "Alex",
      pin: "1234",
    }));

    expect(response.status).toBe(200);
    const crew = snapshotData().tasks[0].crew;
    expect(crew.members).toEqual([
      { name: "Caspian Garcia", emoji: "🧒", joinedAt: "join-a" },
      { name: "Bailey Garcia", emoji: "👧", joinedAt: "join-b" },
    ]);
    expect(crew.removed).toEqual(["Former Member"]);
  });

  it("replays a ledger operation after points change without charging the new amount", async () => {
    const task = { id: 78, title: "Race", assignee: "Open", points: 5, universal: true, completed: false };
    const { pb, weekUpdates, snapshotData, updateSnapshotTask } = makePb({
      taskPoints: 5,
      taskRow: task,
      snapshotTasks: [task],
      failSnapshotWriteAfter: 1,
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    const body = {
      action: "claim",
      operationId: "op-ledger-replay-points",
      taskId: 78,
      memberName: "Alex",
      pin: "1234",
    };

    const first = await POST(jsonReq(body));
    updateSnapshotTask(78, { points: 9, title: "Managed title", assignee: "Bailey Garcia" });
    const second = await POST(jsonReq(body));

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect((await second.json()).task).toMatchObject({
      title: "Managed title",
      assignee: "Bailey Garcia",
      completed: true,
    });
    expect(weekUpdates().history).toHaveLength(1);
    expect(weekUpdates().history[0].amount).toBe(5);
    expect(snapshotData().tasks.find((row: any) => row.id === 78)).toMatchObject({
      title: "Managed title",
      assignee: "Bailey Garcia",
      completed: true,
    });
  });

  it("keeps a reversed historical claim replay from re-completing the current row", async () => {
    const task = { id: 83, title: "Race", assignee: "Open", points: 5, universal: true, completed: false };
    const { pb, weekUpdates, updateSnapshotTask, updateWeekHistory, snapshotData } = makePb({
      taskPoints: 5,
      taskRow: task,
      snapshotTasks: [task],
      failSnapshotWriteAfter: 1,
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    const body = {
      action: "claim",
      operationId: "op-reversed-claim-replay",
      taskId: 83,
      memberName: "Alex",
      pin: "1234",
    };

    const first = await POST(jsonReq(body));
    updateSnapshotTask(83, { completed: false, status: "pending", completedBy: "" });
    updateWeekHistory([
      ...weekUpdates().history,
      { id: 900, timestamp: "2099-01-01T00:00:00.000Z", member: "Alex", type: "adjust", amount: -5, description: "Later reversal", taskId: 83 },
    ]);
    const second = await POST(jsonReq(body));

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect((await second.json()).task).toMatchObject({ completed: false, status: "pending" });
    expect(snapshotData().tasks[0]).toMatchObject({ completed: false, status: "pending" });
  });

  it("keeps a superseded undo replay from reopening the current row", async () => {
    const task = {
      id: 84,
      title: "Crew",
      assignee: "Crew",
      points: 5,
      universal: false,
      completed: true,
      status: "done",
      completedBy: "Alex",
      completedInWeek: mondayISO(),
      crewSize: 2,
      crew: {
        members: [{ name: "Alex", emoji: "", joinedAt: "join", checkedInAt: "check" }],
        removed: ["Former"],
      },
    };
    const { pb, weekUpdates, updateSnapshotTask, updateWeekHistory, snapshotData } = makePb({
      taskPoints: 5,
      taskRow: task,
      snapshotTasks: [task],
      weekHistory: JSON.stringify([{
        id: 1,
        timestamp: "2026-09-21T10:00:00.000Z",
        member: "Alex",
        type: "earn",
        amount: 5,
        description: "Completed: Crew (+5pts)",
        taskId: 84,
      }]),
      failSnapshotWriteAfter: 1,
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    const body = {
      action: "undo",
      operationId: "op-superseded-undo-replay",
      taskId: 84,
      memberName: "Alex",
      pin: "1234",
    };

    const first = await POST(jsonReq(body));
    updateSnapshotTask(84, { completed: true, status: "done", completedBy: "Alex" });
    updateWeekHistory([
      ...weekUpdates().history,
      { id: 901, timestamp: "2099-01-01T00:00:00.000Z", member: "Alex", type: "earn", amount: 5, description: "Re-earned", taskId: 84 },
    ]);
    const second = await POST(jsonReq(body));

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect((await second.json()).task).toMatchObject({ completed: true, status: "done" });
    expect(snapshotData().tasks[0]).toMatchObject({ completed: true, status: "done" });
  });

  it("acknowledges a retry after the same child member is demoted", async () => {
    const task = { id: 85, title: "Dishes", assignee: "Caspian Garcia", points: 5, universal: false, completed: false };
    const { pb } = makePb({
      taskPoints: 5,
      taskRow: task,
      snapshotTasks: [task],
      failTaskWrite: true,
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    mocks.verifyPinFromPB.mockResolvedValue({ id: "child-caspian", name: "Caspian Garcia", role: "child" });
    const body = {
      action: "complete",
      operationId: "op-demoted-child-retry",
      taskId: 85,
      memberName: "Caspian Garcia",
      pin: "1234",
    };

    const first = await POST(jsonReq(body));
    const roster = defaultLiveMembers.map((member) =>
      member.id === "child-caspian" ? { ...member, role: "parent" } : member
    );
    mocks.getLiveMembers.mockResolvedValue(roster);
    mocks.getLiveMemberById.mockImplementation(async (id: string) => roster.find((member) => member.id === id) ?? null);
    mocks.verifyPinFromPB.mockResolvedValue({ id: "child-caspian", name: "Caspian Garcia", role: "parent" });
    const second = await POST(jsonReq(body));

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect((await second.json()).duplicate).toBe(true);
  });

  it("acknowledges a ledger operation after a later tombstone without recreating the task", async () => {
    const task = { id: 79, title: "Race", assignee: "Open", points: 5, universal: true, completed: false };
    const { pb, tombstoneSnapshotTask, snapshotData } = makePb({
      taskPoints: 5,
      taskRow: task,
      snapshotTasks: [task],
      failSnapshotWriteAfter: 1,
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    const body = {
      action: "claim",
      operationId: "op-ledger-replay-tombstone",
      taskId: 79,
      memberName: "Alex",
      pin: "1234",
    };

    const first = await POST(jsonReq(body));
    tombstoneSnapshotTask(79);
    const second = await POST(jsonReq(body));

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(snapshotData().tasks.some((row: any) => row.id === 79)).toBe(false);
  });

  it("maps a stable insufficient-balance ledger result to conflict", async () => {
    const task = { id: 81, title: "Race", assignee: "Open", points: 5, universal: true, completed: false };
    const { pb, updateCalls } = makePb({
      taskPoints: 5,
      taskRow: task,
      snapshotTasks: [task],
      weekHistory: JSON.stringify([
        { id: 1, timestamp: "2026-09-21T09:00:00.000Z", member: "Sam", type: "adjust", amount: -1, description: "Legacy negative" },
      ]),
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const response = await POST(jsonReq({
      action: "claim",
      operationId: "op-insufficient-claim",
      taskId: 81,
      memberName: "Alex",
      pin: "1234",
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: "insufficient_balance" });
    expect(updateCalls.week_data).toBeUndefined();
  });

  it("keeps the authority week stable when a request crosses Monday", async () => {
    vi.useFakeTimers();
    const beforeMonday = new Date("2026-09-20T23:59:59.000Z");
    const afterMonday = new Date("2026-09-21T05:00:01.000Z");
    vi.setSystemTime(beforeMonday);
    const authorityWeek = localWeekStartISO();
    let releaseRead!: () => void;
    let readStarted!: () => void;
    const gate = new Promise<void>((resolve) => { releaseRead = resolve; });
    const started = new Promise<void>((resolve) => { readStarted = resolve; });
    const task = { id: 87, title: "Race", assignee: "Open", points: 5, universal: true, completed: false };
    const { pb, updateCalls } = makePb({
      taskPoints: 5,
      taskRow: task,
      snapshotTasks: [task],
      snapshotReadStarted: readStarted,
      snapshotReadGate: gate,
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    try {
      const response = POST(jsonReq({
        action: "claim",
        operationId: "op-monday-boundary",
        taskId: 87,
        memberName: "Alex",
        pin: "1234",
      }));
      await started;
      vi.setSystemTime(afterMonday);
      releaseRead();
      const result = await response;

      expect(result.status).toBe(200);
      const weekWrites = updateCalls.week_data ?? [];
      expect(weekWrites[0].weekStart).toBe(authorityWeek);
      expect(weekWrites[0].weekStart).not.toBe(localWeekStartISO());
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a stale assigned precheck pay after manage reassigns the task", async () => {
    let releaseRead!: () => void;
    let readStarted!: () => void;
    const gate = new Promise<void>((resolve) => { releaseRead = resolve; });
    const started = new Promise<void>((resolve) => { readStarted = resolve; });
    const task = { id: 82, title: "Dishes", assignee: "Alex", points: 5, universal: false, completed: false };
    const { pb, updateCalls } = makePb({
      taskPoints: 5,
      taskRow: task,
      snapshotTasks: [task],
      snapshotReadStarted: readStarted,
      snapshotReadGate: gate,
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    const manage = executeInternalTaskCommand({
      operationId: "op-manage-race",
      kind: "update",
      actor: { memberId: "parent-alex", name: "Alex", role: "parent" },
      payload: taskManageInternalPayload({
        action: "update",
        operationId: "op-manage-race",
        taskId: 82,
        patch: { assignee: "Bailey Garcia" },
      }),
    }, { source: "server" });
    await started;
    const claim = POST(jsonReq({
      action: "complete",
      operationId: "op-stale-claim-race",
      taskId: 82,
      memberName: "Alex",
      pin: "1234",
    }));
    releaseRead();
    const [manageResult, claimResponse] = await Promise.all([manage, claim]);

    expect(manageResult.ok).toBe(true);
    expect(claimResponse.status).toBe(403);
    expect(updateCalls.week_data).toBeUndefined();
  });

  it("rejects no-PIN open claims and no-PIN crew removal", async () => {
    const task = { id: 80, title: "Open task", assignee: "Open", points: 5, universal: true, completed: false };
    const { pb, updateCalls } = makePb({ taskPoints: 5, taskRow: task, snapshotTasks: [task] });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    mocks.verifySession.mockResolvedValue({ role: "child", name: "Caspian", memberId: "child-caspian" });

    const claim = await POST(jsonReq({
      action: "claim",
      operationId: "op-open-session",
      taskId: 80,
    }, "child-session"));
    const remove = await POST(jsonReq({
      action: "crew-remove",
      operationId: "op-remove-session",
      taskId: 80,
      targetName: "Bailey",
    }, "child-session"));

    expect(claim.status).toBe(401);
    expect(remove.status).toBe(401);
    expect(updateCalls.week_data).toBeUndefined();
  });

  it("fails closed on ambiguous canonical assignee names", async () => {
    const task = { id: 90, title: "Dishes", assignee: "Alex Child", points: 5, universal: false, completed: false };
    const { pb, updateCalls } = makePb({ taskPoints: 5, taskRow: task, snapshotTasks: [task] });
    mocks.getLiveMembers.mockResolvedValue([
      { id: "child-a", name: "Alex Child", role: "child", age: 5 },
      { id: "child-b", name: "Alex Child", role: "child", age: 6 },
    ]);
    mocks.getLiveMemberById.mockImplementation(async (id: string) => ({
      id,
      name: "Alex Child",
      role: "child",
      age: 5,
    }));
    mocks.verifyPinFromPB.mockResolvedValue({ id: "child-a", name: "Alex Child", role: "child", age: 5 });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const response = await POST(jsonReq({
      action: "complete",
      operationId: "op-ambiguous-owner",
      taskId: 90,
      memberName: "Alex Child",
      pin: "1234",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ reason: "unknown_actor" });
    expect(updateCalls.week_data).toBeUndefined();
  });

  it("rejects an ambiguous first-name PIN identity even when the live ID is known", async () => {
    const task = { id: 91, title: "Dishes", assignee: "Alex Child", points: 5, universal: false, completed: false };
    const { pb, updateCalls } = makePb({ taskPoints: 5, taskRow: task, snapshotTasks: [task] });
    mocks.getLiveMembers.mockResolvedValue([
      { id: "child-a", name: "Alex Child", role: "child", age: 5 },
      { id: "child-b", name: "Alex Other", role: "child", age: 6 },
    ]);
    mocks.getLiveMemberById.mockResolvedValue({ id: "child-a", name: "Alex Child", role: "child", age: 5 });
    mocks.verifyPinFromPB.mockResolvedValue({ id: "child-a", name: "Alex", role: "child", age: 5 });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const response = await POST(jsonReq({
      action: "complete",
      operationId: "op-ambiguous-first-name",
      taskId: 91,
      memberName: "Alex",
      pin: "1234",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ reason: "unknown_actor" });
    expect(updateCalls.week_data).toBeUndefined();
  });
});

describe("task claim internal registry", () => {
  it("dispatches all six claim actions through the shared service handlers", async () => {
    const tasks = [
      { id: 101, title: "Open", assignee: "Open", points: 1, universal: true, completed: false },
      { id: 102, title: "Assigned", assignee: "Caspian Garcia", points: 1, universal: false, completed: false },
      {
        id: 103,
        title: "Pending",
        assignee: "Caspian Garcia",
        points: 1,
        universal: false,
        completed: true,
        pendingApproval: { byName: "Caspian Garcia", at: "2026-09-24T10:00:00.000Z", points: 1 },
      },
      { id: 104, title: "Join", assignee: "Crew", points: 1, universal: false, completed: false, crewSize: 2, crew: { members: [] } },
      { id: 105, title: "Checkin", assignee: "Crew", points: 1, universal: false, completed: false, crewSize: 2, crew: { members: [{ name: "Bailey Garcia", emoji: "", joinedAt: "x" }] } },
      { id: 106, title: "Remove", assignee: "Crew", points: 1, universal: false, completed: false, crewSize: 2, crew: { members: [{ name: "Emily Garcia", emoji: "", joinedAt: "x" }] } },
    ];
    const { pb } = makePb({ taskPoints: 1, taskRows: tasks.map((task) => ({ ...task, taskId: task.id })), snapshotTasks: tasks });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    const parent = { memberId: "parent-alex", name: "Alex", role: "parent" };
    const caspian = { memberId: "child-caspian", name: "Caspian Garcia", role: "child" };
    const bailey = { memberId: "child-bailey", name: "Bailey Garcia", role: "child" };
    const emily = { memberId: "child-emily", name: "Emily Garcia", role: "child" };
    const commands: Array<{
      operationId: string;
      kind: ClaimAction;
      actor: { memberId: string; name: string; role: string };
      taskId: number;
      targetName?: string;
    }> = [
      { operationId: "op-registry-claim", kind: "claim", actor: parent, taskId: 101 },
      { operationId: "op-registry-complete", kind: "complete", actor: caspian, taskId: 102 },
      { operationId: "op-registry-undo", kind: "undo", actor: caspian, taskId: 103 },
      { operationId: "op-registry-join", kind: "crew-join", actor: bailey, taskId: 104 },
      { operationId: "op-registry-checkin", kind: "crew-checkin", actor: bailey, taskId: 105 },
      { operationId: "op-registry-remove", kind: "crew-remove", actor: parent, taskId: 106, targetName: "Emily Garcia" },
    ] as const;

    const results = [];
    for (const item of commands) {
      const command = {
        operationId: item.operationId,
        kind: item.kind,
        actor: item.actor,
        payload: taskClaimInternalPayload({
          operationId: item.operationId,
          action: item.kind,
          taskId: item.taskId,
          ...(item.targetName ? { targetName: item.targetName } : {}),
        }),
      } as any;
      results.push(await executeInternalTaskCommand(command, { source: "server" }));
    }

    expect(results.every((result) => result.ok)).toBe(true);
  });
});

describe("POST /api/tasks/claim — pin-free under-10 complete + emoji persistence", () => {
  beforeEach(() => {
    mocks.verifyPinFromPB.mockReset();
    mocks.verifySession.mockReset();
    mocks.findMemberByName.mockReset();
  });

  it("no-pin complete: under-10 child session lands pendingApproval (no PIN required)", async () => {
    mocks.verifySession.mockResolvedValue({ role: "child", name: "Caspian", memberId: "child-caspian" });
    mocks.findMemberByName.mockResolvedValue({
      id: "m1",
      name: "Caspian",
      fullName: "Caspian Garcia",
      role: "child",
      age: 5,
      emoji: "🧒",
    });
    const { pb, weekUpdates, snapshotUpdates, updateCalls } = makePb({
      taskPoints: 6,
      taskRow: { universal: false, completed: false, assignee: "Caspian Garcia" },
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(
      jsonReq(
        { action: "complete", taskId: 42, memberName: "Caspian Garcia" },
        "session-token"
      )
    );

    expect(res.status).toBe(200);
    expect((await res.json()).pending).toBe(true);
    expect(weekUpdates()).toBeNull();
    const patch = updateCalls.tasks.find((p: any) => p.pendingApproval);
    expect(patch.pendingApproval).toMatchObject({ byName: "Caspian Garcia", points: 6 });
    const snap = snapshotUpdates();
    const data = typeof snap.data === "string" ? JSON.parse(snap.data) : snap.data;
    expect((data.tasks || []).find((t: any) => t.id === 42).pendingApproval).toMatchObject({
      byName: "Caspian Garcia",
    });
  });

  it("no-pin complete: photo assigneeEmoji never reaches the PB tasks update (max=5000)", async () => {
    mocks.verifySession.mockResolvedValue({ role: "child", name: "Caspian", memberId: "child-caspian" });
    mocks.findMemberByName.mockResolvedValue({
      id: "m1",
      name: "Caspian",
      fullName: "Caspian Garcia",
      role: "child",
      age: 5,
      emoji: "🧒",
    });
    const photo = `data:image/webp;base64,${"A".repeat(6000)}`;
    const roster = defaultLiveMembers.map((member) =>
      member.id === "child-caspian" ? { ...member, emoji: photo } : member
    );
    mocks.getLiveMembers.mockResolvedValue(roster);
    mocks.getLiveMemberById.mockImplementation(async (id: string) => roster.find((member) => member.id === id) ?? null);
    const { pb, updateCalls } = makePb({
      taskPoints: 5,
      taskRow: { universal: false, completed: false, assignee: "Caspian Garcia", assigneeEmoji: photo },
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(
      jsonReq(
        { action: "complete", taskId: 42, memberName: "Caspian Garcia", assigneeEmoji: photo },
        "session-token"
      )
    );

    expect(res.status).toBe(200);
    for (const patch of updateCalls.tasks) {
      if (patch.assigneeEmoji !== undefined) {
        expect(patch.assigneeEmoji).toBe("👤");
        expect(String(patch.assigneeEmoji).length).toBeLessThanOrEqual(5000);
      }
    }
  });

  it("no-pin complete: a parent session without a PIN is rejected 401", async () => {
    mocks.verifySession.mockResolvedValue({ role: "parent", name: "Alex", memberId: "parent-alex" });
    mocks.findMemberByName.mockResolvedValue({
      id: "m9",
      name: "Alex",
      role: "parent",
      age: 40,
      emoji: "🦊",
    });
    const { pb } = makePb({ taskPoints: 5, taskRow: { universal: false, completed: false } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(
      jsonReq({ action: "complete", taskId: 42, memberName: "Alex" }, "session-token")
    );
    expect(await res.json()).toMatchObject({ reason: "pin_required" });
    expect(res.status).toBe(401);
  });

  it("no-pin complete: no session cookie is rejected 401", async () => {
    mocks.verifySession.mockResolvedValue(null);
    const { pb } = makePb({ taskPoints: 5, taskRow: { universal: false, completed: false } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "complete", taskId: 42, memberName: "Caspian Garcia" }));
    expect(res.status).toBe(401);
  });
});
