import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Harness mirrors tests/unit/task-claim.test.ts: mock ONLY the PB layer and
// the shared server-auth PIN seam the claim route uses.
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

import { POST } from "@/app/api/rewards/redeem/route";

function currentWeekKey(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}

function jsonReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/rewards/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makePb(opts?: {
  rewards?: any[] | null;
  points?: Record<string, number>;
  history?: any[];
}) {
  const rewardRows =
    opts?.rewards === null
      ? []
      : opts?.rewards ?? [{ id: "r1", name: "Movie night", emoji: "🎬", cost: 150 }];
  const weekRow = {
    id: "w1",
    weekStart: currentWeekKey(),
    points: JSON.stringify(opts?.points ?? { "Caspian Garcia": 200 }),
    streak: "{}",
    lastActive: "{}",
    history: JSON.stringify(opts?.history ?? []),
  };
  const writes: any[] = [];
  return {
    writes,
    pb: {
      collection: (name: string) => {
        if (name === "rewards") {
          return { getFullList: async () => rewardRows };
        }
      return {
        getFullList: async () => [weekRow],
        update: async (_id: string, payload: any) => {
          writes.push(payload);
          Object.assign(weekRow, payload);
          return weekRow;
        },
        create: async (payload: any) => {
          writes.push(payload);
          Object.assign(weekRow, payload);
          return weekRow;
        },
        // Post-write verification read (lost-update detection, mirrors claim).
        getOne: async () => weekRow,
      };
      },
    },
  };
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.verifyPinFromPB.mockReset();
  mocks.verifyPinFromPB.mockResolvedValue({ id: "k", name: "Caspian Garcia", role: "child", emoji: "🧒" });
});

