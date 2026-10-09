// @vitest-environment jsdom
// B1a kill switch — `ACK_CLEAR_AUTHORITATIVE`.
//
// It is containment for the wave's riskiest change: `false` restores the
// pre-B1a pull-gate clear path exactly (an ack's clear is refused unless it
// carries ledger proof). It is one source edit away (`export let`), and the
// test-only setter exists so BOTH branches are exercised here — no production
// caller touches it.
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  ACK_CLEAR_AUTHORITATIVE,
  __setAckClearAuthoritativeForTests,
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

function freshAckWithoutProof(operationId: string) {
  return {
    operationId,
    commandCreatedAt: T2,
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
  } as any;
}

function ackWithLedgerProof(operationId: string) {
  // The pre-B1a path consumes `ack.task` through `mergeTasksSnapshot`; the
  // ledger earn in its weekData is the proof that clears it.
  return {
    operationId,
    commandCreatedAt: undefined,
    reconciled: true,
    task: {
      id: 101,
      completed: true,
      completedBy: "Caspian Garcia",
      completedAt: T1,
      completedInWeek: MONDAY,
      pendingApproval: null,
      sentBackAt: null,
    },
    weekData: {
      weekStart: MONDAY,
      points: { "Caspian Garcia": 7 },
      streak: {},
      lastActive: {},
      history: [{ id: 1, timestamp: T1, member: "Caspian Garcia", type: "earn", amount: 7, description: "x", taskId: 101 }],
    },
  } as any;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    "consuela-week-data",
    JSON.stringify({ weekStart: MONDAY, points: {}, streak: {}, lastActive: {}, history: [] }),
  );
});

afterEach(() => {
  __setAckClearAuthoritativeForTests(true);
});

describe("ACK_CLEAR_AUTHORITATIVE", () => {
  it("is exported and defaults to true", () => {
    expect(ACK_CLEAR_AUTHORITATIVE).toBe(true);
  });

  it("ONLY the switch decides the by-id clear for a fresh ack with no proof", async () => {
    // true: an ack is the server's receipt and needs only freshness — clears.
    saveTasks([pendingTask()]);
    await adoptTaskOutboxAcknowledgement(freshAckWithoutProof("op-switch-on"));
    expect(loadTasks()[0].pendingApproval).toBeUndefined();

    // false: the pre-B1a pull gate governs — no ledger proof, no clear.
    saveTasks([pendingTask()]);
    __setAckClearAuthoritativeForTests(false);
    await adoptTaskOutboxAcknowledgement(freshAckWithoutProof("op-switch-off"));
    expect(loadTasks()[0].pendingApproval).toBeTruthy();
  });

  it("the false branch still clears when the ack carries ledger proof", async () => {
    saveTasks([pendingTask()]);
    __setAckClearAuthoritativeForTests(false);
    await adoptTaskOutboxAcknowledgement(ackWithLedgerProof("op-kill-switch-proof"));
    expect(loadTasks()[0].pendingApproval).toBeUndefined();
  });
});
