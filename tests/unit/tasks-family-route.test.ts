/**
 * SP1.7 Task 3 — the signed-out wall reads the family's chores.
 *
 * The wall is a FAMILY DISPLAY: the calendar, the schedules, the meals, the
 * photos and the roster are already session-exempt reads, so a signed-out
 * panel still shows the family's information. The tasks card was the last
 * surface that was not — /api/tasks/sync needs a live session, so the wall
 * showed "Sign in to see the family's tasks" while every other card stayed
 * alive.
 *
 * The fix is ONE new public read: /api/tasks/family. It reads the SAME
 * snapshot the signed-in path reads (the `tasks-snapshot` record) and projects
 * the CHORES ONLY — `{ id, title, assignee, done }`. Never points, never the
 * pending-approval queue, never the ledger, never a PIN.
 *
 * These tests pin:
 *   1. an ANONYMOUS request (no cookie) answers 200 with the family's chores;
 *   2. the body carries NO points / approvals / completions / ledger / PIN;
 *   3. a done chore (the row the approval queue lives in) is not exposed;
 *   4. an unreadable snapshot is an honest 503, never a fabricated empty list;
 *   5. the middleware exempts the new path and STILL gates points, approvals
 *      and the ledger.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({ withAdmin: vi.fn() }));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import { GET as FAMILY_GET } from "@/app/api/tasks/family/route";
import { isExempt } from "@/middleware";

const FAMILY_URL = "http://localhost/api/tasks/family";

type Row = Record<string, any>;

function openTask(overrides: Row = {}): Row {
  return {
    id: 1,
    title: "Dishes",
    assignee: "Aurora",
    assigneeEmoji: "🌈",
    due: "Today",
    points: 10,
    completed: false,
    recurring: null,
    category: "chores",
    priority: "medium",
    ...overrides,
  };
}

/** A completed row — this is where the approval queue lives. */
function doneTask(overrides: Row = {}): Row {
  return {
    id: 2,
    title: "Take out the trash",
    assignee: "Caspian",
    points: 6,
    completed: true,
    completedBy: "Caspian",
    completedAt: "2026-10-21T18:00:00.000Z",
    completedInWeek: "2026-10-19",
    pendingApproval: { byName: "Caspian", at: "2026-10-21T18:00:00.000Z", points: 6 },
    awardedPoints: 6,
    ...overrides,
  };
}

function snapshotPb(rows: Row[]) {
  const calls: { collection: string; filter?: string }[] = [];
  return {
    calls,
    pb: {
      collection: (name: string) => ({
        getFullList: async (opts?: { filter?: string }) => {
          calls.push({ collection: name, filter: opts?.filter });
          return rows;
        },
      }),
    },
  };
}

function snapshotRow(tasks: Row[], deletedTaskIds: number[] = []): Row {
  return {
    id: "snap-1",
    key: "tasks-snapshot",
    data: {
      tasks,
      deletedTaskIds,
      weekData: {
        weekStart: "2026-10-19",
        points: { Aurora: 10 },
        streak: {},
        lastActive: {},
        history: [{ id: 1, timestamp: "2026-10-21T10:00:00.000Z", member: "Aurora", type: "earn", amount: 10, description: "Completed: Dishes" }],
      },
    },
  };
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
});

