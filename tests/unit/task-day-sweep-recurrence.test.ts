import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  regenerateRecurringOnTasks,
} from "@/lib/task-day-sweep";
import { recurringLineage, isDailyRecurrence, isWeekdayRecurrence } from "@/lib/task-recurrence";

const DAY = "2026-10-01"; // Thursday

function task(overrides: Record<string, unknown> = {}): any {
  return {
    id: 100, title: "Dishes", assignee: "Alex", assigneeEmoji: "🦊",
    due: "2026-09-30", points: 5, recurring: "daily", category: "chores",
    priority: "medium", completed: false, ...overrides,
  };
}

function issueFrom(ids: number[]): (existing: ReadonlySet<number>) => number {
  let next = 1_000_000;
  return (existing) => { while (existing.has(next)) next += 1; return next++; };
}

describe("regenerateRecurringOnTasks", () => {
  it("consumes yesterday's missed daily and spawns exactly one today clone", () => {
    const result = regenerateRecurringOnTasks([task()], DAY, "2026-09-28", "now", issueFrom([]));
    expect(result.deletedIds).toEqual([100]);
    expect(result.tasks).toHaveLength(1);
    const clone = result.tasks[0];
    expect(clone.id).not.toBe(100);
    expect(clone.due).toBe(DAY);
    expect(clone.completed).toBe(false);
    expect(clone.recurring).toBe("daily");
  });

  it("is idempotent: a live instance for today blocks any second spawn", () => {
    const result = regenerateRecurringOnTasks([task({ id: 101, due: DAY })], DAY, "2026-09-28", "now", issueFrom([]));
    expect(result.deletedIds).toEqual([]);
    expect(result.tasks.map((t: any) => t.id)).toEqual([101]);
  });

  it("consumes every stale instance after an offline gap and spawns one", () => {
    const stale = [task({ id: 1, due: "2026-09-28" }), task({ id: 2, due: "2026-09-29" }), task({ id: 3, due: "2026-09-30" })];
    const result = regenerateRecurringOnTasks(stale, DAY, "2026-09-28", "now", issueFrom([]));
    expect(result.deletedIds.sort()).toEqual([1, 2, 3]);
    expect(result.tasks).toHaveLength(1);
  });

  it("leaves a pending-approval instance alone but still spawns today", () => {
    const pending = task({ id: 4, completed: true, pendingApproval: { byName: "Alex", at: "t", points: 5 } });
    const result = regenerateRecurringOnTasks([pending], DAY, "2026-09-28", "now", issueFrom([]));
    expect(result.deletedIds).toEqual([]);
    expect(result.tasks.map((t: any) => t.id).sort((a: number, b: number) => a - b)).toEqual([4, 1000000]);
  });

  it("weekdays: consumes on Saturday but does not spawn until Monday", () => {
    const sat = "2026-10-03";
    const consumed = regenerateRecurringOnTasks([task({ recurring: "weekdays", due: "2026-10-02" })], sat, "2026-09-28", "now", issueFrom([]));
    expect(consumed.deletedIds).toEqual([100]);
    expect(consumed.tasks).toHaveLength(0);
  });

  it("scrubs speedBonus on crew lineage clones (vestige fix)", () => {
    const crew = task({ crewSize: 2, crew: { members: [] }, speedBonus: 2, recurring: "daily" });
    const result = regenerateRecurringOnTasks([crew], DAY, "2026-09-28", "now", issueFrom([]));
    expect(result.tasks[0].speedBonus ?? 0).toBe(0);
  });

  it("groups lineages exactly like the weekly rollover (shared key)", () => {
    const a = task({ id: 10, title: "Dishes", assignee: "Alex" });
    const b = task({ id: 11, title: "Dishes", assignee: "Bailey" });
    expect(recurringLineage(a)).not.toBe(recurringLineage(b));
    const result = regenerateRecurringOnTasks([a, b], DAY, "2026-09-28", "now", issueFrom([]));
    expect(result.tasks).toHaveLength(2); // one clone per lineage
  });
});

describe("one recurrence writer", () => {
  it("has no client-side regenerateRecurringTasks anywhere in src/", () => {
    const root = join(process.cwd(), "src");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        if (readFileSync(full, "utf8").includes("regenerateRecurringTasks")) offenders.push(full);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
