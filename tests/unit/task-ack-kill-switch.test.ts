// @vitest-environment jsdom
// B1a kill switch — `ACK_CLEAR_AUTHORITATIVE`.
//
// It is containment for the wave's riskiest change: `false` restores the
// pre-B1a pull-gate clear path exactly (an ack's clear is refused unless it
// carries ledger proof). It is a source constant on purpose — flipping it is a
// deliberate one-line code change, verified by hand (B1a Step 6), never
// something a running client can toggle. This suite pins the constant and the
// fallback contract it restores.
import { describe, it, expect, beforeEach } from "vitest";

import {
  ACK_CLEAR_AUTHORITATIVE,
  adoptTaskOutboxAcknowledgement,
} from "@/lib/task-command-store";
import { loadTasks, saveTasks } from "@/lib/task-utils";
import type { Task } from "@/types/tasks";

const MONDAY = "2026-10-05";
const T1 = "2026-10-08T15:00:00.000Z";
const T2 = "2026-10-08T15:20:00.000Z";

function pendingTask(): Task {
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
  } as Task;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    "consuela-week-data",
    JSON.stringify({ weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] }),
  );
});

describe("ACK_CLEAR_AUTHORITATIVE", () => {
  it("is exported and defaults to true", () => {
    expect(ACK_CLEAR_AUTHORITATIVE).toBe(true);
  });

  it("the false branch restores the pull-gate fallback: no proof, no clear", async () => {
    saveTasks([pendingTask()]);
    // The pre-B1a path is `mergeTasksSnapshot`'s pull gate — exercised here
    // through the armed fallback an unreadable instant selects: no earn in the
    // ack's week and no send-back stamp means the clear is refused.
    await adoptTaskOutboxAcknowledgement({
      operationId: "op-kill-switch",
      commandCreatedAt: undefined,
      reconciled: true,
      clearedTasks: [{
        id: 101,
        completed: true,
        completedBy: "Caspian Garcia",
        completedAt: T1,
        completedInWeek: MONDAY,
        pendingApproval: null,
        sentBackAt: null,
      }],
      weekData: { weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] },
    } as any);
    expect(loadTasks()[0].pendingApproval).toBeTruthy();
  });

  it("the false branch still clears when the ack carries ledger proof", async () => {
    saveTasks([pendingTask()]);
    await adoptTaskOutboxAcknowledgement({
      operationId: "op-kill-switch-proof",
      commandCreatedAt: undefined,
      reconciled: true,
      clearedTasks: [{
        id: 101,
        completed: true,
        completedBy: "Caspian Garcia",
        completedAt: T1,
        completedInWeek: MONDAY,
        pendingApproval: null,
        sentBackAt: null,
      }],
      weekData: {
        weekStart: MONDAY,
        points: { "Caspian Garcia": 7 },
        streak: {},
        lastActive: {},
        history: [{ id: 1, timestamp: T1, member: "Caspian Garcia", type: "earn", amount: 7, description: "x", taskId: 101 }],
      },
    } as any);
    expect(loadTasks()[0].pendingApproval).toBeUndefined();
  });
});
