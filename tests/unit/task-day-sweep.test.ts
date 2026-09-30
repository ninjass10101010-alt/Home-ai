import { describe, it, expect, vi, beforeEach } from "vitest";
import { closeDeadlineCrewsOnTasks, ensureCurrentTaskDay } from "@/lib/task-day-sweep";
import { localTodayISO, localPreviousDayISO, localWeekStartISO } from "@/lib/local-date";

const DAY = "2026-09-29";
const WEEK = "2026-09-28";
const NOW = "2026-09-29T08:00:00.000Z";

function crew(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 11, title: "Garage reset", assignee: "Crew", assigneeEmoji: "🤝",
    due: "2026-09-28", points: 15, recurring: null, category: "chores",
    priority: "medium", completed: false, crewSize: 3,
    crew: {
      members: [
        { name: "Caspian Garcia", emoji: "🧒", joinedAt: `${WEEK}T07:00:00.000Z`, checkedInAt: `${WEEK}T09:00:00.000Z` },
        { name: "Bailey Garcia", emoji: "👧", joinedAt: `${WEEK}T07:05:00.000Z` },
      ],
      removed: [],
    },
    crewCloseMode: "deadline",
    ...over,
  };
}

describe("closeDeadlineCrewsOnTasks", () => {
  it("closes a past-due deadline crew with partial check-ins → crew pending for the checked-in only", () => {
    const { tasks, closedIds } = closeDeadlineCrewsOnTasks([crew()] as any, DAY, WEEK, NOW);
    expect(closedIds).toEqual([11]);
    const t = tasks[0] as any;
    expect(t.completed).toBe(true);
    expect(t.status).toBe("done");
    expect(t.completedBy).toBe("Crew");
    expect(t.completedInWeek).toBe(WEEK);
    expect(t.pendingApproval).toEqual({
      byName: "Crew", at: NOW, points: 15, crew: ["Caspian Garcia"],
    });
  });

  it("skips a deadline crew with zero check-ins (stays overdue, no fake close)", () => {
    const t = crew({ crew: { members: [
      { name: "Caspian Garcia", emoji: "🧒", joinedAt: "x" },
      { name: "Bailey Garcia", emoji: "👧", joinedAt: "x" },
    ] } });
    const { closedIds, tasks } = closeDeadlineCrewsOnTasks([t] as any, DAY, WEEK, NOW);
    expect(closedIds).toEqual([]);
    expect((tasks[0] as any).completed).toBe(false);
  });

  it("never touches a task holding a live pendingApproval", () => {
    const t = crew({ pendingApproval: { byName: "Crew", at: "x", points: 15, crew: ["Caspian Garcia"] } });
    const { closedIds, tasks } = closeDeadlineCrewsOnTasks([t] as any, DAY, WEEK, NOW);
    expect(closedIds).toEqual([]);
    expect((tasks[0] as any).pendingApproval.at).toBe("x"); // untouched object
  });

  it("only closes when the due local day has passed", () => {
    const { closedIds } = closeDeadlineCrewsOnTasks([crew({ due: DAY })] as any, DAY, WEEK, NOW);
    expect(closedIds).toEqual([]); // due today is still open today
  });

  it("skips strict and parent modes (sweep owns deadline only)", () => {
    expect(closeDeadlineCrewsOnTasks([crew({ crewCloseMode: "strict" })] as any, DAY, WEEK, NOW).closedIds).toEqual([]);
    expect(closeDeadlineCrewsOnTasks([crew({ crewCloseMode: "parent" })] as any, DAY, WEEK, NOW).closedIds).toEqual([]);
    expect(closeDeadlineCrewsOnTasks([crew({ crewCloseMode: undefined })] as any, DAY, WEEK, NOW).closedIds).toEqual([]);
  });

  it("excludes removed members from the award list", () => {
    const t = crew({ crew: {
      members: [
        { name: "Caspian Garcia", emoji: "🧒", joinedAt: "x", checkedInAt: "y" },
        { name: "Bailey Garcia", emoji: "👧", joinedAt: "x", checkedInAt: "y" },
      ],
      removed: ["Bailey Garcia"],
    } });
    const { tasks } = closeDeadlineCrewsOnTasks([t] as any, DAY, WEEK, NOW);
    expect((tasks[0] as any).pendingApproval.crew).toEqual(["Caspian Garcia"]);
  });

  it("skips completed tasks and non-crew tasks", () => {
    expect(closeDeadlineCrewsOnTasks([crew({ completed: true })] as any, DAY, WEEK, NOW).closedIds).toEqual([]);
    expect(closeDeadlineCrewsOnTasks([crew({ crewSize: null, crew: null })] as any, DAY, WEEK, NOW).closedIds).toEqual([]);
  });
});

const store = vi.hoisted(() => ({
  data: null as any, // snapshot data object the tests assign before each call
  revision: "1",
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock("@/lib/week-ledger-lock", () => ({
  withWeekLedgerLock: (_week: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/lib/snapshot-tasks", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/snapshot-tasks")>();
  return {
    ...real,
    readSnapshotWithRevision: async () => ({ rowId: "row-1", data: store.data, revision: store.revision }),
    mutateSnapshotWithMeta: async (fn: any) => {
      const out = fn(store.data);
      store.data = out.data;
      store.revision = String(Number(store.revision) + 1);
      return { data: out.data, revision: { revision: store.revision, updatedAt: "now" }, result: out.result };
    },
  };
});

describe("ensureCurrentTaskDay", () => {
  beforeEach(() => {
    store.revision = "1";
    store.data = {
      revision: "1",
      taskWeekStart: localWeekStartISO(),
      deletedTaskIds: [],
      tasks: [crew({ due: localPreviousDayISO(localTodayISO()) })],
    };
  });

  it("sweeps once per local day: closes the overdue deadline crew, then idempotently no-ops", async () => {
    const first = await ensureCurrentTaskDay();
    expect(first.swept).toBe(true);
    expect(first.closedTaskIds).toEqual([11]);
    expect(first.reconciled).toBe(true);
    expect(first.failed).toEqual([]);
    expect(store.data.lastDaySweep.day).toBe(localTodayISO());

    const closed = store.data.tasks.find((t: any) => Number(t.id) === 11) as any;
    expect(closed.completed).toBe(true);
    expect(closed.pendingApproval).toMatchObject({ byName: "Crew", crew: ["Caspian Garcia"] });

    const second = await ensureCurrentTaskDay();
    expect(second.swept).toBe(false); // same-day idempotency pin
    expect(second.closedTaskIds).toEqual([]);
    expect(second.reconciled).toBe(true);
    expect(second.failed).toEqual([]);
    expect(store.data.lastDaySweep.day).toBe(localTodayISO());
  });
});
