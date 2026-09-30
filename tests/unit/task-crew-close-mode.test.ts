import { describe, it, expect } from "vitest";
import { normalizeCrewCloseMode, crewCloseModeOf } from "@/lib/task-utils";
import { taskProjectionRecord } from "@/lib/snapshot-tasks";
import type { Task } from "@/types/tasks";

describe("normalizeCrewCloseMode", () => {
  it("returns the mode for valid strings", () => {
    expect(normalizeCrewCloseMode("strict")).toBe("strict");
    expect(normalizeCrewCloseMode("parent")).toBe("parent");
    expect(normalizeCrewCloseMode("deadline")).toBe("deadline");
  });
  it("returns null for absent values (caller defaults)", () => {
    expect(normalizeCrewCloseMode(undefined)).toBeNull();
    expect(normalizeCrewCloseMode(null)).toBeNull();
  });
  it("returns null for garbage (fail-closed surface of invalid input)", () => {
    expect(normalizeCrewCloseMode("weekly")).toBeNull();
    expect(normalizeCrewCloseMode(3)).toBeNull();
    expect(normalizeCrewCloseMode("STRICT")).toBeNull();
    expect(normalizeCrewCloseMode(" strict")).toBeNull();
  });
});

describe("crewCloseModeOf", () => {
  it("defaults absent or invalid stored values to strict", () => {
    expect(crewCloseModeOf({})).toBe("strict");
    expect(crewCloseModeOf({ crewCloseMode: null })).toBe("strict");
    expect(crewCloseModeOf({ crewCloseMode: "bogus" })).toBe("strict");
  });
  it("passes through a stored valid value", () => {
    expect(crewCloseModeOf({ crewCloseMode: "parent" })).toBe("parent");
    expect(crewCloseModeOf({ crewCloseMode: "deadline" })).toBe("deadline");
  });
});

describe("taskProjectionRecord", () => {
  it("carries crewCloseMode to the PB tasks projection", () => {
    const task = {
      id: 7, title: "Rake", assignee: "Crew", assigneeEmoji: "🤝",
      due: "2026-09-29", points: 15, recurring: null, category: "chores",
      completed: false, priority: "medium",
      crewSize: 3, crew: { members: [], removed: [] }, crewCloseMode: "deadline",
    } as unknown as Task;
    expect(taskProjectionRecord(task).crewCloseMode).toBe("deadline");
  });
  it("writes null when absent (legacy crew rows project null)", () => {
    const task = {
      id: 8, title: "Rake", assignee: "Crew", assigneeEmoji: "🤝",
      due: "2026-09-29", points: 15, recurring: null, category: "chores",
      completed: false, priority: "medium",
      crewSize: 3, crew: { members: [] },
    } as unknown as Task;
    expect(taskProjectionRecord(task).crewCloseMode).toBeNull();
  });
});
