/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { useWeatherConfig } from "@/hooks/useWeather";
import { HolidayOverride } from "@/lib/weather-config";
import { useRuntimeConfig } from "@/hooks/useRuntimeConfig";
import { useAuth } from "@/hooks/useAuth";
import Skeleton from "@/components/ui/Skeleton";
import { db } from "@/db";
import WeatherScene, { SceneState, moonPhase, moonPhaseName } from "./WeatherScene";
import { getWeatherSkin, cardinalFromDegrees, SeasonKey, severeFamily, resolveAccent } from "./WeatherSkins";
import { wearAdvice, stormAdvice, snowAdvice, fusionOutlook, InsightEvent } from "@/lib/weather-insights";
import type { ParticleKind } from "./WeatherParticles";

const SeasonHolidayArt = dynamic(() => import("./WeatherSeasonArt"), { ssr: false });
const HolidayParticles = dynamic(() => import("./WeatherParticles"), { ssr: false });

// ─── Types ─────────────────────────────────────────────────────────────────

type TimeOfDayFlag = "day" | "night";

interface ForecastDay {
  day: string;
  high: number;
  low: number;
  condition: string;
  emoji: string;
  precipitation: number;
}

interface HourPoint {
  time: string;
  temp: number;
  code: number;
  precip: number;
  isDay: boolean;
  cloud: number | null;
  wind: number | null;
  windDir: number;
  humidity: number | null;
  visibility: number | null;
}

interface WeatherData {
  temp: number | null;
  feelsLike: number | null;
  humidity: number | null;
  wind: number | null;
  windDir: number;
  code: number;
  isDay: boolean;
  cloud: number | null;
  uv: number | null;
  pressure: number | null;
  visibility: number | null;
  condition: string;
  sunriseISO: string | null;
  sunsetISO: string | null;
  hours: HourPoint[];
  forecast: ForecastDay[];
  todayHigh: number | null;
  todayLow: number | null;
  outlook: string | null;
  severeEndISO: string | null;
  // Fusion inputs — the next precipitation hit, for calendar-aware copy.
  rainHourISO: string | null;
  rainSentence: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toC(f: number) { return Math.round((f - 32) * 5 / 9); }

const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const STORM_CODES = new Set([95, 96, 99]);

function wmoToCondition(code: number) {
  if (code === 0) return { condition: "Clear", emoji: "☀️" };
  if (code <= 3) return { condition: "Partly Cloudy", emoji: "⛅" };
  if (code <= 48) return { condition: "Foggy", emoji: "🌫️" };
  if (code <= 57) return { condition: "Drizzle", emoji: "🌦️" };
  if (code <= 67) return { condition: "Rainy", emoji: "🌧️" };
  if (code <= 77) return { condition: "Snowy", emoji: "❄️" };
  if (code <= 82) return { condition: "Rain Showers", emoji: "🌧️" };
  return { condition: "Thunderstorm", emoji: "⛈️" };
}

function formatHourLabel(iso: string): string {
  const h = new Date(iso).getHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12} ${h >= 12 ? "PM" : "AM"}`;
}

function formatHourTick(iso: string): string {
  const h = new Date(iso).getHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}${h >= 12 ? "PM" : "AM"}`;
}

function pickLabelIndices(hours: HourPoint[], x: (i: number) => number, minGap: number): number[] {
  const idx = [0];
  for (let i = 1; i < hours.length; i++) {
    if (new Date(hours[i].time).getHours() % 3 !== 0) continue;
    if (x(i) - x(idx[idx.length - 1]) < minGap) continue;
    idx.push(i);
  }
  return idx;
}

interface HourlyBlock {
  time?: string[];
  weather_code?: number[];
  precipitation_probability?: (number | null)[];
  temperature_2m?: (number | null)[];
}

interface OutlookInfo {
  sentence: string;
  hitISO: string | null;
}

function deriveOutlookInfo(hourly: HourlyBlock | undefined, condition: string): OutlookInfo | null {
  const times = hourly?.time;
  const codes = hourly?.weather_code;
  const precip = hourly?.precipitation_probability;
  if (!times || !codes || !precip) return null;
  const nowMs = Date.now();
  const start = times.findIndex((t) => new Date(t).getTime() >= nowMs - 59 * 60 * 1000);
  if (start === -1) return null;
  const end = Math.min(start + 12, times.length - 1);
  const isPrecipCode = (code: number) => RAIN_CODES.has(code) || SNOW_CODES.has(code);
  let hit = -1;
  for (let i = start + 1; i <= end && hit === -1; i++) {
    if ((precip[i] ?? 0) >= 50) hit = i;
  }
  for (let i = start + 1; i <= end && hit === -1; i++) {
    if ((precip[i] ?? 0) >= 30 && isPrecipCode(codes[i])) hit = i;
  }
  for (let i = start + 1; i <= end && hit === -1; i++) {
    if (isPrecipCode(codes[i])) hit = i;
  }
  if (hit !== -1) {
    const when = formatHourLabel(times[hit]);
    const sentence = STORM_CODES.has(codes[hit])
      ? `Thunderstorms expected around ${when}`
      : SNOW_CODES.has(codes[hit]) ? `Snow expected around ${when}` : `Rain likely around ${when}`;
    return { sentence, hitISO: times[hit] };
  }
  const c = condition.toLowerCase();
  if (c.includes("rain") || c.includes("snow") || c.includes("drizzle") || c.includes("shower") || c.includes("thunder")) {
    const sentence = `${condition.charAt(0)}${condition.slice(1).toLowerCase()} for the rest of the day`;
    return { sentence, hitISO: null };
  }
  return { sentence: "No rain expected today", hitISO: null };
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const ca = (pa >> shift) & 255;
    const cb = (pb >> shift) & 255;
    return Math.round(ca + (cb - ca) * t);
  };
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

function tempBarColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? mixHex("#38bdf8", "#fbbf24", x * 2) : mixHex("#fbbf24", "#fb923c", (x - 0.5) * 2);
}

function getRealTimeOfDay(): TimeOfDayFlag {
  const hour = new Date().getHours();
  return hour >= 6 && hour < 19 ? "day" : "night";
}

function getRealSeason(): SeasonKey {
  const month = new Date().getMonth();
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "autumn";
  return "winter";
}

function detectAutoHoliday(): HolidayOverride {
  const now = new Date();
  const month = now.getMonth();
  const day = now.getDate();
  if (month === 11 && day >= 15) return "christmas";
  if (month === 0 && day <= 7) return "newyears";
  if (month === 1 && day >= 10 && day <= 16) return "valentines";
  if (month === 2 && day >= 14 && day <= 17) return "stpatricks";
  if (month === 4 && day >= 3 && day <= 6) return "cincodemayo";
  if (month === 8 && day >= 15 && day <= 16) return "mexicanindependence";
  if (month === 9 && day >= 25 && day <= 30) return "halloween";
  if ((month === 9 && day === 31) || (month === 10 && day >= 1 && day <= 2)) return "diadelosmuertos";
  if (month === 6 && day >= 1 && day <= 7) return "july4th";
  if (month === 10 && day >= 22 && day <= 28) return "thanksgiving";
  if (month === 11 && day >= 11 && day <= 13) return "virginguadalupe";
  return "none";
}

const HOLIDAY_STYLE: Partial<Record<HolidayOverride, { accent: string; particle: ParticleKind; label: string }>> = {
  christmas: { accent: "#ef4444", particle: "christmas-snow", label: "🎄 Christmas" },
  halloween: { accent: "#f97316", particle: "bat", label: "🎃 Halloween" },
  july4th: { accent: "#ef4444", particle: "spark", label: "🎆 4th of July" },
  valentines: { accent: "#f43f5e", particle: "heart", label: "💝 Valentine's" },
  newyears: { accent: "#eab308", particle: "spark", label: "🥂 New Year's" },
  cincodemayo: { accent: "#f59e0b", particle: "confetti", label: "🪅 Cinco de Mayo" },
  thanksgiving: { accent: "#d97706", particle: "harvest", label: "🦃 Thanksgiving" },
  stpatricks: { accent: "#22c55e", particle: "shamrock", label: "🍀 St. Patrick's" },
  diadelosmuertos: { accent: "#ec4899", particle: "marigold", label: "💀 Día de los Muertos" },
  mexicanindependence: { accent: "#22c55e", particle: "tricolor-sparks", label: "🔔 Independence Day" },
  virginguadalupe: { accent: "#0d9488", particle: "holy-roses", label: "🌹 Virgin of Guadalupe" },
};

