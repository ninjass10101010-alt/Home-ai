// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act, createElement, Fragment } from "react";
import type { ReactElement } from "react";
import { WEATHER_MATERIAL } from "@/lib/weather-skins/types";
import { getWeatherSkin } from "@/components/ui/WeatherSkins";
import { MONSTER, SKY, INK } from "@/components/ui/wx-tokens";
import { contrastRatio, mixHexColor, posterTextSurface } from "@/lib/weather-contrast";
import { Condition, MonsterDigit, SceneLayers, CONDITION_SILHOUETTE_TONES } from "@/components/ui/WxToys";
import type { ConditionCode, WxScene } from "@/components/ui/WxToys";
import type { SkyPhase } from "@/lib/weather-scene-params";

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
it("SKY carries exactly the 9 shipped washes", () => {
  expect(Object.keys(SKY)).toHaveLength(9);
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

// ── Condition-icon contrast (F2): main silhouette ≥ 3:1 on its shipped field ─
// The field mapping is explicit here; the tones come from the implementation,
// so a tone retune or a SKY field retune both fail this gate.

const CONDITION_FIELDS: Record<ConditionCode, { scene: WxScene; heavySnow?: boolean; skyPhase?: SkyPhase }[]> = {
  clear: [{ scene: "clear" }, { scene: "clear", skyPhase: "dawn" }, { scene: "clear", skyPhase: "dusk" }],
  partly: [{ scene: "clear" }, { scene: "clear", skyPhase: "dawn" }, { scene: "clear", skyPhase: "dusk" }],
  "partly-night": [{ scene: "night" }],
  cloudy: [
    { scene: "cloudy" },
    { scene: "cloudy", skyPhase: "dawn" },
    { scene: "cloudy", skyPhase: "dusk" },
    { scene: "night" },
  ],
  rain: [{ scene: "rain" }],
  storm: [{ scene: "storm" }],
  snow: [{ scene: "snow" }, { scene: "snow", heavySnow: true }],
  fog: [{ scene: "cloudy" }, { scene: "night" }],
  night: [{ scene: "night" }],
};

it.each(Object.keys(CONDITION_FIELDS) as ConditionCode[])(
  "condition %s main silhouette is ≥ 3:1 on every shipped field it renders on",
  (code) => {
    const tones = CONDITION_SILHOUETTE_TONES[code];
    for (const field of CONDITION_FIELDS[code]) {
      const tone = field.heavySnow ? tones.dark ?? tones.light : tones.light;
      const label = `${code} ${tone} vs ${field.scene}${field.skyPhase ? `/${field.skyPhase}` : ""}${field.heavySnow ? " heavy" : ""}`;
      const stops = posterTextSurface(field.scene, field.heavySnow ?? false, field.skyPhase ?? "day");
      expect(stops).toHaveLength(3);
      for (const stop of stops) {
        expect(contrastRatio(tone, stop), `${label} stop ${stop}`).toBeGreaterThanOrEqual(3);
      }
    }
  }
);

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

// ── MonsterDigit: flat color sections + one clear eye per digit ───────────────

const EXPECTED_DIGIT_SEGMENTS: Record<string, string[]> = {
  "0": ["top", "upperRight", "lowerRight", "bottom", "lowerLeft", "upperLeft"],
  "1": ["upperRight", "lowerRight"],
  "2": ["top", "upperRight", "middle", "lowerLeft", "bottom"],
  "3": ["top", "upperRight", "middle", "lowerRight", "bottom"],
  "4": ["upperLeft", "upperRight", "middle", "lowerRight"],
  "5": ["top", "upperLeft", "middle", "lowerRight", "bottom"],
  "6": ["top", "upperLeft", "middle", "lowerLeft", "lowerRight", "bottom"],
  "7": ["top", "upperRight", "lowerRight"],
  "8": ["top", "upperRight", "lowerRight", "bottom", "lowerLeft", "upperLeft", "middle"],
  "9": ["top", "upperLeft", "upperRight", "middle", "lowerRight", "bottom"],
  "-": ["middle"],
};

const EXPECTED_DIGIT_COLORS: Record<string, string[]> = {
  "0": [MONSTER.orange, MONSTER.red, MONSTER.teal, MONSTER.blue, MONSTER.purple, MONSTER.teal],
  "1": [MONSTER.teal, MONSTER.orange],
  "2": [MONSTER.orange, MONSTER.teal, MONSTER.purple, MONSTER.blue, MONSTER.red],
  "3": [MONSTER.orange, MONSTER.teal, MONSTER.purple, MONSTER.red, MONSTER.blue],
  "4": [MONSTER.teal, MONSTER.orange, MONSTER.purple, MONSTER.red],
  "5": [MONSTER.orange, MONSTER.teal, MONSTER.purple, MONSTER.red, MONSTER.blue],
  "6": [MONSTER.orange, MONSTER.teal, MONSTER.purple, MONSTER.blue, MONSTER.red, MONSTER.orange],
  "7": [MONSTER.orange, MONSTER.teal, MONSTER.red],
  "8": [MONSTER.orange, MONSTER.teal, MONSTER.red, MONSTER.blue, MONSTER.purple, MONSTER.red, MONSTER.orange],
  "9": [MONSTER.orange, MONSTER.teal, MONSTER.red, MONSTER.purple, MONSTER.blue, MONSTER.orange],
  "-": [MONSTER.purple],
};

it.each(Object.entries(EXPECTED_DIGIT_SEGMENTS))(
  "MonsterDigit %s uses the expected flat, colored number sections",
  (digit, expectedSegments) => {
    const el = renderNode(createElement(MonsterDigit, { digit }));
    const svg = el.querySelector(`[data-weather-digit="${digit}"]`);
    expect(svg, digit).toBeTruthy();

    const segments = Array.from(svg!.querySelectorAll<SVGRectElement>("[data-digit-segment]"));
    expect(segments.map((segment) => segment.getAttribute("data-digit-segment"))).toEqual(expectedSegments);
    expect(segments.map((segment) => segment.getAttribute("fill"))).toEqual(EXPECTED_DIGIT_COLORS[digit]);
    expect(segments.every((segment) => segment.tagName.toLowerCase() === "rect")).toBe(true);
    expect(segments.every((segment) => Number(segment.getAttribute("rx")) > 0)).toBe(true);
    expect(segments.every((segment) => segment.hasAttribute("fill") && !segment.hasAttribute("stroke"))).toBe(true);
    const depthFaces = Array.from(svg!.querySelectorAll<SVGRectElement>("[data-digit-depth]"));
    expect(depthFaces.map((face) => face.getAttribute("data-digit-depth"))).toEqual(expectedSegments);
    for (const segment of segments) {
      const depthFace = depthFaces.find((face) => face.getAttribute("data-digit-depth") === segment.getAttribute("data-digit-segment"));
      expect(Number(depthFace?.getAttribute("x"))).toBe(Number(segment.getAttribute("x")) + 7);
      expect(Number(depthFace?.getAttribute("y"))).toBe(Number(segment.getAttribute("y")) + 9);
      expect(depthFace?.getAttribute("width")).toBe(segment.getAttribute("width"));
      expect(depthFace?.getAttribute("height")).toBe(segment.getAttribute("height"));
      expect(depthFace?.getAttribute("rx")).toBe(segment.getAttribute("rx"));
      expect(depthFace?.getAttribute("fill")).toBe(mixHexColor(segment.getAttribute("fill")!, MONSTER.inkBlue, 0.32));
    }
    if (digit !== "-") {
      expect(new Set(segments.map((segment) => segment.getAttribute("fill"))).size).toBeGreaterThan(1);
      expect(svg!.querySelectorAll("[data-digit-eye]")).toHaveLength(1);
      const eye = svg!.querySelector("[data-digit-eye]");
      const eyeCircles = Array.from(eye?.querySelectorAll("circle") ?? []);
      expect(eyeCircles).toHaveLength(3);
      expect(eyeCircles[0].getAttribute("fill")).toBe(mixHexColor(MONSTER.glint, MONSTER.inkBlue, 0.22));
      expect(eyeCircles[0].getAttribute("cx")).toBe(String(Number(eyeCircles[1].getAttribute("cx")) + 3));
      expect(eyeCircles[0].getAttribute("cy")).toBe(String(Number(eyeCircles[1].getAttribute("cy")) + 5));
      expect(eyeCircles[1].getAttribute("fill")).toBe(MONSTER.glint);
      expect(eyeCircles[1].getAttribute("r")).toBe("17");
      expect(eyeCircles[2].getAttribute("fill")).toBe(MONSTER.pupil);
      expect(eyeCircles[2].getAttribute("r")).toBe("8");
    } else {
      expect(svg!.querySelectorAll("[data-digit-eye]")).toHaveLength(0);
    }
    expect(svg!.querySelectorAll("path, line, ellipse")).toHaveLength(0);
  }
);

it("keeps the 1's upper and lower color sections joined into one numeral", () => {
  const el = renderNode(createElement(MonsterDigit, { digit: "1" }));
  const upper = el.querySelector<SVGRectElement>('[data-digit-segment="upperRight"]');
  const lower = el.querySelector<SVGRectElement>('[data-digit-segment="lowerRight"]');
  expect(upper).toBeTruthy();
  expect(lower).toBeTruthy();
  expect(Number(upper!.getAttribute("y")) + Number(upper!.getAttribute("height")))
    .toBeGreaterThanOrEqual(Number(lower!.getAttribute("y")));
});

it("a 2-digit number renders two numbers with eyes; unknown char falls back to text", () => {
  const el = renderNode(
    createElement(Fragment, null, createElement(MonsterDigit, { digit: "7" }), createElement(MonsterDigit, { digit: "2" }))
  );
  expect(el.querySelectorAll("[data-weather-digit]")).toHaveLength(2);
  expect(
    Array.from(el.querySelectorAll("[data-weather-digit]"))
      .map((node) => node.getAttribute("data-weather-digit"))
      .join("")
  ).toBe("72");
  expect(el.querySelectorAll("[data-digit-eye]")).toHaveLength(2);

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

it("the clear scene renders no cloud faces and no sun face dots anywhere", () => {
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
