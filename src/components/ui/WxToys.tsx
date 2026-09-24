"use client";

import { CSSProperties, useEffect, useId, useState } from "react";
import { WX_POSTER } from "./wx-tokens";

// WxToys — the toy weather kit: SunOrb, CloudPuff, seagull Birds,
// keyframe-wired SceneLayers, and the clay Condition icon set.
// Gradients live in inline styles: Tailwind JIT cannot generate dynamic
// from-[${…}] / opacity-${n} classes, so clay never uses them.

// ─── Toy objects ────────────────────────────────────────────────

export function SunOrb({ night = false }: { night?: boolean }) {
  return night ? (
    <div
      aria-hidden="true"
      className="h-20 w-20 rounded-full
      bg-gradient-to-b from-[#fff9e6] to-[#e4dcff]
      shadow-[inset_0_-8px_14px_rgba(120,110,200,.35),inset_0_4px_8px_rgba(255,255,255,1),0_0_48px_rgba(220,210,255,.55)]"
    />
  ) : (
    <div
      aria-hidden="true"
      className="h-20 w-20 rounded-full
      bg-gradient-to-b from-[#fff6cf] via-[#ffd98a] to-[#ffb36b]
      shadow-[inset_0_-8px_14px_rgba(230,120,40,.45),inset_0_4px_8px_rgba(255,255,255,.95),0_16px_36px_-8px_rgba(255,160,80,.55)]
      ring-1 ring-white/60"
    />
  );
}

// Three overlapping blobs = chunky toy cloud. Pastel, with soft undershadow.
export function CloudPuff({ className = "", style, tone = "day", layer }: {
  className?: string;
  style?: CSSProperties;
  tone?: "day" | "poster" | "night";
  layer?: "front" | "back";
}) {
  const blob = tone === "poster"
    ? "absolute rounded-full bg-gradient-to-b from-[#e9fffc] via-[#b9eee8] to-[#82d8d0] " +
      "shadow-[inset_0_-6px_10px_rgba(30,130,140,.28),inset_0_3px_6px_rgba(255,255,255,1)]"
    : tone === "night"
      ? "absolute rounded-full bg-gradient-to-b from-[#e6e4ff] via-[#aaa9d2] to-[#7477a8] " +
        "shadow-[inset_0_-6px_10px_rgba(45,45,90,.35),inset_0_3px_6px_rgba(255,255,255,.8)]"
      : "absolute rounded-full bg-gradient-to-b from-white to-[#e8edf7] " +
        "shadow-[inset_0_-6px_10px_rgba(150,165,200,.35),inset_0_3px_6px_rgba(255,255,255,1)]";
  return (
    <div aria-hidden="true" className={`relative h-14 w-24 ${className}`} style={style} data-cloud-form={tone} data-cloud-layer={layer}>
      <div className={`${blob} left-0 bottom-0 h-10 w-10`} />
      <div className={`${blob} left-6 bottom-0 h-14 w-14`} />
      <div className={`${blob} right-0 bottom-0 h-9 w-9`} />
      <div className={`absolute -bottom-2 left-3 right-3 h-3 rounded-full blur-md ${tone === "poster" ? "bg-[#2aa6a4]/20" : tone === "night" ? "bg-[#45486f]/25" : "bg-slate-500/15"}`} />
    </div>
  );
}

// ─── Seagulls — flap via SMIL (CSS animation:none cannot stop SMIL,
// so the flap unmounts under reduced-motion, mirroring WeatherScene) ──

const BIRDS = [
  { a: 44, b: 12, dur: 17, delay: -3, size: 14, flap: 0.9 },
  { a: 58, b: 16, dur: 23, delay: -11, size: 11, flap: 1.1 },
  { a: 50, b: 14, dur: 20, delay: -16, size: 12, flap: 1.0 },
];

function BirdGlyph({ size, flap, color, flapping }: { size: number; flap: number; color: string; flapping: boolean }) {
  return (
    <svg viewBox="0 0 24 10" fill="none" style={{ width: size }}>
      <path d="M2 5 Q7 1 12 5 Q17 1 22 5" stroke={color} strokeWidth="1.8" strokeLinecap="round" opacity="0.7">
        {flapping && (
          <animate
            attributeName="d"
            dur={`${flap}s`}
            repeatCount="indefinite"
            calcMode="spline"
            keyTimes="0;0.5;1"
            keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
            values="M2 5 Q7 1 12 5 Q17 1 22 5;M2 5 Q7 7.5 12 5 Q17 7.5 22 5;M2 5 Q7 1 12 5 Q17 1 22 5"
          />
        )}
      </path>
    </svg>
  );
}

export function useWxMotionOk(): boolean {
  const [motionOk, setMotionOk] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotionOk(!mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return motionOk;
}

function finiteMeasurement(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function measurementLabel(value: number | null | undefined): string {
  const numeric = finiteMeasurement(value);
  return numeric == null ? "unavailable" : String(Math.round(numeric));
}

function posterSunPosition(progress: number | null): { x: number; y: number } | null {
  if (progress == null) return null;
  const p = Math.max(0, Math.min(1, progress));
  return { x: 42 + p * 236, y: 58 - Math.sin(p * Math.PI) * 42 };
}

function posterHorizon(progress: number | null): string | null {
  if (progress == null) return null;
  const p = Math.max(0, Math.min(1, progress));
  const left = 150 + p * 8;
  const middle = 166 - p * 12;
  const right = 130 + p * 10;
  return `M0 ${left}C68 ${middle} 126 ${left - 18} 194 ${right}C244 ${middle} 278 ${left - 8} 320 ${right - 12}V180H0Z`;
}

function fogOpacityFor(fogCode: boolean, visibility: number | null, humidity: number | null): number {
  const codeOpacity = fogCode ? 0.5 : 0;
  const visible = finiteMeasurement(visibility);
  const humid = finiteMeasurement(humidity);
  if (visible != null && visible < 8000) {
    return Math.max(codeOpacity, (1 - visible / 8000) * 0.55);
  }
  if (visible == null && humid != null && humid >= 82) {
    return Math.max(codeOpacity, Math.min(0.55, ((humid - 82) / 18) * 0.55));
  }
  return codeOpacity;
}

function PosterAccents({ scene, motionOk, sunProgress, cloudCover, precipitation }: { scene: WxScene; motionOk: boolean; sunProgress: number | null; cloudCover?: number | null; precipitation?: number | null }) {
  const sun = posterSunPosition(sunProgress);
  const horizon = posterHorizon(sunProgress);
  const numericCloud = finiteMeasurement(cloudCover);
  const numericPrecipitation = finiteMeasurement(precipitation);
  const cloudAccentOpacity = numericCloud == null || numericCloud <= 0 ? 0 : Math.min(1, 0.35 + numericCloud / 100);
  const precipitationAccentOpacity = numericPrecipitation == null || numericPrecipitation <= 0 ? 0 : Math.min(1, 0.35 + numericPrecipitation / 100);
  const rainAccentCount = numericPrecipitation == null || numericPrecipitation <= 0 ? 0 : Math.max(1, Math.min(4, Math.round(numericPrecipitation / 25)));
  const snowAccentCount = numericPrecipitation == null || numericPrecipitation <= 0 ? 0 : Math.max(1, Math.min(4, Math.round(numericPrecipitation / 25)));
  return (
    <svg
      key={scene}
      data-testid="wx-poster-accents"
      data-scene={scene}
      data-sun-progress={measurementLabel(sunProgress)}
      data-cloud-cover={measurementLabel(numericCloud)}
      data-precipitation={measurementLabel(numericPrecipitation)}
      viewBox="0 0 320 180"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
      style={motionOk ? { animation: "wxFadeIn 0.85s ease both" } : undefined}
    >
      {scene === "clear" && sun && (
        <>
          <circle data-weather-shape="sun" cx={sun.x} cy={sun.y} r="19" fill={WX_POSTER.sun} opacity="0.82" />
          <path data-weather-shape="sun-rays" d={`M${sun.x} ${sun.y - 30}v8M${sun.x} ${sun.y + 22}v8M${sun.x - 30} ${sun.y}h8M${sun.x + 22} ${sun.y}h8M${sun.x - 21} ${sun.y - 21}l6 6M${sun.x + 15} ${sun.y + 15}l6 6M${sun.x + 15} ${sun.y - 21}l-6 6M${sun.x - 21} ${sun.y + 15}l-6 6`} stroke={WX_POSTER.sun} strokeWidth="4" strokeLinecap="round" opacity="0.72" />
          {horizon && <path data-weather-shape="poster-horizon" d={horizon} fill={WX_POSTER.cloudMid} opacity="0.2" />}
        </>
      )}
      {scene === "cloudy" && cloudAccentOpacity > 0 && (
        <path data-weather-shape="cloud-bars" d="M24 42h62M48 66h92M18 90h54" stroke="#0F6673" strokeWidth="9" strokeLinecap="round" opacity={cloudAccentOpacity} />
      )}
      {scene === "rain" && rainAccentCount > 0 && (
        <g data-weather-shape="rain-diamonds" stroke="#244A8F" strokeWidth="4" strokeLinecap="round" opacity={precipitationAccentOpacity}>
          {["M34 18l-8 20", "M82 52l-8 20", "M260 24l-8 20", "M294 82l-8 20"].slice(0, rainAccentCount).map((path) => <path key={path} d={path} />)}
        </g>
      )}
      {scene === "snow" && snowAccentCount > 0 && (
        <g data-weather-shape="snow-diamonds" fill="none" stroke="#5B4B8A" strokeWidth="3" strokeLinecap="round" opacity={precipitationAccentOpacity}>
          {["m34 22 8 8-8 8-8-8Z", "m92 64 7 7-7 7-7-7Z", "m266 24 8 8-8 8-8-8Z", "m294 92 6 6-6 6-6-6Z"].slice(0, snowAccentCount).map((path) => <path key={path} fill="none" d={path} />)}
        </g>
      )}
      {scene === "storm" && (
        <g data-weather-shape="storm-bolt" opacity="0.68">
          <path d="m266 14-18 34h17l-5 30 25-40h-17Z" fill={WX_POSTER.storm} />
          {numericPrecipitation != null && numericPrecipitation > 0 && <path d="m54 28-6 14M84 70l-6 14" stroke={WX_POSTER.rain} strokeWidth="4" strokeLinecap="round" opacity={precipitationAccentOpacity} />}
        </g>
      )}
      {scene === "night" && (
        <path data-weather-shape="night-orbit" d="M246 20a25 25 0 1 0 18 39 28 28 0 0 1-18-39Z" fill={WX_POSTER.cloudLight} opacity="0.28" />
      )}
    </svg>
  );
}

// ─── Scene layer wired to the wx* keyframes ─────────────────────

export function SceneLayers({ scene, showFog = false, fogCode = showFog, showBirds, cloudCover, precipitation, wind, windDirection, humidity, visibility, sunProgress, paused = false }: {
  scene: WxScene;
  showFog?: boolean;
  fogCode?: boolean;
  showBirds: boolean;
  cloudCover?: number | null;
  precipitation?: number | null;
  wind?: number | null;
  windDirection?: number | null;
  humidity?: number | null;
  visibility?: number | null;
  sunProgress?: number | null;
  paused?: boolean;
}) {
  const motionOk = useWxMotionOk() && !paused;
  const numericCloudCover = finiteMeasurement(cloudCover);
  const cover = numericCloudCover == null ? 0 : Math.max(0, Math.min(100, numericCloudCover));
  const numericPrecipitation = finiteMeasurement(precipitation);
  const normalizedPrecipitation = numericPrecipitation == null ? null : Math.max(0, Math.min(100, numericPrecipitation));
  const numericWind = finiteMeasurement(wind);
  const numericWindDirection = finiteMeasurement(windDirection);
  const normalizedHumidity = finiteMeasurement(humidity);
  const normalizedVisibility = finiteMeasurement(visibility);
  const cloudCount = cover <= 0 ? 0 : cover >= (scene === "clear" ? 20 : 50) ? 2 : 1;
  const cloudTone = scene === "clear" ? "poster" : scene === "night" ? "night" : "day";
  const frontCloudOpacity = cloudCount > 0 ? (scene === "clear" ? cover * 0.009 : Math.min(0.9, 0.25 + cover * 0.0065)) : 0;
  const backCloudOpacity = cloudCount > 1 ? (scene === "clear" ? Math.max(0, (cover - 20) / 100) * 0.72 : Math.min(0.72, 0.18 + cover * 0.0054)) : 0;
  const driftDuration = numericWind != null && numericWind > 0 ? Math.max(16, 46 - numericWind) : null;
  const driftAnimation = motionOk && driftDuration != null;
  const isWet = scene === "rain" || scene === "storm";
  const rainCount = isWet && normalizedPrecipitation != null && normalizedPrecipitation > 0
    ? Math.max(1, Math.round((normalizedPrecipitation / 100) * 28))
    : 0;
  const snowCount = scene === "snow" && normalizedPrecipitation != null && normalizedPrecipitation > 0
    ? Math.max(1, Math.round((normalizedPrecipitation / 100) * 22))
    : 0;
  const rainSlant = numericWind != null && numericWindDirection != null
    ? Math.max(-14, Math.min(14, (numericWindDirection > 90 && numericWindDirection < 270 ? -1 : 1) * Math.min(numericWind * 0.7, 14)))
    : 0;
  const fogOpacity = fogOpacityFor(fogCode, normalizedVisibility, normalizedHumidity);
  return (
    <div
      data-testid="wx-scene-layers"
      data-scene={scene}
      data-motion={motionOk ? "running" : "paused"}
      data-sun-progress={measurementLabel(sunProgress)}
      data-precipitation={measurementLabel(normalizedPrecipitation)}
      data-wind={measurementLabel(numericWind)}
      className="absolute inset-0"
      aria-hidden="true"
    >
      <PosterAccents scene={scene} motionOk={motionOk} sunProgress={finiteMeasurement(sunProgress)} cloudCover={numericCloudCover} precipitation={normalizedPrecipitation} />

      {scene === "night" &&
        Array.from({ length: 18 }).map((_, i) => (
          <span
            key={i}
            className="absolute h-[3px] w-[3px] rounded-full bg-white"
            style={{
              left: `${(i * 37) % 100}%`,
              top: `${(i * 53) % 45}%`,
              animation: motionOk ? `wxStarTwinkle ${2.5 + (i % 4)}s ease-in-out ${i * 0.3}s infinite` : undefined,
            }}
          />
        ))}

      <div data-testid="wx-poster-clouds" data-cloud-cover={numericCloudCover == null ? "unavailable" : Math.round(cover)} className="absolute inset-0">
        <CloudPuff
          layer="front"
          tone={cloudTone}
          className="absolute top-12 left-[-12px] -rotate-6 scale-[1.35]"
          style={{ opacity: frontCloudOpacity, ...(driftAnimation && driftDuration != null ? { animation: `wxCloudDrift ${driftDuration}s ease-in-out infinite alternate` } : {}) }}
        />
        <CloudPuff
          layer="back"
          tone={cloudTone}
          className="absolute top-28 right-[-12px] rotate-3 scale-[1.15] blur-[1px]"
          style={{ opacity: backCloudOpacity, ...(driftAnimation && driftDuration != null ? { animation: `wxCloudDrift ${driftDuration + 12}s ease-in-out infinite alternate-reverse` } : {}) }}
        />
      </div>

      {rainCount > 0 && (
        <div data-weather-rain-layer style={{ transform: numericWind != null && numericWindDirection != null ? `rotate(${rainSlant}deg)` : undefined }}>
          {Array.from({ length: rainCount }).map((_, i) => (
            <span
              key={i}
              data-weather-precip="rain"
              data-precipitation={measurementLabel(normalizedPrecipitation)}
              className="absolute top-[-40px] h-10 w-[2px] rounded-full bg-gradient-to-b from-transparent via-white/80 to-white/20"
              style={{
                left: `${(i * 41) % 100}%`,
                animation: motionOk ? `wxRainStreak ${0.8 + (i % 5) * 0.12}s linear ${(i % 7) * 0.17}s infinite` : undefined,
              }}
            />
          ))}
        </div>
      )}

      {snowCount > 0 &&
        Array.from({ length: snowCount }).map((_, i) => (
          <span
            key={i}
            data-weather-precip="snow"
            data-precipitation={measurementLabel(normalizedPrecipitation)}
            className="absolute top-[-16px] rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,.9)]"
            style={{
              left: `${(i * 47) % 100}%`,
              width: 4 + (i % 3) * 2,
              height: 4 + (i % 3) * 2,
              animation: motionOk ? `wxSnowFall ${6 + (i % 5)}s linear ${(i % 9) * 0.6}s infinite` : undefined,
            }}
          />
        ))}

      {scene === "storm" && (
        <div
          className="absolute inset-0 bg-white mix-blend-overlay"
          style={motionOk ? { animation: "wxLightning 9s linear infinite" } : undefined}
        />
      )}

      {fogOpacity > 0 && (
        <div data-testid="wx-fog" data-fog-opacity={fogOpacity.toFixed(2)}>
          <div
            className="absolute inset-x-[-10%] bottom-0 h-40 bg-gradient-to-t from-white/60 to-transparent blur-xl"
            style={motionOk ? { animation: "wxFogDrift 30s ease-in-out infinite alternate" } : undefined}
          />
        </div>
      )}

      <div data-testid="wx-birds" className="absolute top-14 right-6 h-28 w-48" style={{ opacity: showBirds ? 1 : 0, transition: motionOk ? "opacity 1.2s ease" : "none" }} aria-hidden="true">
        {BIRDS.map((b, i) => (
          <div
            key={i}
            className="absolute left-1/2 top-1/2"
            style={{
              ["--wx-bird-a" as string]: `${b.a}px`,
              ["--wx-bird-b" as string]: `${b.b}px`,
              animation: motionOk ? `wxBirdOrbit ${b.dur}s linear ${b.delay}s infinite` : undefined,
            }}
          >
            <div style={{ transform: "translate(-50%, -50%)" }}>
              <BirdGlyph size={b.size} flap={b.flap} color="rgba(51,65,85,.75)" flapping={motionOk} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── WMO → toy scene ────────────────────────────────────────────

const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const STORM_CODES = new Set([95, 96, 99]);

export type WxScene = "clear" | "cloudy" | "rain" | "snow" | "storm" | "night";

export function wmoToScene(code: number, isDay: boolean): WxScene {
  let scene: WxScene;
  if (STORM_CODES.has(code)) scene = "storm";
  else if (SNOW_CODES.has(code)) scene = "snow";
  else if (RAIN_CODES.has(code)) scene = "rain";
  else if (code === 45 || code === 48 || code === 3) scene = "cloudy";
  else scene = "clear";
  // After dark the clear/cloudy skies collapse to night; precipitation
  // keeps its own mid-tone sky so rain/snow stay readable.
  if (!isDay && (scene === "clear" || scene === "cloudy")) return "night";
  return scene;
}

export type ConditionCode = "clear" | "partly" | "partly-night" | "cloudy" | "rain" | "storm" | "snow" | "fog" | "night";

export interface ConditionPresentation {
  label: string;
  icon: ConditionCode;
}

export function wmoCondition(code: number): { condition: string; emoji: string } {
  if (code === 0) return { condition: "Clear", emoji: "☀️" };
  if (code <= 2) return { condition: "Partly Cloudy", emoji: "⛅" };
  if (code === 3) return { condition: "Overcast", emoji: "☁️" };
  if (code <= 48) return { condition: "Foggy", emoji: "🌫️" };
  if (code <= 57) return { condition: "Drizzle", emoji: "🌦️" };
  if (code <= 67) return { condition: "Rainy", emoji: "🌧️" };
  if (code <= 77) return { condition: "Snowy", emoji: "❄️" };
  if (code <= 82) return { condition: "Rain Showers", emoji: "🌧️" };
  return { condition: "Thunderstorm", emoji: "⛈️" };
}

export function sceneToCondition(scene: WxScene, code: number, cloudCover?: number | null): ConditionCode {
  if (code === 45 || code === 48) return "fog";
  if (code === 3) return "cloudy";
  if (code === 1 || code === 2) {
    const cloudState = cloudCover === undefined || cloudCover === null
      ? "unknown"
      : finiteMeasurement(cloudCover) == null
        ? "unknown"
        : cloudCover <= 0
          ? "clear"
          : "partly";
    if (cloudState === "unknown") return scene === "night" ? "partly-night" : "partly";
    if (cloudState === "clear") return scene === "night" ? "night" : "clear";
    return scene === "night" ? "partly-night" : "partly";
  }
  if (scene === "night") return "night";
  if (scene === "storm") return "storm";
  if (scene === "snow") return "snow";
  if (scene === "rain") return "rain";
  if (scene === "cloudy") return "cloudy";
  return "clear";
}

export function conditionPresentation(scene: WxScene, code: number, cloudCover?: number | null, isDay = true): ConditionPresentation {
  const wmo = wmoCondition(code);
  const numericCloud = finiteMeasurement(cloudCover);
  let label = wmo.condition;
  if ((code === 1 || code === 2) && numericCloud != null && numericCloud <= 0) label = "Clear";
  if (code === 3) label = "Overcast";
  if (code === 45 || code === 48) label = "Foggy";
  if (code === 0 && !isDay) label = "Clear";
  return { label, icon: sceneToCondition(scene, code, cloudCover) };
}

// 5-day rows carry condition text (no WMO code), so map the text.
export function dayCondition(condition: string): ConditionCode {
  const c = condition.toLowerCase();
  if (c.includes("thunder")) return "storm";
  if (c.includes("snow")) return "snow";
  if (c.includes("fog")) return "fog";
  if (c.includes("drizzle") || c.includes("rain") || c.includes("shower")) return "rain";
  if (c.includes("partly")) return "partly";
  if (c.includes("clear")) return "clear";
  return "cloudy";
}

// ─── Clay icon set (inline clay styles — no dynamic Tailwind) ──

const clay = (from: string, to: string, shade: string): CSSProperties => ({
  background: `linear-gradient(to bottom, ${from}, ${to})`,
  boxShadow: `inset 0 3px 6px rgba(255,255,255,.95), inset 0 -6px 10px ${shade}, 0 10px 20px -8px ${shade}`,
});

export function Sun({ size = 64 }: { size?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{ width: size, height: size, ...clay("#fff4c8", "#ffb974", "rgba(230,120,40,.45)"), borderRadius: 9999 }}
      className="ring-1 ring-white/60"
    />
  );
}

export function Moon({ size = 64 }: { size?: number }) {
  const moonClay = clay("#fffbef", "#dcd4ff", "rgba(120,110,200,.4)");
  return (
    <div aria-hidden="true" className="relative" style={{ width: size, height: size }} data-testid="wx-moon">
      {/* faint earthshine disc beneath */}
      <div className="absolute inset-0 rounded-full" style={{ ...moonClay, opacity: 0.28 }} />
      {/* bright crescent: mask bites the upper-right — no background knowledge needed */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: moonClay.background,
          boxShadow: moonClay.boxShadow,
          WebkitMaskImage: `radial-gradient(circle at ${size * 0.82}px ${size * -0.04}px, transparent ${size * 0.52}px, black ${size * 0.53}px)`,
          maskImage: `radial-gradient(circle at ${size * 0.82}px ${size * -0.04}px, transparent ${size * 0.52}px, black ${size * 0.53}px)`,
        }}
      />
    </div>
  );
}

export function Cloud({ size = 80, tone = "day" }: { size?: number; tone?: "day" | "night" }) {
  const c =
    tone === "night"
      ? clay("#e9e6ff", "#b9b3e8", "rgba(90,80,160,.45)")
      : clay("#ffffff", "#e6ecf7", "rgba(140,155,195,.4)");
  const s = size / 80;
  return (
    <div aria-hidden="true" className="relative" style={{ width: size, height: size * 0.6 }}>
      <div className="absolute rounded-full" style={{ left: 0, bottom: 0, width: 34 * s, height: 34 * s, ...c }} />
      <div className="absolute rounded-full" style={{ left: 20 * s, bottom: 0, width: 46 * s, height: 46 * s, ...c }} />
      <div className="absolute rounded-full" style={{ right: 0, bottom: 0, width: 30 * s, height: 30 * s, ...c }} />
      <div className="absolute rounded-full" style={{ left: 12 * s, bottom: 0, width: 56 * s, height: 20 * s, ...c }} />
      <div className="absolute inset-x-3 -bottom-2 h-3 rounded-full bg-slate-500/15 blur-md" />
    </div>
  );
}

export function Drop({ size = 22, delay = 0 }: { size?: number; delay?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size * 1.3,
        animationDelay: `${delay}s`,
        borderRadius: "50% 50% 50% 50%/60% 60% 40% 40%",
        transform: "rotate(180deg)",
        ...clay("#dff1ff", "#8fc7ff", "rgba(60,120,200,.45)"),
      }}
    />
  );
}

export function Bolt({ size = 48 }: { size?: number }) {
  const id = useId();
  return (
    <svg aria-hidden="true" width={size} height={size * 1.3} viewBox="0 0 48 62" className="drop-shadow-[0_8px_16px_rgba(230,160,40,.45)]">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff2b8" />
          <stop offset="1" stopColor="#ffc857" />
        </linearGradient>
      </defs>
      <path
        d="M28 2 L6 34 H22 L18 60 L42 24 H26 Z"
        fill={`url(#${id})`}
        stroke="rgba(255,255,255,.7)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M26 6 L11 32" stroke="rgba(255,255,255,.8)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Flake({ size = 28 }: { size?: number }) {
  const arm =
    "absolute left-1/2 top-1/2 h-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-white to-[#cfe3ff] shadow-[0_0_6px_rgba(255,255,255,.9)]";
  return (
    <div aria-hidden="true" className="relative" style={{ width: size, height: size }}>
      {[0, 60, 120].map((d) => (
        <div key={d} className={arm} style={{ width: size, rotate: `${d}deg` }} />
      ))}
      <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
    </div>
  );
}

export function Fog({ width = 80 }: { width?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-1.5" style={{ width }}>
      {[1, 0.8, 0.6].map((w, i) => (
        <div
          key={i}
          style={{
            width: `${w * 100}%`,
            marginLeft: i % 2 ? "auto" : 0,
            opacity: 0.9 - i * 0.2,
            height: 12,
            borderRadius: 9999,
            ...clay("#ffffff", "#dde6f3", "rgba(140,155,195,.3)"),
          }}
        />
      ))}
    </div>
  );
}

export function Wind({ width = 72 }: { width?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={width * 0.6}
      viewBox="0 0 72 44"
      fill="none"
      strokeLinecap="round"
      strokeWidth="5"
      className="drop-shadow-[0_6px_12px_rgba(140,155,195,.35)]"
    >
      <path d="M4 14 H44 a7 7 0 1 0 -7 -7" stroke="#ffffff" />
      <path d="M4 26 H56 a7 7 0 1 1 -7 7" stroke="#e3ebf7" />
      <path d="M4 38 H30" stroke="#ffffff" />
    </svg>
  );
}

export function Condition({ code, size = 80 }: { code: ConditionCode; size?: number }) {
  switch (code) {
    case "clear":
      return <Sun size={size * 0.8} />;
    case "cloudy":
      return <Cloud size={size} />;
    case "partly":
      return (
        <div className="relative" style={{ width: size, height: size * 0.75 }}>
          <div className="absolute top-0 right-2">
            <Sun size={size * 0.5} />
          </div>
          <div className="absolute bottom-0 left-0">
            <Cloud size={size * 0.85} />
          </div>
        </div>
      );
    case "partly-night":
      return (
        <div className="relative" style={{ width: size, height: size * 0.75 }}>
          <div className="absolute top-0 right-2">
            <Moon size={size * 0.5} />
          </div>
          <div className="absolute bottom-0 left-0">
            <Cloud size={size * 0.85} tone="night" />
          </div>
        </div>
      );
    case "rain":
      return (
        <div className="relative" style={{ width: size, height: size }}>
          <Cloud size={size} />
          <div className="absolute inset-x-3 bottom-0 flex justify-between">
            <Drop size={size * 0.18} />
            <Drop size={size * 0.18} delay={0.3} />
            <Drop size={size * 0.18} delay={0.6} />
          </div>
        </div>
      );
      case "storm":
        return (
          <div className="relative" style={{ width: size, height: size }}>
          <Cloud size={size} tone="night" />
          <div className="absolute left-1/2 -translate-x-1/2 bottom-0">
            <Bolt size={size * 0.5} />
          </div>
        </div>
      );
    case "snow":
      return (
        <div className="relative" style={{ width: size, height: size }}>
          <Cloud size={size} />
          <div className="absolute inset-x-4 bottom-0 flex justify-between">
            <Flake size={size * 0.2} />
            <Flake size={size * 0.16} />
            <Flake size={size * 0.2} />
          </div>
        </div>
      );
    case "fog":
      return <Fog width={size} />;
    case "night":
      return <Moon size={size * 0.8} />;
  }
}
