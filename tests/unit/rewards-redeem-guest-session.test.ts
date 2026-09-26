/**
 * Task 10 — a reward redemption is PIN-authenticated, not session-authenticated.
 * The kitchen display (and any auto-logged-out device) has no session, so
 * without the middleware exemption a kid's redemption 401s BEFORE the PIN is
 * ever checked and the points never move. These tests drive the real
 * middleware with a guest (no cookie) and then the real route with the member
 * PIN, so the whole guest path is proven end to end.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifyPinFromPB: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));
vi.mock("@/lib/server-auth", () => ({ verifyPinFromPB: mocks.verifyPinFromPB }));

import { middleware } from "@/middleware";
import { POST as redeemPOST } from "@/app/api/rewards/redeem/route";

function currentWeekKey(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().split("T")[0];
}

function makePb() {
  // The canonical balance is recomputed from history by the shared ledger
  // seam, so the stored points map needs a real transaction behind it.
  const openingEarn = {
    id: 7001,
    timestamp: "2026-09-21T12:00:00.000Z",
    member: "Caspian Garcia",
    type: "earn",
    amount: 40,
    description: "Opening balance",
  };
  const weekRow = {
    id: "w1",
    weekStart: currentWeekKey(),
    points: JSON.stringify({ "Caspian Garcia": 40 }),
    streak: "{}",
    lastActive: "{}",
    history: JSON.stringify([openingEarn]),
  };
  let snapshotRow: any = { id: "snapshot-1", data: { tasks: [], deletedTaskIds: [] } };
  const writes: any[] = [];
  return {
    writes,
    pb: {
      collection: (name: string) => {
        if (name === "members") {
          return { getFullList: async () => [{ name: "Rebecca Garcia", role: "parent" }] };
        }
        if (name === "rewards") {
          return { getFullList: async () => [{ id: "r-cheap", name: "Ice cream", emoji: "🍦", cost: 15 }] };
        }
        if (name === "consuela_data_snapshots") {
          return {
            getFullList: async () => [{ ...snapshotRow }],
            update: async (_id: string, payload: any) => {
              snapshotRow = { ...snapshotRow, ...payload };
              return snapshotRow;
            },
            create: async (payload: any) => {
              snapshotRow = { ...snapshotRow, ...payload };
              return snapshotRow;
            },
          };
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
          getOne: async () => weekRow,
        };
      },
    },
  };
}

function guestRequest(path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  mocks.withAdmin.mockReset();
  mocks.verifyPinFromPB.mockReset().mockImplementation(async (name: string, pin: string) => (
    pin === "1010" ? { id: "k", name: "Caspian Garcia", role: "child", emoji: "🧒" } : null
  ));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a guest session can reach reward redemption", () => {
  it("the middleware lets a request with NO session cookie through to the route", async () => {
    const res = await middleware(guestRequest("/api/rewards/redeem"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.status).not.toBe(401);
  });

  it("the real route deducts the points for a guest device with a valid member PIN", async () => {
    const { pb, writes } = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    // No `consuela_session` cookie anywhere: identity is the PIN alone.
    const request = guestRequest("/api/rewards/redeem", {
      operationId: "op-guest-redeem",
      rewardId: "r-cheap",
      memberName: "Caspian",
      pin: "1010",
    });
    expect(request.cookies.get("consuela_session")).toBeUndefined();

    const res = await redeemPOST(request);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.weekData.points["Caspian Garcia"]).toBe(25);
    expect(writes).toHaveLength(1);
    expect(writes[0].history.at(-1)).toMatchObject({
      type: "redeem",
      amount: -15,
      meta: { operationId: "op-guest-redeem", source: "reward-redeem" },
    });
  });

  it("the same guest request with a wrong PIN is refused by the route, not the middleware", async () => {
    const { pb, writes } = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await redeemPOST(guestRequest("/api/rewards/redeem", {
      operationId: "op-guest-wrong-pin",
      rewardId: "r-cheap",
      memberName: "Caspian",
      pin: "0000",
    }));

    expect(res.status).toBe(401);
    expect(writes).toHaveLength(0);
  });

  it("a sessionless surface the browser must NOT reach stays gated", async () => {
    const res = await middleware(guestRequest("/api/rewards/redeem-history"));
    expect(res.status).toBe(401);
  });
});
