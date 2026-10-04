type Condition = "sunny" | "partly-cloudy" | "cloudy" | "rainy" | "snowy" | "foggy" | "thunderstorm";

export interface FogParams {
  baseColor: number;
  lowlightColor: number;
  midtoneColor: number;
  highlightColor: number;
  blurFactor: number;
  speed: number;
  zoom: number;
}

/**
 * Which canvas the fog is painting. This is the resolved THEME, never the
 * clock: the fog is opaque and full-viewport, so it IS the page's background,
 * and a background has to belong to the theme it sits in. It used to be keyed
 * by the clock, which painted a light theme's near-white canvas with the
 * near-black night table after dusk and a dark theme's canvas with the pale day
 * table at noon.
 */
export type FogLeg = "light" | "dark";

interface FogPalette {
  base: number;
  lowlight: number;
  midtone: number;
  highlight: number;
  blur: number;
  spd: number;
  z: number;
}

/** Pale skies for the light theme. Tuned against --gradient-canvas-day. */
const LIGHT: Record<Condition, FogPalette> = {
  sunny:           { base: 0xbfd8e8, lowlight: 0x4a7a9e, midtone: 0xe0d8c8, highlight: 0xd4a86a, blur: 0.35, spd: 0.6,  z: 1.0 },
  "partly-cloudy": { base: 0xcdd5de, lowlight: 0x5a7a9e, midtone: 0xd8d0c4, highlight: 0xc8a460, blur: 0.38, spd: 0.5,  z: 1.0 },
  cloudy:          { base: 0xc0b8b0, lowlight: 0x6a7a7e, midtone: 0xafa89e, highlight: 0xb8a078, blur: 0.42, spd: 0.4,  z: 1.1 },
  rainy:           { base: 0x8a9aaa, lowlight: 0x4a6078, midtone: 0x708898, highlight: 0x98a8b8, blur: 0.38, spd: 0.8,  z: 1.2 },
  snowy:           { base: 0xd0dde8, lowlight: 0x7090b0, midtone: 0xc0ccd8, highlight: 0xe8eef4, blur: 0.50, spd: 0.25, z: 0.9 },
  foggy:           { base: 0xc8c4c0, lowlight: 0x8a8478, midtone: 0xb0a8a0, highlight: 0xd8d2cc, blur: 0.55, spd: 0.15, z: 0.8 },
  thunderstorm:    { base: 0x5a6878, lowlight: 0x3a4058, midtone: 0x4a5a6a, highlight: 0x7888a0, blur: 0.32, spd: 1.0,  z: 1.3 },
};

/** Deep skies for the dark theme. Tuned against --gradient-canvas-night. */
const DARK: Record<Condition, FogPalette> = {
  sunny:           { base: 0x080e1e, lowlight: 0x1a2060, midtone: 0x101840, highlight: 0x3a4570, blur: 0.38, spd: 0.4,  z: 0.9 },
  "partly-cloudy": { base: 0x0a1420, lowlight: 0x1e2e50, midtone: 0x121c38, highlight: 0x385878, blur: 0.40, spd: 0.5,  z: 1.0 },
  cloudy:          { base: 0x0c1018, lowlight: 0x1a2038, midtone: 0x141a24, highlight: 0x344258, blur: 0.42, spd: 0.35, z: 1.1 },
  rainy:           { base: 0x060a14, lowlight: 0x142040, midtone: 0x0a1220, highlight: 0x284060, blur: 0.38, spd: 0.7,  z: 1.2 },
  snowy:           { base: 0x0a1020, lowlight: 0x1e3860, midtone: 0x141e40, highlight: 0x3a5878, blur: 0.50, spd: 0.2,  z: 0.8 },
  foggy:           { base: 0x0c0e14, lowlight: 0x1a1c28, midtone: 0x10121a, highlight: 0x2e303e, blur: 0.55, spd: 0.12, z: 0.8 },
  thunderstorm:    { base: 0x040610, lowlight: 0x0e1228, midtone: 0x080c16, highlight: 0x1e2a48, blur: 0.30, spd: 0.9,  z: 1.3 },
};

