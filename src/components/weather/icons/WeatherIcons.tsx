/**
 * Weather Icons — Animated SVG weather condition icons.
 * Extracted from WeatherWidget.tsx for modularity.
 */
"use client";

import type { Condition, TimeOfDayFlag } from "../helpers";

export function AnimatedSunIcon({ tod }: { tod: TimeOfDayFlag }) {
  const SIZE = 72;
  const CX = SIZE / 2;
  const CY = SIZE / 2;

  if (tod === "night") {
    return (
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} fill="none" aria-hidden="true">
        <circle cx={CX} cy={CY} r="32" fill="rgba(167,139,250,0.07)" style={{ animation: "weatherGlowPulse 4s ease-in-out infinite" }} />
        <path d="M40 20 A14 14 0 1 0 52 32 A18 18 0 0 1 40 20 Z" fill="#c4b5fd" />
        <path d="M38 22 A12 12 0 1 0 48 32 A16 16 0 0 1 38 22 Z" fill="#8b5cf6" />
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
      <circle cx={CX} cy={CY} r="32" fill="rgba(251,191,36,0.07)" style={{ animation: "weatherGlowPulse 3.5s ease-in-out infinite" }} />
      <g style={{ animation: "weatherSpin 14s linear infinite", transformOrigin: `${CX}px ${CY}px` }}>
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return (<circle key={i} cx={CX + Math.cos(a) * 30} cy={CY + Math.sin(a) * 30} r="2.5" fill="rgba(251,191,36,0.5)" />);
        })}
      </g>
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return (
          <line key={i} x1={CX + Math.cos(a) * 15} y1={CY + Math.sin(a) * 15} x2={CX + Math.cos(a) * 23} y2={CY + Math.sin(a) * 23}
            stroke="#fbbf24" strokeWidth="3" strokeLinecap="round"
            style={{ animation: `weatherRayPulse 2.2s ease-in-out ${i * 0.28}s infinite`, transformOrigin: `${CX}px ${CY}px` }} />
        );
      })}
      <circle cx={CX} cy={CY} r="14" fill="rgba(251,191,36,0.18)" style={{ animation: "weatherGlowPulse 2.2s ease-in-out 0.6s infinite" }} />
      <circle cx={CX} cy={CY} r="12" fill="#fbbf24" />
      <circle cx={CX} cy={CY} r="10" fill="#f59e0b" />
      <circle cx={CX - 3.5} cy={CY - 3.5} r="3.5" fill="rgba(254,243,199,0.45)" />
    </svg>
  );
}

export function AnimatedPartlyCloudyIcon({ tod }: { tod: TimeOfDayFlag }) {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
      {tod === "night" ? (
        <g style={{ animation: "weatherGlowPulse 5s ease-in-out infinite" }}>
          <path d="M35 15 A10 10 0 1 0 45 25 A12 12 0 0 1 35 15 Z" fill="#a78bfa" />
        </g>
      ) : (
        <g style={{ animation: "weatherGlowPulse 4s ease-in-out infinite" }}>
          {Array.from({ length: 6 }, (_, i) => {
            const a = (i / 6) * Math.PI * 2;
            return (<line key={i} x1={24 + Math.cos(a) * 11} y1={24 + Math.sin(a) * 11} x2={24 + Math.cos(a) * 16} y2={24 + Math.sin(a) * 16} stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />);
          })}
          <circle cx="24" cy="24" r="9" fill="#fbbf24" />
          <circle cx="24" cy="24" r="7" fill="#f59e0b" />
          <circle cx="21" cy="21" r="2.5" fill="rgba(254,243,199,0.4)" />
        </g>
      )}
      <g style={{ animation: "weatherCloudBob 5s ease-in-out infinite" }}>
        <path d="M12 54 Q11 44 21 44 Q23 37 33 39 Q41 36 43 42 Q51 42 51 51 Q51 56 46 56 L18 56 Q12 56 12 54 Z" fill="rgba(203,213,225,0.9)" stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
        <path d="M19 48 Q27 44 35 46" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}

