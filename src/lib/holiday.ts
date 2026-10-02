// Home-ai/src/lib/holiday.ts
import type { HolidayOverride } from "@/lib/weather-config";
import type { ParticleKind } from "@/components/ui/WeatherParticles";
export function detectAutoHoliday(date = new Date()): HolidayOverride {
  const m = date.getMonth(), day = date.getDate();
  if (m === 11 && day >= 15) return "christmas";
  if (m === 0 && day <= 7) return "newyears";
  if (m === 1 && day >= 10 && day <= 16) return "valentines";
  if (m === 2 && day >= 14 && day <= 17) return "stpatricks";
  if (m === 4 && day >= 3 && day <= 6) return "cincodemayo";
  if (m === 8 && day >= 15 && day <= 16) return "mexicanindependence";
  if (m === 9 && day >= 25 && day <= 30) return "halloween";
  if ((m === 9 && day === 31) || (m === 10 && day >= 1 && day <= 2)) return "diadelosmuertos";
  if (m === 6 && day >= 1 && day <= 7) return "july4th";
  if (m === 10 && day >= 22 && day <= 28) return "thanksgiving";
  if (m === 11 && day >= 11 && day <= 13) return "virginguadalupe";
  return "none";
}
export const HOLIDAY_PALETTE: Record<Exclude<HolidayOverride,"auto"|"none">,{accent:string,glow:string,surfaceTint:string}> = {
  christmas: { accent:"#ef4444", glow:"rgba(239,68,68,0.22)", surfaceTint:"rgba(239,68,68,0.07)" },
  newyears: { accent:"#eab308", glow:"rgba(234,179,8,0.20)", surfaceTint:"rgba(234,179,8,0.06)" },
  valentines: { accent:"#f43f5e", glow:"rgba(244,63,94,0.22)", surfaceTint:"rgba(244,63,94,0.06)" },
  stpatricks: { accent:"#22c55e", glow:"rgba(34,197,94,0.20)", surfaceTint:"rgba(34,197,94,0.06)" },
  cincodemayo: { accent:"#f59e0b", glow:"rgba(245,158,11,0.20)", surfaceTint:"rgba(245,158,11,0.06)" },
  mexicanindependence: { accent:"#22c55e", glow:"rgba(34,197,94,0.18)", surfaceTint:"rgba(34,197,94,0.05)" },
  halloween: { accent:"#f97316", glow:"rgba(249,115,22,0.22)", surfaceTint:"rgba(249,115,22,0.06)" },
  diadelosmuertos: { accent:"#ec4899", glow:"rgba(236,72,153,0.20)", surfaceTint:"rgba(236,72,153,0.06)" },
  july4th: { accent:"#ef4444", glow:"rgba(239,68,68,0.20)", surfaceTint:"rgba(239,68,68,0.06)" },
  thanksgiving: { accent:"#d97706", glow:"rgba(217,119,6,0.20)", surfaceTint:"rgba(217,119,6,0.06)" },
  virginguadalupe: { accent:"#0d9488", glow:"rgba(13,148,136,0.18)", surfaceTint:"rgba(13,148,136,0.06)" },
};
export const HOLIDAY_STYLE: Partial<Record<Exclude<HolidayOverride,"auto"|"none">,{accent:string,particle:ParticleKind,label:string}>> = {
  christmas:{accent:"#ef4444",particle:"christmas-snow",label:"🎄 Christmas"},
  halloween:{accent:"#f97316",particle:"bat",label:"🎃 Halloween"},
  july4th:{accent:"#ef4444",particle:"spark",label:"🎆 4th of July"},
  valentines:{accent:"#f43f5e",particle:"heart",label:"💝 Valentine's"},
  newyears:{accent:"#eab308",particle:"spark",label:"🥂 New Year's"},
  cincodemayo:{accent:"#f59e0b",particle:"confetti",label:"🪅 Cinco de Mayo"},
  thanksgiving:{accent:"#d97706",particle:"harvest",label:"🦃 Thanksgiving"},
  stpatricks:{accent:"#22c55e",particle:"shamrock",label:"🍀 St. Patrick's"},
  diadelosmuertos:{accent:"#ec4899",particle:"marigold",label:"💀 Día de los Muertos"},
  mexicanindependence:{accent:"#22c55e",particle:"tricolor-sparks",label:"🔔 Independence Day"},
  virginguadalupe:{accent:"#0d9488",particle:"holy-roses",label:"🌹 Virgin of Guadalupe"},
};
