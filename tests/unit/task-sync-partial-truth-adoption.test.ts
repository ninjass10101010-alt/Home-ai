// @vitest-environment node
// B1a RED — "an unreconciled /api/tasks/sync still hands the device its
// truth". Symptom (c): the read answers 503 for ANY `reconciled === false`
// (sync/route.ts:195) even when the snapshot itself was read successfully and
// carries the pending row. Both consumers branch on the status alone
// (`src/db/index.ts:221`, `src/app/tasks/page.tsx:762-767`), so the entire
// body — snapshot included — is thrown away and the row never lands. The
// `failed` categories the 503 does carry are read by nobody.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  requireLiveSession: vi.fn(),
  ensureCurrentTaskWeek: vi.fn(),
  ensureCurrentTaskDay: vi.fn(),
  reconcileTaskProjectionLocked: vi.fn(),
  drainDueTaskCommandQueue: vi.fn(),
  snapshotRows: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));
vi.mock("@/lib/server-auth", () => ({
  requireLiveSession: mocks.requireLiveSession,
}));
vi.mock("@/lib/session", () => ({
  verifySession: vi.fn(),
  SESSION_COOKIE: "consuela_session",
}));
vi.mock("@/lib/task-week-rollover", () => ({
  ensureCurrentTaskWeek: mocks.ensureCurrentTaskWeek,
}));
vi.mock("@/lib/task-day-sweep", () => ({
  ensureCurrentTaskDay: mocks.ensureCurrentTaskDay,
}));
vi.mock("@/lib/task-projection-reconciler", () => ({
  reconcileTaskProjectionLocked: mocks.reconcileTaskProjectionLocked,
}));
vi.mock("@/lib/task-command-queue-server", () => ({
  drainDueTaskCommandQueue: mocks.drainDueTaskCommandQueue,
}));

import { GET } from "@/app/api/tasks/sync/route";

function mondayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().split("T")[0];
}

const PENDING_ROW = {
  id: 101,
  title: "Sweep the kitchen floor",
  assignee: "Caspian Garcia",
  points: 5,
  completed: true,
  completedBy: "Caspian Garcia",
  completedInWeek: mondayISO(),
  pendingApproval: { byName: "Caspian Garcia", at: "2026-09-19T18:00:00.000Z", points: 5 },
};

const SNAPSHOT = {
  tasks: [PENDING_ROW],
  deletedTaskIds: [],
  weekData: { weekStart: mondayISO(), points: {}, streak: {}, lastActive: {}, history: [] },
  revision: "5",
};

function getSync() {
  return GET(new NextRequest("http://x/api/tasks/sync"));
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.requireLiveSession.mockReset();
  mocks.ensureCurrentTaskWeek.mockReset();
  mocks.ensureCurrentTaskDay.mockReset();
  mocks.reconcileTaskProjectionLocked.mockReset();
  mocks.drainDueTaskCommandQueue.mockReset();
  mocks.snapshotRows.mockReset();

  mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) =>
    fn({ collection: () => ({ getFullList: mocks.snapshotRows }) }));
  mocks.requireLiveSession.mockResolvedValue({ ok: true });
  mocks.drainDueTaskCommandQueue.mockResolvedValue(undefined);
  mocks.ensureCurrentTaskWeek.mockResolvedValue({
    reconciled: true,
    weekStart: mondayISO(),
    revision: { revision: "5" },
    currentWeekData: SNAPSHOT.weekData,
  });
  mocks.ensureCurrentTaskDay.mockResolvedValue({
    reconciled: true,
    revision: { revision: "5" },
    failed: [],
  });
  mocks.reconcileTaskProjectionLocked.mockResolvedValue({
    reconciled: true,
    repaired: [],
    failed: [],
    warnings: [],
  });
  mocks.snapshotRows.mockResolvedValue([
    // The `data` json field holds an OBJECT on the wire (PB parses a json
    // column); the string form was a fixture slip that no route ever produced.
    { id: "snap-1", key: "tasks-snapshot", data: SNAPSHOT },
  ]);
});

describe("an unreconciled /api/tasks/sync still hands the device its truth", () => {
  it("answers 200 with the readable snapshot when only the projection repair is pending", async () => {
    mocks.reconcileTaskProjectionLocked.mockResolvedValue({
      reconciled: false,
      repaired: [],
      failed: ["projection:unavailable"],
      warnings: [],
    });

    const res = await getSync();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.snapshot.tasks).toHaveLength(1);
    expect(body.failed).toEqual([]);
  });

  it("still refuses to answer 200 when the snapshot read itself failed", async () => {
    mocks.snapshotRows.mockRejectedValue(new Error("pb unavailable"));

    const res = await getSync();
    const body = await res.json();

    expect(res.status).not.toBe(200);
    expect(body.snapshot).toBeNull();
  });
});
