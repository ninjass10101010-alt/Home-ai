"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { WeatherSkin, SeasonKey } from "./WeatherSkins";

export interface SceneState {
  code: number;
  isDay: boolean;
  cloudCover: number;
  windSpeed: number;
  windDir: number;
  precipProb: number;
  humidity: number;
  sunProgress: number;
  visibility: number | null;
  timestamp: number;
}

const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const STORM_CODES = new Set([95, 96, 99]);

// ─── Moon phase — true synodic model ────────────────────────────────────────

const SYNODIC_MONTH = 29.53058867;
const NEW_MOON_EPOCH_UTC = Date.UTC(2000, 0, 6, 18, 14);

export function moonPhase(timestamp: number): { phase: number; illumination: number; waxing: boolean } {
  const days = (timestamp - NEW_MOON_EPOCH_UTC) / 86400000;
  const phase = (((days % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH) / SYNODIC_MONTH;
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  return { phase, illumination, waxing: phase < 0.5 };
}

export function moonPhaseName(phase: number): string {
  if (phase < 0.03 || phase > 0.97) return "New Moon";
  if (phase < 0.22) return "Waxing Crescent";
  if (phase < 0.28) return "First Quarter";
  if (phase < 0.47) return "Waxing Gibbous";
  if (phase < 0.53) return "Full Moon";
  if (phase < 0.72) return "Waning Gibbous";
  if (phase < 0.78) return "Last Quarter";
  return "Waning Crescent";
}

export function moonPathD(cx: number, cy: number, r: number, phase: number): string {
  const cos = Math.cos(2 * Math.PI * phase);
  const rx = Math.max(Math.abs(r * cos), 0.01);
  const waxing = phase <= 0.5;
  const outerSweep = waxing ? 1 : 0;
  const termSweep = waxing ? (phase < 0.25 ? 0 : 1) : (phase < 0.75 ? 0 : 1);
  return `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${outerSweep} ${cx} ${cy + r} A ${rx} ${r} 0 0 ${termSweep} ${cx} ${cy - r} Z`;
}

// ─── Procedural clouds — seeded, unique per hour, coverage-shaped ───────────

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CloudBlob {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  deep: boolean;
}

export interface CloudSpec {
  blobs: CloudBlob[];
}

export function makeCloudSpec(seed: number, fullness: number): CloudSpec {
  const rnd = mulberry32(seed);
  const f = Math.max(0, Math.min(1, fullness));
  const blobCount = 4 + Math.round(f * 3 + rnd() * 2);
  const raw: CloudBlob[] = [];
  let x = 18 + rnd() * 10;
  for (let i = 0; i < blobCount; i++) {
    const rx = 13 + rnd() * (12 + f * 10);
    const ry = rx * (0.42 + rnd() * 0.22);
    const cy = 44 - ry * 0.5 - rnd() * (10 + f * 8);
    raw.push({ cx: x, cy, rx, ry, deep: rnd() < 0.35 });
    x += rx * (0.75 + rnd() * 0.5);
  }
  const min = Math.min(...raw.map((b) => b.cx - b.rx));
  const max = Math.max(...raw.map((b) => b.cx + b.rx));
  const span = max - min;
  const target = 168;
  const scale = span > target ? target / span : 1;
  const scaled = span * scale;
  const shift = 16 + (target - scaled) / 2 - min * scale;
  return {
    blobs: raw.map((b) => ({
      cx: b.cx * scale + shift,
      cy: b.cy,
      rx: b.rx * scale,
      ry: b.ry,
      deep: b.deep,
    })),
  };
}

// ─── Scene pieces ────────────────────────────────────────────────────────────

interface Drop {
  id: number;
  x: number;
  delay: number;
  duration: number;
  size: number;
  opacity: number;
}

function makeDrops(count: number, seedShift: number): Drop[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: (i * 97 + seedShift * 31) % 100,
    delay: ((i * 0.37 + seedShift * 0.13) % 1.6),
    duration: 0.9 + ((i * 0.23) % 0.7),
    size: 9 + ((i * 7) % 8),
    opacity: 0.45 + ((i * 0.11) % 0.4),
  }));
}

