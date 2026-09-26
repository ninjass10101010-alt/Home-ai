import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  requireLiveSession: vi.fn(),
  localWeekStartISO: vi.fn((_now?: Date) => "2026-09-21"),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/server-auth", () => ({
  requireLiveSession: (request: Request) => mocks.requireLiveSession(request),
}));

vi.mock("@/lib/local-date", () => ({
  localWeekStartISO: (now?: Date) => mocks.localWeekStartISO(now),
}));

import { GET } from "@/app/api/tasks/all-time/route";

const WEEK = "2026-09-21";
const PREVIOUS = "2026-09-14";

type Row = Record<string, unknown>;

function weekRow(weekStart: string, history: unknown, points: Row = {}): Row {
  return { id: `wd-${weekStart}`, weekStart, points, streak: {}, lastActive: {}, history };
}

function archiveRow(weekStart: string, history: unknown, extra: Row = {}): Row {
  return { id: `wa-${weekStart}`, weekStart, archivedAt: "2026-09-21T06:00:00.000Z", points: {}, history, ...extra };
}

function pbCollections(dataRows: Row[], archiveRows: Row[]) {
  const reads: string[] = [];
  return {
    reads,
    pb: {
      collection(name: string) {
        reads.push(name);
        return {
          async getFullList() {
            return name === "week_data" ? dataRows : archiveRows;
          },
        };
      },
    },
  };
}

const CURRENT_HISTORY = [
  { id: 1, timestamp: "2026-09-21T10:00:00.000Z", member: "Member A", type: "earn", amount: 5, description: "Task" },
];
const ARCHIVE_HISTORY = [
  { id: 2, timestamp: "2026-09-14T10:00:00.000Z", member: "Member A", type: "earn", amount: 40, description: "Task" },
];

function request(): NextRequest {
  return new NextRequest("http://localhost/api/tasks/all-time");
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.requireLiveSession.mockReset();
  mocks.localWeekStartISO.mockReset();
  mocks.localWeekStartISO.mockReturnValue(WEEK);
  mocks.requireLiveSession.mockResolvedValue({
    ok: true,
    identity: { memberId: "m1", name: "Parent", role: "parent" },
  });
});

describe("GET /api/tasks/all-time", () => {
  it("serves PocketBase-derived totals to a live session", async () => {
    const pb = pbCollections(
      [weekRow(WEEK, CURRENT_HISTORY, { "Member A": 999 })],
      [archiveRow(PREVIOUS, ARCHIVE_HISTORY, { points: { "Member A": 777 } })],
    );
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(pb.pb));

    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("pocketbase");
    expect(body.weekStart).toBe(WEEK);
    expect(body.historyComplete).toBe(true);
    expect(body.totals["Member A"]).toEqual({ points: 45, completions: 2 });
    expect(Number.isFinite(Date.parse(body.fetchedAt))).toBe(true);
    expect(pb.reads).toEqual(["week_data", "week_archive"]);
    expect(mocks.withAdmin).toHaveBeenCalledTimes(1);
  });

  it("answers an honest unknown instead of a partial total when an archive week is unreadable", async () => {
    const pb = pbCollections(
      [weekRow(WEEK, CURRENT_HISTORY, { "Member A": 999, "Member B": 999 })],
      [
        archiveRow(PREVIOUS, [
          { id: 2, timestamp: "2026-09-14T10:00:00.000Z", member: "Member A", type: "earn", amount: 40, description: "Task" },
          { id: 3, timestamp: "2026-09-14T11:00:00.000Z", member: "Member B", type: "earn", amount: 9, description: "Task" },
        ]),
        { id: "wa-2026-09-07", weekStart: "2026-09-07", points: { "Member A": 40 } },
      ],
    );
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(pb.pb));

    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.historyComplete).toBe(false);
    expect(Object.keys(body.totals).sort()).toEqual(["Member A", "Member B"]);
    expect(body.totals["Member A"]).toEqual({ points: null, completions: null });
    expect(body.totals["Member B"]).toEqual({ points: null, completions: null });
  });

  it("excludes the current week archive row and never double counts", async () => {
    const pb = pbCollections(
      [weekRow(WEEK, CURRENT_HISTORY)],
      [
        archiveRow(WEEK, [
          { id: 99, timestamp: "2026-09-21T12:00:00.000Z", member: "Member A", type: "earn", amount: 777, description: "Rolled copy" },
        ]),
        archiveRow(PREVIOUS, ARCHIVE_HISTORY),
      ],
    );
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(pb.pb));

    const res = await GET(request());
    const body = await res.json();
    expect(body.historyComplete).toBe(true);
    expect(body.totals["Member A"]).toEqual({ points: 45, completions: 2 });
  });

  it("503 all_time_unavailable when PocketBase cannot be read", async () => {
    mocks.withAdmin.mockRejectedValue(new Error("pb down"));
    const res = await GET(request());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "all_time_unavailable" });
  });

  it("503 all_time_unavailable when the canonical current week row is missing", async () => {
    const pb = pbCollections([], [archiveRow(PREVIOUS, ARCHIVE_HISTORY)]);
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(pb.pb));
    const res = await GET(request());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "all_time_unavailable" });
  });

  it("503 all_time_unavailable when the current week is not canonical (duplicate rows)", async () => {
    const pb = pbCollections(
      [weekRow(WEEK, CURRENT_HISTORY), weekRow(WEEK, ARCHIVE_HISTORY)],
      [],
    );
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(pb.pb));
    const res = await GET(request());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "all_time_unavailable" });
  });

  it("503 all_time_unavailable when the read returns a non-array", async () => {
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) =>
      fn({ collection: () => ({ getFullList: async () => null }) }),
    );
    const res = await GET(request());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "all_time_unavailable" });
  });

  it("refuses a request with no live session and never reads PocketBase", async () => {
    mocks.requireLiveSession.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("propagates the live-session refusal (role drift) verbatim", async () => {
    mocks.requireLiveSession.mockResolvedValue({ ok: false, status: 403, error: "session_role_changed" });
    const res = await GET(request());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "session_role_changed" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("never touches localStorage in the server route", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/api/tasks/all-time/route.ts"),
      "utf8",
    );
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("loadWeekData");
    expect(source).not.toContain("getArchivedWeeks");
  });
});
