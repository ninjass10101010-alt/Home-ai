// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  insertEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
}));

vi.mock("@/db", () => ({ db: h }));

import { queueWrite, listPendingWrites, flushPendingWrites } from "@/lib/pending-writes";

beforeEach(() => {
  localStorage.clear();
  h.insertEvent.mockReset();
  h.updateEvent.mockReset();
  h.deleteEvent.mockReset();
});

describe("pending-writes events branch (default db runner)", () => {
  it("replays a queued event create through db.insertEvent", async () => {
    h.insertEvent.mockResolvedValue({ id: "pb_e1" });
    queueWrite({
      key: "event:create:Recital|2026-09-15|7:00 PM",
      collection: "events",
      op: "create",
      payload: { title: "Recital", date: "2026-09-15", time: "7:00 PM", icon: "🎹", color: "amber", member: "Emily" },
      queuedAt: new Date().toISOString(),
    });

    const { flushed, remaining } = await flushPendingWrites();
    expect(h.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Recital", date: "2026-09-15" })
    );
    expect(flushed).toBe(1);
    expect(remaining).toBe(0);
    expect(listPendingWrites()).toHaveLength(0);
  });

  it("replays queued event update/delete through the db client", async () => {
    h.updateEvent.mockResolvedValue({ id: "abc123" });
    h.deleteEvent.mockResolvedValue(true);
    queueWrite({
      key: "event:update:abc123",
      collection: "events",
      op: "update",
      id: "abc123",
      payload: { title: "Recital (moved)" },
      queuedAt: new Date().toISOString(),
    });
    queueWrite({
      key: "event:delete:def456",
      collection: "events",
      op: "delete",
      id: "def456",
      queuedAt: new Date().toISOString(),
    });

    const { flushed } = await flushPendingWrites();
    expect(h.updateEvent).toHaveBeenCalledWith("abc123", { title: "Recital (moved)" });
    expect(h.deleteEvent).toHaveBeenCalledWith("def456");
    expect(flushed).toBe(2);
  });

  it("keeps the write queued when the db call fails", async () => {
    h.insertEvent.mockResolvedValue(null);
    queueWrite({
      key: "event:create:X|2026-09-15|",
      collection: "events",
      op: "create",
      payload: { title: "X" },
      queuedAt: new Date().toISOString(),
    });

    const { flushed, remaining } = await flushPendingWrites();
    expect(flushed).toBe(0);
    expect(remaining).toBe(1);
    expect(listPendingWrites()).toHaveLength(1);
  });
});