function sunProgressAt(timeISO: string, sunriseISO: string | null, sunsetISO: string | null): number {
  if (!sunriseISO || !sunsetISO) return 0.5;
  const t = new Date(timeISO).getTime();
  const sr = new Date(sunriseISO).getTime();
  const ss = new Date(sunsetISO).getTime();
  if (!isFinite(t) || !isFinite(sr) || !isFinite(ss) || ss <= sr) return 0.5;
  return Math.max(0, Math.min(1, (t - sr) / (ss - sr)));
}

function stripEndIndex(hours: HourPoint[]): number {
  if (hours.length === 0) return -1;
  const dayOfNow = new Date(hours[0].time).getDate();
  let end = hours.findIndex((h) => new Date(h.time).getDate() !== dayOfNow);
  end = end === -1 ? hours.length - 1 : Math.max(0, end - 1);
  return Math.max(end, Math.min(8, hours.length - 1));
}

function useMeasureWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function useAnimatedNumber(target: number, duration = 550): number {
  const [display, setDisplay] = useState(target);
  const prevRef = useRef(target);
  const isFirstRealValueRef = useRef(target === 0);
  useEffect(() => {
    const from = prevRef.current;
    if (from === target) { setDisplay(target); return; }
    // First data landing shouldn't count from zero — it reads gimmicky
    if (isFirstRealValueRef.current && from === 0 && target !== 0) {
      isFirstRealValueRef.current = false;
      prevRef.current = target;
      setDisplay(target);
      return;
    }
    isFirstRealValueRef.current = false;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      prevRef.current = target;
      setDisplay(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
      else prevRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return display;
}

// ─── Day strip — rest-of-day temperature curve with rain ticks + press-to-preview ───

function DayStrip({ hours, conv, skin, accent, previewIdx, previewPinned, onPreview, onTapPin, onRelease }: {
  hours: HourPoint[];
  conv: (f: number) => number;
  skin: ReturnType<typeof getWeatherSkin>;
  accent: string;
  previewIdx: number | null;
  previewPinned: boolean;
  onPreview: (idx: number | null) => void;
  onTapPin: (idx: number) => void;
  onRelease: () => void;
}) {
  const [wrapRef, width] = useMeasureWidth<HTMLDivElement>();
  const draggingRef = useRef(false);
  const startXRef = useRef<number | null>(null);
  const hasHorizontalIntentRef = useRef(false);

  if (hours.length < 2) return null;

  const H = 64;
  const padL = 10;
  const padR = 10;
  const curveTop = 14;
  const curveBottom = 38;
  const w = Math.max(width, 120);
  const step = (w - padL - padR) / (hours.length - 1);
  const temps = hours.map((h) => h.temp);
  const tMin = Math.min(...temps);
  const tMax = Math.max(...temps);
  const span = Math.max(tMax - tMin, 1);
  const x = (i: number) => padL + i * step;
  const y = (t: number) => curveBottom - ((t - tMin) / span) * (curveBottom - curveTop);

  let d = `M ${x(0)} ${y(temps[0])}`;
  for (let i = 1; i < hours.length; i++) {
    const mx = (x(i - 1) + x(i)) / 2;
    d += ` Q ${x(i - 1)} ${y(temps[i - 1])} ${mx} ${(y(temps[i - 1]) + y(temps[i])) / 2}`;
  }
  d += ` T ${x(hours.length - 1)} ${y(temps[hours.length - 1])}`;

  const idxFromClientX = (clientX: number) => {
    const el = wrapRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const t = (clientX - rect.left - padL) / Math.max(rect.width - padL - padR, 1);
    return Math.max(0, Math.min(hours.length - 1, Math.round(t * (hours.length - 1))));
  };

  const pv = previewIdx != null ? hours[previewIdx] : null;
  const labelIdx = pickLabelIndices(hours, x, 44);

  return (
    <div
      ref={wrapRef}
      role="slider"
      tabIndex={0}
      aria-label="Preview the rest of the day"
      aria-valuemin={0}
      aria-valuemax={hours.length - 1}
      aria-valuenow={previewIdx ?? 0}
      aria-valuetext={pv ? `${formatHourLabel(pv.time)}, ${conv(pv.temp)} degrees, ${pv.precip}% chance of precipitation` : "Now"}
      className="relative shrink-0 cursor-grab select-none outline-none rounded-xl focus-visible:ring-2 focus-visible:ring-offset-0 active:cursor-grabbing"
      style={{ height: H, touchAction: "pan-y", ["--tw-ring-color" as string]: accent }}
      onPointerDown={(e) => {
        draggingRef.current = true;
        startXRef.current = e.clientX;
        hasHorizontalIntentRef.current = false;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!draggingRef.current) return;
        if (!hasHorizontalIntentRef.current) {
          if (startXRef.current == null || Math.abs(e.clientX - startXRef.current) < 6) return;
          hasHorizontalIntentRef.current = true;
        }
        onPreview(idxFromClientX(e.clientX));
      }}
      onPointerUp={(e) => {
        draggingRef.current = false;
        const wasDrag = hasHorizontalIntentRef.current;
        startXRef.current = null;
        hasHorizontalIntentRef.current = false;
        if (wasDrag) {
          onPreview(null); // a drag glides home (or stays if pinned)
        } else {
          // a tap pins the preview at the tapped hour
          onTapPin(idxFromClientX(e.clientX));
        }
      }}
      onPointerCancel={() => { draggingRef.current = false; startXRef.current = null; hasHorizontalIntentRef.current = false; onPreview(null); }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); onTapPin(Math.min(hours.length - 1, (previewIdx ?? 0) + 1)); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); onTapPin(Math.max(0, (previewIdx ?? 0) - 1)); }
        else if (e.key === "Escape" || e.key === "Home") { e.preventDefault(); onRelease(); }
      }}
      onBlur={() => { if (!previewPinned) onPreview(null); }}
    >
      {width > 0 && (
        <svg width={w} height={H} className="block" aria-hidden="true">
          <line x1={x(0)} y1={curveTop - 4} x2={x(0)} y2={52} stroke={accent} strokeWidth={1.25} opacity={0.55} />
          {hours.map((h, i) => (
            h.precip >= 40 ? (
              <rect
                key={`r${i}`}
                x={x(i) - 1.5}
                y={44}
                width={3}
                height={7}
                rx={1.5}
                fill={accent}
                opacity={Math.min(0.4 + h.precip / 140, 1)}
              />
            ) : null
          ))}
          <path d={d} fill="none" stroke={accent} strokeWidth={2.25} strokeLinecap="round" opacity={0.9} />
          <circle cx={x(0)} cy={y(temps[0])} r={3.5} fill={accent} />
          {labelIdx.map((i) => (
            <text
              key={`t${i}`}
              x={x(i)}
              y={60}
              textAnchor={i === 0 ? "start" : i === hours.length - 1 ? "end" : "middle"}
              fontSize={11}
              fontWeight={700}
              letterSpacing={0.2}
              fill={i === 0 ? accent : skin.inkSoft}
            >
              {i === 0 ? "NOW" : formatHourTick(hours[i].time)}
            </text>
          ))}
          {previewIdx != null && pv && (
            <g style={{ animation: "wxThumbIn 0.22s var(--ease-settle, ease-out) both" }}>
              <circle cx={x(previewIdx)} cy={y(pv.temp)} r={previewPinned ? 6 : 5} fill={accent} stroke={skin.night ? "#0A0A0A" : "#FFFFFF"} strokeWidth={previewPinned ? 2.5 : 2} />
              <rect x={x(previewIdx) - 19} y={y(pv.temp) - 26} width={38} height={17} rx={8.5} fill={skin.night ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.10)"} />
              <text x={x(previewIdx)} y={y(pv.temp) - 13.5} textAnchor="middle" fontSize={11} fontWeight={800} fill={skin.ink}>
                {conv(pv.temp)}°
              </text>
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

// ─── Modal pieces ───────────────────────────────────────────────────────────

function LeaderRow({ label, value, hidden, children }: { label: string; value: string; hidden?: boolean; children?: React.ReactNode }) {
  if (hidden) return null;
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/60">{label}</span>
      <span className="flex-1 border-b border-dotted border-white/25" aria-hidden="true" />
      <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[13px] font-bold tabular-nums text-white">
        {children}
        {value}
      </span>
    </div>
  );
}

function UvDots({ uv, accent }: { uv: number; accent: string }) {
  const filled = Math.max(uv > 0 ? 1 : 0, Math.min(5, Math.round(uv / 2)));
  return (
    <span className="inline-flex items-center gap-1" aria-label={`UV index ${uv}`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: i < filled ? accent : "rgba(255,255,255,0.18)" }}
        />
      ))}
    </span>
  );
}

