// @vitest-environment jsdom
process.env.TZ = "UTC";

// The task row the server actually writes is the snapshot projection
// (`taskProjectionRecord`), so the assigneeEmoji write gate is pinned there:
// PB tasks.assigneeEmoji is text max=5000 and a raw photo data-URL would fail
// validation_max_text_constraint and lose the whole row.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

import { todayISO, todayMondayISO } from "@/lib/task-utils";
import { taskProjectionRecord } from "@/lib/snapshot-tasks";
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

describe("task projection assigneeEmoji sanitization", () => {
  it("never forwards a photo data-URL to the tasks collection (PB text max=5000)", () => {
    const row = taskProjectionRecord(t({ assigneeEmoji: PHOTO }) as any);
    expect(row.assigneeEmoji).toBe("👤");
    expect(String(row.assigneeEmoji).length).toBeLessThanOrEqual(PB_TASK_EMOJI_MAX);
  });

  it("keeps a short glyph intact", () => {
    expect(taskProjectionRecord(t({ assigneeEmoji: "🧒" }) as any).assigneeEmoji).toBe("🧒");
  });

  it("gates crew member emojis the same way", () => {
    const row = taskProjectionRecord(
      t({ crew: { size: 2, members: [{ name: "Bailey", emoji: PHOTO }] } as any }) as any,
    );
    expect((row.crew as any).members[0].emoji).toBe("👤");
  });
});
