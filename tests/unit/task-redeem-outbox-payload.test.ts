// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const MEMBER_PIN = "1357";
const PARENT_PIN = "4826";
const MEMBER = "Caspian Garcia";
const PARENT = "Rebecca Garcia";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifyPinFromPB: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    selectMembers: () => [],
    selectMembersFallback: () => [],
  },
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/server-auth", () => ({
  namesMatch: (a: unknown, b: unknown) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase(),
  verifyPinFromPB: mocks.verifyPinFromPB,
}));

import { POST as redeemPOST } from "@/app/api/rewards/redeem/route";
import {
  __resetTaskOutboxForTests,
  adoptTaskOutboxAcknowledgement,
  buildTaskOperationRequestBody,
  enqueueTaskOperation,
  flushTaskOutbox,
  forgetTaskCommandCredential,
  listTaskOutbox,
  rememberTaskCommandCredential,
  resolveTaskOutboxCredential,
  sanitizeTaskOperationPayload,
  type SnapshotRead,
  type TaskOutboxDriver,
  type TaskOutboxEntry,
} from "@/lib/task-operation-outbox";
import { WEEK_DATA_KEY } from "@/lib/task-utils";
import { __resetWeekLedgerLockForTests } from "@/lib/week-ledger-lock";

const BIG_REWARD = { id: "r-movie", name: "Movie night", emoji: "🎬", cost: 150 };
const SMALL_REWARD = { id: "r-icecream", name: "Ice cream", emoji: "🍦", cost: 15 };

function currentWeekKey(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().split("T")[0];
}

const WEEK_START = currentWeekKey();

const OPENING_EARN = {
  id: 7001,
  timestamp: "2026-09-21T12:00:00.000Z",
  member: MEMBER,
  type: "earn",
  amount: 500,
  description: "Opening balance",
};

interface PbHarness {
  pb: unknown;
  weekWrites: any[];
  readPoints: () => any;
  readHistory: () => any[];
  canonicalWeek: () => any;
  snapshotWrites: () => number;
}