function SunArc({ sunriseISO, sunsetISO, progress, accent }: {
  sunriseISO: string; sunsetISO: string; progress: number; accent: string;
}) {
  const P0 = { x: 16, y: 58 };
  const C = { x: 140, y: -10 };
  const P1 = { x: 264, y: 58 };
  const t = Math.max(0, Math.min(1, progress));
  const px = (1 - t) ** 2 * P0.x + 2 * (1 - t) * t * C.x + t ** 2 * P1.x;
  const py = (1 - t) ** 2 * P0.y + 2 * (1 - t) * t * C.y + t ** 2 * P1.y;
  const ms = new Date(sunsetISO).getTime() - new Date(sunriseISO).getTime();
  const dayLen = ms > 0 ? `${Math.floor(ms / 3_600_000)}h ${Math.round((ms % 3_600_000) / 60_000)}m` : null;
  return (
    <div>
      <svg viewBox="0 0 280 66" className="block w-full" aria-hidden="true">
        <path d={`M ${P0.x} ${P0.y} Q ${C.x} ${C.y} ${P1.x} ${P1.y}`} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={1.5} strokeDasharray="3 5" strokeLinecap="round" />
        <line x1={8} y1={58} x2={272} y2={58} stroke="rgba(255,255,255,0.14)" strokeWidth={1} />
        <circle cx={px} cy={py} r={6} fill={accent} style={{ filter: `drop-shadow(0 0 6px ${accent})` }} />
      </svg>
      <div className="mt-1 flex items-center justify-between text-[11px] font-semibold text-white/70">
        <span>↑ {formatHourLabel(sunriseISO)}</span>
        {dayLen && <span className="text-white/50">{dayLen} of daylight</span>}
        <span>↓ {formatHourLabel(sunsetISO)}</span>
      </div>
    </div>
  );
}

