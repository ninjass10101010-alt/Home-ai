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
  removeTaskOutboxEntry,
  resolveTaskOutboxCredential,
  sanitizeTaskOperationPayload,
  taskOutboxEntryStorageKey,
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

function makePb(
  opts: { openingPoints?: number; snapshotFails?: boolean; roster?: Array<Record<string, unknown>> } = {},
): PbHarness {
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
          getFullList: async () =>
            opts.roster ?? [
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

function advanceClock(ms: number): void {
  const current = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => current + ms);
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
  it("a 202 (canonical write landed, projection repair pending) is acknowledged and adopted once", async () => {    const harness = makePb({ snapshotFails: true });
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

  it("a 202 with NO weekData is NOT acknowledged in full — it stays on the Wave 1 retention path", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const posted: PostedRequest[] = [];
    redeemEntry("op-202-bare-1", { parentName: PARENT });
    rememberTaskCommandCredential("op-202-bare-1", { pin: MEMBER_PIN, parentPin: PARENT_PIN });

    const result = await flushTaskOutbox(harnessDriver(harness, posted, async () => ({
      status: 202,
      body: { ok: true, operationId: "op-202-bare-1", applied: true, duplicate: false, reconciled: false, repairRequired: true },
    })));

    expect(result.acknowledged).toBe(0);
    expect(posted).toHaveLength(1);
    expect(listTaskOutbox()).toHaveLength(1);
    const entry = listTaskOutbox()[0];
    expect(entry.operationId).toBe("op-202-bare-1");
    expect(entry.status).toBe("reconciling");
    expect(entry.lastErrorCategory).toBe("projection");
    expect(localWeek().points[MEMBER]).toBe(500);
    expect(localWeek().history).toHaveLength(0);
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
    expect(entry.lastErrorReason).toBe("insufficient");
    expect(entry.lastErrorMessage).toContain("more pts for");
    expect(localWeek().points[MEMBER]).toBe(20);
    expect(harness.weekWrites).toHaveLength(0);
  });

  it("a 401 keeps the machine reason for control flow and the server's words for the UI", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const posted: PostedRequest[] = [];
    redeemEntry("op-401-1", { parentName: PARENT });
    rememberTaskCommandCredential("op-401-1", { pin: MEMBER_PIN, parentPin: PARENT_PIN });

    const result = await flushTaskOutbox(harnessDriver(harness, posted, async () => ({
      status: 401,
      body: {
        ok: false,
        operationId: "op-401-1",
        reason: "parent_approval_required",
        error: "A parent has to approve this reward.",
      },
    })));

    expect(result).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    const entry = listTaskOutbox()[0];
    expect(entry.status).toBe("auth-required");
    expect(entry.lastErrorCategory).toBe("unauthorized");
    expect(entry.lastErrorReason).toBe("parent_approval_required");
    expect(entry.lastErrorMessage).toBe("A parent has to approve this reward.");
    expect(localWeek().points[MEMBER]).toBe(500);
  });

  it("a 403 keeps the machine reason for control flow and the server's words for the UI", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const posted: PostedRequest[] = [];
    redeemEntry("op-403-1", { parentName: PARENT });
    rememberTaskCommandCredential("op-403-1", { pin: MEMBER_PIN, parentPin: PARENT_PIN });

    const result = await flushTaskOutbox(harnessDriver(harness, posted, async () => ({
      status: 403,
      body: {
        ok: false,
        operationId: "op-403-1",
        reason: "parent_only",
        error: "Only a parent can approve this reward.",
      },
    })));

    expect(result).toEqual({ acknowledged: 0, retryable: 0, permanent: 1 });
    const entry = listTaskOutbox()[0];
    expect(entry.status).toBe("failed");
    expect(entry.lastErrorCategory).toBe("unauthorized");
    expect(entry.lastErrorReason).toBe("parent_only");
    expect(entry.lastErrorMessage).toBe("Only a parent can approve this reward.");
  });

  it("an EXPLICIT reason wins over error: the machine code is what classifies", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const posted: PostedRequest[] = [];

    redeemEntry("op-explicit-reason-1");
    rememberTaskCommandCredential("op-explicit-reason-1", { pin: MEMBER_PIN });
    const result = await flushTaskOutbox(
      harnessDriver(harness, posted, async () => ({
        status: 400,
        body: {
          ok: false,
          operationId: "op-explicit-reason-1",
          reason: "http_400",
          error: "task_store_unavailable",
        },
      })),
    );

    expect(result).toEqual({ acknowledged: 0, retryable: 0, permanent: 1 });
    const entry = listTaskOutbox()[0];
    expect(entry.status).toBe("failed");
    expect(entry.lastErrorReason).toBe("http_400");
    expect(entry.lastErrorMessage).toBe("task_store_unavailable");
  });

  it("a body with NO reason does not let a human SENTENCE classify — the status does", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const posted: PostedRequest[] = [];

    redeemEntry("op-error-only-sentence-1");
    rememberTaskCommandCredential("op-error-only-sentence-1", { pin: MEMBER_PIN });
    const result = await flushTaskOutbox(
      harnessDriver(harness, posted, async () => ({
        status: 400,
        body: {
          ok: false,
          operationId: "op-error-only-sentence-1",
          error: "We could not save that reward just now.",
        },
      })),
    );

    expect(result).toEqual({ acknowledged: 0, retryable: 0, permanent: 1 });
    const entry = listTaskOutbox()[0];
    expect(entry.status).toBe("failed");
    expect(entry.lastErrorReason).toBe("http_400");
    expect(entry.lastErrorMessage).toBe("We could not save that reward just now.");
  });

  it("a machine CODE in the error channel is still honoured — the vocabulary decides, not the field", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const posted: PostedRequest[] = [];

    // `/api/tasks/config` and `/api/tasks/manage` can express a machine code
    // ONLY through `error` (their exact response bodies are pinned by the route
    // suites), so a vocabulary member arriving there must still classify.
    redeemEntry("op-error-channel-code-1");
    rememberTaskCommandCredential("op-error-channel-code-1", { pin: MEMBER_PIN });
    const result = await flushTaskOutbox(
      harnessDriver(harness, posted, async () => ({
        status: 502,
        body: {
          ok: false,
          operationId: "op-error-channel-code-1",
          error: "config_store_unreachable",
        },
      })),
    );

    expect(result).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    const entry = listTaskOutbox()[0];
    expect(entry.status).toBe("retrying");
    expect(entry.lastErrorReason).toBe("config_store_unreachable");
    expect(entry.lastErrorMessage).toBe("config_store_unreachable");
  });

  it("a 401 whose only `error` names the credential_missing sentinel is still retried once a credential exists", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const posted: PostedRequest[] = [];
    redeemEntry("op-sentinel-401-1", { parentName: PARENT });
    rememberTaskCommandCredential("op-sentinel-401-1", { pin: MEMBER_PIN, parentPin: PARENT_PIN });

    // 1 + 2: the display string lands on the DISPLAY field only. The module's
    // own sentinel is not set, so `runFlush` can never skip this entry.
    const refused = await flushTaskOutbox(harnessDriver(harness, posted, async () => ({
      status: 401,
      body: { ok: false, operationId: "op-sentinel-401-1", error: "credential_missing" },
    })));
    expect(refused).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    const refusedEntry = listTaskOutbox()[0];
    expect(refusedEntry.status).toBe("auth-required");
    expect(refusedEntry.lastErrorReason).not.toBe("credential_missing");
    expect(refusedEntry.lastErrorReason).toBe("unauthorized");
    expect(refusedEntry.lastErrorMessage).toBe("credential_missing");
    expect(refusedEntry.credentialMissing).not.toBe(true);

    // 3: the credential is gone (a reload). The entry must still be ATTEMPTED.
    forgetTaskCommandCredential("op-sentinel-401-1");
    advanceClock(10 * 60_000);
    const withoutCredential = await flushTaskOutbox(
      harnessDriver(harness, posted, async () => ({
        status: 401,
        body: { ok: false, operationId: "op-sentinel-401-1", error: "credential_missing" },
      })),
    );
    expect(withoutCredential).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    expect(posted).toHaveLength(2);
    expect(listTaskOutbox()).toHaveLength(1);

    // 4: a correct credential exists again -> the SAME operation id lands, once.
    rememberTaskCommandCredential("op-sentinel-401-1", { pin: MEMBER_PIN, parentPin: PARENT_PIN });
    advanceClock(10 * 60_000);
    const landed = await flushTaskOutbox(harnessDriver(harness, posted));
    expect(landed).toEqual({ acknowledged: 1, retryable: 0, permanent: 0 });
    expect(listTaskOutbox()).toHaveLength(0);
    expect(harness.readHistory().filter((tx: any) => tx.type === "redeem")).toHaveLength(1);
    expect(harness.readHistory().at(-1)).toMatchObject({
      meta: { operationId: "op-sentinel-401-1", source: "reward-redeem" },
    });
    expect(harness.readPoints()[MEMBER]).toBe(350);
  });

  it("an `error` naming the sentinel on a 409 or 5xx cannot skip the retry either", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const posted: PostedRequest[] = [];

    redeemEntry("op-sentinel-409-1");
    rememberTaskCommandCredential("op-sentinel-409-1", { pin: MEMBER_PIN });
    const conflict = await flushTaskOutbox(harnessDriver(harness, posted, async () => ({
      status: 409,
      body: { ok: false, operationId: "op-sentinel-409-1", error: "credential_missing" },
    })));
    expect(conflict).toEqual({ acknowledged: 0, retryable: 0, permanent: 1 });
    expect(listTaskOutbox()[0].status).toBe("failed");
    expect(listTaskOutbox()[0].lastErrorReason).toBe("operation_conflict");
    expect(listTaskOutbox()[0].credentialMissing).not.toBe(true);
    removeTaskOutboxEntry("op-sentinel-409-1");

    redeemEntry("op-sentinel-503-1");
    rememberTaskCommandCredential("op-sentinel-503-1", { pin: MEMBER_PIN });
    const outage = await flushTaskOutbox(harnessDriver(harness, posted, async () => ({
      status: 503,
      body: { ok: false, operationId: "op-sentinel-503-1", error: "credential_missing" },
    })));
    expect(outage).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    expect(listTaskOutbox()[0].status).toBe("retrying");
    expect(listTaskOutbox()[0].lastErrorReason).toBe("http_503");
    expect(listTaskOutbox()[0].credentialMissing).not.toBe(true);
  });

  it("every code the error-only command routes can emit is honoured through `error`", async () => {
    // `/api/tasks/config` and `/api/tasks/manage` can express a machine code ONLY
    // through `error`. Each of these must therefore classify, and must NOT decay
    // to the `http_<status>` fallback. Table-driven so a REMOVED member is caught
    // as loudly as an added one; `npm run typecheck` catches an undecided NEW code
    // in `TaskManageErrorCode`.
    const cases = [
      { code: "pet_assignee", status: 400 },
      { code: "unknown_assignee", status: 400 },
      { code: "unknown_task", status: 404 },
      { code: "unsupported_task_command", status: 400 },
      { code: "invalid_task_command", status: 400 },
      { code: "forbidden_task_field", status: 400 },
      { code: "forbidden_config_field", status: 400 },
      { code: "invalid_config_command", status: 400 },
      { code: "invalid_current_config", status: 422 },
      { code: "invalid_resulting_config", status: 422 },
      { code: "config_natural_key_conflict", status: 409 },
      { code: "stale_config", status: 409 },
      { code: "config_store_unreachable", status: 502 },
      { code: "task_store_unavailable", status: 503 },
      { code: "member_roster_unavailable", status: 503 },
      { code: "adult_only", status: 403 },
      { code: "unauthorized", status: 401 },
    ];

    for (const { code, status } of cases) {
      const harness = makePb();
      mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
      const posted: PostedRequest[] = [];
      const operationId = `op-error-code-${code}`;
      redeemEntry(operationId, { parentName: PARENT });
      rememberTaskCommandCredential(operationId, { pin: MEMBER_PIN, parentPin: PARENT_PIN });

      await flushTaskOutbox(harnessDriver(harness, posted, async () => ({
        status,
        body: { ok: false, operationId, error: code },
      })));

      const entry = listTaskOutbox()[0];
      expect(entry, code).toBeDefined();
      expect(entry.lastErrorReason, code).toBe(code);
      expect(entry.lastErrorReason, code).not.toBe(`http_${status}`);
      expect(entry.lastErrorMessage, code).toBe(code);
      removeTaskOutboxEntry(operationId);
    }
  });

  it("a retryable 5xx with retryable:true and no reason keeps the status-derived machine reason", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const posted: PostedRequest[] = [];
    redeemEntry("op-503-fallback-1");
    rememberTaskCommandCredential("op-503-fallback-1", { pin: MEMBER_PIN });

    const result = await flushTaskOutbox(
      harnessDriver(harness, posted, async () => ({
        status: 503,
        body: {
          ok: false,
          operationId: "op-503-fallback-1",
          retryable: true,
          error: "Points could not be updated just now. Please try again.",
        },
      })),
    );

    expect(result).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    const entry = listTaskOutbox()[0];
    expect(entry.status).toBe("retrying");
    expect(entry.lastErrorReason).toBe("http_503");
    expect(entry.lastErrorMessage).toBe("Points could not be updated just now. Please try again.");
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
    expect(listTaskOutbox()[0].lastErrorReason).toBe("duplicate");
    expect(listTaskOutbox()[0].lastErrorMessage).toContain("already went through");
  });
});