describe("GET /api/tasks/family — a session-exempt read of the family's chores", () => {
  it("answers an ANONYMOUS request with the family's open chores", async () => {
    const { pb } = snapshotPb([snapshotRow([openTask(), doneTask()])]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await FAMILY_GET(new Request(FAMILY_URL));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.chores).toEqual([
      { id: 1, title: "Dishes", assignee: "Aurora", done: false },
    ]);
  });

  it("reads the SAME snapshot the signed-in path reads (the tasks-snapshot record)", async () => {
    const { pb, calls } = snapshotPb([snapshotRow([openTask()])]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    await FAMILY_GET(new Request(FAMILY_URL));

    expect(calls).toEqual([
      { collection: "consuela_data_snapshots", filter: 'key = "tasks-snapshot"' },
    ]);
  });

  it("carries NO points, NO approvals, NO completions, NO ledger and NO PIN state", async () => {
    const { pb } = snapshotPb([
      snapshotRow([
        openTask({ points: 25, awardedPoints: 25, sentBackAt: "2026-10-21T10:00:00.000Z", pendingApproval: null }),
        doneTask(),
      ]),
    ]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await FAMILY_GET(new Request(FAMILY_URL));
    const body = await res.json();
    const raw = JSON.stringify(body);

    for (const banned of [
      "points",
      "awardedPoints",
      "pendingApproval",
      "completedBy",
      "completedAt",
      "completedInWeek",
      "sentBackAt",
      "crew",
      "ledger",
      "weekData",
      "history",
      "pin",
      "PIN",
    ]) {
      expect({ banned, present: raw.includes(banned) }).toEqual({ banned, present: false });
    }
    // Every chore is EXACTLY the four projected fields — nothing rides along.
    for (const chore of body.chores) {
      expect(Object.keys(chore).sort()).toEqual(["assignee", "done", "id", "title"]);
    }
  });

  it("does NOT expose a done chore — that row is where the approval queue lives", async () => {
    const { pb } = snapshotPb([snapshotRow([openTask(), doneTask()])]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await FAMILY_GET(new Request(FAMILY_URL));
    const body = await res.json();

    expect(body.chores).toHaveLength(1);
    expect(body.chores.map((c: Row) => c.id)).toEqual([1]);
    expect(JSON.stringify(body)).not.toContain("Take out the trash");
  });

  it("drops a tombstoned chore (a deleted task never leaves the wall)", async () => {
    const { pb } = snapshotPb([snapshotRow([openTask(), openTask({ id: 9, title: "Old chore" })], [9])]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await FAMILY_GET(new Request(FAMILY_URL));
    const body = await res.json();

    expect(body.chores).toEqual([{ id: 1, title: "Dishes", assignee: "Aurora", done: false }]);
  });

  it("an unreadable snapshot is an honest 503 — never a fabricated empty list", async () => {
    mocks.withAdmin.mockRejectedValue(new Error("pocketbase down"));

    const res = await FAMILY_GET(new Request(FAMILY_URL));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("snapshot_unavailable");
    // No `chores` key at all: "no truth" must never read as "no chores".
    expect(body.chores).toBeUndefined();
  });

  it("a snapshot with no chore rows is an honest EMPTY list", async () => {
    const { pb } = snapshotPb([snapshotRow([])]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await FAMILY_GET(new Request(FAMILY_URL));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, chores: [] });
  });
});

describe("the middleware exemption for the family's chores", () => {
  it("exempts the chores route", () => {
    expect(isExempt("/api/tasks/family")).toBe(true);
  });

  it("STILL gates the full snapshot (points + approvals + the ledger) behind a session", () => {
    expect(isExempt("/api/tasks/sync")).toBe(false);
    expect(isExempt("/api/tasks")).toBe(false);
    // The sibling PIN routes stay in the exempt list on their own terms — they
    // self-authenticate the member PIN at the ROUTE level — so the exemption
    // this wave adds is the CHORES route only.
    expect(isExempt("/api/tasks/claim")).toBe(true);
    expect(isExempt("/api/tasks/approve")).toBe(true);
    expect(isExempt("/api/tasks/ledger")).toBe(true);
  });

  it("says plainly what is public, why, and what stays gated", () => {
    const source = readFileSync(path.join(process.cwd(), "src/middleware.ts"), "utf8");
    const entry = source.indexOf('"/api/tasks/family"');
    expect(entry).toBeGreaterThan(-1);
    // The comment sits ABOVE its entry — read the window that carries it.
    const block = source.slice(Math.max(0, entry - 1500), entry + 200);
    expect(block).toContain("/api/tasks/family");
    // WHY: the wall is a family display and the sibling reads are already public.
    expect(block).toMatch(/wall/i);
    expect(block).toMatch(/calendar|schedules|meals|photos|roster/i);
    // WHAT stays gated: the money and the approvals.
    expect(block).toMatch(/points/i);
    expect(block).toMatch(/approvals?/i);
    expect(block).toMatch(/ledger/i);
  });
});
