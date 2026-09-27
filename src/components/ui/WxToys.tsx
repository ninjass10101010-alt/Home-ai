"use client";

import { CSSProperties, useEffect, useId, useState } from "react";
import { moonLitPath } from "@/lib/weather-astro";
import type { SkyPhase } from "@/lib/weather-scene-params";
import { cloudVariant, backCloudVariant, starOpacity } from "@/lib/weather-scene-params";
import { WX_POSTER } from "./wx-tokens";

// WxToys — the toy weather kit: SunOrb, CloudPuff, seagull Birds,
// keyframe-wired SceneLayers, and the clay Condition icon set.
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

export function CloudPuff({ className = "", style, tone = "day", layer, character = false, variant = 0, bob = false }: {
  className?: string;
  style?: CSSProperties;
  tone?: "day" | "poster" | "night" | "heavy-snow";
  layer?: "front" | "back";
  character?: boolean;
  variant?: 0 | 1 | 2;
  bob?: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const t = CLOUD_TONES[tone];
  const blobs = CLOUD_VARIANTS[variant];
  const faceInk = tone === "night" ? "#34385F" : tone === "heavy-snow" ? "#3D4D66" : "#174F59";
  return (
    <div aria-hidden="true" className={`relative h-14 w-24 ${className}`} style={style} data-cloud-form={tone} data-cloud-layer={layer}>
      <svg
        viewBox="0 0 200 120"
        className="h-full w-full overflow-visible"
        style={bob ? { animation: "wx-bob 7s ease-in-out infinite", transformBox: "fill-box", transformOrigin: "center" } : undefined}
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
      {character && (
        <svg data-weather-character="cloud" className="absolute inset-0 h-full w-full" viewBox="0 0 200 120" fill="none">
          <circle cx={blobs[1][0] - 14} cy={blobs[1][1] + 6} r="3.4" fill={faceInk} />
          <circle cx={blobs[1][0] + 14} cy={blobs[1][1] + 6} r="3.4" fill={faceInk} />
          <path d={`M${blobs[1][0] - 10} ${blobs[1][1] + 16} Q${blobs[1][0]} ${blobs[1][1] + 24} ${blobs[1][0] + 10} ${blobs[1][1] + 16}`} stroke={faceInk} strokeWidth="3.4" strokeLinecap="round" fill="none" />
        </svg>
      )}
    </div>
  );
}

// ─── Seagulls — flap via SMIL (CSS animation:none cannot stop SMIL,
// so the flap unmounts under reduced-motion) ──

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
      style={motionOk ? { animation: "wxFadeIn 0.85s ease both" } : undefined}
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
            <circle cx={sun.x - 6} cy={sun.y - 2} r="1.8" fill="#6A452A" />
            <circle cx={sun.x + 6} cy={sun.y - 2} r="1.8" fill="#6A452A" />
            <path d={`M${sun.x - 6} ${sun.y + 5}Q${sun.x} ${sun.y + 10} ${sun.x + 6} ${sun.y + 5}`} fill="none" stroke="#6A452A" strokeWidth="1.8" strokeLinecap="round" />
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
            {/* the face fades with the light — no face at new moon */}
            <g data-weather-face="moon" opacity={moonIllumination}>
              <circle cx={-5} cy={-3} r="1.8" fill="#62658D" />
              <circle cx={5} cy={-3} r="1.8" fill="#62658D" />
              <path d="M-4 4 Q0 8 4 4" fill="none" stroke="#62658D" strokeWidth="1.8" strokeLinecap="round" />
            </g>
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

      {scene === "night" &&
        Array.from({ length: 42 }, (_, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              left: `${(i * 37) % 100}%`,
              top: `${(i * 53) % 45}%`,
              width: 2 + (i % 3),
              height: 2 + (i % 3),
              opacity: starOpacity(numericCloudCover),
              animation: motionOk ? `wxStarTwinkle ${2.5 + (i % 4)}s ease-in-out ${i * 0.3}s infinite` : undefined,
            }}
          />
        ))}
      {scene === "night" && starOpacity(numericCloudCover) === 1 && (
        <span
          aria-hidden="true"
          className="absolute h-[2px] w-[90px] rounded-full bg-gradient-to-r from-transparent via-white/90 to-white"
          style={{
            left: "72%",
            top: "12%",
            transform: "rotate(-24deg)",
            opacity: 0,
            animation: motionOk ? "wx-shoot 11s ease-in 5s infinite" : undefined,
          }}
        />
      )}

      <div data-testid="wx-poster-clouds" data-cloud-cover={numericCloudCover == null ? "unavailable" : Math.round(cover)} data-visible={cover > 0 ? "true" : "false"} className="absolute inset-0">
        <CloudPuff
          layer="front"
          tone={cloudTone}
          variant={cloudVariant(numericCloudCover)}
          character={scene !== "storm" && !heavySnow && frontCloudOpacity >= 0.25}
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
                  ? `wx-fall ${0.6 + ((i * 17) % 40) / 100}s linear ${-(((i * 31) % 100) / 50)}s infinite`
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
                ? `wx-snowfall ${6.5 + ((i * 7) % 6)}s linear ${-((i * 11) % 13)}s infinite, wx-sway ${3 + ((i * 3) % 4)}s ease-in-out ${-((i * 11) % 13)}s infinite alternate`
                : undefined,
              ["--travel" as string]: "115cqh",
            } as CSSProperties}
          />
        ))}

      {scene === "storm" && (
        <div
          className="absolute inset-0 bg-white mix-blend-overlay"
          style={motionOk ? { animation: "wxLightning 9s linear infinite" } : undefined}
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
            animation: motionOk ? "wx-bolt 9s linear infinite" : undefined,
          }}
        >
          <path d="M22 0 L6 56 L18 56 L10 120 L36 44 L23 44 L34 0 Z" fill="#FFFDF0" stroke="rgba(190,205,255,0.9)" strokeWidth="1.5" />
        </svg>
      )}

      {fogOpacity > 0 && (
        <div data-testid="wx-fog" data-fog-opacity={fogOpacity.toFixed(2)}>
          <div
            className="absolute inset-x-[-10%] bottom-0 h-40 bg-gradient-to-t from-white/60 to-transparent blur-xl"
            style={motionOk ? { animation: "wx-fogdrift 30s ease-in-out infinite alternate" } : undefined}
          />
          <div
            className="absolute inset-x-[-20%] bottom-10 h-32 bg-gradient-to-t from-white/45 to-transparent blur-xl"
            style={motionOk ? { animation: "wx-fogdrift 26s ease-in-out -9s infinite alternate" } : undefined}
          />
          <div
            className="absolute inset-x-[-15%] bottom-20 h-28 bg-gradient-to-t from-white/35 to-transparent blur-xl"
            style={motionOk ? { animation: "wx-fogdrift 40s ease-in-out -20s infinite alternate" } : undefined}
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
      <path d="m18 6 2.4 7.2L28 16l-7.6 2.8L18 26l-2.4-7.2L8 16l7.6-2.8L18 6Z" fill="#FFF9E6" />
      <path d="m34 23 1.6 4.8L41 30l-5.4 2.2L34 37l-1.6-4.8L27 30l5.4-2.2L34 23Z" fill="#F6D7A8" />
      <circle cx="12" cy="34" r="2" fill="#FFF9E6" />
      <circle cx="29" cy="10" r="1.5" fill="#FFF9E6" />
    </svg>
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
        <div data-weather-icon="partly-night" className="relative" style={{ width: size, height: size * 0.75 }}>
          <div className="absolute top-0 right-2">
            <NightStars size={size * 0.5} />
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
        <div data-weather-icon="snow" className="relative" style={{ width: size, height: size }}>
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
      return <NightStars size={size * 0.8} />;
  }
}
