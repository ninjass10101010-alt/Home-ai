import { describe, it, expect } from "vitest";
import { normalizeExpiresAfterDays } from "@/lib/task-utils";
import { taskProjectionRecord } from "@/lib/snapshot-tasks";
import { parseManageTaskCommand } from "@/lib/task-manage";
import type { Task } from "@/types/tasks";

describe("normalizeExpiresAfterDays", () => {
  it("returns the integer for valid 1–30 values", () => {
    expect(normalizeExpiresAfterDays(1)).toBe(1);
    expect(normalizeExpiresAfterDays(7)).toBe(7);
    expect(normalizeExpiresAfterDays(30)).toBe(30);
  });
  it("returns null for absent values (caller defaults to never)", () => {
    expect(normalizeExpiresAfterDays(undefined)).toBeNull();
    expect(normalizeExpiresAfterDays(null)).toBeNull();
  });
  it("returns null for garbage", () => {
    expect(normalizeExpiresAfterDays(0)).toBeNull();
    expect(normalizeExpiresAfterDays(31)).toBeNull();
    expect(normalizeExpiresAfterDays(2.5)).toBeNull();
    expect(normalizeExpiresAfterDays("7")).toBeNull();
  });
});

describe("manage payload accepts expiresAfterDays", () => {
  it("allows the field on add and update payloads", () => {
    const add = parseManageTaskCommand({
      action: "add", operationId: "op-exp-add",
      task: { title: "Trash", assignee: "Alex", points: 5, expiresAfterDays: 3 },
    });
    expect("error" in add).toBe(false);
    const update = parseManageTaskCommand({
      action: "update", operationId: "op-exp-upd", taskId: 7,
      patch: { expiresAfterDays: null },
    });
    expect("error" in update).toBe(false);
  });
});

describe("taskProjectionRecord", () => {
  it("carries expiresAfterDays to the PB tasks projection", () => {
    const task = {
      id: 7, title: "Trash", assignee: "Alex", assigneeEmoji: "🦊",
      due: "2026-10-01", points: 5, recurring: null, category: "chores",
      completed: false, priority: "medium", expiresAfterDays: 3,
    } as unknown as Task;
    expect(taskProjectionRecord(task).expiresAfterDays).toBe(3);
  });
  it("writes null when absent", () => {
    const task = {
      id: 8, title: "Trash", assignee: "Alex", assigneeEmoji: "🦊",
      due: "2026-10-01", points: 5, recurring: null, category: "chores",
      completed: false, priority: "medium",
    } as unknown as Task;
    expect(taskProjectionRecord(task).expiresAfterDays).toBeNull();
  });
});
