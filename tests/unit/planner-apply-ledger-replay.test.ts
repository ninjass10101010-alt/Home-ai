import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const PARENT_PIN = "parent-pin-fixture";
const MEMBER = "Emily G";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  requireLiveSession: vi.fn(),
  verifyPinAgainstAnyMember: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/server-auth", () => ({
  requireLiveSession: mocks.requireLiveSession,
  verifyPinAgainstAnyMember: mocks.verifyPinAgainstAnyMember,
}));

vi.mock("@/lib/hermes-tools", () => ({ getTool: () => undefined }));

import { POST } from "@/app/api/consuela/planner/apply/route";

const CURRENT_MONDAY = (() => {
  const d = new Date();
  d.setDate(d.getDate() + (d.getDay() === 0 ? -6 : 1 - d.getDay()));
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
})();

const OPENING_EARN = {
  id: 7001,
  timestamp: "2026-09-21T12:00:00.000Z",
  member: MEMBER,
  type: "earn",
  amount: 13,
  description: "Opening balance",
};

interface PbHarness {
  pb: unknown;
  weekWrites: any[];
  storedWeek: () => any;
  snapshot: () => any;
}

function makePb(opts?: { openingPoints?: number; emptyWeek?: boolean; snapshotFails?: boolean }): PbHarness {
  const openingPoints = opts?.openingPoints ?? 13;
  let weekRow: any = opts?.emptyWeek
    ? null
    : {
        id: "w1",
        weekStart: CURRENT_MONDAY,
        points: JSON.stringify({ [MEMBER]: openingPoints }),
        streak: "{}",
        lastActive: "{}",
        history: JSON.stringify([{ ...OPENING_EARN, amount: openingPoints }]),
      };
  const weekWrites: any[] = [];
  let snapshotRow: any = { id: "snapshot-1", data: { tasks: [], deletedTaskIds: [] } };

  const snapshotCollection = {
    getFullList: async () => [{ ...snapshotRow }],
    update: async (_id: string, payload: any) => {
      if (opts?.snapshotFails) throw new Error("snapshot write refused");
      snapshotRow = { ...snapshotRow, ...payload };
      return snapshotRow;
    },
    create: async (payload: any) => {
      if (opts?.snapshotFails) throw new Error("snapshot write refused");
      snapshotRow = { ...snapshotRow, ...payload };
      return snapshotRow;
    },
  };

  const pb = {
    collection: (name: string) => {
      if (name === "members") {
        return {
          getFullList: async () => [
            { id: "member-a", name: "Emily", fullName: MEMBER, role: "child" },
            { id: "parent-a", name: "Rebecca", fullName: "Rebecca G", role: "parent" },
          ],
        };
      }
      if (name === "consuela_data_snapshots") return snapshotCollection;
      return {
        getFullList: async () => (weekRow ? [weekRow] : []),
        getOne: async () => weekRow ?? null,
        update: async (id: string, payload: any) => {
          weekWrites.push(payload);
          weekRow = { ...weekRow, ...payload };
          return weekRow;
        },
        create: async (payload: any) => {
          weekWrites.push(payload);
          weekRow = { id: "w-new", ...payload };
          return weekRow;
        },
      };
    },
  };

  return {
    pb,
    weekWrites,
    storedWeek: () => weekRow,
    snapshot: () => snapshotRow,
  };
}

function readJson(value: unknown): any {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/consuela/planner/apply", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-consuela-pin": PARENT_PIN,
        cookie: "consuela_session=live-parent-session",
      },
      body: JSON.stringify(body),
    }),
  );
}

