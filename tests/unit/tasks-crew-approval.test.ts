// @vitest-environment jsdom
process.env.TZ = "UTC";

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifyPinFromPB: vi.fn(),
  getLiveMemberById: vi.fn(),
  getLiveMembers: vi.fn(),
  ensureCurrentTaskWeek: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {},
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/server-auth", () => ({
  verifyPinFromPB: mocks.verifyPinFromPB,
}));

vi.mock("@/lib/live-member", () => ({
  getLiveMemberById: mocks.getLiveMemberById,
  getLiveMembers: mocks.getLiveMembers,
}));

vi.mock("@/lib/task-week-rollover", () => ({
  ensureCurrentTaskWeek: mocks.ensureCurrentTaskWeek,
}));

import { POST } from "@/app/api/tasks/approve/route";
import { localWeekStartISO } from "@/lib/local-date";
import {
  approvePendingCompletion,
  sendBackPendingCompletion,
  pendingPointsFor,
  emptyWeekData,
  isPendingApproval,
  crewAllCheckedIn,
} from "@/lib/task-utils";
import type { Task, WeekData, CrewMember } from "@/types/tasks";

function member(name: string, checkedInAt?: string): CrewMember {
  return { name, emoji: "🧒", joinedAt: "2026-09-18T10:00:00.000Z", ...(checkedInAt ? { checkedInAt } : {}) };
}

function crewPendingTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 77,
    title: "Wash the van",
    assignee: "Crew",
    assigneeEmoji: "🤝",
    due: "2026-09-18",
    points: 15,
    recurring: null,
    category: "chores",
    completed: true,
    priority: "medium",
    completedBy: "Crew",
    completedAt: "2026-09-18T20:00:00.000Z",
    completedInWeek: "2026-09-14",
    crewSize: 2,
    crew: { members: [member("Alex", "t1"), member("Lily", "t2")] },
    pendingApproval: { byName: "Crew", at: "2026-09-18T20:00:00.000Z", points: 15, crew: ["Alex", "Lily"] },
    ...overrides,
  } as Task;
}

const PARENT = { id: "parent-rebecca", name: "Rebecca (Mom)", role: "parent", emoji: "👩" };

const ROSTER = [
  PARENT,
  { id: "child-caspian", name: "Caspian Garcia", role: "child", emoji: "🧒" },
  { id: "child-aurora", name: "Aurora Garcia", role: "child", emoji: "🌈" },
  { id: "child-bailey", name: "Bailey Garcia", role: "child", emoji: "👧" },
];

function jsonReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/tasks/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operationId: "op-crew-award-list", ...body }),
  });
}

/**
 * Minimal fake PocketBase for the approval write path: the snapshot blob is
 * authoritative (it carries the pending row), week_data takes the ledger
 * write, `tasks` takes the projection.
 */
