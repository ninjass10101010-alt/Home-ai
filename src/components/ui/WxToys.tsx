"use client";

import { CSSProperties, useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import { moonLitPath } from "@/lib/weather-astro";
import type { SkyPhase } from "@/lib/weather-scene-params";
import { cloudVariant, backCloudVariant, starOpacity } from "@/lib/weather-scene-params";
import { MONSTER, WX_POSTER } from "./wx-tokens";

// WxToys — the toy weather kit: SunOrb, CloudPuff, seagull Birds,
// keyframe-wired SceneLayers, and the Monster capsule Condition icon set.
// Gradients live in inline styles: Tailwind JIT cannot generate dynamic
// from-[${…}] / opacity-${n} classes, so clay never uses them.

// Phase-tinted sun disc — a butter-yellow disc in an ember sky was a visual
// falsehood. Fixed values, not data-derived (spec §7).
const SUN_DISC: Record<SkyPhase, { fill: string; haloOpacity: number }> = {
  dawn: { fill: "#FFAB40", haloOpacity: 0.35 },
  day: { fill: "#FFD166", haloOpacity: 0.2 },
  dusk: { fill: "#FF7A3D", haloOpacity: 0.35 },
  night: { fill: "#FFD166", haloOpacity: 0.2 },
};

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

// Cloud tone pairs, from the clay palette the poster already uses.
const CLOUD_TONES: Record<"day" | "poster" | "night" | "heavy-snow", { hi: string; lo: string; shade: string }> = {
  poster: { hi: "#E9FFFC", lo: "#82D8D0", shade: "rgba(42, 166, 164, 0.20)" },
  day: { hi: "#FFFFFF", lo: "#E8EDF7", shade: "rgba(150, 165, 200, 0.35)" },
  night: { hi: "#E6E4FF", lo: "#7477A8", shade: "rgba(69, 72, 111, 0.25)" },
  "heavy-snow": { hi: "#E8F0FB", lo: "#8DA2BF", shade: "rgba(52, 73, 99, 0.30)" },
};

// Blob layouts per density variant — [cx, cy, r] triples on a 200×120 strip,
// from the reference project's CloudShape (soft-highlight ellipse follows blob 1).
const CLOUD_VARIANTS: [number, number, number][][] = [
  [[48, 78, 34], [92, 58, 44], [140, 74, 36], [110, 88, 30], [72, 90, 26]],
  [[40, 82, 30], [80, 62, 40], [124, 62, 38], [160, 84, 28], [100, 90, 32]],
  [[56, 80, 36], [104, 66, 46], [150, 82, 32], [80, 94, 28]],
];

export function CloudPuff({ className = "", style, tone = "day", layer, variant = 0, bob = false }: {
  className?: string;
  style?: CSSProperties;
  tone?: "day" | "poster" | "night" | "heavy-snow";
  layer?: "front" | "back";
  variant?: 0 | 1 | 2;
  bob?: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const t = CLOUD_TONES[tone];
  const blobs = CLOUD_VARIANTS[variant];
  return (
    <div aria-hidden="true" className={`relative h-14 w-24 ${className}`} style={style} data-cloud-form={tone} data-cloud-layer={layer}>
      <svg
        viewBox="0 0 200 120"
        className="h-full w-full overflow-visible"
        style={bob ? { animation: "wx-bob 4.2s ease-in-out infinite", transformBox: "fill-box", transformOrigin: "center" } : undefined}
      >
        <defs>
          <linearGradient id={`${uid}-cloud`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={t.hi} />
            <stop offset="100%" stopColor={t.lo} />
          </linearGradient>
          <filter id={`${uid}-soft`} x="-20%" y="-20%" width="140%" height="150%">
            <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#000" floodOpacity="0.18" />
          </filter>
        </defs>
        <g fill={`url(#${uid}-cloud)`} filter={`url(#${uid}-soft)`}>
          {blobs.map(([cx, cy, r], i) => (
            <circle key={i} cx={cx} cy={cy} r={r} />
          ))}
          <rect x="30" y="72" width="140" height="38" rx="19" />
        </g>
        <g fill="rgba(255,255,255,0.35)">
          <ellipse cx={blobs[1][0] - 8} cy={blobs[1][1] - blobs[1][2] * 0.45} rx={blobs[1][2] * 0.55} ry={blobs[1][2] * 0.28} />
        </g>
      </svg>
      <div className="absolute -bottom-2 left-3 right-3 h-3 rounded-full blur-md" style={{ background: t.shade }} />
    </div>
  );
}

// ─── Seagulls — flap via SMIL (CSS animation:none cannot stop SMIL,
// so the flap unmounts under reduced-motion) ──

const BIRDS = [
  { a: 44, b: 12, dur: 15, delay: -2, size: 14, flap: 0.75 },
  { a: 58, b: 16, dur: 19, delay: -9, size: 11, flap: 0.95 },
  { a: 50, b: 14, dur: 17, delay: -14, size: 12, flap: 0.85 },
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

/** True when the poster itself paints the sun character (see PosterAccents).
    The hero and the details modal must not add a second disc on top of it —
    the same rule the night moon already follows with the star glyph. */
export function posterCarriesSun(scene: WxScene, sunProgress: number | null): boolean {
  return scene === "clear" && posterSunPosition(sunProgress) != null;
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

function PosterAccents({ scene, heavySnow = false, motionOk, sunProgress, cloudCover, precipitation, skyPhase, moonPhase = 0.5, moonIllumination = 1 }: { scene: WxScene; heavySnow?: boolean; motionOk: boolean; sunProgress: number | null; cloudCover?: number | null; precipitation?: number | null; skyPhase?: SkyPhase; moonPhase?: number; moonIllumination?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const phase: SkyPhase = skyPhase ?? (scene === "night" ? "night" : "day");
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
      key={`${scene}-${heavySnow ? "heavy-snow" : "normal"}`}
      data-testid="wx-poster-accents"
      data-scene={scene}
      data-heavy-snow={heavySnow ? "true" : "false"}
      data-sun-progress={measurementLabel(sunProgress)}
      data-cloud-cover={measurementLabel(numericCloud)}
      data-precipitation={measurementLabel(numericPrecipitation)}
      viewBox="0 0 320 180"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
      style={motionOk ? { animation: "wxFadeIn 0.55s ease both" } : undefined}
    >
      <defs>
        <clipPath id={`${uid}-moonclip`}>
          <circle r={21} />
        </clipPath>
      </defs>
      {scene === "clear" && sun && (
        <>
          <g data-weather-character="sun">
            <circle
              cx={sun.x}
              cy={sun.y}
              r={30}
              fill={SUN_DISC[phase].fill}
              opacity={SUN_DISC[phase].haloOpacity}
              style={motionOk ? { animation: "wx-breathe 9s ease-in-out infinite", transformBox: "fill-box", transformOrigin: "center" } : undefined}
            />
            <circle data-weather-shape="sun" cx={sun.x} cy={sun.y} r={19} fill={SUN_DISC[phase].fill} opacity="0.92" />
          </g>
          <g
            data-weather-shape="sun-rays"
            stroke={SUN_DISC[phase].fill}
            strokeWidth="4"
            strokeLinecap="round"
            opacity="0.72"
            style={motionOk ? { animation: "wx-sunrays 40s linear infinite", transformBox: "view-box", transformOrigin: `${sun.x}px ${sun.y}px` } : undefined}
          >
            {Array.from({ length: 8 }, (_, i) => {
              const ang = (i * Math.PI) / 4;
              return (
                <line
                  key={i}
                  x1={sun.x + Math.cos(ang) * 28}
                  y1={sun.y + Math.sin(ang) * 28}
                  x2={sun.x + Math.cos(ang) * 36}
                  y2={sun.y + Math.sin(ang) * 36}
                />
              );
            })}
          </g>
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
        <g data-weather-shape="snow-diamonds" fill="none" stroke={heavySnow ? "#E6F0FF" : "#5B4B8A"} strokeWidth="3" strokeLinecap="round" opacity={precipitationAccentOpacity}>
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
        <g data-weather-character="moon" data-moon-phase={moonPhase.toFixed(4)} data-moon-illumination={moonIllumination.toFixed(2)}>
          <g transform="translate(253 42)">
            {/* dark disc always renders — a new moon leaves no hole in the poster */}
            <circle r={22} fill="#242E56" opacity="0.88" />
            <path data-weather-shape="night-orbit" d={moonLitPath(moonPhase, 21)} fill="#F1EEE3" opacity="0.92" />
            {/* craters — constants, clipped to the disc, multiply-blended */}
            <g opacity="0.35" clipPath={`url(#${uid}-moonclip)`} style={{ mixBlendMode: "multiply" }}>
              <circle cx={-7} cy={-6} r={3.8} fill="#9AA3C4" />
              <circle cx={5} cy={3} r={5} fill="#9AA3C4" />
              <circle cx={-3} cy={9} r={2.4} fill="#9AA3C4" />
              <circle cx={10} cy={-10} r={2} fill="#9AA3C4" />
              <circle cx={-13} cy={4} r={1.8} fill="#9AA3C4" />
            </g>
            <circle r={21} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
          </g>
        </g>
      )}
    </svg>
  );
}

// ─── Scene layer wired to the wx* keyframes ─────────────────────

export function SceneLayers({ scene, heavySnow = false, showFog = false, fogCode = showFog, showBirds, cloudCover, precipitation, wind, windDirection, humidity, visibility, sunProgress, skyPhase, moonPhase, moonIllumination, paused = false }: {
  scene: WxScene;
  heavySnow?: boolean;
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
  skyPhase?: SkyPhase;
  moonPhase?: number;
  moonIllumination?: number;
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
  const cloudTone = heavySnow ? "heavy-snow" : scene === "clear" ? "poster" : scene === "night" ? "night" : "day";
  const frontCloudOpacity = cloudCount > 0 ? (scene === "clear" ? cover * 0.009 : Math.min(0.9, 0.25 + cover * 0.0065)) : 0;
  const backCloudOpacity = cloudCount > 1 ? (scene === "clear" ? Math.max(0, (cover - 20) / 100) * 0.72 : Math.min(0.72, 0.18 + cover * 0.0054)) : 0;
  const driftDuration = numericWind != null && numericWind > 0 ? Math.max(12, 34 - numericWind) : null;
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
      data-heavy-snow={heavySnow ? "true" : "false"}
      data-motion={motionOk ? "running" : "paused"}
      data-sun-progress={measurementLabel(sunProgress)}
      data-precipitation={measurementLabel(normalizedPrecipitation)}
      data-wind={measurementLabel(numericWind)}
      className="absolute inset-0"
      style={{ containerType: "size" }}
      aria-hidden="true"
    >
      <PosterAccents scene={scene} heavySnow={heavySnow} motionOk={motionOk} sunProgress={finiteMeasurement(sunProgress)} cloudCover={numericCloudCover} precipitation={normalizedPrecipitation} skyPhase={skyPhase} moonPhase={moonPhase} moonIllumination={moonIllumination} />

      {scene === "night" && (
        <div className="absolute inset-0" style={{ opacity: starOpacity(numericCloudCover) }}>
          {Array.from({ length: 42 }, (_, i) => (
            <span
              key={i}
              className="absolute rounded-full bg-white"
              style={{
                left: `${(i * 37) % 100}%`,
                top: `${(i * 53) % 45}%`,
                width: 2 + (i % 3),
                height: 2 + (i % 3),
                animation: motionOk ? `wxStarTwinkle ${1.8 + (i % 3)}s ease-in-out ${i * 0.3}s infinite` : undefined,
              }}
            />
          ))}
          {starOpacity(numericCloudCover) === 1 && (
            <span
              aria-hidden="true"
              className="absolute h-[2px] w-[90px] rounded-full bg-gradient-to-r from-transparent via-white/90 to-white"
              style={{
                left: "72%",
                top: "12%",
                transform: "rotate(-24deg)",
                opacity: 0,
                animation: motionOk ? "wx-shoot 8s ease-in 3s infinite" : undefined,
              }}
            />
          )}
        </div>
      )}

      <div data-testid="wx-poster-clouds" data-cloud-cover={numericCloudCover == null ? "unavailable" : Math.round(cover)} data-visible={cover > 0 ? "true" : "false"} className="absolute inset-0">
        <CloudPuff
          layer="front"
          tone={cloudTone}
          variant={cloudVariant(numericCloudCover)}
          bob={driftAnimation}
          className="absolute top-12 left-[-12px] -rotate-6 scale-[1.35]"
          style={{ opacity: frontCloudOpacity, visibility: frontCloudOpacity > 0 ? "visible" : "hidden", ...(driftAnimation && driftDuration != null ? ({ animation: `wx-drift ${driftDuration}s linear infinite`, "--travel": "calc(100cqw + 140px)" } as CSSProperties) : {}) }}
        />
        <CloudPuff
          layer="back"
          tone={cloudTone}
          variant={backCloudVariant(cloudVariant(numericCloudCover))}
          bob={driftAnimation}
          className="absolute top-28 right-[-12px] rotate-3 scale-[1.15] blur-[1px]"
          style={{ opacity: backCloudOpacity, visibility: backCloudOpacity > 0 ? "visible" : "hidden", ...(driftAnimation && driftDuration != null ? ({ animation: `wx-drift ${driftDuration + 12}s linear ${-(driftDuration + 12) / 2}s infinite`, "--travel": "calc(100cqw + 140px)" } as CSSProperties) : {}) }}
        />
      </div>

      {rainCount > 0 && (
        <div data-weather-rain-layer style={{ transform: numericWind != null && numericWindDirection != null ? `rotate(${rainSlant}deg)` : undefined }}>
          {Array.from({ length: rainCount }, (_, i) => (
            <span
              key={i}
              data-weather-precip="rain"
              data-precipitation={measurementLabel(normalizedPrecipitation)}
              className="absolute top-[-40px] w-[2px] rounded-full bg-gradient-to-b from-transparent via-white/80 to-white/20"
              style={{
                left: `${(i * 41) % 100}%`,
                height: 14 + ((i * 7) % 3) * 6,
                opacity: 0.45 + ((i * 13) % 40) / 100,
                animation: motionOk
                  ? `wx-fall ${0.5 + ((i * 15) % 34) / 100}s linear ${-(((i * 31) % 100) / 50)}s infinite`
                  : undefined,
                ["--travel" as string]: "115cqh",
              } as CSSProperties}
            />
          ))}
        </div>
      )}

      {snowCount > 0 &&
        Array.from({ length: snowCount }, (_, i) => (
          <span
            key={i}
            data-weather-precip="snow"
            data-precipitation={measurementLabel(normalizedPrecipitation)}
            className="absolute top-[-16px] rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,.9)]"
            style={{
              left: `${(i * 47) % 100}%`,
              width: 3 + ((i * 5) % 5),
              height: 3 + ((i * 5) % 5),
              opacity: 0.55 + ((i * 9) % 45) / 100,
              filter: (i * 3) % 10 > 7 ? "blur(1.2px)" : undefined,
              animation: motionOk
                ? `wx-snowfall ${5.6 + ((i * 7) % 5)}s linear ${-((i * 11) % 13)}s infinite, wx-sway ${2.6 + ((i * 3) % 4)}s ease-in-out ${-((i * 11) % 13)}s infinite alternate`
                : undefined,
              ["--travel" as string]: "115cqh",
            } as CSSProperties}
          />
        ))}

      {scene === "storm" && (
        <div
          className="absolute inset-0 bg-white mix-blend-overlay"
          style={motionOk ? { animation: "wxLightning 6.5s linear infinite" } : undefined}
        />
      )}
      {scene === "storm" && (
        <svg
          aria-hidden="true"
          viewBox="0 0 40 120"
          className="absolute top-0 h-[70%] w-auto"
          style={{
            left: "62%",
            opacity: 0,
            filter: "drop-shadow(0 0 8px rgba(255,255,255,0.95)) drop-shadow(0 0 22px rgba(170,190,255,0.9))",
            animation: motionOk ? "wx-bolt 6.5s linear infinite" : undefined,
          }}
        >
          <path d="M22 0 L6 56 L18 56 L10 120 L36 44 L23 44 L34 0 Z" fill="#FFFDF0" stroke="rgba(190,205,255,0.9)" strokeWidth="1.5" />
        </svg>
      )}

      {fogOpacity > 0 && (
        <div data-testid="wx-fog" data-fog-opacity={fogOpacity.toFixed(2)}>
          <div
            className="absolute inset-x-[-10%] bottom-0 h-40 bg-gradient-to-t from-white/60 to-transparent blur-xl"
            style={motionOk ? { animation: "wx-fogdrift 22s ease-in-out infinite alternate" } : undefined}
          />
          <div
            className="absolute inset-x-[-20%] bottom-10 h-32 bg-gradient-to-t from-white/45 to-transparent blur-xl"
            style={motionOk ? { animation: "wx-fogdrift 19s ease-in-out -7s infinite alternate" } : undefined}
          />
          <div
            className="absolute inset-x-[-15%] bottom-20 h-28 bg-gradient-to-t from-white/35 to-transparent blur-xl"
            style={motionOk ? { animation: "wx-fogdrift 28s ease-in-out -15s infinite alternate" } : undefined}
          />
        </div>
      )}

      <div data-testid="wx-birds" data-visible={showBirds ? "true" : "false"} className="absolute top-14 right-6 h-28 w-48" style={{ opacity: showBirds ? 1 : 0, visibility: showBirds ? "visible" : "hidden", transition: motionOk ? "opacity 1.2s ease" : "none" }} aria-hidden="true">
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
  if (code === 85 || code === 86) return { condition: "Snow Showers", emoji: "❄️" };
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

// ─── Monster capsule icon set (Amendment A grammar) ─────────────
// Every glyph is fat capsule segments (round-capped strokes), joint knobs
// where segments meet, balloon-knot nubs at select ends, and white glints —
// the locked monster-v3 language. Condition icons are face-free sculptural
// silhouettes; only the hero digits carry faces (one sleeping face per
// glyph, one peering eyeball across the whole hero number).

function SunG() {
  return (
    <>
      {Array.from({ length: 8 }, (_, i) => {
        const ang = (i * Math.PI) / 4;
        return (
          <line
            key={i}
            x1={50 + Math.cos(ang) * 31}
            y1={46 + Math.sin(ang) * 31}
            x2={50 + Math.cos(ang) * 40}
            y2={46 + Math.sin(ang) * 40}
            stroke={MONSTER.orange}
            strokeWidth="7"
            strokeLinecap="round"
          />
        );
      })}
      <circle cx="50" cy="46" r="24" fill={MONSTER.orange} />
      <circle cx="67" cy="63" r="6" fill={MONSTER.knotOrange} />
      <ellipse cx="42" cy="37" rx="7" ry="4.5" fill={MONSTER.glint} opacity="0.5" />
    </>
  );
}

type CloudTone = "day" | "night" | "snow";

function CloudG({ tone }: { tone: CloudTone }) {
  const main = tone === "night" ? MONSTER.purple : tone === "snow" ? MONSTER.glint : MONSTER.teal;
  const shade = tone === "snow" ? MONSTER.teal : MONSTER.blue;
  return (
    <>
      <circle cx="34" cy="42" r="16" fill={main} />
      <circle cx="55" cy="30" r="21" fill={main} />
      <circle cx="74" cy="44" r="14" fill={main} />
      <rect x="20" y="38" width="58" height="24" rx="12" fill={main} />
      <circle cx="38" cy="56" r="11" fill={shade} opacity="0.9" />
      <circle cx="62" cy="58" r="8" fill={shade} opacity="0.75" />
      <circle cx="48" cy="22" r="5" fill={MONSTER.glint} opacity="0.5" />
    </>
  );
}

function DropsG() {
  return (
    <g strokeLinecap="round" strokeWidth="9">
      <line x1="36" y1="60" x2="36" y2="74" stroke={MONSTER.blue} />
      <line x1="52" y1="66" x2="52" y2="84" stroke={MONSTER.teal} />
      <line x1="68" y1="60" x2="68" y2="74" stroke={MONSTER.blue} />
    </g>
  );
}

function BoltG() {
  return (
    <>
      <path
        d="M55 50 L40 74 H52 L46 92 L67 66 H54 Z"
        fill={MONSTER.orange}
        stroke={MONSTER.orange}
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <circle cx="46" cy="90" r="4" fill={MONSTER.knotOrange} />
      <path d="M47 70 L51 64" stroke={MONSTER.glint} strokeWidth="3.5" strokeLinecap="round" opacity="0.55" />
    </>
  );
}

function SnowflakeG({ x, y, s = 9 }: { x: number; y: number; s?: number }) {
  return (
    <g stroke={MONSTER.glint} strokeWidth="3.5" strokeLinecap="round">
      {[0, 60, 120].map((d) => {
        const rad = (d * Math.PI) / 180;
        return <line key={d} x1={x - Math.cos(rad) * s} y1={y - Math.sin(rad) * s} x2={x + Math.cos(rad) * s} y2={y + Math.sin(rad) * s} />;
      })}
      <circle cx={x} cy={y} r="3.2" fill={MONSTER.teal} stroke="none" />
    </g>
  );
}

function FogG() {
  return (
    <>
      <line x1="24" y1="16" x2="80" y2="16" stroke={MONSTER.purple} strokeWidth="12" strokeLinecap="round" />
      <line x1="32" y1="34" x2="76" y2="34" stroke={MONSTER.teal} strokeWidth="12" strokeLinecap="round" />
      <line x1="26" y1="52" x2="62" y2="52" stroke={MONSTER.blue} strokeWidth="12" strokeLinecap="round" />
      <rect x="32" y="12" width="14" height="5" rx="2.5" fill={MONSTER.glint} opacity="0.5" />
      <rect x="40" y="30" width="12" height="5" rx="2.5" fill={MONSTER.glint} opacity="0.45" />
    </>
  );
}

// The night-star cream tones are NightStars' own (grandfathered from the
// pre-Monster glyph — night icons keep their established palette).
function StarClusterG() {
  return (
    <>
      <path d="m18 6 2.4 7.2L28 16l-7.6 2.8L18 26l-2.4-7.2L8 16l7.6-2.8L18 6Z" fill="#FFF9E6" />
      <path d="m34 23 1.6 4.8L41 30l-5.4 2.2L34 37l-1.6-4.8L27 30l5.4-2.2L34 23Z" fill="#F6D7A8" />
      <circle cx="12" cy="34" r="2" fill="#FFF9E6" />
      <circle cx="29" cy="10" r="1.5" fill="#FFF9E6" />
    </>
  );
}

function NightStars({ size = 64 }: { size?: number }) {
  return (
    <svg
      data-weather-icon="night-stars"
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
    >
      <StarClusterG />
    </svg>
  );
}

// Standalone Monster primitives (export surface kept stable; Condition
// composes the same fragments into its condition svgs).
export function Sun({ size = 64 }: { size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 100 100"><SunG /></svg>;
}

export function Cloud({ size = 80, tone = "day" }: { size?: number; tone?: "day" | "night" }) {
  return (
    <svg aria-hidden="true" width={size} height={size * 0.72} viewBox="0 0 100 72">
      <CloudG tone={tone === "night" ? "night" : "day"} />
    </svg>
  );
}

export function Drop({ size = 22, delay = 0 }: { size?: number; delay?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size * 1.3} viewBox="0 0 22 30" style={{ animationDelay: `${delay}s` }}>
      <line x1="11" y1="9" x2="11" y2="22" stroke={MONSTER.blue} strokeWidth="13" strokeLinecap="round" />
      <circle cx="11" cy="7" r="3.5" fill={MONSTER.teal} />
    </svg>
  );
}

export function Bolt({ size = 48 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size * 1.3} viewBox="0 0 100 130">
      <path
        d="M55 6 L38 38 H52 L44 88 L70 44 H54 Z"
        fill={MONSTER.orange}
        stroke={MONSTER.orange}
        strokeWidth="8"
        strokeLinejoin="round"
      />
      <circle cx="44" cy="84" r="5" fill={MONSTER.knotOrange} />
      <path d="M50 22 L42 36" stroke={MONSTER.glint} strokeWidth="4" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

export function Flake({ size = 28 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 28 28">
      <SnowflakeG x={14} y={14} s={10} />
    </svg>
  );
}

export function Fog({ width = 80 }: { width?: number }) {
  return <svg aria-hidden="true" width={width} height={width * 0.6} viewBox="0 0 100 60"><FogG /></svg>;
}

export function Wind({ width = 72 }: { width?: number }) {
  return (
    <svg aria-hidden="true" width={width} height={width * 0.6} viewBox="0 0 72 44" fill="none" strokeLinecap="round" strokeWidth="7">
      <path d="M6 12 H44 a7 7 0 1 0 -7 -7" stroke={MONSTER.teal} />
      <path d="M6 24 H56 a7 7 0 1 1 -7 7" stroke={MONSTER.blue} />
      <path d="M6 36 H30" stroke={MONSTER.purple} />
    </svg>
  );
}

// ─── MonsterDigit — the capsule-grammar hero digit set ───────────
// Geometry extrapolated from the locked monster-v3 reference glyphs
// ("4", "5", "7", "2"): every digit is 2–5 capsule segments + knobs +
// knots + glints on a fixed 200×320 box (tabular alignment), with one
// sleeping face (or, for the hero's single peering digit, an eyeball).

const DIGIT_VIEW_W = 200;
const DIGIT_VIEW_H = 320;
const DIGIT_ASPECT = DIGIT_VIEW_W / DIGIT_VIEW_H;

function DigitSleepFace({ x, y, ink, rotate = 0 }: { x: number; y: number; ink: string; rotate?: number }) {
  return (
    <g transform={rotate ? `rotate(${rotate} ${x} ${y})` : undefined} stroke={ink} strokeWidth="5" fill="none" strokeLinecap="round">
      <path d={`M${x} ${y} q8 9 16 0`} />
      <path d={`M${x + 6} ${y + 15} q6 6 12 0`} />
    </g>
  );
}

function DigitEye({ x, y, r = 22 }: { x: number; y: number; r?: number }) {
  return (
    <>
      <circle cx={x} cy={y} r={r} fill={MONSTER.glint} />
      <circle cx={x + r / 6} cy={y + r / 6} r={r * 0.42} fill={MONSTER.pupil} />
      <circle cx={x + r / 3} cy={y - r / 8} r={r * 0.15} fill={MONSTER.glint} />
    </>
  );
}

type DigitGlyph = (peering: boolean) => ReactNode;

const MONSTER_DIGITS: Record<string, DigitGlyph> = {
  // 0 — two capsule loops (red left arc, blue right arc) + orange/teal knobs
  "0": (peering) => (
    <>
      <path d="M100 66 A56 94 0 0 0 100 254" stroke={MONSTER.red} strokeWidth="44" fill="none" strokeLinecap="round" />
      <path d="M100 66 A56 94 0 0 1 100 254" stroke={MONSTER.blue} strokeWidth="44" fill="none" strokeLinecap="round" />
      <circle cx="100" cy="66" r="26" fill={MONSTER.orange} />
      <circle cx="100" cy="254" r="26" fill={MONSTER.teal} />
      <circle cx="132" cy="94" r="6" fill={MONSTER.glint} opacity="0.5" />
      <rect x="54" y="200" width="10" height="22" rx="5" fill={MONSTER.glint} opacity="0.5" />
      {peering ? <DigitEye x={128} y={180} r={22} /> : <DigitSleepFace x={148} y={152} ink={MONSTER.inkBlue} />}
    </>
  ),
  // 1 — teal flag + blue stem + orange foot, orange joint knob
  "1": (peering) => (
    <>
      <line x1="58" y1="112" x2="100" y2="62" stroke={MONSTER.teal} strokeWidth="40" strokeLinecap="round" />
      <line x1="100" y1="62" x2="100" y2="268" stroke={MONSTER.blue} strokeWidth="50" strokeLinecap="round" />
      <line x1="100" y1="268" x2="136" y2="268" stroke={MONSTER.orange} strokeWidth="38" strokeLinecap="round" />
      <circle cx="58" cy="112" r="22" fill={MONSTER.teal} />
      <circle cx="100" cy="62" r="24" fill={MONSTER.orange} />
      <circle cx="136" cy="268" r="9" fill={MONSTER.knotOrange} />
      <rect x="86" y="128" width="10" height="24" rx="5" fill={MONSTER.glint} opacity="0.5" />
      {peering ? <DigitEye x={100} y={182} r={20} /> : <DigitSleepFace x={80} y={172} ink={MONSTER.inkBlue} />}
    </>
  ),
  // 2 — mockup "2": orange bar + teal nub, red curve, blue stem, purple base
  "2": (peering) => (
    <>
      <line x1="58" y1="74" x2="158" y2="74" stroke={MONSTER.orange} strokeWidth="46" strokeLinecap="round" />
      <circle cx="58" cy="74" r="25" fill={MONSTER.teal} />
      <path d="M106 102 C 168 108, 162 150, 118 174 L 92 194" stroke={MONSTER.red} strokeWidth="44" fill="none" strokeLinecap="round" />
      <line x1="92" y1="194" x2="92" y2="264" stroke={MONSTER.blue} strokeWidth="44" strokeLinecap="round" />
      <line x1="74" y1="264" x2="152" y2="264" stroke={MONSTER.purple} strokeWidth="40" strokeLinecap="round" />
      <circle cx="74" cy="264" r="10" fill={MONSTER.knotPurple} />
      <rect x="72" y="62" width="16" height="8" rx="4" fill={MONSTER.glint} opacity="0.5" />
      <circle cx="112" cy="148" r="5" fill={MONSTER.glint} opacity="0.55" />
      {peering ? <DigitEye x={128} y={136} r={20} /> : <DigitSleepFace x={96} y={68} ink={MONSTER.inkOrange} />}
    </>
  ),
  // 3 — two open arc capsules (red upper bowl, blue lower bowl) + teal joint
  "3": (peering) => (
    <>
      <path d="M84 158 C 145 158, 145 66, 84 66" stroke={MONSTER.red} strokeWidth="42" fill="none" strokeLinecap="round" />
      <path d="M88 162 C 152 162, 152 258, 88 258" stroke={MONSTER.blue} strokeWidth="44" fill="none" strokeLinecap="round" />
      <circle cx="86" cy="160" r="30" fill={MONSTER.teal} />
      <circle cx="84" cy="66" r="9" fill={MONSTER.knotRed} />
      <circle cx="118" cy="92" r="5.5" fill={MONSTER.glint} opacity="0.5" />
      <circle cx="128" cy="242" r="5" fill={MONSTER.glint} opacity="0.5" />
      {peering ? <DigitEye x={136} y={200} r={20} /> : <DigitSleepFace x={134} y={192} ink={MONSTER.inkBlue} rotate={90} />}
    </>
  ),
  // 4 — mockup "4": teal roof, red/blue pillars, purple crossbar, orange foot
  "4": (peering) => (
    <>
      <line x1="66" y1="92" x2="134" y2="92" stroke={MONSTER.teal} strokeWidth="50" strokeLinecap="round" />
      <line x1="66" y1="100" x2="66" y2="224" stroke={MONSTER.red} strokeWidth="52" strokeLinecap="round" />
      <line x1="134" y1="100" x2="134" y2="272" stroke={MONSTER.blue} strokeWidth="52" strokeLinecap="round" />
      <line x1="34" y1="228" x2="166" y2="228" stroke={MONSTER.purple} strokeWidth="44" strokeLinecap="round" />
      <line x1="134" y1="272" x2="168" y2="272" stroke={MONSTER.orange} strokeWidth="38" strokeLinecap="round" />
      <circle cx="34" cy="228" r="11" fill={MONSTER.knotPurple} />
      <circle cx="168" cy="272" r="9" fill={MONSTER.knotOrange} />
      <circle cx="98" cy="80" r="5.5" fill={MONSTER.glint} opacity="0.55" />
      <rect x="122" y="120" width="9" height="22" rx="4.5" fill={MONSTER.glint} opacity="0.5" />
      <rect x="44" y="220" width="18" height="9" rx="4.5" fill={MONSTER.glint} opacity="0.45" />
      <circle cx="152" cy="264" r="5" fill={MONSTER.glint} opacity="0.5" />
      {peering ? <DigitEye x={134} y={190} r={20} /> : <DigitSleepFace x={58} y={156} ink={MONSTER.inkRed} />}
    </>
  ),
  // 5 — mockup "5": orange bar + teal nub, red shoulder + blob, blue belly;
  //     the locked glyph keeps BOTH the sleeping bar face and the peering eye
  "5": (peering) => (
    <>
      {peering && <DigitEye x={102} y={174} r={24} />}
      <line x1="22" y1="54" x2="124" y2="54" stroke={MONSTER.orange} strokeWidth="50" strokeLinecap="round" />
      <circle cx="22" cy="54" r="26" fill={MONSTER.teal} />
      <line x1="46" y1="76" x2="46" y2="140" stroke={MONSTER.red} strokeWidth="48" strokeLinecap="round" />
      <circle cx="64" cy="152" r="33" fill={MONSTER.red} />
      <path d="M68 168 C 144 178, 140 248, 48 256" stroke={MONSTER.blue} strokeWidth="48" fill="none" strokeLinecap="round" />
      <path d="M79 50 q9 9 18 0 M86 66 q6 6 12 0" stroke={MONSTER.inkOrange} strokeWidth="5" fill="none" strokeLinecap="round" />
      <rect x="36" y="42" width="18" height="9" rx="4.5" fill={MONSTER.glint} opacity="0.5" />
      <circle cx="110" cy="212" r="5" fill={MONSTER.glint} opacity="0.5" />
      <circle cx="124" cy="54" r="12" fill={MONSTER.knotOrange} />
      <circle cx="46" cy="140" r="9" fill={MONSTER.knotRed} />
    </>
  ),
  // 6 — blue loop + red tail capsule, red balloon knot at the tail tip
  "6": (peering) => (
    <>
      <circle cx="100" cy="206" r="54" fill="none" stroke={MONSTER.blue} strokeWidth="46" />
      <path d="M94 154 C 62 128, 56 84, 88 52" stroke={MONSTER.red} strokeWidth="46" fill="none" strokeLinecap="round" />
      <circle cx="88" cy="52" r="10" fill={MONSTER.knotRed} />
      <circle cx="100" cy="120" r="5" fill={MONSTER.glint} opacity="0.55" />
      <rect x="126" y="168" width="10" height="20" rx="5" fill={MONSTER.glint} opacity="0.5" />
      {peering ? <DigitEye x={154} y={202} r={20} /> : <DigitSleepFace x={154} y={194} ink={MONSTER.inkBlue} rotate={90} />}
    </>
  ),
  // 7 — mockup "7": teal bar, red diagonal, orange corner knob, red knot
  "7": (peering) => (
    <>
      <line x1="50" y1="78" x2="150" y2="78" stroke={MONSTER.teal} strokeWidth="52" strokeLinecap="round" />
      <line x1="150" y1="82" x2="88" y2="268" stroke={MONSTER.red} strokeWidth="52" strokeLinecap="round" />
      <circle cx="150" cy="79" r="33" fill={MONSTER.orange} />
      <circle cx="50" cy="78" r="24" fill={MONSTER.teal} />
      <circle cx="88" cy="268" r="10" fill={MONSTER.knotRed} />
      <circle cx="128" cy="66" r="5.5" fill={MONSTER.glint} opacity="0.55" />
      <circle cx="104" cy="232" r="5" fill={MONSTER.glint} opacity="0.5" />
      {peering ? <DigitEye x={120} y={170} r={20} /> : <DigitSleepFace x={112} y={162} ink={MONSTER.inkRed} />}
    </>
  ),
  // 8 — two blob loops (orange upper ring, blue lower ring) + purple waist
  "8": (peering) => (
    <>
      <circle cx="100" cy="112" r="42" fill="none" stroke={MONSTER.orange} strokeWidth="40" />
      <circle cx="100" cy="208" r="54" fill="none" stroke={MONSTER.blue} strokeWidth="44" />
      <circle cx="100" cy="159" r="30" fill={MONSTER.purple} />
      <circle cx="100" cy="70" r="9" fill={MONSTER.knotOrange} />
      <circle cx="74" cy="84" r="5" fill={MONSTER.glint} opacity="0.5" />
      <circle cx="146" cy="188" r="5.5" fill={MONSTER.glint} opacity="0.5" />
      {peering ? <DigitEye x={54} y={204} r={20} /> : <DigitSleepFace x={54} y={198} ink={MONSTER.inkBlue} rotate={90} />}
    </>
  ),
  // 9 — blue loop + red tail, red knot at the tail tip (six, flipped)
  "9": (peering) => (
    <>
      <circle cx="100" cy="116" r="54" fill="none" stroke={MONSTER.blue} strokeWidth="46" />
      <path d="M106 168 C 138 194, 144 238, 112 268" stroke={MONSTER.red} strokeWidth="46" fill="none" strokeLinecap="round" />
      <circle cx="112" cy="268" r="10" fill={MONSTER.knotRed} />
      <rect x="116" y="62" width="10" height="20" rx="5" fill={MONSTER.glint} opacity="0.5" />
      <circle cx="124" cy="224" r="5" fill={MONSTER.glint} opacity="0.55" />
      {peering ? <DigitEye x={50} y={112} r={20} /> : <DigitSleepFace x={50} y={106} ink={MONSTER.inkBlue} rotate={90} />}
    </>
  ),
  // minus — one red capsule + teal nub + dark knot (no face)
  "-": () => (
    <>
      <line x1="56" y1="160" x2="144" y2="160" stroke={MONSTER.red} strokeWidth="40" strokeLinecap="round" />
      <circle cx="56" cy="160" r="20" fill={MONSTER.teal} />
      <circle cx="144" cy="160" r="9" fill={MONSTER.knotRed} />
      <rect x="76" y="152" width="16" height="8" rx="4" fill={MONSTER.glint} opacity="0.5" />
    </>
  ),
};

export function MonsterDigit({ digit, size, eye = false }: { digit: string; size?: number; eye?: boolean }) {
  const glyph = MONSTER_DIGITS[digit];
  // Without `size` the box tracks the parent font-size (0.625em × 1em), so
  // the hero's responsive text classes drive 64/80/96px digit boxes.
  const box: CSSProperties = size
    ? { width: size * DIGIT_ASPECT, height: size }
    : { width: `${DIGIT_ASPECT}em`, height: "1em" };
  if (!glyph) return <span>{digit}</span>;
  return (
    <svg
      data-weather-digit={digit}
      aria-hidden="true"
      viewBox={`0 0 ${DIGIT_VIEW_W} ${DIGIT_VIEW_H}`}
      className="block shrink-0"
      style={box}
    >
      {glyph(eye)}
    </svg>
  );
}

/** `hideSun` drops the standalone sun disc because the poster behind already
    paints a sun character (see posterCarriesSun). Mirrors how the night scene
    suppresses the moon.

    Deliberately NOT applied to "partly": that glyph is a composite
    sun-behind-cloud *condition badge*, and dropping its sun would collapse it
    into the same lone-cloud glyph an overcast card uses — two different
    conditions rendering identically. The duplicate-sun problem was two
    identical round discs reading as two suns; a small sun peeking from behind
    a cloud reads as a condition badge, not a second sun. */
export function Condition({ code, size = 80, hideSun = false }: { code: ConditionCode; size?: number; hideSun?: boolean }) {
  switch (code) {
    case "clear":
      return hideSun ? null : (
        <svg data-weather-icon="clear" aria-hidden="true" width={size * 0.8} height={size * 0.8} viewBox="0 0 100 100">
          <SunG />
        </svg>
      );
    case "cloudy":
      return (
        <svg data-weather-icon="cloudy" aria-hidden="true" width={size} height={size * 0.72} viewBox="0 0 100 72">
          <CloudG tone="day" />
        </svg>
      );
    case "partly":
      return (
        <div data-weather-icon="partly" aria-hidden="true" className="relative" style={{ width: size, height: size * 0.75 }}>
          <svg className="absolute top-0 right-1" width={size * 0.5} height={size * 0.5} viewBox="0 0 100 100">
            <SunG />
          </svg>
          <svg className="absolute bottom-0 left-0" width={size * 0.85} height={size * 0.85 * 0.72} viewBox="0 0 100 72">
            <CloudG tone="day" />
          </svg>
        </div>
      );
    case "partly-night":
      return (
        <div data-weather-icon="partly-night" aria-hidden="true" className="relative" style={{ width: size, height: size * 0.75 }}>
          <svg className="absolute top-0 right-2" width={size * 0.5} height={size * 0.5} viewBox="0 0 48 48" fill="none">
            <StarClusterG />
          </svg>
          <svg className="absolute bottom-0 left-0" width={size * 0.85} height={size * 0.85 * 0.72} viewBox="0 0 100 72">
            <CloudG tone="night" />
          </svg>
        </div>
      );
    case "rain":
      return (
        <svg data-weather-icon="rain" aria-hidden="true" width={size} height={size} viewBox="0 0 100 100">
          <g transform="translate(0 -4)">
            <CloudG tone="day" />
          </g>
          <DropsG />
        </svg>
      );
    case "storm":
      return (
        <svg data-weather-icon="storm" aria-hidden="true" width={size} height={size} viewBox="0 0 100 100">
          <g transform="translate(0 -4)">
            <CloudG tone="night" />
          </g>
          <BoltG />
        </svg>
      );
    case "snow":
      return (
        <svg data-weather-icon="snow" aria-hidden="true" width={size} height={size} viewBox="0 0 100 100">
          <g transform="translate(0 -4)">
            <CloudG tone="snow" />
          </g>
          <SnowflakeG x={32} y={74} />
          <SnowflakeG x={52} y={84} />
          <SnowflakeG x={70} y={74} />
        </svg>
      );
    case "fog":
      return (
        <svg data-weather-icon="fog" aria-hidden="true" width={size} height={size * 0.6} viewBox="0 0 100 60">
          <FogG />
        </svg>
      );
    case "night":
      return <NightStars size={size * 0.8} />;
  }
}
