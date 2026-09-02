export type SeasonKey = "spring" | "summer" | "autumn" | "winter";

export interface WeatherSkin {
  name: string;
  night: boolean;
  skyTop: string;
  skyBottom: string;
  ink: string;
  inkSoft: string;
  accent: string;
  cloud: string;
  cloudDeep: string;
  celestial: string;
  glow: string;
  border: string;
  particle: string;
  stripTrack: string;
  severe?: boolean;
  severeFamily?: SevereKind | null;
  skyGradient: (season: SeasonKey | null) => string;
}

const DAY_SKINS: Record<SeasonKey, Omit<WeatherSkin, "skyGradient">> = {
  spring: {
    name: "spring",
    night: false,
    skyTop: "#FDF0C4",
    skyBottom: "#E9DFF9",
    ink: "#1C1512",
    inkSoft: "rgba(28,21,18,0.64)",
    accent: "#D95F92",
    cloud: "#FFFFFF",
    cloudDeep: "#EFE3F4",
    celestial: "#FFC94D",
    glow: "rgba(233,170,205,0.40)",
    border: "rgba(28,21,18,0.10)",
    particle: "rgba(120,150,215,0.75)",
    stripTrack: "rgba(28,21,18,0.10)",
  },
  summer: {
    name: "summer",
    night: false,
    skyTop: "#FFD8CB",
    skyBottom: "#FFEBCF",
    ink: "#211310",
    inkSoft: "rgba(33,19,16,0.64)",
    accent: "#E85D45",
    cloud: "#FFF9F2",
    cloudDeep: "#F8DCC8",
    celestial: "#FFB03A",
    glow: "rgba(255,170,140,0.42)",
    border: "rgba(33,19,16,0.10)",
    particle: "rgba(110,145,210,0.75)",
    stripTrack: "rgba(33,19,16,0.10)",
  },
  autumn: {
    name: "autumn",
    night: false,
    skyTop: "#FFDCC8",
    skyBottom: "#F5BCA0",
    ink: "#23120C",
    inkSoft: "rgba(35,18,12,0.64)",
    accent: "#C74E33",
    cloud: "#FFF4EA",
    cloudDeep: "#EFC5AC",
    celestial: "#FF9E58",
    glow: "rgba(240,150,110,0.42)",
    border: "rgba(35,18,12,0.10)",
    particle: "rgba(115,140,200,0.75)",
    stripTrack: "rgba(35,18,12,0.10)",
  },
  winter: {
    name: "winter",
    night: false,
    skyTop: "#D9EAFB",
    skyBottom: "#F4F8FD",
    ink: "#131A22",
    inkSoft: "rgba(19,26,34,0.62)",
    accent: "#3F79B5",
    cloud: "#FFFFFF",
    cloudDeep: "#DCE8F2",
    celestial: "#FFE9A8",
    glow: "rgba(160,200,240,0.45)",
    border: "rgba(19,26,34,0.10)",
    particle: "rgba(150,180,225,0.85)",
    stripTrack: "rgba(19,26,34,0.10)",
  },
};

// Consuela's night — a lamplit indigo that keeps the hero present in a dark
// kitchen instead of the near-black card that read as a hole in the bento.
const NIGHT_SKIN: Omit<WeatherSkin, "skyGradient"> = {
  name: "night",
  night: true,
  skyTop: "#1B1E33",
  skyBottom: "#2A2440",
  ink: "#FFFFFF",
  inkSoft: "rgba(255,255,255,0.66)",
  accent: "#FF6F5E",
  cloud: "#2E3350",
  cloudDeep: "#232741",
  celestial: "#F4F1E8",
  glow: "rgba(140,130,200,0.30)",
  border: "rgba(255,255,255,0.16)",
  particle: "rgba(170,200,245,0.72)",
  stripTrack: "rgba(255,255,255,0.16)",
};

// One source of truth for every sky wash — WeatherScene renders its crossfade
// layers from here instead of hardcoding the gradients a second time.
function skyGradient(season: SeasonKey | null): string {
  const s = season === null ? NIGHT_SKIN : DAY_SKINS[season] ?? DAY_SKINS.summer;
  return `linear-gradient(175deg, ${s.skyTop} 0%, ${s.skyBottom} 100%)`;
}

