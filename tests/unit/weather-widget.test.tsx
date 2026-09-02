// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import WeatherWidget from "@/components/ui/WeatherWidget";
import { moonPhase, moonPhaseName, makeCloudSpec } from "@/components/ui/WeatherScene";
import { wearAdvice, stormAdvice, snowAdvice, fusionOutlook } from "@/lib/weather-insights";
import { getWeatherSkin, resolveAccent } from "@/components/ui/WeatherSkins";
import { WeatherProvider } from "@/hooks/useWeather";
import { AtmosphericProvider } from "@/hooks/useAtmosphericTheme";
import { AuthProvider } from "@/hooks/useAuth";

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

function makeOpenMeteoPayload(overrides: { isDay?: number; precip?: number; visibility?: number; cloud?: number; code?: number } = {}) {
  const isDay = overrides.isDay ?? 1;
  const precip = overrides.precip ?? 5;
  const visibility = overrides.visibility ?? 16000;
  const cloud = overrides.cloud ?? 30;
  const code = overrides.code ?? 1;
  const now = new Date();
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

  it("renders the day strip as an accessible slider with rain ticks when rain is likely", async () => {
    mockOpenMeteo(makeOpenMeteoPayload({ precip: 80 }));
    const el = render(<WeatherWidget />);
    await settle();

    const strip = el.querySelector('[role="slider"][aria-label="Preview the rest of the day"]');
    expect(strip).toBeTruthy();
    expect(strip!.textContent).toContain("NOW");

    const ticks = strip!.querySelectorAll("svg rect");
    expect(ticks.length).toBeGreaterThan(0);
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

  it("switches to the night skin when the API reports is_day=0", async () => {
    mockOpenMeteo(makeOpenMeteoPayload({ isDay: 0 }));
    const el = render(<WeatherWidget />);
    await settle();

    const activeSky = el.querySelector('.wx-sky[data-active="true"]') as HTMLElement | null;
    expect(activeSky).toBeTruthy();
    // Consuela night: lamplit indigo, not near-black
    expect(activeSky!.style.background).toContain("rgb(27, 30, 51)");
  });

  it("renders a storm-gray day sky with amber accent and storm copy when a thunderstorm code arrives", async () => {
    mockOpenMeteo(makeOpenMeteoPayload({ code: 95 }));
    const el = render(<WeatherWidget />);
    await settle();

    const activeSky = el.querySelector('.wx-sky[data-active="true"]') as HTMLElement | null;
    expect(activeSky).toBeTruthy();
    // summer pastel #FFD8CB (255,216,203) pulled 62% toward storm gray #9AA3AE
    expect(activeSky!.style.background).not.toContain("rgb(255, 216, 203)");
    expect(activeSky!.style.background).toContain("linear-gradient");
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
    // winter pastel #D9EAFB (217,234,251) pulled toward slate #8B99B5
    expect(activeSky!.style.background).not.toContain("rgb(217, 234, 251)");
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
    act(() => { pointerAt("pointerdown", 500); });
    act(() => { pointerAt("pointerup", 500); });
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

  it("renders the true moon phase in the night scene", async () => {
    mockOpenMeteo(makeOpenMeteoPayload({ isDay: 0 }));
    const el = render(<WeatherWidget />);
    await settle();
    const lit = el.querySelector('[data-testid="wx-moon-lit"]');
    expect(lit).toBeTruthy();
    expect(lit!.getAttribute("d")).toMatch(/^M 20 4 A 16 16/);
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

    const unitToggle = Array.from(el.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "Switch to Celsius");
    expect(unitToggle).toBeTruthy();

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
    expect(summer.skyGradient("summer")).toBe("linear-gradient(175deg, #FFD8CB 0%, #FFEBCF 100%)");
    expect(summer.skyGradient(null)).toBe("linear-gradient(175deg, #1B1E33 0%, #2A2440 100%)");
    const storm = getWeatherSkin("summer", false, 95);
    expect(storm.skyGradient("summer")).toBe(storm.skyGradient("winter"));
  });
});

describe("weather insights — family language helpers", () => {  it("wearAdvice answers the kid question with kid copy and rain beats warmth", () => {
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
