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
}) {
  const weekRow = {
    id: "w1",
    weekStart: mondayISO(),
    points: "{}",
    streak: "{}",
    lastActive: "{}",
    history: "[]",
  };
  const taskRow = opts?.taskPoints === null ? [] : [
    { id: "task-row-1", taskId: 42, title: "Dishes", points: opts?.taskPoints ?? 5 },
  ];
  let written: any = null;
  return {
    weekUpdates: () => written,
    pb: {
      collection: (name: string) => {
        if (name === "week_data") {
          return {
            getFullList: async () => [weekRow],
            update: async (_id: string, payload: any) => {
              written = payload;
              Object.assign(weekRow, payload);
              return weekRow;
            },
            create: async (payload: any) => {
              written = payload;
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
          update: async () => ({ id: "task-row-1" }),
        };
      },
    },
  };
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.verifyPinFromPB.mockReset();
  mocks.verifyPinFromPB.mockResolvedValue({ name: "Alex", role: "child", emoji: "🦊" });
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
});
