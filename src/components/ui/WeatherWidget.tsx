"use client";

import { useState, useEffect, useRef } from "react";
import { useWeatherConfig } from "@/hooks/useWeather";

// ─── Types ─────────────────────────────────────────────────────────────────

type Condition = "sunny" | "partly-cloudy" | "cloudy" | "rainy" | "snowy";
type TimeOfDayFlag = "day" | "night";

interface ForecastDay {
  day: string;
  high: number;
  low: number;
  condition: string;
  emoji: string;
  precipitation: number;
  humidity: number;
  wind: number;
}

interface Particle {
  id: number;
  x: number;
  y?: number;
  delay: string;
  duration: string;
  size: number;
  color?: string;
}

// ─── State for real API data (declared inside component) ─────────────────────

// ─── Helpers ────────────────────────────────────────────────────────────────

function detectCondition(text: string): Condition {
  const t = text.toLowerCase();
  if (t.includes("sun") || t.includes("clear")) return "sunny";
  if (t.includes("partly") || t.includes("partial")) return "partly-cloudy";
  if (t.includes("cloud")) return "cloudy";
  if (t.includes("rain") || t.includes("shower") || t.includes("drizzle")) return "rainy";
  if (t.includes("snow") || t.includes("blizzard")) return "snowy";
  return "partly-cloudy";
}

function toC(f: number) { return Math.round((f - 32) * 5 / 9); }

function getRealTimeOfDay(): TimeOfDayFlag {
  const hour = new Date().getHours();
  return hour >= 6 && hour < 19 ? "day" : "night";
}

function getRealSeason(): "spring" | "summer" | "autumn" | "winter" {
  const month = new Date().getMonth();
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "autumn";
  return "winter";
}

// ─── Condition visual config ────────────────────────────────────────────────

function getConditionMeta(condition: Condition, tod: TimeOfDayFlag, season: string) {
  let meta = {
    glow: "", gradientStop: "", unitBadgeBg: "", particleType: "none" as any, statColor: ""
  };
  
  if (condition === "sunny") {
    if (tod === "night") {
      meta = {
        glow: "rgba(167,139,250,0.22)", gradientStop: "rgba(139,92,246,0.14)",
        unitBadgeBg: "rgba(167,139,250,0.15)", particleType: "sparkle", statColor: "#8b5cf6"
      };
    } else {
      meta = {
        glow: "rgba(251,191,36,0.22)", gradientStop: "rgba(245,158,11,0.14)",
        unitBadgeBg: "rgba(251,191,36,0.15)", particleType: "sparkle", statColor: "#f59e0b"
      };
    }
  } else if (condition === "partly-cloudy") {
    if (tod === "night") {
      meta = {
        glow: "rgba(99,102,241,0.18)", gradientStop: "rgba(79,70,229,0.10)",
        unitBadgeBg: "rgba(99,102,241,0.12)", particleType: "none", statColor: "#6366f1"
      };
    } else {
      meta = {
        glow: "rgba(59,130,246,0.18)", gradientStop: "rgba(147,197,253,0.10)",
        unitBadgeBg: "rgba(59,130,246,0.12)", particleType: "none", statColor: "#3b82f6"
      };
    }
  } else if (condition === "cloudy") {
    meta = {
      glow: tod === "night" ? "rgba(71,85,105,0.16)" : "rgba(100,116,139,0.16)",
      gradientStop: tod === "night" ? "rgba(51,65,85,0.10)" : "rgba(148,163,184,0.10)",
      unitBadgeBg: tod === "night" ? "rgba(71,85,105,0.12)" : "rgba(100,116,139,0.12)",
      particleType: "none",
      statColor: tod === "night" ? "#475569" : "#64748b"
    };
  } else if (condition === "rainy") {
    meta = {
      glow: "rgba(37,99,235,0.22)", gradientStop: "rgba(6,182,212,0.12)",
      unitBadgeBg: "rgba(37,99,235,0.14)", particleType: "rain", statColor: "#3b82f6"
    };
  } else if (condition === "snowy") {
    meta = {
      glow: "rgba(8,145,178,0.20)", gradientStop: "rgba(186,230,253,0.12)",
      unitBadgeBg: "rgba(8,145,178,0.12)", particleType: "snow", statColor: "#06b6d4"
    };
  }

  // Season overrides for particles if condition allows
  if (condition === "sunny" || condition === "partly-cloudy") {
    if (season === "spring") meta.particleType = "petal";
    if (season === "autumn") meta.particleType = "leaf";
  }

  return meta;
}

