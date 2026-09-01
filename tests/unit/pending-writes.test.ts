// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  queueWrite,
  listPendingWrites,
  clearPendingWrite,
  flushPendingWrites,
  saveOrQueue,
  PENDING_WRITES_KEY,
  type PendingWrite,
} from "@/lib/pending-writes";

const write = (key: string, over: Partial<PendingWrite> = {}): PendingWrite => ({
  key,
  collection: "meal_plan_entries",
  op: "create",
  payload: { name: "Tacos" },
  queuedAt: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  localStorage.clear();
});

describe("pending-writes queue", () => {
  it("queues a write into localStorage under the pending key", () => {
    queueWrite(write("meal-1"));
    const stored = JSON.parse(localStorage.getItem(PENDING_WRITES_KEY) || "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].key).toBe("meal-1");
    expect(listPendingWrites().map((w) => w.key)).toEqual(["meal-1"]);
  });

  it("replaces an existing entry with the same key instead of duplicating", () => {
    queueWrite(write("meal-1", { payload: { name: "Old" } }));
    queueWrite(write("meal-1", { payload: { name: "New" } }));
    const pending = listPendingWrites();
    expect(pending).toHaveLength(1);
    expect(pending[0].payload.name).toBe("New");
  });

  it("flushPendingWrites removes entries the runner saves and keeps failures", async () => {
    queueWrite(write("ok-1"));
    queueWrite(write("bad-1"));
    const result = await flushPendingWrites(async (w) => w.key.startsWith("ok-"));
    expect(result).toEqual({ flushed: 1, remaining: 1 });
    expect(listPendingWrites().map((w) => w.key)).toEqual(["bad-1"]);
  });

  it("flushPendingWrites keeps an entry when the runner throws", async () => {
    queueWrite(write("boom"));
    const result = await flushPendingWrites(async () => {
      throw new Error("network down");
    });
    expect(result).toEqual({ flushed: 0, remaining: 1 });
    expect(listPendingWrites().map((w) => w.key)).toEqual(["boom"]);
  });

  it("saveOrQueue returns true and queues nothing when the save succeeds", async () => {
    const ok = await saveOrQueue(write("meal-1"), async () => ({ id: "abc" }));
    expect(ok).toBe(true);
    expect(listPendingWrites()).toHaveLength(0);
  });

  it("saveOrQueue queues and returns false when the save returns null", async () => {
    const ok = await saveOrQueue(write("meal-1"), async () => null);
    expect(ok).toBe(false);
    expect(listPendingWrites().map((w) => w.key)).toEqual(["meal-1"]);
  });

  it("saveOrQueue clears a previously queued entry when a retry succeeds", async () => {
    queueWrite(write("meal-1"));
    const ok = await saveOrQueue(write("meal-1"), async () => ({ id: "abc" }));
    expect(ok).toBe(true);
    expect(listPendingWrites()).toHaveLength(0);
  });

  it("clearPendingWrite removes a single entry by key", () => {
    queueWrite(write("a"));
    queueWrite(write("b"));
    clearPendingWrite("a");
    expect(listPendingWrites().map((w) => w.key)).toEqual(["b"]);
  });
});