export function AnimatedCloudyIcon() {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
      <g style={{ animation: "weatherCloudBob 7s ease-in-out 1.8s infinite" }}>
        <path d="M28 46 Q27 38 36 38 Q38 31 47 33 Q54 31 56 37 Q63 37 63 45 Q63 49 58 49 L34 49 Q28 49 28 46 Z" fill="rgba(148,163,184,0.7)" />
      </g>
      <g style={{ animation: "weatherCloudBob 5.5s ease-in-out infinite" }}>
        <path d="M6 52 Q5 42 15 42 Q17 35 27 37 Q35 34 38 40 Q46 40 46 49 Q46 54 41 54 L12 54 Q6 54 6 52 Z" fill="rgba(203,213,225,0.9)" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5" />
        <path d="M13 46 Q21 42 29 44" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}

export function AnimatedRainyIcon() {
  const drops = [{ x: 11, delay: "0s" }, { x: 21, delay: "0.32s" }, { x: 31, delay: "0.64s" }, { x: 41, delay: "0.16s" }, { x: 16, delay: "0.80s" }, { x: 26, delay: "0.48s" }, { x: 36, delay: "0.96s" }];
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
      <g style={{ animation: "weatherCloudBob 4.5s ease-in-out infinite" }}>
        <path d="M8 38 Q7 28 17 28 Q19 21 29 23 Q37 20 40 26 Q48 26 48 35 Q48 40 42 40 L14 40 Q8 40 8 38 Z" fill="rgba(100,116,139,0.88)" />
        <path d="M15 32 Q24 28 32 30" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" fill="none" />
      </g>
      {drops.map((d, i) => (<line key={i} x1={d.x + 2} y1="44" x2={d.x} y2="58" stroke="rgba(96,165,250,0.8)" strokeWidth="2.5" strokeLinecap="round" style={{ animation: `weatherRainDrop 1.35s linear ${d.delay} infinite` }} />))}
    </svg>
  );
}

export function AnimatedSnowyIcon() {
  const flakes = [{ x: 13, delay: "0s" }, { x: 23, delay: "0.55s" }, { x: 33, delay: "0.28s" }, { x: 43, delay: "0.80s" }, { x: 18, delay: "1.05s" }, { x: 38, delay: "0.12s" }];
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
      <g style={{ animation: "weatherCloudBob 5s ease-in-out infinite" }}>
        <path d="M8 35 Q7 25 17 25 Q19 18 29 20 Q37 17 40 23 Q48 23 48 32 Q48 37 42 37 L14 37 Q8 37 8 35 Z" fill="rgba(186,230,253,0.88)" />
        <path d="M15 29 Q24 25 32 27" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinecap="round" fill="none" />
      </g>
      {flakes.map((f, i) => (<g key={i} style={{ animation: `weatherSnowDrift 2.4s ease-in-out ${f.delay} infinite` }}><circle cx={f.x} cy="52" r="3" fill="rgba(224,242,254,0.95)" /><line x1={f.x - 4} y1="52" x2={f.x + 4} y2="52" stroke="rgba(186,230,253,0.8)" strokeWidth="1.5" strokeLinecap="round" /><line x1={f.x} y1="48" x2={f.x} y2="56" stroke="rgba(186,230,253,0.8)" strokeWidth="1.5" strokeLinecap="round" /></g>))}
    </svg>
  );
}

export const ICONS: Record<Condition, (props: { tod: TimeOfDayFlag }) => React.ReactElement> = {
  sunny: AnimatedSunIcon,
  "partly-cloudy": AnimatedPartlyCloudyIcon,
  cloudy: AnimatedCloudyIcon,
  rainy: AnimatedRainyIcon,
  snowy: AnimatedSnowyIcon,
};
