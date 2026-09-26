// weather-contrast — the AA math behind every weather text ink, plus the
// poster/header surface models. Extracted from WeatherSkins.ts (color math,
// lines 144-185) and WeatherWidget.tsx (mixHex 159-168, surfaces 180-201)
// so contrast is machine-testable.

import type { WxScene } from "@/components/ui/WxToys";

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

// ↓ verbatim from WeatherWidget.tsx:180-188
export function posterTextSurface(scene: WxScene, heavySnow = false): string[] {
  if (scene === "clear") return ["#55BCE8", "#8FD8F1", "#D8F2F4"];
  if (scene === "cloudy") return ["#DFE4EE", "#EEF1F6", "#D9E6F5"];
  if (scene === "rain") return ["#B9C4D8", "#C9D7EA", "#D8D3F0"];
  if (scene === "snow" && heavySnow) return ["#5D6F8C", "#465A78", "#354861"];
  if (scene === "snow") return ["#F4F7FB", "#E6EFFF", "#EFE6FB"];
  if (scene === "storm") return ["#6A6F96", "#5D5B8F", "#4D4770"];
  return ["#6F74A8", "#A29DC9", "#E2DBF2"];
}

// ↓ verbatim from WeatherWidget.tsx:190-201
export function weatherHeaderTextSurfaces(scene: WxScene, failedFetch = false, heavySnow = false): string[] {
  const glassAlpha = scene === "storm" ? 0.4 : 0.3;
  const sheenAlpha = 0.4;
  const surfaceAlpha = glassAlpha + sheenAlpha * (1 - glassAlpha);
  const baseSurfaces = posterTextSurface(scene, heavySnow);
  const surfaces = failedFetch
    ? baseSurfaces.map((surface) => mixHex(surface, "#788091", 0.38))
    : baseSurfaces;
  return surfaces.flatMap((surface) => [
    mixHex(surface, "#FFFFFF", glassAlpha),
    mixHex(surface, "#FFFFFF", surfaceAlpha),
  ]);
}
