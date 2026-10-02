// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act, createElement, Fragment } from "react";
import type { ReactElement } from "react";
import { WEATHER_MATERIAL } from "@/lib/weather-skins/types";
import { getWeatherSkin } from "@/components/ui/WeatherSkins";
import { SKY, INK } from "@/components/ui/wx-tokens";
import { contrastRatio } from "@/lib/weather-contrast";
import { Condition, MonsterDigit, SceneLayers } from "@/components/ui/WxToys";
import type { ConditionCode } from "@/components/ui/WxToys";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: ReturnType<typeof createRoot>[] = [];

function renderNode(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => {
    const root = createRoot(el);
    roots.push(root);
    root.render(ui);
  });
  return el;
}

beforeEach(() => {
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

it("WEATHER_MATERIAL is monster", () => expect(WEATHER_MATERIAL).toBe("monster"));
it("getWeatherSkin still returns a skin for each condition (monster washes)", () => {
  for (const code of [0,3,45,61,71,95]) {
    const skin = getWeatherSkin("summer", false, code);
    expect(skin.skyGradient).toBeDefined();
  }
});
it("every stop of every SKY wash is ≥ 4.5:1 vs its ink", () => {
  for (const [k, cls] of Object.entries(SKY)) {
    const stops = [...cls.matchAll(/#([0-9a-f]{6})/gi)].map((m) => `#${m[1]}`);
    expect(stops.length, k).toBeGreaterThanOrEqual(3);
    const ink = INK[k] === "text-white" ? "#FFFFFF" : "#1E293B";
    for (const stop of stops) {
      expect(contrastRatio(ink, stop), `${k} stop ${stop}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

// ── Monster condition icons: one sculptural silhouette per code, zero faces ──

it.each(["clear", "partly", "partly-night", "cloudy", "rain", "storm", "snow", "fog", "night"] as const)(
  "Condition %s renders one data-weather-icon, zero faces",
  (code: ConditionCode) => {
    const el = renderNode(createElement(Condition, { code, size: 80 }));
    expect(el.querySelectorAll("[data-weather-icon]")).toHaveLength(1);
    expect(el.querySelectorAll("[data-weather-character]")).toHaveLength(0);
    expect(el.querySelectorAll("[data-weather-face]")).toHaveLength(0);
  }
);

it("clear with hideSun renders nothing (poster owns the sun)", () => {
  const el = renderNode(createElement(Condition, { code: "clear", size: 80, hideSun: true }));
  expect(el.textContent?.trim()).toBe("");
});

// ── MonsterDigit: the capsule-grammar hero digit set ─────────────────────────

it.each(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "-"] as const)(
  "MonsterDigit %s renders with data-weather-digit",
  (digit: string) => {
    const el = renderNode(createElement(MonsterDigit, { digit }));
    const nodes = el.querySelectorAll(`[data-weather-digit="${digit}"]`);
    expect(nodes).toHaveLength(1);
  }
);

it("a 2-digit number renders exactly 2 digit nodes; unknown char falls back to text", () => {
  const el = renderNode(
    createElement(Fragment, null, createElement(MonsterDigit, { digit: "7" }), createElement(MonsterDigit, { digit: "2" }))
  );
  expect(el.querySelectorAll("[data-weather-digit]")).toHaveLength(2);
  expect(
    Array.from(el.querySelectorAll("[data-weather-digit]"))
      .map((node) => node.getAttribute("data-weather-digit"))
      .join("")
  ).toBe("72");

  const unknown = renderNode(createElement(MonsterDigit, { digit: "x" }));
  expect(unknown.querySelectorAll("[data-weather-digit]")).toHaveLength(0);
  expect(unknown.querySelector("svg")).toBeNull();
  expect(unknown.textContent).toBe("x");
});

// ── Scene faces are deleted, character hooks survive ──────────────────────────

it("moon disc keeps its character hook (exactly one data-weather-character=\"moon\" in the night scene), with no face elements", () => {
  const el = renderNode(createElement(SceneLayers as unknown as (props: Record<string, unknown>) => ReactElement, {
    scene: "night",
    showFog: false,
    showBirds: false,
    moonPhase: 0.5,
    moonIllumination: 1,
  }));
  expect(el.querySelectorAll('[data-weather-character="moon"]')).toHaveLength(1);
  expect(el.querySelectorAll("[data-weather-face]")).toHaveLength(0);
  expect(el.querySelector('[data-weather-character="moon"] [data-weather-shape="night-orbit"]')).toBeTruthy();
});

it("the night scene renders no cloud faces and no sun dots anywhere", () => {
  const el = renderNode(createElement(SceneLayers as unknown as (props: Record<string, unknown>) => ReactElement, {
    scene: "clear",
    showFog: false,
    showBirds: false,
    cloudCover: 80,
    sunProgress: 0.5,
  }));
  expect(el.querySelectorAll('[data-weather-character="cloud"]')).toHaveLength(0);
  expect(el.querySelectorAll('[data-weather-character="sun"] circle[fill="#6A452A"]')).toHaveLength(0);
});