function makePb(snapshotTasks: unknown[]) {
  const weekStart = localWeekStartISO();
  const weekRow: Record<string, unknown> = {
    id: "w1",
    weekStart,
    points: "{}",
    streak: "{}",
    lastActive: "{}",
    history: "[]",
  };
  let snapData: Record<string, unknown> = {
    tasks: [...snapshotTasks],
    deletedTaskIds: [],
    weekData: { weekStart, points: {}, streak: {}, lastActive: {}, history: [] },
  };
  const taskRows: Record<string, unknown>[] = [];
  let history: any[] = [];
  let points: Record<string, number> = {};
  let weekWrites = 0;
  let taskWrites = 0;
  let snapshotWrites = 0;

  const dataOf = (payload: Record<string, unknown>) =>
    typeof payload.data === "string" ? JSON.parse(payload.data) : payload.data;

  const pb = {
    collection(name: string) {
      if (name === "consuela_data_snapshots") {
        return {
          getFullList: async () => [{ id: "snap-1", key: "tasks-snapshot", data: JSON.stringify(snapData) }],
          update: async (_id: string, payload: Record<string, unknown>) => {
            snapshotWrites += 1;
            snapData = { ...snapData, ...(dataOf(payload) as Record<string, unknown>) };
            return { id: "snap-1", ...payload };
          },
          create: async (payload: Record<string, unknown>) => {
            snapshotWrites += 1;
            snapData = { ...snapData, ...(dataOf(payload) as Record<string, unknown>) };
            return { id: "snap-2", ...payload };
          },
        };
      }
      if (name === "week_data") {
        const apply = (payload: Record<string, unknown>) => {
          weekWrites += 1;
          if (payload.history) history = payload.history as any[];
          if (payload.points) points = payload.points as Record<string, number>;
          Object.assign(weekRow, payload);
          return weekRow;
        };
        return {
          getFullList: async () => [weekRow],
          getOne: async () => weekRow,
          update: async (_id: string, payload: Record<string, unknown>) => apply(payload),
          create: async (payload: Record<string, unknown>) => apply(payload),
        };
      }
      if (name === "week_archive") return { getFullList: async () => [] };
      if (name === "tasks") {
        return {
          getFullList: async () => taskRows,
          create: async (payload: Record<string, unknown>) => {
            taskWrites += 1;
            const row = { id: `pb-${taskRows.length + 1}`, ...payload };
            taskRows.push(row);
            return row;
          },
          update: async (id: string, payload: Record<string, unknown>) => {
            taskWrites += 1;
            const row = taskRows.find((candidate) => String(candidate.id) === String(id));
            if (row) Object.assign(row, payload);
            return row ?? { id, ...payload };
          },
          delete: async (id: string) => {
            taskWrites += 1;
            const index = taskRows.findIndex((candidate) => String(candidate.id) === String(id));
            if (index >= 0) taskRows.splice(index, 1);
            return true;
          },
        };
      }
      return { getFullList: async () => [] };
    },
  };

  return {
    pb,
    history: () => history,
    points: () => points,
    weekWrites: () => weekWrites,
    taskWrites: () => taskWrites,
    snapshotWrites: () => snapshotWrites,
  };
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.verifyPinFromPB.mockReset();
  mocks.getLiveMemberById.mockReset();
  mocks.getLiveMembers.mockReset();
  mocks.ensureCurrentTaskWeek.mockReset();
  mocks.verifyPinFromPB.mockResolvedValue(PARENT);
  mocks.getLiveMemberById.mockImplementation(async (id: string) =>
    id === PARENT.id ? PARENT : null,
  );
  mocks.getLiveMembers.mockResolvedValue(ROSTER);
  mocks.ensureCurrentTaskWeek.mockResolvedValue({ weekStart: localWeekStartISO(), reconciled: true });
});

