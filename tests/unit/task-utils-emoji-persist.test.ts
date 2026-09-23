// @vitest-environment jsdom
process.env.TZ = "UTC";

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db", () => ({
  db: {
    upsertTask: vi.fn(async () => ({})),
    selectHallOfFame: vi.fn(async () => []),
    insertHallOfFameEntry: vi.fn(async () => null),
  },
}));

import { db } from "@/db";
import { syncTasksToPB, todayISO, todayMondayISO } from "@/lib/task-utils";
import { PB_TASK_EMOJI_MAX } from "@/lib/task-emoji";
import type { Task } from "@/types/tasks";

const PHOTO = `data:image/webp;base64,${"B".repeat(193_102)}`;

function t(over: Partial<Task> = {}): Task {
  return {
    id: 7,
    title: "Vaccum steps",
    assignee: "Bailey",
    assigneeEmoji: "👧",
    due: todayISO(),
    points: 10,
    recurring: null,
    category: "chores",
    completed: false,
    priority: "medium",
    completedInWeek: todayMondayISO(),
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(db.upsertTask).mockClear();
});

describe("syncTasksToPB assigneeEmoji sanitization", () => {
  it("never forwards a photo data-URL to db.upsertTask (PB text max=5000)", async () => {
    await syncTasksToPB([t({ assigneeEmoji: PHOTO })]);
    const row = vi.mocked(db.upsertTask).mock.calls.at(-1)![0];
    expect(row.assigneeEmoji).toBe("👤");
    expect(String(row.assigneeEmoji).length).toBeLessThanOrEqual(PB_TASK_EMOJI_MAX);
  });

  it("keeps a short glyph intact", async () => {
    await syncTasksToPB([t({ assigneeEmoji: "🧒" })]);
    const row = vi.mocked(db.upsertTask).mock.calls.at(-1)![0];
    expect(row.assigneeEmoji).toBe("🧒");
  });

  it("surfaces a failed upsert instead of swallowing it (Fix 4)", async () => {
    vi.mocked(db.upsertTask).mockRejectedValueOnce(
      new Error("Failed to create record: validation_max_text_constraint")
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(syncTasksToPB([t()])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    const msg = String(warn.mock.calls[0]?.[0] ?? "");
    expect(msg).toContain("syncTasksToPB failed");
    // The rejection body must reach the log — a bare message loses the field name.
    const errArg = warn.mock.calls[0]?.[1];
    expect(String(errArg)).toContain("validation_max_text_constraint");
    warn.mockRestore();
  });
});