function TimelineScrubber({ hours, conv, accent, idx, onIdx }: {
  hours: HourPoint[];
  conv: (f: number) => number;
  accent: string;
  idx: number;
  onIdx: (i: number) => void;
}) {
  const [wrapRef, width] = useMeasureWidth<HTMLDivElement>();
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  if (hours.length < 2) return null;

  const padL = 12;
  const padR = 12;
  const w = Math.max(width, 120);
  const step = (w - padL - padR) / (hours.length - 1);
  const x = (i: number) => padL + i * step;

  const idxFromClientX = (clientX: number) => {
    const el = wrapRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const t = (clientX - rect.left - padL) / Math.max(rect.width - padL - padR, 1);
    return Math.max(0, Math.min(hours.length - 1, Math.round(t * (hours.length - 1))));
  };

  const cur = hours[idx];
  const labelIdx = pickLabelIndices(hours, x, 48);

  return (
    <div
      ref={wrapRef}
      role="slider"
      aria-label="Scrub through the next 24 hours"
      aria-valuemin={0}
      aria-valuemax={hours.length - 1}
      aria-valuenow={idx}
      aria-valuetext={`${formatHourLabel(cur.time)}, ${conv(cur.temp)} degrees, ${cur.precip}% chance of precipitation`}
      tabIndex={0}
      className="relative cursor-ew-resize select-none rounded-xl py-3 outline-none focus-visible:ring-2 focus-visible:ring-white/50"
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        draggingRef.current = true;
        setDragging(true);
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        onIdx(idxFromClientX(e.clientX));
      }}
      onPointerMove={(e) => { if (draggingRef.current) onIdx(idxFromClientX(e.clientX)); }}
      onPointerUp={() => { draggingRef.current = false; setDragging(false); }}
      onPointerCancel={() => { draggingRef.current = false; setDragging(false); }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); onIdx(Math.min(hours.length - 1, idx + 1)); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); onIdx(Math.max(0, idx - 1)); }
        else if (e.key === "Home") { e.preventDefault(); onIdx(0); }
        else if (e.key === "End") { e.preventDefault(); onIdx(hours.length - 1); }
      }}
    >
      <div className="relative h-1.5 rounded-full bg-white/12">
        {hours.map((h, i) => (
          h.precip >= 35 ? (
            <div
              key={i}
              className="absolute top-1/2 h-[7px] -translate-y-1/2 rounded-full"
              style={{
                left: x(i) - step / 2,
                width: step,
                background: accent,
                opacity: Math.min(0.35 + h.precip / 150, 0.95),
              }}
            />
          ) : null
        ))}
        <div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
          style={{ left: x(idx), background: accent, boxShadow: `0 0 10px ${accent}AA`, transition: dragging ? "none" : "left 0.18s ease" }}
        />
      </div>
        <div className="relative mt-2 h-4">
          {labelIdx.map((i) => (
            <span
              key={i}
              className="absolute text-[11px] font-bold tracking-wide"
              style={{
                left: x(i),
                transform: i === 0 ? "translateX(0)" : i === hours.length - 1 ? "translateX(-100%)" : "translateX(-50%)",
                color: i === 0 ? accent : "rgba(255,255,255,0.60)",
              }}
            >
              {i === 0 ? "NOW" : formatHourTick(hours[i].time)}
            </span>
          ))}
        </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WeatherWidget({ className = "" }: { className?: string }) {
  const { weather, setUnit } = useWeatherConfig();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const releaseTimerRef = useRef<number | null>(null);

  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [clockTick, setClockTick] = useState(0);
  const [tabHidden, setTabHidden] = useState(false);
  const [familyEvents, setFamilyEvents] = useState<InsightEvent[]>([]);
  const [previewPinned, setPreviewPinned] = useState(false);
  const detailsBtnRef = useRef<HTMLButtonElement | null>(null);
  const taughtRef = useRef(false);
  const { runtime } = useRuntimeConfig();
  const { currentUser } = useAuth();
  const isKid = currentUser?.role === "child";

  const dataLoadedRef = useRef(false);
  const inFlightRef = useRef(false);
  const updatedAtRef = useRef<number | null>(null);

  const loadWeather = useCallback(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const lat = Number(runtime?.weather_location?.LAT ?? 42.7875);
    const lon = Number(runtime?.weather_location?.LON ?? -86.1089);
    const controller = new AbortController();
    // A hung request must never pin the in-flight guard and silently kill
    // every future refresh — 12s and move on.
    const timeoutId = window.setTimeout(() => controller.abort(), 12_000);
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,is_day,cloud_cover,uv_index,pressure_msl,visibility&hourly=temperature_2m,weather_code,precipitation_probability,is_day,cloud_cover,wind_speed_10m,wind_direction_10m,relative_humidity_2m,visibility&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset,uv_index_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=6`, { signal: controller.signal })
      .then(r => r.json())
      .then(data => {
        if (controller.signal.aborted) return;
        const current = data.current ?? {};
        const daily = data.daily;
        const hourly = data.hourly;
        const currentWMO = wmoToCondition(current.weather_code ?? 1);
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

        // Open-Meteo returns location-local naive ISO strings ("2026-09-01T14:00").
        // `new Date()` parses those in the DEVICE timezone, which shifts the
        // hourly axis when a parent's phone travels. Interpret them in the
        // location's own UTC offset (the API answers `utc_offset_seconds`).
        const utcOffsetSec: number = typeof data.utc_offset_seconds === "number" ? data.utc_offset_seconds : 0;
        const parseLocalIso = (t: string): number => {
          const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(t);
          if (!m) return new Date(t).getTime();
          const asUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
          return asUtc - utcOffsetSec * 1000;
        };
        const toTrueUTC = (t: string): string => new Date(parseLocalIso(t)).toISOString();
        if (hourly?.time) hourly.time = hourly.time.map(toTrueUTC);
        if (daily?.sunrise) daily.sunrise = daily.sunrise.map(toTrueUTC);
        if (daily?.sunset) daily.sunset = daily.sunset.map(toTrueUTC);

        const hours: HourPoint[] = [];
        if (hourly?.time) {
          const nowMs = Date.now();
          let start = hourly.time.findIndex((t: string) => parseLocalIso(t) >= nowMs - 59 * 60 * 1000);
          if (start === -1) start = 0;
          const fallbackIsDay = getRealTimeOfDay() === "day";
          for (let i = start; i < Math.min(start + 24, hourly.time.length); i++) {
            const temp = hourly.temperature_2m?.[i] ?? current.temperature_2m;
            if (typeof temp !== "number") continue; // a missing temp must not bend the curve
            hours.push({
              time: hourly.time[i],
              temp: temp,
              code: hourly.weather_code?.[i] ?? current.weather_code ?? 1,
              precip: hourly.precipitation_probability?.[i] ?? 0,
              isDay: hourly.is_day?.[i] != null ? hourly.is_day[i] === 1 : fallbackIsDay,
              cloud: hourly.cloud_cover?.[i] ?? current.cloud_cover ?? null,
              wind: hourly.wind_speed_10m?.[i] ?? current.wind_speed_10m ?? null,
              windDir: hourly.wind_direction_10m?.[i] ?? current.wind_direction_10m ?? 270,
              humidity: hourly.relative_humidity_2m?.[i] ?? current.relative_humidity_2m ?? null,
              visibility: typeof hourly.visibility?.[i] === "number"
                ? hourly.visibility[i]
                : (typeof current.visibility === "number" ? current.visibility : null),
            });
          }
        }

        const forecast: ForecastDay[] = daily?.time
          ? daily.time.slice(1, 6).map((date: string, i: number) => {
            const wmo = wmoToCondition(daily.weather_code?.[i + 1] ?? 1);
            const high = typeof daily.temperature_2m_max?.[i + 1] === "number" ? Math.round(daily.temperature_2m_max[i + 1]) : null;
            const low = typeof daily.temperature_2m_min?.[i + 1] === "number" ? Math.round(daily.temperature_2m_min[i + 1]) : null;
            if (high == null || low == null) return null; // a fabricated 70/55 is worse than a missing row
            return {
              day: days[new Date(`${date}T12:00:00`).getDay()],
              high,
              low,
              condition: wmo.condition,
              emoji: wmo.emoji,
              precipitation: daily.precipitation_probability_max?.[i + 1] || 0,
            };
          }).filter((d: ForecastDay | null): d is ForecastDay => d != null)
          : [];

        // Where does the severe weather end? First hour outside the same
        // severe family (storm or heavy snow) — fuels the "clearing by ~X PM"
        // reassurance line for both advisory types.
        let severeEndISO: string | null = null;
        const severeKind = severeFamily(current.weather_code ?? 1);
        if (severeKind && hourly?.time) {
          const nowMs = Date.now();
          let i = hourly.time.findIndex((t: string) => parseLocalIso(t) >= nowMs - 59 * 60 * 1000);
          if (i === -1) i = 0;
          for (; i < hourly.time.length; i++) {
            if (severeFamily(hourly.weather_code?.[i] ?? 0) !== severeKind) { severeEndISO = hourly.time[i]; break; }
          }
        }

        // The next precipitation hit + its plain sentence, for calendar fusion.
        const outlookInfo = deriveOutlookInfo(hourly, currentWMO.condition);

        setWeatherData({
          temp: typeof current.temperature_2m === "number" ? Math.round(current.temperature_2m) : null,
          feelsLike: typeof current.apparent_temperature === "number" ? Math.round(current.apparent_temperature) : (typeof current.temperature_2m === "number" ? Math.round(current.temperature_2m) : null),
          humidity: typeof current.relative_humidity_2m === "number" ? current.relative_humidity_2m : null,
          wind: typeof current.wind_speed_10m === "number" ? Math.round(current.wind_speed_10m) : null,
          windDir: current.wind_direction_10m ?? 270,
          code: current.weather_code ?? 1,
          isDay: current.is_day != null ? current.is_day === 1 : getRealTimeOfDay() === "day",
          cloud: typeof current.cloud_cover === "number" ? current.cloud_cover : null,
          uv: typeof current.uv_index === "number" ? Math.round(current.uv_index) : (typeof daily?.uv_index_max?.[0] === "number" ? Math.round(daily.uv_index_max[0]) : null),
          pressure: typeof current.pressure_msl === "number" ? Math.round(current.pressure_msl) : null,
          visibility: typeof current.visibility === "number" ? current.visibility : null,
          condition: currentWMO.condition,
          sunriseISO: daily?.sunrise?.[0] ?? null,
          sunsetISO: daily?.sunset?.[0] ?? null,
          hours,
          forecast,
          todayHigh: typeof daily?.temperature_2m_max?.[0] === "number" ? Math.round(daily.temperature_2m_max[0]) : null,
          todayLow: typeof daily?.temperature_2m_min?.[0] === "number" ? Math.round(daily.temperature_2m_min[0]) : null,
          outlook: outlookInfo?.sentence ?? null,
          rainHourISO: outlookInfo?.hitISO ?? null,
          rainSentence: outlookInfo?.sentence ?? null,
          severeEndISO,
        });
        const fetchedAt = Date.now();
        setUpdatedAt(fetchedAt);
        updatedAtRef.current = fetchedAt;
        setFetchError(null);
        dataLoadedRef.current = true;
        setLoading(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return; // timed out — treat like a hung request, wait for next cycle
        if (!dataLoadedRef.current) {
          setFetchError("Weather unavailable — check connection or try again.");
          setLoading(false);
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        inFlightRef.current = false;
      });
  }, [runtime?.weather_location?.LAT, runtime?.weather_location?.LON]);

  useEffect(() => {
    dataLoadedRef.current = false; // new location = no data has ever loaded for it
    updatedAtRef.current = null;
    loadWeather();
  }, [loadWeather]);

  // Today's family events — the fusion input. Read-only, best-effort: guests
  // may get 401s from the sessioned gateway and that's fine (no fusion note).
  // The cache hydrates async, so re-read whenever a data refresh lands.
  useEffect(() => {
    let alive = true;
    const read = () => {
      try {
        const rows = Promise.resolve(db.selectTodaysEvents());
        Promise.resolve(rows).then((r: any[]) => {
          if (!alive || !Array.isArray(r)) return;
          setFamilyEvents(r.map((e) => ({ title: String(e.title ?? ""), member: e.member ?? null, time: e.time ?? null })));
        }).catch(() => {});
      } catch { /* no fusion */ }
    };
    read();
    document.addEventListener("consuela-data-refreshed", read);
    return () => {
      alive = false;
      document.removeEventListener("consuela-data-refreshed", read);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(loadWeather, 15 * 60_000);
    return () => clearInterval(id);
  }, [loadWeather]);

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  useEffect(() => {
    if (!detailsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDetailsOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [detailsOpen]);

  useEffect(() => {
    if (updatedAt === null) return;
    const id = setInterval(() => setClockTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [updatedAt]);

  useEffect(() => {
    const onVisibility = () => {
      setTabHidden(document.hidden);
      if (
        !document.hidden &&
        updatedAtRef.current !== null &&
        Date.now() - updatedAtRef.current > 10 * 60_000
      ) {
        loadWeather();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [loadWeather]);

  useEffect(() => () => { if (releaseTimerRef.current) window.clearTimeout(releaseTimerRef.current); }, []);

  const conv = (f: number) => (weather.unit === "C" ? toC(f) : Math.round(f));

  const season = (weather.season === "auto" ? getRealSeason() : weather.season) as SeasonKey;
  const todOverride = weather.timeOfDay;

  const rawHoliday = weather.holidayOverride ?? "auto";
  const activeHoliday: HolidayOverride = rawHoliday === "auto" ? detectAutoHoliday() : rawHoliday;
  const holidayStyle = activeHoliday !== "none" ? HOLIDAY_STYLE[activeHoliday] ?? null : null;

  const stripHours = useMemo(() => {
    if (!weatherData) return [] as HourPoint[];
    const end = stripEndIndex(weatherData.hours);
    return end < 0 ? [] : weatherData.hours.slice(0, end + 1);
  }, [weatherData]);

  const activeHour = previewIdx != null ? stripHours[previewIdx] ?? null : null;

  const resolveIsDay = (hourIsDay?: boolean) =>
    todOverride === "day" ? true : todOverride === "night" ? false : hourIsDay ?? getRealTimeOfDay() === "day";

  const sceneIsDay = resolveIsDay(activeHour ? activeHour.isDay : weatherData?.isDay);
  const sceneCode = activeHour?.code ?? weatherData?.code ?? 1;
  const isPaused = !!fetchError && !weatherData;
  const sceneState: SceneState = isPaused
    ? {
        code: 45,
        isDay: true,
        cloudCover: 88,
        windSpeed: 4,
        windDir: 270,
        precipProb: 0,
        humidity: 88,
        sunProgress: 0.5,
        visibility: 6000,
        timestamp: 0,
      }
    : {
        code: sceneCode,
        isDay: sceneIsDay,
        cloudCover: activeHour?.cloud ?? weatherData?.cloud ?? 25,
        windSpeed: activeHour?.wind ?? weatherData?.wind ?? 6,
        windDir: activeHour?.windDir ?? weatherData?.windDir ?? 270,
        precipProb: activeHour?.precip ?? (RAIN_CODES.has(sceneCode) ? 70 : 8),
        humidity: activeHour?.humidity ?? weatherData?.humidity ?? 50,
        sunProgress: sunProgressAt(
          activeHour?.time ?? new Date().toISOString(),
          weatherData?.sunriseISO ?? null,
          weatherData?.sunsetISO ?? null
        ),
        visibility: activeHour?.visibility ?? weatherData?.visibility ?? null,
        timestamp: activeHour ? new Date(activeHour.time).getTime() : weatherData ? new Date().getTime() : 0,
      };
  const rawSkin = getWeatherSkin(season, !sceneIsDay, sceneCode);
  // Severity owns the card: storms and heavy snow never borrow the holiday
  // party accent, and the celebratory layers stay home until it passes.
  const accent = resolveAccent(rawSkin, holidayStyle?.accent);
  // High-contrast boost never reached the widget (inline skin styling bypasses
  // the app's [data-contrast="boost"] system). Boost alpha when the flag is set.
  const [isBoosted, setIsBoosted] = useState(false);
  useEffect(() => {
    const check = () => setIsBoosted(document.documentElement.getAttribute("data-contrast") === "boost");
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-contrast"] });
    return () => obs.disconnect();
  }, []);
  const skin = useMemo(() => {
    if (!isBoosted) return rawSkin;
    return {
      ...rawSkin,
      inkSoft: rawSkin.inkSoft.replace(/0\.\d+\)$/, "0.85)"),
      border: rawSkin.border.replace(/0\.\d+\)$/, "0.35)"),
      stripTrack: rawSkin.stripTrack.replace(/0\.\d+\)$/, "0.28)"),
    };
  }, [rawSkin, isBoosted]);

  const heroTempTarget = activeHour
    ? conv(activeHour.temp)
    : (weatherData?.temp == null ? null : conv(weatherData.temp));
  const heroTemp = useAnimatedNumber(heroTempTarget ?? 0);

  const displayHigh = weatherData?.todayHigh == null ? null : conv(weatherData.todayHigh);
  const displayLow = weatherData?.todayLow == null ? null : conv(weatherData.todayLow);

  const feelsNote = !activeHour && weatherData?.feelsLike != null && weatherData.temp != null && Math.abs(conv(weatherData.feelsLike) - conv(weatherData.temp)) >= 2
    ? `Feels like ${conv(weatherData.feelsLike)}°`
    : null;

  // Family-language line: rain timing wins; otherwise the wear answer
  // ("Coats this morning" / "Sunglasses this afternoon") for the 5–14 crowd.
  const wearLine = useMemo(() => {
    if (!weatherData || weatherData.temp == null) return null;
    const feels = weatherData.feelsLike ?? weatherData.temp;
    const wetHour = weatherData.rainHourISO
      ? weatherData.hours.find((h) => h.time === weatherData.rainHourISO)
      : null;
    return wearAdvice(feels, wetHour?.precip ?? (RAIN_CODES.has(weatherData.code) ? 70 : 8), isKid);
  }, [weatherData, isKid]);

  // Calendar fusion — "Rain around Soccer Practice": the one thing only
  // Consuela can say. Only when a rain hit and a same-day event line up.
  const fusionLine = useMemo(() => {
    if (!weatherData?.rainHourISO || !weatherData.rainSentence || familyEvents.length === 0) return null;
    if (typeof window === "undefined") return null;
    return fusionOutlook(weatherData.rainHourISO, weatherData.rainSentence, familyEvents, Date.now());
  }, [weatherData, familyEvents]);

  // Severe-weather reassurance: name the storm/snow, then answer "when is it over".
  const severeLine = useMemo(() => {
    if (!weatherData) return null;
    const kind = severeFamily(weatherData.code);
    if (kind === "storm") return stormAdvice(weatherData.severeEndISO, isKid);
    if (kind === "snow") return snowAdvice(weatherData.severeEndISO, isKid);
    return null;
  }, [weatherData, isKid]);
  const isSevere = !!rawSkin.severe;

  const minutesSinceUpdate = updatedAt === null
    ? null
    : Math.max(0, Math.floor(((clockTick || updatedAt) - updatedAt) / 60_000));
  const updatedLabel = minutesSinceUpdate === null
    ? null
    : minutesSinceUpdate < 1 ? "Updated just now" : `Updated ${minutesSinceUpdate}m ago`;

  const handlePreview = (idx: number | null) => {
    if (releaseTimerRef.current) {
      window.clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
    }
    if (idx !== null) {
      setPreviewIdx(idx);
      return;
    }
    // Pinned previews stay until explicitly released ("Back to now"); an
    // unpinned drag glides home after 650ms as before.
    if (!previewPinned) {
      releaseTimerRef.current = window.setTimeout(() => setPreviewIdx(null), 650);
    }
  };

  const handleStripTap = (idx: number) => {
    // Tap (no horizontal intent) pins the preview — the answer stays on the
    // card until you look back at it, then release via "Back to now".
    setPreviewPinned(true);
    setPreviewIdx(idx);
  };

  const handleStripRelease = useCallback(() => {
    setPreviewPinned(false);
    setPreviewIdx(null);
  }, []);

  // Teach by demonstration: once, on first data, the scene briefly visits
  // mid-afternoon then glides home — the signature move introduces itself.
  useEffect(() => {
    if (taughtRef.current || !weatherData || loading || fetchError) return;
    if (stripHours.length < 4) return;
    taughtRef.current = true;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const target = Math.min(stripHours.length - 1, 6);
    const teachId = window.setTimeout(() => {
      setPreviewIdx(target);
      window.setTimeout(() => {
        setPreviewIdx(null);
        setPreviewPinned(false);
      }, 1400);
    }, 900);
    return () => window.clearTimeout(teachId);
  }, [weatherData, loading, fetchError, stripHours.length]);

  const heroCondition = activeHour
    ? `${formatHourLabel(activeHour.time)} · ${wmoToCondition(activeHour.code).condition}`
    : weatherData?.condition ?? null;

  const closeDetails = useCallback(() => {
    setDetailsOpen(false);
    requestAnimationFrame(() => detailsBtnRef.current?.focus());
  }, []);

  // Single polite announcement, refreshed only when real data lands — never
  // per scrub step (the slider's valuetext already covers previews).
  const liveAnnouncement = !activeHour && weatherData
    ? `${heroTempTarget ?? "unknown"} degrees, ${heroCondition} in ${weather.location}`
    : " ";

  return (
    <div
      className={`relative ${className}`}
      style={{ animation: mounted ? "weatherCardEnter 1s var(--ease-spring) both" : undefined }}
    >
      <div
        role="group"
        aria-label={`${heroTempTarget ?? "unknown"} degrees, ${heroCondition ?? "weather"} in ${weather.location}${displayHigh !== null && displayLow !== null ? `, high ${displayHigh}, low ${displayLow}` : ""}`}
        className="rounded-2xl overflow-hidden relative h-full flex flex-col"
        style={{
          border: `1px solid ${skin.border}`,
          boxShadow: `0 0 60px ${skin.glow}, 0 16px 48px rgba(0,0,0,0.22), inset 0 1px 0 ${skin.night ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.35)"}`,
          transition: "box-shadow 0.8s ease, border-color 0.8s ease",
          minHeight: "220px",
          background: skin.skyBottom,
        }}
      >
        <WeatherScene skin={skin} state={sceneState} season={season} animated={!fetchError} />
        {fetchError && !weatherData && (
          <div className="pointer-events-none absolute inset-0 z-[1] bg-[rgba(120,128,145,0.38)] backdrop-blur-[1px]" aria-hidden="true" />
        )}

        {mounted && !isSevere && activeHoliday !== "none" && activeHoliday !== "auto" && (
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <SeasonHolidayArt season={season} tod={sceneIsDay ? "day" : "night"} activeHoliday={activeHoliday} backdrop={false} />
          </div>
        )}
        {mounted && !isSevere && !tabHidden && holidayStyle && (
          <HolidayParticles type={holidayStyle.particle} tod={sceneIsDay ? "day" : "night"} />
        )}

        <div
          className="pointer-events-none absolute inset-0 z-10"
          aria-hidden="true"
          style={{
            background: `radial-gradient(70% 55% at 50% 42%, ${skin.night ? "rgba(6,6,9,0.40)" : "rgba(255,255,255,0.30)"} 0%, transparent 72%)`,
          }}
        />

        <div className="pointer-events-none relative z-20 flex h-full min-h-0 flex-col px-5 pb-4 pt-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}
                className="h-3.5 w-3.5 shrink-0" style={{ color: accent }}>
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span className="truncate" style={{ color: skin.ink }}>{weather.location}</span>
              {holidayStyle && (
                <span
                  className="ml-1 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider"
                  style={{ background: `${holidayStyle.accent}22`, color: skin.night ? holidayStyle.accent : skin.ink, border: `1px solid ${holidayStyle.accent}55` }}
                >
                  {holidayStyle.label}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setUnit(weather.unit === "F" ? "C" : "F")}
              aria-label={`Switch to ${weather.unit === "F" ? "Celsius" : "Fahrenheit"}`}
              className="pointer-events-auto relative z-30 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2"
              style={{ background: skin.stripTrack, color: skin.ink, ["--tw-ring-color" as string]: accent }}
            >
              <span aria-hidden="true">°{weather.unit === "F" ? "C" : "F"}</span>
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-center">
            <div role="status" aria-live="polite" className="sr-only">{liveAnnouncement}</div>
            {loading ? (
              <div className="w-full space-y-2.5">
                <Skeleton variant="title" className="mx-auto h-12 w-28 bg-black/10" />
                <Skeleton variant="text" className="mx-auto h-3 w-24 bg-black/10" />
                <Skeleton variant="text" className="mx-auto h-3 w-32 bg-black/10" />
              </div>
            ) : (
              <>
                {/* isolate: keeps the scene SVG from stacking over the hero digits */}
                <div className="isolate flex items-start leading-none">
                  {heroTempTarget == null ? (
                    <span data-testid="wx-hero-temp" className="text-[56px] font-black leading-none tracking-[-0.03em] xl:text-[64px]" style={{ color: skin.ink }}>—</span>
                  ) : (
                    <>
                      <span
                        data-testid="wx-hero-temp"
                        className="relative z-10 text-[56px] font-black leading-none tracking-[-0.03em] tabular-nums xl:text-[64px]"
                        style={{ color: skin.ink }}
                      >
                        {heroTemp}
                      </span>
                      <span className="mt-1.5 ml-0.5 text-[28px] font-light leading-none" style={{ color: skin.inkSoft }} aria-hidden="true">°</span>
                      <span className="sr-only"> degrees</span>
                    </>
                  )}
                </div>
                {heroCondition && (
                  <p className="relative z-10 mt-1.5 text-[15px] font-semibold leading-none" style={{ color: skin.ink }}>
                    {heroCondition}
                  </p>
                )}
                {severeLine && (
                  <div className="relative z-10 mt-1.5 max-w-full rounded-2xl px-3 py-2 text-center" style={{ background: `${accent}18`, border: `1px solid ${accent}22` }} role="status">
                    <p className="text-[11px] font-bold leading-tight" style={{ color: skin.night ? "#FFF8EC" : "#4A2E05" }}>{severeFamily(weatherData?.code ?? 0) === "snow" ? "❄️" : "⛈️"} {severeLine.headline}</p>
                    <p className="mt-0.5 text-[11px] font-medium leading-tight" style={{ color: skin.night ? "rgba(255,248,236,0.85)" : "rgba(74,46,5,0.85)" }}>{severeLine.detail}</p>
                  </div>
                )}
                {!severeLine && fusionLine && (
                  <div className="relative z-10 mt-1.5 max-w-full rounded-2xl px-3 py-2 text-center" style={{ background: `${accent}14`, border: `1px solid ${accent}20` }}>
                    <p className="text-[11px] font-bold leading-tight" style={{ color: skin.night ? accent : skin.ink }}>📅 {fusionLine.headline}</p>
                    <p className="mt-0.5 text-[11px] font-medium leading-tight" style={{ color: skin.inkSoft }}>{fusionLine.detail}</p>
                  </div>
                )}
                {!severeLine && displayHigh !== null && displayLow !== null && (
                  <p className="relative z-10 mt-1 text-xs font-semibold" style={{ color: skin.inkSoft }}>
                    H:{displayHigh}° L:{displayLow}°{feelsNote && ` · ${feelsNote}`}
                  </p>
                )}
                {!severeLine && !fusionLine && !activeHour && wearLine && (
                  <p className="relative z-10 mt-0.5 text-xs font-medium" style={{ color: skin.inkSoft }}>
                    {wearLine.headline}
                  </p>
                )}
                {!severeLine && !fusionLine && !activeHour && weatherData?.outlook && (
                  <p className="relative z-10 mt-0.5 text-xs font-medium" style={{ color: skin.inkSoft }}>
                    {weatherData.outlook}
                  </p>
                )}
                {fetchError && (
                  <p className="pointer-events-auto mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-900" role="alert">
                    {fetchError}
                    <button
                      type="button"
                      onClick={loadWeather}
                      className="pointer-events-auto ml-0.5 min-h-[44px] rounded-full px-2 text-[11px] font-bold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2"
                      style={{ ["--tw-ring-color" as string]: accent }}
                    >
                      Try again
                    </button>
                  </p>
                )}
              </>
            )}
          </div>

          {!loading && stripHours.length >= 2 && (
            <div className="pointer-events-auto shrink-0">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: skin.inkSoft }}>
                <span>{stripHours.length > 0 && new Date(stripHours[0].time).getDate() !== new Date(stripHours[stripHours.length - 1].time).getDate() ? "Next hours" : "Rest of today"}</span>
                <svg viewBox="0 0 10 16" className="h-4 w-2.5 shrink-0 opacity-70" aria-hidden="true">
                  <circle cx="2.5" cy="3" r="1.4" fill="currentColor" /><circle cx="7.5" cy="3" r="1.4" fill="currentColor" />
                  <circle cx="2.5" cy="8" r="1.4" fill="currentColor" /><circle cx="7.5" cy="8" r="1.4" fill="currentColor" />
                  <circle cx="2.5" cy="13" r="1.4" fill="currentColor" /><circle cx="7.5" cy="13" r="1.4" fill="currentColor" />
                </svg>
                {previewPinned && (
                  <button
                    type="button"
                    onClick={handleStripRelease}
                    className="relative z-30 ml-auto flex min-h-[44px] items-center rounded-full px-3 text-[11px] font-bold normal-case tracking-normal transition-colors focus-visible:outline-none focus-visible:ring-2"
                    style={{ background: skin.stripTrack, color: skin.ink, ["--tw-ring-color" as string]: accent }}
                  >
                    ↩ Back to now
                  </button>
                )}
              </p>
              <DayStrip
                hours={stripHours}
                conv={conv}
                skin={skin}
                accent={accent}
                previewIdx={previewIdx}
                previewPinned={previewPinned}
                onPreview={handlePreview}
                onTapPin={handleStripTap}
                onRelease={handleStripRelease}
              />
            </div>
          )}

          <div className="mt-2 flex items-center justify-between gap-3">
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{
                color: minutesSinceUpdate != null && minutesSinceUpdate > 30 ? "#92400e" : skin.inkSoft,
                background: minutesSinceUpdate != null && minutesSinceUpdate > 30 ? "rgba(251,191,36,0.18)" : "transparent",
              }}
            >
              {updatedLabel ?? ""}
            </span>
            <button
              ref={detailsBtnRef}
              type="button"
              onClick={() => setDetailsOpen(true)}
              aria-expanded={detailsOpen}
              aria-controls="weather-details-dialog"
              aria-label="Open weather details"
              className="pointer-events-auto relative z-30 flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-lg px-2.5 text-xs font-bold transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0"
              style={{ color: skin.night ? accent : skin.ink, ["--tw-ring-color" as string]: accent }}
            >
              Details
            </button>
          </div>
        </div>
      </div>

      {detailsOpen && weatherData && (
        <WeatherDetailsModal
          data={weatherData}
          location={weather.location}
          conv={conv}
          season={season}
          todOverride={todOverride}
          accent={accent}
          onClose={closeDetails}
        />
      )}
    </div>
  );
}

