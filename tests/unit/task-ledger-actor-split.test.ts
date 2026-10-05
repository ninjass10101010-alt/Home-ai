/**
 * POST /api/tasks/ledger — the ACTOR / TARGET split.
 *
 * The bug this file exists for: the route bound three roles to ONE field,
 * `command.memberName` — the PIN subject, the `role === "parent"` gate and the
 * member whose balance moves. A penalty or a manual adjust against a CHILD could
 * therefore only ever produce a CHILD-PIN payload, which the parent gate then
 * refused with 403 `adult_only`, while the page had already told the parent it
 * succeeded. The reverse (a parent's PIN sent with a child's name) was a 401.
 * Both money paths were dead.
 *
 * The fix splits the two identities the way `/api/rewards/redeem` already does:
 * `memberName` stays the PIN-VERIFIED ACTOR and `targetMemberName` names the
 * LEDGER TARGET, defaulting to the actor so every pre-existing same-member call
 * behaves exactly as before.
 *
 * The real `applyWeekLedgerOperationLocked` runs here against an in-memory
 * `week_data` row, so "replay is safe", "exactly one transaction" and
 * "the parent is not debited" are asserted on the ACTUAL written ledger rather
 * than on a mock's arguments.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { Transaction } from "@/types/tasks";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifyPinFromPB: vi.fn(),
  getLiveMemberById: vi.fn(),
  getLiveMembers: vi.fn(),
  ensureCurrentTaskWeek: vi.fn(),
  mutateSnapshotWithMeta: vi.fn(),
  readSnapshotStateWithRevision: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

// The PIN subject is the ACTOR, so this stub must actually be name-aware: a
// parent PIN presented for a child is a FAILED verification, which is precisely
// what made the pre-fix child-target call dead.
vi.mock("@/lib/server-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server-auth")>();
  return { ...actual, verifyPinFromPB: mocks.verifyPinFromPB };
});

vi.mock("@/lib/live-member", () => ({
  getLiveMemberById: mocks.getLiveMemberById,
  getLiveMembers: mocks.getLiveMembers,
}));

vi.mock("@/lib/task-week-rollover", () => ({
  ensureCurrentTaskWeek: mocks.ensureCurrentTaskWeek,
}));

// Real `normalizeWeekData` (the ledger helper needs it to read the canonical
// row); only the two snapshot-WRITE helpers are stubbed.
vi.mock("@/lib/snapshot-tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/snapshot-tasks")>();
  return {
    ...actual,
    mutateSnapshotWithMeta: mocks.mutateSnapshotWithMeta,
    readSnapshotStateWithRevision: mocks.readSnapshotStateWithRevision,
  };
});

import { POST } from "@/app/api/tasks/ledger/route";
import { parseLedgerCommand } from "@/lib/task-ledger-command";
import { __resetWeekLedgerLockForTests } from "@/lib/week-ledger-lock";

const WEEK = "2026-09-21";

const PARENT = { id: "parent-1", name: "Rebecca Garcia", role: "parent", emoji: "👩", age: 40 };
const SPOUSE = { id: "parent-2", name: "Marco Garcia", role: "parent", emoji: "👨", age: 42 };
const CHILD = { id: "child-1", name: "Caspian Garcia", role: "child", emoji: "🧒", age: 5 };
const SIBLING = { id: "child-2", name: "Nia Garcia", role: "child", emoji: "👧", age: 8 };
const PET = { id: "pet-1", name: "Whiskers Garcia", role: "pet", emoji: "🐈", age: 3 };
const ROSTER = [PARENT, SPOUSE, CHILD, SIBLING, PET];

const PARENT_PIN = "parent-pin-fixture";
const CHILD_PIN = "child-pin-fixture";
const WRONG_PIN = "0000";

const CATALOG = [{ id: "pen-1", name: "Mess", emoji: "⚠️", points: 15 }];
const CHILD_OPENING_BALANCE = 20;

function seedHistory(): Transaction[] {
  return [CHILD, SIBLING].map((member, index) => ({
    id: index + 1,
    timestamp: "2026-09-21T09:00:00.000Z",
    member: member.name,
    type: "earn" as const,
    amount: CHILD_OPENING_BALANCE,
    description: "Seeded opening earn",
  }));
}

/** An in-memory `week_data` row that reflects its own writes, PB JSON columns included. */
function makeHarness() {
  let row: Record<string, unknown> = {
    id: "week-1",
    weekStart: WEEK,
    points: JSON.stringify({ [CHILD.name]: CHILD_OPENING_BALANCE, [SIBLING.name]: CHILD_OPENING_BALANCE }),
    streak: "{}",
    lastActive: "{}",
    history: JSON.stringify(seedHistory()),
  };
  let writeCount = 0;
  let projected: unknown = null;
  const collection = {
    getFullList: async () => [structuredClone(row)],
    getOne: async (id: string) => (id === row.id ? structuredClone(row) : null),
    update: async (_id: string, payload: Record<string, unknown>) => {
      writeCount += 1;
      row = { ...row, ...structuredClone(payload) };
      return structuredClone(row);
    },
    create: async (payload: Record<string, unknown>) => {
      writeCount += 1;
      row = { id: "week-created", ...structuredClone(payload) };
      return structuredClone(row);
    },
  };
  const pb = {
    collection: (name: string) => {
      if (name !== "week_data") throw new Error(`unexpected collection ${name}`);
      return collection;
    },
  };
  // PocketBase JSON columns come back as strings until a write replaces them
  // with the plain object the helper passed in; both are read the same way here.
  const column = <T,>(value: unknown, fallback: T): T => {
    if (typeof value === "string") {
      try {
        return JSON.parse(value) as T;
      } catch {
        return fallback;
      }
    }
    return (value ?? fallback) as T;
  };
  return {
    pb,
    week(): Record<string, unknown> {
      return row;
    },
    history(): Transaction[] {
      return column<Transaction[]>(row.history, []);
    },
    points(): Record<string, number> {
      return column<Record<string, number>>(row.points, {});
    },
    writeCount(): number {
      return writeCount;
    },
    projectedWeek(): unknown {
      return projected;
    },
    setProjected(value: unknown): void {
      projected = value;
    },
  };
}