describe("POST /api/rewards/redeem", () => {
  it("deducts the SERVER cost and ignores the client-supplied cost", async () => {
    const { pb, writes } = makePb();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(
      jsonReq({ rewardId: "r1", memberName: "Caspian", pin: "1010", cost: 1 })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.weekData.points["Caspian Garcia"]).toBe(50);
    expect(writes).toHaveLength(1);
    const tx = writes[0].history.at(-1);
    expect(tx.amount).toBe(-150);
  });

  it("writes a transaction matching the app's redeem shape", async () => {
    const { pb, writes } = makePb();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    await POST(jsonReq({ rewardId: "r1", memberName: "Caspian", pin: "1010" }));

    const tx = writes[0].history.at(-1);
    expect(typeof tx.id).toBe("number");
    expect(typeof tx.timestamp).toBe("string");
    expect(tx.member).toBe("Caspian Garcia");
    expect(tx.type).toBe("redeem");
    expect(tx.amount).toBe(-150);
    expect(tx.description).toContain("Movie night");
    expect(tx.description).toMatch(/Redeemed:/);
    expect(tx.description).toBe("Redeemed: Movie night (-150pts)");
  });

  it("resolves a reward by name when the client id is not the PB row id", async () => {
    const { pb, writes } = makePb();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(
      jsonReq({ rewardId: "reward-1699", rewardName: "Movie night", memberName: "Caspian", pin: "1010" })
    );

    expect(res.status).toBe(200);
    expect(writes[0].history.at(-1).amount).toBe(-150);
  });

  it("rejects insufficient points with 400 and an honest 'needs N more pts' message", async () => {
    const { pb, writes } = makePb({ points: { "Caspian Garcia": 40 } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ rewardId: "r1", memberName: "Caspian", pin: "1010" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("insufficient");
    expect(body.error).toMatch(/needs 110 more pts/);
    expect(writes).toHaveLength(0);
  });

  it("returns 404 for an unknown reward", async () => {
    const { pb, writes } = makePb({ rewards: [] });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ rewardId: "nope", memberName: "Caspian", pin: "1010" }));

    expect(res.status).toBe(404);
    expect((await res.json()).reason).toBe("unknown-reward");
    expect(writes).toHaveLength(0);
  });

  it("rejects a wrong PIN with 401", async () => {
    mocks.verifyPinFromPB.mockResolvedValue(null);
    const { pb } = makePb();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ rewardId: "r1", memberName: "Caspian", pin: "9999" }));

    expect(res.status).toBe(401);
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("rejects a missing PIN with 401", async () => {
    const { pb } = makePb();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ rewardId: "r1", memberName: "Caspian" }));

    expect(res.status).toBe(401);
    expect(mocks.verifyPinFromPB).not.toHaveBeenCalled();
  });

  it("rejects a duplicate redeem of the same reward within 60s with 409", async () => {
    const { pb, writes } = makePb({
      history: [
        {
          id: 111,
          timestamp: new Date().toISOString(),
          member: "Caspian Garcia",
          type: "redeem",
          amount: -150,
          description: "Redeemed: Movie night (-150pts)",
        },
      ],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ rewardId: "r1", memberName: "Caspian", pin: "1010" }));

    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("duplicate");
    expect(writes).toHaveLength(0);
  });

  it("allows a second redeem after the 60s dedupe window", async () => {
    const { pb, writes } = makePb({
      history: [
        {
          id: 111,
          timestamp: new Date(Date.now() - 61_000).toISOString(),
          member: "Caspian Garcia",
          type: "redeem",
          amount: -150,
          description: "Redeemed: Movie night (-150pts)",
        },
      ],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ rewardId: "r1", memberName: "Caspian", pin: "1010" }));

    expect(res.status).toBe(200);
    expect(writes[0].history).toHaveLength(2);
  });

  // Lost-update race (mirrors tests/unit/task-claim.test.ts): two concurrent
  // redeems of different rewards by the SAME member must not clobber one
  // deduction. PocketBase has no conditional update, so the route re-reads the
  // week row after each write and retries once when its own tx is gone.
  function makeClobberingPb(opts: { clobberEveryWrite: boolean }) {
    const weekStart = currentWeekKey();
    // The concurrent writer's deduction (a different reward, same member).
    const otherTx = {
      id: 999_001,
      timestamp: new Date().toISOString(),
      member: "Caspian Garcia",
      type: "redeem",
      amount: -50,
      description: "Redeemed: Sticker pack (-50pts)",
    };
    let stored: any = {
      id: "w1",
      weekStart,
      points: JSON.stringify({ "Caspian Garcia": 200 }),
      streak: "{}",
      lastActive: "{}",
      history: JSON.stringify([]),
    };
    let updates = 0;
    const pb = {
      collection: (name: string) => {
        if (name === "rewards") {
          return { getFullList: async () => [{ id: "r1", name: "Movie night", emoji: "🎬", cost: 150 }] };
        }
        return {
          getFullList: async () => [stored],
          getOne: async () => stored,
          update: async (_id: string, payload: any) => {
            updates += 1;
            const clobber = opts.clobberEveryWrite || updates === 1;
            // Our write lands, then the concurrent writer overwrites the row
            // with its own deduction (our tx is no longer present).
            stored = clobber
              ? {
                  ...stored,
                  points: JSON.stringify({ "Caspian Garcia": 150 }),
                  history: JSON.stringify([otherTx]),
                }
              : { ...payload, id: stored.id, weekStart };
            return stored;
          },
          create: async (payload: any) => {
            stored = { ...payload, id: "w1", weekStart };
            return stored;
          },
        };
      },
    };
    return { pb, updates: () => updates, stored: () => stored, otherTx };
  }

  it("retries once when a concurrent redeem clobbers the first write, ending with BOTH deductions", async () => {
    const { pb, updates, stored } = makeClobberingPb({ clobberEveryWrite: false });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ rewardId: "r1", memberName: "Caspian", pin: "1010" }));

    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(updates()).toBe(2); // one clobbered attempt + one retry
    const raw = stored();
    const finalHistory = Array.isArray(raw.history) ? raw.history : JSON.parse(raw.history);
    const amounts = finalHistory.map((t: any) => t.amount);
    expect(amounts).toContain(-50); // the concurrent writer's deduction
    expect(amounts).toContain(-150); // ours
    const finalPoints = typeof raw.points === "string" ? JSON.parse(raw.points) : raw.points;
    expect(finalPoints["Caspian Garcia"]).toBe(0);
  });

  it("returns 409 conflict without a false success when every write is clobbered", async () => {
    const { pb, updates } = makeClobberingPb({ clobberEveryWrite: true });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({ rewardId: "r1", memberName: "Caspian", pin: "1010" }));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("conflict");
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
    expect(body.weekData).toBeUndefined();
    expect(updates()).toBe(2); // retried once, then gave up honestly
  });
});