// ─── Details modal — 24h timeline scrubber + exploded metrics ───────────────

function WeatherDetailsModal({ data, location, conv, season, todOverride, accent, onClose }: {
  data: WeatherData;
  location: string;
  conv: (f: number) => number;
  season: SeasonKey;
  todOverride: "auto" | "day" | "night";
  accent: string;
  onClose: () => void;
}) {
  const [scrubIdx, setScrubIdx] = useState(0);
  const [view, setView] = useState<"hourly" | "daily">("hourly");
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Focus lands inside the dialog on open; Tab cycles within it; focus
  // returns to the Details trigger via the parent's close handler.
  useEffect(() => {
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panelRef.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const hours = data.hours;
  const scrubHour = hours[scrubIdx] ?? null;

  const mIsDay = todOverride === "day" ? true : todOverride === "night" ? false : scrubHour?.isDay ?? data.isDay;
  const mCode = scrubHour?.code ?? data.code;
  const mSkin = getWeatherSkin(season, !mIsDay, mCode);

  const scrubTemp = useAnimatedNumber(conv(scrubHour?.temp ?? data.temp ?? 0));

  const nowMoon = moonPhase(new Date().getTime());

  const forecastRows = data.forecast.map((day) => ({
    ...day,
    displayHigh: conv(day.high),
    displayLow: conv(day.low),
  }));
  const weekMin = forecastRows.length ? Math.min(...forecastRows.map((d) => d.displayLow)) : 0;
  const weekMax = forecastRows.length ? Math.max(...forecastRows.map((d) => d.displayHigh)) : 1;
  const weekSpan = Math.max(weekMax - weekMin, 1);

  const sceneState: SceneState = {
    code: mCode,
    isDay: mIsDay,
    cloudCover: scrubHour?.cloud ?? data.cloud ?? 25,
    windSpeed: scrubHour?.wind ?? data.wind ?? 6,
    windDir: scrubHour?.windDir ?? data.windDir,
    precipProb: scrubHour?.precip ?? (RAIN_CODES.has(mCode) ? 70 : 8),
    humidity: scrubHour?.humidity ?? data.humidity ?? 50,
    sunProgress: sunProgressAt(scrubHour?.time ?? new Date().toISOString(), data.sunriseISO, data.sunsetISO),
    visibility: scrubHour?.visibility ?? data.visibility,
    timestamp: scrubHour ? new Date(scrubHour.time).getTime() : new Date().getTime(),
  };

  return (
    <div
      id="weather-details-dialog"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0a0f1c]/55 p-3 backdrop-blur-[2px] sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Weather details"
    >
      <div
        ref={panelRef}
        className="relative flex w-full max-w-[440px] max-h-[88vh] flex-col overflow-hidden rounded-[2rem] sm:max-h-[84vh]"
        style={{
          background: "linear-gradient(170deg, rgba(16,20,34,0.92) 0%, rgba(10,13,24,0.94) 100%)",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: `0 0 80px ${mSkin.glow}, 0 24px 64px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.09)`,
          animation: "modalEnter 0.38s var(--ease-spring) both",
          backdropFilter: "blur(18px) saturate(1.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-[rgba(8,12,24,0.42)] px-5 py-3 backdrop-blur-md">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/60">Weather</p>
            <p className="truncate text-sm font-semibold text-white">{location}</p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close weather details"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/12 bg-white/10 text-white/80 backdrop-blur transition hover:bg-white/16 hover:text-white active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="space-y-5 p-5">
            <div className="relative h-48 overflow-hidden rounded-2xl" style={{ border: "1px solid rgba(255,255,255,0.10)" }}>
              <WeatherScene skin={mSkin} state={sceneState} season={season} />
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <div className="flex items-start leading-none">
                  <span
                    className="text-[60px] font-black leading-none tracking-[-0.03em] tabular-nums"
                    style={{ color: mSkin.ink, textShadow: mSkin.night ? "none" : "0 1px 12px rgba(255,255,255,0.35)" }}
                  >
                    {scrubTemp}
                  </span>
                  <span className="mt-1 ml-0.5 text-2xl font-light leading-none" style={{ color: mSkin.night ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.45)" }} aria-hidden="true">°</span>
                </div>
                <p className="mt-1.5 text-sm font-semibold" style={{ color: mSkin.ink, textShadow: mSkin.night ? "none" : "0 1px 10px rgba(255,255,255,0.3)" }}>
                  {scrubHour ? `${formatHourLabel(scrubHour.time)} · ${wmoToCondition(scrubHour.code).condition}` : data.condition}
                </p>
              </div>
            </div>

            {hours.length >= 2 && (
              <div>
                <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-white/50">Next 24 Hours</p>
                <TimelineScrubber hours={hours} conv={conv} accent={accent} idx={scrubIdx} onIdx={setScrubIdx} />
              </div>
            )}

            <div className="space-y-2.5">
              <LeaderRow
                label="Humidity"
                value={scrubHour?.humidity != null || data.humidity != null ? `${Math.round(scrubHour?.humidity ?? data.humidity!)}%` : "—"}
                hidden={scrubHour?.humidity == null && data.humidity == null}
              />
              <LeaderRow
                label="Wind"
                value={`${Math.round(scrubHour?.wind ?? data.wind ?? 0)} mph ${cardinalFromDegrees(scrubHour?.windDir ?? data.windDir)}`}
                hidden={scrubHour?.wind == null && data.wind == null}
              >
                <svg
                  viewBox="0 0 16 16"
                  className="h-3.5 w-3.5 shrink-0"
                  style={{ color: accent, transform: `rotate(${((scrubHour?.windDir ?? data.windDir) + 180) % 360}deg)`, transition: "transform 0.6s var(--ease-settle, ease-out)" }}
                  aria-hidden="true"
                >
                  <path d="M8 1.5 L11 10.5 L8 8.8 L5 10.5 Z" fill="currentColor" />
                </svg>
              </LeaderRow>
              <LeaderRow label="Precipitation" value={`${Math.round(scrubHour?.precip ?? 0)}%`} />
              <LeaderRow
                label="Cloud cover"
                value={scrubHour?.cloud != null || data.cloud != null ? `${Math.round(scrubHour?.cloud ?? data.cloud!)}%` : "—"}
                hidden={scrubHour?.cloud == null && data.cloud == null}
              />
              <LeaderRow
                label="Feels like"
                value={scrubIdx !== 0 ? "—" : data.feelsLike != null ? `${conv(data.feelsLike)}°` : "—"}
              />
              <div className="flex items-baseline gap-2.5">
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/60">UV index</span>
                <span className="flex-1 border-b border-dotted border-white/25" aria-hidden="true" />
                <span className="flex items-center gap-2 rounded-full bg-white/10 px-2.5 py-1">
                  {scrubIdx === 0 && data.uv != null ? <UvDots uv={data.uv} accent={accent} /> : null}
                  <span className="text-[13px] font-bold tabular-nums text-white">{scrubIdx !== 0 ? "—" : data.uv != null ? String(data.uv) : "—"}</span>
                </span>
              </div>
              <LeaderRow label="Pressure" value={scrubIdx !== 0 ? "—" : data.pressure != null ? `${data.pressure} hPa` : "—"} />
            </div>

            {data.sunriseISO && data.sunsetISO && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white/50">Daylight</p>
                <SunArc
                  sunriseISO={data.sunriseISO}
                  sunsetISO={data.sunsetISO}
                  progress={sunProgressAt(new Date().toISOString(), data.sunriseISO, data.sunsetISO)}
                  accent={accent}
                />
                <div className="mt-3 flex items-baseline gap-2.5">
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/60">Moon</span>
                  <span className="flex-1 border-b border-dotted border-white/25" aria-hidden="true" />
                  <span className="text-[13px] font-bold text-white">
                    {moonPhaseName(nowMoon.phase)} · {Math.round(nowMoon.illumination * 100)}%
                  </span>
                </div>
              </div>
            )}

            <div>
              <div className="mb-2.5 flex items-center justify-between">
                <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">
                  {view === "hourly" ? "Hourly" : "5-Day Forecast"}
                </h4>
                <div className="flex rounded-full border border-white/12 bg-white/[0.06] p-0.5" role="tablist" aria-label="Forecast view">
                  {(["hourly", "daily"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      role="tab"
                      aria-selected={view === v}
                      onClick={() => setView(v)}
                      className="rounded-full px-3 py-1 text-[11px] font-bold capitalize transition-colors"
                      style={view === v ? { background: accent, color: "#fff" } : { color: "rgba(255,255,255,0.6)" }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {view === "hourly" ? (
                <div className="flex gap-1 overflow-x-auto pb-1" role="list">
                  {hours.map((h, i) => (
                    <div key={h.time} role="listitem" className="shrink-0">
                    <button
                      type="button"
                      onClick={() => setScrubIdx(i)}
                      className="relative flex flex-col items-center gap-1.5 rounded-xl px-2.5 py-2.5 transition-colors"
                      style={i === scrubIdx ? { background: `${accent}1F` } : undefined}
                      aria-label={`${formatHourLabel(h.time)}, ${conv(h.temp)} degrees`}
                    >
                      {i === scrubIdx && (
                        <span className="absolute inset-x-2 top-0 h-[2.5px] rounded-full" style={{ background: accent }} aria-hidden="true" />
                      )}
                      <span className="text-[11px] font-bold" style={{ color: i === scrubIdx ? accent : "rgba(255,255,255,0.6)" }}>
                        {i === 0 ? "NOW" : formatHourTick(h.time)}
                      </span>
                      <span className="text-base leading-none">{wmoToCondition(h.code).emoji}</span>
                      <span className="text-sm font-black tabular-nums text-white">{conv(h.temp)}°</span>
                      {h.precip >= 20 ? (
                        <span className="text-[11px] font-semibold tabular-nums" style={{ color: accent }}>
                          {h.precip}%
                        </span>
                      ) : (
                        <span className="h-[13px]" aria-hidden="true" />
                      )}
                    </button>
                    </div>
                  ))}
                </div>
              ) : forecastRows.length === 0 ? (
                <div className="rounded-2xl border border-white/12 bg-[rgba(8,12,24,0.20)] px-4 py-6 text-center backdrop-blur-md">
                  <p className="text-sm font-semibold text-white/85">No 5-day forecast yet</p>
                  <p className="mt-1 text-xs text-white/55">The next refresh should fill it in — check back in a few minutes.</p>
                </div>
              ) : (
                <div role="list" className="overflow-hidden rounded-2xl border border-white/12 bg-[rgba(8,12,24,0.20)] backdrop-blur-md">
                  {forecastRows.map((day, i) => {
                    const leftPct = ((day.displayLow - weekMin) / weekSpan) * 100;
                    const widthPct = Math.max(((day.displayHigh - day.displayLow) / weekSpan) * 100, 4);
                    return (
                      <div
                        key={day.day}
                        role="listitem"
                        className="flex items-center gap-3 px-4 py-3.5"
                        style={{
                          borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.06)",
                          background: i % 2 === 1 ? "rgba(255,255,255,0.02)" : "transparent",
                        }}
                      >
                        <span className="w-9 shrink-0 text-xs font-bold tracking-wide text-white">{day.day}</span>
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-[15px] leading-none ring-1 ring-white/10">{day.emoji}</span>
                        <span className="hidden min-w-0 flex-1 truncate text-xs font-medium text-white/75 sm:block">{day.condition}</span>
                        <span className="shrink-0 rounded-full px-2 py-1 text-xs font-bold leading-none text-white" style={{ background: `${accent}22`, border: `1px solid ${accent}30` }}>{day.precipitation}%</span>
                        <span className="w-8 shrink-0 text-right text-sm font-semibold text-white/70">{day.displayLow}°</span>
                        <div className="relative h-1.5 min-w-10 flex-1 rounded-full bg-white/10 sm:max-w-24" aria-hidden="true">
                          <div
                            className="absolute inset-y-0 rounded-full"
                            style={{
                              left: `${leftPct}%`,
                              width: `${widthPct}%`,
                              background: `linear-gradient(90deg, ${tempBarColor((day.displayLow - weekMin) / weekSpan)}, ${tempBarColor((day.displayHigh - weekMin) / weekSpan)})`,
                            }}
                          />
                        </div>
                        <span className="w-8 shrink-0 text-right text-sm font-black" style={{ color: accent }}>{day.displayHigh}°</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 border-t border-white/[0.06] bg-[rgba(0,0,0,0.18)] p-4 backdrop-blur-md">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-full border border-white/12 bg-white/12 py-3 text-sm font-bold text-white backdrop-blur transition hover:bg-white/16 active:scale-[0.99]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
