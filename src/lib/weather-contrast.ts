// weather-contrast — the AA math behind every weather text ink, plus the
// poster/header surface models. Extracted from WeatherSkins.ts (color math,
// lines 144-185) and WeatherWidget.tsx (mixHex 159-168, surfaces 180-201)
// so contrast is machine-testable.

import type { WxScene } from "@/components/ui/WxToys";
import type { SkyPhase } from "@/lib/weather-scene-params";

// Machine-verified 2026-09-25 against WCAG AA (≥ 4.5:1) for slate-800 #1E293B:
//   dawn 4.55 | 7.16 | 10.85    dusk 4.57 | 4.59 | 8.15
// Dark at top → cream at bottom so the slate-800 hero ink holds end-to-end
// (white fails at 1.12 on the cream stops — there is deliberately no fallback).
const DAWN_STOPS = ["#898CBB", "#E8A2B6", "#FFD8A0"];
const DUSK_STOPS = ["#8C8DB1", "#CE73A1", "#FFB072"];

// Monster flat washes (2026-10-02), pinned 1:1 to the SKY tokens — the
// "SKY wash strings match the verified ink stops" suite enforces the coupling.
// Machine-verified AA: light fields ≥ 4.5:1 vs slate-800 (clear 6.79/7.07/7.35,
// cloudy 8.27/8.62/8.99, rain 7.42/7.17/6.87, snow 13.57/13.14/12.72, night
// 4.81/4.99/5.19); the dark-field exception keeps white ink (heavySnow
// 6.40/6.80/7.23, storm 5.53/6.05/6.70).
const CLEAR_STOPS = ["#55BCE8", "#58C0EA", "#5BC4EC"];
const CLOUDY_STOPS = ["#9CC9E2", "#A1CDE5", "#A6D1E8"];
const RAIN_STOPS = ["#ADB9D3", "#A9B6D1", "#A5B2CF"];
const SNOW_STOPS = ["#F6F6FA", "#F3F2F8", "#F0EEF6"];
const HEAVY_SNOW_STOPS = ["#4C607E", "#485C7A", "#445876"];
const STORM_STOPS = ["#656399", "#5F5D93", "#58568E"];
const NIGHT_STOPS = ["#8B90C6", "#8E93C9", "#9196CD"];

export type Rgb = [number, number, number];

// ↓ verbatim from WeatherSkins.ts:146-156
export function parseHexColor(value: unknown): Rgb | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().replace(/^#/, "");
  if (![3, 4, 6, 8].includes(raw.length) || !/^[0-9a-f]+$/i.test(raw)) return null;
  if (raw.length === 4 && raw[3].toLowerCase() !== "f") return null;
  if (raw.length === 8 && raw.slice(6).toLowerCase() !== "ff") return null;
  const expanded = raw.length <= 4 ? raw.split("").map((part) => `${part}${part}`).join("") : raw.slice(0, 6);
  const channels = [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16));
  if (channels.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255)) return null;
  return channels as Rgb;
}

// ↓ verbatim from WeatherSkins.ts:158-160
export function formatHexColor(rgb: Rgb): string {
  return `#${rgb.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("")}`;
}

// ↓ verbatim from WeatherSkins.ts:162-168
export function mixHexColor(a: string, b: string, t: number): string {
  if (!Number.isFinite(t) || t < 0 || t > 1) throw new Error("Invalid color blend alpha");
  const pa = parseHexColor(a);
  const pb = parseHexColor(b);
  if (!pa || !pb) throw new Error("Invalid color blend input");
  return formatHexColor(pa.map((channel, index) => channel + (pb[index] - channel) * t) as Rgb);
}

// ↓ verbatim from WeatherSkins.ts:170-176 (kept module-private)
function colorLuminance(color: Rgb): number {
  const channels = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

// ↓ verbatim from WeatherSkins.ts:178-185
export function contrastRatio(a: string, b: string): number {
  const foreground = parseHexColor(a);
  const background = parseHexColor(b);
  if (!foreground || !background) return 0;
  const first = colorLuminance(foreground);
  const second = colorLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

// ↓ verbatim from WeatherWidget.tsx:159-168 — lenient, no validation.
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const ca = (pa >> shift) & 255;
    const cb = (pb >> shift) & 255;
    return Math.round(ca + (cb - ca) * t);
  };
  return `#${[ch(16), ch(8), ch(0)].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function posterTextSurface(scene: WxScene, heavySnow = false, skyPhase: SkyPhase = "day"): string[] {
  if (scene === "clear" || scene === "cloudy") {
    if (skyPhase === "dawn") return [...DAWN_STOPS];
    if (skyPhase === "dusk") return [...DUSK_STOPS];
    if (scene === "clear") return [...CLEAR_STOPS];
    return [...CLOUDY_STOPS];
  }
  if (scene === "rain") return [...RAIN_STOPS];
  if (scene === "snow") return heavySnow ? [...HEAVY_SNOW_STOPS] : [...SNOW_STOPS];
  if (scene === "storm") return [...STORM_STOPS];
  return [...NIGHT_STOPS]; // night
}

export function weatherHeaderTextSurfaces(
  scene: WxScene,
  failedFetch = false,
  heavySnow = false,
  skyPhase: SkyPhase = "day",
): string[] {
  const glassAlpha = scene === "storm" ? 0.4 : 0.3;
  const sheenAlpha = 0.4;
  const surfaceAlpha = glassAlpha + sheenAlpha * (1 - glassAlpha);
  const baseSurfaces = posterTextSurface(scene, heavySnow, skyPhase);
  const surfaces = failedFetch
    ? baseSurfaces.map((surface) => mixHex(surface, "#788091", 0.38))
    : baseSurfaces;
  return surfaces.flatMap((surface) => [
    mixHex(surface, "#FFFFFF", glassAlpha),
    mixHex(surface, "#FFFFFF", surfaceAlpha),
  ]);
}
