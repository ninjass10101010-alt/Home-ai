import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isCronAuthorized: vi.fn(() => true),
  withAdmin: vi.fn(),
  broadcastHouseAlert: vi.fn(),
}));
vi.mock("@/lib/cron-auth", () => ({ isCronAuthorized: mocks.isCronAuthorized }));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn) }));
vi.mock("@/lib/ha/notify", () => ({ broadcastHouseAlert: mocks.broadcastHouseAlert }));

import { POST } from "@/app/api/cron/consuela/calendar-alert/route";
import { __resetKeyedLockForTests } from "@/lib/keyed-lock";

function req() {
  return new NextRequest("http://localhost/api/cron/consuela/calendar-alert", {
    method: "POST",
    headers: { authorization: "Bearer secret" },
  });
}

let events: Array<Record<string, unknown>>;
let prefs: Array<{ key: string; enabled: boolean }>;
let stateStore: Record<string, { key: string; value: string }>;

function pbStub() {
  return {
    collection: (name: string) => ({
      getFullList: async () =>
        name === "events" ? events : name === "ha_notify_prefs" ? prefs : [],
      getFirstListItem: async (f: string) => {
        const m = /key="([^"]+)"/.exec(f);
        const hit = stateStore[m![1]];
        if (!hit) throw { status: 404 };
        return { id: `id-${m![1]}`, ...hit };
      },
      create: async (d: { key: string; value: string }) => {
        stateStore[d.key] = d;
      },
      update: async (_id: string, d: { key: string; value: string }) => {
        stateStore[d.key] = { ...stateStore[d.key], ...d };
      },
    }),
  };
}

// 3 PM America/Detroit on 2026-01-05 — outside quiet hours; "today" = 2026-01-05.
const DAYTIME = new Date("2026-01-05T15:00:00-05:00");

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "secret");
  vi.stubEnv("TZ", "America/Detroit");
  vi.useFakeTimers();
  vi.setSystemTime(DAYTIME);
  mocks.isCronAuthorized.mockReturnValue(true);
  mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(pbStub()));
  mocks.broadcastHouseAlert.mockReset().mockResolvedValue({ sent: 1, failed: 0, notes: [] });
  events = [];
  prefs = [];
  stateStore = {};
  __resetKeyedLockForTests();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const ev = (id: string, time: string, score: number, date = "2026-01-05") => ({
  id, title: `Event ${id}`, date, time, importanceScore: score,
});

it("skips when the calendar pref is off", async () => {
  prefs = [{ key: "calendar", enabled: false }];
  expect((await (await POST(req())).json()).skipped).toBe("disabled");
  expect(mocks.broadcastHouseAlert).not.toHaveBeenCalled();
});

it("fires a heads-up for an important event 45 min out and persists the dedupe ref", async () => {
  prefs = [{ key: "calendar", enabled: true }];
  events = [ev("a", "3:45 PM", 80)];
  const res = await POST(req());
  expect(await res.json()).toMatchObject({ ok: true, fired: 1 });
  expect(mocks.broadcastHouseAlert).toHaveBeenCalledTimes(1);
  const saved = JSON.parse(stateStore["calendar-alert"].value);
  expect(saved.alerted).toContainEqual({ id: "a", date: "2026-01-05" });
});

it("does not re-alert an event already in the dedupe set", async () => {
  prefs = [{ key: "calendar", enabled: true }];
  stateStore["calendar-alert"] = {
    key: "calendar-alert",
    value: JSON.stringify({ alerted: [{ id: "a", date: "2026-01-05" }] }),
  };
  events = [ev("a", "3:45 PM", 80)];
  const res = await POST(req());
  expect((await res.json()).fired).toBe(0);
  expect(mocks.broadcastHouseAlert).not.toHaveBeenCalled();
});

it("ignores below-threshold and past-start events", async () => {
  prefs = [{ key: "calendar", enabled: true }];
  events = [ev("low", "3:45 PM", 0), ev("past", "2:00 PM", 80)];
  const res = await POST(req());
  expect((await res.json()).fired).toBe(0);
  expect(mocks.broadcastHouseAlert).not.toHaveBeenCalled();
});

it("does NOT persist an alerted ref when the broadcast sends nothing", async () => {
  prefs = [{ key: "calendar", enabled: true }];
  events = [ev("a", "3:45 PM", 80)];
  mocks.broadcastHouseAlert.mockResolvedValue({ sent: 0, failed: 1, notes: ["dead"] });
  await POST(req());
  expect(JSON.parse(stateStore["calendar-alert"].value).alerted).not.toContainEqual({ id: "a", date: "2026-01-05" });
});

it("two overlapping runs deliver the event alert exactly ONCE (no double push)", async () => {
  prefs = [{ key: "calendar", enabled: true }];
  events = [ev("a", "3:45 PM", 80)];
  const [r1, r2] = await Promise.all([POST(req()), POST(req())]);
  const fired = (await r1.json()).fired + (await r2.json()).fired;
  expect(fired).toBe(1);
  expect(mocks.broadcastHouseAlert).toHaveBeenCalledTimes(1);
  // The winner's delivered ref survives — a lost update can't resurrect the push.
  expect(JSON.parse(stateStore["calendar-alert"].value).alerted).toContainEqual({ id: "a", date: "2026-01-05" });
});
