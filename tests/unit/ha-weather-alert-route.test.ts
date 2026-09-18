import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isCronAuthorized: vi.fn(() => true),
  withAdmin: vi.fn(),
  broadcastHouseAlert: vi.fn(),
  readSevereWeather: vi.fn(),
}));

vi.mock("@/lib/cron-auth", () => ({ isCronAuthorized: mocks.isCronAuthorized }));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn) }));
vi.mock("@/lib/ha/notify", () => ({ broadcastHouseAlert: mocks.broadcastHouseAlert }));
vi.mock("@/lib/ha/weather-alert-fetch", () => ({ readSevereWeather: mocks.readSevereWeather }));

import { POST } from "@/app/api/cron/consuela/weather-alert/route";
import { __resetKeyedLockForTests } from "@/lib/keyed-lock";

function req() {
  return new NextRequest("http://localhost/api/cron/consuela/weather-alert", {
    method: "POST",
    headers: { authorization: "Bearer secret" },
  });
}

let stateStore: Record<string, { key: string; value: string }>;
let prefsRows: Array<{ key: string; enabled: boolean }>;

function pbStub() {
  return {
    collection: (name: string) => ({
      getFullList: async () => (name === "ha_notify_prefs" ? prefsRows : []),
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

const CLOSED = JSON.stringify({ active: false, startedAtISO: null, family: null, alertedAtISO: null });
// 3 PM America/Detroit — outside quiet hours, so episode-start fires.
const DAYTIME = new Date("2026-01-05T15:00:00-05:00");

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "secret");
  vi.stubEnv("TZ", "America/Detroit");
  vi.useFakeTimers();
  vi.setSystemTime(DAYTIME);
  mocks.isCronAuthorized.mockReturnValue(true);
  mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(pbStub()));
  mocks.broadcastHouseAlert.mockReset().mockResolvedValue({ sent: 1, failed: 0, notes: [] });
  mocks.readSevereWeather.mockReset();
  stateStore = {};
  prefsRows = [];
  __resetKeyedLockForTests();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("skips when the weather pref is off", async () => {
  prefsRows = [{ key: "weather", enabled: false }];
  const res = await POST(req());
  expect((await res.json()).skipped).toBe("disabled");
  expect(mocks.broadcastHouseAlert).not.toHaveBeenCalled();
});

it("fires once for a new storm episode and persists alerted state", async () => {
  prefsRows = [{ key: "weather", enabled: true }];
  stateStore["weather-alert"] = { key: "weather-alert", value: CLOSED };
  mocks.readSevereWeather.mockResolvedValue({ code: 96, severeEndISO: null });
  const res = await POST(req());
  expect(mocks.broadcastHouseAlert).toHaveBeenCalledTimes(1);
  expect(await res.json()).toMatchObject({ ok: true, fired: true, severe: "storm" });
  expect(JSON.parse(stateStore["weather-alert"].value).alertedAtISO).toBeTruthy();
});

it("does NOT mark alerted when the broadcast sends nothing (retries next run)", async () => {
  prefsRows = [{ key: "weather", enabled: true }];
  stateStore["weather-alert"] = { key: "weather-alert", value: CLOSED };
  mocks.readSevereWeather.mockResolvedValue({ code: 95, severeEndISO: null });
  mocks.broadcastHouseAlert.mockResolvedValue({ sent: 0, failed: 2, notes: ["boom"] });
  await POST(req());
  expect(JSON.parse(stateStore["weather-alert"].value).alertedAtISO).toBeNull();
});

it("does not re-fire within the same alerted episode", async () => {
  prefsRows = [{ key: "weather", enabled: true }];
  stateStore["weather-alert"] = {
    key: "weather-alert",
    value: JSON.stringify({ active: true, startedAtISO: "x", family: "storm", alertedAtISO: "y" }),
  };
  mocks.readSevereWeather.mockResolvedValue({ code: 99, severeEndISO: null });
  const res = await POST(req());
  expect((await res.json()).fired).toBe(false);
  expect(mocks.broadcastHouseAlert).not.toHaveBeenCalled();
});

it("degrades to ok:false (200) when the weather read throws", async () => {
  prefsRows = [{ key: "weather", enabled: true }];
  mocks.readSevereWeather.mockRejectedValue(new Error("open-meteo 503"));
  const res = await POST(req());
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: false, reason: "open-meteo 503" });
});

it("two overlapping runs fire the episode alert exactly ONCE (no double push)", async () => {
  prefsRows = [{ key: "weather", enabled: true }];
  stateStore["weather-alert"] = { key: "weather-alert", value: CLOSED };
  mocks.readSevereWeather.mockResolvedValue({ code: 96, severeEndISO: null });
  const [r1, r2] = await Promise.all([POST(req()), POST(req())]);
  const bodies = [await r1.json(), await r2.json()];
  const firedCount = bodies.filter((b: any) => b.fired === true).length;
  expect(firedCount).toBe(1);
  expect(mocks.broadcastHouseAlert).toHaveBeenCalledTimes(1);
  // The persisted state is the winner's — an alerted stamp that sticks.
  expect(JSON.parse(stateStore["weather-alert"].value).alertedAtISO).toBeTruthy();
});
