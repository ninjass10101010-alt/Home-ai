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
}

const DAY_SKINS: Record<SeasonKey, WeatherSkin> = {
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

const NIGHT_ACCENTS: { test: (code: number) => boolean; accent: string }[] = [
  { test: (c) => c >= 95, accent: "#FFB44F" },
  { test: (c) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82), accent: "#58C7E8" },
  { test: (c) => (c >= 71 && c <= 77) || c === 85 || c === 86, accent: "#A8CDEB" },
  { test: (c) => c === 45 || c === 48, accent: "#9FB6C9" },
];

export function getWeatherSkin(season: SeasonKey, isNight: boolean, code: number): WeatherSkin {
  if (!isNight) return DAY_SKINS[season] ?? DAY_SKINS.summer;
  const accent = NIGHT_ACCENTS.find((n) => n.test(code))?.accent ?? "#FF6F5E";
  return {
    name: "night",
    night: true,
    skyTop: "#060609",
    skyBottom: "#141420",
    ink: "#FFFFFF",
    inkSoft: "rgba(255,255,255,0.62)",
    accent,
    cloud: "#232636",
    cloudDeep: "#181B28",
    celestial: "#F4F1E8",
    glow: "rgba(120,130,190,0.22)",
    border: "rgba(255,255,255,0.12)",
    particle: "rgba(160,200,240,0.70)",
    stripTrack: "rgba(255,255,255,0.14)",
  };
}

export function cardinalFromDegrees(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(((deg % 360) / 45)) % 8];
}
