import { describe, it, expect } from "vitest";
import { buildCrewClosePending, crewCloseAwardList } from "@/lib/task-crew-close";
import type { Task } from "@/types/tasks";

const WEEK = "2026-09-28";

function crewTask(over: Partial<Task> = {}): Task {
  return {
    id: 21, title: "Backyard cleanup", assignee: "Crew", assigneeEmoji: "🤝",
    due: WEEK, points: 15, recurring: null, category: "chores",
    completed: false, priority: "medium", crewSize: 4,
    crew: {
      members: [
        { name: "Caspian Garcia", emoji: "🧒", joinedAt: `${WEEK}T07:00:00.000Z`, checkedInAt: `${WEEK}T09:00:00.000Z` },
        { name: "Bailey Garcia", emoji: "👧", joinedAt: `${WEEK}T07:05:00.000Z` },
        { name: "Aurora Garcia", emoji: "👧", joinedAt: `${WEEK}T07:10:00.000Z`, checkedInAt: `${WEEK}T09:10:00.000Z` },
      ],
      removed: [],
    },
    crewCloseMode: "parent",
    ...over,
  } as Task;
}

describe("crewCloseAwardList", () => {
  it("awards exactly the checked-in, non-removed members", () => {
    const r = crewCloseAwardList(crewTask());
    expect(r).toEqual({ ok: true, awardList: ["Caspian Garcia", "Aurora Garcia"] });
  });
  it("refuses a strict-mode task", () => {
    expect(crewCloseAwardList(crewTask({ crewCloseMode: "strict" }))).toEqual({ ok: false, reason: "strict_mode" });
    expect(crewCloseAwardList(crewTask({ crewCloseMode: undefined }))).toEqual({ ok: false, reason: "strict_mode" });
  });
  it("refuses a deadline-mode task (sweep or parent close come from their own paths)", () => {
    expect(crewCloseAwardList(crewTask({ crewCloseMode: "deadline" }))).toEqual({ ok: false, reason: "strict_mode" });
  });
  it("refuses with no check-ins", () => {
    const t = crewTask();
    t.crew = { members: t.crew!.members.map(({ checkedInAt: _drop, ...m }) => m), removed: [] };
    expect(crewCloseAwardList(t)).toEqual({ ok: false, reason: "no_checkins" });
  });
  it("refuses non-crew and already-completed tasks", () => {
    expect(crewCloseAwardList(crewTask({ crewSize: null, crew: null }))).toEqual({ ok: false, reason: "not_crew_task" });
    expect(crewCloseAwardList(crewTask({ completed: true, pendingApproval: { byName: "Crew", at: "x", points: 15, crew: ["Caspian Garcia"] } }))).toEqual({ ok: false, reason: "already_completed" });
  });
  it("defense-in-depth: a removed member carrying a check-in stamp is never awarded", () => {
    const t = crewTask();
    t.crew!.members = t.crew!.members.map((m) =>
      m.name === "Bailey Garcia" ? { ...m, checkedInAt: `${WEEK}T09:05:00.000Z` } : m,
    );
    expect(crewCloseAwardList(t)).toEqual({ ok: true, awardList: ["Caspian Garcia", "Bailey Garcia", "Aurora Garcia"] });
    t.crew!.removed = ["Bailey Garcia"];
    expect(crewCloseAwardList(t)).toEqual({ ok: true, awardList: ["Caspian Garcia", "Aurora Garcia"] });
  });
});

describe("buildCrewClosePending", () => {
  it("stages a Crew pendingApproval with the award list and the task's points", () => {
    const p = buildCrewClosePending(crewTask(), ["Caspian Garcia", "Aurora Garcia"], "2026-09-29T10:00:00.000Z");
    expect(p).toEqual({ byName: "Crew", at: "2026-09-29T10:00:00.000Z", points: 15, crew: ["Caspian Garcia", "Aurora Garcia"] });
  });
});
