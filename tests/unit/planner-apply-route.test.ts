import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

// PIN mock idiom copied from tests/unit/ha-alarm-route.test.ts — the proven
// seam for x-consuela-pin routes (server-auth + tool dispatch fully mocked;
// no PocketBase, no network).
const PARENT_PIN = "parent-pin-fixture";

const CURRENT_MONDAY = (() => {
  const d = new Date();
  d.setDate(d.getDate() + (d.getDay() === 0 ? -6 : 1 - d.getDay()));
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
})();

const ledger = vi.hoisted(() => ({
  calls: [] as any[],
  queue: [] as any[],
  result: undefined as any,
}));

const mocks = vi.hoisted(() => ({
  verifyPinAgainstAnyMember: vi.fn(),
  handler: vi.fn(),
  getTool: vi.fn(),
  liveMembers: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({
  verifyPinAgainstAnyMember: mocks.verifyPinAgainstAnyMember,
}));

vi.mock("@/lib/hermes-tools", () => ({
  getTool: mocks.getTool,
}));

vi.mock("@/lib/consuela/live-reads", () => ({
  liveMembers: () => mocks.liveMembers(),
}));

vi.mock("@/lib/ledger-operations", () => ({
  applyWeekLedgerOperation: async (args: any) => {
    ledger.calls.push(args);
    if (ledger.queue.length > 0) return ledger.queue.shift();
    return ledger.result;
  },
}));

import { POST } from "@/app/api/consuela/planner/apply/route";

function post(body: unknown, opts: { pin?: string; cookie?: string } = {}) {
  return POST(
    new NextRequest("http://localhost/api/consuela/planner/apply", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.pin ? { "x-consuela-pin": opts.pin } : {}),
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
      },
      body: JSON.stringify(body),
    })
  );
}

const VALID_ARGS = { title: "Drive to soccer", date: "2026-09-11", time: "14:30" };

beforeEach(() => {
  ledger.calls.length = 0;
  ledger.queue.length = 0;
  ledger.result = undefined;
  mocks.verifyPinAgainstAnyMember.mockReset();
  mocks.handler.mockReset();
  mocks.getTool.mockReset().mockReturnValue({ handler: mocks.handler });
  mocks.liveMembers.mockReset();
});