// ─── Animated SVG Weather Icons ─────────────────────────────────────────────

function AnimatedSunIcon({ tod }: { tod: TimeOfDayFlag }) {
  const SIZE = 72;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  
  if (tod === "night") {
    return (
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} fill="none" aria-hidden="true">
        <circle cx={CX} cy={CY} r="32" fill="rgba(167,139,250,0.07)" style={{ animation: "weatherGlowPulse 4s ease-in-out infinite" }} />
        {/* Moon */}
        <path d="M40 20 A14 14 0 1 0 52 32 A18 18 0 0 1 40 20 Z" fill="#c4b5fd" />
        <path d="M38 22 A12 12 0 1 0 48 32 A16 16 0 0 1 38 22 Z" fill="#8b5cf6" />
        {/* Stars */}
        <g style={{ animation: "weatherSpin 20s linear infinite", transformOrigin: `${CX}px ${CY}px` }}>
          <circle cx={CX - 20} cy={CY - 15} r="1.5" fill="#fde047" style={{ animation: "weatherGlowPulse 2s ease-in-out infinite" }} />
          <circle cx={CX + 15} cy={CY + 20} r="2" fill="#fde047" style={{ animation: "weatherGlowPulse 3s ease-in-out infinite" }} />
          <circle cx={CX - 10} cy={CY + 25} r="1" fill="#fde047" style={{ animation: "weatherGlowPulse 2.5s ease-in-out infinite" }} />
        </g>
      </svg>
    );
  }

  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} fill="none" aria-hidden="true">
      {/* Outer glow */}
      <circle cx={CX} cy={CY} r="32" fill="rgba(251,191,36,0.07)"
        style={{ animation: "weatherGlowPulse 3.5s ease-in-out infinite" }} />

      {/* Spinning orbit of dots */}
      <g style={{ animation: "weatherSpin 14s linear infinite", transformOrigin: `${CX}px ${CY}px` }}>
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return (
            <circle key={i}
              cx={CX + Math.cos(a) * 30} cy={CY + Math.sin(a) * 30}
              r="2.5" fill="rgba(251,191,36,0.5)" />
          );
        })}
      </g>

      {/* Pulsing rays */}
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return (
          <line key={i}
            x1={CX + Math.cos(a) * 15} y1={CY + Math.sin(a) * 15}
            x2={CX + Math.cos(a) * 23} y2={CY + Math.sin(a) * 23}
            stroke="#fbbf24" strokeWidth="3" strokeLinecap="round"
            style={{
              animation: `weatherRayPulse 2.2s ease-in-out ${i * 0.28}s infinite`,
              transformOrigin: `${CX}px ${CY}px`,
            }} />
        );
      })}

      {/* Inner glow ring */}
      <circle cx={CX} cy={CY} r="14" fill="rgba(251,191,36,0.18)"
        style={{ animation: "weatherGlowPulse 2.2s ease-in-out 0.6s infinite" }} />

      {/* Core */}
      <circle cx={CX} cy={CY} r="12" fill="#fbbf24" />
      <circle cx={CX} cy={CY} r="10" fill="#f59e0b" />
      {/* Highlight */}
      <circle cx={CX - 3.5} cy={CY - 3.5} r="3.5" fill="rgba(254,243,199,0.45)" />
    </svg>
  );
}

function AnimatedPartlyCloudyIcon({ tod }: { tod: TimeOfDayFlag }) {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
      {/* Background celestial body */}
      {tod === "night" ? (
         <g style={{ animation: "weatherGlowPulse 5s ease-in-out infinite" }}>
            <path d="M35 15 A10 10 0 1 0 45 25 A12 12 0 0 1 35 15 Z" fill="#a78bfa" />
         </g>
      ) : (
        <g style={{ animation: "weatherGlowPulse 4s ease-in-out infinite" }}>
          {Array.from({ length: 6 }, (_, i) => {
            const a = (i / 6) * Math.PI * 2;
            return (
              <line key={i}
                x1={24 + Math.cos(a) * 11} y1={24 + Math.sin(a) * 11}
                x2={24 + Math.cos(a) * 16} y2={24 + Math.sin(a) * 16}
                stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />
            );
          })}
          <circle cx="24" cy="24" r="9" fill="#fbbf24" />
          <circle cx="24" cy="24" r="7" fill="#f59e0b" />
          <circle cx="21" cy="21" r="2.5" fill="rgba(254,243,199,0.4)" />
        </g>
      )}

      {/* Floating cloud */}
      <g style={{ animation: "weatherCloudBob 5s ease-in-out infinite" }}>
        <path
          d="M12 54 Q11 44 21 44 Q23 37 33 39 Q41 36 43 42 Q51 42 51 51 Q51 56 46 56 L18 56 Q12 56 12 54 Z"
          fill="var(--color-surface-2)"
          stroke="rgba(203,213,225,0.4)" strokeWidth="1"
        />
        {/* Cloud sheen */}
        <path d="M19 48 Q27 44 35 46"
          stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}

