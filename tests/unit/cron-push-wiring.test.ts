import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isCronAuthorized: vi.fn(() => true),
  withAdmin: vi.fn(),
  broadcastHouseAlert: vi.fn(),
  pushFanout: vi.fn(async () => ({ sent: 1, pruned: 0, failed: 0 })),
}));

vi.mock("@/lib/cron-auth", () => ({ isCronAuthorized: mocks.isCronAuthorized }));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn) }));
vi.mock("@/lib/ha/notify", () => ({ broadcastHouseAlert: mocks.broadcastHouseAlert }));
vi.mock("@/lib/push/fanout", () => ({ pushFanout: mocks.pushFanout }));

import { POST } from "@/app/api/cron/consuela/calendar-alert/route";
import { __resetKeyedLockForTests } from "@/lib/keyed-lock";

let events: Array<Record<string, unknown>>;
let schedules: Array<Record<string, unknown>>;
let prefs: Array<{ key: string; enabled: boolean }>;
let stateStore: Record<string, { key: string; value: string }>;

function pbStub() {
  return {
    collection: (name: string) => ({
      getFullList: async () => {
        if (name === "events") return events;
        if (name === "schedules") return schedules;
        if (name === "ha_notify_prefs") return prefs;
        return [];
      },
      getFirstListItem: async (f: string) => {
        const m = /key="([^"]+)"/.exec(f);
        const k = m![1];
        const hit = stateStore[k];
        if (!hit) throw { status: 404 };
        return { id: `id-${k}`, ...hit };
      },
      create: async (d: { key: string; value: string }) => {
        stateStore[d.key] = d;
        return { id: "id-new", ...d };
      },
      update: async (_id: string, d: { key: string; value: string }) => {
        stateStore[d.key] = { ...stateStore[d.key], ...d };
      },
    }),
  };
}

// 3:00 PM America/Detroit, 2026-01-05 (a Monday). A routine at 3:10 PM is inside
// the 30-min routine window; a 3:20 PM event is inside the 60-min event window.
const DAYTIME = new Date("2026-01-05T15:00:00-05:00");

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "secret");
  vi.stubEnv("TZ", "America/Detroit");
  vi.useFakeTimers();
  vi.setSystemTime(DAYTIME);
  mocks.isCronAuthorized.mockReturnValue(true);
  mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(pbStub()));
  mocks.broadcastHouseAlert.mockReset().mockResolvedValue({ sent: 1, failed: 0, notes: [] });
  mocks.pushFanout.mockClear();
  events = [];
  schedules = [];
  prefs = [];
  stateStore = {};
});

afterEach(() => {
  vi.useRealTimers();
  __resetKeyedLockForTests();
});

describe("calendar-alert cron pushes schedule alerts", () => {
  it("fans out notify=true routine, skips notify=false", async () => {
    schedules = [
      { id: "sched-no", title: "Quiet routine", time: "3:05 PM", days: "all", notify: false },
      { id: "sched-yes", title: "Drink water", time: "3:10 PM", days: "all", notify: true },
    ];
    prefs = [{ key: "calendar", enabled: true }];
    const res = await POST(new NextRequest("http://localhost/x", { method: "POST", headers: { authorization: "Bearer secret" } }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    const cal = mocks.pushFanout.mock.calls.map((c: any) => c[0]).filter((p: any) => p.url === "/calendar");
    expect(cal.length).toBeGreaterThan(0);
    const titles = cal.map((p: any) => p.title);
    expect(titles.some((t: string) => t.includes("Drink water"))).toBe(true);
    expect(titles.some((t: string) => t.includes("Quiet routine"))).toBe(false);
  });

  it("includes a notify=true one-off event", async () => {
    events = [{ id: "event-dentist", title: "Dentist", date: "2026-01-05", time: "3:20 PM", notify: true, importanceScore: 10 }];
    prefs = [{ key: "calendar", enabled: true }];
    const res = await POST(new NextRequest("http://localhost/x", { method: "POST", headers: { authorization: "Bearer secret" } }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    const cal = mocks.pushFanout.mock.calls.map((c: any) => c[0]).filter((p: any) => p.url === "/calendar");
    expect(cal.some((p: any) => p.title.includes("Dentist"))).toBe(true);
  });

  it("does not re-fire a notify event on a second run (dedupe persisted)", async () => {
    events = [{ id: "event-dentist", title: "Dentist", date: "2026-01-05", time: "3:20 PM", notify: true, importanceScore: 10 }];
    prefs = [{ key: "calendar", enabled: true }];
    const req = () => new NextRequest("http://localhost/x", { method: "POST", headers: { authorization: "Bearer secret" } });
    await POST(req());
    const firstRun = mocks.pushFanout.mock.calls.filter((c: any) => c[0].url === "/calendar").length;
    expect(firstRun).toBeGreaterThan(0);
    mocks.pushFanout.mockClear();
    await POST(req());
    const secondRun = mocks.pushFanout.mock.calls.filter((c: any) => c[0].url === "/calendar").length;
    expect(secondRun).toBe(0);
  });

  it("does not fan out when calendar pref disabled", async () => {
    schedules = [{ id: "sched-yes", title: "X", time: "3:10 PM", days: "all", notify: true }];
    prefs = [{ key: "calendar", enabled: false }];
    const res = await POST(new NextRequest("http://localhost/x", { method: "POST", headers: { authorization: "Bearer secret" } }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mocks.pushFanout).not.toHaveBeenCalled();
  });
});