describe("Crew approval", () => {
  it("pays every crew member full points with one 'Crew:' earn each", () => {
    const task = crewPendingTask();
    const week = emptyWeekData("2026-09-14");
    const { tasks, weekData } = approvePendingCompletion([task], week, task.id);

    expect(isPendingApproval(tasks[0])).toBe(false);
    expect(weekData.points["Alex"]).toBe(15);
    expect(weekData.points["Lily"]).toBe(15);
    const earns = weekData.history.filter((tx) => tx.type === "earn" && tx.taskId === task.id);
    expect(earns).toHaveLength(2);
    expect(earns.every((tx) => tx.description.startsWith("Crew:"))).toBe(true);
  });

  it("is idempotent per member on a second approval", () => {
    const task = crewPendingTask();
    const first = approvePendingCompletion([task], emptyWeekData("2026-09-14"), task.id);
    // Simulate a stale second device approving again.
    const again = crewPendingTask();
    const second = approvePendingCompletion([again], first.weekData, again.id);
    expect(second.weekData.points["Alex"]).toBe(15);
    expect(second.weekData.points["Lily"]).toBe(15);
    expect(second.weekData.history.filter((tx) => tx.type === "earn")).toHaveLength(2);
  });

  it("re-pays a member whose earn was reversed", () => {
    const task = crewPendingTask();
    const base = emptyWeekData("2026-09-14");
    const withReversed: WeekData = {
      ...base,
      points: { Alex: 0, Lily: 15 },
      history: [
        { id: 1, timestamp: "2026-09-18T20:01:00.000Z", member: "Alex", type: "earn", amount: 15, description: "Crew: Wash the van", taskId: 77 },
        { id: 2, timestamp: "2026-09-18T20:02:00.000Z", member: "Alex", type: "adjust", amount: -15, description: "Undo", taskId: 77 },
        { id: 3, timestamp: "2026-09-18T20:01:00.000Z", member: "Lily", type: "earn", amount: 15, description: "Crew: Wash the van", taskId: 77 },
      ],
    };
    const { weekData } = approvePendingCompletion([task], withReversed, task.id);
    // Alex is re-paid (his earn was reversed); Lily stays paid once.
    expect(weekData.points["Alex"]).toBe(15);
    expect(weekData.points["Lily"]).toBe(15);
    expect(weekData.history.filter((tx) => tx.type === "earn" && tx.member === "Alex" && tx.taskId === 77)).toHaveLength(2);
    expect(weekData.history.filter((tx) => tx.type === "earn" && tx.member === "Lily" && tx.taskId === 77)).toHaveLength(1);
  });

  it("send-back clears the crew check-ins and preserves removed tombstones", () => {
    const task = crewPendingTask({
      crew: {
        members: [member("Alex", "t1"), member("Lily", "t2")],
        removed: ["Former Member"],
      },
    });
    expect(crewAllCheckedIn(task)).toBe(true);
    const next = sendBackPendingCompletion([task], task.id);
    expect(next[0].completed).toBe(false);
    expect(next[0].pendingApproval).toBeUndefined();
    expect(next[0].sentBackAt).toBeTruthy();
    expect(crewAllCheckedIn(next[0])).toBe(false);
    expect(next[0].crew?.members.map((m) => m.name)).toEqual(["Alex", "Lily"]);
    expect(next[0].crew?.members.every((m) => !m.checkedInAt)).toBe(true);
    expect(next[0].crew?.removed).toEqual(["Former Member"]);
  });

  it("pendingPointsFor includes an in-flight crew value", () => {
    const task = crewPendingTask();
    expect(pendingPointsFor("Alex", [task])).toBe(15);
    expect(pendingPointsFor("Lily", [task])).toBe(15);
    expect(pendingPointsFor("Caspian", [task])).toBe(0);
  });

  it("still pays a solo pending tap exactly once (regression)", () => {
    const solo: Task = {
      ...crewPendingTask(),
      id: 55,
      title: "Trash",
      points: 5,
      crewSize: null,
      crew: null,
      pendingApproval: { byName: "Caspian", at: "2026-09-18T20:00:00.000Z", points: 5 },
    };
    const first = approvePendingCompletion([solo], emptyWeekData("2026-09-14"), solo.id);
    expect(first.weekData.points["Caspian"]).toBe(5);
    expect(first.weekData.history.filter((tx) => tx.type === "earn")).toHaveLength(1);
  });

  it("pays exactly the stored award list when a parent closed a partial crew", async () => {
    // A crew of 3: Caspian + Aurora checked in, Bailey joined but NEVER did.
    // The partial close staged pendingApproval.crew = [Caspian, Aurora].
    const task = crewPendingTask({
      crewSize: 3,
      crew: {
        members: [
          member("Caspian Garcia", "2026-09-18T19:00:00.000Z"),
          member("Aurora Garcia", "2026-09-18T19:05:00.000Z"),
          member("Bailey Garcia"),
        ],
      },
      pendingApproval: {
        byName: "Crew",
        at: "2026-09-18T20:00:00.000Z",
        points: 15,
        crew: ["Caspian Garcia", "Aurora Garcia"],
      },
    });
    const { pb, history, points } = makePb([task]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await POST(jsonReq({
      action: "approve",
      taskId: task.id,
      memberName: PARENT.name,
      pin: "0202",
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paid).toBe(2);
    expect(body.cleared).toBe(1);
    const earns = history().filter((tx: any) => tx.type === "earn" && tx.taskId === task.id);
    expect(earns).toHaveLength(2);
    expect(earns.map((tx: any) => tx.member).sort()).toEqual(["Aurora Garcia", "Caspian Garcia"]);
    expect(points()["Caspian Garcia"]).toBe(15);
    expect(points()["Aurora Garcia"]).toBe(15);
    expect(points()["Bailey Garcia"]).toBeUndefined();
  });

  it("skips an award-list member removed between close and approval, pays the rest", async () => {
    // Closed with [Caspian, Bailey] checked in; the parent then crew-removed
    // Bailey before approving. Bailey is dropped honestly, Caspian still pays.
    const task = crewPendingTask({
      crewSize: 2,
      crew: {
        members: [
          member("Caspian Garcia", "2026-09-18T19:00:00.000Z"),
          member("Bailey Garcia", "2026-09-18T19:05:00.000Z"),
        ],
        removed: ["Bailey Garcia"],
      },
      pendingApproval: {
        byName: "Crew",
        at: "2026-09-18T20:00:00.000Z",
        points: 15,
        crew: ["Caspian Garcia", "Bailey Garcia"],
      },
    });
    const { pb, history, points } = makePb([task]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await POST(jsonReq({
      action: "approve",
      taskId: task.id,
      memberName: PARENT.name,
      pin: "0202",
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paid).toBe(1);
    expect(body.skipped).toBe(1);
    expect(points()["Caspian Garcia"]).toBe(15);
    expect(points()["Bailey Garcia"]).toBeUndefined();
    const earns = history().filter((tx: any) => tx.type === "earn" && tx.taskId === task.id);
    expect(earns).toHaveLength(1);
    expect(earns[0].member).toBe("Caspian Garcia");
  });

  it("rejects a stored award list that repeats a member by different spellings", async () => {
    // parsePending only de-dupes byte-identical trimmed strings, so "Bailey"
    // + "Bailey Garcia" both reach resolvePayees, resolve to the SAME person
    // and both hit the removal skip before any id is recorded — a duplicate
    // of a SKIPPED entry is still a malformed record = invalid.
    const task = crewPendingTask({
      crewSize: 2,
      crew: {
        members: [
          member("Caspian Garcia", "2026-09-18T19:00:00.000Z"),
          member("Bailey Garcia", "2026-09-18T19:05:00.000Z"),
        ],
        removed: ["Bailey Garcia"],
      },
      pendingApproval: {
        byName: "Crew",
        at: "2026-09-18T20:00:00.000Z",
        points: 15,
        crew: ["Bailey", "Bailey Garcia", "Caspian Garcia"],
      },
    });
    const { pb, history, points, weekWrites, taskWrites, snapshotWrites } = makePb([task]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await POST(jsonReq({
      action: "approve",
      taskId: task.id,
      memberName: PARENT.name,
      pin: "0202",
    }));

    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe("invalid_task_state");
    expect(weekWrites()).toBe(0);
    expect(taskWrites()).toBe(0);
    expect(snapshotWrites()).toBe(0);
    expect(history()).toHaveLength(0);
    expect(points()).toEqual({});
  });

  it("rejects a stored award list with a byte-identical repeated name", async () => {
    const task = crewPendingTask({
      crewSize: 2,
      crew: {
        members: [
          member("Caspian Garcia", "2026-09-18T19:00:00.000Z"),
          member("Bailey Garcia", "2026-09-18T19:05:00.000Z"),
        ],
        removed: ["Bailey Garcia"],
      },
      pendingApproval: {
        byName: "Crew",
        at: "2026-09-18T20:00:00.000Z",
        points: 15,
        crew: ["Bailey Garcia", "Bailey Garcia", "Caspian Garcia"],
      },
    });
    const { pb, history, points, weekWrites, taskWrites, snapshotWrites } = makePb([task]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await POST(jsonReq({
      action: "approve",
      taskId: task.id,
      memberName: PARENT.name,
      pin: "0202",
    }));

    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe("invalid_task_state");
    expect(weekWrites()).toBe(0);
    expect(taskWrites()).toBe(0);
    expect(snapshotWrites()).toBe(0);
    expect(history()).toHaveLength(0);
    expect(points()).toEqual({});
  });

  it("refuses a partial pending whose byName is not Crew", async () => {
    const task = crewPendingTask({
      crewSize: 2,
      crew: {
        members: [
          member("Caspian Garcia", "2026-09-18T19:00:00.000Z"),
          member("Aurora Garcia", "2026-09-18T19:05:00.000Z"),
        ],
      },
      pendingApproval: {
        byName: "Caspian Garcia",
        at: "2026-09-18T20:00:00.000Z",
        points: 15,
        crew: ["Caspian Garcia", "Aurora Garcia"],
      },
    });
    const { pb, history, points, weekWrites, taskWrites, snapshotWrites } = makePb([task]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await POST(jsonReq({
      action: "approve",
      taskId: task.id,
      memberName: PARENT.name,
      pin: "0202",
    }));

    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe("invalid_task_state");
    expect(weekWrites()).toBe(0);
    expect(taskWrites()).toBe(0);
    expect(snapshotWrites()).toBe(0);
    expect(history()).toHaveLength(0);
    expect(points()).toEqual({});
  });
});
