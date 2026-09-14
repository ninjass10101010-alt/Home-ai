import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// PIN mock idiom copied from tests/unit/ha-alarm-route.test.ts — the proven
// seam for x-consuela-pin routes (server-auth + tool dispatch fully mocked;
// no PocketBase, no network).
const CURRENT_MONDAY = (() => {
  // Same mondayOf/ISO contract as weekKey() in src/lib/task-utils.ts.
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().split("T")[0];
})();

const mocks = vi.hoisted(() => ({
  verifyPinAgainstAnyMember: vi.fn(),
  handler: vi.fn(),
  getTool: vi.fn(),
  withAdmin: vi.fn(),
  liveMembers: vi.fn(),
  weekKey: vi.fn(() => "2026-09-07"),
}));

vi.mock("@/lib/server-auth", () => ({
  verifyPinAgainstAnyMember: mocks.verifyPinAgainstAnyMember,
}));

vi.mock("@/lib/hermes-tools", () => ({
  getTool: mocks.getTool,
}));

// The adjust_points executor is week_data surgery (NOT getTool): it reads the
// roster + current week live and writes the row through withAdmin. All three
// seams are mocked so no PocketBase is ever contacted.
vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));
vi.mock("@/lib/consuela/live-reads", () => ({
  liveMembers: () => mocks.liveMembers(),
  parseJSON: (value: unknown, fallback: any) => {
    if (typeof value === "string") {
      try { return JSON.parse(value); } catch { return fallback; }
    }
    return value ?? fallback;
  },
}));
vi.mock("@/lib/task-utils", () => ({
  weekKey: () => mocks.weekKey(),
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
  mocks.verifyPinAgainstAnyMember.mockReset();
  mocks.handler.mockReset();
  mocks.getTool.mockReset().mockReturnValue({ handler: mocks.handler });
  mocks.withAdmin.mockReset();
  mocks.liveMembers.mockReset();
  mocks.weekKey.mockReset().mockReturnValue(CURRENT_MONDAY);
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
});

// ─── Task 15: adjust_points — the ONLY path on which points actually move ───
// Dedicated executor (NOT getTool): live-read the current week, find-or-create
// the week_data row, append one earn-shaped adjust tx, move the balance, and
// refuse a same-(member, amount, reason) replay inside 60s.
const ADJUST_ARGS = { member: "Emily", delta: 10, reason: "helping carry groceries" };
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function parentPin() {
  mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m1", name: "Rebecca", fullName: "Rebecca G", role: "parent" });
}

function roster() {
  mocks.liveMembers.mockResolvedValue([
    { id: 1, name: "Emily", fullName: "Emily G", role: "child" },
    { id: 2, name: "Rebecca", fullName: "Rebecca G", role: "parent" },
  ]);
}

/** Fake PB backed by `weekRows` (week_data fields kept as JSON strings, the
 *  live-PB convention). Returns the rows after the route ran. */
function pbWithWeek(weekRows: any[]) {
  const calls: Array<{ op: string; id?: string; data?: any }> = [];
  mocks.withAdmin.mockImplementation(async (fn: any) => fn({
    collection: (name: string) => ({
      getFullList: async () => (name === "week_data" ? weekRows : []),
      update: async (id: string, data: any) => {
        calls.push({ op: "update", id, data });
        const row = weekRows.find((r) => r.id === id);
        Object.assign(row, data);
        return row;
      },
      create: async (data: any) => {
        calls.push({ op: "create", data });
        weekRows.push({ id: "w-new", ...data });
        return data;
      },
    }),
  }));
  return calls;
}

/** Tolerates both shapes a live PB json field can surface (object|string). */
function field(v: any): any {
  return typeof v === "string" ? JSON.parse(v) : v;
}

function existingWeekRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "w1",
    weekStart: CURRENT_MONDAY,
    points: JSON.stringify({ "Emily G": 13 }),
    streak: JSON.stringify({}),
    lastActive: JSON.stringify({}),
    history: JSON.stringify([]),
    ...overrides,
  };
}