function AnimatedCloudyIcon() {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
      {/* Back cloud — slower bob, offset phase */}
      <g style={{ animation: "weatherCloudBob 7s ease-in-out 1.8s infinite" }}>
        <path
          d="M28 46 Q27 38 36 38 Q38 31 47 33 Q54 31 56 37 Q63 37 63 45 Q63 49 58 49 L34 49 Q28 49 28 46 Z"
          fill="var(--color-surface-3)"
        />
      </g>
      {/* Front cloud */}
      <g style={{ animation: "weatherCloudBob 5.5s ease-in-out infinite" }}>
        <path
          d="M6 52 Q5 42 15 42 Q17 35 27 37 Q35 34 38 40 Q46 40 46 49 Q46 54 41 54 L12 54 Q6 54 6 52 Z"
          fill="var(--color-surface-2)"
          stroke="rgba(203,213,225,0.3)" strokeWidth="0.5"
        />
        <path d="M13 46 Q21 42 29 44"
          stroke="rgba(255,255,255,0.45)" strokeWidth="2" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}

function AnimatedRainyIcon() {
  const drops = [
    { x: 11, delay: "0s" },
    { x: 21, delay: "0.32s" },
    { x: 31, delay: "0.64s" },
    { x: 41, delay: "0.16s" },
    { x: 16, delay: "0.80s" },
    { x: 26, delay: "0.48s" },
    { x: 36, delay: "0.96s" },
  ];
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
      {/* Cloud */}
      <g style={{ animation: "weatherCloudBob 4.5s ease-in-out infinite" }}>
        <path
          d="M8 38 Q7 28 17 28 Q19 21 29 23 Q37 20 40 26 Q48 26 48 35 Q48 40 42 40 L14 40 Q8 40 8 38 Z"
          fill="rgba(100,116,139,0.88)"
        />
        <path d="M15 32 Q24 28 32 30"
          stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" fill="none" />
      </g>
      {/* Animated rain lines */}
      {drops.map((d, i) => (
        <line key={i}
          x1={d.x + 2} y1="44" x2={d.x} y2="58"
          stroke="rgba(96,165,250,0.8)" strokeWidth="2.5" strokeLinecap="round"
          style={{ animation: `weatherRainDrop 1.35s linear ${d.delay} infinite` }} />
      ))}
    </svg>
  );
}

