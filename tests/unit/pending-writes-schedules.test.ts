// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  queueWrite,
  flushPendingWrites,
  PENDING_WRITES_KEY,
  type PendingWrite,
} from "@/lib/pending-writes";

const write = (key: string, over: Partial<PendingWrite> = {}): PendingWrite => ({
  key,
  collection: "schedules",
  op: "create",
  payload: { title: "Bedtime", time: "8:00 PM", days: "all" },
  queuedAt: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("pending-writes schedules branch", () => {
  it("replays a queued schedule create through db.insertSchedule", async () => {
    const insertSchedule = vi.fn(async () => ({ id: "pb_row_1" }));
    vi.doMock("@/db", () => ({
      db: {
        insertSchedule,
        updateSchedule: vi.fn(),
        deleteSchedule: vi.fn(),
      },
    }));
    queueWrite(write("schedule:create:Bedtime|8:00 PM|all"));
    const runner = (await import("@/lib/pending-writes")).flushPendingWrites;
    const { flushed, remaining } = await runner();
    expect(flushed).toBe(1);
    expect(remaining).toBe(0);
    expect(insertSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Bedtime", time: "8:00 PM", days: "all" })
    );
    expect(localStorage.getItem(PENDING_WRITES_KEY)).toBe("[]");
    vi.doUnmock("@/db");
  });

  it("replays schedule update/delete ops", async () => {
    const updateSchedule = vi.fn(async () => ({ id: "pb_row_1" }));
    const deleteSchedule = vi.fn(async () => true);
    vi.doMock("@/db", () => ({
      db: {
        insertSchedule: vi.fn(),
        updateSchedule,
        deleteSchedule,
      },
    }));
    queueWrite(write("schedule:update:pb_row_1", { op: "update", id: "pb_row_1", payload: { title: "Later" } }));
    queueWrite(write("schedule:delete:pb_row_9", { op: "delete", id: "pb_row_9" }));
    const runner = (await import("@/lib/pending-writes")).flushPendingWrites;
    const { flushed } = await runner();
    expect(flushed).toBe(2);
    expect(updateSchedule).toHaveBeenCalledWith("pb_row_1", { title: "Later" });
    expect(deleteSchedule).toHaveBeenCalledWith("pb_row_9");
    vi.doUnmock("@/db");
  });

  it("keeps the queue entry when the replay fails (offline)", async () => {
    vi.doMock("@/db", () => ({
      db: {
        insertSchedule: vi.fn(async () => null),
        updateSchedule: vi.fn(),
        deleteSchedule: vi.fn(),
      },
    }));
    queueWrite(write("schedule:create:Fail|8:00 AM|all"));
    const runner = (await import("@/lib/pending-writes")).flushPendingWrites;
    const { flushed, remaining } = await runner();
    expect(flushed).toBe(0);
    expect(remaining).toBe(1);
    const stillQueued = JSON.parse(localStorage.getItem(PENDING_WRITES_KEY) || "[]");
    expect(stillQueued).toHaveLength(1);
    vi.doUnmock("@/db");
  });
});