const LEGS: Record<FogLeg, Record<Condition, FogPalette>> = { light: LIGHT, dark: DARK };

/** The leg tables, read-only. Exported so the contract test can measure the
 *  clock's shift against the leg's own endpoints instead of a hardcoded hex. */
export const FOG_PALETTES = LEGS as Readonly<Record<FogLeg, Record<Condition, Readonly<FogPalette>>>>;

const HOLIDAY_TINTS: Record<string, number> = {
  christmas:           0xe8c8c0,
  halloween:           0xd4a070,
  valentines:          0xe8c0d0,
  newyears:            0xe8d8a0,
  july4th:             0xa0c0e8,
  thanksgiving:        0xd4a870,
  stpatricks:          0xa0d4a0,
  diadelosmuertos:     0xd4a870,
  cincodemayo:         0xa8d4a0,
  mexicanindependence: 0xa0c8a0,
  virginguadalupe:     0xe0d0c0,
};

// The clock's whole job in this layer: how much of the leg's OWN cloud tone the
// fog carries. By day the sky tone leads (a bright, thin sky with a little
// cloud in it); after dark the cloud tone leads (the sky is a backdrop and the
// weather is what you can see). Note this is a change in CONTRAST between the
// leg's two tones, not a direction of brightness — in the light leg the cloud
// tone is darker than the sky, in the dark leg it is bluer and brighter. Both
// endpoints are colours the leg already owns, so no clock state can walk the fog
// onto the other theme's canvas, which is the defect this table used to encode.
const CLOUD_MIX = { night: 0.34, day: 0.12 } as const;

function hexToRgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

function rgbToHex(r: number, g: number, b: number): number {
  return ((Math.round(r) & 0xff) << 16) | ((Math.round(g) & 0xff) << 8) | (Math.round(b) & 0xff);
}

function lerpColor(a: number, b: number, t: number): number {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/**
 * Resolve one fog colour. Settings → fog is an OVERRIDE, not the palette: while
 * the setting still holds its shipped default the atmosphere's own leg owns the
 * colour, exactly like the Accent Studio defers a preset accent to the
 * stylesheet. Without that, the hand-tuned amber default won in both themes and
 * every weather, which is how the fog ended up amber over a light canvas and
 * over a dark one. A family that picks a colour keeps it.
 *
 * A malformed or empty setting is NOT a colour. The old
 * `hexToNum(x) ?? fallback` never caught it — `??` only covers null/undefined,
 * and `parseInt` happily truncates — so NaN and `#000012` both reached the
 * shader (a black canvas, not a fog). Strict 6-digit hex, as in useTheme.
 */
export function resolveFogColor(configured: string, preset: string, legDefault: number): number {
  if (configured.trim().toLowerCase() === preset.trim().toLowerCase()) return legDefault;
  const digits = configured.trim().replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(digits)) return legDefault;
  return parseInt(digits, 16);
}

/**
 * @param leg     the resolved theme's canvas — `light` or `dark`.
 * @param isNight the clock, which only moves the fog WITHIN that leg.
 */
export function getFogParams(
  condition: Condition,
  leg: FogLeg,
  holiday: string = "none",
  isNight: boolean = true,
): FogParams {
  const palette = (LEGS[leg] ?? LEGS.dark)[condition];
  const tint = holiday !== "none" && HOLIDAY_TINTS[holiday] ? HOLIDAY_TINTS[holiday] : null;
  const cloud = isNight ? CLOUD_MIX.night : CLOUD_MIX.day;

  const blend = 0.25;
  return {
    baseColor:       lerpColor(tint ? lerpColor(palette.base, tint, blend) : palette.base, palette.lowlight, cloud),
    lowlightColor:   tint ? lerpColor(palette.lowlight, tint, blend * 0.5) : palette.lowlight,
    midtoneColor:    tint ? lerpColor(palette.midtone, tint, blend) : palette.midtone,
    highlightColor:  tint ? lerpColor(palette.highlight, tint, blend) : palette.highlight,
    blurFactor:      palette.blur,
    speed:           palette.spd,
    zoom:            palette.z,
  };
}