function adjustBody(operationId: string, delta = 10, reason = "helping carry groceries") {
  return { tool: "adjust_points", operationId, args: { member: "Emily", delta, reason } };
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.requireLiveSession.mockReset().mockResolvedValue({
    ok: true,
    identity: { memberId: "parent-a", name: "Rebecca", role: "parent" },
  });
  mocks.verifyPinAgainstAnyMember.mockReset().mockImplementation(async (pin: string) =>
    pin === PARENT_PIN
      ? { id: "parent-a", name: "Rebecca", fullName: "Rebecca G", role: "parent" }
      : null,
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the real ledger seam applies a replayed planner adjustment exactly once", () => {
  it("the same operation id sent twice adds the points a single time", async () => {
    const { pb, weekWrites, storedWeek } = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const first = await post(adjustBody("planner-replay-1"));
    const second = await post(adjustBody("planner-replay-1"));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(firstBody).toMatchObject({
      ok: true,
      applied: true,
      duplicate: false,
      reconciled: true,
      operationId: "planner-replay-1",
      member: MEMBER,
      delta: 10,
      newTotal: 23,
    });
    expect(secondBody).toMatchObject({
      ok: true,
      applied: false,
      duplicate: true,
      operationId: "planner-replay-1",
      newTotal: 23,
    });

    const history = readJson(storedWeek().history);
    const points = readJson(storedWeek().points);
    expect(history.filter((tx: any) => tx.type === "adjust")).toHaveLength(1);
    expect(history.filter((tx: any) => tx.meta?.operationId === "planner-replay-1")).toHaveLength(1);
    expect(points[MEMBER]).toBe(23);
    expect(weekWrites).toHaveLength(1);
  });

  it("the canonical transaction carries the operation id in tx.meta only", async () => {
    const { pb, storedWeek } = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await post(adjustBody("planner-meta-1"));
    expect(res.status).toBe(200);
    const body = await res.json();

    const last = readJson(storedWeek().history).at(-1);
    expect(last).toMatchObject({
      type: "adjust",
      member: MEMBER,
      amount: 10,
      description: "helping carry groceries",
      meta: { operationId: "planner-meta-1", source: "planner-adjust" },
    });
    expect(last.operationId).toBeUndefined();
    expect(body.weekData.history.at(-1).meta.operationId).toBe("planner-meta-1");
    expect(body.weekData.history.at(-1).operationId).toBeUndefined();
  });

  it("a DIFFERENT operation id is a second real adjustment, so once-only is the id's doing", async () => {
    const { pb, weekWrites, storedWeek } = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const first = await post(adjustBody("planner-other-1"));
    const second = await post(adjustBody("planner-other-2"));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ applied: true, duplicate: false, newTotal: 33 });

    const history = readJson(storedWeek().history);
    expect(history.filter((tx: any) => tx.type === "adjust")).toHaveLength(2);
    expect(readJson(storedWeek().points)[MEMBER]).toBe(33);
    expect(weekWrites).toHaveLength(2);
  });

  it("the same member/amount/reason with a fresh id still lands (the old 60s window is gone)", async () => {
    const { pb, storedWeek } = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    await post(adjustBody("planner-window-1"));
    const again = await post(adjustBody("planner-window-2"));

    expect(again.status).toBe(200);
    expect(readJson(storedWeek().history).filter((tx: any) => tx.type === "adjust")).toHaveLength(2);
    expect(readJson(storedWeek().points)[MEMBER]).toBe(33);
  });

  it("a week with no row yet is created carrying the adjustment", async () => {
    const { pb, weekWrites, storedWeek } = makePb({ emptyWeek: true });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await post(adjustBody("planner-fresh-week", 5, "helped out"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ newTotal: 5 });
    expect(weekWrites).toHaveLength(1);
    expect(storedWeek().weekStart).toBe(CURRENT_MONDAY);
    expect(readJson(storedWeek().points)[MEMBER]).toBe(5);
    expect(readJson(storedWeek().history)).toHaveLength(1);
  });

  it("a negative adjustment that would overdraw the balance is refused by the canonical ledger", async () => {
    const { pb, weekWrites, storedWeek } = makePb({ openingPoints: 4 });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await post(adjustBody("planner-overdraw-1", -10));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, operationId: "planner-overdraw-1" });
    expect(weekWrites).toHaveLength(0);
    expect(readJson(storedWeek().points)[MEMBER]).toBe(4);
  });

  it("a child PIN is refused before the canonical write", async () => {
    const { pb, weekWrites } = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "member-a", name: "Emily", role: "child" });

    const res = await post(adjustBody("planner-child-1"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "adult_only" });
    expect(weekWrites).toHaveLength(0);
  });

  it("an unauthenticated request is refused before the canonical write", async () => {
    const { pb, weekWrites } = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    mocks.requireLiveSession.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });

    const res = await post(adjustBody("planner-guest-1"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.verifyPinAgainstAnyMember).not.toHaveBeenCalled();
    expect(weekWrites).toHaveLength(0);
  });

  it("a projection that cannot be written still leaves the canonical write applied (202, reconciled:false)", async () => {
    const { pb, weekWrites, storedWeek } = makePb({ snapshotFails: true });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await post(adjustBody("planner-202-1"));

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, applied: true, reconciled: false, newTotal: 23 });
    expect(weekWrites).toHaveLength(1);
    expect(readJson(storedWeek().points)[MEMBER]).toBe(23);
  });

  it("a reconciled adjustment projects the canonical week into the tasks snapshot", async () => {
    const { pb, snapshot } = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await post(adjustBody("planner-snapshot-1"));

    expect(res.status).toBe(200);
    const projected = readJson(snapshot().data.weekData);
    expect(projected.points[MEMBER]).toBe(23);
    expect(projected.history.at(-1).meta.operationId).toBe("planner-snapshot-1");
  });
});
