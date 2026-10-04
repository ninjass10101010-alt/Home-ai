// @vitest-environment jsdom
//
// The atmosphere is the THEME's palette, modulated by the clock. It used to be
// the CLOCK's palette, which inverted the whole layer: a Day (light) theme at
// night wore the night palette and a Night (dark) theme at noon wore the day
// palette, so a full-viewport canvas painted the opposite theme's colours over
// the app. Measured on the wall: dark theme + daytime clock was a milky amber
// flood (the day's light-grey midtone at full strength over a near-black
// canvas) and light theme + night was a faint pink-grey residue.
//
// The rule these pin: the palette LEG comes from the resolved theme
// (`<html data-theme>`), and the clock only ever shifts the veil WITHIN that
// leg. Seasonal + holiday intent is untouched — they still choose WHICH
// palette, the leg only chooses WHICH ROW of it.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AtmosphericProvider,
  useAtmosphericTheme,
  SEASON_ATMOSPHERE,
  resolveIsNight,
  TIME_OF_DAY_ATTR,
  type SeasonKey,
} from "@/hooks/useAtmosphericTheme";
import type { WeatherConfig } from "@/lib/weather-config";

vi.mock("@/hooks/useWeather", () => ({
  useWeatherConfig: () => ({
    weather: currentWeather,
    setLocation: vi.fn(),
    setUnit: vi.fn(),
    setTimeOfDay: vi.fn(),
    setSeason: vi.fn(),
    setHolidayOverride: vi.fn(),
  }),
}));

const DEFAULT_WEATHER: WeatherConfig = {
  location: "Holland, MI",
  unit: "F",
  timeOfDay: "auto",
  season: "spring",
  holidayOverride: "none",
};
let currentWeather: WeatherConfig = { ...DEFAULT_WEATHER };

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// No @testing-library/react in this repo — tests use the createRoot + act shim
// (see tests/unit/use-wall-mode.test.tsx).
type Atmospheric = ReturnType<typeof useAtmosphericTheme>;
let activeRoot: Root | null = null;

function renderAtmosphere() {
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
      </AtmosphericProvider>,
    );
  });
  return { result };
}

function setHtml(attr: string, value: string | null) {
  if (value === null) document.documentElement.removeAttribute(attr);
  else document.documentElement.setAttribute(attr, value);
}

afterEach(() => {
  if (activeRoot) {
    act(() => {
      activeRoot?.unmount();
    });
    activeRoot = null;
  }
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute(TIME_OF_DAY_ATTR);
  document.body.innerHTML = "";
  currentWeather = { ...DEFAULT_WEATHER };
});

const SEASONS: SeasonKey[] = ["spring", "summer", "autumn", "winter"];

/** WCAG relative luminance of a `#rrggbb` string. */
function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  );
}

describe("resolveIsNight — the clock seam's precedence", () => {
  const noon = new Date("2026-10-04T12:00:00");
  const midnight = new Date("2026-10-04T01:00:00");

  it("an explicit <html data-timeofday> pin wins over the family setting", () => {
    expect(resolveIsNight("night", "day", noon)).toBe(true);
    expect(resolveIsNight("day", "night", midnight)).toBe(false);
  });

  it("the family setting wins over the wall clock when there is no pin", () => {
    expect(resolveIsNight(null, "night", noon)).toBe(true);
    expect(resolveIsNight(null, "day", midnight)).toBe(false);
  });

  it("falls back to the shared 06:00–18:59 clock (never a private table)", () => {
    expect(resolveIsNight(null, "auto", noon)).toBe(false);
    expect(resolveIsNight(null, "auto", midnight)).toBe(true);
    expect(resolveIsNight(null, "auto", new Date("2026-10-04T05:59:00"))).toBe(true);
    expect(resolveIsNight(null, "auto", new Date("2026-10-04T06:00:00"))).toBe(false);
    expect(resolveIsNight(null, "auto", new Date("2026-10-04T18:59:00"))).toBe(false);
    expect(resolveIsNight(null, "auto", new Date("2026-10-04T19:00:00"))).toBe(true);
  });

  it("ignores a malformed pin instead of failing closed on it", () => {
    expect(resolveIsNight("dusk", "night", noon)).toBe(true);
    expect(resolveIsNight("", "day", noon)).toBe(false);
    expect(resolveIsNight(undefined, "day", noon)).toBe(false);
  });

  it("is published by the provider from whichever clock state applies", () => {
    currentWeather = { ...currentWeather, timeOfDay: "night" };
    setHtml("data-theme", "light");
    const { result } = renderAtmosphere();
    expect(result.current.isNight).toBe(true);
  });
});

