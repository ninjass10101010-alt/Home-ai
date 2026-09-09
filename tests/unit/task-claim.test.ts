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
}) {
  const weekRow = {
    id: "w1",
    weekStart: mondayISO(),
    points: "{}",
    streak: "{}",
    lastActive: "{}",
    history: "[]",
  };
  const taskRowBase = opts?.taskPoints === null ? [] : [
    { id: "task-row-1", taskId: 42, title: "Dishes", points: opts?.taskPoints ?? 5, ...(opts?.taskRow || {}) },
  ];
  const taskRow = taskRowBase;
  const updateCalls: { tasks: any[]; week_data?: any[] } = { tasks: [] };
  let written: any = null;
  return {
    updateCalls,
    weekUpdates: () => written,
    pb: {
      collection: (name: string) => {
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
});
