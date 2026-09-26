// weather-astro — moon math + deterministic cloud specs.
// Extracted from src/components/ui/WeatherScene.tsx (deleted 2026-09-25).
// moonLitPath ports the lit-limb arc math from the glassmorphism-weather-widget
// reference project, keeping the degenerate-arc epsilon the original had.

/** Synodic month length in days. */
const SYNODIC_MONTH = 29.53058867;
/** Reference new moon: 2000-01-06 18:14 UTC. */
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

/**
 * SVG path (centered at 0,0 with radius r) of the lit part of the moon.
 * Northern-hemisphere orientation: waxing lights the right limb.
 * The epsilon keeps quarter phases from emitting zero-radius arcs.
 */
export function moonLitPath(phase: number, r: number): string {
  const p = ((phase % 1) + 1) % 1;
  const rx = Math.abs(Math.cos(p * Math.PI * 2)) * r;
  const waxing = p <= 0.5;
  if (waxing) {
    const gibbous = p > 0.25;
    return `M 0 ${-r} A ${r} ${r} 0 0 1 0 ${r} A ${Math.max(rx, 0.01)} ${r} 0 0 ${gibbous ? 1 : 0} 0 ${-r} Z`;
  }
  const gibbous = p < 0.75;
  return `M 0 ${-r} A ${r} ${r} 0 0 0 0 ${r} A ${Math.max(rx, 0.01)} ${r} 0 0 ${gibbous ? 0 : 1} 0 ${-r} Z`;
}

/** Small deterministic PRNG so identical inputs always render identical scenes. */
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