type Harness = ReturnType<typeof makeHarness>;

let harness: Harness;

function install(next: Harness): void {
  harness = next;
  mocks.withAdmin.mockReset().mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));
  mocks.readSnapshotStateWithRevision.mockReset().mockImplementation(async () => ({
    data: {
      tasks: [],
      weekData: harness.week(),
      penalties: CATALOG,
      rewards: [],
    },
    revision: { revision: "9", updatedAt: "2026-09-24T10:00:00.000Z" },
  }));
  mocks.mutateSnapshotWithMeta.mockReset().mockImplementation(async (mutate: (data: unknown) => unknown) => {
    const nextData = mutate({ tasks: [], weekData: harness.week(), penalties: CATALOG, rewards: [] });
    const data = nextData as { data?: { weekData?: unknown } };
    if (data?.data?.weekData) harness.setProjected(data.data.weekData);
    return { result: null, revision: { revision: "10", updatedAt: "2026-09-24T10:01:00.000Z" } };
  });
}

function jsonReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/tasks/ledger", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function post(body: unknown, headers: Record<string, string> = {}) {
  const res = await POST(jsonReq(body, headers));
  return { res, body: await res.json() };
}

/** The response with the deliberately volatile write-identity fields removed. */
function canonical(payload: Record<string, any>): unknown {
  return {
    ...payload,
    revision: undefined,
    weekData: payload.weekData
      ? { ...payload.weekData, history: stripWriteIds(payload.weekData.history ?? []) }
      : payload.weekData,
  };
}

function stripWriteIds(rows: Transaction[]): unknown[] {
  return rows.map(({ id, timestamp, ...rest }: Transaction) => rest);
}

function ledgerRows(): Transaction[] {
  return harness.history().filter((row) => row.meta?.operationId !== undefined);
}