describe("the approver NAME rides on disk; the approver PIN never does", () => {
  it("a queued redemption persists the approver's name and neither PIN", () => {
    redeemEntry("op-on-disk-1", { parentName: PARENT });
    rememberTaskCommandCredential("op-on-disk-1", { pin: MEMBER_PIN, parentPin: PARENT_PIN });

    const raw = localStorage.getItem(taskOutboxEntryStorageKey("op-on-disk-1"));
    expect(raw).not.toBeNull();
    const stored = JSON.parse(String(raw));
    expect(stored.payload).toEqual({ rewardId: BIG_REWARD.id, memberName: MEMBER, parentName: PARENT });
    expect(raw).toContain(PARENT);
    expect(raw).not.toContain(MEMBER_PIN);
    expect(raw).not.toContain(PARENT_PIN);

    const dump = Object.keys(localStorage)
      .map((key) => `${key}=${localStorage.getItem(key) ?? ""}`)
      .join("\n");
    expect(dump).not.toContain(MEMBER_PIN);
    expect(dump).not.toContain(PARENT_PIN);
  });

  it("a name that is no longer on the live roster is refused — a stale approver cannot authorize", async () => {
    const harness = makePb({
      roster: [
        { id: "member-kid", name: MEMBER, fullName: MEMBER, role: "child" },
        { id: "member-someone-else", name: "Someone Else", fullName: "Someone Else", role: "parent" },
      ],
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const posted: PostedRequest[] = [];
    redeemEntry("op-stale-approver-1", { parentName: PARENT });
    rememberTaskCommandCredential("op-stale-approver-1", { pin: MEMBER_PIN, parentPin: PARENT_PIN });

    const result = await flushTaskOutbox(harnessDriver(harness, posted));

    expect(result).toEqual({ acknowledged: 0, retryable: 0, permanent: 1 });
    const entry = listTaskOutbox()[0];
    expect(entry.lastErrorReason).toBe("parent_only");
    expect(entry.lastErrorMessage).toBe("Only a parent can approve this reward.");
    expect(posted).toHaveLength(1);
    expect(harness.weekWrites).toHaveLength(0);
    expect(harness.readPoints()[MEMBER]).toBe(500);
    expect(harness.readHistory().filter((tx: any) => tx.type === "redeem")).toHaveLength(0);
    expect(localWeek().points[MEMBER]).toBe(500);
  });

  it("a live member who is not a parent is refused, whatever name the device persisted", async () => {
    const harness = makePb({
      roster: [
        { id: "member-kid", name: MEMBER, fullName: MEMBER, role: "child" },
        { id: "member-teen", name: PARENT, fullName: PARENT, role: "child" },
      ],
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const posted: PostedRequest[] = [];
    redeemEntry("op-nonparent-approver-1", { parentName: PARENT });
    rememberTaskCommandCredential("op-nonparent-approver-1", { pin: MEMBER_PIN, parentPin: PARENT_PIN });

    const result = await flushTaskOutbox(harnessDriver(harness, posted));

    expect(result).toEqual({ acknowledged: 0, retryable: 0, permanent: 1 });
    expect(listTaskOutbox()[0].lastErrorReason).toBe("parent_only");
    expect(harness.weekWrites).toHaveLength(0);
    expect(harness.readPoints()[MEMBER]).toBe(500);
  });

  it("a live parent's name with a wrong PIN is refused — the name alone authorizes nothing", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const posted: PostedRequest[] = [];
    redeemEntry("op-wrong-approver-pin-1", { parentName: PARENT });
    rememberTaskCommandCredential("op-wrong-approver-pin-1", { pin: MEMBER_PIN, parentPin: "0000" });

    const result = await flushTaskOutbox(harnessDriver(harness, posted));

    expect(result).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    const entry = listTaskOutbox()[0];
    expect(entry.status).toBe("auth-required");
    expect(entry.lastErrorReason).toBe("invalid_pin");
    expect(harness.weekWrites).toHaveLength(0);
    expect(harness.readPoints()[MEMBER]).toBe(500);
  });
});