describe("POST /api/consuela/planner/apply — adjust_points (PIN-confirmed)", () => {
  it("child PIN stays 401 adult_only via the existing gate — no week_data surgery", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({ id: "m2", name: "Caspian", role: "child" });
    const res = await post({ tool: "adjust_points", args: ADJUST_ARGS }, { pin: "1234" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "adult_only" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("happy path: ONE adjust tx with the exact task-utils shape + points move; getTool is NOT used", async () => {
    parentPin();
    roster();
    const row = existingWeekRow();
    const calls = pbWithWeek([row]);

    const res = await post({ tool: "adjust_points", args: ADJUST_ARGS }, { pin: "1234" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, member: "Emily G", delta: 10, newTotal: 23 });
    expect(mocks.getTool).not.toHaveBeenCalled();

    const write = calls.find((c) => c.op === "update");
    expect(write).toBeDefined();
    const data: any = write!.data;
    expect(field(data.points)["Emily G"]).toBe(23);
    const history = field(data.history);
    expect(history).toHaveLength(1);
    const tx = history[0];
    expect(typeof tx.id).toBe("number");
    expect(tx.timestamp).toMatch(ISO_RE);
    expect(tx.member).toBe("Emily G");
    expect(tx.type).toBe("adjust");
    expect(tx.amount).toBe(10);
    expect(tx.description).toBe("helping carry groceries");
  });

  it("find-or-create: no row for the current week → create one carrying the tx + points", async () => {
    parentPin();
    roster();
    const calls = pbWithWeek([]);

    const res = await post({ tool: "adjust_points", args: { ...ADJUST_ARGS, delta: -4 } }, { pin: "1234" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, member: "Emily G", delta: -4, newTotal: -4 });
    const created = calls.find((c) => c.op === "create");
    expect(created).toBeDefined();
    expect(created!.data.weekStart).toBe(CURRENT_MONDAY);
    expect(field(created!.data.points)["Emily G"]).toBe(-4);
    expect(field(created!.data.history)).toHaveLength(1);
  });

  it("idempotent: the same (member, amount, reason) twice inside 60s = ONE tx", async () => {
    parentPin();
    roster();
    const row = existingWeekRow();
    pbWithWeek([row]);

    const first = await post({ tool: "adjust_points", args: ADJUST_ARGS }, { pin: "1234" });
    expect(first.status).toBe(200);
    const second = await post({ tool: "adjust_points", args: ADJUST_ARGS }, { pin: "1234" });
    expect(second.status).toBe(409);
    expect((await second.json()).ok).toBeFalsy();

    expect(field(row.history)).toHaveLength(1);
    expect(field(row.points)["Emily G"]).toBe(23);
  });

  it("the 60s window only blocks replays — the same reason MAY land again later", async () => {
    parentPin();
    roster();
    const old = new Date(Date.now() - 90_000).toISOString();
    const row = existingWeekRow({
      history: JSON.stringify([
        { id: 1, timestamp: old, member: "Emily G", type: "adjust", amount: 10, description: "helping carry groceries" },
      ]),
    });
    pbWithWeek([row]);

    const res = await post({ tool: "adjust_points", args: ADJUST_ARGS }, { pin: "1234" });
    expect(res.status).toBe(200);
    expect(field(row.history)).toHaveLength(2);
  });

  it("unknown member → 400 and no week_data write", async () => {
    parentPin();
    mocks.liveMembers.mockResolvedValue([{ name: "Rebecca", fullName: "Rebecca G", role: "parent" }]);
    const calls = pbWithWeek([existingWeekRow()]);
    const res = await post({ tool: "adjust_points", args: { ...ADJUST_ARGS, member: "Zoe" } }, { pin: "1234" });
    expect(res.status).toBe(400);
    expect((await res.json()).ok).toBeFalsy();
    expect(calls).toHaveLength(0);
  });

  it("bad delta/reason → 400 before the roster is even read", async () => {
    parentPin();
    for (const args of [
      { ...ADJUST_ARGS, delta: 0 },
      { ...ADJUST_ARGS, delta: 150 },
      { ...ADJUST_ARGS, delta: "ten" },
      { ...ADJUST_ARGS, delta: 2.5 },
      { ...ADJUST_ARGS, reason: "" },
      { ...ADJUST_ARGS, reason: "x".repeat(201) },
      { ...ADJUST_ARGS, member: "" },
    ]) {
      const res = await post({ tool: "adjust_points", args }, { pin: "1234" });
      expect(res.status, JSON.stringify(args)).toBe(400);
    }
    expect(mocks.liveMembers).not.toHaveBeenCalled();
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("a missing member name is refused before any PB read", async () => {
    parentPin();
    const res = await post({ tool: "adjust_points", args: { delta: 5, reason: "helped" } }, { pin: "1234" });
    expect(res.status).toBe(400);
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });
});