const NIGHT_ACCENTS: { test: (code: number) => boolean; accent: string }[] = [
  { test: (c) => c >= 95, accent: "#FFB44F" },
  { test: (c) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82), accent: "#58C7E8" },
  { test: (c) => (c >= 71 && c <= 77) || c === 85 || c === 86, accent: "#A8CDEB" },
  { test: (c) => c === 45 || c === 48, accent: "#9FB6C9" },
];

// Severity reaches beyond thunderstorms: heavy snow is the family's other
// school-closing, boots-by-the-door event.
export const HEAVY_SNOW_CODES = new Set([73, 75, 85, 86]);

export type SevereKind = "storm" | "snow";

export function severeFamily(code: number): SevereKind | null {
  if (code >= 95) return "storm";
  if (HEAVY_SNOW_CODES.has(code)) return "snow";
  return null;
}

// Severity owns the card: a storm or heavy snow never borrows the holiday's
// party accent — the state accent wins until the severe weather passes.
export function resolveAccent(skin: WeatherSkin, holidayAccent: string | null | undefined): string {
  return skin.severe ? skin.accent : holidayAccent ?? skin.accent;
}

function mixHexColor(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const ca = (pa >> shift) & 255;
    const cb = (pb >> shift) & 255;
    return Math.round(ca + (cb - ca) * t);
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

export function getWeatherSkin(season: SeasonKey, isNight: boolean, code: number): WeatherSkin {
  if (isNight) {
    const accent = NIGHT_ACCENTS.find((n) => n.test(code))?.accent ?? NIGHT_SKIN.accent;
    const kind = severeFamily(code);
    return { ...NIGHT_SKIN, accent, severe: kind != null, severeFamily: kind, skyGradient };
  }
  const base = DAY_SKINS[season] ?? DAY_SKINS.summer;
  const kind = severeFamily(code);
  if (kind === "storm") {
    // Severity reaches the glance layer by day too: a daytime thunderstorm no
    // longer renders as a cheerful pastel lemon card. Desaturate the sky wash
    // toward storm gray and switch to the existing storm amber accent.
    const stormTop = mixHexColor(base.skyTop, "#9AA3AE", 0.62);
    const stormBottom = mixHexColor(base.skyBottom, "#7E8794", 0.62);
    return {
      ...base,
      name: `${base.name}-storm`,
      severe: true,
      severeFamily: "storm",
      skyTop: stormTop,
      skyBottom: stormBottom,
      accent: "#FFB44F",
      cloud: mixHexColor(base.cloud, "#8A93A0", 0.45),
      cloudDeep: mixHexColor(base.cloudDeep, "#6E7682", 0.45),
      glow: "rgba(120,130,150,0.35)",
      border: "rgba(35,38,44,0.22)",
      particle: "rgba(90,105,125,0.85)",
      stripTrack: "rgba(35,38,44,0.16)",
      skyGradient: () => `linear-gradient(175deg, ${stormTop} 0%, ${stormBottom} 100%)`,
    };
  }
  if (kind === "snow") {
    // A school-closing snowfall is not a cheerful pastel either — pull the
    // sky toward a serious slate-blue while the snow keeps falling.
    const snowTop = mixHexColor(base.skyTop, "#8B99B5", 0.55);
    const snowBottom = mixHexColor(base.skyBottom, "#7C8BA3", 0.55);
    return {
      ...base,
      name: `${base.name}-snow`,
      severe: true,
      severeFamily: "snow",
      skyTop: snowTop,
      skyBottom: snowBottom,
      accent: "#7FA8D9",
      cloud: mixHexColor(base.cloud, "#9AA6BA", 0.5),
      cloudDeep: mixHexColor(base.cloudDeep, "#8A97AD", 0.5),
      glow: "rgba(140,155,180,0.40)",
      border: "rgba(38,44,56,0.22)",
      particle: "rgba(240,246,252,0.95)",
      stripTrack: "rgba(38,44,56,0.16)",
      skyGradient: () => `linear-gradient(175deg, ${snowTop} 0%, ${snowBottom} 100%)`,
    };
  }
  return { ...base, severe: false, severeFamily: null, skyGradient };
}

export function cardinalFromDegrees(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(((deg % 360) / 45)) % 8];
}
