// Anti-typo pin for the U3-0 visual gate's fixtures (Task 6 §B-2 item 5).
//
// A fixture whose shape does not match `GET /api/tasks/sync` renders an empty
// board and lets every visual criterion pass vacuously — that is the loophole
// this suite exists to close, before a browser is ever opened. Every assertion
// here is against the real route's response shape (src/app/api/tasks/sync/route.ts:185-196)
// and the real Task / PendingApproval contracts (src/types/tasks.ts:3-68).

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const FIXTURES_DIR = path.join(process.cwd(), "scripts", "visual-review", "fixtures", "tasks");

// The route's 200 body keys, verbatim.
const ROUTE_SUCCESS_KEYS = ["failed", "ok", "reconciled", "repaired", "snapshot", "warnings"];
// The route's 503 body keys (no `warnings` on the failure arms).
const ROUTE_FAILURE_KEYS = ["error", "failed", "ok", "reconciled", "repaired", "snapshot"];
const FIXTURE_NAMES = ["populated.json", "in-flight.json", "loading.json", "queue-drained.json", "sync-failed.json"];
const ROUTE_BODY_FIXTURES = ["populated.json", "in-flight.json", "loading.json", "queue-drained.json"];

const read = (name: string) => JSON.parse(readFileSync(path.join(FIXTURES_DIR, name), "utf8"));

describe("tasks visual-review fixtures match the /api/tasks/sync contract (U3-0)", () => {
  it("ships exactly the five named fixtures", () => {
    expect(readdirSync(FIXTURES_DIR).sort()).toEqual([...FIXTURE_NAMES].sort());
  });

  it("every 200 fixture's top-level keys are exactly the route's success keys", () => {
    for (const name of ROUTE_BODY_FIXTURES) {
      const body = read(name);
      expect(Object.keys(body).sort(), name).toEqual(ROUTE_SUCCESS_KEYS);
      expect(body.ok, name).toBe(true);
      expect(body.snapshot, name).toBeTruthy();
      expect(body.reconciled, name).toBe(true);
      expect(Array.isArray(body.repaired), name).toBe(true);
      expect(Array.isArray(body.failed), name).toBe(true);
      expect(Array.isArray(body.warnings), name).toBe(true);
    }
  });

  it("sync-failed is a 503 envelope whose body carries exactly the route's failure keys", () => {
    const fixture = read("sync-failed.json");
    expect(fixture.status).toBe(503);
    expect(Object.keys(fixture.body).sort()).toEqual(ROUTE_FAILURE_KEYS);
    expect(fixture.body.ok).toBe(false);
    expect(fixture.body.error).toBe("rollover_unavailable");
    expect(fixture.body.snapshot).toBeNull();
    expect(fixture.body.failed.length).toBeGreaterThan(0);
  });

  it("snapshot.tasks is non-empty for the row-bearing fixtures", () => {
    for (const name of ["populated.json", "in-flight.json", "loading.json"]) {
      const tasks = read(name).snapshot.tasks;
      expect(Array.isArray(tasks), name).toBe(true);
      expect(tasks.length, name).toBeGreaterThan(0);
    }
  });

  it("every pendingApproval has exactly byName/at/points (+ optional crew)", () => {
    for (const name of ["populated.json", "in-flight.json", "loading.json"]) {
      const pending = read(name).snapshot.tasks.filter((t: any) => t.pendingApproval);
      expect(pending.length, name).toBeGreaterThan(0);
      for (const task of pending) {
        const keys = Object.keys(task.pendingApproval).sort();
        const required = ["at", "byName", "points"];
        expect(keys.filter((k: string) => required.includes(k)).sort(), `${name} task ${task.id}`).toEqual(required);
        expect(
          keys.every((k: string) => ["at", "byName", "points", "crew"].includes(k)),
          `${name} task ${task.id} has an unexpected pendingApproval key`,
        ).toBe(true);
        expect(typeof task.pendingApproval.byName).toBe("string");
        expect(Number.isFinite(Date.parse(task.pendingApproval.at))).toBe(true);
        expect(typeof task.pendingApproval.points).toBe("number");
        if (task.pendingApproval.crew !== undefined) {
          expect(Array.isArray(task.pendingApproval.crew)).toBe(true);
          expect(task.pendingApproval.crew.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("populated carries 5 pending rows (3 solo / 2 crew), a bonus row, and 11 completed rows across 4 weeks", () => {
    const body = read("populated.json");
    const tasks = body.snapshot.tasks;
    const pending = tasks.filter((t: any) => t.pendingApproval);
    const solo = pending.filter((t: any) => !(t.pendingApproval.crew || []).length);
    const crew = pending.filter((t: any) => (t.pendingApproval.crew || []).length > 0);
    const bonus = pending.filter((t: any) => t.pendingApproval.points !== t.points);
    const settled = tasks.filter((t: any) => t.completed && !t.pendingApproval);
    const weeks = new Set(settled.map((t: any) => t.completedInWeek));
    expect(pending.length).toBe(5);
    expect(solo.length).toBe(3);
    expect(crew.length).toBe(2);
    // Without the bonus row, criterion 1 (the award is the paid amount) is vacuous.
    expect(bonus.length).toBeGreaterThanOrEqual(1);
    expect(settled.length).toBe(11);
    // Fewer than 4 weeks makes U2's grouping a single header.
    expect(weeks.size).toBe(4);
    expect(body.snapshot.weekData.points).toEqual({});
  });

  it("every task row carries the Task contract fields with the right types", () => {
    for (const name of ["populated.json", "in-flight.json", "loading.json"]) {
      for (const task of read(name).snapshot.tasks) {
        expect(typeof task.id, name).toBe("number");
        expect(typeof task.title, name).toBe("string");
        expect(task.title.length, name).toBeGreaterThan(0);
        expect(typeof task.assignee, name).toBe("string");
        expect(typeof task.assigneeEmoji, name).toBe("string");
        expect(typeof task.due, name).toBe("string");
        expect(typeof task.points, name).toBe("number");
        expect(["high", "medium", "low"], name).toContain(task.priority);
        expect(typeof task.completed, name).toBe("boolean");
        expect(typeof task.category, name).toBe("string");
        expect(task.recurring === null || typeof task.recurring === "string", name).toBe(true);
        if (task.completedInWeek !== undefined) {
          expect(task.completedInWeek, name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }
    }
  });

  it("queue-drained is the honest empty read with a present week", () => {
    const body = read("queue-drained.json");
    expect(body.snapshot.tasks).toEqual([]);
    expect(body.snapshot.weekData.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
