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

import { POST as claimPOST } from "@/app/api/tasks/claim/route";
import { POST as redeemPOST } from "@/app/api/rewards/redeem/route";
import { withWeekLedgerLock, __resetWeekLedgerLockForTests } from "@/lib/week-ledger-lock";

function mondayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().split("T")[0];
}

function jsonReq(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

type Deferred = { resolved: boolean; resolve: (v: unknown) => void; compute: () => unknown };

/** A pb double where EVERY call parks on a phase-tagged deferred the test
 * resolves by hand. That makes the interleaving explicit instead of hoping
 * microtask scheduling produces the dangerous window: both requests read the
 * week row, then finish in an order where each one's post-write verify sees
 * its OWN transaction — the silent lost-update interleaving. */
function makeRacyPb(initial?: { weekPoints?: Record<string, number> }) {
  const live = {
    task: { id: "task-row-1", taskId: 42, title: "Dishes", points: 5 },
    week: {
      id: "w1",
      weekStart: mondayISO(),
      points: initial?.weekPoints ?? {},
      streak: {},
      lastActive: {},
      history: [] as unknown[],
    },
  };
  const phases = new Map<string, Deferred[]>();
  const call = (phase: string, compute: () => unknown) =>
    new Promise<unknown>((resolve) => {
      const d: Deferred = {
        resolved: false,
        resolve: (v: unknown) => {
          d.resolved = true;
          resolve(v);
        },
        compute,
      };
      const list = phases.get(phase) ?? [];
      list.push(d);
      phases.set(phase, list);
    });
  const resolveOne = (phase: string, idx: number): boolean => {
    const d = (phases.get(phase) ?? [])[idx];
    if (!d || d.resolved) return false;
    d.resolve(d.compute());
    return true;
  };
  const weekSnapshot = () => ({
    ...live.week,
    points: { ...live.week.points },
    history: [...live.week.history],
  });
  const pb = {
    collection(name: string) {
      if (name === "tasks") {
        return {
          getFullList: () => call("tasks.read", () => [{ ...live.task }]),
          update: (_id: string, payload: Record<string, unknown>) =>
            call("tasks.write", () => {
              Object.assign(live.task, payload);
              return live.task;
            }),
        };
      }
      if (name === "rewards") {
        return {
          getFullList: () => call("rewards.read", () => [{ id: "r1", name: "Movie night", cost: 5 }]),
        };
      }
      return {
        getFullList: () => call("week.read", () => [weekSnapshot()]),
        getOne: () => call("week.verify", weekSnapshot),
        update: (_id: string, payload: Record<string, unknown>) =>
          call("week.write", () => {
            Object.assign(live.week, payload);
            return live.week;
          }),
        create: (payload: Record<string, unknown>) =>
          call("week.write", () => {
            Object.assign(live.week, payload);
            return live.week;
          }),
      };
    },
  };
  return { pb, resolveOne, snapshot: weekSnapshot };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Resolves parked pb calls one per iteration, following the given preference
 * order, skipping entries that don't exist (yet), until every response
 * settles. Entries that never appear are fine — the request path that would
 * have made them exited early. */
async function drive(
  resolveOne: (phase: string, idx: number) => boolean,
  order: Array<[string, number]>,
  responses: Array<Promise<Response>>
) {
  const settled = responses.map(() => false);
  responses.forEach((p, i) =>
    p.then(() => { settled[i] = true; }, () => { settled[i] = true; })
  );
  let guard = 0;
  while (!settled.every(Boolean)) {
    if (guard++ > 500) throw new Error("drive() stalled — a route awaited a call the order never resolves");
    let progressed = false;
    for (const [phase, idx] of order) {
      if (resolveOne(phase, idx)) {
        progressed = true;
        break;
      }
    }
    await tick();
    if (!progressed && settled.every(Boolean)) break;
  }
  return Promise.all(responses);
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.verifyPinFromPB.mockReset();
  mocks.verifyPinFromPB.mockImplementation(async (name: string) => ({
    name: String(name).includes("Sam") ? "Sam" : "Alex",
    role: "parent",
    emoji: "🦊",
  }));
  __resetWeekLedgerLockForTests();
});

describe("withWeekLedgerLock", () => {
  it("serializes same-key sections; different keys run in parallel", async () => {
    const events: string[] = [];
    const slow = (label: string, ms: number) =>
      withWeekLedgerLock("2026-09-14", async () => {
        events.push(`start:${label}`);
        await new Promise((r) => setTimeout(r, ms));
        events.push(`end:${label}`);
      });

    const a = slow("a", 20);
    const b = slow("b", 1);
    await Promise.all([a, b]);
    expect(events).toEqual(["start:a", "end:a", "start:b", "end:b"]);

    const other = withWeekLedgerLock("2026-09-21", async () => {
      events.push("other-week");
    });
    await other;
    expect(events).toContain("other-week");
  });
});

describe("week ledger lock — claim vs claim", () => {
  it("two orchestrated concurrent claims: exactly ONE success, one earn persisted, loser told who won", async () => {
    const { pb, resolveOne, snapshot } = makeRacyPb();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const p1 = claimPOST(jsonReq("/api/tasks/claim", { taskId: 42, claimantName: "Alex", claimantPin: "1234" }));
    const p2 = claimPOST(jsonReq("/api/tasks/claim", { taskId: 42, claimantName: "Sam", claimantPin: "5678" }));
    const [r1, r2] = await drive(
      resolveOne,
      [
        ["tasks.read", 0], ["tasks.read", 1],
        ["week.read", 0], ["week.read", 1],
        ["week.write", 0], ["week.verify", 0], ["tasks.write", 0],
        ["week.write", 1], ["week.verify", 1], ["tasks.write", 1],
      ],
      [p1, p2]
    );

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = r1.status === 200 ? r1 : r2;
    const loser = r1.status === 200 ? r2 : r1;
    const loserBody = await loser.json();
    expect(loserBody.success).toBe(false);

    const snap = snapshot();
    expect(snap.history).toHaveLength(1);
    const winnerBody = await winner.json();
    expect((snap.history[0] as { member: string }).member).toBe(winnerBody.claimedBy);
    expect(snap.points[winnerBody.claimedBy]).toBe(5);
  });
});

describe("week ledger lock — claim vs redeem", () => {
  it("a claim and a redeem in the same week BOTH persist (neither erases the other's transaction)", async () => {
    const { pb, resolveOne, snapshot } = makeRacyPb({ weekPoints: { Sam: 10 } });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const pClaim = claimPOST(jsonReq("/api/tasks/claim", { taskId: 42, claimantName: "Alex", claimantPin: "1234" }));
    const pRedeem = redeemPOST(jsonReq("/api/rewards/redeem", { rewardId: "r1", memberName: "Sam", pin: "5678" }));
    const [rClaim, rRedeem] = await drive(
      resolveOne,
      [
        ["tasks.read", 0], ["rewards.read", 0],
        ["week.read", 0], ["week.read", 1],
        ["week.write", 0], ["week.verify", 0], ["tasks.write", 0],
        ["week.write", 1], ["week.verify", 1],
      ],
      [pClaim, pRedeem]
    );

    expect(rClaim.status).toBe(200);
    expect(rRedeem.status).toBe(200);

    const snap = snapshot();
    expect(snap.history).toHaveLength(2);
    const earn = snap.history.find((t: any) => t.type === "earn");
    const redeem = snap.history.find((t: any) => t.type === "redeem");
    expect(earn).toMatchObject({ member: "Alex", taskId: 42, amount: 5 });
    expect(redeem).toMatchObject({ member: "Sam", amount: -5 });
    expect(snap.points).toEqual({ Alex: 5, Sam: 5 });
  });
});
