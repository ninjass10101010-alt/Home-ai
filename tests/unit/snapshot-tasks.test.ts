import { describe, it, expect, vi } from "vitest";

// Pure helpers only — no PB. Mock the auth/lock imports so the module loads
// outside a server context.
vi.mock("@/lib/pb-auth", () => ({ withAdmin: vi.fn() }));
vi.mock("@/lib/keyed-lock", () => ({ withKeyedLock: vi.fn() }));

import {
  liveSnapshotTasks,
  findSnapshotTask,
  deleteSnapshotTask,
  upsertSnapshotTask,
} from "@/lib/snapshot-tasks";

const t = (id: number, title: string, extra: Record<string, any> = {}) => ({ id, title, ...extra });

describe("snapshot-tasks pure helpers", () => {
  it("liveSnapshotTasks hides tombstoned rows", () => {
    const data = { tasks: [t(1, "Dishes"), t(2, "Trash")], deletedTaskIds: [2] };
    expect(liveSnapshotTasks(data as any).map((x) => x.id)).toEqual([1]);
  });

  it("findSnapshotTask resolves by taskId then exact title", () => {
    const tasks = [t(1, "Dishes"), t(2, "Trash")] as any;
    expect(findSnapshotTask(tasks, { taskId: 2 })?.title).toBe("Trash");
    expect(findSnapshotTask(tasks, { title: "dishes" })?.id).toBe(1);
    expect(findSnapshotTask(tasks, { title: "Nope" })).toBeNull();
  });

  it("deleteSnapshotTask removes the row AND records a tombstone", () => {
    const data = { tasks: [t(1, "Dishes"), t(2, "Trash")], deletedTaskIds: [] };
    const next = deleteSnapshotTask(data as any, 2);
    expect(next.tasks!.map((x) => x.id)).toEqual([1]);
    expect(next.deletedTaskIds).toContain(2);
  });

  it("upsertSnapshotTask replaces a row and clears its tombstone", () => {
    const data = { tasks: [t(1, "Dishes")], deletedTaskIds: [1, 9] };
    const next = upsertSnapshotTask(data as any, t(1, "Dishes v2") as any);
    expect(next.tasks!.find((x) => x.id === 1)!.title).toBe("Dishes v2");
    expect(next.deletedTaskIds).toEqual([9]);
  });
});
