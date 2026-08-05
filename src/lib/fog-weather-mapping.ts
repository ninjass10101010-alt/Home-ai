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

interface FogPalette {
  base: number;
  lowlight: number;
  midtone: number;
  highlight: number;
  blur: number;
  spd: number;
  z: number;
}

const DAY: Record<Condition, FogPalette> = {
  sunny:           { base: 0xbfd8e8, lowlight: 0x4a7a9e, midtone: 0xe0d8c8, highlight: 0xd4a86a, blur: 0.35, spd: 0.6,  z: 1.0 },
  "partly-cloudy": { base: 0xcdd5de, lowlight: 0x5a7a9e, midtone: 0xd8d0c4, highlight: 0xc8a460, blur: 0.38, spd: 0.5,  z: 1.0 },
  cloudy:          { base: 0xc0b8b0, lowlight: 0x6a7a7e, midtone: 0xafa89e, highlight: 0xb8a078, blur: 0.42, spd: 0.4,  z: 1.1 },
  rainy:           { base: 0x8a9aaa, lowlight: 0x4a6078, midtone: 0x708898, highlight: 0x98a8b8, blur: 0.38, spd: 0.8,  z: 1.2 },
  snowy:           { base: 0xd0dde8, lowlight: 0x7090b0, midtone: 0xc0ccd8, highlight: 0xe8eef4, blur: 0.50, spd: 0.25, z: 0.9 },
  foggy:           { base: 0xc8c4c0, lowlight: 0x8a8478, midtone: 0xb0a8a0, highlight: 0xd8d2cc, blur: 0.55, spd: 0.15, z: 0.8 },
  thunderstorm:    { base: 0x5a6878, lowlight: 0x3a4058, midtone: 0x4a5a6a, highlight: 0x7888a0, blur: 0.32, spd: 1.0,  z: 1.3 },
};

const NIGHT: Record<Condition, FogPalette> = {
  sunny:           { base: 0x080e1e, lowlight: 0x1a2060, midtone: 0x101840, highlight: 0x3a4570, blur: 0.38, spd: 0.4,  z: 0.9 },
  "partly-cloudy": { base: 0x0a1420, lowlight: 0x1e2e50, midtone: 0x121c38, highlight: 0x385878, blur: 0.40, spd: 0.5,  z: 1.0 },
  cloudy:          { base: 0x0c1018, lowlight: 0x1a2038, midtone: 0x141a24, highlight: 0x344258, blur: 0.42, spd: 0.35, z: 1.1 },
  rainy:           { base: 0x060a14, lowlight: 0x142040, midtone: 0x0a1220, highlight: 0x284060, blur: 0.38, spd: 0.7,  z: 1.2 },
  snowy:           { base: 0x0a1020, lowlight: 0x1e3860, midtone: 0x141e40, highlight: 0x3a5878, blur: 0.50, spd: 0.2,  z: 0.8 },
  foggy:           { base: 0x0c0e14, lowlight: 0x1a1c28, midtone: 0x10121a, highlight: 0x2e303e, blur: 0.55, spd: 0.12, z: 0.8 },
  thunderstorm:    { base: 0x040610, lowlight: 0x0e1228, midtone: 0x080c16, highlight: 0x1e2a48, blur: 0.30, spd: 0.9,  z: 1.3 },
};

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

export function getFogParams(
  condition: Condition,
  isNight: boolean,
  holiday: string = "none",
): FogParams {
  const palette = isNight ? NIGHT[condition] : DAY[condition];
  const tint = holiday !== "none" && HOLIDAY_TINTS[holiday] ? HOLIDAY_TINTS[holiday] : null;

  const blend = 0.25;
  return {
    baseColor:       tint ? lerpColor(palette.base, tint, blend) : palette.base,
    lowlightColor:   tint ? lerpColor(palette.lowlight, tint, blend * 0.5) : palette.lowlight,
    midtoneColor:    tint ? lerpColor(palette.midtone, tint, blend) : palette.midtone,
    highlightColor:  tint ? lerpColor(palette.highlight, tint, blend) : palette.highlight,
    blurFactor:      palette.blur,
    speed:           palette.spd,
    zoom:            palette.z,
  };
}