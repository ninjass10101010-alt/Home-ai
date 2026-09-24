// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { act, createElement, useLayoutEffect } from "react";
import type { ReactElement } from "react";
import WeatherWidget from "@/components/ui/WeatherWidget";
import { SceneLayers, conditionPresentation } from "@/components/ui/WxToys";
import { moonPhase, moonPhaseName, makeCloudSpec } from "@/components/ui/WeatherScene";
import { wearAdvice, stormAdvice, snowAdvice, fusionOutlook } from "@/lib/weather-insights";
import { contrastSafeTextAccent, getWeatherSkin, resolveAccent } from "@/components/ui/WeatherSkins";
import { SKY } from "@/components/ui/wx-tokens";
import { WeatherProvider } from "@/hooks/useWeather";
import { AtmosphericProvider } from "@/hooks/useAtmosphericTheme";
import { AuthProvider } from "@/hooks/useAuth";
import SeasonHolidayArt from "@/components/ui/WeatherSeasonArt";
import WeatherParticles from "@/components/ui/WeatherParticles";

// db.selectTodaysEvents reads a module-private cache hydrated by the global
// CacheRefresher — never reachable in unit tests. Expose the seam.
const { dbEventsMock } = vi.hoisted(() => ({ dbEventsMock: [] as any[] }));
vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  return { ...actual, db: { ...actual.db, selectTodaysEvents: () => dbEventsMock } };
});

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

class FakeResizeObserver {
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.cb = cb; }
  observe() { this.cb([{ contentRect: { width: 320 } }] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver); }
  unobserve() {}
  disconnect() {}
}

const roots: ReturnType<typeof createRoot>[] = [];
const globalsCss = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => {
    const root = createRoot(el);
    roots.push(root);
    root.render(
      <AuthProvider>
        <WeatherProvider>
          <AtmosphericProvider>{ui}</AtmosphericProvider>
        </WeatherProvider>
      </AuthProvider>
    );
  });
  return el.firstChild as HTMLElement;
}

function findDetailsButton(el: HTMLElement): HTMLButtonElement | undefined {
  return Array.from(el.querySelectorAll("button")).find(
    (b) => b.getAttribute("aria-label") === "Open weather details"
  );
}

async function settle(ms = 60) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function conditionShowsCloud(condition: Element | null): boolean {
  return !!condition?.firstElementChild;
}

function modalCondition(dialog: HTMLElement): Element | null {
  return dialog.querySelector('[data-testid="wx-scene-layers"]')?.parentElement?.nextElementSibling?.firstElementChild ?? null;
}

function metricRow(dialog: HTMLElement, label: string): HTMLElement | undefined {
  return Array.from(dialog.querySelectorAll<HTMLElement>("div")).find((node) =>
    node.className.includes("flex items-baseline") && node.textContent?.trim().startsWith(label)
  );
}

type ParsedColor = [number, number, number, number];

function parseColor(value: string): ParsedColor {
  const hex = value.trim();
  if (hex.startsWith("#")) return [...parseHexColor(hex), 1] as ParsedColor;
  const rgb = hex.match(/rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)(?:[, ]+\s*([\d.]+))?\s*\)/i);
  if (rgb) {
    const alpha = rgb[4] == null ? 1 : Number(rgb[4]);
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha];
  }
  return [0, 0, 0, 1];
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundColor = parseColor(foreground);
  const backgroundColor = parseColor(background);
  const foregroundRgb = foregroundColor.slice(0, 3).map((channel, index) =>
    Math.round(channel * foregroundColor[3] + backgroundColor[index] * (1 - foregroundColor[3]))
  ) as [number, number, number];
  const backgroundRgb = backgroundColor.slice(0, 3) as [number, number, number];
  const foregroundLuminance = colorLuminance(foregroundRgb);
  const backgroundLuminance = colorLuminance(backgroundRgb);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

function renderSceneProps(props: Record<string, unknown>): HTMLElement {
  return render(createElement(SceneLayers as any, props));
}

function parseHexColor(value: string): [number, number, number] {
  const hex = value.replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}

