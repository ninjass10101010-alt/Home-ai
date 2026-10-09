// Route-level AUTHORIZATION and HONESTY contracts for the task routes this
// wave owns:
//
//   B1  GET /api/tasks/sync performed three server-side WRITES (rollover, day
//       sweep, projection repair) and returned the whole family points ledger
//       with NO route-level authorization at all.
//   B2  That same GET answered an explicitly UNRECONCILED read as HTTP 200 with
//       `ok:false`, and both consumers branch on the status code alone — so an
//       unreconciled snapshot was APPLIED.
//   B3  The rollover's own failure categories (`week_archive:invalid`) never
//       reached the response's failed-category list.
//   B4  /api/tasks/all-time narrowed `week_data` to the current row, so an
//       older-but-unarchived week was silently dropped while the payload
//       asserted `historyComplete: true`.
//   B5  /api/tasks/quarantine answered an UNKNOWN week key with a FABRICATED
//       empty canonical ledger, which the notice renders as "N old entries on
//       this device are not on the server".
//   B6  Two middleware-EXEMPT PIN routes buffered an unbounded body before any
//       credential check.
//   B7  The claim route's error body omitted `error`/`code`, so the outbox's
//       display channel was always empty.
//   B8  `projectionFailures` / `repairRequired` were returned but read by NO
//       surface.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  requireLiveSession: vi.fn(),
  verifyLiveParentSession: vi.fn(),
  getLiveMemberById: vi.fn(),
  verifyPinFromPB: vi.fn(),
  verifySession: vi.fn(),
  ensureCurrentTaskWeek: vi.fn(),
  ensureCurrentTaskDay: vi.fn(),
  reconcileTaskProjectionLocked: vi.fn(),
  executeInternalTaskCommand: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  pbWrites: [] as string[],
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));
vi.mock("@/lib/server-auth", () => ({
  requireLiveSession: (request: Request) => mocks.requireLiveSession(request),
  verifyPinFromPB: mocks.verifyPinFromPB,
}));
vi.mock("@/lib/live-member", () => ({
  verifyLiveParentSession: mocks.verifyLiveParentSession,
  getLiveMemberById: mocks.getLiveMemberById,
}));
vi.mock("@/lib/session", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, verifySession: mocks.verifySession };
});
vi.mock("@/lib/task-week-rollover", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ensureCurrentTaskWeek: mocks.ensureCurrentTaskWeek,
    // The claim route imports the ids from this module; keep them real.
    issueServerTaskId: (actual as any).issueServerTaskId,
  };
});
vi.mock("@/lib/task-day-sweep", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ensureCurrentTaskDay: mocks.ensureCurrentTaskDay,
}));
vi.mock("@/lib/task-projection-reconciler", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  reconcileTaskProjectionLocked: mocks.reconcileTaskProjectionLocked,
}));
vi.mock("@/lib/task-commands", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  executeInternalTaskCommand: mocks.executeInternalTaskCommand,
}));
vi.mock("@/lib/task-claim", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ensureTaskClaimHandlersRegistered: () => {} };
});
vi.mock("@/lib/task-approval", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ensureTaskApprovalHandlersRegistered: () => {} };
});
vi.mock("node:fs/promises", () => ({
  mkdir: mocks.mkdir,
  writeFile: mocks.writeFile,
  default: { mkdir: mocks.mkdir, writeFile: mocks.writeFile },
}));

import { GET as SYNC_GET } from "@/app/api/tasks/sync/route";
import { GET as ALL_TIME_GET, __resetAllTimeCache } from "@/app/api/tasks/all-time/route";
import { POST as QUARANTINE_POST } from "@/app/api/tasks/quarantine/route";
import { POST as CLAIM_POST } from "@/app/api/tasks/claim/route";
import { POST as APPROVE_POST } from "@/app/api/tasks/approve/route";

const SYNC_URL = "http://localhost/api/tasks/sync";
const WEEK = "2026-09-21";

type Row = Record<string, any>;

function earn(id: number, member: string, amount: number, taskId?: number): Row {
  return {
    id,
    timestamp: `2026-09-2${(id % 8) + 1}T10:00:00.000Z`,
    member,
    type: "earn",
    amount,
    description: "Completed: Dishes",
    ...(taskId === undefined ? {} : { taskId }),
  };
}

function week(weekStart: string, history: Row[] = []): Row {
  return { weekStart, points: {}, streak: {}, lastActive: {}, history };
}

// ---------------------------------------------------------------------------
// GET /api/tasks/sync
// ---------------------------------------------------------------------------

function syncSnapshotPb(rows: Row[]) {
  return {
    collection: () => ({
      getFullList: async () => rows,
      update: async () => ({}),
      create: async () => ({}),
    }),
  };
}

function syncRequest(cookie?: string): NextRequest {
  return new NextRequest(SYNC_URL, {
    headers: cookie ? { cookie: `consuela_session=${cookie}` } : {},
  });
}

function happyRollover(extra: Record<string, unknown> = {}) {
  return {
    reconciled: true,
    weekStart: WEEK,
    revision: { revision: "1", updatedAt: "" },
    currentWeekData: week(WEEK),
    failed: [],
    ...extra,
  };
}

function happyDaysweep(extra: Record<string, unknown> = {}) {
  return { day: "2026-09-21", swept: false, closedTaskIds: [], reconciled: true, failed: [], ...extra };
}

