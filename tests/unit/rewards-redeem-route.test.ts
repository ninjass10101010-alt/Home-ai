import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const memberPin = "member-pin-fixture";
const parentPin = "parent-pin-fixture";

// The route owns NO ledger write. The Wave 1 helper is the only writer, so the
// harness replaces the seam and records exactly what the route asked it to do.
const ledger = vi.hoisted(() => ({
  calls: [] as any[],
  result: undefined as any,
  queue: [] as any[],
  failure: null as Error | null,
}));

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifyPinFromPB: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

// The real `namesMatch` stays live: the route resolves the approving parent
// with the SAME matcher `verifyPinFromPB` uses, and only the PIN seam is
// replaced.
vi.mock("@/lib/server-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server-auth")>();
  return { ...actual, verifyPinFromPB: mocks.verifyPinFromPB };
});

vi.mock("@/lib/ledger-operations", () => ({
  applyWeekLedgerOperation: async (args: any) => {
    ledger.calls.push(args);
    if (ledger.failure) throw ledger.failure;
    if (ledger.queue.length > 0) return ledger.queue.shift();
    return ledger.result;
  },
}));

import { POST } from "@/app/api/rewards/redeem/route";
// The ONE week key. A test that re-implements it would inherit the very
// timezone bug this suite exists to catch, so the fixture and the expectation
// both read the canonical helper the route is required to use.
import { localWeekStartISO } from "@/lib/local-date";

function jsonReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/rewards/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rawReq(body: string): NextRequest {
  return new NextRequest("http://localhost/api/rewards/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

const ROSTER = [
  { id: "member-a", name: "Member A", role: "child", emoji: "🧒" },
  { id: "parent-a", name: "Parent A", role: "parent", emoji: "👩" },
];

const EXPENSIVE_REWARD = {
  id: "reward-row-1",
  name: "Movie night",
  emoji: "🎬",
  cost: 150,
  category: "fun",
};

const CHEAP_REWARD = {
  id: "reward-row-2",
  name: "Ice cream",
  emoji: "🍦",
  cost: 15,
  category: "fun",
};

const REWARDS = [EXPENSIVE_REWARD, CHEAP_REWARD];

function weekFixture(overrides?: { points?: Record<string, number>; history?: any[] }) {
  return {
    weekStart: localWeekStartISO(),
    points: overrides?.points ?? { "Member A": 200 },
    streak: {},
    lastActive: {},
    history: overrides?.history ?? [],
  };
}

function redeemFixture(extra?: Record<string, unknown>) {
  return {
    ok: true,
    applied: true,
    duplicate: false,
    semanticDuplicate: false,
    reconciled: true,
    weekData: weekFixture(),
    operationId: "redeem-fixture",
    ...extra,
  };
}

function failureFixture(code: string, weekData = weekFixture()) {
  return {
    ok: false,
    code,
    applied: false,
    duplicate: false,
    semanticDuplicate: false,
    reconciled: false,
    weekData,
    operationId: "redeem-fixture",
  };
}

/**
 * A PB double whose `week_data` collection is a TRAP: any access is recorded,
 * so a test can prove the route itself never reads or writes the canonical
 * ledger row. The snapshot collection is real enough for the projection seam.
 */
function makePb(opts?: {
  rewards?: any[];
  members?: any[];
  snapshotFails?: boolean;
  queuedRows?: any[];
}) {
  const rewardRows = opts?.rewards ?? REWARDS;
  const memberRows = opts?.members ?? ROSTER;
  const queuedRows = opts?.queuedRows ?? [];
  const access: string[] = [];
  const snapshotWrites: any[] = [];
  let snapshotRow: any = {
    id: "snapshot-1",
    data: { tasks: [], deletedTaskIds: [] },
  };
  const pb = {
    collection: (name: string) => {
      if (name === "rewards") {
        return { getFullList: async () => rewardRows };
      }
      if (name === "members") {
        return { getFullList: async () => memberRows };
      }
      if (name === "consuela_data_snapshots") {
        return {
          getFullList: async () => [{ ...snapshotRow }],
          update: async (_id: string, payload: any) => {
            if (opts?.snapshotFails) throw new Error("snapshot write refused");
            snapshotWrites.push(payload);
            snapshotRow = { ...snapshotRow, ...payload };
            return snapshotRow;
          },
          create: async (payload: any) => {
            if (opts?.snapshotFails) throw new Error("snapshot write refused");
            snapshotWrites.push(payload);
            snapshotRow = { ...snapshotRow, ...payload };
            return snapshotRow;
          },
        };
      }
      if (name === "week_data") {
        return {
          getFullList: async () => {
            access.push("week_data.getFullList");
            return [];
          },
          getOne: async () => {
            access.push("week_data.getOne");
            return null;
          },
          update: async () => {
            access.push("week_data.update");
            return null;
          },
          create: async () => {
            access.push("week_data.create");
            return null;
          },
        };
      }
      access.push(`${name}.getFullList`);
      return {
        getFullList: async () => [],
        // The route's server-queue leg (`route.ts:314-338`, body at :75-80)
        // reaches this on a persistent ledger failure. Without a real `create`
        // it threw a TypeError the route swallowed at :329-331, and two 503
        // tests passed for the wrong reason.
        create: async (data: any) => {
          queuedRows.push(data);
          return data;
        },
      };
    },
  };
  return { pb, access, snapshotWrites, queuedRows };
}

function fixturePin(name: string): string | null {
  if (name === "Member A") return memberPin;
  if (name === "Parent A") return parentPin;
  return null;
}

beforeEach(() => {
  ledger.calls.length = 0;
  ledger.queue.length = 0;
  ledger.failure = null;
  ledger.result = redeemFixture();
  mocks.withAdmin.mockReset().mockImplementation((fn: (p: unknown) => Promise<unknown>) =>
    fn(makePb().pb),
  );
  mocks.verifyPinFromPB.mockReset().mockImplementation(async (name: string, pin: string) => {
    const row = ROSTER.find((member) => member.name === name);
    if (!row) return null;
    return fixturePin(name) === pin ? row : null;
  });
});

describe("POST /api/rewards/redeem — canonical ledger seam", () => {
  it("requires a separate parent credential for a PB reward over 100", async () => {
    ledger.result = redeemFixture({ operationId: "redeem-fixture-1" });
    const res = await POST(jsonReq({
      operationId: "redeem-fixture-1",
      rewardId: "reward-row-1",
      memberName: "Member A",
      pin: memberPin,
    }));
    expect(res.status).toBe(401);
    expect((await res.json()).reason).toBe("parent_approval_required");
    expect(ledger.calls).toHaveLength(0);
  });

  it("uses the PB reward cost and title", async () => {
    ledger.result = redeemFixture({ operationId: "redeem-fixture-2" });
    await POST(jsonReq({
      operationId: "redeem-fixture-2",
      rewardId: "reward-row-1",
      memberName: "Member A",
      pin: memberPin,
      parentName: "Parent A",
      parentPin,
      cost: 1,
      title: "Forged title",
    }));
    expect(ledger.calls[0].operation.source).toBe("reward-redeem");
    expect(ledger.calls[0].operation.entries[0]).toMatchObject({
      amount: -150,
      description: "Redeemed: Movie night (-150pts)",
    });
  });

  it("returns 202 when projection repair is pending", async () => {
    ledger.result = redeemFixture({
      operationId: "redeem-fixture-3",
      reconciled: false,
      projectionError: "projection_failed",
    });
    const res = await POST(jsonReq({
      operationId: "redeem-fixture-3",
      rewardId: "reward-row-1",
      memberName: "Member A",
      pin: memberPin,
      parentName: "Parent A",
      parentPin,
    }));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({
      ok: true,
      reconciled: false,
      operationId: "redeem-fixture-3",
    });
  });

  it("writes operation metadata on the canonical transaction", async () => {
    // The plan's own body omitted the parent credential its first case
    // requires for a >100 reward, so the approved request carries both.
    ledger.result = redeemFixture({
      operationId: "redeem-fixture-4",
      weekData: weekFixture({
        history: [{
          id: 5150,
          timestamp: "2026-09-24T12:00:00.000Z",
          member: "Member A",
          type: "redeem",
          amount: -150,
          description: "Redeemed: Movie night (-150pts)",
          meta: { operationId: "redeem-fixture-4", source: "reward-redeem" },
        }],
      }),
    });
    const res = await POST(jsonReq({
      operationId: "redeem-fixture-4",
      rewardId: "reward-row-1",
      memberName: "Member A",
      pin: memberPin,
      parentName: "Parent A",
      parentPin,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.weekData.history.at(-1).meta.operationId).toBe("redeem-fixture-4");
    expect(body.weekData.history.at(-1).operationId).toBeUndefined();
    expect(ledger.calls[0].operation.entries[0]).not.toHaveProperty("operationId");
  });

  it("deducts the SERVER cost and ignores the client-supplied cost", async () => {
    const { pb } = makePb();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    ledger.result = redeemFixture({ operationId: "op-forged-cost" });

    const res = await POST(jsonReq({
      operationId: "op-forged-cost",
      rewardId: "reward-row-1",
      memberName: "Member A",
      pin: memberPin,
      parentName: "Parent A",
      parentPin,
      cost: 1,
    }));

    expect(res.status).toBe(200);
    expect(ledger.calls[0].operation.entries[0].amount).toBe(-150);
  });

  it("writes a redeem entry in the app's transaction shape for the redeeming member", async () => {
    await POST(jsonReq({
      operationId: "op-cheap",
      rewardId: "reward-row-2",
      memberName: "Member A",
      pin: memberPin,
    }));

    expect(ledger.calls[0].operation.entries[0]).toEqual({
      type: "redeem",
      member: "Member A",
      amount: -15,
      description: "Redeemed: Ice cream (-15pts)",
    });
    expect(ledger.calls[0].weekStart).toBe(localWeekStartISO());
  });

  it("resolves a reward by name when the client id is not the PB row id", async () => {
    ledger.result = redeemFixture({ operationId: "op-by-name" });
    const res = await POST(jsonReq({
      operationId: "op-by-name",
      rewardId: "reward-1699",
      rewardName: "Ice cream",
      memberName: "Member A",
      pin: memberPin,
    }));

    expect(res.status).toBe(200);
    expect(ledger.calls[0].operation.entries[0].amount).toBe(-15);
  });

  it("answers the acknowledgement with the server-owned member, reward and week", async () => {
    ledger.result = redeemFixture({ operationId: "op-shape" });
    const res = await POST(jsonReq({
      operationId: "op-shape",
      rewardId: "reward-row-1",
      memberName: "Member A",
      pin: memberPin,
      parentName: "Parent A",
      parentPin,
    }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      applied: true,
      duplicate: false,
      reconciled: true,
      operationId: "op-shape",
      member: "Member A",
      reward: { id: "reward-row-1", name: "Movie night", cost: 150, emoji: "🎬" },
    });
  });

  it("records the redeeming member as the ledger actor", async () => {
    await POST(jsonReq({
      operationId: "op-actor",
      rewardId: "reward-row-2",
      memberName: "Member A",
      pin: memberPin,
    }));

    expect(ledger.calls[0].operation.actorId).toBe("member-a");
  });

  it("replays a duplicate operation without applying a second entry", async () => {
    ledger.result = redeemFixture({
      operationId: "op-replay",
      applied: false,
      duplicate: true,
    });
    const res = await POST(jsonReq({
      operationId: "op-replay",
      rewardId: "reward-row-2",
      memberName: "Member A",
      pin: memberPin,
    }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, applied: false, duplicate: true });
    expect(ledger.calls).toHaveLength(1);
    expect(ledger.calls[0].operation.operationId).toBe("op-replay");
    expect(ledger.calls[0].operation.source).toBe("reward-redeem");
    expect(ledger.calls[0].operation.actorId).toBe("member-a");
    expect(ledger.calls[0].operation.entries).toEqual([
      { type: "redeem", member: "Member A", amount: -15, description: "Redeemed: Ice cream (-15pts)" },
    ]);
  });

  it("never reads or writes week_data itself", async () => {
    const { pb, access } = makePb();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    await POST(jsonReq({
      operationId: "op-no-week-access",
      rewardId: "reward-row-2",
      memberName: "Member A",
      pin: memberPin,
    }));

    expect(access).toEqual([]);
  });

  it("projects the canonical week into the snapshot after verification", async () => {
    const { pb, snapshotWrites } = makePb();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    await POST(jsonReq({
      operationId: "op-project",
      rewardId: "reward-row-2",
      memberName: "Member A",
      pin: memberPin,
    }));
    const canonical = weekFixture({
      history: [{
        id: 4242,
        timestamp: "2026-09-24T12:00:00.000Z",
        member: "Member A",
        type: "redeem",
        amount: -15,
        description: "Redeemed: Ice cream (-15pts)",
        meta: { operationId: "op-project", source: "reward-redeem" },
      }],
    });

    const project = ledger.calls[0].project;
    expect(typeof project).toBe("function");
    expect(await project({
      pb,
      weekData: canonical,
      operationId: "op-project",
      applied: true,
      duplicate: false,
      semanticDuplicate: false,
    })).toBe(true);
    expect(snapshotWrites).toHaveLength(1);
    expect(snapshotWrites[0].data.weekData.history.at(-1).meta.operationId).toBe("op-project");
  });

  it("reports a pending repair instead of a false success when the projection cannot be written", async () => {
    const { pb, snapshotWrites } = makePb({ snapshotFails: true });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    await POST(jsonReq({
      operationId: "op-projection-fail",
      rewardId: "reward-row-2",
      memberName: "Member A",
      pin: memberPin,
    }));

    const project = ledger.calls[0].project;
    const ok = await project({
      pb,
      weekData: weekFixture(),
      operationId: "op-projection-fail",
      applied: true,
      duplicate: false,
      semanticDuplicate: false,
    });
    expect(ok).toBe(false);
    expect(snapshotWrites).toHaveLength(0);
  });
});

describe("POST /api/rewards/redeem — validation and credentials", () => {
  it("rejects malformed JSON with 400 invalid_body and no ledger call", async () => {
    const res = await POST(rawReq("{not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe("invalid_body");
    expect(ledger.calls).toHaveLength(0);
  });

  it("rejects a non-object body with 400 invalid_body", async () => {
    const res = await POST(rawReq("[]"));
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe("invalid_body");
    expect(ledger.calls).toHaveLength(0);
  });

  it("refuses a missing or blank operation ID before any point-changing work", async () => {
    for (const operationId of [undefined, "", "   "]) {
      const res = await POST(jsonReq({
        ...(operationId === undefined ? {} : { operationId }),
        rewardId: "reward-row-2",
        memberName: "Member A",
        pin: memberPin,
      }));
      expect(res.status).toBe(400);
      expect((await res.json()).reason).toBe("invalid_body");
    }
    expect(ledger.calls).toHaveLength(0);
    expect(mocks.verifyPinFromPB).not.toHaveBeenCalled();
  });

  it("rejects a body with no reward id or no member name with 400 invalid_body", async () => {
    const missingReward = await POST(jsonReq({
      operationId: "op-missing-reward",
      memberName: "Member A",
      pin: memberPin,
    }));
    expect(missingReward.status).toBe(400);
    expect((await missingReward.json()).reason).toBe("invalid_body");

    const missingMember = await POST(jsonReq({
      operationId: "op-missing-member",
      rewardId: "reward-row-2",
      pin: memberPin,
    }));
    expect(missingMember.status).toBe(400);
    expect((await missingMember.json()).reason).toBe("invalid_body");
    expect(ledger.calls).toHaveLength(0);
  });

  it("rejects a wrong member PIN with 401 and never reaches PocketBase", async () => {
    const res = await POST(jsonReq({
      operationId: "op-wrong-pin",
      rewardId: "reward-row-1",
      memberName: "Member A",
      pin: "wrong-pin-fixture",
    }));

    expect(res.status).toBe(401);
    expect((await res.json()).reason).toBe("invalid_pin");
    expect(mocks.withAdmin).not.toHaveBeenCalled();
    expect(ledger.calls).toHaveLength(0);
  });

  it("rejects a missing member PIN with 401 before any verification call", async () => {
    const res = await POST(jsonReq({
      operationId: "op-no-pin",
      rewardId: "reward-row-1",
      memberName: "Member A",
    }));

    expect(res.status).toBe(401);
    expect((await res.json()).reason).toBe("invalid_pin");
    expect(mocks.verifyPinFromPB).not.toHaveBeenCalled();
    expect(ledger.calls).toHaveLength(0);
  });

  it("refuses a high-cost reward whose approver is not a parent", async () => {
    const res = await POST(jsonReq({
      operationId: "op-child-approver",
      rewardId: "reward-row-1",
      memberName: "Member A",
      pin: memberPin,
      parentName: "Member A",
      parentPin: memberPin,
    }));

    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("parent_only");
    expect(ledger.calls).toHaveLength(0);
  });

  it("refuses a high-cost reward whose approver is not on the live roster", async () => {
    const res = await POST(jsonReq({
      operationId: "op-ghost-approver",
      rewardId: "reward-row-1",
      memberName: "Member A",
      pin: memberPin,
      parentName: "Ghost Parent",
      parentPin,
    }));

    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("parent_only");
    expect(ledger.calls).toHaveLength(0);
  });

  it("refuses a high-cost reward whose parent PIN is wrong", async () => {
    const res = await POST(jsonReq({
      operationId: "op-wrong-parent-pin",
      rewardId: "reward-row-1",
      memberName: "Member A",
      pin: memberPin,
      parentName: "Parent A",
      parentPin: "wrong-pin-fixture",
    }));

    expect(res.status).toBe(401);
    expect((await res.json()).reason).toBe("invalid_pin");
    expect(ledger.calls).toHaveLength(0);
  });

  it("never needs a parent credential at or below the threshold", async () => {
    const { pb } = makePb({
      rewards: [{ id: "reward-edge", name: "Big treat", emoji: "🍕", cost: 100 }],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    ledger.result = redeemFixture({ operationId: "op-edge" });

    const res = await POST(jsonReq({
      operationId: "op-edge",
      rewardId: "reward-edge",
      memberName: "Member A",
      pin: memberPin,
    }));

    expect(res.status).toBe(200);
    expect(ledger.calls).toHaveLength(1);
    expect(ledger.calls[0].operation.entries[0].amount).toBe(-100);
  });

  it("answers 404 unknown_reward for a reward that is not in PocketBase", async () => {
    const res = await POST(jsonReq({
      operationId: "op-unknown-reward",
      rewardId: "nope",
      memberName: "Member A",
      pin: memberPin,
    }));

    expect(res.status).toBe(404);
    expect((await res.json()).reason).toBe("unknown_reward");
    expect(ledger.calls).toHaveLength(0);
  });

  it("refuses a stored reward row whose cost is not a usable point value", async () => {
    const { pb } = makePb({
      rewards: [{ id: "reward-broken", name: "Broken", emoji: "🧨", cost: "many" }],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const res = await POST(jsonReq({
      operationId: "op-broken-cost",
      rewardId: "reward-broken",
      memberName: "Member A",
      pin: memberPin,
    }));

    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe("ledger_unavailable");
    expect(ledger.calls).toHaveLength(0);
  });
});

describe("POST /api/rewards/redeem — the ledger week is the LOCAL week", () => {
  // A redemption is a DEDUCTION from one `week_data` row. The rollover
  // (`task-week-rollover`) and the planner both key that row on
  // `localWeekStartISO()`, so any other derivation strands the deduction: the
  // balance is taken from a row the family never sees again.
  //
  // The defect was `setHours(0, 0, 0, 0)` followed by `.toISOString()` — local
  // midnight serialised as UTC. EAST of UTC that resolves to the PREVIOUS day
  // (on a Sunday, the previous week), and Detroit — where this suite's vitest
  // config pins TZ — is behind UTC, where the bug is invisible. So this case
  // re-pins the zone at runtime: Node re-reads `process.env.TZ`, and
  // `localWeekStartISO` honours `process.env.TZ` explicitly through
  // `toLocaleString`, so the assertion is real rather than vacuous.
  const MONDAY_0030_JST = "2026-09-27T15:30:00.000Z"; // = Mon 2026-09-28 00:30 in Tokyo

  async function underTokyoMonday(run: () => Promise<void>): Promise<void> {
    const previousTz = process.env.TZ;
    process.env.TZ = "Asia/Tokyo";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(MONDAY_0030_JST));
    try {
      await run();
    } finally {
      vi.useRealTimers();
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    }
  }

  it("writes to the LOCAL Monday, not the UTC-shifted day east of UTC", async () => {
    await underTokyoMonday(async () => {
      ledger.result = redeemFixture({ operationId: "op-tokyo-week" });

      const res = await POST(jsonReq({
        operationId: "op-tokyo-week",
        rewardId: "reward-row-2",
        memberName: "Member A",
        pin: memberPin,
      }));

      expect(res.status).toBe(200);
      // The canonical answer in Tokyo on Monday 2026-09-28.
      expect(localWeekStartISO()).toBe("2026-09-28");
      expect(ledger.calls[0].weekStart).toBe("2026-09-28");
      // What the UTC-serializing path produced: Tokyo Sunday 2026-09-27 —
      // not even a week start, and a row the rollover will never open.
      expect(ledger.calls[0].weekStart).not.toBe("2026-09-27");
    });
  });

  it("agrees with the canonical week key the rollover and planner use", async () => {
    await underTokyoMonday(async () => {
      ledger.result = redeemFixture({ operationId: "op-tokyo-parity" });

      await POST(jsonReq({
        operationId: "op-tokyo-parity",
        rewardId: "reward-row-2",
        memberName: "Member A",
        pin: memberPin,
      }));

      // Same instant, same answer, no separate week math anywhere in the path.
      expect(ledger.calls[0].weekStart).toBe(localWeekStartISO());
    });
  });
});

describe("POST /api/rewards/redeem — ledger result mapping", () => {
  it("maps an insufficient balance to 400 with the honest points message", async () => {
    ledger.result = failureFixture(
      "insufficient_balance",
      weekFixture({ points: { "Member A": 4 } }),
    );

    const res = await POST(jsonReq({
      operationId: "op-insufficient",
      rewardId: "reward-row-2",
      memberName: "Member A",
      pin: memberPin,
    }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("insufficient");
    expect(body.error).toMatch(/needs 11 more pts/);
  });

  it("maps a semantic duplicate to 409 duplicate", async () => {
    ledger.result = failureFixture("operation_conflict");

    const res = await POST(jsonReq({
      operationId: "op-duplicate",
      rewardId: "reward-row-2",
      memberName: "Member A",
      pin: memberPin,
    }));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.reason).toBe("duplicate");
    expect(body.operationId).toBe("redeem-fixture");
    expect(body.weekData).toBeUndefined();
  });

  it("queues after one same-operation retry, and never reports the redemption as done", async () => {
    ledger.queue = [
      failureFixture("ledger_write_conflict"),
      failureFixture("ledger_write_conflict"),
    ];

    const res = await POST(jsonReq({
      operationId: "op-write-conflict",
      rewardId: "reward-row-2",
      memberName: "Member A",
      pin: memberPin,
    }));

    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({
      ok: false,
      queued: true,
      retryable: true,
      reason: "ledger_unavailable",
    });
    expect(ledger.calls).toHaveLength(2);
    expect(ledger.calls.map((call) => call.operation.operationId)).toEqual([
      "op-write-conflict",
      "op-write-conflict",
    ]);
  });

  it("acknowledges the redemption when the retried write lands", async () => {
    ledger.queue = [failureFixture("ledger_write_conflict"), redeemFixture({ operationId: "op-retry" })];

    const res = await POST(jsonReq({
      operationId: "op-retry",
      rewardId: "reward-row-2",
      memberName: "Member A",
      pin: memberPin,
    }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, operationId: "op-retry" });
    expect(ledger.calls).toHaveLength(2);
  });

  it("queues an invalid ledger operation for retry rather than reporting a deduction", async () => {
    ledger.result = failureFixture("invalid_ledger_operation");

    const res = await POST(jsonReq({
      operationId: "op-invalid",
      rewardId: "reward-row-2",
      memberName: "Member A",
      pin: memberPin,
    }));

    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({
      ok: false,
      queued: true,
      reason: "ledger_unavailable",
    });
  });

  it("queues a redemption the retry does not fix, under the SAME operationId, and never reports it done", async () => {
    const queuedRows: any[] = [];
    mocks.withAdmin.mockImplementation((fn: any) => fn(makePb({ queuedRows }).pb));
    ledger.queue = [
      failureFixture("ledger_write_conflict"),
      failureFixture("ledger_write_conflict"),
    ];

    const res = await POST(jsonReq({
      operationId: "op-queue-me",
      rewardId: "reward-row-2",
      memberName: "Member A",
      pin: memberPin,
    }));

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, queued: true, retryable: true, operationId: "op-queue-me" });
    // The retry reused the id, so a partial apply can never apply twice (route.ts:291-295).
    expect(ledger.calls.map((call) => call.operation.operationId)).toEqual(["op-queue-me", "op-queue-me"]);
    // The durable leg exists, and it is a DEDUCTION with no PIN in the row.
    expect(queuedRows).toHaveLength(1);
    expect(queuedRows[0]).toMatchObject({
      operationId: "op-queue-me", route: "/api/rewards/redeem", action: "redeem",
      actorAuthentication: "pin", status: "pending",
    });
    expect(JSON.stringify(queuedRows[0])).not.toMatch(new RegExp(memberPin));
  });

  it("answers 503 when the ledger seam itself is unreachable", async () => {
    ledger.failure = new Error("pocketbase unreachable");

    const res = await POST(jsonReq({
      operationId: "op-unreachable",
      rewardId: "reward-row-2",
      memberName: "Member A",
      pin: memberPin,
    }));

    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe("ledger_unavailable");
  });
});
