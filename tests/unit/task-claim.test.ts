import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifyPinFromPB: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/server-auth", () => ({
  verifyPinFromPB: mocks.verifyPinFromPB,
}));

import { POST } from "@/app/api/tasks/claim/route";

function mondayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().split("T")[0];
}

function jsonReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/tasks/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Builds a fake pb whose week_data row reflects writes, unless the caller
 * overrides getOne to simulate losing a concurrent write race. */
function makePb(opts?: {
  taskPoints?: number | null;
  weekHistoryAfterWrite?: string;
  taskRow?: Record<string, unknown>;
  weekHistory?: string;
}) {
  const weekRow = {
    id: "w1",
    weekStart: mondayISO(),
    points: "{}",
    streak: "{}",
    lastActive: "{}",
    history: "[]",
    ...(opts?.weekHistory !== undefined ? { history: opts.weekHistory } : {}),
  };
  const taskRowBase = opts?.taskPoints === null ? [] : [
    { id: "task-row-1", taskId: 42, title: "Dishes", points: opts?.taskPoints ?? 5, ...(opts?.taskRow || {}) },
  ];
  const taskRow = taskRowBase;
  const updateCalls: { tasks: any[]; week_data?: any[] } = { tasks: [] };
  let written: any = null;
  // The dashboard reads points from the snapshot blob, not week_data — the
  // claim route must persist BOTH (points-display bug).
  let snapshotRow: any = { id: "snap-1", key: "tasks-snapshot", data: JSON.stringify({ tasks: [{ id: 42, title: "Dishes", points: 5, completed: false }], weekData: { weekStart: mondayISO(), points: {}, streak: {}, lastActive: {}, history: [] } }) };
  let snapshotWritten: any = null;
  return {
    updateCalls,
    weekUpdates: () => written,
    snapshotUpdates: () => snapshotWritten,
    pb: {
      collection: (name: string) => {
        if (name === "consuela_data_snapshots") {
          return {
            getFullList: async () => [snapshotRow],
            update: async (_id: string, payload: any) => {
              snapshotWritten = payload;
              snapshotRow = { ...snapshotRow, ...payload };
              return snapshotRow;
            },
            create: async (payload: any) => {
              snapshotWritten = payload;
              snapshotRow = { ...snapshotRow, ...payload };
              return snapshotRow;
            },
          };
        }
        if (name === "week_data") {
          return {
            getFullList: async () => [weekRow],
            update: async (_id: string, payload: any) => {
              written = payload;
              (updateCalls.week_data ??= []).push(payload);
              Object.assign(weekRow, payload);
              return weekRow;
            },
            create: async (payload: any) => {
              written = payload;
              (updateCalls.week_data ??= []).push(payload);
              Object.assign(weekRow, payload);
              return weekRow;
            },
            getOne: async () =>
              opts?.weekHistoryAfterWrite !== undefined
                ? { ...weekRow, history: opts.weekHistoryAfterWrite }
                : weekRow,
          };
        }
        return {
          getFullList: async () => taskRow,
          update: async (_id: string, payload: any) => {
            updateCalls.tasks.push(payload);
            return { id: "task-row-1" };
          },
        };
      },
    },
  };
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.verifyPinFromPB.mockReset();
  // The default claimant is an ADULT — the instant-earn contract. Kid
  // claimants opt into the pendingApproval branch by overriding this mock
  // with role: "child" per test.
  mocks.verifyPinFromPB.mockResolvedValue({ name: "Alex", role: "parent", emoji: "🦊" });
});