beforeEach(() => {
  __resetWeekLedgerLockForTests();
  install(makeHarness());
  mocks.verifyPinFromPB.mockReset().mockImplementation(async (name: string, pin: string) => {
    const row = ROSTER.find((member) => member.name.toLowerCase() === String(name).trim().toLowerCase());
    if (!row) return null;
    const pinById: Record<string, string> = {
      [PARENT.id]: PARENT_PIN,
      [CHILD.id]: CHILD_PIN,
    };
    return pinById[row.id] === pin ? row : null;
  });
  mocks.getLiveMemberById.mockReset().mockImplementation(async (id: string) =>
    ROSTER.find((member) => member.id === id) ?? null);
  mocks.getLiveMembers.mockReset().mockResolvedValue(ROSTER);
  mocks.ensureCurrentTaskWeek.mockReset().mockResolvedValue({ weekStart: WEEK, reconciled: true });
});

describe("parseLedgerCommand — the actor/target split", () => {
  it("omits targetMemberName entirely when the client names no target", () => {
    // Byte-identical to the pre-split shape: no invented key reaches the command.
    expect(parseLedgerCommand({
      operationId: "op-1",
      action: "penalty",
      memberName: CHILD.name,
      pin: CHILD_PIN,
      itemId: "pen-1",
    })).toEqual({
      ok: true,
      command: { operationId: "op-1", action: "penalty", memberName: CHILD.name, pin: CHILD_PIN, itemId: "pen-1" },
    });
  });

  it("carries targetMemberName beside the PIN-verified actor memberName", () => {
    expect(parseLedgerCommand({
      operationId: "op-2",
      action: "adjust",
      memberName: PARENT.name,
      targetMemberName: CHILD.name,
      pin: PARENT_PIN,
      amount: -5,
    })).toEqual({
      ok: true,
      command: {
        operationId: "op-2",
        action: "adjust",
        memberName: PARENT.name,
        targetMemberName: CHILD.name,
        pin: PARENT_PIN,
        amount: -5,
        reason: "",
      },
    });
  });

  it("refuses a targetMemberName that names nobody instead of falling back to the actor", () => {
    for (const target of [7, "", "   ", {}, []]) {
      expect(parseLedgerCommand({
        operationId: "op-3",
        action: "adjust",
        memberName: PARENT.name,
        targetMemberName: target,
        pin: PARENT_PIN,
        amount: 5,
      })).toMatchObject({ ok: false, reason: "invalid_body" });
    }
  });
});