describe("POST /api/consuela/planner/apply — PIN-gated buffer apply", () => {
  it("missing PIN → 401 {error:'pin required'} before anything else runs", async () => {
    const res = await post({ tool: "add_event", args: VALID_ARGS });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "pin required" });
    expect(mocks.verifyPinAgainstAnyMember).not.toHaveBeenCalled();
    expect(mocks.getTool).not.toHaveBeenCalled();
  });

  it("wrong PIN (verifier returns null) → 401, tool never dispatched", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue(null);
    const res = await post({ tool: "add_event", args: VALID_ARGS }, { pin: "9999" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "pin required" });
    expect(mocks.verifyPinAgainstAnyMember).toHaveBeenCalledWith("9999");
    expect(mocks.getTool).not.toHaveBeenCalled();
  });

  it("child PIN → 401 adult_only (valid PIN, wrong role), tool never dispatched", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m2", name: "Caspian", role: "child" });
    const res = await post({ tool: "add_event", args: VALID_ARGS }, { pin: "1234" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "adult_only" });
    expect(mocks.getTool).not.toHaveBeenCalled();
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it("pet PIN (0000) → 401 adult_only, tool never dispatched", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m3", name: "Bailey", role: "pet" });
    const res = await post({ tool: "add_event", args: VALID_ARGS }, { pin: "0000" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "adult_only" });
    expect(mocks.verifyPinAgainstAnyMember).toHaveBeenCalledWith("0000");
    expect(mocks.getTool).not.toHaveBeenCalled();
  });

  it("PIN from the cookie is honored like the header (act-route parity)", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m1", name: "Rebecca", role: "parent" });
    mocks.handler.mockResolvedValue(JSON.stringify({ ok: true, event: { id: "e1", ...VALID_ARGS } }));
    const res = await post({ tool: "add_event", args: VALID_ARGS }, { cookie: "x-consuela-pin=1234" });
    expect(res.status).toBe(200);
    expect(mocks.verifyPinAgainstAnyMember).toHaveBeenCalledWith("1234");
  });

  it("tool outside the add_event allowlist → 400, getTool never reached", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({
      id: "m1",
      role: "parent",
    });
    const res = await post({ tool: "remove_event", args: { title: "X" } }, { pin: "1234" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "tool not allowed" });
    expect(mocks.getTool).not.toHaveBeenCalled();
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it("empty title → 400", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({
      id: "m1",
      role: "parent",
    });
    const res = await post({ tool: "add_event", args: { title: "   ", date: "2026-09-11" } }, { pin: "1234" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/title/i);
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it("bad date → 400", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({
      id: "m1",
      role: "parent",
    });
    const res = await post({ tool: "add_event", args: { title: "Buffer", date: "11/09/2026" } }, { pin: "1234" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/date/i);
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it("bad time → 400", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({
      id: "m1",
      role: "parent",
    });
    const res = await post({ tool: "add_event", args: { ...VALID_ARGS, time: "half past two" } }, { pin: "1234" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/time/i);
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it("date must be a REAL calendar date — 2026-13-45 → 400", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({
      id: "m1",
      role: "parent",
    });
    const res = await post({ tool: "add_event", args: { ...VALID_ARGS, date: "2026-13-45" } }, { pin: "1234" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/date/i);
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it("time parts must be real — hour 24 or minute 60+ → 400", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({
      id: "m1",
      role: "parent",
    });
    for (const time of ["24:00", "12:61"]) {
      const res = await post({ tool: "add_event", args: { ...VALID_ARGS, time } }, { pin: "1234" });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/time/i);
    }
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it("title over 120 chars → 400", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({
      id: "m1",
      role: "parent",
    });
    const res = await post(
      { tool: "add_event", args: { ...VALID_ARGS, title: "x".repeat(121) } },
      { pin: "1234" }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/title/i);
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it("24-hour AND 12-hour times are accepted", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({
      id: "m1",
      role: "parent",
    });
    mocks.handler.mockResolvedValue(JSON.stringify({ ok: true, event: { id: "e1" } }));
    for (const time of ["14:30", "2:30 PM", "2:30PM"]) {
      const res = await post({ tool: "add_event", args: { ...VALID_ARGS, time } }, { pin: "1234" });
      expect(res.status).toBe(200);
    }
    expect(mocks.handler).toHaveBeenCalledTimes(3);
  });

  it("happy path dispatches add_event with the cleaned args and returns {ok:true,event}", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m1", name: "Rebecca", role: "parent" });
    const event = { id: "e1", title: "Drive to soccer", date: "2026-09-11", time: "14:30" };
    mocks.handler.mockResolvedValue(JSON.stringify({ ok: true, event }));

    const res = await post({ tool: "add_event", args: VALID_ARGS }, { pin: "1234" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.event).toEqual(event);
    expect(mocks.handler).toHaveBeenCalledWith(VALID_ARGS);
  });

  it("handler reports failure (ok:false + error) → 400 with the handler's message", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({
      id: "m1",
      role: "parent",
    });
    mocks.handler.mockResolvedValue(JSON.stringify({ ok: false, error: "Could not create event" }));

    const res = await post({ tool: "add_event", args: VALID_ARGS }, { pin: "1234" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false, error: "Could not create event" });
  });

  it("handler throws → 400 with the message, never a raw 500", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({
      id: "m1",
      role: "parent",
    });
    mocks.handler.mockRejectedValue(new Error("PB is down"));

    const res = await post({ tool: "add_event", args: VALID_ARGS }, { pin: "1234" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "PB is down" });
  });

  it("add_event never reaches the ledger seam", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m1", name: "Rebecca", role: "parent" });
    mocks.handler.mockResolvedValue(JSON.stringify({ ok: true, event: { id: "e1" } }));

    const res = await post({ tool: "add_event", args: VALID_ARGS }, { pin: "1234" });
    expect(res.status).toBe(200);
    expect(ledger.calls).toHaveLength(0);
  });
});

const ADJUST_ARGS = { member: "Emily", delta: 10, reason: "helping carry groceries" };
const OPERATION_ID = "adjust-fixture-1";

function parentPin() {
  mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m1", name: "Rebecca", fullName: "Rebecca G", role: "parent" });
}

function roster() {
  mocks.liveMembers.mockResolvedValue([
    { id: 1, name: "Emily", fullName: "Emily G", role: "child" },
    { id: 2, name: "Rebecca", fullName: "Rebecca G", role: "parent" },
  ]);
}

function weekFixture(overrides?: { points?: Record<string, number>; history?: any[] }) {
  return {
    weekStart: CURRENT_MONDAY,
    points: overrides?.points ?? { "Emily G": 23 },
    streak: {},
    lastActive: {},
    history: overrides?.history ?? [],
  };
}

function adjustResult(extra?: Record<string, unknown>) {
  return {
    ok: true,
    applied: true,
    duplicate: false,
    semanticDuplicate: false,
    reconciled: true,
    weekData: weekFixture(),
    operationId: OPERATION_ID,
    ...extra,
  };
}

function adjustFailure(code: string, extra?: Record<string, unknown>) {
  return {
    ok: false,
    code,
    applied: false,
    duplicate: false,
    semanticDuplicate: false,
    reconciled: false,
    weekData: weekFixture(),
    operationId: OPERATION_ID,
    ...extra,
  };
}

function adjustBody(overrides?: Record<string, unknown>) {
  return {
    tool: "adjust_points",
    operationId: OPERATION_ID,
    args: { ...ADJUST_ARGS },
    ...overrides,
  };
}

describe("POST /api/consuela/planner/apply — adjust_points (canonical ledger seam)", () => {
  it("passes the stable operation ID to the shared helper", async () => {
    ledger.result = adjustResult({
      operationId: "adjust-fixture-1",
      weekData: weekFixture({
        history: [{
          id: 5150,
          timestamp: "2026-09-24T12:00:00.000Z",
          member: "Emily G",
          type: "adjust",
          amount: 10,
          description: "helping carry groceries",
          meta: { operationId: "adjust-fixture-1", source: "planner-adjust" },
        }],
      }),
    });
    parentPin();
    roster();

    const res = await post(adjustBody(), { pin: PARENT_PIN });
    expect(res.status).toBe(200);
    expect(ledger.calls[0].operation).toMatchObject({
      source: "planner-adjust",
      operationId: "adjust-fixture-1",
    });
    const body = await res.json();
    expect(body.weekData.history.at(-1).meta.operationId).toBe("adjust-fixture-1");
    expect(body.weekData.history.at(-1).operationId).toBeUndefined();
    expect(mocks.getTool).not.toHaveBeenCalled();
  });

  it("returns 202 after a successful ledger write with pending projection", async () => {
    ledger.result = adjustResult({
      operationId: "adjust-fixture-2",
      reconciled: false,
      projectionError: "projection_failed",
    });
    parentPin();
    roster();

    const res = await post(adjustBody({ operationId: "adjust-fixture-2" }), { pin: PARENT_PIN });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ ok: true, reconciled: false, applied: true });
  });

  it("hands the helper the current week, the planner source and one adjust entry for the LIVE full name", async () => {
    parentPin();
    roster();
    ledger.result = adjustResult();

    await post(adjustBody(), { pin: PARENT_PIN });

    expect(ledger.calls).toHaveLength(1);
    expect(ledger.calls[0].weekStart).toBe(CURRENT_MONDAY);
    expect(ledger.calls[0].operation.source).toBe("planner-adjust");
    expect(ledger.calls[0].operation.entries).toEqual([
      { type: "adjust", member: "Emily G", amount: 10, description: "helping carry groceries" },
    ]);
    expect(typeof ledger.calls[0].project).toBe("function");
  });

  it("returns member, delta, newTotal, weekData, operationId, applied, duplicate and reconciled", async () => {
    parentPin();
    roster();
    ledger.result = adjustResult();

    const res = await post(adjustBody(), { pin: PARENT_PIN });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      member: "Emily G",
      delta: 10,
      newTotal: 23,
      operationId: OPERATION_ID,
      applied: true,
      duplicate: false,
      reconciled: true,
    });
    expect(body.weekData.weekStart).toBe(CURRENT_MONDAY);
  });

  it("a replayed operation id is answered as a duplicate, not a second adjustment", async () => {
    parentPin();
    roster();
    ledger.result = adjustResult({ applied: false, duplicate: true });

    const res = await post(adjustBody(), { pin: PARENT_PIN });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      applied: false,
      duplicate: true,
      operationId: OPERATION_ID,
    });
  });

  it("a child PIN stays 401 adult_only via the existing gate — no ledger request", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m2", name: "Caspian", role: "child" });
    const res = await post(adjustBody(), { pin: "1234" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "adult_only" });
    expect(ledger.calls).toHaveLength(0);
  });

  it("a pet PIN stays 401 adult_only — no ledger request", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m3", name: "Bailey", role: "pet" });
    const res = await post(adjustBody(), { pin: "0000" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "adult_only" });
    expect(ledger.calls).toHaveLength(0);
  });

  it("an unauthenticated request (no live session) never reaches the PIN or the ledger", async () => {
    const res = await post(adjustBody(), { pin: PARENT_PIN, session: false });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.verifyPinAgainstAnyMember).not.toHaveBeenCalled();
    expect(ledger.calls).toHaveLength(0);
  });

  it("a missing or invalid PIN never reaches the ledger", async () => {
    const missing = await post(adjustBody());
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: "pin required" });

    mocks.verifyPinAgainstAnyMember.mockResolvedValue(null);
    const wrong = await post(adjustBody(), { pin: "9999" });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "pin required" });
    expect(ledger.calls).toHaveLength(0);
  });

  it("integer-delta validation runs before any point-changing request", async () => {
    parentPin();
    for (const delta of [0, 150, -150, "ten", 2.5, null, undefined]) {
      const res = await post(adjustBody({ args: { ...ADJUST_ARGS, delta } }), { pin: PARENT_PIN });
      expect(res.status, `delta=${JSON.stringify(delta)}`).toBe(400);
      expect((await res.json()).ok).toBe(false);
    }
    expect(mocks.liveMembers).not.toHaveBeenCalled();
    expect(ledger.calls).toHaveLength(0);
  });

  it("a blank reason (or an over-long one) is refused before any point-changing request", async () => {
    parentPin();
    for (const reason of ["", "   ", "x".repeat(201)]) {
      const res = await post(adjustBody({ args: { ...ADJUST_ARGS, reason } }), { pin: PARENT_PIN });
      expect(res.status, `reason length=${reason.length}`).toBe(400);
      expect((await res.json()).ok).toBe(false);
    }
    expect(mocks.liveMembers).not.toHaveBeenCalled();
    expect(ledger.calls).toHaveLength(0);
  });

  it("a missing member name is refused before any point-changing request", async () => {
    parentPin();
    const res = await post(adjustBody({ args: { delta: 5, reason: "helped" } }), { pin: PARENT_PIN });
    expect(res.status).toBe(400);
    expect(ledger.calls).toHaveLength(0);
  });

  it("a missing or unusable operation id is refused — a point move is never un-keyed", async () => {
    parentPin();
    for (const operationId of [undefined, "", "   ", "constructor", 42]) {
      const res = await post(adjustBody({ operationId }), { pin: PARENT_PIN });
      expect(res.status, `operationId=${JSON.stringify(operationId)}`).toBe(400);
      expect((await res.json()).ok).toBe(false);
    }
    expect(ledger.calls).toHaveLength(0);
  });

  it("unknown member → 400 and no ledger request", async () => {
    parentPin();
    mocks.liveMembers.mockResolvedValue([{ name: "Rebecca", fullName: "Rebecca G", role: "parent" }]);
    const res = await post(adjustBody({ args: { ...ADJUST_ARGS, member: "Zoe" } }), { pin: PARENT_PIN });
    expect(res.status).toBe(400);
    expect((await res.json()).ok).toBeFalsy();
    expect(ledger.calls).toHaveLength(0);
  });

  it("an unreadable roster → 503, never a silent point move", async () => {
    parentPin();
    mocks.liveMembers.mockResolvedValue(null);
    const res = await post(adjustBody(), { pin: PARENT_PIN });
    expect(res.status).toBe(503);
    expect(ledger.calls).toHaveLength(0);
  });

  it("insufficient balance on a DEDUCTION → 400 with the honest gap, no second attempt", async () => {
    parentPin();
    roster();
    ledger.result = adjustFailure("insufficient_balance", {
      weekData: weekFixture({ points: { "Emily G": 3 } }),
    });

    const res = await post(
      adjustBody({ args: { ...ADJUST_ARGS, delta: -10 } }),
      { pin: PARENT_PIN },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, operationId: OPERATION_ID });
    expect(String(body.error)).toMatch(/3 pts/);
    expect(String(body.error)).toMatch(/deduction/i);
    expect(ledger.calls).toHaveLength(1);
  });

  it("a BONUS refused by the ledger never claims a deduction happened", async () => {
    parentPin();
    roster();
    ledger.result = adjustFailure("insufficient_balance", {
      weekData: weekFixture({ points: { "Emily G": -3 } }),
    });

    const res = await post(adjustBody(), { pin: PARENT_PIN });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, operationId: OPERATION_ID });
    expect(String(body.error)).not.toMatch(/deduction/i);
    expect(String(body.error)).toMatch(/out of balance|balance/i);
    expect(String(body.error)).not.toMatch(/point moves|points moved/i);
  });

  it("a conflicting operation id → 409, so a client can tell a replay from a clash", async () => {
    parentPin();
    roster();
    ledger.result = adjustFailure("operation_conflict");

    const res = await post(adjustBody(), { pin: PARENT_PIN });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, operationId: OPERATION_ID });
  });

  it("a lost update is retried ONCE under the SAME operation id, then 503", async () => {
    parentPin();
    roster();
    ledger.queue.push(adjustFailure("ledger_write_conflict"), adjustFailure("ledger_write_conflict"));

    const res = await post(adjustBody(), { pin: PARENT_PIN });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, operationId: OPERATION_ID });
    expect(ledger.calls).toHaveLength(2);
    expect(ledger.calls[0].operation.operationId).toBe(ledger.calls[1].operation.operationId);
  });

  it("an unusable operation shape from the helper is a 503, not a fake success", async () => {
    parentPin();
    roster();
    ledger.result = adjustFailure("invalid_ledger_operation");

    const res = await post(adjustBody(), { pin: PARENT_PIN });
    expect(res.status).toBe(503);
    expect((await res.json()).ok).toBe(false);
  });

  it("the route owns no week_data surgery: no withAdmin, parseJSON, weekKey or Transaction", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/api/consuela/planner/apply/route.ts"),
      "utf8",
    );
    for (const banned of ["withAdmin", "parseJSON", "weekKey", "Transaction"]) {
      expect(source, `${banned} must not appear in the planner apply route`).not.toContain(banned);
    }
  });
});