function happyReconcile(extra: Record<string, unknown> = {}) {
  return { ok: true, reconciled: true, repaired: [], failed: [], warnings: [], weekData: null, ...extra };
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.requireLiveSession.mockReset().mockResolvedValue({
    ok: true,
    identity: { memberId: "m1", name: "Alex", role: "parent" },
  });
  mocks.verifyLiveParentSession.mockReset().mockResolvedValue({
    ok: true,
    member: { id: "parent-live", name: "Live Parent", role: "parent", emoji: "🧑" },
  });
  mocks.getLiveMemberById.mockReset().mockResolvedValue({
    id: "parent-live",
    name: "Live Parent",
    role: "parent",
    emoji: "🧑",
  });
  mocks.verifyPinFromPB.mockReset().mockResolvedValue({
    id: "parent-live",
    name: "Live Parent",
    role: "parent",
  });
  mocks.verifySession.mockReset().mockResolvedValue(null);
  mocks.ensureCurrentTaskWeek.mockReset().mockResolvedValue(happyRollover());
  mocks.ensureCurrentTaskDay.mockReset().mockResolvedValue(happyDaysweep());
  mocks.reconcileTaskProjectionLocked.mockReset().mockResolvedValue(happyReconcile());
  mocks.executeInternalTaskCommand.mockReset();
  mocks.mkdir.mockReset().mockResolvedValue(undefined);
  mocks.writeFile.mockReset().mockResolvedValue(undefined);
  mocks.pbWrites.length = 0;
  mocks.withAdmin.mockImplementation((fn: any) => fn(syncSnapshotPb([{ id: "row1", data: { tasks: [{ id: "t1" }] } }])));
  __resetAllTimeCache();
});

describe("B1 — GET /api/tasks/sync is authorized BEFORE any of its three write legs", () => {
  it("a guest gets 401 and NOT ONE of rollover, day sweep or projection reconcile runs", async () => {
    mocks.requireLiveSession.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });

    const res = await SYNC_GET(syncRequest());

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, error: "unauthorized" });
    expect(mocks.ensureCurrentTaskWeek).not.toHaveBeenCalled();
    expect(mocks.ensureCurrentTaskDay).not.toHaveBeenCalled();
    expect(mocks.reconcileTaskProjectionLocked).not.toHaveBeenCalled();
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("a member removed from the live roster is refused and no write leg runs", async () => {
    // The signed cookie is still inside its 7-day HMAC window — this is the
    // exact shape of the bug: `src/middleware.ts` proves the cookie, and only
    // a LIVE roster re-read can notice the member is gone.
    mocks.requireLiveSession.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });

    const res = await SYNC_GET(syncRequest("still-signed-but-removed"));

    expect(res.status).toBe(401);
    expect(mocks.ensureCurrentTaskWeek).not.toHaveBeenCalled();
    expect(mocks.ensureCurrentTaskDay).not.toHaveBeenCalled();
    expect(mocks.reconcileTaskProjectionLocked).not.toHaveBeenCalled();
  });

  it("a DEMOTED member is refused 403, distinct from an absent one", async () => {
    mocks.requireLiveSession.mockResolvedValue({ ok: false, status: 403, error: "session_role_changed" });

    const res = await SYNC_GET(syncRequest("still-signed-but-demoted"));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: "session_role_changed" });
    expect(mocks.ensureCurrentTaskWeek).not.toHaveBeenCalled();
  });

  it("an unreachable roster is 503 and retryable — never an auth failure", async () => {
    mocks.requireLiveSession.mockResolvedValue({ ok: false, status: 503, error: "identity_unavailable" });

    const res = await SYNC_GET(syncRequest());

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: "identity_unavailable" });
    expect(mocks.ensureCurrentTaskWeek).not.toHaveBeenCalled();
  });

  it("a live session still gets the snapshot, for EVERY role — not just a parent", async () => {
    // The decision this pins: session-level, not live-parent. The route is the
    // family-wide read every device polls (kid home, tasks page, screensaver,
    // the 60s refresher), so a parent-only gate would lock kids out of their
    // own tasks. What B1 needed was LIVE identity, not a role.
    for (const role of ["parent", "child", "pet"] as const) {
      mocks.requireLiveSession.mockResolvedValue({
        ok: true,
        identity: { memberId: "m1", name: role, role },
      });
      const res = await SYNC_GET(syncRequest());
      expect(res.status).toBe(200);
      expect((await res.json()).snapshot).toEqual({ tasks: [{ id: "t1" }] });
    }
    expect(mocks.ensureCurrentTaskWeek).toHaveBeenCalledTimes(3);
  });

  it("the live-session gate is the FIRST statement of the handler", () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/api/tasks/sync/route.ts"), "utf8");
    const body = source.slice(source.indexOf("export async function GET"));
    const gate = body.indexOf("requireLiveSession");
    const firstWrite = Math.min(
      ...["ensureCurrentTaskWeek(", "ensureCurrentTaskDay(", "reconcileTaskProjectionLocked("].map(
        (needle) => body.indexOf(needle),
      ),
    );
    expect(gate).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(firstWrite);
  });
});

describe("B1a — a projection-repair pending sync read still hands over its snapshot", () => {
  it("answers 200 with the full body when only the projection leg is unreconciled", async () => {
    mocks.reconcileTaskProjectionLocked.mockResolvedValue(
      happyReconcile({ ok: false, reconciled: false, failed: ["tasks:read"] }),
    );

    const res = await SYNC_GET(syncRequest());

    // B1a (2026-10-09): the snapshot was read successfully and is the family's
    // truth; a pending mirror repair is a warning, not a withheld read.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      error: "projection_reconcile_pending",
      retryable: true,
      snapshot: { tasks: [{ id: "t1" }] },
      reconciled: false,
      repaired: [],
      failed: [],
      warnings: ["projection_reconcile_pending", "tasks:read"],
    });
  });

  it("a reconciled read answers 200 with clean categories", async () => {
    const res = await SYNC_GET(syncRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, reconciled: true, failed: [], warnings: [] });
  });

  it("an unreconciled ROLLOVER is still not 200", async () => {
    mocks.ensureCurrentTaskWeek.mockResolvedValue(
      happyRollover({ reconciled: false, failed: ["week_archive:invalid"] }),
    );
    const res = await SYNC_GET(syncRequest());
    expect(res.status).not.toBe(200);
    expect((await res.json()).reconciled).toBe(false);
  });
});