function colorLuminance(color: [number, number, number]): number {
  const [red, green, blue] = color.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function effectiveContrast(foreground: string, opacity: number, background: string): number {
  const foregroundRgb = parseHexColor(foreground);
  const backgroundRgb = parseHexColor(background);
  const composite = foregroundRgb.map((channel, index) =>
    Math.round(channel * opacity + backgroundRgb[index] * (1 - opacity))
  ) as [number, number, number];
  const foregroundLuminance = colorLuminance(composite);
  const backgroundLuminance = colorLuminance(backgroundRgb);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

function compositeHex(foreground: string, background: string, opacity: number): string {
  const foregroundRgb = parseHexColor(foreground);
  const backgroundRgb = parseHexColor(background);
  return `#${foregroundRgb
    .map((channel, index) => Math.round(channel * opacity + backgroundRgb[index] * (1 - opacity)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function stormHeaderSurfaces(): string[] {
  const stops = ["#6A6F96", "#5D5B8F", "#4D4770"];
  return stops.flatMap((stop) => [0.4, 0.64].map((opacity) => compositeHex("#FFFFFF", stop, opacity)));
}

function selectedCellSurfaces(stops: string[], accent: string): string[] {
  return stops.map((stop) => compositeHex(accent, stop, 0x26 / 255));
}

function modalPanelTextSurfaces(): string[] {
  return ["#F5F6FA", "#0F1117"].flatMap((pageSurface) => {
    const overlay = compositeHex("#0A0F1C", pageSurface, 0.55);
    return [
      compositeHex("#101422", overlay, 0.92),
      compositeHex("#0A0D18", overlay, 0.94),
    ];
  });
}

function modalCellTextSurfaces(accent: string): string[] {
  return modalPanelTextSurfaces().flatMap((surface) => [
    surface,
    compositeHex(accent, surface, 0x1F / 255),
  ]);
}

function failedFetchHeaderSurfaces(): string[] {
  const stops = ["#DFE4EE", "#EEF1F6", "#D9E6F5"];
  const glassAlpha = 0.3;
  const surfaceAlpha = glassAlpha + 0.4 * (1 - glassAlpha);
  return stops
    .map((stop) => compositeHex("#788091", stop, 0.38))
    .flatMap((surface) => [
      compositeHex("#FFFFFF", surface, glassAlpha),
      compositeHex("#FFFFFF", surface, surfaceAlpha),
    ]);
}

function LayoutMotionCapture({ capture }: { capture: () => void }) {
  useLayoutEffect(() => {
    capture();
  }, [capture]);
  return null;
}

function makeOpenMeteoPayload(overrides: { isDay?: number; precip?: number; visibility?: number; cloud?: number | null; code?: number; startAt?: string } = {}) {
  const isDay = overrides.isDay ?? 1;
  const precip = overrides.precip ?? 5;
  const visibility = overrides.visibility ?? 16000;
  const cloud = overrides.cloud === undefined ? 30 : overrides.cloud;
  const code = overrides.code ?? 1;
  // `startAt` pins the payload's first hour (ISO). The strip truncates at the
  // LOCAL-day boundary of hours[0], so a real-clock start makes the strip
  // length time-of-day dependent (a 1 AM run left only 4 hours and this suite
  // failed every night). Noon UTC = 8 AM family-local = a long, deterministic
  // rest-of-day strip.
  const now = overrides.startAt ? new Date(overrides.startAt) : new Date();
  now.setMinutes(0, 0, 0);
  const hourlyTimes: string[] = [];
  for (let i = -1; i < 24; i++) {
    hourlyTimes.push(new Date(now.getTime() + i * 3600_000).toISOString());
  }
  const dailyTimes: string[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getTime() + i * 86_400_000);
    dailyTimes.push(d.toISOString().slice(0, 10));
  }
  const sunrise = new Date(now.getTime() - 4 * 3600_000);
  const sunset = new Date(now.getTime() + 6 * 3600_000);
  return {
    current: {
      temperature_2m: 70,
      relative_humidity_2m: 55,
      apparent_temperature: 72,
      weather_code: code,
      wind_speed_10m: 8,
      wind_direction_10m: 250,
      is_day: isDay,
      cloud_cover: cloud,
      uv_index: 6,
      pressure_msl: 1016,
      visibility,
    },
    hourly: {
      time: hourlyTimes,
      temperature_2m: hourlyTimes.map(() => 70),
      weather_code: hourlyTimes.map(() => code),
      precipitation_probability: hourlyTimes.map(() => precip),
      is_day: hourlyTimes.map(() => isDay),
      cloud_cover: hourlyTimes.map(() => cloud),
      wind_speed_10m: hourlyTimes.map(() => 8),
      wind_direction_10m: hourlyTimes.map(() => 250),
      relative_humidity_2m: hourlyTimes.map(() => 55),
      visibility: hourlyTimes.map(() => visibility),
    },
    daily: {
      time: dailyTimes,
      weather_code: [1, 1, 1, 1, 1, 1],
      temperature_2m_max: [75, 76, 77, 78, 79, 80],
      temperature_2m_min: [58, 59, 60, 61, 62, 63],
      precipitation_probability_max: [10, 10, 10, 10, 10, 10],
      sunrise: [sunrise.toISOString(), ...dailyTimes.slice(1).map(() => sunrise.toISOString())],
      sunset: [sunset.toISOString(), ...dailyTimes.slice(1).map(() => sunset.toISOString())],
      uv_index_max: [6, 5, 4, 3, 2, 1],
    },
  };
}

function mockOpenMeteo(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.open-meteo.com")) {
        return Promise.resolve({ json: () => Promise.resolve(payload) });
      }
      return Promise.reject(new Error("no network"));
    })
  );
}

describe("WeatherWidget — Not Boring redesign", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn((cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number));
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })));
  });

  afterEach(() => {
    act(() => {
      roots.forEach((r) => r.unmount());
    });
    roots.length = 0;
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("opens the forecast in a modal instead of expanding inline", async () => {
    mockOpenMeteo(makeOpenMeteoPayload());
    const el = render(<WeatherWidget />);
    await settle();

    const button = findDetailsButton(el);
    expect(button).toBeTruthy();

    act(() => button!.click());

    expect(document.body.textContent).toContain("Humidity");
    expect(document.body.textContent).toContain("Next 24 Hours");

    const dailyTab = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
      (b) => b.textContent === "daily"
    );
    expect(dailyTab).toBeTruthy();
    act(() => dailyTab!.click());
    expect(document.body.textContent).toContain("5-Day Forecast");

    const clippedPanel = Array.from(el.querySelectorAll("div")).find(
      (d) => (d as HTMLElement).style.maxHeight === "440px"
    );
    expect(clippedPanel).toBeUndefined();
  });

  it("omits daily precipitation chips when probability data is missing", async () => {
    const payload = makeOpenMeteoPayload();
    (payload.daily as any).precipitation_probability_max = payload.daily.time.map(() => null);
    mockOpenMeteo(payload);
    const el = render(<WeatherWidget />);
    await settle();

    act(() => findDetailsButton(el)!.click());
    const dailyTab = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
      (button) => button.textContent === "daily"
    );
    expect(dailyTab).toBeTruthy();
    act(() => dailyTab!.click());

    const dialog = document.querySelector("#weather-details-dialog") as HTMLElement;
    const rows = Array.from(dialog.querySelectorAll<HTMLElement>('[role="listitem"]'));
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => !row.textContent?.includes("0%"))).toBe(true);
  });

  it("renders a real daily precipitation 0% chip", async () => {
    const payload = makeOpenMeteoPayload();
    (payload.daily as any).precipitation_probability_max = payload.daily.time.map(() => 0);
    mockOpenMeteo(payload);
    const el = render(<WeatherWidget />);
    await settle();

    act(() => findDetailsButton(el)!.click());
    const dailyTab = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
      (button) => button.textContent === "daily"
    );
    expect(dailyTab).toBeTruthy();
    act(() => dailyTab!.click());

    const dialog = document.querySelector("#weather-details-dialog") as HTMLElement;
    const rows = Array.from(dialog.querySelectorAll<HTMLElement>('[role="listitem"]'));
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.textContent?.includes("0%"))).toBe(true);
  });

  it("closes the modal via the Close action", async () => {
    mockOpenMeteo(makeOpenMeteoPayload());
    const el = render(<WeatherWidget />);
    await settle();

    const button = findDetailsButton(el);
    act(() => button!.click());
    expect(document.body.textContent).toContain("Humidity");

    const close = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Close"));
    expect(close).toBeTruthy();
    act(() => close!.click());
    expect(document.body.textContent).not.toContain("Humidity");
  });

  it("renders Fahrenheit on the card AND in the details modal even when the stored unit is Celsius", async () => {
    localStorage.setItem(
      "home-ai-weather-config",
      JSON.stringify({ location: "Holland, MI", unit: "C", timeOfDay: "auto", season: "auto", holidayOverride: "auto" })
    );
    try {
      mockOpenMeteo(makeOpenMeteoPayload()); // payload temps are °F (70 / 75 / 58)
      const el = render(<WeatherWidget />);
      await settle();

      // card — 70°F, not 21°C
      expect(el.querySelector('[data-testid="wx-hero-temp"]')?.textContent).toBe("70");
      expect(el.textContent).toContain("H:75°");

      // no °F/°C toggle anywhere on the card
      const anyUnitToggle = Array.from(el.querySelectorAll("button")).some((b) => b.getAttribute("aria-label")?.startsWith("Switch to"));
      expect(anyUnitToggle).toBe(false);

      // details modal — every temp stays Fahrenheit
      const button = findDetailsButton(el);
      act(() => button!.click());
      const modalText = document.body.textContent ?? "";
      expect(modalText).toContain("70°");
      expect(modalText).not.toContain("21°");
      expect(modalText).toContain("72°"); // feels-like row

      // stored config is healed back to F
      expect((JSON.parse(localStorage.getItem("home-ai-weather-config") ?? "{}") as { unit?: string }).unit).toBe("F");
    } finally {
      localStorage.removeItem("home-ai-weather-config");
    }
  });

  it("shows today's high and low when weather data loads", async () => {
    mockOpenMeteo(makeOpenMeteoPayload());
    const el = render(<WeatherWidget />);
    await settle();

    expect(el.textContent).toContain("H:75°");
    expect(el.textContent).toContain("L:58°");
  });

  it("appends feels-like to the H/L line when it differs from the actual temperature", async () => {
    mockOpenMeteo(makeOpenMeteoPayload());
    const el = render(<WeatherWidget />);
    await settle();

    // payload: temp 70, feels like 72 → note visible
    expect(el.textContent).toContain("Feels like 72°");
  });

  it("hides the feels-like note when it matches the actual temperature", async () => {
    const payload = makeOpenMeteoPayload();
    payload.current.apparent_temperature = 70;
    mockOpenMeteo(payload);
    const el = render(<WeatherWidget />);
    await settle();

    expect(el.textContent).not.toContain("Feels like");
  });

  it("shows the wind arrow rotated to the flow direction in the modal", async () => {
    mockOpenMeteo(makeOpenMeteoPayload());
    const el = render(<WeatherWidget />);
    await settle();

    const button = findDetailsButton(el);
    act(() => button!.click());

    const windRow = Array.from(document.querySelectorAll("div")).find(
      (d) => d.textContent?.startsWith("Wind") && d.querySelector("svg[viewBox='0 0 16 16']")
    );
    expect(windRow).toBeTruthy();
    // payload windDir 250 → arrow rotated to 250+180 = 430 % 360 = 70deg (where wind blows TO)
    const svg = windRow!.querySelector("svg[viewBox='0 0 16 16']") as SVGElement;
    expect(svg.style.transform).toBe("rotate(70deg)");
  });

  it("renders the day strip as an accessible slider with clay icons and precip labels when rain is likely", async () => {
    mockOpenMeteo(makeOpenMeteoPayload({ precip: 80 }));
    const el = render(<WeatherWidget />);
    await settle();

    const strip = el.querySelector('[role="slider"][aria-label="Preview the rest of the day"]');
    expect(strip).toBeTruthy();
    expect(strip!.textContent).toContain("NOW");

    // one clay icon cell per hour instead of the old SVG curve…
    expect(strip!.textContent).toContain("70°");
    // …and rain shows as precip labels, not SVG rain ticks
    expect(strip!.textContent).toContain("80%");
    expect(strip!.querySelectorAll("svg rect").length).toBe(0);
  });

  it("previews the next hour via keyboard and returns to now on Escape", async () => {
    mockOpenMeteo(makeOpenMeteoPayload());
    const el = render(<WeatherWidget />);
    await settle();

    const strip = el.querySelector('[role="slider"][aria-label="Preview the rest of the day"]') as HTMLElement;
    expect(strip.getAttribute("aria-valuenow")).toBe("0");

    act(() => {
      strip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(strip.getAttribute("aria-valuenow")).toBe("1");

    act(() => {
      strip.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle(800);
    expect(strip.getAttribute("aria-valuenow")).toBe("0");
  });

  it("uses a sky-blue clear-day canvas while preserving condition palettes", () => {
    expect(SKY.clear).toBe("from-[#55bce8] via-[#8fd8f1] to-[#d8f2f4]");
    expect(SKY.cloudy).toBe("from-[#dfe4ee] via-[#eef1f6] to-[#d9e6f5]");
    expect(SKY.rain).toBe("from-[#b9c4d8] via-[#c9d7ea] to-[#d8d3f0]");
    expect(SKY.snow).toBe("from-[#f4f7fb] via-[#e6efff] to-[#efe6fb]");
    expect(SKY.storm).toBe("from-[#6a6f96] via-[#5d5b8f] to-[#4d4770]");
    expect(SKY.night).toBe("from-[#6f74a8] via-[#a29dc9] to-[#e2dbf2]");
  });

  it("crossfades the card scene while preserving the day-strip preview contract", async () => {
    const payload = makeOpenMeteoPayload({ code: 0, cloud: 10 });
    payload.hourly.weather_code = payload.hourly.weather_code.map((_, i) => (i <= 1 ? 0 : 61));
    mockOpenMeteo(payload);
    const el = render(<WeatherWidget />);
    await settle();

    const strip = el.querySelector('[role="slider"][aria-label="Preview the rest of the day"]') as HTMLElement;
    expect(el.querySelector('[data-testid="wx-scene-layers"]')?.getAttribute("data-scene")).toBe("clear");

    act(() => {
      strip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });

    expect(strip.getAttribute("aria-valuenow")).toBe("1");
    expect(el.querySelector('[data-testid="wx-scene-layers"]')?.getAttribute("data-scene")).toBe("rain");
    expect((el.querySelector('.wx-sky[data-active="true"]') as HTMLElement).className).toContain("from-[#b9c4d8]");
    expect(el.querySelector('[data-testid="wx-hero-temp"]')?.textContent).toBe("70");

    act(() => {
      strip.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();
    expect(strip.getAttribute("aria-valuenow")).toBe("0");
    expect(el.querySelector('[data-testid="wx-scene-layers"]')?.getAttribute("data-scene")).toBe("clear");
  });

  it("drives poster geometry and weather layers from measured inputs", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })));
    const dawn = renderSceneProps({
      scene: "clear",
      showFog: false,
      showBirds: false,
      cloudCover: 40,
      sunProgress: 0.1,
      wind: 4,
      windDirection: 90,
      precipitation: 0,
    });
    const later = renderSceneProps({
      scene: "clear",
      showFog: false,
      showBirds: false,
      cloudCover: 40,
      sunProgress: 0.85,
      wind: 28,
      windDirection: 270,
      precipitation: 80,
    });

    const dawnSun = dawn.querySelector('[data-weather-shape="sun"]');
    const laterSun = later.querySelector('[data-weather-shape="sun"]');
    const dawnHorizon = dawn.querySelector('[data-weather-shape="poster-horizon"]');
    const laterHorizon = later.querySelector('[data-weather-shape="poster-horizon"]');
    expect(dawnSun?.getAttribute("cx")).not.toBe(laterSun?.getAttribute("cx"));
    expect(dawnSun?.getAttribute("cy")).not.toBe(laterSun?.getAttribute("cy"));
    expect(dawnHorizon?.getAttribute("d")).not.toBe(laterHorizon?.getAttribute("d"));
    const rainy = renderSceneProps({
      scene: "rain",
      showFog: false,
      showBirds: false,
      cloudCover: 40,
      precipitation: 80,
      wind: 28,
      windDirection: 270,
    });
    expect(rainy.querySelectorAll("[data-weather-precip]").length).toBeGreaterThan(0);
    expect((rainy.querySelector('[data-testid="wx-scene-layers"]') ?? rainy).getAttribute("data-wind")).toBe("28");
    expect((rainy.querySelector("[data-cloud-layer]") as HTMLElement).style.animation).toContain("18s");
  });

  it("does not invent unknown or zero poster measurements", () => {
    const unknown = renderSceneProps({
      scene: "rain",
      showFog: false,
      showBirds: false,
      cloudCover: null,
      precipitation: null,
      wind: null,
      windDirection: null,
      humidity: null,
      visibility: null,
    });
    const zero = renderSceneProps({
      scene: "rain",
      showFog: false,
      showBirds: false,
      cloudCover: 0,
      precipitation: 0,
      wind: 0,
      windDirection: 180,
      humidity: 40,
      visibility: 16000,
    });

    const unknownScene = unknown.querySelector('[data-testid="wx-scene-layers"]') ?? unknown;
    const zeroScene = zero.querySelector('[data-testid="wx-scene-layers"]') ?? zero;
    expect(unknownScene.getAttribute("data-precipitation")).toBe("unavailable");
    expect(unknownScene.getAttribute("data-wind")).toBe("unavailable");
    expect(unknownScene.querySelectorAll("[data-weather-precip]").length).toBe(0);
    expect(unknownScene.querySelector('[data-weather-shape="rain-diamonds"]')).toBeNull();
    expect(zeroScene.getAttribute("data-precipitation")).toBe("0");
    expect(zeroScene.querySelectorAll("[data-weather-precip]").length).toBe(0);
    expect(zeroScene.querySelector('[data-weather-shape="rain-diamonds"]')).toBeNull();
    expect(zeroScene.querySelector('[data-testid="wx-fog"]')).toBeNull();
  });

  it("keeps condition labels and icons aligned across day, night, cloud, fog, and overcast", async () => {
    const toys = await import("@/components/ui/WxToys");
    const presentation = (toys as unknown as {
      conditionPresentation?: (scene: string, code: number, cloud: number | null, isDay: boolean) => { label: string; icon: string };
    }).conditionPresentation;
    expect(typeof presentation).toBe("function");
    if (typeof presentation !== "function") return;

    const cases = [
      { code: 1, isDay: true, cloud: 0, label: "Clear", icon: "clear" },
      { code: 1, isDay: true, cloud: null, label: "Partly Cloudy", icon: "partly" },
      { code: 2, isDay: true, cloud: 0, label: "Clear", icon: "clear" },
      { code: 1, isDay: false, cloud: 0, label: "Clear", icon: "night" },
      { code: 1, isDay: false, cloud: 40, label: "Partly Cloudy", icon: "partly-night" },
      { code: 3, isDay: true, cloud: null, label: "Overcast", icon: "cloudy" },
      { code: 3, isDay: false, cloud: 80, label: "Overcast", icon: "cloudy" },
      { code: 45, isDay: false, cloud: null, label: "Foggy", icon: "fog" },
    ];

    for (const testCase of cases) {
      const scene = toys.wmoToScene(testCase.code, testCase.isDay);
      expect(presentation(scene, testCase.code, testCase.cloud, testCase.isDay)).toEqual({
        label: testCase.label,
        icon: testCase.icon,
      });
    }
  });

  it("keeps explicit null hourly cloud unknown while current cloud remains available", async () => {
    const payload = makeOpenMeteoPayload({ code: 1, cloud: 90 });
    (payload.hourly as any).cloud_cover = payload.hourly.cloud_cover.map(() => null);
    mockOpenMeteo(payload);
    const el = render(<WeatherWidget />);
    await settle();

    const strip = el.querySelector('[role="slider"][aria-label="Preview the rest of the day"]') as HTMLElement;
    const currentScene = el.querySelector('[data-testid="wx-scene-layers"]') as HTMLElement;
    expect(currentScene.querySelector('[data-testid="wx-poster-clouds"]')?.getAttribute("data-cloud-cover")).toBe("90");

    act(() => strip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    const previewScene = el.querySelector('[data-testid="wx-scene-layers"]') as HTMLElement;
    expect(previewScene.querySelector('[data-testid="wx-poster-clouds"]')?.getAttribute("data-cloud-cover")).toBe("unavailable");
    expect(Array.from(previewScene.querySelectorAll<HTMLElement>("[data-cloud-layer]")).every((cloud) => cloud.style.opacity === "0")).toBe(true);

    act(() => findDetailsButton(el)!.click());
    await settle();
    const dialog = document.querySelector("#weather-details-dialog") as HTMLElement;
    expect(dialog.querySelector('[data-testid="wx-poster-clouds"]')?.getAttribute("data-cloud-cover")).toBe("unavailable");
  });

  it("does not fall back to current humidity or cloud cover for a selected hour", async () => {
    const payload = makeOpenMeteoPayload({ code: 1, cloud: 90 });
    payload.current.relative_humidity_2m = 55;
    payload.current.cloud_cover = 90;
    const start = payload.hourly.time.findIndex((time) => new Date(time).getTime() >= Date.now() - 59 * 60_000);
    const selected = start < 0 ? 1 : start + 1;
    (payload.hourly as any).relative_humidity_2m[selected] = null;
    (payload.hourly as any).cloud_cover[selected] = null;
    mockOpenMeteo(payload);
    const el = render(<WeatherWidget />);
    await settle();

    act(() => findDetailsButton(el)!.click());
    await settle();
    const dialog = document.querySelector("#weather-details-dialog") as HTMLElement;
    const scrubber = dialog.querySelector('[role="slider"][aria-label="Scrub through the next 24 hours"]') as HTMLElement;
    act(() => scrubber.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));

    expect(metricRow(dialog, "Humidity")).toBeUndefined();
    expect(metricRow(dialog, "Cloud cover")).toBeUndefined();
  });

  it.each([
    { code: 61, condition: "Rainy", shape: "rain-diamonds" },
    { code: 71, condition: "Snowy", shape: "snow-diamonds" },
  ])("uses the current hourly probability for $condition poster particles", async ({ code, condition, shape }) => {
    const payload = makeOpenMeteoPayload({ code, precip: 80 });
    mockOpenMeteo(payload);
    const el = render(<WeatherWidget />);
    await settle();

    const scene = el.querySelector('[data-testid="wx-scene-layers"]') as HTMLElement;
    expect(el.textContent).toContain(condition);
    expect(scene.getAttribute("data-precipitation")).toBe("80");
    expect(scene.querySelectorAll("[data-weather-precip]").length).toBeGreaterThan(0);
    expect(scene.querySelector(`[data-weather-shape="${shape}"]`)).not.toBeNull();
  });

  it("suppresses dry wear advice for a future wet WMO code with null probability", async () => {
    const payload = makeOpenMeteoPayload({ code: 1, precip: 0 });
    const start = payload.hourly.time.findIndex((time) => new Date(time).getTime() >= Date.now() - 59 * 60_000);
    const first = start < 0 ? 0 : start;
    payload.hourly.weather_code = payload.hourly.weather_code.map((_, index) => index > first ? 61 : 1);
    (payload.hourly as any).precipitation_probability = payload.hourly.precipitation_probability.map((_, index) => index > first ? null : 0);
    mockOpenMeteo(payload);
    const el = render(<WeatherWidget />);
    await settle();

    expect(el.textContent).toContain("Raincoats ready");
    expect(el.textContent).not.toContain("Sunglasses weather");
  });

  it.each([
    { code: 61, condition: "Rainy" },
    { code: 71, condition: "Snowy" },
  ])("uses known current wetness when hourly precipitation and outlook are unavailable for WMO $code", async ({ code, condition }) => {
    const payload = makeOpenMeteoPayload({ code });
    (payload as any).hourly = undefined;
    mockOpenMeteo(payload);
    const el = render(<WeatherWidget />);
    await settle();

    expect(el.textContent).toContain(condition);
    expect(el.textContent).not.toContain("Sunglasses weather");
    expect(el.textContent).toContain("Raincoats ready");
  });

  it.each([
    { cover: 0, label: "Clear" },
    { cover: null, label: "Partly Cloudy" },
    { cover: 100, label: "Partly Cloudy" },
  ])("renders measured night clouds at $cover percent without changing the condition label", ({ cover, label }) => {
    const el = renderSceneProps({
      scene: "night",
      showFog: false,
      showBirds: false,
      cloudCover: cover,
      wind: 0,
    });
    const clouds = el.querySelector('[data-testid="wx-poster-clouds"]') as HTMLElement | null;
    expect(clouds).toBeTruthy();
    expect(clouds!.getAttribute("data-cloud-cover")).toBe(cover == null ? "unavailable" : String(cover));
    const layers = Array.from(clouds!.querySelectorAll<HTMLElement>("[data-cloud-layer]"));
    if (cover === 100) {
      expect(layers.length).toBe(2);
      expect(layers.every((layer) => Number(layer.style.opacity) > 0)).toBe(true);
    } else {
      expect(layers.every((layer) => Number(layer.style.opacity) === 0)).toBe(true);
    }
    expect(conditionPresentation("night", 1, cover, false).label).toBe(label);
  });

  it("keeps measurement fog below the WMO fog intensity near the visibility threshold", async () => {
    const payload = makeOpenMeteoPayload({ code: 0, visibility: 7500 });
    mockOpenMeteo(payload);
    const el = render(<WeatherWidget />);
    await settle();
    const fog = el.querySelector('[data-testid="wx-fog"]') as HTMLElement | null;
    expect(fog).toBeTruthy();
    expect(Number(fog!.getAttribute("data-fog-opacity"))).toBeGreaterThan(0);
    expect(Number(fog!.getAttribute("data-fog-opacity"))).toBeLessThan(0.5);
  });

  it.each([{ humidity: 82, opacity: "0.00" }, { humidity: 100, opacity: "0.55" }])("derives fog opacity from humidity $humidity", async ({ humidity, opacity }) => {
    const payload = makeOpenMeteoPayload({ code: 0, visibility: null as unknown as number });
    payload.current.relative_humidity_2m = humidity;
    (payload.current as any).visibility = null;
    (payload.hourly as any).relative_humidity_2m = payload.hourly.time.map(() => humidity);
    (payload.hourly as any).visibility = payload.hourly.time.map(() => null);
    mockOpenMeteo(payload);
    const el = render(<WeatherWidget />);
    await settle();
    const fog = el.querySelector('[data-testid="wx-fog"]');
    if (opacity === "0.00") {
      expect(fog).toBeNull();
    } else {
      expect(fog).toBeTruthy();
      expect(fog!.getAttribute("data-fog-opacity")).toBe(opacity);
    }
  });

  it("does not drift clouds at zero wind but keeps nonzero wind drift", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })));
    const still = renderSceneProps({ scene: "clear", showFog: false, showBirds: false, cloudCover: 80, wind: 0 });
    const moving = renderSceneProps({ scene: "clear", showFog: false, showBirds: false, cloudCover: 80, wind: 8 });
    const stillLayer = still.querySelector("[data-cloud-layer]") as HTMLElement;
    const movingLayer = moving.querySelector("[data-cloud-layer]") as HTMLElement;
    expect(stillLayer.style.animation).toBe("");
    expect(movingLayer.style.animation).toContain("wxCloudDrift");
  });

  it("pauses holiday artwork and SMIL when motion is disabled", () => {
    const art = render(<SeasonHolidayArt season="autumn" tod="day" activeHoliday="halloween" backdrop={false} motionOk={false} />);
    const artRoot = (art.matches("[data-weather-art-motion]") ? art : art.querySelector("[data-weather-art-motion]")) as HTMLElement | null;
    expect(artRoot).toBeTruthy();
    expect(artRoot!.getAttribute("data-weather-art-motion")).toBe("paused");
    expect(art.querySelector("animate")).toBeNull();
  });

  it("keeps holiday particles static when motion is disabled", async () => {
    const particles = render(<WeatherParticles type="spark" tod="day" motionOk={false} />);
    await settle();
    expect(particles.querySelectorAll("div").length).toBeGreaterThan(0);
    const particleRoot = (particles.matches("[data-weather-particle-motion]") ? particles : particles.querySelector("[data-weather-particle-motion]")) as HTMLElement | null;
    expect(particleRoot).toBeTruthy();
    expect(particleRoot!.getAttribute("data-weather-particle-motion")).toBe("paused");
  });

  it("does not run modalEnter under reduced motion", async () => {
    mockOpenMeteo(makeOpenMeteoPayload());
    const el = render(<WeatherWidget />);
    await settle();
    act(() => findDetailsButton(el)!.click());
    await settle();
    const dialog = document.querySelector("#weather-details-dialog") as HTMLElement;
    const panel = Array.from(dialog.querySelectorAll<HTMLElement>("div")).find((node) =>
      node.className.includes("weather-details-modal") || node.style.animation.includes("modalEnter")
    );
    expect(panel).toBeTruthy();
    expect(panel!.style.animation).not.toContain("modalEnter");
  });

  it("keeps the weather motion gates in the stylesheet", () => {
    expect(globalsCss).toContain('.weather-art-motion[data-weather-art-motion="paused"]');
    expect(globalsCss).toContain('.weather-particle-motion[data-weather-particle-motion="paused"]');
    expect(globalsCss).toContain(".weather-details-modal");
  });

  it("keeps clear-day NOW text readable across the poster gradient for every season accent", async () => {
    const helpers = await import("@/components/ui/WeatherSkins") as unknown as {
      contrastSafeTextAccent?: (accent: string, surface: string | string[], fallback: string) => string;
    };
    expect(typeof helpers.contrastSafeTextAccent).toBe("function");
    if (typeof helpers.contrastSafeTextAccent !== "function") return;
    const clearStops = ["#55BCE8", "#8FD8F1", "#D8F2F4"];
    for (const season of ["spring", "summer", "autumn", "winter"] as const) {
      const accent = getWeatherSkin(season, false, 0).accent;
      const safe = helpers.contrastSafeTextAccent(accent, clearStops, "#1E293B");
      expect(Math.min(...clearStops.map((surface) => contrastRatio(safe, surface))), season).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([
    { season: "autumn" as const, code: 3, stops: ["#DFE4EE", "#EEF1F6", "#D9E6F5"] },
    { season: "winter" as const, code: 71, stops: ["#F4F7FB", "#E6EFFF", "#EFE6FB"] },
  ])("keeps the selected $season strip cell readable against its accent composite", async ({ season, code, stops }) => {
    localStorage.setItem("home-ai-weather-config", JSON.stringify({ timeOfDay: "day", season, holidayOverride: "none" }));
    try {
      mockOpenMeteo(makeOpenMeteoPayload({ code, precip: 80 }));
      const el = render(<WeatherWidget />);
      await settle();
      const strip = el.querySelector('[role="slider"][aria-label="Preview the rest of the day"]') as HTMLElement;
      act(() => strip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
      const selected = strip.querySelector("[data-selected]") as HTMLElement;
      const now = Array.from(selected.querySelectorAll<HTMLElement>("span")).find((node) => node.textContent === "NOW");
      const accent = getWeatherSkin(season, false, code).accent;
      const surfaces = selectedCellSurfaces(stops, accent);
      expect(now).toBeTruthy();
      expect(Math.min(...surfaces.map((surface) => contrastRatio(now!.style.color, surface))), season).toBeGreaterThanOrEqual(4.5);
    } finally {
      localStorage.removeItem("home-ai-weather-config");
    }
  });

  it.each([
    { name: "clear", theme: "light" as const, code: 0, isDay: 1, timeOfDay: "day", holiday: "none", accent: "#E85D45" },
    { name: "storm", theme: "light" as const, code: 95, isDay: 1, timeOfDay: "day", holiday: "none", accent: "#FFB44F" },
    { name: "night", theme: "light" as const, code: 0, isDay: 0, timeOfDay: "night", holiday: "none", accent: "#FF6F5E" },
    { name: "holiday", theme: "light" as const, code: 0, isDay: 1, timeOfDay: "day", holiday: "christmas", accent: "#EF4444" },
    { name: "clear", theme: "dark" as const, code: 0, isDay: 1, timeOfDay: "day", holiday: "none", accent: "#E85D45" },
    { name: "storm", theme: "dark" as const, code: 95, isDay: 1, timeOfDay: "day", holiday: "none", accent: "#FFB44F" },
    { name: "night", theme: "dark" as const, code: 0, isDay: 0, timeOfDay: "night", holiday: "none", accent: "#FF6F5E" },
    { name: "holiday", theme: "dark" as const, code: 0, isDay: 1, timeOfDay: "day", holiday: "christmas", accent: "#EF4444" },
  ])("keeps selected and unselected $name modal cells readable in the $theme theme", async ({ code, isDay, timeOfDay, holiday, accent, theme }) => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("home-ai-weather-config", JSON.stringify({ timeOfDay, season: "summer", holidayOverride: holiday }));
    try {
      mockOpenMeteo(makeOpenMeteoPayload({ code, isDay, precip: 80 }));
      const el = render(<WeatherWidget />);
      await settle();
      act(() => findDetailsButton(el)!.click());
      await settle();

      const dialog = document.querySelector("#weather-details-dialog") as HTMLElement;
      const panel = dialog.querySelector(".weather-details-modal") as HTMLElement;
      expect(panel).toBeTruthy();
      expect(panel.style.background).toContain("linear-gradient(170deg, rgba(16, 20, 34, 0.92) 0%, rgba(10, 13, 24, 0.94) 100%)");
      const cells = Array.from(dialog.querySelectorAll<HTMLButtonElement>('[role="list"] [role="listitem"] button'));
      expect(cells.length).toBeGreaterThan(1);
      const selected = cells[0];
      const unselected = cells[1];
      const alpha = Number(selected.style.background.match(/,\s*([\d.]+)\)/)?.[1]);
      expect(Number.isFinite(alpha)).toBe(true);
      expect(alpha).toBeCloseTo(0.12, 5);
      const labels = [selected, unselected].flatMap((cell) => {
        const spans = Array.from(cell.querySelectorAll<HTMLElement>("span"));
        return [
          spans.find((node) => node.textContent === "NOW" || /^\d+(AM|PM)$/.test(node.textContent ?? "")),
          spans.find((node) => node.textContent === "70°" || node.textContent === "—"),
          spans.find((node) => node.textContent === "80%"),
        ].filter((node): node is HTMLElement => !!node);
      });
      const colors = labels.map((node) => node.style.color);
      const surfaces = modalCellTextSurfaces(accent);

      expect(labels).toHaveLength(6);
      expect(colors.every(Boolean)).toBe(true);
      expect(new Set(colors).size).toBe(1);
      expect(Math.min(...surfaces.flatMap((surface) => colors.map((color) => contrastRatio(color, surface))))).toBeGreaterThanOrEqual(4.5);
    } finally {
      delete document.documentElement.dataset.theme;
      localStorage.removeItem("home-ai-weather-config");
    }
  });

  it("validates modal cell foregrounds against the rendered panel composites", () => {
    for (const accent of ["#E85D45", "#FFB44F", "#FF6F5E", "#EF4444"]) {
      const foreground = contrastSafeTextAccent(accent, modalCellTextSurfaces(accent), "#FFFFFF");
      expect(Math.min(...modalCellTextSurfaces(accent).map((surface) => contrastRatio(foreground, surface))), accent).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([
    ["#ef4444", "christmas"],
    ["#f97316", "halloween"],
    ["#f43f5e", "valentines"],
    ["#eab308", "newyears"],
    ["#f59e0b", "cincodemayo"],
    ["#d97706", "thanksgiving"],
    ["#22c55e", "stpatricks"],
    ["#ec4899", "diadelosmuertos"],
    ["#0d9488", "virginguadalupe"],
  ])("uses readable text and solid-control colors for holiday accent %s", async (accent, holiday) => {
    const helpers = await import("@/components/ui/WeatherSkins") as unknown as {
      accentForeground?: (value: string) => string;
      contrastSafeTextAccent?: (value: string, surface: string | string[], fallback: string) => string;
    };
    expect(typeof helpers.accentForeground).toBe("function");
    expect(typeof helpers.contrastSafeTextAccent).toBe("function");
    if (typeof helpers.accentForeground !== "function" || typeof helpers.contrastSafeTextAccent !== "function") return;
    const foreground = helpers.accentForeground(accent);
    const safeText = helpers.contrastSafeTextAccent(accent, ["#55BCE8", "#8FD8F1", "#D8F2F4"], "#1E293B");
    expect(contrastRatio(foreground, accent)).toBeGreaterThanOrEqual(4.5);
    expect(Math.min(...["#55BCE8", "#8FD8F1", "#D8F2F4"].map((surface) => contrastRatio(safeText, surface))), holiday).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    { name: "night", accent: "#FF6F5E", surfaces: ["#6F74A8", "#A29DC9", "#E2DBF2"], fallback: "#1E293B" },
    { name: "storm header", accent: "#FFB44F", surfaces: stormHeaderSurfaces(), fallback: "#FFFFFF" },
    { name: "slate", accent: "#7FA8D9", surfaces: ["#1E293B", "#334155"], fallback: "#FFFFFF" },
  ])("returns only validated text candidates for the $name surface", ({ accent, surfaces, fallback }) => {
    const safe = contrastSafeTextAccent(accent, surfaces, fallback);
    expect(Math.min(...surfaces.map((surface) => contrastRatio(safe, surface)))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps clear-day NOW text safe in the rendered card and holiday tabs readable in the modal", async () => {
    const helpers = await import("@/components/ui/WeatherSkins") as unknown as {
      contrastSafeTextAccent?: (accent: string, surface: string | string[], fallback: string) => string;
    };
    expect(typeof helpers.contrastSafeTextAccent).toBe("function");
    if (typeof helpers.contrastSafeTextAccent !== "function") return;
    localStorage.setItem("home-ai-weather-config", JSON.stringify({ timeOfDay: "day", season: "summer", holidayOverride: "christmas" }));
    try {
      const payload = makeOpenMeteoPayload({ code: 0, cloud: 0 });
      mockOpenMeteo(payload);
      const el = render(<WeatherWidget />);
      await settle();
      const now = Array.from(el.querySelectorAll<HTMLElement>("span")).find((node) => node.textContent === "NOW");
      expect(now).toBeTruthy();
      const nowColor = now!.style.color;
      expect(Math.min(...["#55BCE8", "#8FD8F1", "#D8F2F4"].map((surface) => contrastRatio(nowColor, surface)))).toBeGreaterThanOrEqual(4.5);

      act(() => findDetailsButton(el)!.click());
      await settle();
      const dialog = document.querySelector("#weather-details-dialog") as HTMLElement;
      const activeTab = dialog.querySelector('[role="tab"][aria-selected="true"]') as HTMLElement;
      expect(contrastRatio(activeTab.style.color, activeTab.style.background)).toBeGreaterThanOrEqual(4.5);
    } finally {
      localStorage.removeItem("home-ai-weather-config");
    }
  });

  it("re-derives a holiday modal accent when clear scrubs to storm", async () => {
    localStorage.setItem("home-ai-weather-config", JSON.stringify({ timeOfDay: "auto", season: "auto", holidayOverride: "christmas" }));
    try {
      const payload = makeOpenMeteoPayload({ code: 0, cloud: 10 });
      const start = payload.hourly.time.findIndex((time) => new Date(time).getTime() >= Date.now() - 59 * 60_000);
      const first = start < 0 ? 0 : start;
      payload.hourly.weather_code[first] = 0;
      payload.hourly.weather_code[first + 1] = 95;
      mockOpenMeteo(payload);
      const el = render(<WeatherWidget />);
      await settle();
      act(() => findDetailsButton(el)!.click());

      const dialog = document.querySelector("#weather-details-dialog") as HTMLElement;
      const activeTab = () => dialog.querySelector('[role="tab"][aria-selected="true"]') as HTMLElement;
      expect(activeTab().style.background).toContain("239, 68, 68");
      const scrubber = dialog.querySelector('[role="slider"][aria-label="Scrub through the next 24 hours"]') as HTMLElement;
      act(() => scrubber.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
      expect(activeTab().style.background).toContain("255, 180, 79");
      act(() => scrubber.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
      expect(activeTab().style.background).toContain("239, 68, 68");
    } finally {
      localStorage.removeItem("home-ai-weather-config");
    }
  });

  it("re-derives a clear modal accent when storm scrubs back to clear", async () => {
    const payload = makeOpenMeteoPayload({ code: 95, cloud: 80 });
    const start = payload.hourly.time.findIndex((time) => new Date(time).getTime() >= Date.now() - 59 * 60_000);
    const first = start < 0 ? 0 : start;
    payload.hourly.weather_code[first] = 95;
    payload.hourly.weather_code[first + 1] = 0;
    mockOpenMeteo(payload);
    const el = render(<WeatherWidget />);
    await settle();
    act(() => findDetailsButton(el)!.click());

    const dialog = document.querySelector("#weather-details-dialog") as HTMLElement;
    const activeTab = () => dialog.querySelector('[role="tab"][aria-selected="true"]') as HTMLElement;
    expect(activeTab().style.background).toContain("255, 180, 79");
    const scrubber = dialog.querySelector('[role="slider"][aria-label="Scrub through the next 24 hours"]') as HTMLElement;
    act(() => scrubber.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(activeTab().style.background).not.toContain("255, 180, 79");
  });

  it.each([
    { name: "hidden tab", hidden: true, reducedMotion: false },
    { name: "reduced motion", hidden: false, reducedMotion: true },
  ])("starts ambient and holiday motion disabled when mounted in a $name environment", async ({ hidden, reducedMotion }) => {
    const descriptor = Object.getOwnPropertyDescriptor(document, "hidden");
    Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: reducedMotion,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })));
    localStorage.setItem("home-ai-weather-config", JSON.stringify({ timeOfDay: "day", season: "autumn", holidayOverride: "halloween" }));
    try {
      mockOpenMeteo(makeOpenMeteoPayload({ code: 0, cloud: 10 }));
      let initialMotion: string | null = null;
      const capture = () => {
        initialMotion = document.querySelector('[data-testid="wx-scene-layers"]')?.getAttribute("data-motion") ?? null;
      };
      render(
        <>
          <WeatherWidget />
          <LayoutMotionCapture capture={capture} />
        </>
      );

      expect(initialMotion).toBe("paused");
      await settle(300);
      const art = document.querySelector("[data-weather-art-motion]") as HTMLElement | null;
      const particles = document.querySelector("[data-weather-particle-motion]") as HTMLElement | null;
      expect(art?.getAttribute("data-weather-art-motion")).toBe("paused");
      if (hidden) {
        expect(particles).toBeNull();
      } else {
        expect(particles?.getAttribute("data-weather-particle-motion")).toBe("paused");
      }
    } finally {
      if (descriptor) Object.defineProperty(document, "hidden", descriptor);
      else delete (document as any).hidden;
      localStorage.removeItem("home-ai-weather-config");
    }
  });

  it("keeps the first hydrated scene motion snapshot paused until readiness", async () => {
    const serverMedia = (matches: boolean) => ({
      matches,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    });
    vi.stubGlobal("matchMedia", vi.fn(() => serverMedia(false)));
    let captured: string | null = null;
    const container = document.createElement("div");
    const capture = () => {
      captured = container.querySelector('[data-testid="wx-scene-layers"]')?.getAttribute("data-motion") ?? null;
    };
    const ui = (
      <>
        <SceneLayers scene="clear" showFog={false} showBirds={false} cloudCover={20} precipitation={0} wind={0} />
        <LayoutMotionCapture capture={capture} />
      </>
    );
    const serverHtml = renderToString(ui);
    expect(serverHtml).toContain('data-motion="paused"');
    container.innerHTML = serverHtml;
    document.body.appendChild(container);
    vi.stubGlobal("matchMedia", vi.fn(() => serverMedia(true)));
    const recoverableErrors: unknown[] = [];
    let hydrationRoot: ReturnType<typeof hydrateRoot> | null = null;
    try {
      await act(async () => {
        hydrationRoot = hydrateRoot(container, ui, { onRecoverableError: (error) => recoverableErrors.push(error) });
        await Promise.resolve();
      });
      expect(recoverableErrors).toEqual([]);
      expect(captured).toBe("paused");
    } finally {
      act(() => hydrationRoot?.unmount());
      container.remove();
    }
  });

  it("pauses ambient poster motion while the tab is hidden", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })));
    mockOpenMeteo(makeOpenMeteoPayload({ code: 0, cloud: 10 }));
    const el = render(<WeatherWidget />);
    await settle();
    const scene = el.querySelector('[data-testid="wx-scene-layers"]') as HTMLElement;
    const birds = scene.querySelector('[data-testid="wx-birds"]') as HTMLElement;
    expect(scene.getAttribute("data-motion")).toBe("running");
    expect(birds.style.transition).toBe("opacity 1.2s ease");

    const descriptor = Object.getOwnPropertyDescriptor(document, "hidden");
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    try {
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      await settle();
      expect(scene.getAttribute("data-motion")).toBe("paused");
      expect(birds.style.transition).toBe("none");
      expect(scene.querySelector('[data-weather-shape="sun"]')?.parentElement?.getAttribute("style") ?? "").not.toContain("wxFadeIn");
    } finally {
      if (descriptor) Object.defineProperty(document, "hidden", descriptor);
      else delete (document as any).hidden;
    }
  });

  it("pauses holiday season artwork when the tab is hidden", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })));
    localStorage.setItem("home-ai-weather-config", JSON.stringify({ timeOfDay: "day", season: "autumn", holidayOverride: "halloween" }));
    try {
      mockOpenMeteo(makeOpenMeteoPayload({ code: 0, cloud: 10 }));
      const el = render(<WeatherWidget />);
      await settle(250);
      const art = el.querySelector("[data-weather-art-motion]") as HTMLElement | null;
      expect(art).toBeTruthy();
      expect(art!.getAttribute("data-weather-art-motion")).toBe("running");
      const descriptor = Object.getOwnPropertyDescriptor(document, "hidden");
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      try {
        act(() => document.dispatchEvent(new Event("visibilitychange")));
        await settle();
        expect(art!.getAttribute("data-weather-art-motion")).toBe("paused");
        expect(art!.querySelector("animate")).toBeNull();
      } finally {
        if (descriptor) Object.defineProperty(document, "hidden", descriptor);
        else delete (document as any).hidden;
      }
    } finally {
      localStorage.removeItem("home-ai-weather-config");
    }
  });

  it("removes the bird opacity transition under reduced motion", () => {
    const el = renderSceneProps({ scene: "clear", showFog: false, showBirds: true, cloudCover: 10, precipitation: 0, wind: 8 });
    const birds = el.querySelector('[data-testid="wx-birds"]') as HTMLElement;
    expect(birds.style.transition).toBe("none");
  });
  it("passes the selected hour measurements into the card poster", async () => {
    const payload = makeOpenMeteoPayload({ code: 0, precip: 80, cloud: 40 });
    const start = payload.hourly.time.findIndex((time) => new Date(time).getTime() >= Date.now() - 59 * 60_000);
    const first = start < 0 ? 0 : start;
    payload.hourly.weather_code[first] = 0;
    payload.hourly.weather_code[first + 1] = 61;
    mockOpenMeteo(payload);
    const el = render(<WeatherWidget />);
    await settle();

    const strip = el.querySelector('[role="slider"][aria-label="Preview the rest of the day"]') as HTMLElement;
    act(() => strip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    const scene = el.querySelector('[data-testid="wx-scene-layers"]') as HTMLElement;
    expect(scene.getAttribute("data-scene")).toBe("rain");
    expect(scene.getAttribute("data-precipitation")).toBe("80");
    expect(scene.getAttribute("data-wind")).toBe("8");
    expect(scene.getAttribute("data-sun-progress")).not.toBe("unavailable");
  });
  it("switches to the night sky when the API reports is_day=0", async () => {
    mockOpenMeteo(makeOpenMeteoPayload({ isDay: 0 }));
    const el = render(<WeatherWidget />);
    await settle();

    const activeSky = el.querySelector('.wx-sky[data-active="true"]') as HTMLElement | null;
    expect(activeSky).toBeTruthy();
    // toy night: lightened dusk wash (slate-800 ink passes AA at every stop)
    expect(activeSky!.className).toContain("from-[#6f74a8]");
    // night text ink follows the toy sky: slate-800, not the old white-on-lilac
    const heroTemp = el.querySelector('[data-testid="wx-hero-temp"]') as HTMLElement | null;
    expect(heroTemp).toBeTruthy();
    expect(heroTemp!.style.color).toBe("rgb(30, 41, 59)");
  });

  it.each(["light", "dark"] as const)("keeps the card night and storm ink readable in the %s theme", async (theme) => {
    document.documentElement.dataset.theme = theme;
    try {
      for (const scene of [
        { code: 0, isDay: 0, stops: ["#6f74a8", "#a29dc9", "#e2dbf2"], ink: "#1E293B", softOpacity: 0.78 },
        { code: 95, isDay: 1, stops: ["#6a6f96", "#5d5b8f", "#4d4770"], ink: "#FFFFFF", softOpacity: 0.95 },
      ]) {
        mockOpenMeteo(makeOpenMeteoPayload({ code: scene.code, isDay: scene.isDay }));
        const el = render(<WeatherWidget />);
        await settle();
        const hero = el.querySelector('[data-testid="wx-hero-temp"]') as HTMLElement;
        const soft = hero.nextElementSibling as HTMLElement;
        expect(hero.style.color).toBe(scene.ink === "#FFFFFF" ? "rgb(255, 255, 255)" : "rgb(30, 41, 59)");
        expect(el.querySelector('[data-testid="wx-card-scrim"]')?.getAttribute("style")).toContain(scene.code === 95 ? "rgba(6, 6, 9, 0.4)" : "rgba(255, 255, 255, 0.45)");
        const scrimOpacity = scene.code === 95 ? 0.4 : 0.45;
        const scrimColor = scene.code === 95 ? "#060609" : "#FFFFFF";
        const minimum = Math.min(...scene.stops.map((background) =>
          effectiveContrast(scene.ink, 1, compositeHex(scrimColor, background, scrimOpacity))
        ));
        const minimumSoft = Math.min(...scene.stops.map((background) =>
          effectiveContrast(scene.ink, scene.softOpacity, compositeHex(scrimColor, background, scrimOpacity))
        ));
        expect(minimum).toBeGreaterThanOrEqual(4.5);
        expect(minimumSoft).toBeGreaterThanOrEqual(4.5);
        expect(soft.style.color).toContain(scene.ink === "#FFFFFF" ? "255, 255, 255" : "30, 41, 59");
      }
    } finally {
      delete document.documentElement.dataset.theme;
    }
  });
  it.each(["light", "dark"] as const)("keeps storm header chrome readable over the actual glass composite in the %s theme", async (theme) => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("home-ai-weather-config", JSON.stringify({ timeOfDay: "day", season: "summer", holidayOverride: "christmas" }));
    try {
      mockOpenMeteo(makeOpenMeteoPayload({ code: 95 }));
      const el = render(<WeatherWidget />);
      await settle();
      const hero = el.querySelector('[data-testid="wx-hero-temp"]') as HTMLElement;
      const location = Array.from(el.querySelectorAll<HTMLElement>("span")).find(
        (node) => node.className.includes("relative") && node.className.includes("truncate")
      );
      const locationChip = location?.parentElement;
      const details = findDetailsButton(el);
      const holiday = Array.from(el.querySelectorAll<HTMLElement>("span")).find(
        (node) => node.className.includes("uppercase") && node.textContent?.includes("Christmas")
      );
      const surfaces = stormHeaderSurfaces();
      const holidaySurfaces = surfaces.map((surface) => compositeHex("#ef4444", surface, 0x22 / 255));

      expect(hero.style.color).toBe("rgb(255, 255, 255)");
      expect(location).toBeTruthy();
      expect(locationChip?.className).toContain("bg-white/40");
      expect(locationChip?.className).toContain("before:from-white/40");
      expect(details?.className).toContain("bg-white/40");
      expect(details?.className).toContain("before:from-white/40");
      expect(holiday).toBeTruthy();
      if (!location || !details || !holiday) return;

      expect(location.style.color).not.toBe(hero.style.color);
      expect(Math.min(...surfaces.map((surface) => contrastRatio(location.style.color, surface)))).toBeGreaterThanOrEqual(4.5);
      expect(Math.min(...surfaces.map((surface) => contrastRatio(details.style.color, surface)))).toBeGreaterThanOrEqual(4.5);
      expect(
        Math.min(...holidaySurfaces.map((surface) => contrastRatio(holiday.style.color, surface))),
        JSON.stringify({ holidayInk: holiday.style.color, surfaces, holidaySurfaces })
      ).toBeGreaterThanOrEqual(4.5);
    } finally {
      delete document.documentElement.dataset.theme;
      localStorage.removeItem("home-ai-weather-config");
    }
  });

  it("derives failed-fetch header chrome against the overlay composite", async () => {
    vi.useFakeTimers();
    localStorage.setItem("home-ai-weather-config", JSON.stringify({ timeOfDay: "day", season: "autumn", holidayOverride: "none" }));
    try {
      vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));
      const el = render(<WeatherWidget />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      const location = Array.from(el.querySelectorAll<HTMLElement>("span")).find(
        (node) => node.className.includes("relative") && node.className.includes("truncate")
      );
      const details = findDetailsButton(el);
      const surfaces = failedFetchHeaderSurfaces();
      expect(location).toBeTruthy();
      expect(details).toBeTruthy();
      expect(Math.min(...surfaces.map((surface) => contrastRatio(location!.style.color, surface)))).toBeGreaterThanOrEqual(4.5);
      expect(Math.min(...surfaces.map((surface) => contrastRatio(details!.style.color, surface)))).toBeGreaterThanOrEqual(4.5);
    } finally {
      vi.useRealTimers();
      localStorage.removeItem("home-ai-weather-config");
    }
  });

  it("keeps forced-night modal text on a readable light-scrim treatment", async () => {
    localStorage.setItem("home-ai-weather-config", JSON.stringify({ timeOfDay: "night" }));
    try {
      mockOpenMeteo(makeOpenMeteoPayload({ isDay: 1 }));
      const el = render(<WeatherWidget />);
      await settle();

      act(() => findDetailsButton(el)!.click());
      const dialog = document.querySelector("#weather-details-dialog") as HTMLElement;
      const activeSky = dialog.querySelector('.wx-sky[data-active="true"]') as HTMLElement;
      const heroInk = dialog.querySelector('[data-testid="wx-modal-hero-ink"]') as HTMLElement | null;
      const heroTemp = Array.from(dialog.querySelectorAll<HTMLElement>("span")).find((node) => node.className.includes("text-[60px]"));
      const degree = heroTemp?.nextElementSibling as HTMLElement | undefined;

      expect(activeSky.className).toContain("from-[#6f74a8]");
      expect(heroTemp).toBeTruthy();
      if (!heroTemp) return;
      expect(heroTemp.style.color).toBe("rgb(30, 41, 59)");
      expect(degree).toBeTruthy();
      expect(degree!.style.color).toBe("rgba(30, 41, 59, 0.78)");
      expect(heroInk).toBeTruthy();
      expect(heroInk!.style.backgroundColor).toBe("rgba(255, 255, 255, 0.45)");
      const nightStops = ["#6f74a8", "#a29dc9", "#e2dbf2"];
      const minimumHeroContrast = Math.min(...nightStops.map((background) =>
        effectiveContrast("#1E293B", 1, compositeHex("#FFFFFF", background, 0.45))
      ));
      const minimumSoftContrast = Math.min(...nightStops.map((background) =>
        effectiveContrast("#1E293B", 0.78, compositeHex("#FFFFFF", background, 0.45))
      ));
      expect(minimumHeroContrast).toBeGreaterThanOrEqual(4.5);
      expect(minimumSoftContrast).toBeGreaterThanOrEqual(4.5);
    } finally {
      localStorage.removeItem("home-ai-weather-config");
    }
  });

  it("renders a storm-violet sky and storm copy when a thunderstorm code arrives", async () => {
    mockOpenMeteo(makeOpenMeteoPayload({ code: 95 }));
    const el = render(<WeatherWidget />);
    await settle();

    const activeSky = el.querySelector('.wx-sky[data-active="true"]') as HTMLElement | null;
    expect(activeSky).toBeTruthy();
    // storm wash, not the clear pastel
    expect(activeSky!.className).toContain("from-[#6a6f96]");
    expect(activeSky!.className).not.toContain("from-[#bfe3ff]");
    // storm keeps WHITE ink — the deepened wash passes AA at every stop
    const heroTemp = el.querySelector('[data-testid="wx-hero-temp"]') as HTMLElement | null;
    expect(heroTemp).toBeTruthy();
    expect(heroTemp!.style.color).toBe("rgb(255, 255, 255)");
    // every mocked hour is stormy, so "clearing time unknown" is the honest line
    expect(el.textContent).toContain("Thunderstorms — inside is best right now");
    expect(el.textContent).toContain("Clearing time unknown");
  });

  it("announces the storm clearing time when the hourly data shows it ending", async () => {
    const payload = makeOpenMeteoPayload({ code: 95 });
    // first 3 hours stay stormy (95), then it clears (code 1)
    payload.hourly.weather_code = payload.hourly.weather_code.map((c, i) => (i <= 3 ? 95 : 1));
    mockOpenMeteo(payload);
    const el = render(<WeatherWidget />);
    await settle();

    expect(el.textContent).toContain("Thunderstorms — inside is best right now");
    expect(el.textContent).toContain("Clearing by around");
  });

  it("treats heavy snow as severe: advisory pill + slate sky", async () => {
    mockOpenMeteo(makeOpenMeteoPayload({ code: 75 }));
    const el = render(<WeatherWidget />);
    await settle();

    expect(el.textContent).toContain("Big snow today — boots by the door");
    expect(el.textContent).not.toContain("Raincoats ready");
    const activeSky = el.querySelector('.wx-sky[data-active="true"]') as HTMLElement | null;
    // toy snow wash, not the clear pastel
    expect(activeSky!.className).toContain("from-[#f4f7fb]");
  });

  it("keeps the Try again recovery tappable inside the pointer-events-none overlay", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("api.open-meteo.com")) return Promise.reject(new Error("network down"));
        return Promise.reject(new Error("no network"));
      }));

      const el = render(<WeatherWidget />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      const retry = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("Try again"));
      expect(retry).toBeTruthy();
      // the regression: without pointer-events-auto, real taps hit the fog layer
      expect(retry!.className).toContain("pointer-events-auto");
    } finally {
      vi.useRealTimers();
    }
  });

  it("pins the preview on tap and releases it via Back to now", async () => {
    mockOpenMeteo(makeOpenMeteoPayload());
    const el = render(<WeatherWidget />);
    await settle();

    const strip = el.querySelector('[role="slider"][aria-label="Preview the rest of the day"]') as HTMLElement;
    expect(strip).toBeTruthy();

    const pointerAt = (type: string, x: number) => {
      const e = new Event(type, { bubbles: true });
      Object.assign(e, { clientX: x, clientY: 0, pointerId: 1 });
      strip.dispatchEvent(e);
    };
    const lastIdx = () => {
      const max = Number(strip.getAttribute("aria-valuemax"));
      return max;
    };

    // tap (down + up at the same x, no horizontal intent) → pins the last hour
    // Use a large x so idxFromClientX clamps to hours.length - 1 in jsdom (no real layout)
    act(() => { pointerAt("pointerdown", 9999); });
    act(() => { pointerAt("pointerup", 9999); });
    await settle();
    expect(strip.getAttribute("aria-valuenow")).toBe(String(lastIdx()));

    // pinned: no 650ms auto-revert
    await settle(800);
    expect(strip.getAttribute("aria-valuenow")).toBe(String(lastIdx()));

    // "Back to now" chip visible → releases
    const back = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("Back to now"));
    expect(back).toBeTruthy();
    act(() => back!.click());
    await settle(800);
    expect(strip.getAttribute("aria-valuenow")).toBe("0");
    expect(Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("Back to now"))).toBeUndefined();
  });

  it("maps a tap to the hour actually touched — a mid-strip x pins hour 4, not the last hour", async () => {
    // Pinned mid-day payload: the real-clock start made the strip shrink with
    // the time of day (a 1 AM run left only hours 0-3 and the 9999-style
    // clamp hid the pitch math entirely).
    mockOpenMeteo(makeOpenMeteoPayload({ startAt: "2026-09-21T12:00:00Z" }));
    const el = render(<WeatherWidget />);
    await settle();

    const strip = el.querySelector('[role="slider"][aria-label="Preview the rest of the day"]') as HTMLElement;
    expect(strip).toBeTruthy();

    // jsdom has no real layout (getBoundingClientRect → 0s, scrollLeft 0), so
    // a scroll container mock makes x → index deterministic: with the strip
    // scrolled 1 cell off, x=300 lands at floor((300 + 60) / 60) = 6. The
    // STRIP_PITCH division (56 + 4 gap) is the contract under test.
    const scroller = strip.querySelector(".scrollbar-hide") as HTMLElement;
    expect(scroller).toBeTruthy();
    const realGBCR = scroller.getBoundingClientRect.bind(scroller);
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({ ...realGBCR(), left: 0, width: 340 });
    (scroller as HTMLElement & { scrollLeft: number }).scrollLeft = 60;

    const pointerAt = (type: string, x: number) => {
      const e = new Event(type, { bubbles: true });
      Object.assign(e, { clientX: x, clientY: 0, pointerId: 1 });
      strip.dispatchEvent(e);
    };
    act(() => { pointerAt("pointerdown", 300); });
    act(() => { pointerAt("pointerup", 300); });
    await settle();

    expect(strip.getAttribute("aria-valuenow")).toBe("6");
  });

  it("shows the tappable Try again action when the first fetch fails", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("api.open-meteo.com")) return Promise.reject(new Error("network down"));
        return Promise.reject(new Error("no network"));
      }));

      const el = render(<WeatherWidget />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(el.textContent).toContain("Weather unavailable");

      const retry = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("Try again"));
      expect(retry).toBeTruthy();

      // wire success, tap retry → banner clears and data lands
      vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("api.open-meteo.com")) return Promise.resolve({ json: () => Promise.resolve(makeOpenMeteoPayload()) });
        return Promise.reject(new Error("no network"));
      }));
      await act(async () => { retry!.click(); await vi.advanceTimersByTimeAsync(0); });
      expect(el.textContent).toContain("H:75°");
      expect(el.textContent).not.toContain("Weather unavailable");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an em-dash hero instead of a fabricated temperature when the API omits it", async () => {
    const payload = makeOpenMeteoPayload();
    (payload.current as Record<string, unknown>).temperature_2m = null;
    (payload.current as Record<string, unknown>).apparent_temperature = null;
    (payload.daily as Record<string, unknown>).temperature_2m_max = [null, 76, 77, 78, 79, 80];
    (payload.daily as Record<string, unknown>).temperature_2m_min = [null, 59, 60, 61, 62, 63];
    mockOpenMeteo(payload);
    const el = render(<WeatherWidget />);
    await settle();

    // no invented 60°/72° — honest "—", no feels-like fiction, and today's
    // H/L row drops entirely instead of fabricating values
    expect(el.textContent).toContain("—");
    expect(el.textContent).not.toContain("Feels like");
    expect(el.textContent).not.toContain("H:");
  });

  it("keeps a null selected-hour temperature unavailable beside a valid current temperature", async () => {
    const payload = makeOpenMeteoPayload();
    const start = payload.hourly.time.findIndex((time) => new Date(time).getTime() >= Date.now() - 59 * 60_000);
    const selected = Math.min((start < 0 ? 0 : start) + 1, payload.hourly.time.length - 1);
    (payload.hourly as any).temperature_2m[selected] = null;
    mockOpenMeteo(payload);
    const el = render(<WeatherWidget />);
    await settle();

    expect(el.querySelector('[data-testid="wx-hero-temp"]')?.textContent).toBe("70");
    const strip = el.querySelector('[role="slider"][aria-label="Preview the rest of the day"]') as HTMLElement;
    act(() => strip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));

    const cardHero = el.querySelector('[data-testid="wx-hero-temp"]') as HTMLElement;
    expect(cardHero.textContent).toBe("—");
    expect(cardHero.nextElementSibling).toBeNull();
    expect(strip.getAttribute("aria-valuetext")).toContain("temperature unavailable");
    const cardCell = strip.querySelector("[data-selected]") as HTMLElement;
    expect(Array.from(cardCell.querySelectorAll<HTMLElement>("span")).some((node) => node.textContent === "—")).toBe(true);

    act(() => findDetailsButton(el)!.click());
    await settle();
    const dialog = document.querySelector("#weather-details-dialog") as HTMLElement;
    const scrubber = dialog.querySelector('[role="slider"][aria-label="Scrub through the next 24 hours"]') as HTMLElement;
    act(() => scrubber.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));

    const modalHero = Array.from(dialog.querySelectorAll<HTMLElement>("span")).find((node) => node.className.includes("text-[60px]"));
    expect(modalHero?.textContent).toBe("—");
    expect(modalHero?.nextElementSibling).toBeNull();
    expect(scrubber.getAttribute("aria-valuetext")).toContain("temperature unavailable");
    const modalCells = dialog.querySelectorAll<HTMLButtonElement>('[role="list"] [role="listitem"] button');
    const selectedCell = modalCells[1];
    expect(selectedCell.getAttribute("aria-label")).toContain("temperature unavailable");
    expect(Array.from(selectedCell.querySelectorAll<HTMLElement>("span")).some((node) => node.textContent === "—")).toBe(true);
  });

  it("omits the modal temperature when current and hourly temperatures are unavailable", async () => {
    const payload = makeOpenMeteoPayload();
    (payload.current as Record<string, unknown>).temperature_2m = null;
    (payload.current as Record<string, unknown>).apparent_temperature = null;
    (payload.hourly as Record<string, unknown>).temperature_2m = payload.hourly.time.map(() => null);
    mockOpenMeteo(payload);
    const el = render(<WeatherWidget />);
    await settle();

    act(() => findDetailsButton(el)!.click());
    await settle();

    const dialog = document.querySelector("#weather-details-dialog") as HTMLElement;
    const temperature = Array.from(dialog.querySelectorAll<HTMLElement>("span")).find((node) => node.className.includes("text-[60px]"));
    const scrubber = dialog.querySelector('[role="slider"][aria-label="Scrub through the next 24 hours"]') as HTMLElement;
    expect(temperature).toBeTruthy();
    expect(temperature!.textContent).toBe("—");
    expect(temperature!.nextElementSibling).toBeNull();
    expect(scrubber).toBeTruthy();
    const firstCell = dialog.querySelector('[role="list"] [role="listitem"] button') as HTMLButtonElement;
    expect(firstCell.getAttribute("aria-label")).toContain("temperature unavailable");
    expect(Array.from(firstCell.querySelectorAll<HTMLElement>("span")).some((node) => node.textContent === "—")).toBe(true);
    expect(dialog.textContent).not.toContain("0°");
  });

  it("promotes a calendar-fused rain note into the tinted pill when an event lines up", async () => {
    // rain hits the next hour boundary; the family event sits on that hour
    const payload = makeOpenMeteoPayload();
    payload.hourly.precipitation_probability = payload.hourly.precipitation_probability.map((p, i) => (i >= 1 ? 70 : p));
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    const hh = String(nextHour.getHours()).padStart(2, "0");
    const mm = String(nextHour.getMinutes()).padStart(2, "0");
    dbEventsMock.splice(0, dbEventsMock.length, {
      id: 1,
      title: "Soccer Practice",
      time: `${hh}:${mm}`,
      date: nextHour.toISOString().split("T")[0],
      member: "Emily",
      icon: "⚽",
    });
    mockOpenMeteo(payload);
    const el = render(<WeatherWidget />);
    await settle();

    expect(el.textContent).toContain("Rain around Soccer Practice");
    const pill = Array.from(el.querySelectorAll("div")).find(
      (d) => d.className.includes("rounded-2xl") && d.textContent?.includes("Rain around Soccer Practice")
    );
    expect(pill).toBeTruthy(); // promoted out of the flat text stack
    // wear line cedes to the fusion answer (one stronger line, not both)
    expect(el.textContent).not.toContain("Raincoats ready");
    dbEventsMock.length = 0;
  });

  it("modal scrubber exposes spoken value text and UV dots render for the current hour", async () => {
    mockOpenMeteo(makeOpenMeteoPayload());
    const el = render(<WeatherWidget />);
    await settle();

    const button = findDetailsButton(el);
    act(() => button!.click());

    const scrubber = document.querySelector('[role="slider"][aria-label="Scrub through the next 24 hours"]');
    expect(scrubber).toBeTruthy();
    expect(scrubber!.getAttribute("aria-valuetext")).toContain("degrees");

    expect(document.body.textContent).toContain("UV index");
    const uvRow = Array.from(document.querySelectorAll('[aria-label^="UV index"]'));
    expect(uvRow.length).toBe(1);
  });

  it("keeps the modal scrubber and spoken timeline value intact through a scene change", async () => {
    const payload = makeOpenMeteoPayload({ code: 0, cloud: 10 });
    payload.hourly.weather_code = payload.hourly.weather_code.map((_, i) => (i <= 1 ? 0 : 71));
    mockOpenMeteo(payload);
    const el = render(<WeatherWidget />);
    await settle();

    act(() => findDetailsButton(el)!.click());
    const dialog = document.querySelector("#weather-details-dialog") as HTMLElement;
    const scrubber = dialog.querySelector('[role="slider"][aria-label="Scrub through the next 24 hours"]') as HTMLElement;
    expect(scrubber.getAttribute("aria-valuenow")).toBe("0");

    act(() => {
      scrubber.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });

    expect(scrubber.getAttribute("aria-valuenow")).toBe("1");
    expect(scrubber.getAttribute("aria-valuetext")).toContain("degrees");
    expect(dialog.querySelector('[data-testid="wx-scene-layers"]')?.getAttribute("data-scene")).toBe("snow");
    expect((dialog.querySelector('.wx-sky[data-active="true"]') as HTMLElement).className).toContain("from-[#f4f7fb]");
  });

  it("renders fog from real low visibility even with moderate humidity", async () => {
    mockOpenMeteo(makeOpenMeteoPayload({ visibility: 800 }));
    const el = render(<WeatherWidget />);
    await settle();
    expect(el.querySelector('[data-testid="wx-fog"]')).toBeTruthy();
  });

  it("renders no fog when visibility is clear", async () => {
    mockOpenMeteo(makeOpenMeteoPayload({ visibility: 16000 }));
    const el = render(<WeatherWidget />);
    await settle();
    expect(el.querySelector('[data-testid="wx-fog"]')).toBeNull();
  });

  it("renders the clay crescent moon in the night scene", async () => {
    mockOpenMeteo(makeOpenMeteoPayload({ isDay: 0 }));
    const el = render(<WeatherWidget />);
    await settle();
    // The card hero is a clay crescent now (disc + sky-colored offset
    // bite), not the WeatherScene terminator path (the modal keeps that).
    const moon = el.querySelector('[data-testid="wx-moon"]');
    expect(moon).toBeTruthy();
    expect(moon!.querySelectorAll("div").length).toBe(2);
  });

  it("maps clear-sky cloud visibility to 0% and 100% cover", () => {
    const clearSky = render(<SceneLayers scene="clear" showFog={false} showBirds={false} cloudCover={0} />);
    const clearSkyClouds = Array.from(clearSky.querySelectorAll<HTMLElement>("[data-cloud-layer]"));
    expect(clearSkyClouds.map((cloud) => cloud.style.opacity)).toEqual(["0", "0"]);

    const coveredSky = render(<SceneLayers scene="clear" showFog={false} showBirds={false} cloudCover={100} />);
    const coveredSkyClouds = Array.from(coveredSky.querySelectorAll<HTMLElement>("[data-cloud-layer]"));
    expect(coveredSkyClouds.every((cloud) => Number(cloud.style.opacity) > 0)).toBe(true);
  });

  it.each([
    { code: 1, cloud: 0 },
    { code: 2, cloud: 0 },
    { code: 1, cloud: 40 },
    { code: 2, cloud: 40 },
  ])("keeps WMO $code condition icons truthful at $cloud percent cloud cover in the card and modal", async ({ code, cloud }) => {
    mockOpenMeteo(makeOpenMeteoPayload({ code, cloud }));
    const el = render(<WeatherWidget />);
    await settle();

    const cardCondition = el.querySelector('[data-testid="wx-hero-icon"]')?.firstElementChild ?? null;
    expect(conditionShowsCloud(cardCondition)).toBe(cloud > 0);

    act(() => findDetailsButton(el)!.click());
    await settle();
    const dialog = document.querySelector("#weather-details-dialog") as HTMLElement;
    expect(conditionShowsCloud(modalCondition(dialog))).toBe(cloud > 0);
  });

  it("keeps missing cloud cover unavailable without inventing clouds or birds", async () => {
    mockOpenMeteo(makeOpenMeteoPayload({ code: 1, cloud: null }));
    const el = render(<WeatherWidget />);
    await settle();

    const cardScene = el.querySelector('[data-testid="wx-scene-layers"]') as HTMLElement;
    const cardClouds = cardScene.querySelector('[data-testid="wx-poster-clouds"]') as HTMLElement;
    expect(cardClouds.getAttribute("data-cloud-cover")).toBe("unavailable");
    expect(Array.from(cardClouds.querySelectorAll<HTMLElement>("[data-cloud-layer]")).map((cloud) => cloud.style.opacity)).toEqual(["0", "0"]);
     expect(conditionShowsCloud(el.querySelector('[data-testid="wx-hero-icon"]')?.firstElementChild ?? null)).toBe(true);
     expect(el.textContent).toContain("Partly Cloudy");
     expect((el.querySelector('[data-testid="wx-birds"]') as HTMLElement).style.opacity).toBe("0");

    act(() => findDetailsButton(el)!.click());
    await settle();
    const dialog = document.querySelector("#weather-details-dialog") as HTMLElement;
    const modalScene = dialog.querySelector('[data-testid="wx-scene-layers"]') as HTMLElement;
    const modalClouds = modalScene.querySelector('[data-testid="wx-poster-clouds"]') as HTMLElement;
    expect(modalClouds.getAttribute("data-cloud-cover")).toBe("unavailable");
    expect(Array.from(modalClouds.querySelectorAll<HTMLElement>("[data-cloud-layer]")).map((cloud) => cloud.style.opacity)).toEqual(["0", "0"]);
     expect(conditionShowsCloud(modalCondition(dialog))).toBe(true);
     expect(dialog.textContent).toContain("Partly Cloudy");
     expect((dialog.querySelector('[data-testid="wx-birds"]') as HTMLElement).style.opacity).toBe("0");
    expect(dialog.textContent).not.toContain("Cloud cover");
  });

  it.each([0, null])("keeps zero or unknown clouds and disallowed birds unavailable under high contrast (%s)", (cover) => {
    const boostStyle = document.createElement("style");
    boostStyle.textContent = '[data-contrast="boost"] * { opacity: 1 !important; }';
    document.head.appendChild(boostStyle);
    document.documentElement.dataset.contrast = "boost";
    try {
      const el = renderSceneProps({
        scene: "clear",
        showFog: false,
        showBirds: false,
        cloudCover: cover,
        precipitation: 0,
        wind: 0,
      });
      const clouds = el.querySelector('[data-testid="wx-poster-clouds"]') as HTMLElement;
      const layers = Array.from(clouds.querySelectorAll<HTMLElement>("[data-cloud-layer]"));
      const birds = el.querySelector('[data-testid="wx-birds"]') as HTMLElement;

      expect(clouds.getAttribute("data-visible")).toBe("false");
      expect(layers).toHaveLength(2);
      expect(layers.every((layer) => getComputedStyle(layer).opacity === "1")).toBe(true);
      expect(layers.every((layer) => getComputedStyle(layer).visibility === "hidden")).toBe(true);
      expect(birds.getAttribute("data-visible")).toBe("false");
      expect(getComputedStyle(birds).opacity).toBe("1");
      expect(getComputedStyle(birds).visibility).toBe("hidden");
    } finally {
      delete document.documentElement.dataset.contrast;
      boostStyle.remove();
    }
  });

  it("keeps cloudy, rain, and snow poster accents visibly distinct", () => {
    const cases = [
      { scene: "cloudy" as const, shape: "cloud-bars", background: "#EEF1F6" },
      { scene: "rain" as const, shape: "rain-diamonds", background: "#C9D7EA" },
      { scene: "snow" as const, shape: "snow-diamonds", background: "#E6EFFF" },
    ];
    const results = cases.map(({ scene, shape, background }) => {
      const el = render(<SceneLayers scene={scene} showFog={false} showBirds={false} cloudCover={80} precipitation={80} />);
      const accent = el.querySelector<SVGElement>(`[data-weather-shape="${shape}"]`);
      const opacity = Number(accent?.getAttribute("opacity"));
      const contrast = effectiveContrast(accent?.getAttribute("stroke") ?? "", opacity, background);
      return { scene, opacity, contrast };
    });

    results.forEach(({ scene, opacity, contrast }) => {
      expect(opacity, `${scene} poster accent opacity`).toBeGreaterThanOrEqual(0.9);
      expect(contrast, `${scene} poster accent contrast`).toBeGreaterThanOrEqual(3);
    });
  });

  it("renders snow diamonds with an explicit transparent fill contract", () => {
    const el = render(<SceneLayers scene="snow" showFog={false} showBirds={false} cloudCover={80} precipitation={80} />);
    const snow = el.querySelector<SVGElement>('[data-weather-shape="snow-diamonds"]');
    const paths = Array.from(snow?.querySelectorAll("path") ?? []);

    expect(snow?.getAttribute("fill")).toBe("none");
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((path) => path.getAttribute("fill") === "none")).toBe(true);
  });

  it("layers turquoise poster clouds behind a dominant clear-day temperature", async () => {
    mockOpenMeteo(makeOpenMeteoPayload({ code: 0, cloud: 80 }));
    const el = render(<WeatherWidget />);
    await settle();

    const scene = el.querySelector('[data-testid="wx-scene-layers"]') as HTMLElement | null;
    expect(scene?.getAttribute("data-scene")).toBe("clear");
    const clouds = scene?.querySelector('[data-testid="wx-poster-clouds"]') as HTMLElement | null;
    expect(clouds?.getAttribute("data-cloud-cover")).toBe("80");
    expect(clouds?.querySelectorAll('[data-cloud-form="poster"]').length).toBe(2);
    expect(clouds?.querySelectorAll("[data-cloud-layer]").length).toBe(2);
    expect(scene?.querySelector('[data-testid="wx-poster-accents"] [data-weather-shape="sun"]')).toBeTruthy();

    const temp = el.querySelector('[data-testid="wx-hero-temp"]') as HTMLElement;
    expect(temp.className).toContain("text-[64px]");
    expect(temp.className).toContain("sm:text-[80px]");
    expect(temp.className).toContain("xl:text-[96px]");
    const icon = el.querySelector('[data-testid="wx-hero-icon"]') as HTMLElement;
    const renderedIconWidth = parseFloat((icon.firstElementChild as HTMLElement).style.width);
    expect(renderedIconWidth).toBeGreaterThanOrEqual(48);
    expect(renderedIconWidth).toBeLessThan(64);

    const movingLayer = clouds?.querySelector('[data-cloud-form="poster"]') as HTMLElement;
    const accent = scene?.querySelector('[data-testid="wx-poster-accents"]') as HTMLElement;
    expect(movingLayer.style.animation).toBe("");
    expect(accent.style.animation).toBe("");
  });

  it("birds fly around the sun on a clear day", async () => {
    mockOpenMeteo(makeOpenMeteoPayload({ cloud: 10, code: 0 }));
    const el = render(<WeatherWidget />);
    await settle();
    const birds = el.querySelector('[data-testid="wx-birds"]') as HTMLElement | null;
    expect(birds).toBeTruthy();
    expect(birds!.style.opacity).toBe("1");
    expect(birds!.querySelectorAll("svg path").length).toBe(3);
  });

  it("birds hide when clouds roll in", async () => {
    mockOpenMeteo(makeOpenMeteoPayload({ cloud: 90, code: 0 }));
    const el = render(<WeatherWidget />);
    await settle();
    const birds = el.querySelector('[data-testid="wx-birds"]') as HTMLElement | null;
    expect(birds).toBeTruthy();
    expect(birds!.style.opacity).toBe("0");
  });

  it("birds hide when it rains even under a thin sky", async () => {
    mockOpenMeteo(makeOpenMeteoPayload({ cloud: 10, code: 61 }));
    const el = render(<WeatherWidget />);
    await settle();
    const birds = el.querySelector('[data-testid="wx-birds"]') as HTMLElement | null;
    expect(birds).toBeTruthy();
    expect(birds!.style.opacity).toBe("0");
  });

  it("maps WMO codes to toy scenes, day and night", async () => {
    const { wmoToScene, sceneToCondition } = await import("@/components/ui/WxToys");
    expect(wmoToScene(0, true)).toBe("clear");
    expect(wmoToScene(1, true)).toBe("clear");
    expect(wmoToScene(3, true)).toBe("cloudy");
    expect(wmoToScene(45, true)).toBe("cloudy");
    expect(wmoToScene(61, true)).toBe("rain");
    expect(wmoToScene(71, true)).toBe("snow");
    expect(wmoToScene(95, true)).toBe("storm");
    expect(wmoToScene(0, false)).toBe("night");
    expect(wmoToScene(3, false)).toBe("night");
    expect(wmoToScene(61, false)).toBe("rain"); // precip keeps its sky after dark
    expect(sceneToCondition(wmoToScene(1, true), 1)).toBe("partly");
    expect(sceneToCondition(wmoToScene(45, true), 45)).toBe("fog");
    expect(sceneToCondition(wmoToScene(95, true), 95)).toBe("storm");
  });

  it("hero shows the clay icon for the live condition", async () => {
    mockOpenMeteo(makeOpenMeteoPayload({ code: 0 }));
    const el = render(<WeatherWidget />);
    await settle();
    // code 0 by day → clear → clay sun disc with an inline clay gradient
    const icon = el.querySelector('[data-testid="wx-hero-icon"]');
    expect(icon).toBeTruthy();
    const sun = icon!.firstChild as HTMLElement;
    expect(sun.style.background).toContain("linear-gradient");
  });

  it("hero shows the clay moon after dark", async () => {
    mockOpenMeteo(makeOpenMeteoPayload({ code: 0, isDay: 0 }));
    const el = render(<WeatherWidget />);
    await settle();
    const icon = el.querySelector('[data-testid="wx-hero-icon"]');
    expect(icon?.querySelector('[data-testid="wx-moon"]')).toBeTruthy();
  });

  it("hero shows thunder: clay bolt plus lightning flash on storm codes", async () => {
    mockOpenMeteo(makeOpenMeteoPayload({ code: 95 }));
    const el = render(<WeatherWidget />);
    await settle();
    // storm Condition = night-toned cloud + clay bolt svg in the hero icon
    const icon = el.querySelector('[data-testid="wx-hero-icon"]');
    expect(icon?.querySelector("svg")).toBeTruthy();
    // full-bleed lightning wash layer behind the content
    expect(el.querySelector(".mix-blend-overlay")).toBeTruthy();
  });

  it("details modal shows the toy hero and clay icons, no emoji", async () => {
    mockOpenMeteo(makeOpenMeteoPayload({ code: 61 }));
    const el = render(<WeatherWidget />);
    await settle();

    act(() => findDetailsButton(el)!.click());
    await settle();

    const dialog = document.querySelector("#weather-details-dialog") as HTMLElement;
    expect(dialog).toBeTruthy();
    // toy sky crossfade follows the scrubbed (rainy) hour
    const skies = Array.from(dialog.querySelectorAll('.wx-sky[data-active="true"]'));
    expect(skies.length).toBe(1);
    expect(skies[0].className).toContain("from-[#b9c4d8]");
    // hourly chips render clay icons (inline clay gradients) instead of emoji glyphs
    const chips = dialog.querySelector('[role="list"]');
    expect(chips?.innerHTML).toContain("linear-gradient");
    expect(chips?.textContent).not.toMatch(/☀|🌤|⛅|☁|🌧|❄|⛈|🌫/);
  });

  it("maps 5-day condition text to clay icons", async () => {
    const { dayCondition } = await import("@/components/ui/WxToys");
    expect(dayCondition("Clear")).toBe("clear");
    expect(dayCondition("Partly Cloudy")).toBe("partly");
    expect(dayCondition("Foggy")).toBe("fog");
    expect(dayCondition("Rain Showers")).toBe("rain");
    expect(dayCondition("Snowy")).toBe("snow");
    expect(dayCondition("Thunderstorm")).toBe("storm");
  });

  it("refetches weather every 15 minutes on its own", async () => {
    vi.useFakeTimers();
    try {
      mockOpenMeteo(makeOpenMeteoPayload());
      render(<WeatherWidget />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      const weatherCalls = () =>
        vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes("api.open-meteo.com"));

      expect(weatherCalls()).toHaveLength(1);

      await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60_000); });

      expect(weatherCalls()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refetches when the tab becomes visible again with stale data", async () => {
    vi.useFakeTimers();
    try {
      mockOpenMeteo(makeOpenMeteoPayload());
      render(<WeatherWidget />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      const weatherCalls = () =>
        vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes("api.open-meteo.com"));
      expect(weatherCalls()).toHaveLength(1);

      // 11 minutes pass (under the 15-min poll threshold, over the 10-min stale threshold)
      await act(async () => { await vi.advanceTimersByTimeAsync(11 * 60_000); });
      act(() => { document.dispatchEvent(new Event("visibilitychange")); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      expect(weatherCalls()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not refetch on tab wake when data is still fresh", async () => {
    vi.useFakeTimers();
    try {
      mockOpenMeteo(makeOpenMeteoPayload());
      render(<WeatherWidget />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      const weatherCalls = () =>
        vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes("api.open-meteo.com"));
      expect(weatherCalls()).toHaveLength(1);

      // only 5 minutes pass
      await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
      act(() => { document.dispatchEvent(new Event("visibilitychange")); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      expect(weatherCalls()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshes silently — no skeleton flash and stale data stays during the in-flight refresh", async () => {
    vi.useFakeTimers();
    try {
      let resolveSecond!: (v: { json: () => Promise<unknown> }) => void;
      const second = new Promise<{ json: () => Promise<unknown> }>((r) => { resolveSecond = r; });
      let calls = 0;
      const payload = makeOpenMeteoPayload();
      vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("api.open-meteo.com")) {
          calls += 1;
          if (calls === 1) return Promise.resolve({ json: () => Promise.resolve(payload) });
          return second;
        }
        return Promise.reject(new Error("no network"));
      }));
      const weatherCalls = () =>
        vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes("api.open-meteo.com"));

      const el = render(<WeatherWidget />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(el.textContent).toContain("H:75°");

      // fire the 15-min poll; second request is now in flight (unresolved)
      await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60_000); });
      expect(weatherCalls()).toHaveLength(2);
      expect(el.querySelector(".animate-pulse")).toBeNull(); // no Skeleton
      expect(el.textContent).toContain("H:75°"); // stale data still shown

      const updated = makeOpenMeteoPayload();
      updated.current.temperature_2m = 81;
      await act(async () => {
        resolveSecond({ json: () => Promise.resolve(updated) });
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(el.textContent).toContain("81"); // new temp landed (reduced-motion stub → instant)
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps stale data and shows no error banner when a background refresh fails", async () => {
    vi.useFakeTimers();
    try {
      const payload = makeOpenMeteoPayload();
      let calls = 0;
      vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("api.open-meteo.com")) {
          calls += 1;
          if (calls === 1) return Promise.resolve({ json: () => Promise.resolve(payload) });
          return Promise.reject(new Error("network down"));
        }
        return Promise.reject(new Error("no network"));
      }));
      const weatherCalls = () =>
        vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes("api.open-meteo.com"));

      const el = render(<WeatherWidget />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(el.textContent).toContain("H:75°");

      await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60_000); });

      expect(weatherCalls()).toHaveLength(2);
      expect(el.textContent).toContain("H:75°"); // stale data kept
      expect(el.textContent).not.toContain("Weather unavailable"); // no banner
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the unavailable banner when the first fetch for a new location fails", async () => {
    vi.useFakeTimers();
    try {
      let resolveRuntime!: (v: { weather_location: { LAT: string; LON: string } }) => void;
      const runtime = new Promise<{ weather_location: { LAT: string; LON: string } }>((r) => { resolveRuntime = r; });
      let calls = 0;
      const payload = makeOpenMeteoPayload();
      vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("api.open-meteo.com")) {
          calls += 1;
          if (calls === 1) return Promise.resolve({ json: () => Promise.resolve(payload) });
          return Promise.reject(new Error("network down"));
        }
        if (url.includes("/api/services/runtime")) {
          return runtime.then((body) => ({ ok: true, json: () => Promise.resolve(body) }));
        }
        return Promise.reject(new Error("no network"));
      }));

      const el = render(<WeatherWidget />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(el.textContent).toContain("H:75°"); // old location loaded fine

      // location changes while the widget stays mounted: the runtime config
      // resolves with new coordinates → loadWeather is recreated → the mount
      // effect refetches for the new location
      await act(async () => {
        resolveRuntime({ weather_location: { LAT: "39.7392", LON: "-104.9903" } });
        await vi.advanceTimersByTimeAsync(0);
      });

      // the new location's FIRST fetch failed → the banner must show
      expect(el.textContent).toContain("Weather unavailable");
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips a refresh that fires while a fetch is already in flight", async () => {
    vi.useFakeTimers();
    try {
      let resolveSecond!: (v: { json: () => Promise<unknown> }) => void;
      const second = new Promise<{ json: () => Promise<unknown> }>((r) => { resolveSecond = r; });
      let calls = 0;
      const payload = makeOpenMeteoPayload();
      vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("api.open-meteo.com")) {
          calls += 1;
          if (calls === 1) return Promise.resolve({ json: () => Promise.resolve(payload) });
          return second;
        }
        return Promise.reject(new Error("no network"));
      }));
      const weatherCalls = () =>
        vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes("api.open-meteo.com"));

      render(<WeatherWidget />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(weatherCalls()).toHaveLength(1);

      // first 15-min poll starts a refresh and holds it unresolved (in flight)
      await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60_000); });
      expect(weatherCalls()).toHaveLength(2);

      // second poll fires while the first is still in flight → overlap guard skips it
      await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60_000); });
      expect(weatherCalls()).toHaveLength(2);

      // let the in-flight refresh complete so the test exits clean
      await act(async () => {
        resolveSecond({ json: () => Promise.resolve(payload) });
        await vi.advanceTimersByTimeAsync(0);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts a hung fetch so later refreshes still fire (12s timeout)", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const payload = makeOpenMeteoPayload();
      let hungReject: ((e: unknown) => void) | null = null;
      vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("api.open-meteo.com")) {
          calls += 1;
          if (calls === 1) {
            // a real hung request never settles — abort() must reject it
            return new Promise((_, reject) => { hungReject = reject; });
          }
          return Promise.resolve({ json: () => Promise.resolve(payload) });
        }
        return Promise.reject(new Error("no network"));
      }));
      const weatherCalls = () =>
        vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes("api.open-meteo.com"));

      render(<WeatherWidget />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(weatherCalls()).toHaveLength(1);

      // wire the abort → rejection (as a real fetch does) via the request's signal
      const signal = (vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit | undefined)?.signal as AbortSignal | undefined;
      expect(signal).toBeTruthy();
      signal!.addEventListener("abort", () => hungReject?.(new DOMException("Aborted", "AbortError")));

      // the hung request holds the guard only until the 12s abort fires
      await act(async () => { await vi.advanceTimersByTimeAsync(12_500); });
      await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60_000); });
      expect(weatherCalls()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps screen-reader controls reachable — no role=img flattening and a quiet hero live region", async () => {
    mockOpenMeteo(makeOpenMeteoPayload());
    const el = render(<WeatherWidget />);
    await settle();

    expect(el.querySelector('[role="img"]')).toBeNull();
    const group = el.querySelector('[role="group"][aria-label*="degrees"]');
    expect(group).toBeTruthy();

    // The widget is Fahrenheit-only — no unit toggle may exist.
    const unitToggle = Array.from(el.querySelectorAll("button")).find((b) => b.getAttribute("aria-label")?.startsWith("Switch to"));
    expect(unitToggle).toBeUndefined();

    // single sr-only live region, refreshed on data — not per scrub step
    const liveRegions = el.querySelectorAll('[role="status"][aria-live="polite"]');
    expect(liveRegions.length).toBe(1);
    const region = liveRegions[0] as HTMLElement;
    expect(region.className).toContain("sr-only");
  });
});

describe("moon phase model", () => {
  const EPOCH = Date.UTC(2000, 0, 6, 18, 14);
  const SYNODIC_MS = 29.53058867 * 86400000;

  it("computes new moon at the reference epoch", () => {
    const mp = moonPhase(EPOCH);
    expect(mp.phase).toBeCloseTo(0, 2);
    expect(mp.illumination).toBeLessThan(0.01);
  });

  it("computes full moon half a synodic month later", () => {
    const mp = moonPhase(EPOCH + SYNODIC_MS / 2);
    expect(mp.phase).toBeCloseTo(0.5, 2);
    expect(mp.illumination).toBeGreaterThan(0.99);
  });

  it("computes first quarter at a quarter synodic month", () => {
    const mp = moonPhase(EPOCH + SYNODIC_MS / 4);
    expect(mp.phase).toBeCloseTo(0.25, 2);
    expect(mp.illumination).toBeCloseTo(0.5, 1);
    expect(mp.waxing).toBe(true);
  });

  it("names the eight phases", () => {
    expect(moonPhaseName(0.0)).toBe("New Moon");
    expect(moonPhaseName(0.1)).toBe("Waxing Crescent");
    expect(moonPhaseName(0.25)).toBe("First Quarter");
    expect(moonPhaseName(0.35)).toBe("Waxing Gibbous");
    expect(moonPhaseName(0.5)).toBe("Full Moon");
    expect(moonPhaseName(0.6)).toBe("Waning Gibbous");
    expect(moonPhaseName(0.75)).toBe("Last Quarter");
    expect(moonPhaseName(0.85)).toBe("Waning Crescent");
  });
});

describe("procedural clouds", () => {
  it("is deterministic for the same seed and coverage", () => {
    expect(makeCloudSpec(12345, 0.6)).toEqual(makeCloudSpec(12345, 0.6));
  });

  it("generates unique clouds for different moments", () => {
    expect(makeCloudSpec(1, 0.6)).not.toEqual(makeCloudSpec(2, 0.6));
  });

  it("keeps every blob inside the viewBox", () => {
    for (const seed of [7, 99, 4242, 987654]) {
      for (const b of makeCloudSpec(seed, 0.9).blobs) {
        expect(b.cx - b.rx).toBeGreaterThanOrEqual(15);
        expect(b.cx + b.rx).toBeLessThanOrEqual(185);
      }
    }
  });

  it("builds fuller clouds as coverage rises", () => {
    const thin = makeCloudSpec(55, 0.1);
    const full = makeCloudSpec(55, 1);
    expect(full.blobs.length).toBeGreaterThanOrEqual(thin.blobs.length);
  });
});

describe("weather skins — severity + Consuela night", () => {
  it("desaturates the day sky and switches to storm amber for severe codes", () => {
    const calm = getWeatherSkin("summer", false, 1);
    const storm = getWeatherSkin("summer", false, 95);
    expect(storm.severe).toBe(true);
    expect(storm.severeFamily).toBe("storm");
    expect(storm.accent).toBe("#FFB44F");
    expect(storm.skyTop).not.toBe(calm.skyTop); // pastel lemon pulled toward gray
    expect(calm.severe).toBe(false);
  });

  it("treats heavy snow as severe with its own slate treatment", () => {
    const calm = getWeatherSkin("winter", false, 71); // light snow = calm
    expect(calm.severe).toBe(false);
    for (const code of [73, 75, 85, 86]) {
      const snow = getWeatherSkin("winter", false, code);
      expect(snow.severe).toBe(true);
      expect(snow.severeFamily).toBe("snow");
      expect(snow.accent).toBe("#7FA8D9");
      expect(snow.skyTop).not.toBe(calm.skyTop);
    }
  });

  it("keeps the lamplit indigo night instead of near-black", () => {
    const night = getWeatherSkin("summer", true, 1);
    expect(night.night).toBe(true);
    expect(night.skyTop).toBe("#1B1E33");
    expect(night.ink).toBe("#FFFFFF");
  });

  it("severity owns the accent — the holiday party color never wins on a severe card", () => {
    const storm = getWeatherSkin("summer", false, 95);
    const calm = getWeatherSkin("summer", false, 1);
    expect(resolveAccent(storm, "#f97316")).toBe(storm.accent); // halloween orange refused
    expect(resolveAccent(calm, "#f97316")).toBe("#f97316"); // calm day borrows the party
    expect(resolveAccent(calm, null)).toBe(calm.accent);
  });

  it("emits one sky gradient source shared by the scene", () => {
    const summer = getWeatherSkin("summer", false, 1);
    expect(summer.skyGradient("summer")).toBe("linear-gradient(175deg, #55BCE8 0%, #D8F2F4 100%)");
    expect(summer.skyGradient(null)).toBe("linear-gradient(175deg, #1B1E33 0%, #2A2440 100%)");
    const storm = getWeatherSkin("summer", false, 95);
    expect(storm.skyGradient("summer")).toBe(storm.skyGradient("winter"));
  });
});

describe("weather insights — family language helpers", () => {
  it("wearAdvice answers the kid question with kid copy and rain beats warmth", () => {
    expect(wearAdvice(50, null, false).headline).toBe("Light jacket");
    expect(wearAdvice(75, 5, false).headline).toBe("Sunglasses weather");
    expect(wearAdvice(75, 5, true).headline).toBe("No jacket needed");
    expect(wearAdvice(34, 10, true).headline).toBe("Grab a coat");
    expect(wearAdvice(50, 10, false).headline).toBe("Light jacket");
    expect(wearAdvice(95, 10, false).headline).toBe("Water-bottle weather");
    const wet = wearAdvice(75, 60, false);
    expect(wet.headline).toBe("Raincoats ready");
    expect(wet.detail).toBe("Sunglasses weather");
    const wetKid = wearAdvice(50, 60, true);
    expect(wetKid.headline).toBe("Bring a raincoat");
    expect(wetKid.detail).toBe("Bring a jacket");
  });

  it("stormAdvice names the storm and answers when it clears", () => {
    const end = new Date();
    end.setHours(18, 0, 0, 0);
    const a = stormAdvice(end.toISOString(), false);
    expect(a.headline).toContain("Thunderstorms");
    expect(a.detail).toContain("6 PM");
    const kid = stormAdvice(end.toISOString(), true);
    expect(kid.headline).toContain("stay inside");
    expect(stormAdvice(null, false).detail).toContain("unknown");
  });

  it("snowAdvice names the snow, answers boots, and shares the clearing line", () => {
    const end = new Date();
    end.setHours(15, 0, 0, 0);
    const a = snowAdvice(end.toISOString(), false);
    expect(a.headline).toBe("Big snow today — boots by the door");
    expect(a.detail).toContain("3 PM");
    const kid = snowAdvice(end.toISOString(), true);
    expect(kid.headline).toBe("Big snow! Boots and mittens today");
    expect(snowAdvice(null, false).detail).toContain("unknown");
  });

  it("fusionOutlook pairs a rain hit with a same-day family event", () => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    const dayStart = day.getTime();
    const now = dayStart + 12 * 3600_000; // noon
    const rainAt = new Date(dayStart + 16 * 3600_000).toISOString(); // 4 PM
    const events = [
      { title: "Dentist", member: "Bailey", time: "9:00 AM" }, // past → ignored
      { title: "Soccer Practice", member: "Emily", time: "4:30 PM" }, // within 75 min
      { title: "Movie Night", time: "7:00 PM" },
    ];
    const fused = fusionOutlook(rainAt, "Rain likely around 4 PM", events, now);
    expect(fused).toBeTruthy();
    expect(fused!.headline).toBe("Rain around Soccer Practice");

    // rain passes well before the next event → reassurance, not a match
    const early = fusionOutlook(rainAt, "Rain likely around 4 PM", [{ title: "Movie Night", time: "7:00 PM" }], now);
    expect(early!.headline).toBe("Rain likely around 4 PM");
    expect(early!.detail).toContain("before Movie Night");

    // no events, no fusion
    expect(fusionOutlook(rainAt, "Rain likely around 4 PM", [], now)).toBeNull();
  });

  it("fusionOutlook parses both 24h and 12h event times", () => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    const dayStart = day.getTime();
    const now = dayStart + 3600_000;
    const rainAt = new Date(dayStart + 16 * 3600_000).toISOString();
    const h24 = fusionOutlook(rainAt, "Rain likely around 4 PM", [{ title: "Pickup", time: "16:20" }], now);
    expect(h24!.headline).toBe("Rain around Pickup");
    const h12 = fusionOutlook(rainAt, "Rain likely around 4 PM", [{ title: "Pickup", time: "4:20 PM" }], now);
    expect(h12!.headline).toBe("Rain around Pickup");
  });
});
