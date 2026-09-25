import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Transaction, WeekData } from "@/types/tasks";

const parentTestCredential = "parent-test-credential";
const childTestCredential = "child-test-credential";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifyLiveParentSession: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  pbWeekWrites: [] as string[],
  pbReads: [] as string[],
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/live-member", () => ({
  verifyLiveParentSession: mocks.verifyLiveParentSession,
}));

vi.mock("node:fs/promises", () => ({
  mkdir: mocks.mkdir,
  writeFile: mocks.writeFile,
  default: { mkdir: mocks.mkdir, writeFile: mocks.writeFile },
}));

type Row = Record<string, any>;

const LOCAL_WEEK = "2026-09-21";

function transaction(
  id: number,
  type: Transaction["type"],
  member: string,
  amount: number,
  taskId?: number,
): Transaction {
  return {
    id,
    timestamp: `2026-09-2${(id % 8) + 1}T10:00:00.000Z`,
    member,
    type,
    amount,
    description: type === "earn" ? "Completed: Dishes" : "Adjustment",
    ...(taskId === undefined ? {} : { taskId }),
  };
}

function week(weekStart: string, history: Transaction[]): WeekData {
  return { weekStart, points: {}, streak: {}, lastActive: {}, history };
}

function makeHarness(options?: { snapshotHistory?: Transaction[]; snapshotWeekStart?: string; weekDataHistory?: Transaction[]; failSnapshotRead?: boolean }) {
  const record = (name: string) => {
    return {
      create: vi.fn(async () => {
        mocks.pbWeekWrites.push(`${name}.create`);
        return { id: `${name}-created` };
      }),
      update: vi.fn(async () => {
        mocks.pbWeekWrites.push(`${name}.update`);
        return { id: `${name}-updated` };
      }),
      delete: vi.fn(async () => {
        mocks.pbWeekWrites.push(`${name}.delete`);
        return true;
      }),
    };
  };

  const pb = {
    collection: vi.fn((name: string) => {
      if (name === "consuela_data_snapshots") {
        return {
          getFullList: vi.fn(async () => {
            if (options?.failSnapshotRead) throw new Error("PB unavailable");
            mocks.pbReads.push("consuela_data_snapshots");
            return [{
              id: "snapshot-1",
              data: {
                revision: "7",
                weekData: week(options?.snapshotWeekStart ?? LOCAL_WEEK, options?.snapshotHistory ?? []),
              },
            }];
          }),
          ...record("consuela_data_snapshots"),
        };
      }
      if (name === "week_data") {
        return {
          getFullList: vi.fn(async () => {
            mocks.pbReads.push("week_data");
            return [week(LOCAL_WEEK, options?.weekDataHistory ?? [])];
          }),
          ...record("week_data"),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    }),
  };

  return { pb };
}

function quarantineRequest(body: unknown, role: "parent" | "child" = "parent"): NextRequest {
  const credential = role === "parent" ? parentTestCredential : childTestCredential;
  return new NextRequest("http://localhost/api/tasks/quarantine", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `consuela_session=${credential}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const localWeekData = week(LOCAL_WEEK, [transaction(7, "earn", "Alex", 5, 42), transaction(8, "earn", "Alex", 5, 43)]);

async function post(request: NextRequest) {
  const { POST } = await import("@/app/api/tasks/quarantine/route");
  return POST(request);
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.verifyLiveParentSession.mockReset();
  mocks.mkdir.mockReset();
  mocks.writeFile.mockReset();
  mocks.pbWeekWrites.length = 0;
  mocks.pbReads.length = 0;
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.writeFile.mockResolvedValue(undefined);
  mocks.verifyLiveParentSession.mockImplementation(async (request: NextRequest) => {
    if (request.cookies.get("consuela_session")?.value === childTestCredential) {
      return { ok: false as const, status: 403 as const, reason: "adult_only" };
    }
    return {
      ok: true as const,
      member: { id: "parent-live", name: "Live Parent", role: "parent", emoji: "🧑" },
    };
  });
});

describe("POST /api/tasks/quarantine", () => {
  it("exports only after explicit parent confirmation", async () => {
    mocks.withAdmin.mockImplementation((fn: any) => fn(makeHarness({ snapshotHistory: [transaction(7, "earn", "Alex", 5, 42)] }).pb));

    const dryRun = await post(quarantineRequest({ mode: "dry-run", localWeekData }));
    expect(dryRun.status).toBe(200);
    expect(mocks.writeFile).not.toHaveBeenCalled();

    const exported = await post(quarantineRequest({ mode: "export", localWeekData }));
    expect(exported.status).toBe(200);
    expect(mocks.writeFile.mock.calls[0][0]).toMatch(/local-quarantine[\\/]task-ledger-/);
    expect(mocks.pbWeekWrites).toHaveLength(0);
  });

  it("returns counts and no path for a dry run", async () => {
    mocks.withAdmin.mockImplementation((fn: any) => fn(makeHarness({ snapshotHistory: [transaction(7, "earn", "Alex", 5, 42)] }).pb));

    const response = await post(quarantineRequest({ mode: "dry-run", localWeekData }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("dry-run");
    expect(body.path).toBeUndefined();
    expect(body.report.exactMatches.map((tx: Transaction) => tx.id)).toEqual([7]);
    expect(body.report.semanticMatches).toEqual([]);
    expect(body.report.quarantined.map((tx: Transaction) => tx.id)).toEqual([8]);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.mkdir).not.toHaveBeenCalled();
  });

  it("writes the serialized report to local-quarantine and never to PocketBase", async () => {
    mocks.withAdmin.mockImplementation((fn: any) => fn(makeHarness({ snapshotHistory: [transaction(7, "earn", "Alex", 5, 42)] }).pb));

    const response = await post(quarantineRequest({ mode: "export", localWeekData }));
    const body = await response.json();
    const target = mocks.writeFile.mock.calls[0][0] as string;

    expect(response.status).toBe(200);
    expect(body.mode).toBe("export");
    expect(body.path).toBe(target);
    expect(target).toContain(`${process.cwd()}/local-quarantine`);
    expect(target.endsWith(".json")).toBe(true);
    expect(mocks.mkdir).toHaveBeenCalledWith(path.dirname(target), { recursive: true });
    expect(JSON.parse(mocks.writeFile.mock.calls[0][1] as string).quarantined.map((tx: Transaction) => tx.id)).toEqual([8]);
    expect(mocks.pbWeekWrites).toEqual([]);
    expect(mocks.pbReads.length).toBeGreaterThan(0);
  });

  it("keeps a reversed server earn out of the semantic match set", async () => {
    mocks.withAdmin.mockImplementation((fn: any) => fn(makeHarness({
      snapshotHistory: [transaction(9, "earn", "Alex", 5, 43), transaction(10, "adjust", "Alex", -5, 43)],
    }).pb));

    const response = await post(quarantineRequest({ mode: "dry-run", localWeekData }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.report.semanticMatches).toEqual([]);
    expect(body.report.quarantined.map((tx: Transaction) => tx.id)).toEqual([7, 8]);
  });

  it("falls back to the canonical week_data row when the snapshot holds no week", async () => {
    mocks.withAdmin.mockImplementation((fn: any) => fn(makeHarness({
      snapshotWeekStart: "2026-09-14",
      weekDataHistory: [transaction(7, "earn", "Alex", 5, 42)],
    }).pb));

    const response = await post(quarantineRequest({ mode: "dry-run", localWeekData }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.pbReads).toContain("week_data");
    expect(body.report.exactMatches.map((tx: Transaction) => tx.id)).toEqual([7]);
    expect(body.report.quarantined.map((tx: Transaction) => tx.id)).toEqual([8]);
  });

  it("quarantines everything when the canonical week is empty", async () => {
    mocks.withAdmin.mockImplementation((fn: any) => fn(makeHarness().pb));

    const response = await post(quarantineRequest({ mode: "export", localWeekData }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.report.quarantined.map((tx: Transaction) => tx.id)).toEqual([7, 8]);
    expect(mocks.pbWeekWrites).toEqual([]);
  });

  it("refuses a non-parent session before any read or write", async () => {
    mocks.withAdmin.mockImplementation((fn: any) => fn(makeHarness().pb));

    const dryRun = await post(quarantineRequest({ mode: "dry-run", localWeekData }, "child"));
    const exported = await post(quarantineRequest({ mode: "export", localWeekData }, "child"));

    expect(dryRun.status).toBe(403);
    expect(await dryRun.json()).toMatchObject({ error: "adult_only" });
    expect(exported.status).toBe(403);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("refuses an anonymous session", async () => {
    mocks.verifyLiveParentSession.mockResolvedValue({ ok: false, status: 401, reason: "unauthorized" });

    const response = await post(quarantineRequest({ mode: "export", localWeekData }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "unauthorized" });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("rejects a malformed body, an unknown mode, and an invalid local week", async () => {
    mocks.withAdmin.mockImplementation((fn: any) => fn(makeHarness().pb));

    const malformed = await post(quarantineRequest("{not json"));
    const unknownMode = await post(quarantineRequest({ mode: "apply", localWeekData }));
    const invalidWeek = await post(quarantineRequest({ mode: "export", localWeekData: { weekStart: "" } }));
    const noWeek = await post(quarantineRequest({ mode: "export" }));

    expect(malformed.status).toBe(400);
    expect(unknownMode.status).toBe(400);
    expect(invalidWeek.status).toBe(400);
    expect(noWeek.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: "invalid_quarantine_request" });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("reports 503 when the canonical week cannot be read", async () => {
    mocks.withAdmin.mockImplementation((fn: any) => fn(makeHarness({ failSnapshotRead: true }).pb));

    const response = await post(quarantineRequest({ mode: "export", localWeekData }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "canonical_week_unavailable" });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("reports 500 when the export file cannot be written", async () => {
    mocks.withAdmin.mockImplementation((fn: any) => fn(makeHarness().pb));
    mocks.writeFile.mockRejectedValueOnce(new Error("read-only filesystem"));

    const response = await post(quarantineRequest({ mode: "export", localWeekData }));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "quarantine_export_failed" });
    expect(mocks.pbWeekWrites).toEqual([]);
  });
});
