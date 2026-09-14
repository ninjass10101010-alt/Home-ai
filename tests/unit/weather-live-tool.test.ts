// tests/unit/weather-live-tool.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
const rows: Record<string, any[]> = {};
vi.mock("@/lib/pb-auth", () => ({ withAdmin: vi.fn(async (fn: any) => fn({ collection: () => ({ getFullList: async () => [], update: async () => ({}), create: async (d: any) => d, delete: async () => true }) })) }));
vi.mock("@/db", () => ({ db: new Proxy({}, { get: () => async () => [] }) }));
vi.mock("@/lib/services/config", () => ({ getServiceConfig: vi.fn(async () => null) })); // → env/default fallbacks
import { getTool } from "@/lib/hermes-tools";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({
      current: { temperature_2m: 72, apparent_temperature: 74, weather_code: 2 },
      daily: { temperature_2m_max: [78], temperature_2m_min: [58], precipitation_probability_max: [30] },
    }),
  })));
});
afterEach(() => vi.unstubAllGlobals());

it("get_weather returns REAL numbers from the provider", async () => {
  const out = JSON.parse(await getTool("get_weather")!.handler({}));
  expect(out.current_temp).toBe(72);
  expect(out.feels_like).toBe(74);
  expect(out.high).toBe(78);
  expect(out.condition).toBe("Partly cloudy");
});
it("no seasonal fabrication: the fake table is gone", async () => {
  (globalThis.fetch as any).mockImplementationOnce(async () => { throw new Error("network down"); });
  const out = JSON.parse(await getTool("get_weather")!.handler({}));
  expect(String(out.error)).toContain("unavailable");
  expect(out.current_temp).toBeUndefined();
});