describe("POST /api/tasks/claim", () => {
  it("awards the task row's stored points and ignores client-supplied points", async () => {
    const { pb, weekUpdates } = makePb({ taskPoints: 5 });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(
      jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234", points: 999999 })
    );

    expect(res.status).toBe(200);
    expect(mocks.verifyPinFromPB).toHaveBeenCalledWith("Alex", "1234");
    const written = weekUpdates();
    const history = written.history;
    expect(history).toHaveLength(1);
    expect(history[0].amount).toBe(5);
    expect(written.points["Alex"]).toBe(5);
  });

  it("returns 404 for an unknown taskId instead of minting points", async () => {
    const { pb } = makePb({ taskPoints: null });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 999999, claimantName: "Alex", claimantPin: "1234" }));

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, reason: "unknown-task" });
  });

  it("detects a lost concurrent write and reports 409 instead of silent point loss", async () => {
    const siblingHistory = JSON.stringify([
      { id: 111, timestamp: "2026-08-24T10:00:00Z", member: "Sam", type: "earn", amount: 5, description: "Completed: Dishes (+5pts)", taskId: 42 },
    ]);
    const { pb } = makePb({ taskPoints: 5, weekHistoryAfterWrite: siblingHistory });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(
      jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" })
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.claimedBy).toBe("Sam");
  });

  it("keeps the happy path: valid pin, unclaimed task, existing week row", async () => {
    const { pb } = makePb({ taskPoints: 7 });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    const res = await POST(jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.weekData.history[0].amount).toBe(7);
  });

  it("also persists the earn into the SNAPSHOT the dashboard reads", async () => {
    // Points-display bug: the dashboard reads consuela_data_snapshots' weekData
    // leg, but the claim route only wrote week_data — so earned points never
    // showed unless a PARENT browser later pushed its own snapshot.
    const { pb, snapshotUpdates } = makePb({ taskPoints: 5 });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" }));

    expect(res.status).toBe(200);
    const snap = snapshotUpdates();
    expect(snap).toBeTruthy();
    const data = typeof snap.data === "string" ? JSON.parse(snap.data) : snap.data;
    expect(data.weekData.points["Alex"]).toBe(5);
    expect(data.weekData.history.some((t: any) => t.taskId === 42 && t.type === "earn")).toBe(true);
  });

  it("writes a crew join into the snapshot's tasks leg too", async () => {
    const { pb, snapshotUpdates } = makePb({
      taskPoints: 10,
      taskRow: { universal: false, crewSize: 3, crew: { members: [] } },
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "crew-join", taskId: 42, memberName: "Alex", pin: "1234" }));

    expect(res.status).toBe(200);
    const snap = snapshotUpdates();
    expect(snap).toBeTruthy();
    const data = typeof snap.data === "string" ? JSON.parse(snap.data) : snap.data;
    const row = (data.tasks || []).find((t: any) => t.id === 42);
    expect(row.crew.members.map((m: any) => m.name)).toEqual(["Alex"]);
  });

  it("treats a last-week status=done task as claimable again (not blocked)", async () => {
    // Stale-row bug: the rollover clears `completed` but leaves `status:"done"`
    // on the PB row; the guard blocked every such task forever.
    const { pb, weekUpdates } = makePb({
      taskPoints: 5,
      taskRow: { universal: true, completed: false, status: "done", completedInWeek: "2026-09-07" },
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" }));

    expect(res.status).toBe(200);
    expect(weekUpdates().points["Alex"]).toBe(5);
  });

  it("accepts a stealable task whose due date passed (universal false)", async () => {
    const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
    const { pb } = makePb({ taskPoints: 5, taskRow: { universal: false, stealable: true, due: yesterday } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.weekData.history[0].description).toMatch(/^Snatched:/);
  });

  it("rejects a stealable task that is not late yet", async () => {
    const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
    const { pb } = makePb({ taskPoints: 5, taskRow: { universal: false, stealable: true, due: tomorrow } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, reason: "not_late_yet" });
  });

  it("rejects a non-universal, non-stealable task", async () => {
    const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
    const { pb } = makePb({ taskPoints: 5, taskRow: { universal: false, stealable: false, due: yesterday } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" }));

    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe("not_universal");
  });

  it("child claimant → pendingApproval on the task row, no week_data earn", async () => {
    mocks.verifyPinFromPB.mockResolvedValue({ id: "k", name: "Caspian Garcia", role: "child", emoji: "🧒" });
    const { pb, updateCalls } = makePb({ taskPoints: 5 });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 42, claimantName: "Caspian", claimantPin: "1010" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, pending: true, claimedBy: "Caspian Garcia" });
    expect(body.weekData).toBeUndefined();
    expect(updateCalls.week_data).toBeUndefined(); // no earn written
    const taskPatch = updateCalls.tasks.find((p: any) => p.pendingApproval);
    expect(taskPatch).toBeTruthy();
    expect(taskPatch.pendingApproval).toMatchObject({ byName: "Caspian Garcia", points: 5 });
    // The claim still lands as a real completion (race-safe single-winner).
    expect(taskPatch).toMatchObject({ completed: true, status: "done", assignee: "Caspian Garcia", completedBy: "Caspian Garcia" });
    // A fresh claim supersedes any earlier send-back: the stale stamp MUST be
    // cleared, or the 60s snapshot pull delivers sentBackAt as "proof" the
    // pending row was reopened (mergeTasksSnapshot's sentBackElsewhere gate),
    // wiping the kid's optimistic pending row and clobbering the claim back
    // to unclaimed.
    expect(taskPatch.sentBackAt).toBeNull();
  });

  it("a second claim on the kid's pending row is still rejected", async () => {
    mocks.verifyPinFromPB.mockResolvedValue({ id: "k", name: "Caspian Garcia", role: "child", emoji: "🧒" });
    const { pb } = makePb({
      taskPoints: 5,
      taskRow: { completed: true, status: "done", pendingApproval: { byName: "Caspian Garcia", points: 5 } },
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 42, claimantName: "Caspian", claimantPin: "1010" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, reason: "already_completed" });
  });

  it("adult claim keeps the immediate-earn contract and never sets pending", async () => {
    const { pb, updateCalls } = makePb({ taskPoints: 5 });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" }));

    const body = await res.json();
    expect(body).toMatchObject({ success: true });
    expect(body.pending).toBeUndefined();
    expect(body.weekData).toBeTruthy();
    // Adults never write pendingApproval on the task row.
    expect(updateCalls.tasks.some((p: any) => p.pendingApproval)).toBe(false);
  });

  it("open task adult claim adds the speed bonus and labels it 'Fast grab'", async () => {
    const { pb, weekUpdates } = makePb({ taskPoints: 5, taskRow: { universal: true, speedBonus: 2 } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" }));

    expect(res.status).toBe(200);
    const written = weekUpdates();
    expect(written.history[0].amount).toBe(7);
    expect(written.history[0].description).toMatch(/^Fast grab:/);
    expect(written.points["Alex"]).toBe(7);
  });

  it("kid open claim lands pendingApproval WITH the speed bonus (no points moved)", async () => {
    mocks.verifyPinFromPB.mockResolvedValue({ id: "k", name: "Caspian Garcia", role: "child", emoji: "🧒" });
    const { pb, updateCalls, weekUpdates } = makePb({ taskPoints: 5, taskRow: { universal: true, speedBonus: 3 } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 42, claimantName: "Caspian", claimantPin: "1010" }));

    expect(res.status).toBe(200);
    expect(weekUpdates()).toBeNull();
    const taskPatch = updateCalls.tasks.find((p: any) => p.pendingApproval);
    expect(taskPatch.pendingApproval).toMatchObject({ byName: "Caspian Garcia", points: 8 });
  });

  it("rejects a single claim on a crew task", async () => {
    const { pb } = makePb({ taskPoints: 5, taskRow: { universal: false, crewSize: 2, crew: null } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ taskId: 42, claimantName: "Alex", claimantPin: "1234" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, reason: "crew_task" });
  });
});

describe("POST /api/tasks/claim — crew actions", () => {
  const crewTaskRow = (overrides: Record<string, unknown> = {}) => ({
    universal: false,
    crewSize: 3,
    crew: { members: [] },
    ...overrides,
  });

  it("crew-join appends the member and is idempotent", async () => {
    const { pb, updateCalls } = makePb({ taskPoints: 10, taskRow: crewTaskRow() });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "crew-join", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.crew.members.map((m: any) => m.name)).toEqual(["Alex"]);
    expect(updateCalls.tasks[0].crew.members).toHaveLength(1);

    // A second join by the same person is a no-op 200.
    const patch = updateCalls.tasks[0].crew.members[0];
    const pb2 = makePb({ taskPoints: 10, taskRow: crewTaskRow({ crew: { members: [patch] } }) });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb2.pb));
    const res2 = await POST(jsonReq({ action: "crew-join", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res2.status).toBe(200);
    expect((await res2.json()).alreadyJoined).toBe(true);
  });

  it("crew-join returns 409 crew_full on the last slot", async () => {
    const filled = crewTaskRow({
      crewSize: 2,
      crew: { members: [{ name: "Lily", emoji: "", joinedAt: "x" }, { name: "Bailey", emoji: "", joinedAt: "y" }] },
    });
    const { pb } = makePb({ taskPoints: 10, taskRow: filled });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "crew-join", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, reason: "crew_full" });
  });

  it("crew-join rejects a non-crew task", async () => {
    const { pb } = makePb({ taskPoints: 5, taskRow: { universal: true } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "crew-join", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ reason: "not_crew_task" });
  });

  it("crew-checkin sets checkedInAt once and flips needs-approval only when full", async () => {
    const row = crewTaskRow({
      crewSize: 2,
      crew: { members: [{ name: "Alex", emoji: "", joinedAt: "x" }, { name: "Lily", emoji: "", joinedAt: "y" }] },
    });
    // Alex checks in first — no approval yet.
    const first = makePb({ taskPoints: 12, taskRow: row });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(first.pb));
    const res1 = await POST(jsonReq({ action: "crew-checkin", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res1.status).toBe(200);
    expect(first.updateCalls.tasks[0].pendingApproval).toBeUndefined();
    expect(first.updateCalls.tasks[0].crew.members.find((m: any) => m.name === "Alex").checkedInAt).toBeTruthy();

    // Lily checks in last — the task flips to Crew pending with full points.
    mocks.verifyPinFromPB.mockResolvedValue({ name: "Lily", role: "parent", emoji: "👧" });
    const second = makePb({
      taskPoints: 12,
      taskRow: crewTaskRow({
        crewSize: 2,
        crew: {
          members: [
            { name: "Alex", emoji: "", joinedAt: "x", checkedInAt: "t" },
            { name: "Lily", emoji: "", joinedAt: "y" },
          ],
        },
      }),
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(second.pb));
    const res2 = await POST(jsonReq({ action: "crew-checkin", taskId: 42, memberName: "Lily", pin: "1234" }));
    expect(res2.status).toBe(200);
    const patch = second.updateCalls.tasks[0];
    expect(patch.completed).toBe(true);
    expect(patch.pendingApproval).toMatchObject({ byName: "Crew", points: 12, crew: ["Alex", "Lily"] });
    expect(patch.sentBackAt).toBeNull();
    // The snapshot mirror carries the same sentBackAt clear (parity).
    const snap = second.snapshotUpdates();
    const snapData = typeof snap?.data === "string" ? JSON.parse(snap.data) : snap?.data;
    const snapTask = (snapData?.tasks || []).find((x: any) => x.id === 42);
    expect(snapTask?.sentBackAt).toBeNull();
    // No points were moved by a check-in.
    expect(second.weekUpdates()).toBeNull();
  });

  it("crew-checkin rejects a member not in the crew", async () => {
    const row = crewTaskRow({ crew: { members: [{ name: "Lily", emoji: "", joinedAt: "x" }] } });
    const { pb } = makePb({ taskPoints: 5, taskRow: row });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "crew-checkin", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "not_in_crew" });
  });

  it("crew-remove is parent-gated and refuses a checked-in member", async () => {
    // Non-parent caller is rejected.
    mocks.verifyPinFromPB.mockResolvedValue({ name: "Caspian Garcia", role: "child", emoji: "🧒" });
    const child = makePb({ taskPoints: 5, taskRow: crewTaskRow({ crew: { members: [] } }) });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(child.pb));
    const res1 = await POST(jsonReq({ action: "crew-remove", taskId: 42, memberName: "Caspian", pin: "1010", targetName: "Lily" }));
    expect(res1.status).toBe(403);
    expect(await res1.json()).toMatchObject({ reason: "adult_only" });

    // Parent can't remove someone who already checked in.
    mocks.verifyPinFromPB.mockResolvedValue({ name: "Rebecca Garcia", role: "parent", emoji: "🐱" });
    const parent = makePb({
      taskPoints: 5,
      taskRow: crewTaskRow({ crew: { members: [{ name: "Lily", emoji: "", joinedAt: "y", checkedInAt: "t" }] } }),
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(parent.pb));
    const res2 = await POST(jsonReq({ action: "crew-remove", taskId: 42, memberName: "Rebecca", pin: "1234", targetName: "Lily" }));
    expect(res2.status).toBe(409);
    expect(await res2.json()).toMatchObject({ reason: "member_checked_in" });

    // Parent removes a non-checked-in member successfully.
    const parent2 = makePb({
      taskPoints: 5,
      taskRow: crewTaskRow({
        crew: { members: [{ name: "Lily", emoji: "", joinedAt: "y" }, { name: "Bailey", emoji: "", joinedAt: "z" }] },
      }),
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(parent2.pb));
    const res3 = await POST(jsonReq({ action: "crew-remove", taskId: 42, memberName: "Rebecca", pin: "1234", targetName: "Lily" }));
    expect(res3.status).toBe(200);
    expect(parent2.updateCalls.tasks[0].crew.members.map((m: any) => m.name)).toEqual(["Bailey"]);
  });
});

