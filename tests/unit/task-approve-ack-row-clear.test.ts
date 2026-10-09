// @vitest-environment jsdom
// B1a D1 — the approve acknowledgement clears the row it cleared.
//
// Symptom (a): the ack merge carried no `weekData`, so the pull gate's
// `paidElsewhere` proof was always false and the approved row never left
// "Needs approval" until the next snapshot pull (up to 60s later). The fix
// adopts the clear BY TASK ID on the ack — gated only by freshness, because an
// ack is the server's receipt for a command this device issued. The stale-ack
// hazard is the reason for the guard: a re-tap AFTER the command was created
// must survive an older command's ack.
import { describe, it, expect, beforeEach } from "vitest";

import {
  TASK_OUTBOX_STORAGE_KEY,
  adoptTaskOutboxAcknowledgement,
} from "@/lib/task-command-store";
import { loadTasks, loadWeekData, saveTasks } from "@/lib/task-utils";
import type { Task } from "@/types/tasks";

const MONDAY = "2026-10-05";
const T1 = "2026-10-08T15:00:00.000Z";
const T2 = "2026-10-08T15:20:00.000Z";

function seedTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 101,
    title: "Dishes",
    assignee: "Caspian Garcia",
    assigneeEmoji: "🧒",
    due: "2026-10-08",
    points: 5,
    recurring: null,
    category: "Chores",
    completed: true,
    priority: "medium",
    completedBy: "Caspian Garcia",
    completedAt: T1,
    completedInWeek: MONDAY,
    pendingApproval: { byName: "Caspian Garcia", at: T2, points: 7 },
    ...overrides,
  };
}

function seedWeek() {
  localStorage.setItem(
    "consuela-week-data",
    JSON.stringify({ weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] }),
  );
}

function clearedLeg(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    title: "Dishes",
    assignee: "Caspian Garcia",
    assigneeEmoji: "🧒",
    completed: true,
    completedBy: "Caspian Garcia",
    completedAt: T1,
    completedInWeek: MONDAY,
    pendingApproval: null,
    sentBackAt: null,
    ...overrides,
  };
}

function ackBase(overrides: Record<string, unknown> = {}) {
  return {
    operationId: "op-ack-1",
    commandCreatedAt: T1,
    clearedTasks: [clearedLeg()],
    weekData: { weekStart: MONDAY, points: { "Caspian Garcia": 7 }, streak: {}, lastActive: {}, history: [] },
    reconciled: true,
    ...overrides,
  } as any;
}

beforeEach(() => {
  localStorage.clear();
  void TASK_OUTBOX_STORAGE_KEY;
});

