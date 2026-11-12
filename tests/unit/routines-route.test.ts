import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getFirstListItem: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  getFullListMembers: vi.fn(),
  getFullListWeek: vi.fn(),
  readSessionCookie: vi.fn(),
  requireLiveSession: vi.fn(),
  verifyPinAgainstAnyMember: vi.fn(),
  applyWeekLedgerOperationLocked: vi.fn(),
  ensureCurrentTaskWeek: vi.fn(),
  mutateSnapshotWithMeta: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) =>
    fn({
      collection: (name: string) => {
        if (name === "members") {
          return { getFullList: mocks.getFullListMembers };
        }
        if (name === "week_data") {
          return { getFullList: mocks.getFullListWeek };
        }
        return {
          getFirstListItem: mocks.getFirstListItem,
          update: mocks.update,
          create: mocks.create,
        };
      },
    }),
}));

vi.mock("@/lib/server-auth", () => ({
  readSessionCookie: mocks.readSessionCookie,
  requireLiveSession: mocks.requireLiveSession,
  verifyPinAgainstAnyMember: mocks.verifyPinAgainstAnyMember,
  sanitizeMember: (member: any) => {
    const { pin, ...rest } = member;
    return rest;
  },
}));

vi.mock("@/lib/ledger-operations", () => ({
  applyWeekLedgerOperationLocked: mocks.applyWeekLedgerOperationLocked,
}));

vi.mock("@/lib/task-week-rollover", () => ({
  ensureCurrentTaskWeek: mocks.ensureCurrentTaskWeek,
}));

vi.mock("@/lib/snapshot-tasks", () => ({
  mutateSnapshotWithMeta: mocks.mutateSnapshotWithMeta,
}));

import { GET as ROUTINES_GET, PUT as ROUTINES_PUT, POST as ROUTINES_POST } from "@/app/api/routines/route";
import {
  GET as PROGRESS_GET,
  PUT as PROGRESS_PUT,
  POST as PROGRESS_POST,
} from "@/app/api/routines/progress/route";
import { DEFAULT_ROUTINE_SETTINGS, DEFAULT_ROUTINES } from "@/types/routines";

const SAMPLE_MEMBERS = [
  { id: "p1", name: "Francisco", fullName: "Francisco Garcia", role: "parent", emoji: "👨" },
  { id: "c1", name: "Aurora", fullName: "Aurora Garcia", role: "child", emoji: "🌟" },
  { id: "c2", name: "Caspian", fullName: "Caspian Garcia", role: "child", emoji: "🦊" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSessionCookie.mockReturnValue(undefined);
  mocks.requireLiveSession.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });
  mocks.verifyPinAgainstAnyMember.mockResolvedValue(null);
  mocks.getFullListMembers.mockResolvedValue(SAMPLE_MEMBERS);
  mocks.getFullListWeek.mockResolvedValue([
    { weekStart: "2026-11-09", points: { "Aurora Garcia": 20 }, history: [] },
  ]);
  mocks.ensureCurrentTaskWeek.mockResolvedValue({ weekStart: "2026-11-09" });
  mocks.applyWeekLedgerOperationLocked.mockResolvedValue({
    ok: true,
    applied: true,
    duplicate: false,
    semanticDuplicate: false,
    reconciled: true,
    operationId: "op-1",
    weekData: {
      weekStart: "2026-11-09",
      points: { "Aurora Garcia": 35 },
      streak: {},
      lastActive: {},
      history: [],
    },
  });
});