describe("POST /api/tasks/claim — server-authoritative assigned completions", () => {
  // The kitchen display is usually a GUEST (30-min auto-logout) — assigned-task
  // completions must be server-authoritative like claims, or an earn lands on
  // one device's localStorage and never propagates.
  beforeEach(() => {
    mocks.verifyPinFromPB.mockResolvedValue({ name: "Alex", role: "parent", emoji: "🦊" });
  });

  it("complete: adult earns instantly and BOTH stores are written (week_data + snapshot)", async () => {
    const { pb, weekUpdates, snapshotUpdates, updateCalls } = makePb({
      taskPoints: 8,
      taskRow: { universal: false, completed: false, assignee: "Alex" },
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "complete", taskId: 42, memberName: "Alex", pin: "1234" }));

    expect(res.status).toBe(200);
    const written = weekUpdates();
    expect(written.points["Alex"]).toBe(8);
    expect(written.history[0]).toMatchObject({ type: "earn", amount: 8, taskId: 42 });
    expect(written.history[0].description).toMatch(/^Completed:/);
    // Task row flipped done.
    expect(updateCalls.tasks.some((p: any) => p.completed === true)).toBe(true);
    // The snapshot the dashboard READS carries the earn too.
    const snap = snapshotUpdates();
    const data = typeof snap.data === "string" ? JSON.parse(snap.data) : snap.data;
    expect(data.weekData.points["Alex"]).toBe(8);
  });

  it("complete: child lands pendingApproval — no points move, snapshot mirrors the row", async () => {
    mocks.verifyPinFromPB.mockResolvedValue({ name: "Caspian Garcia", role: "child", emoji: "🧒" });
    const { pb, weekUpdates, snapshotUpdates, updateCalls } = makePb({
      taskPoints: 6,
      taskRow: { universal: false, completed: false, assignee: "Caspian Garcia" },
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "complete", taskId: 42, memberName: "Caspian", pin: "1010" }));

    expect(res.status).toBe(200);
    expect((await res.json()).pending).toBe(true);
    expect(weekUpdates()).toBeNull(); // zero points moved
    const patch = updateCalls.tasks.find((p: any) => p.pendingApproval);
    expect(patch.pendingApproval).toMatchObject({ byName: "Caspian Garcia", points: 6 });
    const snap = snapshotUpdates();
    const data = typeof snap.data === "string" ? JSON.parse(snap.data) : snap.data;
    expect((data.tasks || []).find((t: any) => t.id === 42).pendingApproval).toMatchObject({ byName: "Caspian Garcia" });
  });

  it("complete rejects universal tasks (they go through claim) and crew tasks", async () => {
    const uni = makePb({ taskPoints: 5, taskRow: { universal: true } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(uni.pb));
    const res1 = await POST(jsonReq({ action: "complete", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res1.status).toBe(400);
    expect(await res1.json()).toMatchObject({ reason: "not_assigned" });

    const crew = makePb({ taskPoints: 5, taskRow: { universal: false, crewSize: 2, crew: { members: [] } } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(crew.pb));
    const res2 = await POST(jsonReq({ action: "complete", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res2.status).toBe(400);
    expect(await res2.json()).toMatchObject({ reason: "crew_task" });
  });

  it("complete is idempotent within the week: an existing unreversed earn → 409", async () => {
    const monday = mondayISO();
    const seededHistory = JSON.stringify([
      { id: 1, timestamp: "2026-09-18T10:00:00.000Z", member: "Alex", type: "earn", amount: 5, description: "Completed: Dishes (+5pts)", taskId: 42 },
    ]);
    const { pb } = makePb({
      taskPoints: 5,
      taskRow: { universal: false, completed: true, completedInWeek: monday },
      weekHistory: seededHistory,
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "complete", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(["already_completed", "already-claimed"]).toContain(body.reason);
  });

  it("undo: reverses the earn server-side (adjust -N, points reduced, row reopened, snapshot updated)", async () => {
    const monday = mondayISO();
    const seededHistory = JSON.stringify([
      { id: 1, timestamp: "2026-09-18T10:00:00.000Z", member: "Alex", type: "earn", amount: 8, description: "Completed: Dishes (+8pts)", taskId: 42 },
    ]);
    const { pb, updateCalls, snapshotUpdates } = makePb({
      taskPoints: 8,
      taskRow: { universal: false, completed: true, completedBy: "Alex", completedAt: "2026-09-18T10:00:00.000Z", completedInWeek: monday, assignee: "Alex" },
      weekHistory: seededHistory,
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "undo", taskId: 42, memberName: "Alex", pin: "1234" }));

    expect(res.status).toBe(200);
    // The week write carried the adjust tx and reduced points.
    const weekWrite = updateCalls.week_data?.[0];
    expect(weekWrite).toBeTruthy();
    expect(weekWrite.points["Alex"]).toBe(0);
    expect(weekWrite.history.some((t: any) => t.type === "adjust" && t.amount === -8)).toBe(true);
    // The snapshot the UI reads shows the reversal too.
    const snap = snapshotUpdates();
    const data = typeof snap.data === "string" ? JSON.parse(snap.data) : snap.data;
    const adj = (data.weekData.history || []).find((t: any) => t.type === "adjust" && t.amount === -8);
    expect(adj).toBeTruthy();
    expect(data.weekData.points["Alex"]).toBe(0);
    // Task row reopened.
    const reopenPatch = updateCalls.tasks.find((p: any) => p.completed === false);
    expect(reopenPatch).toBeTruthy();
  });

  it("pending undo (unpaid kid tap) stamps sentBackAt on BOTH the collection row and the snapshot", async () => {
    const { pb, updateCalls, snapshotUpdates } = makePb({
      taskPoints: 5,
      taskRow: {
        universal: false,
        completed: true,
        status: "done",
        completedBy: "Caspian Garcia",
        completedInWeek: mondayISO(),
        pendingApproval: { byName: "Caspian Garcia", at: "2026-09-19T18:00:00.000Z", points: 5 },
        sentBackAt: "2026-09-19T17:00:00.000Z",
      },
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ action: "undo", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res.status).toBe(200);

    const coll = updateCalls.tasks.find((p: any) => p.completed === false);
    expect(coll).toBeTruthy();
    expect(typeof coll.sentBackAt).toBe("string");
    expect(coll.sentBackAt).not.toBe("2026-09-19T17:00:00.000Z");

    const snap = snapshotUpdates();
    expect(snap).toBeTruthy();
    const data = typeof snap.data === "string" ? JSON.parse(snap.data) : snap.data;
    const t = (data.tasks || []).find((x: any) => x.id === 42);
    expect(t.completed).toBe(false);
    expect(typeof t.sentBackAt).toBe("string");
    expect(t.sentBackAt).not.toBe("2026-09-19T17:00:00.000Z");
  });

  it("undo with nothing to undo → 409, and a reversed earn → 409 already_undone", async () => {
    const monday = mondayISO();
    const noEarn = makePb({ taskPoints: 5, taskRow: { universal: false, completed: true, completedBy: "Alex", completedInWeek: monday } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(noEarn.pb));
    const res1 = await POST(jsonReq({ action: "undo", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res1.status).toBe(409);
    expect(await res1.json()).toMatchObject({ reason: "nothing_to_undo" });

    const seededHistory = JSON.stringify([
      { id: 1, timestamp: "2026-09-18T10:00:00.000Z", member: "Alex", type: "earn", amount: 5, description: "x", taskId: 42 },
      { id: 2, timestamp: "2026-09-18T12:00:00.000Z", member: "Alex", type: "adjust", amount: -5, description: "Undo", taskId: 42 },
    ]);
    const undone = makePb({ taskPoints: 5, taskRow: { universal: false, completed: false }, weekHistory: seededHistory });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(undone.pb));
    const res2 = await POST(jsonReq({ action: "undo", taskId: 42, memberName: "Alex", pin: "1234" }));
    expect(res2.status).toBe(409);
    expect(await res2.json()).toMatchObject({ reason: "already_undone" });
  });
});
