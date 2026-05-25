"use client";

import { useState, useEffect, useRef } from "react";

interface Particle {
  id: number;
  x: number;
  size: number;
  delay: string;
  duration: string;
  color?: string;
  emoji?: string;
  rotation?: number;
}

// ─── Holiday detection ──────────────────────────────────────
function getHoliday(): string | null {
  const now = new Date();
  const month = now.getMonth(); // 0-11
  const date = now.getDate();
  const day = now.getDay(); // 0=Sun

  // Memorial Day (last Monday of May)
  if (month === 4 && day === 1 && date >= 25) return "memorial";
  // 4th of July
  if (month === 6 && date === 4) return "july4";
  // Halloween (Oct 31, or weekend before)
  if (month === 9 && (date === 31 || (date >= 28 && date <= 31 && day === 5))) return "halloween";
  // Thanksgiving (4th Thursday of November)
  if (month === 10 && day === 4 && date >= 22 && date <= 28) return "thanksgiving";
  // Christmas season (Dec 20-25)
  if (month === 11 && date >= 20 && date <= 25) return "christmas";
  // New Year's Eve
  if (month === 11 && date === 31) return "newyears";
  // Valentine's (Feb 14)
  if (month === 1 && date === 14) return "valentines";
  // St Patrick's (Mar 17)
  if (month === 2 && date === 17) return "stpatricks";
  // Easter (approximate: first Sunday after first full moon after March 21)
  // Simplified: first Sunday in April or last Sunday in March
  if ((month === 2 && date >= 22 && day === 0) || (month === 3 && date <= 25 && day === 0)) return "easter";

  return null;
}

function getHolidayTheme(holiday: string) {
  const themes: Record<string, { emojis: string[]; colors: string[] }> = {
    memorial: { emojis: ["🇺🇸", "🎖️", "⭐"], colors: ["#ef4444", "#3b82f6", "#ffffff"] },
    july4: { emojis: ["🇺🇸", "🎆", "✨", "🎇"], colors: ["#ef4444", "#3b82f6", "#ffffff"] },
    halloween: { emojis: ["🎃", "👻", "🦇", "🕸️"], colors: ["#f97316", "#a855f7", "#22c55e"] },
    thanksgiving: { emojis: ["🦃", "🍂", "🥧", "🍁"], colors: ["#d97706", "#b45309", "#92400e"] },
    christmas: { emojis: ["🎄", "🎅", "❄️", "🦌", "🎁"], colors: ["#ef4444", "#22c55e", "#fbbf24", "#ffffff"] },
    newyears: { emojis: ["🎉", "🎊", "🥂", "✨"], colors: ["#fbbf24", "#c084fc", "#ffffff"] },
    valentines: { emojis: ["❤️", "💕", "🌹", "💝"], colors: ["#ec4899", "#f43f5e", "#fda4af"] },
    stpatricks: { emojis: ["🍀", "🌈", "🪙", "☘️"], colors: ["#22c55e", "#fbbf24", "#ffffff"] },
    easter: { emojis: ["🐰", "🥚", "🌸", "🐣"], colors: ["#fda4af", "#c084fc", "#fbbf24"] },
  };
  return themes[holiday] || null;
}

// ─── Weather condition → particles ─────────────────────────
function getWeatherParticles(condition: string, count: number): Particle[] {
  const particles: Particle[] = [];
  const c = condition.toLowerCase();

  for (let i = 0; i < count; i++) {
    const base = {
      id: i,
      x: Math.random() * 100,
      size: 2 + Math.random() * 4,
      delay: `${Math.random() * 5}s`,
      duration: `${3 + Math.random() * 4}s`,
    };

    if (c.includes("snow")) {
      particles.push({ ...base, size: 3 + Math.random() * 6, color: "rgba(255,255,255,0.7)" });
    } else if (c.includes("rain") || c.includes("drizzle") || c.includes("shower")) {
      particles.push({ ...base, size: 1.5, duration: `${0.8 + Math.random() * 1.5}s` });
    } else if (c.includes("sun") || c.includes("clear")) {
      particles.push({ ...base, size: 2 + Math.random() * 3, duration: `${4 + Math.random() * 4}s`, color: "rgba(251,191,36,0.5)" });
    } else if (c.includes("fog") || c.includes("cloud")) {
      particles.push({ ...base, size: 20 + Math.random() * 40, duration: `${8 + Math.random() * 10}s`, color: "rgba(200,210,220,0.12)" });
    } else if (c.includes("thunder")) {
      particles.push({ ...base, size: 2, duration: `${0.3 + Math.random() * 0.5}s`, color: "rgba(250,250,100,0.8)" });
    }
  }
  return particles;
}