describe("the atmosphere leg follows the resolved THEME, not the clock", () => {
  it("reports the leg it is wearing", () => {
    for (const theme of ["dark", "light"] as const) {
      setHtml("data-theme", theme);
      for (const tod of ["day", "night"] as const) {
        setHtml(TIME_OF_DAY_ATTR, tod);
        const { result } = renderAtmosphere();
        expect(result.current.leg, `${theme}/${tod}`).toBe(theme);
        act(() => activeRoot?.unmount());
        activeRoot = null;
      }
    }
  });

  it.each(SEASONS)("%s: flipping the clock changes NOTHING but isNight", (season) => {
    currentWeather = { ...currentWeather, season };

    const paletteFor = (theme: "dark" | "light", tod: "day" | "night") => {
      setHtml("data-theme", theme);
      setHtml(TIME_OF_DAY_ATTR, tod);
      const { result } = renderAtmosphere();
      const picked = { ...result.current };
      act(() => activeRoot?.unmount());
      activeRoot = null;
      return picked;
    };

    for (const theme of ["dark", "light"] as const) {
      const day = paletteFor(theme, "day");
      const night = paletteFor(theme, "night");
      expect(day.isNight).toBe(false);
      expect(night.isNight).toBe(true);
      // Every colour, the veil, the bridge and the particle are the SAME. The
      // clock used to swap the entire row here, which is the inversion.
      for (const field of [
        "accentColor",
        "glowColor",
        "bgGradient",
        "particleEmoji",
        "atmosphereOpacity",
        "bridgeGradient",
        "bridgeGlow",
        "season",
        "holiday",
        "leg",
      ] as const) {
        expect(night[field], `${theme} ${season} ${field} flipped with the clock`)
          .toEqual(day[field]);
      }
    }
  });

  it.each(SEASONS)("%s: each leg wears its OWN table row", (season) => {
    currentWeather = { ...currentWeather, season };
    for (const theme of ["dark", "light"] as const) {
      setHtml("data-theme", theme);
      setHtml(TIME_OF_DAY_ATTR, "day");
      const { result } = renderAtmosphere();
      const row = SEASON_ATMOSPHERE[season][theme];
      expect(result.current.accentColor).toBe(row.accentColor);
      expect(result.current.glowColor).toBe(row.glowColor);
      expect(result.current.bgGradient).toBe(row.bgGradient);
      expect(result.current.particleEmoji).toBe(row.particleEmoji);
      expect(result.current.atmosphereOpacity).toBe(row.atmosphereOpacity);
      expect(result.current.bridgeGradient).toBe(row.bridgeGradient);
      expect(result.current.bridgeGlow).toBe(row.bridgeGlow);
      act(() => activeRoot?.unmount());
      activeRoot = null;
    }
  });

  it("a season accent is legible on its OWN canvas and would fail on the other", () => {
    // The defect in one number: the two rows are not two moods of one colour,
    // they are two different colours chosen for two different canvases.
    for (const season of SEASONS) {
      const dark = luminance(SEASON_ATMOSPHERE[season].dark.accentColor);
      const light = luminance(SEASON_ATMOSPHERE[season].light.accentColor);
      expect(dark, `${season} dark-leg accent is too dark for a dark canvas`).toBeGreaterThan(0.4);
      expect(light, `${season} light-leg accent is too light for a light canvas`).toBeLessThan(0.35);
    }
  });
});

describe("seasonal + holiday intent survives the leg", () => {
  it("a holiday still overrides the season, in BOTH legs, at BOTH clocks", () => {
    currentWeather = { ...currentWeather, holidayOverride: "christmas" };
    for (const theme of ["dark", "light"] as const) {
      for (const tod of ["day", "night"] as const) {
        setHtml("data-theme", theme);
        setHtml(TIME_OF_DAY_ATTR, tod);
        const { result } = renderAtmosphere();
        expect(result.current.holiday, `${theme}/${tod}`).toBe("christmas");
        expect(result.current.accentColor).toBe("#ef4444");
        expect(result.current.particleEmoji).toBe("🎄");
        act(() => activeRoot?.unmount());
        activeRoot = null;
      }
    }
  });

  it("the leg is published even when a holiday is wearing the palette", () => {
    currentWeather = { ...currentWeather, holidayOverride: "halloween" };
    setHtml("data-theme", "dark");
    const { result } = renderAtmosphere();
    expect(result.current.leg).toBe("dark");
    expect(result.current.holiday).toBe("halloween");
  });

  it("the season override still wins over the real calendar", () => {
    currentWeather = { ...currentWeather, season: "winter", holidayOverride: "none" };
    setHtml("data-theme", "dark");
    const { result } = renderAtmosphere();
    expect(result.current.season).toBe("winter");
  });
});

describe("the leg is reactive, not a first-render snapshot", () => {
  it("follows a live theme change without a reload", async () => {
    setHtml("data-theme", "dark");
    setHtml(TIME_OF_DAY_ATTR, "day");
    const { result } = renderAtmosphere();
    expect(result.current.leg).toBe("dark");
    expect(result.current.accentColor).toBe(SEASON_ATMOSPHERE.spring.dark.accentColor);

    await act(async () => {
      setHtml("data-theme", "light");
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.leg).toBe("light");
    expect(result.current.accentColor).toBe(SEASON_ATMOSPHERE.spring.light.accentColor);
  });
});