const CLOUD_SLOTS = [
  { x: 6, y: 10, scale: 1.15, flip: false },
  { x: 58, y: 4, scale: 0.9, flip: true },
  { x: 30, y: 22, scale: 1.35, flip: false },
  { x: 70, y: 18, scale: 1.0, flip: true },
];

const BIRDS = [
  { a: 44, b: 12, dur: 17, delay: -3, size: 10, flap: 0.9, x: 20, y: 24 },
  { a: 58, b: 16, dur: 23, delay: -11, size: 8, flap: 1.1, x: 72, y: 32 },
  { a: 50, b: 14, dur: 20, delay: -16, size: 9, flap: 1.0, x: 42, y: 12 },
];

function Cloud({ skin, spec, seed, x, y, scale, opacity, duration, flip, interactive, motionOk }: {
  skin: WeatherSkin;
  spec: CloudSpec;
  seed: number;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  duration: number;
  flip: boolean;
  interactive: boolean;
  motionOk: boolean;
}) {
  const [puffs, setPuffs] = useState<{ id: number; x: number }[]>([]);
  const puffId = useRef(0);

  const handlePuff = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive || !motionOk) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const px = ((e.clientX - rect.left) / rect.width) * 200;
    const id = ++puffId.current;
    setPuffs((p) => [...p.slice(-2), { id, x: Math.max(16, Math.min(184, px)) }]);
  };

  return (
    <div
      aria-hidden="true"
      className="absolute"
      onPointerDown={handlePuff}
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: `${26 * scale}%`,
        opacity,
        transform: flip ? "scaleX(-1)" : undefined,
        transition: "opacity 1.2s ease",
        animation: `wxCloudDrift ${duration}s ease-in-out infinite alternate`,
      }}
    >
      <svg
        key={seed}
        viewBox="0 0 200 70"
        fill="none"
        className="w-full h-auto"
        style={{ animation: motionOk ? "wxFadeIn 1.1s ease both" : undefined }}
      >
        {spec.blobs.map((b, i) => (
          <ellipse key={i} cx={b.cx} cy={b.cy} rx={b.rx} ry={b.ry} fill={b.deep ? skin.cloudDeep : skin.cloud} />
        ))}
        {puffs.map((p) => (
          <ellipse
            key={p.id}
            cx={p.x}
            cy={30}
            rx={16}
            ry={11}
            fill={skin.cloud}
            style={{ animation: "wxPuff 0.9s ease-out both", transformBox: "fill-box", transformOrigin: "center" }}
            onAnimationEnd={() => setPuffs((prev) => prev.filter((q) => q.id !== p.id))}
          />
        ))}
      </svg>
    </div>
  );
}