// ─── Component ──────────────────────────────────────────────
export default function DashboardEffects() {
  const [weatherParticles, setWeatherParticles] = useState<Particle[]>([]);
  const [holidayParticles, setHolidayParticles] = useState<Particle[]>([]);
  const [holiday, setHoliday] = useState<string | null>(null);
  const [holidayTheme, setHolidayTheme] = useState<{ emojis: string[]; colors: string[] } | null>(null);
  const [condition, setCondition] = useState<string>("Partly Cloudy");
  const frameRef = useRef<number>(0);

  // Read weather condition from localStorage
  useEffect(() => {
    const checkWeather = () => {
      try {
        const stored = localStorage.getItem('consuela-weather-condition');
        if (stored) {
          const data = JSON.parse(stored);
          // Only use if data is less than 2 hours old
          if (Date.now() - data.updated < 2 * 60 * 60 * 1000) {
            setCondition(data.condition);
          }
        }
      } catch {}
    };
    checkWeather();
    const interval = setInterval(checkWeather, 5 * 60 * 1000); // check every 5 min
    return () => clearInterval(interval);
  }, []);

  // Check holidays
  useEffect(() => {
    const h = getHoliday();
    setHoliday(h);
    if (h) setHolidayTheme(getHolidayTheme(h));
  }, []);

  // Generate weather particles
  useEffect(() => {
    const count = condition.includes("rain") ? 30 : condition.includes("snow") ? 25 : condition.includes("fog") ? 8 : condition.includes("thunder") ? 15 : 12;
    setWeatherParticles(getWeatherParticles(condition, count));
  }, [condition]);

  // Generate holiday particles
  useEffect(() => {
    if (!holidayTheme) { setHolidayParticles([]); return; }
    const particles: Particle[] = [];
    for (let i = 0; i < 15; i++) {
      particles.push({
        id: i,
        x: Math.random() * 100,
        size: 16 + Math.random() * 12,
        delay: `${Math.random() * 8}s`,
        duration: `${6 + Math.random() * 8}s`,
        emoji: holidayTheme.emojis[Math.floor(Math.random() * holidayTheme.emojis.length)],
        rotation: Math.random() * 360,
      });
    }
    setHolidayParticles(particles);
  }, [holidayTheme]);

  if (weatherParticles.length === 0 && holidayParticles.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
      {/* Weather particles */}
      {weatherParticles.map((p) => {
        if (condition.includes("rain") || condition.includes("drizzle") || condition.includes("shower")) {
          return (
            <div key={`w-${p.id}`} className="absolute top-0"
              style={{
                left: `${p.x}%`,
                width: `${p.size}px`,
                height: `${8 + Math.random() * 6}px`,
                background: "linear-gradient(to bottom, transparent, rgba(96,165,250,0.5))",
                borderRadius: "2px",
                animation: `dashRain ${p.duration} linear ${p.delay} infinite`,
              }} />
          );
        }
        if (condition.includes("snow")) {
          return (
            <div key={`w-${p.id}`} className="absolute top-0 rounded-full"
              style={{
                left: `${p.x}%`,
                width: `${p.size}px`,
                height: `${p.size}px`,
                background: p.color || "rgba(255,255,255,0.7)",
                boxShadow: "0 0 4px rgba(255,255,255,0.3)",
                animation: `dashSnow ${p.duration} ease-in-out ${p.delay} infinite`,
              }} />
          );
        }
        if (condition.includes("fog") || condition.includes("cloud")) {
          return (
            <div key={`w-${p.id}`} className="absolute"
              style={{
                left: `${p.x}%`,
                top: `${20 + Math.random() * 50}%`,
                width: `${p.size}px`,
                height: `${p.size * 0.4}px`,
                background: p.color || "rgba(200,210,220,0.08)",
                borderRadius: "50%",
                filter: "blur(15px)",
                animation: `dashFog ${p.duration} linear ${p.delay} infinite`,
              }} />
          );
        }
        if (condition.includes("thunder")) {
          return (
            <div key={`w-${p.id}`} className="absolute inset-0"
              style={{
                background: "rgba(255,255,200,0.06)",
                animation: `dashFlash ${p.duration} ease-out ${p.delay} infinite`,
              }} />
          );
        }
        // Default: sparkle/sun
        return (
          <div key={`w-${p.id}`} className="absolute rounded-full"
            style={{
              left: `${p.x}%`,
              bottom: `${10 + Math.random() * 40}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              background: p.color || "rgba(251,191,36,0.35)",
              animation: `dashSparkle ${p.duration} ease-out ${p.delay} infinite`,
            }} />
        );
      })}

      {/* Holiday particles */}
      {holidayParticles.map((p) => (
        <div key={`h-${p.id}`} className="absolute top-0"
          style={{
            left: `${p.x}%`,
            fontSize: `${p.size}px`,
            opacity: 0.7,
            animation: `dashHoliday ${p.duration} ease-in-out ${p.delay} infinite`,
            transform: `rotate(${p.rotation}deg)`,
          }}
        >
          {p.emoji}
        </div>
      ))}

      <style>{`
        @keyframes dashRain {
          0% { transform: translateY(-10vh); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(105vh); opacity: 0; }
        }
        @keyframes dashSnow {
          0% { transform: translateY(-5vh) translateX(0); opacity: 0; }
          10% { opacity: 0.8; }
          50% { transform: translateY(50vh) translateX(20px); }
          90% { opacity: 0.8; }
          100% { transform: translateY(105vh) translateX(-15px); opacity: 0; }
        }
        @keyframes dashFog {
          0% { transform: translateX(-20vw); opacity: 0; }
          20% { opacity: 0.4; }
          80% { opacity: 0.4; }
          100% { transform: translateX(120vw); opacity: 0; }
        }
        @keyframes dashFlash {
          0%, 90%, 100% { opacity: 0; }
          92% { opacity: 1; }
          94% { opacity: 0; }
          96% { opacity: 0.5; }
        }
        @keyframes dashSparkle {
          0% { transform: scale(1); opacity: 0; }
          50% { transform: scale(1.5); opacity: 0.6; }
          100% { transform: scale(0); opacity: 0; }
        }
        @keyframes dashHoliday {
          0% { transform: translateY(-5vh) rotate(0deg); opacity: 0; }
          20% { opacity: 0.7; }
          80% { opacity: 0.7; }
          100% { transform: translateY(105vh) rotate(360deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