function readJson(value: unknown): any {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function makePb(opts: { openingPoints?: number; snapshotFails?: boolean } = {}): PbHarness {
  const openingPoints = opts.openingPoints ?? 500;
  let weekRow: any = {
    id: "w1",
    weekStart: WEEK_START,
    points: JSON.stringify({ [MEMBER]: openingPoints }),
    streak: "{}",
    lastActive: "{}",
    history: JSON.stringify([{ ...OPENING_EARN, amount: openingPoints }]),
  };
  const weekWrites: any[] = [];
  let snapshotRow: any = { id: "snapshot-1", data: { tasks: [], deletedTaskIds: [] } };
  let snapshotWrites = 0;

  const snapshotCollection = {
    getFullList: async () => [{ ...snapshotRow }],
    update: async (_id: string, payload: any) => {
      snapshotWrites += 1;
      if (opts.snapshotFails) throw new Error("snapshot write refused");
      snapshotRow = { ...snapshotRow, ...payload };
      return snapshotRow;
    },
    create: async (payload: any) => {
      snapshotWrites += 1;
      if (opts.snapshotFails) throw new Error("snapshot write refused");
      snapshotRow = { ...snapshotRow, ...payload };
      return snapshotRow;
    },
  };

  const pb = {
    collection: (name: string) => {
      if (name === "members") {
        return {
          getFullList: async () => [
            { id: "member-kid", name: MEMBER, fullName: MEMBER, role: "child" },
            { id: "member-parent", name: PARENT, fullName: PARENT, role: "parent" },
          ],
        };
      }
      if (name === "rewards") {
        return { getFullList: async () => [BIG_REWARD, SMALL_REWARD] };
      }
      if (name === "consuela_data_snapshots") return snapshotCollection;
      return {
        getFullList: async () => [weekRow],
        getOne: async () => weekRow,
        update: async (_id: string, payload: any) => {
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
    readPoints: () => readJson(weekRow.points),
    readHistory: () => readJson(weekRow.history),
    canonicalWeek: () => ({
      weekStart: weekRow.weekStart,
      points: readJson(weekRow.points),
      streak: {},
      lastActive: {},
      history: readJson(weekRow.history),
    }),
    snapshotWrites: () => snapshotWrites,
  };
}

interface PostedRequest {
  operationId: unknown;
  body: Record<string, unknown>;
}

function postToRealRoute(body: unknown): Promise<{ status: number; body: any }> {
  return redeemPOST(
    new NextRequest("http://localhost/api/rewards/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  ).then(async (res) => ({ status: res.status, body: await res.json() }));
}

function harnessDriver(
  harness: PbHarness,
  posted: PostedRequest[],
  send?: (entry: TaskOutboxEntry, body: Record<string, unknown>) => Promise<{ status: number; body: any }>,
): TaskOutboxDriver {
  return {
    getCredential: resolveTaskOutboxCredential,
    releaseCredential: forgetTaskCommandCredential,
    send: async (entry, credential) => {
      const body = buildTaskOperationRequestBody(entry, credential);
      posted.push({ operationId: body.operationId, body });
      if (send) return send(entry, body);
      return postToRealRoute(body);
    },
    pullSnapshot: async (): Promise<SnapshotRead> => ({
      snapshot: { tasks: [], deletedTaskIds: [], weekData: harness.canonicalWeek() } as any,
      reconciled: true,
    }),
    adoptSnapshot: async () => {},
    onAcknowledged: adoptTaskOutboxAcknowledgement,
  };
}

function redeemEntry(
  operationId: string,
  overrides: { rewardId?: string; memberName?: string; parentName?: string } = {},
): TaskOutboxEntry {
  return enqueueTaskOperation({
    operationId,
    route: "/api/rewards/redeem",
    action: "redeem",
    payload: {
      rewardId: overrides.rewardId ?? BIG_REWARD.id,
      memberName: overrides.memberName ?? MEMBER,
      ...(overrides.parentName ? { parentName: overrides.parentName } : {}),
    },
    displayTarget: { kind: "config", title: BIG_REWARD.name },
  });
}

function localWeek(): any {
  const raw = localStorage.getItem(WEEK_DATA_KEY);
  return raw ? JSON.parse(raw) : null;
}

function seedLocalWeek(points: Record<string, number> = { [MEMBER]: 500 }) {
  localStorage.setItem(
    WEEK_DATA_KEY,
    JSON.stringify({ weekStart: WEEK_START, points, streak: {}, lastActive: {}, history: [] }),
  );
}

beforeEach(() => {
  localStorage.clear();
  __resetTaskOutboxForTests();
  __resetWeekLedgerLockForTests();
  mocks.verifyPinFromPB.mockReset().mockImplementation(async (name: string, pin: string) => {
    if (name === MEMBER && pin === MEMBER_PIN) return { id: "member-kid", name: MEMBER, role: "child" };
    if (name === PARENT && pin === PARENT_PIN) return { id: "member-parent", name: PARENT, role: "parent" };
    return null;
  });
  seedLocalWeek();
});

afterEach(() => {
  localStorage.clear();
  __resetTaskOutboxForTests();
  __resetWeekLedgerLockForTests();
  vi.restoreAllMocks();
});

describe("the redeem payload allowlist carries the approver, never an amount", () => {
  it("keeps parentName and drops a client-supplied cost and title", () => {
    const sanitized = sanitizeTaskOperationPayload("/api/rewards/redeem", "redeem", {
      rewardId: BIG_REWARD.id,
      memberName: MEMBER,
      parentName: PARENT,
      cost: 1,
      title: "Everything for free",
      points: 1,
      pin: MEMBER_PIN,
      parentPin: PARENT_PIN,
    });

    expect(sanitized).toEqual({
      rewardId: BIG_REWARD.id,
      memberName: MEMBER,
      parentName: PARENT,
    });
    expect(sanitized).not.toHaveProperty("cost");
    expect(sanitized).not.toHaveProperty("title");
    expect(sanitized).not.toHaveProperty("pin");
    expect(sanitized).not.toHaveProperty("parentPin");
  });

  it("puts the approver on the wire and keeps the credential bundle exactly pin/parentPin", () => {
    const entry = redeemEntry("op-allowlist-1", { parentName: PARENT });
    rememberTaskCommandCredential("op-allowlist-1", { pin: MEMBER_PIN, parentPin: PARENT_PIN });

    const bundle = resolveTaskOutboxCredential(entry);
    expect(bundle && Object.keys(bundle).sort()).toEqual(["parentPin", "pin"]);

    const body = buildTaskOperationRequestBody(entry, bundle);
    expect(body).toMatchObject({
      action: "redeem",
      operationId: "op-allowlist-1",
      rewardId: BIG_REWARD.id,
      memberName: MEMBER,
      parentName: PARENT,
      pin: MEMBER_PIN,
      parentPin: PARENT_PIN,
    });
    expect(body).not.toHaveProperty("cost");
    expect(body).not.toHaveProperty("title");
  });
});

describe("one operation id is one redemption (the double-tap window)", () => {
  it("two rapid flushes of the same queued command deduct once and write ONE canonical redeem tx", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const posted: PostedRequest[] = [];
    const entry = redeemEntry("op-double-tap-1", { parentName: PARENT });
    rememberTaskCommandCredential("op-double-tap-1", { pin: MEMBER_PIN, parentPin: PARENT_PIN });

    const driver = harnessDriver(harness, posted);
    const [first, second] = await Promise.all([
      flushTaskOutbox(driver),
      flushTaskOutbox(driver),
    ]);

    expect(first).toEqual({ acknowledged: 1, retryable: 0, permanent: 0 });
    expect(second).toEqual({ acknowledged: 1, retryable: 0, permanent: 0 });
    expect(entry.operationId).toBe("op-double-tap-1");
    expect(posted).toHaveLength(1);

    const redemptions = harness.readHistory().filter((tx: any) => tx.type === "redeem");
    expect(redemptions).toHaveLength(1);
    expect(redemptions[0]).toMatchObject({
      member: MEMBER,
      amount: -150,
      meta: { operationId: "op-double-tap-1", source: "reward-redeem" },
    });
    expect(redemptions[0].operationId).toBeUndefined();
    expect(harness.readPoints()[MEMBER]).toBe(350);
    expect(harness.weekWrites).toHaveLength(1);
    expect(listTaskOutbox()).toHaveLength(0);
    expect(localWeek().points[MEMBER]).toBe(350);
  });

  it("re-enqueueing the same id mid-retry is still ONE deduction, and the retry reuses the id", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const posted: PostedRequest[] = [];
    let attempt = 0;
    const driver = harnessDriver(harness, posted, async (_entry, body) => {
      attempt += 1;
      if (attempt === 1) throw new TypeError("network unavailable");
      return postToRealRoute(body);
    });

    redeemEntry("op-retry-once-1", { parentName: PARENT });
    rememberTaskCommandCredential("op-retry-once-1", { pin: MEMBER_PIN, parentPin: PARENT_PIN });

    const failed = await flushTaskOutbox(driver);
    expect(failed).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    expect(listTaskOutbox()).toHaveLength(1);
    expect(listTaskOutbox()[0].status).toBe("retrying");
    expect(localWeek().points[MEMBER]).toBe(500);

    redeemEntry("op-retry-once-1", { parentName: PARENT });
    rememberTaskCommandCredential("op-retry-once-1", { pin: MEMBER_PIN, parentPin: PARENT_PIN });
    const landed = await flushTaskOutbox(driver);

    expect(landed).toEqual({ acknowledged: 1, retryable: 0, permanent: 0 });
    expect(posted).toHaveLength(2);
    expect(posted[0].operationId).toBe("op-retry-once-1");
    expect(posted[1].operationId).toBe("op-retry-once-1");

    expect(harness.readHistory().filter((tx: any) => tx.type === "redeem")).toHaveLength(1);
    expect(harness.readPoints()[MEMBER]).toBe(350);
    expect(listTaskOutbox()).toHaveLength(0);
  });
});

describe("a redemption is adopted only on a 200 or a 202", () => {
  it("a 202 (canonical write landed, projection repair pending) is acknowledged and adopted once", async () => {
    const harness = makePb({ snapshotFails: true });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const posted: PostedRequest[] = [];
    redeemEntry("op-202-1", { parentName: PARENT });
    rememberTaskCommandCredential("op-202-1", { pin: MEMBER_PIN, parentPin: PARENT_PIN });

    const result = await flushTaskOutbox(harnessDriver(harness, posted));

    expect(result).toEqual({ acknowledged: 1, retryable: 0, permanent: 0 });
    expect(posted).toHaveLength(1);
    expect(harness.snapshotWrites()).toBeGreaterThan(0);
    expect(harness.readPoints()[MEMBER]).toBe(350);
    expect(listTaskOutbox()).toHaveLength(0);

    const adopted = localWeek();
    expect(adopted.points[MEMBER]).toBe(350);
    expect(
      adopted.history.filter((tx: any) => tx.meta?.operationId === "op-202-1"),
    ).toHaveLength(1);
    expect(adopted.history.filter((tx: any) => tx.type === "redeem")).toHaveLength(1);
    expect(adopted.history.filter((tx: any) => tx.operationId !== undefined)).toHaveLength(0);
  });

  it("a 503 keeps the entry for a durable retry and moves no local points", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const posted: PostedRequest[] = [];
    redeemEntry("op-503-1");
    rememberTaskCommandCredential("op-503-1", { pin: MEMBER_PIN });

    const result = await flushTaskOutbox(
      harnessDriver(harness, posted, async () => ({
        status: 503,
        body: { ok: false, operationId: "op-503-1", reason: "ledger_unavailable", error: "Points could not be updated just now. Please try again." },
      })),
    );

    expect(result.retryable).toBe(1);
    expect(listTaskOutbox()).toHaveLength(1);
    expect(listTaskOutbox()[0].status).toBe("retrying");
    expect(localWeek().points[MEMBER]).toBe(500);
    expect(localWeek().history).toHaveLength(0);
    expect(harness.weekWrites).toHaveLength(0);
  });

  it("a permanent 400 stops retrying, keeps the server's honest copy, and moves no local points", async () => {
    const harness = makePb({ openingPoints: 20 });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    seedLocalWeek({ [MEMBER]: 20 });
    const posted: PostedRequest[] = [];
    redeemEntry("op-400-1", { parentName: PARENT });
    rememberTaskCommandCredential("op-400-1", { pin: MEMBER_PIN, parentPin: PARENT_PIN });

    const result = await flushTaskOutbox(harnessDriver(harness, posted));

    expect(result).toEqual({ acknowledged: 0, retryable: 0, permanent: 1 });
    const entry = listTaskOutbox()[0];
    expect(entry.status).toBe("failed");
    expect(entry.lastErrorCategory).toBe("validation");
    expect(entry.lastErrorReason).toContain("more pts for");
    expect(localWeek().points[MEMBER]).toBe(20);
    expect(harness.weekWrites).toHaveLength(0);
  });

  it("a 409 pulls authoritative state first and then stops retrying", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const posted: PostedRequest[] = [];
    let pulls = 0;
    const driver = harnessDriver(harness, posted, async () => ({
      status: 409,
      body: {
        ok: false,
        operationId: "op-409-1",
        reason: "duplicate",
        error: "That redemption already went through — check your points.",
      },
    }));
    const pullSnapshot = driver.pullSnapshot!;
    driver.pullSnapshot = async () => {
      pulls += 1;
      return pullSnapshot();
    };

    redeemEntry("op-409-1", { parentName: PARENT });
    rememberTaskCommandCredential("op-409-1", { pin: MEMBER_PIN, parentPin: PARENT_PIN });

    const result = await flushTaskOutbox(driver);

    expect(pulls).toBe(1);
    expect(result).toEqual({ acknowledged: 0, retryable: 0, permanent: 1 });
    expect(listTaskOutbox()[0].status).toBe("failed");
    expect(listTaskOutbox()[0].lastErrorReason).toContain("already went through");
  });
});