export default function WeatherScene({ skin, state, season, animated = true }: {
  skin: WeatherSkin;
  state: SceneState;
  season: SeasonKey;
  animated?: boolean;
}) {
  const { code, isDay, cloudCover, windSpeed, windDir, precipProb, humidity, sunProgress, visibility, timestamp } = state;

  const [motionOk, setMotionOk] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotionOk(!mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const cloudCount = cloudCover >= 88 ? 4 : cloudCover >= 66 ? 3 : cloudCover >= 40 ? 2 : cloudCover >= 18 ? 1 : 0;
  const cloudOpacity = Math.min(0.5 + cloudCover / 160, 0.95);
  const driftDuration = Math.max(16, 46 - windSpeed);

  const hourSeed = Math.floor(timestamp / 3600000);
  const cloudSpecs = useMemo(
    () => CLOUD_SLOTS.map((_, i) => makeCloudSpec(hourSeed * 31 + i * 101 + 7, cloudCover / 100)),
    [hourSeed, cloudCover]
  );

  const raining = animated && (RAIN_CODES.has(code) || precipProb >= 55);
  const snowing = animated && SNOW_CODES.has(code);
  const stormy = STORM_CODES.has(code);

  let fogOpacity = 0;
  if (code === 45 || code === 48) fogOpacity = 0.5;
  if (visibility != null && visibility < 8000) {
    fogOpacity = Math.max(fogOpacity, (1 - visibility / 8000) * 0.55);
  } else if (visibility == null && humidity >= 82) {
    fogOpacity = Math.max(fogOpacity, 0.22);
  }

  const birdsOut = animated && isDay && cloudCover < 30 && !RAIN_CODES.has(code) && !SNOW_CODES.has(code) && !stormy && fogOpacity === 0;

  const birdGlyph = (b: (typeof BIRDS)[number], flapping: boolean) => (
    <svg viewBox="0 0 24 10" fill="none" style={{ width: b.size }}>
      <path d="M2 5 Q7 1 12 5 Q17 1 22 5" stroke={skin.ink} strokeWidth="1.6" strokeLinecap="round" opacity="0.55">
        {flapping && (
          <animate
            attributeName="d"
            dur={`${b.flap}s`}
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

  const precipIntensity = Math.max(precipProb, RAIN_CODES.has(code) ? 60 : 0);
  const rainDrops = useMemo(
    () => makeDrops(Math.min(8 + Math.round(precipIntensity / 5), 26), cloudCover),
    [precipIntensity, cloudCover]
  );
  const slant = Math.max(-14, Math.min(14, (windDir > 90 && windDir < 270 ? -1 : 1) * Math.min(windSpeed * 0.7, 14)));

  const p = Math.max(0, Math.min(1, sunProgress));
  const sunLeft = 8 + p * 80;
  const sunTop = 56 - Math.sin(p * Math.PI) * 40;

  const mp = moonPhase(timestamp);

  const stars = useMemo(
    () => Array.from({ length: 14 }, (_, i) => ({
      id: i,
      x: (i * 71 + 13) % 100,
      y: (i * 37 + 9) % 55,
      size: 1 + (i % 3),
      delay: (i * 0.5) % 4,
    })),
    []
  );

  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <div
        className="absolute inset-0 wx-sky"
        data-active={!skin.night && season === "spring"}
        style={{ background: skin.skyGradient("spring") }}
      />
      <div
        className="absolute inset-0 wx-sky"
        data-active={!skin.night && season === "summer"}
        style={{ background: skin.skyGradient("summer") }}
      />
      <div
        className="absolute inset-0 wx-sky"
        data-active={!skin.night && season === "autumn"}
        style={{ background: skin.skyGradient("autumn") }}
      />
      <div
        className="absolute inset-0 wx-sky"
        data-active={!skin.night && season === "winter"}
        style={{ background: skin.skyGradient("winter") }}
      />
      <div
        className="absolute inset-0 wx-sky"
        data-active={skin.night}
        style={{ background: skin.skyGradient(null) }}
      />

      {skin.night && cloudCover < 60 && (
        <div className="absolute inset-0">
          {stars.map((st) => (
            <div
              key={st.id}
              className="absolute rounded-full bg-white"
              style={{
                left: `${st.x}%`,
                top: `${st.y}%`,
                width: st.size,
                height: st.size,
                opacity: 0.7,
                animation: motionOk ? `wxStarTwinkle ${2.6 + st.delay}s ease-in-out ${st.delay}s infinite` : undefined,
              }}
            />
          ))}
        </div>
      )}

      {isDay ? (
        <div
          className="absolute"
          style={{
            left: `${sunLeft}%`,
            top: `${sunTop}%`,
            width: "19%",
            aspectRatio: "1",
            transform: "translate(-50%, -50%)",
            transition: "left 0.8s ease, top 0.8s ease",
          }}
        >
          <div
            className="absolute inset-[-55%] rounded-full"
            style={{ background: `radial-gradient(circle, ${skin.celestial}55 0%, transparent 70%)` }}
          />
          <div className="absolute inset-0 rounded-full" style={{ background: skin.celestial, boxShadow: `0 0 32px ${skin.celestial}88` }} />

          <div
            data-testid="wx-birds"
            className="absolute inset-[-120%]"
            style={{ opacity: birdsOut ? 1 : 0, transition: "opacity 1.2s ease" }}
          >
            {BIRDS.map((b, i) =>
              motionOk ? (
                <div
                  key={i}
                  className="absolute left-1/2 top-1/2"
                  style={{
                    ["--wx-bird-a" as string]: `${b.a}px`,
                    ["--wx-bird-b" as string]: `${b.b}px`,
                    animation: `wxBirdOrbit ${b.dur}s linear ${b.delay}s infinite`,
                  }}
                >
                  <div style={{ transform: "translate(-50%, -50%)" }}>{birdGlyph(b, true)}</div>
                </div>
              ) : (
                <div key={i} className="absolute" style={{ left: `${b.x}%`, top: `${b.y}%` }}>
                  {birdGlyph(b, false)}
                </div>
              )
            )}
          </div>
        </div>
      ) : (
        (() => {
          // The moon rides the opposite arc: it rises where the sun set and
          // sets where it rises, driven by the same real sun progress.
          const mp2 = 1 - Math.max(0, Math.min(1, sunProgress));
          const moonLeft = 8 + mp2 * 80;
          const moonTop = 56 - Math.sin(mp2 * Math.PI) * 40;
          return (
            <div className="absolute" style={{ left: `${moonLeft}%`, top: `${moonTop}%`, width: "14%", aspectRatio: "1", transform: "translate(-50%, -50%)", transition: "left 0.8s ease, top 0.8s ease" }}>
              <div
                className="absolute inset-[-45%] rounded-full"
                style={{ background: `radial-gradient(circle, rgba(244,241,232,${(0.12 + mp.illumination * 0.2).toFixed(3)}) 0%, transparent 70%)` }}
              />
              <svg viewBox="0 0 40 40" className="absolute inset-0 w-full h-full" data-testid="wx-moon">
                <circle cx="20" cy="20" r="16" fill="rgba(255,255,255,0.10)" />
                <path d={moonPathD(20, 20, 16, mp.phase)} fill={skin.celestial} data-testid="wx-moon-lit" />
              </svg>
            </div>
          );
        })()
      )}

      {CLOUD_SLOTS.map((slot, i) => (
        <Cloud
          key={i}
          skin={skin}
          spec={cloudSpecs[i]}
          seed={hourSeed * 31 + i * 101 + 7}
          x={slot.x}
          y={slot.y}
          scale={slot.scale}
          flip={slot.flip}
          opacity={i < cloudCount ? cloudOpacity : 0}
          duration={driftDuration + i * 4}
          interactive={i < cloudCount}
          motionOk={motionOk}
        />
      ))}

      {fogOpacity > 0 && (
        <div data-testid="wx-fog" className="absolute inset-x-0 bottom-0 h-3/5" style={{ opacity: fogOpacity, transition: "opacity 1.2s ease" }}>
          <div
            className="absolute inset-x-[-20%] bottom-6 h-16 rounded-full"
            style={{ background: skin.night ? "rgba(160,180,200,0.30)" : "rgba(255,255,255,0.55)", filter: "blur(14px)", animation: motionOk ? "wxFogDrift 26s ease-in-out infinite alternate" : undefined }}
          />
          <div
            className="absolute inset-x-[-10%] bottom-0 h-14 rounded-full"
            style={{ background: skin.night ? "rgba(160,180,200,0.24)" : "rgba(255,255,255,0.45)", filter: "blur(12px)", animation: motionOk ? "wxFogDrift 34s ease-in-out infinite alternate-reverse" : undefined }}
          />
        </div>
      )}

      {raining && (
        <div className="absolute inset-0" style={{ transform: `rotate(${slant}deg) scale(1.15)` }}>
          {rainDrops.map((d) => (
            <div
              key={d.id}
              className="absolute top-[-12%] rounded-full"
              style={{
                left: `${d.x}%`,
                width: 1.6,
                height: d.size,
                background: skin.particle,
                opacity: d.opacity,
                animation: motionOk ? `wxRainStreak ${d.duration / Math.max(windSpeed / 14, 0.75)}s linear ${d.delay}s infinite` : undefined,
              }}
            />
          ))}
        </div>
      )}

      {snowing && (
        <div className="absolute inset-0">
          {rainDrops.slice(0, 18).map((d) => (
            <div
              key={d.id}
              className="absolute top-[-8%] rounded-full"
              style={{
                left: `${d.x}%`,
                width: d.size / 2.4,
                height: d.size / 2.4,
                background: skin.night ? "rgba(230,240,250,0.9)" : "rgba(255,255,255,0.95)",
                opacity: d.opacity,
                animation: motionOk ? `wxSnowFall ${d.duration * 3.2}s linear ${d.delay}s infinite` : undefined,
              }}
            />
          ))}
        </div>
      )}

      {stormy && animated && (
        <div
          className="absolute inset-0 bg-white"
          style={{ opacity: 0, animation: motionOk ? "wxLightning 7.5s linear infinite" : undefined }}
        />
      )}
    </div>
  );
}
