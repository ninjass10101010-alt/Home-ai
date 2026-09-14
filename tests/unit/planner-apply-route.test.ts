import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// PIN mock idiom copied from tests/unit/ha-alarm-route.test.ts — the proven
// seam for x-consuela-pin routes (server-auth + tool dispatch fully mocked;
// no PocketBase, no network).
const mocks = vi.hoisted(() => ({
  verifyPinAgainstAnyMember: vi.fn(),
  handler: vi.fn(),
  getTool: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({
  verifyPinAgainstAnyMember: mocks.verifyPinAgainstAnyMember,
}));

vi.mock("@/lib/hermes-tools", () => ({
  getTool: mocks.getTool,
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