function AnimatedSnowyIcon() {
  const flakes = [
    { x: 13, delay: "0s" },
    { x: 23, delay: "0.55s" },
    { x: 33, delay: "0.28s" },
    { x: 43, delay: "0.80s" },
    { x: 18, delay: "1.05s" },
    { x: 38, delay: "0.12s" },
  ];
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
      {/* Cloud */}
      <g style={{ animation: "weatherCloudBob 5s ease-in-out infinite" }}>
        <path
          d="M8 35 Q7 25 17 25 Q19 18 29 20 Q37 17 40 23 Q48 23 48 32 Q48 37 42 37 L14 37 Q8 37 8 35 Z"
          fill="rgba(186,230,253,0.88)"
        />
        <path d="M15 29 Q24 25 32 27"
          stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinecap="round" fill="none" />
      </g>
      {/* Snowflakes with cross shapes */}
      {flakes.map((f, i) => (
        <g key={i} style={{ animation: `weatherSnowDrift 2.4s ease-in-out ${f.delay} infinite` }}>
          <circle cx={f.x} cy="52" r="3" fill="rgba(224,242,254,0.95)" />
          <line x1={f.x - 4} y1="52" x2={f.x + 4} y2="52"
            stroke="rgba(186,230,253,0.8)" strokeWidth="1.5" strokeLinecap="round" />
          <line x1={f.x} y1="48" x2={f.x} y2="56"
            stroke="rgba(186,230,253,0.8)" strokeWidth="1.5" strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
}

// Icon map
const ICONS: Record<Condition, (props: { tod: TimeOfDayFlag }) => React.ReactElement> = {
  sunny:           AnimatedSunIcon,
  "partly-cloudy": AnimatedPartlyCloudyIcon,
  cloudy:          AnimatedCloudyIcon,
  rainy:           AnimatedRainyIcon,
  snowy:           AnimatedSnowyIcon,
};

// ─── Particle System ─────────────────────────────────────────────────────────

function WeatherParticles({ type, tod }: { type: "rain" | "snow" | "sparkle" | "petal" | "leaf" | "none", tod: TimeOfDayFlag }) {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    if (type === "none") { setParticles([]); return; }
    
    let count = 12;
    if (type === "rain") count = 14;
    if (type === "sparkle") count = 9;
    if (type === "petal") count = 10;
    if (type === "leaf") count = 8;
    
    const colors = {
        petal: ["#fbcfe8", "#f472b6", "#fce7f3"],
        leaf: ["#fbbf24", "#f59e0b", "#d97706", "#ea580c"],
    };

    setParticles(
      Array.from({ length: count }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        delay: `${(Math.random() * 3).toFixed(2)}s`,
        duration: `${(1.2 + Math.random() * 2).toFixed(2)}s`,
        size: type === "rain" ? 1.5 + Math.random() * 0.8 : 
              (type === "petal" || type === "leaf" ? 4 + Math.random() * 6 : 2.5 + Math.random() * 2),
        color: type === "petal" ? colors.petal[Math.floor(Math.random() * colors.petal.length)] :
               type === "leaf" ? colors.leaf[Math.floor(Math.random() * colors.leaf.length)] : undefined
      }))
    );
  }, [type]);

  if (type === "none" || particles.length === 0) return null;

  return (
    <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none z-0" aria-hidden="true">
      {particles.map((p) => {
        if (type === "rain") {
          return (
            <div key={p.id} className="absolute top-0"
              style={{
                left: `${p.x}%`,
                width: `${p.size}px`,
                height: "14px",
                background: "linear-gradient(to bottom, transparent, rgba(96,165,250,0.65))",
                borderRadius: "2px",
                animation: `weatherParticleRain ${p.duration} linear ${p.delay} infinite`,
              }} />
          );
        }
        if (type === "snow") {
          return (
            <div key={p.id} className="absolute top-0 rounded-full"
              style={{
                left: `${p.x}%`,
                width: `${p.size}px`,
                height: `${p.size}px`,
                background: "rgba(224,242,254,0.88)",
                animation: `weatherParticleSnow ${p.duration} ease-in-out ${p.delay} infinite`,
              }} />
          );
        }
        if (type === "petal" || type === "leaf") {
            return (
              <div key={p.id} className="absolute top-0 rounded-tl-full rounded-br-full"
                style={{
                  left: `${p.x}%`,
                  width: `${p.size}px`,
                  height: `${p.size * 1.5}px`,
                  background: p.color,
                  opacity: 0.8,
                  animation: `weatherSnowDrift ${p.duration} ease-in-out ${p.delay} infinite`,
                  transform: `rotate(${Math.random() * 360}deg)`
                }} />
            );
        }
        // sparkle (sun)
        return (
          <div key={p.id} className="absolute rounded-full"
            style={{
              left: `${p.x}%`,
              bottom: `${10 + (p.y || 0) * 0.4}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              background: tod === "night" ? "rgba(167,139,250,0.65)" : "rgba(251,191,36,0.65)",
              animation: `weatherParticleSun ${p.duration} ease-out ${p.delay} infinite`,
            }} />
        );
      })}
    </div>
  );
}

// ─── Stat Pill ───────────────────────────────────────────────────────────────

function StatPill({
  icon, label, value, delay, accentColor,
}: {
  icon: string; label: string; value: string; delay: string; accentColor: string;
}) {
  return (
    <div
      className="flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl"
      style={{
        background: "var(--color-surface-2)",
        animation: `weatherForecastIn 0.35s ease-out ${delay} both`,
      }}
    >
      <span className="text-lg leading-none">{icon}</span>
      <span className="text-xs font-bold" style={{ color: accentColor }}>{value}</span>
      <span className="text-text-muted text-[10px]">{label}</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WeatherWidget() {
  const { weather } = useWeatherConfig();
  const [expanded, setExpanded] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [tempKey, setTempKey] = useState(0);
  const prevUnitRef = useRef(weather.unit);

  // ─── Weather data from Open-Meteo API ──────────────────────────────────
  const [weatherData, setWeatherData] = useState<{currentTemp: number, currentCondition: string, feelsLike: number, forecast: ForecastDay[], humidity: number, wind: number} | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const lat = 42.7875;
    const lon = -86.1089;
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=6`)
      .then(r => r.json())
      .then(data => {
        const current = data.current;
        const daily = data.daily;
        const wmoToCondition = (code: number) => {
          if (code === 0) return { condition: "Clear", emoji: "☀️" };
          if (code <= 3) return { condition: "Partly Cloudy", emoji: "⛅" };
          if (code <= 48) return { condition: "Foggy", emoji: "🌫️" };
          if (code <= 57) return { condition: "Drizzle", emoji: "🌦️" };
          if (code <= 67) return { condition: "Rainy", emoji: "🌧️" };
          if (code <= 77) return { condition: "Snowy", emoji: "❄️" };
          if (code <= 82) return { condition: "Rain Showers", emoji: "🌧️" };
          return { condition: "Thunderstorm", emoji: "⛈️" };
        };
        const currentWMO = wmoToCondition(current.weather_code);
        const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
        const forecast: ForecastDay[] = daily.time.slice(1, 6).map((date: string, i: number) => {
          const wmo = wmoToCondition(daily.weather_code[i+1]);
          return {
            day: days[new Date(date).getDay()],
            high: Math.round(daily.temperature_2m_max[i+1]),
            low: Math.round(daily.temperature_2m_min[i+1]),
            condition: wmo.condition,
            emoji: wmo.emoji,
            precipitation: daily.precipitation_probability_max[i+1] || 0,
            humidity: current.relative_humidity_2m,
            wind: Math.round(current.wind_speed_10m),
          };
        });
        setWeatherData({
          currentTemp: Math.round(current.temperature_2m),
          currentCondition: currentWMO.condition,
          feelsLike: Math.round(current.apparent_temperature),
          forecast,
          humidity: current.relative_humidity_2m,
          wind: Math.round(current.wind_speed_10m),
        });
        // Save condition for global effects
        try { localStorage.setItem('consuela-weather-condition', JSON.stringify({
          condition: currentWMO.condition,
          code: current.weather_code,
          temp: Math.round(current.temperature_2m),
          updated: Date.now()
        })); } catch {}
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { setMounted(true); }, []);

  // Pop animation when unit changes
  useEffect(() => {
    if (prevUnitRef.current !== weather.unit) {
      setTempKey((k) => k + 1);
      prevUnitRef.current = weather.unit;
    }
  }, [weather.unit]);

  const condition = detectCondition(weatherData?.currentCondition ?? "Partly Cloudy");

  const tod = weather.timeOfDay === "auto" ? getRealTimeOfDay() : weather.timeOfDay as TimeOfDayFlag;
  const season = weather.season === "auto" ? getRealSeason() : weather.season;

  const meta = getConditionMeta(condition, tod, season);
  const Icon = ICONS[condition];

  const displayTemp   = weather.unit === "C" ? toC(weatherData?.currentTemp ?? 72)  : (weatherData?.currentTemp ?? 72);
  const displayFeels  = weather.unit === "C" ? toC(weatherData?.feelsLike ?? 74)    : (weatherData?.feelsLike ?? 74);

  return (
    <div style={{ animation: mounted ? "weatherCardEnter 0.65s cubic-bezier(0.34,1.56,0.64,1) both" : undefined }}>
      {/* Card shell */}
      <div
        className="rounded-2xl overflow-hidden relative"
        style={{
          background: "var(--color-surface-0)",
          border: "1px solid var(--color-surface-3)",
          boxShadow: `0 0 48px ${meta.glow}, 0 8px 32px rgba(0,0,0,0.08)`,
          transition: "box-shadow 0.5s ease",
        }}
      >
        {/* Ambient radial gradient */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at 75% 15%, ${meta.glow} 0%, transparent 65%),
                         radial-gradient(ellipse at 20% 85%, ${meta.gradientStop} 0%, transparent 60%)`,
            transition: "background 0.6s ease",
          }}
        />

        {/* Particle layer */}
        {mounted && <WeatherParticles type={meta.particleType} tod={tod} />}

        {/* Content — sits above particles */}
        <div className="relative z-10 p-4">

          {/* Header: location + unit badge */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5 text-text-secondary text-xs font-medium min-w-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                className="w-3.5 h-3.5 shrink-0" style={{ color: meta.statColor }}>
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span className="truncate">{weather.location}</span>
              <span className="text-text-muted text-[10px] uppercase font-bold ml-1 opacity-50">
                {season} • {tod}
              </span>
            </div>
            <span
              className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full shrink-0 ml-2 text-text-secondary"
              style={{ background: meta.unitBadgeBg, transition: "background 0.4s ease" }}
            >
              °{weather.unit}
            </span>
          </div>

          {/* Main display row */}
          <div className="flex items-center gap-3 mb-4">
            {/* Animated weather icon */}
            <div className="shrink-0 -ml-1">
              {mounted ? <Icon tod={tod} /> : (
                <div className="w-[72px] h-[72px] flex items-center justify-center text-5xl leading-none">
                  ⛅
                </div>
              )}
            </div>

            {/* Temperature + condition */}
            <div className="flex-1 min-w-0">
              {/* Temperature with pop animation on unit switch */}
              <div
                key={tempKey}
                className="flex items-start leading-none mb-1"
                style={{ animation: tempKey > 0 ? "weatherTempPop 0.45s cubic-bezier(0.34,1.56,0.64,1)" : undefined }}
              >
                <span className="text-[52px] font-black text-text-primary tabular-nums leading-none tracking-tight">
                  {displayTemp}
                </span>
                <span className="text-2xl text-text-muted font-light mt-2 ml-1">°</span>
              </div>

              <p className="text-text-primary text-sm font-semibold mb-0.5">{weatherData?.currentCondition ?? "Partly Cloudy"}</p>
              <p className="text-text-muted text-[11px]">
                Feels like {displayFeels}°{weather.unit}
              </p>
            </div>
          </div>

          {/* Expand/collapse toggle */}
          <button
            onClick={() => setExpanded((e) => !e)}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold py-1.5 rounded-lg transition-all duration-200 hover:bg-[var(--color-surface-2)] active:scale-95"
            style={{ color: meta.statColor }}
          >
            {expanded ? "Hide details" : "More details"}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
              className="w-3.5 h-3.5 transition-transform duration-300"
              style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* ── Expandable detail panel ── */}
          <div
            className="overflow-hidden transition-all duration-500"
            style={{ maxHeight: expanded ? "440px" : "0px", opacity: expanded ? 1 : 0 }}
          >
            <div className="pt-3 space-y-3 border-t border-[var(--color-surface-3)] mt-2">

              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-2">
                <StatPill icon="💧" label="Rain"     value={`${weatherData?.forecast?.[0]?.precipitation ?? 10}%`}   delay="0s"     accentColor={meta.statColor} />
                <StatPill icon="🌫️" label="Humidity" value={`${weatherData?.humidity ?? 55}%`}   delay="0.07s"  accentColor={meta.statColor} />
                <StatPill icon="💨" label="Wind"     value={`${weatherData?.wind ?? 8} mph`} delay="0.14s"  accentColor={meta.statColor} />
              </div>

              {/* 5-day forecast */}
              <div>
                <p className="text-text-muted text-[10px] font-semibold uppercase tracking-widest mb-2">
                  5-Day Forecast
                </p>
                <div className="flex justify-between gap-1.5">
                  {(weatherData?.forecast ?? []).map((day, i) => (
                    <div
                      key={day.day}
                      className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl cursor-default"
                      style={{
                        background: "var(--color-surface-2)",
                        animation: expanded
                          ? `weatherForecastIn 0.38s ease-out ${0.18 + i * 0.06}s both`
                          : undefined,
                        transition: "background 0.2s ease",
                      }}
                      title={`${day.condition} · High ${weather.unit === "C" ? toC(day.high) : day.high}° / Low ${weather.unit === "C" ? toC(day.low) : day.low}°`}
                    >
                      <span className="text-text-muted text-[10px] font-semibold">{day.day}</span>
                      <span className="text-xl leading-none">{day.emoji}</span>
                      <span className="text-text-primary text-[11px] font-bold">
                        {weather.unit === "C" ? toC(day.high) : day.high}°
                      </span>
                      <span className="text-text-muted text-[10px]">
                        {weather.unit === "C" ? toC(day.low) : day.low}°
                      </span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>

        </div>
      </div>
    </div>
  );
}