describe("B3 — the rollover's OWN failure categories reach the response", () => {
  it("surfaces week_archive:invalid instead of only the coarse rollover:pending", async () => {
    mocks.ensureCurrentTaskWeek.mockResolvedValue(
      happyRollover({ reconciled: false, failed: ["week_archive:invalid"] }),
    );

    const res = await SYNC_GET(syncRequest());
    const body = await res.json();

    expect(body.failed).toContain("week_archive:invalid");
    expect(body.failed).toContain("rollover:pending");
    expect(body.reconciled).toBe(false);
  });

  it("week_archive:invalid needs no change to the REPAIR_CATEGORY guard", async () => {
    const { repairCategories, REPAIR_CATEGORY } = await import("@/lib/task-repair-categories");
    expect(REPAIR_CATEGORY.test("week_archive:invalid")).toBe(true);
    expect(repairCategories(["week_archive:invalid", "week_data:invalid"])).toEqual([
      "week_archive:invalid",
      "week_data:invalid",
    ]);
  });

  it("an arbitrary internal string is still refused by the category filter", async () => {
    mocks.ensureCurrentTaskWeek.mockResolvedValue(
      happyRollover({ reconciled: false, failed: ["week_archive:invalid", "pocketbase 500 stack"] }),
    );
    const body = await (await SYNC_GET(syncRequest())).json();
    expect(body.failed).toContain("week_archive:invalid");
    expect(body.failed).not.toContain("pocketbase 500 stack");
  });
});

// ---------------------------------------------------------------------------
// GET /api/tasks/all-time
// ---------------------------------------------------------------------------

