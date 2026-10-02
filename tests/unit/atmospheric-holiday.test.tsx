// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AtmosphericProvider, useAtmosphericTheme, HOLIDAY_ATMOSPHERE } from "@/hooks/useAtmosphericTheme";
import { HOLIDAY_PALETTE, HOLIDAY_STYLE } from "@/lib/holiday";

vi.mock("@/hooks/useWeather", () => ({
  useWeatherConfig: () => ({
    weather: { location: "Holland, MI", unit: "F", timeOfDay: "auto", season: "auto", holidayOverride: "auto" },
    setLocation: vi.fn(),
    setUnit: vi.fn(),
    setTimeOfDay: vi.fn(),
    setSeason: vi.fn(),
    setHolidayOverride: vi.fn(),
  }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Harness note: this repo has no @testing-library/react — tests use the
// established createRoot + React-act shim (see tests/unit/use-wall-mode.test.tsx).
// The provider only destructures { weather } from useWeatherConfig, and the
// mocked shape above matches WeatherContextValue for any other consumer.
type Atmospheric = ReturnType<typeof useAtmosphericTheme>;
let activeRoot: Root | null = null;
function renderAtmospheric(): { result: { current: Atmospheric } } {
  const result = { current: undefined as unknown as Atmospheric };
  function Probe() {
    result.current = useAtmosphericTheme();
    return null;
  }
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => {
    activeRoot = createRoot(el);
    activeRoot.render(
      <AtmosphericProvider>
        <Probe />
      </AtmosphericProvider>
    );
  });
  return { result };
}

describe("AtmosphericProvider holiday resolution", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    if (activeRoot) {
      act(() => {
        activeRoot?.unmount();
      });
      activeRoot = null;
    }
    vi.useRealTimers();
  });

  it("resolves an 11-window holiday the old 5-entry table did not know (Nov 1 → diadelosmuertos)", () => {
    vi.setSystemTime(new Date("2026-11-01T12:00:00"));
    const { result } = renderAtmospheric();
    expect(result.current.holiday).toBe("diadelosmuertos");
    expect(result.current.accentColor).toBe(HOLIDAY_PALETTE.diadelosmuertos.accent);
  });

  it("resolves none on a non-holiday day (Jan 20)", () => {
    vi.setSystemTime(new Date("2026-01-20T12:00:00"));
    const { result } = renderAtmospheric();
    expect(result.current.holiday).toBe("none");
  });

  it("all 11 holiday accents are single-sourced across PALETTE, STYLE and ATMOSPHERE", () => {
    const keys = Object.keys(HOLIDAY_PALETTE) as Array<keyof typeof HOLIDAY_PALETTE>;
    expect(keys).toHaveLength(11);
    for (const key of keys) {
      expect(HOLIDAY_ATMOSPHERE[key]?.accentColor, `${key} atmosphere`).toBe(HOLIDAY_PALETTE[key].accent);
      expect(HOLIDAY_STYLE[key]?.accent, `${key} style`).toBe(HOLIDAY_PALETTE[key].accent);
    }
  });
});