describe("POST /api/tasks/ledger — a parent's PIN moving a child's balance", () => {
  it("debits the child and leaves the parent's balance untouched", async () => {
    const { res, body } = await post({
      operationId: "op-child-adjust-1",
      action: "adjust",
      memberName: PARENT.name,
      targetMemberName: CHILD.name,
      pin: PARENT_PIN,
      amount: -5,
      reason: "left the table",
    });

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, action: "adjust", member: CHILD.name, reconciled: true });

    const written = harness.history();
    const movements = written.filter((row) => row.meta?.operationId !== undefined);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      member: CHILD.name,
      type: "adjust",
      amount: -5,
      appliedBy: PARENT.id,
    });
    expect(body.weekData.points[CHILD.name]).toBe(CHILD_OPENING_BALANCE - 5);
    // The actor is the AUTHOR, never the subject of the movement.
    expect(body.weekData.points[PARENT.name]).toBeUndefined();
    expect(written.some((row) => row.member === PARENT.name)).toBe(false);
    expect((body.weekData as { history: Transaction[] }).history.length).toBe(written.length);
  });

  it("applies a catalog penalty against the child at the CATALOG points", async () => {
    const { res, body } = await post({
      operationId: "op-child-penalty-1",
      action: "penalty",
      memberName: PARENT.name,
      targetMemberName: SIBLING.name,
      pin: PARENT_PIN,
      itemId: "pen-1",
    });

    expect(res.status).toBe(200);
    expect(body.member).toBe(SIBLING.name);
    const movements = harness.history().filter((row) => row.meta?.operationId !== undefined);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      member: SIBLING.name,
      type: "penalty",
      amount: -15,
      appliedBy: PARENT.id,
      meta: { operationId: "op-child-penalty-1", source: "task-penalty" },
    });
  });

  it("still refuses a client-chosen points field on a penalty", async () => {
    const { res, body } = await post({
      operationId: "op-child-penalty-2",
      action: "penalty",
      memberName: PARENT.name,
      targetMemberName: CHILD.name,
      pin: PARENT_PIN,
      itemId: "pen-1",
      points: 9999,
    });

    expect(res.status).toBe(400);
    expect(body).toMatchObject({ reason: "invalid_body" });
    expect(harness.writeCount()).toBe(0);
    expect(harness.history()).toHaveLength(2);
  });

  it("keeps a same-member command byte-identical when the target IS the actor", async () => {
    const command = {
      operationId: "op-self-1",
      action: "adjust",
      memberName: PARENT.name,
      pin: PARENT_PIN,
      amount: 7,
      reason: "extra help",
    };

    const implicit = await post(command);
    const implicitRows = stripWriteIds(harness.history());
    const implicitFingerprint = ledgerRows()[0]?.meta?.fingerprint;

    install(makeHarness());
    const explicit = await post({ ...command, targetMemberName: PARENT.name });
    const explicitRows = stripWriteIds(harness.history());
    const explicitFingerprint = ledgerRows()[0]?.meta?.fingerprint;

    expect(implicit.res.status).toBe(200);
    expect(explicit.res.status).toBe(implicit.res.status);
    expect(canonical(explicit.body)).toEqual(canonical(implicit.body));
    expect(explicitRows).toEqual(implicitRows);
    // The fingerprint is the replay identity: naming yourself as your own target
    // must not read as a different movement.
    expect(implicitFingerprint).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(explicitFingerprint).toBe(implicitFingerprint);
  });

  it("writes exactly one transaction carrying the operationId", async () => {
    const { body } = await post({
      operationId: "op-single-tx",
      action: "adjust",
      memberName: PARENT.name,
      targetMemberName: CHILD.name,
      pin: PARENT_PIN,
      amount: 3,
    });

    const carrying = harness.history().filter((row) => row.meta?.operationId === "op-single-tx");
    expect(carrying).toHaveLength(1);
    expect(harness.history().filter((row) => row.meta?.operationId !== undefined)).toHaveLength(1);
    expect(body.applied).toBe(1);
    expect(carrying[0].meta).toMatchObject({
      operationId: "op-single-tx",
      source: "manual-adjust",
      actorId: PARENT.id,
      action: "adjust",
    });
    expect(harness.writeCount()).toBe(1);
  });

  it("replays the same operationId without paying the child twice", async () => {
    const command = {
      operationId: "op-replay-1",
      action: "adjust",
      memberName: PARENT.name,
      targetMemberName: CHILD.name,
      pin: PARENT_PIN,
      amount: -5,
    };

    const first = await post(command);
    const second = await post(command);

    expect(first.res.status).toBe(200);
    expect(second.res.status).toBe(200);
    expect(second.body).toMatchObject({ success: true, duplicate: true, applied: 0 });
    // Two seeded earns plus exactly ONE movement, however many times we post it.
    expect(harness.history()).toHaveLength(3);
    expect(harness.history().filter((row) => row.meta?.operationId === "op-replay-1")).toHaveLength(1);
    expect(second.body.weekData.points[CHILD.name]).toBe(CHILD_OPENING_BALANCE - 5);
  });
});

describe("POST /api/tasks/ledger — refusals", () => {
  it("refuses a CHILD's PIN with 403 adult_only, never 401", async () => {
    const { res, body } = await post({
      operationId: "op-child-actor-1",
      action: "adjust",
      memberName: CHILD.name,
      targetMemberName: SIBLING.name,
      pin: CHILD_PIN,
      amount: 5,
    });

    expect(res.status).toBe(403);
    expect(body).toMatchObject({ reason: "adult_only" });
    expect(res.status).not.toBe(401);
    expect(harness.writeCount()).toBe(0);
  });

  it("refuses a wrong parent PIN with 401 unauthorized", async () => {
    const { res, body } = await post({
      operationId: "op-wrong-pin-1",
      action: "adjust",
      memberName: PARENT.name,
      targetMemberName: CHILD.name,
      pin: WRONG_PIN,
      amount: 5,
    });

    expect(res.status).toBe(401);
    expect(body).toMatchObject({ reason: "unauthorized" });
    expect(harness.writeCount()).toBe(0);
  });

  it("refuses a target that is not on the roster with 404 and never falls back to the actor", async () => {
    const { res, body } = await post({
      operationId: "op-missing-target-1",
      action: "adjust",
      memberName: PARENT.name,
      targetMemberName: "Nobody At All",
      pin: PARENT_PIN,
      amount: 5,
    });

    expect(res.status).toBe(404);
    expect(body).toMatchObject({ reason: "unknown_member", operationId: "op-missing-target-1" });
    // The actor's own balance must NOT absorb the refused movement.
    expect(body.member).not.toBe(PARENT.name);
    expect(harness.writeCount()).toBe(0);
    expect(harness.history()).toHaveLength(2);
  });

  it("refuses a pet target with an honest code and writes nothing", async () => {
    const { res, body } = await post({
      operationId: "op-pet-target-1",
      action: "adjust",
      memberName: PARENT.name,
      targetMemberName: PET.name,
      pin: PARENT_PIN,
      amount: 5,
    });

    expect(res.status).toBe(403);
    expect(body.reason).toBe("pet_target");
    expect(harness.writeCount()).toBe(0);
    expect(harness.history()).toHaveLength(2);
  });
});