function olderWeekStart(currentWeekStart: string): string {
  const date = new Date(`${currentWeekStart}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 7);
  return date.toISOString().slice(0, 10);
}

function allTimePb(dataRows: Row[], archiveRows: Row[], memberRows: Row[] = []) {
  return {
    collection(name: string) {
      if (name === "week_data") return { getFullList: async () => dataRows };
      if (name === "week_archive") return { getFullList: async () => archiveRows };
      if (name === "members") return { getFullList: async () => memberRows };
      throw new Error(`unexpected collection ${name}`);
    },
  };
}

function allTimeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/tasks/all-time");
}

describe("B4 — all-time is honest about an older week_data row that was never archived", () => {
  it("reports historyComplete:false instead of a definite smaller total", async () => {
    const { localWeekStartISO } = await import("@/lib/local-date");
    const current = localWeekStartISO();
    const orphan = olderWeekStart(current);

    mocks.withAdmin.mockImplementation((fn: any) =>
      fn(
        allTimePb(
          [
            { id: "w-cur", weekStart: current, points: {}, streak: {}, lastActive: {}, history: [earn(1, "Alex", 5)] },
            { id: "w-old", weekStart: orphan, points: { Alex: 99 }, streak: {}, lastActive: {}, history: [earn(2, "Alex", 99)] },
          ],
          [],
          [{ id: "m1", name: "Alex", role: "child" }],
        ),
      ),
    );
    __resetAllTimeCache();

    const res = await allTimeRequest && (await ALL_TIME_GET(allTimeRequest()));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.historyComplete).toBe(false);
    expect(body.totals["Alex"]).toEqual({ points: null, completions: null });
    // The 99 points are genuinely unknown — never silently dropped to a 5.
    expect(body.totals["Alex"].points).not.toBe(5);
  });

  it("stays definite once that older week HAS been archived", async () => {
    const { localWeekStartISO } = await import("@/lib/local-date");
    const current = localWeekStartISO();
    const prior = olderWeekStart(current);

    mocks.withAdmin.mockImplementation((fn: any) =>
      fn(
        allTimePb(
          [
            { id: "w-cur", weekStart: current, points: {}, streak: {}, lastActive: {}, history: [earn(1, "Alex", 5)] },
            { id: "w-old", weekStart: prior, points: { Alex: 99 }, streak: {}, lastActive: {}, history: [earn(2, "Alex", 99)] },
          ],
          [
            { id: "wa-old", weekStart: prior, archivedAt: "2026-09-21T06:00:00.000Z", points: { Alex: 99 }, history: [earn(2, "Alex", 99)] },
          ],
          [{ id: "m1", name: "Alex", role: "child" }],
        ),
      ),
    );
    __resetAllTimeCache();

    const res = await ALL_TIME_GET(allTimeRequest());
    const body = await res.json();

    expect(body.historyComplete).toBe(true);
    expect(body.totals["Alex"]).toEqual({ points: 104, completions: 2 });
  });

  it("a single current row with no archive at all stays definite (nothing is missing)", async () => {
    const { localWeekStartISO } = await import("@/lib/local-date");
    const current = localWeekStartISO();

    mocks.withAdmin.mockImplementation((fn: any) =>
      fn(
        allTimePb(
          [{ id: "w-cur", weekStart: current, points: {}, streak: {}, lastActive: {}, history: [earn(1, "Alex", 5)] }],
          [],
          [{ id: "m1", name: "Alex", role: "child" }],
        ),
      ),
    );
    __resetAllTimeCache();

    const body = await (await ALL_TIME_GET(allTimeRequest())).json();
    expect(body.historyComplete).toBe(true);
    expect(body.totals["Alex"]).toEqual({ points: 5, completions: 1 });
  });
});

// ---------------------------------------------------------------------------
// POST /api/tasks/quarantine
// ---------------------------------------------------------------------------

const LOCAL_WEEK = WEEK;

function quarantinePb(options: {
  snapshotWeekStart?: string;
  snapshotHistory?: Row[];
  weekDataRows?: Row[];
  failRead?: boolean;
}) {
  const record = (name: string) => ({
    create: async () => {
      mocks.pbWrites.push(`${name}.create`);
      return { id: "created" };
    },
    update: async () => {
      mocks.pbWrites.push(`${name}.update`);
      return { id: "updated" };
    },
    delete: async () => {
      mocks.pbWrites.push(`${name}.delete`);
      return true;
    },
  });
  return {
    collection: (name: string) => {
      if (name === "consuela_data_snapshots") {
        return {
          getFullList: async () => {
            if (options.failRead) throw new Error("PB unavailable");
            return [
              {
                id: "snap-1",
                data: {
                  revision: "7",
                  weekData: week(options.snapshotWeekStart ?? LOCAL_WEEK, options.snapshotHistory ?? []),
                },
              },
            ];
          },
          ...record(name),
        };
      }
      if (name === "week_data") {
        return {
          getFullList: async () => options.weekDataRows ?? [week(LOCAL_WEEK)],
          ...record(name),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };
}

function quarantineRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/tasks/quarantine", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "consuela_session=parent-cred" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function localWeekWith(weekStart: string, history: Row[]): Row {
  return { weekStart, points: { Alex: 999 }, streak: {}, lastActive: {}, history };
}

describe("B5 — quarantine refuses an unknown week key instead of fabricating an empty ledger", () => {
  it("a week the server has never heard of is refused, never answered empty", async () => {
    mocks.withAdmin.mockImplementation((fn: any) =>
      fn(
        quarantinePb({
          snapshotWeekStart: LOCAL_WEEK,
          weekDataRows: [week(LOCAL_WEEK)],
        }),
      ),
    );

    const res = await QUARANTINE_POST(
      quarantineRequest({ mode: "dry-run", localWeekData: localWeekWith("2026-01-05", [earn(7, "Alex", 5, 42)]) }),
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ error: "canonical_week_unknown" });
    // No fabricated report: no canonicalWeekStart echo, no "everything is
    // quarantined" verdict.
    expect(body.report).toBeUndefined();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("the refusal is unreadable to the notice's own reader, so it cannot render the claim", async () => {
    // `TaskLedgerQuarantineNotice`'s client returns `null` for any non-2xx and
    // only mounts on `json.report.quarantined.length > 0` — so a 409 with no
    // `report` key means the notice never mounts and the parent is never told
    // "N old entries on this device are not on the server". Pinned here because
    // that safety is entirely a property of the ROUTE's response shape; a
    // future 200-with-empty-report here would silently restore the false claim.
    mocks.withAdmin.mockImplementation((fn: any) => fn(quarantinePb({ weekDataRows: [week(LOCAL_WEEK)] })));

    const res = await QUARANTINE_POST(
      quarantineRequest({ mode: "dry-run", localWeekData: localWeekWith("2026-01-05", [earn(7, "Alex", 5, 42)]) }),
    );

    // The client's reader contract, replayed literally.
    const asClientSees = res.ok ? ((await res.json()) as Record<string, any>) : null;
    expect(asClientSees).toBeNull();
    expect(res.ok).toBe(false);
  });

  it("the client-supplied key is never echoed back as the canonical week", async () => {
    // The snapshot holds the family's CURRENT week; a device asking about a
    // different key must be refused rather than matched to it.
    mocks.withAdmin.mockImplementation((fn: any) => fn(quarantinePb({ snapshotWeekStart: LOCAL_WEEK })));
    const res = await QUARANTINE_POST(
      quarantineRequest({ mode: "export", localWeekData: localWeekWith("2026-01-05", [earn(7, "Alex", 5, 42)]) }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "canonical_week_unknown",
      canonicalWeekStart: null,
    });
    expect(mocks.mkdir).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("a MALFORMED week key is refused BEFORE any read", async () => {
    mocks.withAdmin.mockImplementation((fn: any) => fn(quarantinePb({})));

    for (const bad of ["2026-9-21", "2026-02-30", "2026-13-01", "not-a-date", "2026-09-21T00:00:00Z"]) {
      const res = await QUARANTINE_POST(
        quarantineRequest({ mode: "dry-run", localWeekData: localWeekWith(bad, [earn(7, "Alex", 5, 42)]) }),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_quarantine_request" });
    }
    expect(mocks.withAdmin).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("an off-by-one week key is refused, not reported as 'not on the server'", async () => {
    // The device's stored weekData.weekStart is one day off the server's row —
    // the local-vs-UTC week key the bug report describes. The honest answer is
    // "I have no canonical week for that key", NOT "your whole local ledger is
    // bogus".
    mocks.withAdmin.mockImplementation((fn: any) =>
      fn(quarantinePb({ snapshotWeekStart: LOCAL_WEEK, weekDataRows: [week(LOCAL_WEEK)] })),
    );

    const res = await QUARANTINE_POST(
      quarantineRequest({ mode: "dry-run", localWeekData: localWeekWith("2026-09-22", [earn(7, "Alex", 5, 42)]) }),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "canonical_week_unknown", canonicalWeekStart: null });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("a GENUINELY EMPTY but EXISTING week still reports empty — no refusal", async () => {
    mocks.withAdmin.mockImplementation((fn: any) => fn(quarantinePb({ weekDataRows: [week(LOCAL_WEEK)] })));

    const res = await QUARANTINE_POST(
      quarantineRequest({ mode: "dry-run", localWeekData: localWeekWith(LOCAL_WEEK, [earn(7, "Alex", 5, 42)]) }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.report.canonicalWeekStart).toBe(LOCAL_WEEK);
    expect(body.report.quarantined.map((tx: Row) => tx.id)).toEqual([7]);
  });

  it("a matching snapshot week with real history still matches rows", async () => {
    mocks.withAdmin.mockImplementation((fn: any) =>
      fn(quarantinePb({ snapshotHistory: [earn(7, "Alex", 5, 42)], weekDataRows: [week("2020-01-06")] })),
    );

    const res = await QUARANTINE_POST(
      quarantineRequest({ mode: "dry-run", localWeekData: localWeekWith(LOCAL_WEEK, [earn(7, "Alex", 5, 42)]) }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.report.exactMatches.map((tx: Row) => tx.id)).toEqual([7]);
    expect(body.report.quarantined).toEqual([]);
  });

  it("a doctored local balance cannot skew the report", async () => {
    mocks.withAdmin.mockImplementation((fn: any) =>
      fn(quarantinePb({ snapshotHistory: [earn(7, "Alex", 5, 42)] })),
    );
    const res = await QUARANTINE_POST(
      quarantineRequest({ mode: "dry-run", localWeekData: localWeekWith(LOCAL_WEEK, [earn(7, "Alex", 5, 42)]) }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).report.quarantined).toEqual([]);
  });

  it("an ambiguous canonical week is still 503 canonical_week_unavailable", async () => {
    mocks.withAdmin.mockImplementation((fn: any) =>
      fn(
        quarantinePb({
          snapshotWeekStart: "2020-01-06",
          weekDataRows: [week(LOCAL_WEEK, [earn(7, "Alex", 5, 42)]), week(LOCAL_WEEK, [earn(8, "Alex", 5, 43)])],
        }),
      ),
    );

    const res = await QUARANTINE_POST(
      quarantineRequest({ mode: "dry-run", localWeekData: localWeekWith(LOCAL_WEEK, [earn(7, "Alex", 5, 42)]) }),
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "canonical_week_unavailable" });
  });
});

describe("quarantine stays parent-only and read-only against PocketBase", () => {
  it("a non-parent session is refused before any read or write", async () => {
    mocks.verifyLiveParentSession.mockResolvedValue({ ok: false, status: 403, reason: "adult_only" });

    const res = await QUARANTINE_POST(
      quarantineRequest({ mode: "export", localWeekData: localWeekWith(LOCAL_WEEK, [earn(7, "Alex", 5, 42)]) }),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "adult_only" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("an anonymous session is refused", async () => {
    mocks.verifyLiveParentSession.mockResolvedValue({ ok: false, status: 401, reason: "unauthorized" });
    const res = await QUARANTINE_POST(
      quarantineRequest({ mode: "export", localWeekData: localWeekWith(LOCAL_WEEK, [earn(7, "Alex", 5, 42)]) }),
    );
    expect(res.status).toBe(401);
  });

  it("an unreachable roster is 503, never an auth failure", async () => {
    mocks.verifyLiveParentSession.mockResolvedValue({ ok: false, status: 503, reason: "member_lookup_failed" });
    const res = await QUARANTINE_POST(
      quarantineRequest({ mode: "export", localWeekData: localWeekWith(LOCAL_WEEK, [earn(7, "Alex", 5, 42)]) }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "member_lookup_failed" });
  });

  it("never writes to PocketBase, on either mode", async () => {
    mocks.withAdmin.mockImplementation((fn: any) => fn(quarantinePb({ snapshotHistory: [earn(7, "Alex", 5, 42)] })));
    const dry = await QUARANTINE_POST(
      quarantineRequest({ mode: "dry-run", localWeekData: localWeekWith(LOCAL_WEEK, [earn(7, "Alex", 5, 42)]) }),
    );
    const exported = await QUARANTINE_POST(
      quarantineRequest({ mode: "export", localWeekData: localWeekWith(LOCAL_WEEK, [earn(7, "Alex", 5, 42)]) }),
    );
    expect(dry.status).toBe(200);
    expect(exported.status).toBe(200);
    expect(mocks.pbWrites).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B6 — body size, BEFORE any credential work
// ---------------------------------------------------------------------------

function pinRequest(route: string, body: string, headers: Record<string, string> = {}) {
  const request = new NextRequest(`http://localhost${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
  const readSpy = vi.fn(async () => body);
  (request as any).text = readSpy;
  (request as any).json = vi.fn(async () => JSON.parse(body));
  return { request, readSpy };
}

function oversizeBody(bytes: number): string {
  return JSON.stringify({
    operationId: "op-huge",
    action: "approve",
    memberName: "Live Parent",
    pin: "1234",
    taskId: 1,
    assigneeEmoji: "x".repeat(bytes),
  });
}

// `/api/tasks/ledger` (wave 1) uses 4 KiB, calibrated to a command of a few
// short fields. The claim route legitimately carries an `assigneeEmoji` that
// its OWN parser admits up to 400,000 characters — a base64 photo data-URL
// (`src/lib/task-claim.ts:205`) — so 4 KiB would reject a value the parser
// documents as valid and break a real photo-assignee completion. The bound
// therefore has to admit the route's own documented ceiling (worst case 2
// UTF-16 units per astral emoji char = 4 bytes, so 400,000 chars can be
// ~800 KB on the wire) and still be a hard ceiling rather than "unbounded".
const CLAIM_MAX_BODY_BYTES = 1024 * 1024;
const APPROVE_MAX_BODY_BYTES = 4 * 1024;

describe("B6 — the two middleware-EXEMPT PIN routes bound the body before reading it", () => {
  it("claim: an oversized DECLARED content-length is 413 before the body is read", async () => {
    const { request, readSpy } = pinRequest(
      "/api/tasks/claim",
      oversizeBody(64),
      { "content-length": String(CLAIM_MAX_BODY_BYTES * 4) },
    );

    const res = await CLAIM_POST(request);

    expect(res.status).toBe(413);
    expect(readSpy).not.toHaveBeenCalled();
    expect(mocks.verifyPinFromPB).not.toHaveBeenCalled();
    expect(mocks.executeInternalTaskCommand).not.toHaveBeenCalled();
  });

  it("approve: an oversized DECLARED content-length is 413 before the body is read", async () => {
    const { request, readSpy } = pinRequest(
      "/api/tasks/approve",
      oversizeBody(APPROVE_MAX_BODY_BYTES * 2),
      { "content-length": String(APPROVE_MAX_BODY_BYTES * 4) },
    );

    const res = await APPROVE_POST(request);

    expect(res.status).toBe(413);
    expect(readSpy).not.toHaveBeenCalled();
    expect(mocks.verifyPinFromPB).not.toHaveBeenCalled();
    expect(mocks.executeInternalTaskCommand).not.toHaveBeenCalled();
  });

  it("claim: an UNDERSTATED header is still caught by the post-read byte check", async () => {
    const { request, readSpy } = pinRequest(
      "/api/tasks/claim",
      oversizeBody(CLAIM_MAX_BODY_BYTES * 2),
      { "content-length": "10" },
    );

    const res = await CLAIM_POST(request);

    expect(readSpy).toHaveBeenCalled();
    expect(res.status).toBe(413);
    expect(mocks.verifyPinFromPB).not.toHaveBeenCalled();
  });

  it("approve: an UNDERSTATED header is still caught by the post-read byte check", async () => {
    const { request, readSpy } = pinRequest(
      "/api/tasks/approve",
      oversizeBody(APPROVE_MAX_BODY_BYTES * 2),
      { "content-length": "10" },
    );

    const res = await APPROVE_POST(request);

    expect(readSpy).toHaveBeenCalled();
    expect(res.status).toBe(413);
    expect(mocks.verifyPinFromPB).not.toHaveBeenCalled();
  });

  it("both routes answer the SAME machine reason code as the ledger route", async () => {
    const claim = await CLAIM_POST(pinRequest("/api/tasks/claim", "{}", { "content-length": "999999999" }).request);
    const approve = await APPROVE_POST(pinRequest("/api/tasks/approve", "{}", { "content-length": "999999999" }).request);
    for (const res of [claim, approve]) {
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ reason: "payload_too_large", error: "payload_too_large", code: "payload_too_large" });
    }
  });

  it("claim still admits the photo assigneeEmoji its own parser allows", async () => {
    // The bound must not be tighter than the parser's documented ceiling: a
    // base64 photo data-URL assignee emoji is a real, supported completion body,
    // and rejecting it here would 413 a request the parser explicitly accepts.
    const photo = `data:image/webp;base64,${"A".repeat(300_000)}`;
    expect(new TextEncoder().encode(photo).length).toBeLessThan(CLAIM_MAX_BODY_BYTES);
    mocks.verifyPinFromPB.mockResolvedValue({ id: "parent-live", name: "Live Parent", role: "parent" });
    mocks.executeInternalTaskCommand.mockResolvedValue({
      ok: true,
      operationId: "op-photo",
      action: "complete",
      task: { id: 1 },
      reconciled: true,
      revision: { revision: "2", updatedAt: "" },
    });

    const res = await CLAIM_POST(
      pinRequest(
        "/api/tasks/claim",
        JSON.stringify({ operationId: "op-photo", action: "complete", taskId: 1, memberName: "Live Parent", pin: "1234", assigneeEmoji: photo }),
      ).request,
    );

    expect(res.status).toBe(200);
  });

  it("approve keeps the ledger route's 4 KiB bound", async () => {
    // Approve carries no free-form media field, so it shares the ledger
    // route's value exactly.
    const source = readFileSync(path.join(process.cwd(), "src/app/api/tasks/approve/route.ts"), "utf8");
    const ledger = readFileSync(path.join(process.cwd(), "src/app/api/tasks/ledger/route.ts"), "utf8");
    const boundOf = (text: string) => text.match(/MAX_BODY_BYTES\s*=\s*([^;]+);/)?.[1].trim();
    expect(boundOf(source)).toBe(boundOf(ledger));
  });

  it("a normal body still works on both routes", async () => {
    mocks.executeInternalTaskCommand
      .mockResolvedValueOnce({
        ok: true,
        operationId: "op-claim-1",
        action: "complete",
        task: { id: 1, title: "Dishes" },
        reconciled: true,
        revision: { revision: "2", updatedAt: "" },
      })
      .mockResolvedValueOnce({
        ok: true,
        operationId: "op-approve-1",
        action: "approve",
        weekData: week(WEEK, [earn(1, "Alex", 5)]),
        paid: 1,
        cleared: 1,
        reconciled: true,
      });

    const claim = await CLAIM_POST(
      pinRequest("/api/tasks/claim", JSON.stringify({ operationId: "op-claim-1", action: "complete", taskId: 1, pin: "1234", memberName: "Live Parent" })).request,
    );
    const approve = await APPROVE_POST(
      pinRequest("/api/tasks/approve", JSON.stringify({ operationId: "op-approve-1", action: "approve", taskId: 1, pin: "1234", memberName: "Live Parent" })).request,
    );

    expect(claim.status).toBe(200);
    expect(approve.status).toBe(200);
    expect(mocks.verifyPinFromPB).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// B7 — the claim route's display channel
// ---------------------------------------------------------------------------

describe("B7 — a claim failure carries error and code, not just reason", () => {
  it("a wrong PIN puts a displayable message on `error` and the machine code on `code`", async () => {
    mocks.verifyPinFromPB.mockResolvedValue(null);

    const res = await CLAIM_POST(
      pinRequest(
        "/api/tasks/claim",
        JSON.stringify({ operationId: "op-wrong-pin", action: "complete", taskId: 1, pin: "0000", memberName: "Live Parent" }),
      ).request,
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({
      success: false,
      reason: "unauthorized",
      error: "unauthorized",
      code: "unauthorized",
    });
    // The outbox's `serverMessageOf` reads `body.error` and nothing else.
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("every claim failure arm populates both channels", async () => {
    const bodies: Row[] = [];
    const arms: Array<[unknown, unknown]> = [
      ["{not json", null],
      [{ operationId: "op-a", action: "nuke", taskId: 1 }, null],
      [{ operationId: "op-b", action: "complete", taskId: 1 }, null],
      [{ operationId: "op-c", action: "crew-close", taskId: 1 }, null],
    ];
    for (const [payload] of arms) {
      mocks.verifyPinFromPB.mockResolvedValue(null);
      const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
      const res = await CLAIM_POST(pinRequest("/api/tasks/claim", raw).request);
      bodies.push(await res.json());
    }
    for (const body of bodies) {
      expect(body.success).toBe(false);
      expect(typeof body.error).toBe("string");
      expect(body.error.length).toBeGreaterThan(0);
      expect(typeof body.code).toBe("string");
      expect(body.code.length).toBeGreaterThan(0);
    }
  });

  it("approve keeps its deliberate display/machine split", async () => {
    mocks.executeInternalTaskCommand.mockResolvedValue({ ok: false, reason: "unknown_task", operationId: "op-u" });

    const res = await APPROVE_POST(
      pinRequest(
        "/api/tasks/approve",
        JSON.stringify({ operationId: "op-u", action: "approve", taskId: 1, pin: "1234", memberName: "Live Parent" }),
      ).request,
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("unknown-task");
    expect(body.reason).toBe("unknown-task");
    expect(body.code).toBe("unknown_task");
  });
});

// ---------------------------------------------------------------------------
// B8 — a projection failure is visible to a caller
// ---------------------------------------------------------------------------

describe("B8 — an approval whose projection failed says so on the display channel", () => {
  it("puts the count on `error` when reconciled is false with projection failures", async () => {
    mocks.executeInternalTaskCommand.mockResolvedValue({
      ok: true,
      operationId: "op-proj",
      action: "approve-all",
      weekData: week(WEEK, []),
      paid: 0,
      cleared: 0,
      skipped: 9,
      reconciled: false,
      repairRequired: true,
      projectionFailures: [101, 102, 103],
    });

    const res = await APPROVE_POST(
      pinRequest(
        "/api/tasks/approve",
        JSON.stringify({ operationId: "op-proj", action: "approve-all", taskIds: [101, 102, 103], pin: "1234", memberName: "Live Parent" }),
      ).request,
    );

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.reconciled).toBe(false);
    expect(body.repairRequired).toBe(true);
    expect(body.projectionFailures).toEqual([101, 102, 103]);
    // The display channel the outbox's `serverMessageOf` reads.
    expect(typeof body.error).toBe("string");
    expect(body.error).toContain("3");
    // It must NOT impersonate a machine code in the closed vocabulary, or it
    // would silently reclassify the refusal.
    expect(body.code).toBeUndefined();
  });

  it("a fully reconciled approval carries no error at all", async () => {
    mocks.executeInternalTaskCommand.mockResolvedValue({
      ok: true,
      operationId: "op-ok",
      action: "approve",
      weekData: week(WEEK, [earn(1, "Alex", 5)]),
      paid: 1,
      cleared: 1,
      reconciled: true,
    });

    const res = await APPROVE_POST(
      pinRequest(
        "/api/tasks/approve",
        JSON.stringify({ operationId: "op-ok", action: "approve", taskId: 1, pin: "1234", memberName: "Live Parent" }),
      ).request,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeUndefined();
    expect(body.repairRequired).toBe(false);
  });

  it("the display sentence the outbox reads via serverMessageOf is the ONLY thing on that channel", async () => {
    // Pins the shape the outbox's own reader depends on: `serverMessageOf`
    // returns `body.error` and nothing else, so a caller rendering
    // `lastErrorMessage` must never be handed a task id, a title or a
    // PocketBase error string here.
    mocks.executeInternalTaskCommand.mockResolvedValue({
      ok: true,
      operationId: "op-proj-2",
      action: "approve",
      weekData: week(WEEK, []),
      paid: 0,
      cleared: 0,
      reconciled: false,
      repairRequired: true,
      projectionFailures: [101],
    });

    const body = await (
      await APPROVE_POST(
        pinRequest(
          "/api/tasks/approve",
          JSON.stringify({ operationId: "op-proj-2", action: "approve", taskId: 101, pin: "1234", memberName: "Live Parent" }),
        ).request,
      )
    ).json();

    expect(body.error).toBe("1 approval did not reach the kitchen display yet. Consuela is still retrying.");
    expect(body.error).not.toContain("101");
    expect(body.error).not.toMatch(/PocketBase|pocketbase/i);
    // Still under the outbox's own 240-char clamp, so nothing is truncated
    // before it is persisted.
    expect(body.error.length).toBeLessThanOrEqual(240);
  });
});

// ---------------------------------------------------------------------------
// regressions
// ---------------------------------------------------------------------------

describe("regression — wrong PIN is still distinguishable from 'couldn't reach Consuela'", () => {
  it("claim: wrong PIN is 401 unauthorized, an unreachable roster is 503", async () => {
    mocks.verifyPinFromPB.mockResolvedValue(null);
    const wrongPin = await CLAIM_POST(
      pinRequest("/api/tasks/claim", JSON.stringify({ operationId: "op-1", action: "complete", taskId: 1, pin: "0000", memberName: "Live Parent" })).request,
    );
    expect(wrongPin.status).toBe(401);
    expect((await wrongPin.json()).reason).toBe("unauthorized");

    mocks.verifyPinFromPB.mockRejectedValue(new Error("pb down"));
    const unreachable = await CLAIM_POST(
      pinRequest("/api/tasks/claim", JSON.stringify({ operationId: "op-2", action: "complete", taskId: 1, pin: "1234", memberName: "Live Parent" })).request,
    );
    expect(unreachable.status).toBe(503);
    const body = await unreachable.json();
    expect(body.reason).toBe("member_roster_unavailable");
    expect(body.code).toBe("member_roster_unavailable");
    // The outbox would classify a 503 through RETRYABLE_REASON_CODES even
    // without the flag, but the flag is what the ARCHITECTURE contract names,
    // so every unreachable-roster arm states it.
    expect(body.retryable).toBe(true);
  });

  it("approve: wrong PIN is 401 unauthorized, an unreachable roster is 503 retryable", async () => {
    mocks.verifyPinFromPB.mockResolvedValue(null);
    const wrongPin = await APPROVE_POST(
      pinRequest("/api/tasks/approve", JSON.stringify({ operationId: "op-1", action: "approve", taskId: 1, pin: "0000", memberName: "Live Parent" })).request,
    );
    expect(wrongPin.status).toBe(401);
    expect((await wrongPin.json()).reason).toBe("unauthorized");

    mocks.verifyPinFromPB.mockRejectedValue(new Error("pb down"));
    const unreachable = await APPROVE_POST(
      pinRequest("/api/tasks/approve", JSON.stringify({ operationId: "op-2", action: "approve", taskId: 1, pin: "1234", memberName: "Live Parent" })).request,
    );
    expect(unreachable.status).toBe(503);
    const body = await unreachable.json();
    expect(body.reason).toBe("member_roster_unavailable");
    expect(body.retryable).toBe(true);
  });

  it("claim: a member removed from the LIVE roster after a valid PIN is 401, not a write", async () => {
    mocks.getLiveMemberById.mockResolvedValue(null);
    const res = await CLAIM_POST(
      pinRequest("/api/tasks/claim", JSON.stringify({ operationId: "op-3", action: "complete", taskId: 1, pin: "1234", memberName: "Live Parent" })).request,
    );
    expect(res.status).toBe(401);
    expect(mocks.executeInternalTaskCommand).not.toHaveBeenCalled();
  });

  it("claim: a PIN that requires a session and has none is 401 pin_required", async () => {
    mocks.verifySession.mockResolvedValue(null);
    const res = await CLAIM_POST(
      pinRequest("/api/tasks/claim", JSON.stringify({ operationId: "op-4", action: "crew-remove", taskId: 1, targetName: "Alex" })).request,
    );
    expect(res.status).toBe(401);
    expect((await res.json()).reason).toBe("pin_required");
    expect(mocks.executeInternalTaskCommand).not.toHaveBeenCalled();
  });

  it("approve: a child PIN is 403 adult_only, not 401", async () => {
    mocks.verifyPinFromPB.mockResolvedValue({ id: "kid", name: "Kid", role: "child" });
    mocks.getLiveMemberById.mockResolvedValue({ id: "kid", name: "Kid", role: "child" });
    const res = await APPROVE_POST(
      pinRequest("/api/tasks/approve", JSON.stringify({ operationId: "op-5", action: "approve", taskId: 1, pin: "1234", memberName: "Kid" })).request,
    );
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("adult_only");
    expect(mocks.executeInternalTaskCommand).not.toHaveBeenCalled();
  });
});

describe("regression — the command seam contract the claim route depends on", () => {
  it("authenticates BEFORE dispatch, so an unauthenticated caller never reaches the command", async () => {
    mocks.verifyPinFromPB.mockResolvedValue(null);
    await CLAIM_POST(
      pinRequest("/api/tasks/claim", JSON.stringify({ operationId: "op-6", action: "complete", taskId: 1, pin: "0000", memberName: "Live Parent" })).request,
    );
    expect(mocks.executeInternalTaskCommand).not.toHaveBeenCalled();
  });

  it("forwards the operationId verbatim and dispatches exactly once, so idempotency and the in-lock race hold", async () => {
    mocks.executeInternalTaskCommand.mockResolvedValue({
      ok: true,
      operationId: "op-7",
      action: "complete",
      task: { id: 7 },
      reconciled: true,
      revision: { revision: "3", updatedAt: "" },
    });

    await CLAIM_POST(
      pinRequest("/api/tasks/claim", JSON.stringify({ operationId: "op-7", action: "complete", taskId: 7, pin: "1234", memberName: "Live Parent" })).request,
    );

    expect(mocks.executeInternalTaskCommand).toHaveBeenCalledTimes(1);
    const [command, options] = mocks.executeInternalTaskCommand.mock.calls[0];
    expect(command.operationId).toBe("op-7");
    expect(command.kind).toBe("complete");
    expect(options).toEqual({ source: "server" });
  });

  it("a REPLAYED operationId is surfaced as a duplicate and never applied twice", async () => {
    mocks.executeInternalTaskCommand.mockResolvedValue({
      ok: true,
      operationId: "op-8",
      action: "complete",
      task: { id: 8 },
      applied: 0,
      duplicate: true,
      reconciled: true,
      revision: { revision: "3", updatedAt: "" },
    });

    const res = await CLAIM_POST(
      pinRequest("/api/tasks/claim", JSON.stringify({ operationId: "op-8", action: "complete", taskId: 8, pin: "1234", memberName: "Live Parent" })).request,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duplicate).toBe(true);
    expect(body.applied ?? 0).toBe(0);
    expect(mocks.executeInternalTaskCommand).toHaveBeenCalledTimes(1);
  });

  it("a first-one-wins conflict (already_completed) stays a 409, never a second apply", async () => {
    mocks.executeInternalTaskCommand.mockResolvedValue({
      ok: false,
      operationId: "op-9",
      reason: "already_completed",
    });

    const res = await CLAIM_POST(
      pinRequest("/api/tasks/claim", JSON.stringify({ operationId: "op-9", action: "complete", taskId: 9, pin: "1234", memberName: "Live Parent" })).request,
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, reason: "already_completed", error: "already_completed" });
  });

  it("the route itself evaluates nothing about the task — the race stays inside the locked command", async () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/api/tasks/claim/route.ts"), "utf8");
    // `doneThisWeek` is the in-lock first-one-wins check and it lives in
    // src/lib/task-claim.ts. If it ever appeared here the route would be
    // evaluating it OUTSIDE the per-task lock, which is the race the contract
    // forbids.
    expect(source).not.toContain("doneThisWeek");
  });
});