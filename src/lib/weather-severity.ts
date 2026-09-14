// WMO severity classification — the single source of truth shared by the
// on-screen weather skins (src/components/ui/WeatherSkins.ts) and the server
// weather-alert cron. Kept pure + dependency-free so both client and Node can
// import it and unit tests need no mocks.

// Thunderstorms (any intensity) — codes 95/96/99.
export function isStormCode(code: number): boolean {
  return code >= 95;
}

// The family's other school-closing event: heavy, accumulative snow.
export const HEAVY_SNOW_CODES: Set<number> = new Set([73, 75, 85, 86]);

export type SevereKind = "storm" | "snow" | null;

export function severeFamily(code: number): SevereKind {
  if (isStormCode(code)) return "storm";
  if (HEAVY_SNOW_CODES.has(code)) return "snow";
  return null;
}