describe("/api/routines", () => {
  it("returns default routines and settings if no state record exists", async () => {
    mocks.getFirstListItem.mockRejectedValue(new Error("Record not found"));
    const res = await ROUTINES_GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.routines).toEqual(DEFAULT_ROUTINES);
    expect(body.settings).toEqual(DEFAULT_ROUTINE_SETTINGS);
  });

  it("returns stored routines when record exists", async () => {
    const custom = [{ id: "rt-test", title: "Test Routine", steps: [] }];
    mocks.getFirstListItem.mockResolvedValueOnce({
      id: "rec-1",
      value: custom,
    });
    mocks.getFirstListItem.mockRejectedValue(new Error("not found"));

    const res = await ROUTINES_GET();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.routines).toEqual(custom);
  });

  it("rejects unauthenticated and non-parent PIN attempts on PUT/POST", async () => {
    const anonReq = new Request("http://localhost/api/routines", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routines: [{ id: "rt-1", title: "Hack" }] }),
    });
    expect((await ROUTINES_PUT(anonReq as any)).status).toBe(401);

    mocks.verifyPinAgainstAnyMember.mockResolvedValueOnce({
      id: "c1",
      name: "Aurora",
      role: "child",
    });
    const childPinReq = new Request("http://localhost/api/routines", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-pin": "1111",
      },
      body: JSON.stringify({
        action: "update_settings",
        settings: { defaultPoints: 999 },
      }),
    });
    const childRes = await ROUTINES_POST(childPinReq as any);
    expect(childRes.status).toBe(403);
    expect((await childRes.json()).error).toBe("adult_only");
  });

  it("allows verified parent PIN to update routines and custom settings", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({
      id: "p1",
      name: "Francisco",
      role: "parent",
    });
    mocks.getFirstListItem.mockImplementation(async (filter: string) => {
      if (filter.includes("family_routines")) return { id: "rec-1", value: [] };
      throw new Error("not found");
    });
    mocks.update.mockResolvedValue({ id: "rec-1" });
    mocks.create.mockResolvedValue({ id: "rec-settings" });

    const req = new Request("http://localhost/api/routines", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-admin-pin": "9999",
      },
      body: JSON.stringify({
        routines: [{ id: "rt-1", title: "Sunday Trash", points: 25, daysOfWeek: ["sun"] }],
        settings: { defaultPoints: 25, defaultMissedPenalty: 10 },
      }),
    });

    const res = await ROUTINES_PUT(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.routines[0]).toMatchObject({
      id: "rt-1",
      title: "Sunday Trash",
      points: 25,
      daysOfWeek: ["sun"],
    });
    expect(body.settings.defaultPoints).toBe(25);
    expect(body.settings.defaultMissedPenalty).toBe(10);
  });
});