describe("POST /api/tasks/ledger — an outage is never an auth failure", () => {
  it("answers 503 retryable when the live roster cannot be read", async () => {
    mocks.getLiveMembers.mockRejectedValue(new Error("PocketBase is unreachable"));

    const { res, body } = await post({
      operationId: "op-roster-outage-1",
      action: "adjust",
      memberName: PARENT.name,
      targetMemberName: CHILD.name,
      pin: PARENT_PIN,
      amount: 5,
    });

    expect(res.status).toBe(503);
    expect(res.status).not.toBe(401);
    expect(body.retryable).toBe(true);
    // The repo's roster-outage code, so the client retries instead of asking
    // for a PIN again — and it is NOT `unauthorized`.
    expect(body.reason).toBe("member_roster_unavailable");
    expect(body.reason).not.toBe("unauthorized");
    expect(harness.writeCount()).toBe(0);
  });

  it("answers 503 retryable when the actor's live row cannot be read", async () => {
    mocks.getLiveMemberById.mockRejectedValue(new Error("PocketBase is unreachable"));

    const { res, body } = await post({
      operationId: "op-actor-outage-1",
      action: "adjust",
      memberName: PARENT.name,
      targetMemberName: CHILD.name,
      pin: PARENT_PIN,
      amount: 5,
    });

    expect(res.status).toBe(503);
    expect(res.status).not.toBe(401);
    expect(body.retryable).toBe(true);
    expect(harness.writeCount()).toBe(0);
  });
});

describe("POST /api/tasks/ledger — the body-size guard", () => {
  it("413s a declared content-length over the cap before reading the body", async () => {
    const request = jsonReq({
      operationId: "op-huge-declared",
      action: "adjust",
      memberName: PARENT.name,
      targetMemberName: CHILD.name,
      pin: PARENT_PIN,
      amount: 5,
    }, { "content-length": "999999" });
    const read = vi.spyOn(request, "text");

    const res = await POST(request);

    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ reason: "payload_too_large" });
    // The body was never read and never parsed, so an unauthenticated caller
    // cannot make this route buffer an arbitrary payload.
    expect(read).not.toHaveBeenCalled();
    expect(mocks.verifyPinFromPB).not.toHaveBeenCalled();
    expect(mocks.getLiveMembers).not.toHaveBeenCalled();
    expect(harness.writeCount()).toBe(0);
  });

  it("413s an oversized body even when the header understates it", async () => {
    const { res, body } = await post({
      operationId: "op-huge-actual",
      action: "adjust",
      memberName: PARENT.name,
      targetMemberName: CHILD.name,
      pin: PARENT_PIN,
      amount: 5,
      reason: "x".repeat(20_000),
    }, { "content-length": "12" });

    expect(res.status).toBe(413);
    expect(body).toMatchObject({ reason: "payload_too_large" });
    expect(mocks.verifyPinFromPB).not.toHaveBeenCalled();
    expect(harness.writeCount()).toBe(0);
  });

  it("still accepts a normal-sized body", async () => {
    const { res, body } = await post({
      operationId: "op-normal-size",
      action: "adjust",
      memberName: PARENT.name,
      targetMemberName: CHILD.name,
      pin: PARENT_PIN,
      amount: 5,
      reason: "helped out",
    });

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, member: CHILD.name });
  });
});