describe("the approve acknowledgement clears the row it cleared", () => {
  it("does NOT clear a row the kid re-tapped AFTER the command was queued", async () => {
    seedWeek();
    saveTasks([seedTask()]); // pendingApproval.at = T2, after the command
    await adoptTaskOutboxAcknowledgement(ackBase());
    expect(loadTasks()[0].pendingApproval).toEqual({ byName: "Caspian Garcia", at: T2, points: 7 });
    // The points still land — the ack's weekData is authoritative.
    expect(loadWeekData().points["Caspian Garcia"]).toBe(7);
  });

  it("DOES clear when the ack is newer than the tap", async () => {
    seedWeek();
    saveTasks([seedTask({ pendingApproval: { byName: "Caspian Garcia", at: T1, points: 7 } })]);
    await adoptTaskOutboxAcknowledgement(ackBase({ commandCreatedAt: T2 }));
    const row = loadTasks()[0];
    expect(row.pendingApproval).toBeUndefined();
    expect(row.completed).toBe(true);
  });

  it("clears on an exact timestamp tie", async () => {
    seedWeek();
    saveTasks([seedTask({ pendingApproval: { byName: "Caspian Garcia", at: T1, points: 7 } })]);
    await adoptTaskOutboxAcknowledgement(ackBase({ commandCreatedAt: T1 }));
    expect(loadTasks()[0].pendingApproval).toBeUndefined();
  });

  it("falls back to the pull-gate decision when commandCreatedAt is missing", async () => {
    seedWeek();
    saveTasks([seedTask({ pendingApproval: { byName: "Caspian Garcia", at: T1, points: 7 } })]);
    await adoptTaskOutboxAcknowledgement(
      ackBase({ commandCreatedAt: undefined, weekData: { weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] } }),
    );
    // No ledger proof and no stamp → today's behaviour: the clear is refused.
    expect(loadTasks()[0].pendingApproval).toBeTruthy();
  });

  it("falls back to the pull-gate decision when the local tap is unreadable", async () => {
    seedWeek();
    saveTasks([
      seedTask({
        pendingApproval: { byName: "Caspian Garcia", points: 7 } as any,
        completedAt: undefined,
      }),
    ]);
    await adoptTaskOutboxAcknowledgement(
      ackBase({ weekData: { weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] } }),
    );
    expect(loadTasks()[0].pendingApproval).toBeTruthy();
  });

  it("clears every row an approve-all ack names", async () => {
    seedWeek();
    saveTasks([
      seedTask({ id: 101 }),
      seedTask({
        id: 102,
        assignee: "Aurora Garcia",
        completedBy: "Aurora Garcia",
        pendingApproval: { byName: "Aurora Garcia", at: T2, points: 8 },
      }),
    ]);
    await adoptTaskOutboxAcknowledgement(
      ackBase({
        commandCreatedAt: T2,
        clearedTasks: [
          clearedLeg(),
          clearedLeg({ id: 102, assignee: "Aurora Garcia", completedBy: "Aurora Garcia" }),
        ],
      }),
    );
    const rows = loadTasks();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => !row.pendingApproval)).toBe(true);
  });

  it("does NOT clear when the ack says the projection did not land", async () => {
    seedWeek();
    saveTasks([seedTask({ pendingApproval: { byName: "Caspian Garcia", at: T1, points: 7 } })]);
    await adoptTaskOutboxAcknowledgement(
      ackBase({ commandCreatedAt: T2, reconciled: false, repairRequired: true }),
    );
    expect(loadTasks()[0].pendingApproval).toBeTruthy();
  });

  it("still runs the fresh-row guards for an ack that ADDS a row", async () => {
    seedWeek();
    // A local row under a stale id; the server re-keyed it.
    saveTasks([
      seedTask({
        id: 111,
        completed: false,
        pendingApproval: { byName: "Caspian Garcia", at: T1, points: 3 },
      } as Partial<Task>),
    ]);
    await adoptTaskOutboxAcknowledgement(
      ackBase({
        clearedTasks: undefined,
        commandCreatedAt: T2,
        weekData: undefined,
        task: {
          id: 500,
          title: "Dishes",
          assignee: "Caspian Garcia",
          completed: false,
          pendingApproval: { byName: "Caspian Garcia", at: T1, points: 3 },
        },
      }),
    );
    const rows = loadTasks();
    expect(rows).toHaveLength(1);
    // The re-key contract adopted the server id and kept the un-landed tap.
    expect(rows[0].id).toBe(500);
    expect(rows[0].pendingApproval?.at).toBe(T1);
  });

  it("a SEND-BACK ack still clears via its stamp", async () => {
    seedWeek();
    saveTasks([seedTask({ pendingApproval: { byName: "Caspian Garcia", at: T1, points: 7 } })]);
    await adoptTaskOutboxAcknowledgement(
      ackBase({
        commandCreatedAt: T2,
        weekData: undefined,
        clearedTasks: undefined,
        task: clearedLeg({ completed: false, completedBy: null, completedAt: null, sentBackAt: T2 }),
      }),
    );
    const row = loadTasks()[0];
    expect(row.pendingApproval).toBeUndefined();
    expect(row.completed).toBe(false);
    expect(row.sentBackAt).toBe(T2);
  });
});