describe("/api/routines/progress", () => {
  it("returns empty sanitized progress when none exists", async () => {
    mocks.getFirstListItem.mockRejectedValue(new Error("Not found"));
    const req = new Request("http://localhost/api/routines/progress?date=2026-11-05");
    const res = await PROGRESS_GET(req as any);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.progress).toEqual({
      date: "2026-11-05",
      checkedSteps: {},
      completedRoutines: {},
      memberCheckedSteps: {},
      memberCompleted: {},
    });
  });

  it("requires a verified Parent PIN for legacy PUT progress payload", async () => {
    const unauthedReq = new Request("http://localhost/api/routines/progress", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-11-05",
        progress: {
          checkedSteps: { "rt-1": ["s1"] },
          completedRoutines: { "rt-1": false },
        },
      }),
    });
    expect((await PROGRESS_PUT(unauthedReq as any)).status).toBe(401);

    mocks.verifyPinAgainstAnyMember.mockResolvedValueOnce({
      id: "p1",
      name: "Francisco Garcia",
      role: "parent",
    });
    mocks.getFirstListItem.mockResolvedValueOnce({ id: "rec-prog" });
    mocks.update.mockResolvedValueOnce({ id: "rec-prog" });

    const req = new Request("http://localhost/api/routines/progress", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-admin-pin": "9999",
      },
      body: JSON.stringify({
        date: "2026-11-05",
        progress: {
          checkedSteps: { "rt-1": ["s1"] },
          completedRoutines: { "rt-1": false },
        },
      }),
    });

    const res = await PROGRESS_PUT(req as any);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.date).toBe("2026-11-05");
    expect(mocks.update).toHaveBeenCalledWith("rec-prog", {
      value: {
        date: "2026-11-05",
        checkedSteps: { "rt-1": ["s1"] },
        completedRoutines: { "rt-1": false },
        memberCheckedSteps: {},
        memberCompleted: {},
      },
    });
  });

  it("credits real week_data ledger points on final step toggle and prevents kids from toggling siblings", async () => {
    const storedRoutine = {
      id: "rt-kids-am",
      title: "Morning Kids",
      emoji: "☀️",
      slot: "morning",
      time: "07:15",
      assignee: "Kids",
      points: 15,
      steps: [{ id: "m1", title: "Brush teeth", emoji: "🪥" }],
    };

    mocks.readSessionCookie.mockReturnValue("cookie-val");
    mocks.requireLiveSession.mockResolvedValue({
      ok: true,
      member: { id: "c1", name: "Aurora", role: "child" },
    });
    mocks.getFirstListItem.mockImplementation(async (filter: string) => {
      if (filter.includes("family_routines")) return { id: "r1", value: [storedRoutine] };
      if (filter.includes("routine_accountability_state")) {
        return { id: "a1", value: { lastSweptDay: "2026-11-10", missedEntries: [], streaks: {} } };
      }
      throw new Error("not found");
    });
    mocks.update.mockResolvedValue({});
    mocks.create.mockResolvedValue({});

    // Kid session trying to toggle sibling "Caspian" must be forbidden
    const forbiddenReq = new Request("http://localhost/api/routines/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "toggle_step",
        date: "2026-11-11",
        routineId: "rt-kids-am",
        stepId: "m1",
        memberName: "Caspian Garcia",
      }),
    });
    const forbiddenRes = await PROGRESS_POST(forbiddenReq as any);
    expect(forbiddenRes.status).toBe(403);

    // Kid checking her own final step credits real week_data earn
    const okReq = new Request("http://localhost/api/routines/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "toggle_step",
        date: "2026-11-11",
        routineId: "rt-kids-am",
        stepId: "m1",
        memberName: "Aurora Garcia",
      }),
    });
    const okRes = await PROGRESS_POST(okReq as any);
    const body = await okRes.json();
    expect(body).toEqual(expect.objectContaining({ ok: true }));
    expect(okRes.status).toBe(200);
    expect(body.pointsDelta).toBe(15);
    expect(body.completion.status).toBe("completed");
    expect(mocks.applyWeekLedgerOperationLocked).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          source: "routine-complete",
          entries: [
            expect.objectContaining({
              type: "earn",
              member: "Aurora Garcia",
              amount: 15,
            }),
          ],
        }),
      }),
    );
  });

  it("defers points when requiresApproval is true until a parent approves", async () => {
    const approvalRoutine = {
      id: "rt-app",
      title: "Room Blitz",
      emoji: "🧹",
      slot: "afternoon",
      time: "16:00",
      assignee: "Aurora Garcia",
      points: 30,
      requiresApproval: true,
      steps: [{ id: "s1", title: "Vacuum floor", emoji: "🧹" }],
    };

    const storedProgress: Record<string, unknown> = {
      checkedSteps: {},
      completedRoutines: {},
      memberCheckedSteps: {},
      memberCompleted: {},
    };

    mocks.getFirstListItem.mockImplementation(async (filter: string) => {
      if (filter.includes("family_routines")) return { id: "r1", value: [approvalRoutine] };
      if (filter.includes("routine_progress:")) return { id: "p1", value: { ...storedProgress } };
      if (filter.includes("routine_accountability_state")) {
        return { id: "a1", value: { lastSweptDay: "2026-11-10", missedEntries: [], streaks: {} } };
      }
      throw new Error("not found");
    });
    mocks.update.mockImplementation(async (_id: string, data: { value: unknown }) => {
      if (data.value && typeof data.value === "object" && "memberCheckedSteps" in (data.value as object)) {
        Object.assign(storedProgress, data.value);
      }
      return {};
    });

    // 1. Kid checks step -> pending_approval, 0 points posted yet
    mocks.readSessionCookie.mockReturnValue("kid-cookie");
    mocks.requireLiveSession.mockResolvedValue({
      ok: true,
      member: { id: "c1", name: "Aurora", role: "child" },
    });
    const kidRes = await PROGRESS_POST(
      new Request("http://localhost/api/routines/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle_step",
          date: "2026-11-11",
          routineId: "rt-app",
          stepId: "s1",
          memberName: "Aurora Garcia",
        }),
      }) as any,
    );
    const kidBody = await kidRes.json();
    expect(kidBody.completion.status).toBe("pending_approval");
    expect(kidBody.pointsDelta).toBe(0);
    expect(mocks.applyWeekLedgerOperationLocked).not.toHaveBeenCalled();

    // 2. Kid trying to approve own routine -> 403
    mocks.verifyPinAgainstAnyMember.mockResolvedValueOnce({
      id: "c1",
      name: "Aurora",
      role: "child",
    });
    const badApprove = await PROGRESS_POST(
      new Request("http://localhost/api/routines/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-pin": "1111" },
        body: JSON.stringify({
          action: "approve_routine",
          date: "2026-11-11",
          routineId: "rt-app",
          memberName: "Aurora Garcia",
        }),
      }) as any,
    );
    expect(badApprove.status).toBe(403);

    // 3. Parent PIN approves -> awards 30 pts
    mocks.verifyPinAgainstAnyMember.mockResolvedValueOnce({
      id: "p1",
      name: "Francisco",
      role: "parent",
    });
    const approveRes = await PROGRESS_POST(
      new Request("http://localhost/api/routines/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-pin": "9999" },
        body: JSON.stringify({
          action: "approve_routine",
          date: "2026-11-11",
          routineId: "rt-app",
          memberName: "Aurora Garcia",
        }),
      }) as any,
    );
    const approveBody = await approveRes.json();
    expect(approveRes.status).toBe(200);
    expect(approveBody.completion.status).toBe("approved");
    expect(approveBody.pointsDelta).toBe(30);
    expect(mocks.applyWeekLedgerOperationLocked).toHaveBeenCalledTimes(1);
  });
});
