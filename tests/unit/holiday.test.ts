// Home-ai/tests/unit/holiday.test.ts
import { describe, it, expect } from "vitest";
import { detectAutoHoliday, HOLIDAY_PALETTE, HOLIDAY_STYLE } from "@/lib/holiday";
import { parseHexColor, contrastRatio } from "@/lib/weather-contrast";
import { contrastSafeTextAccent } from "@/components/ui/WeatherSkins";

const d = (iso: string) => new Date(`${iso}T12:00:00`);
describe("detectAutoHoliday windows", () => {
  it.each<[string,string]>([
    ["2026-12-20","christmas"], ["2026-12-31","christmas"],
    ["2026-01-03","newyears"], ["2026-02-14","valentines"], ["2026-03-15","stpatricks"],
    ["2026-05-05","cincodemayo"], ["2026-09-15","mexicanindependence"],
    ["2026-10-26","halloween"], ["2026-11-01","diadelosmuertos"],
    ["2026-07-04","july4th"], ["2026-11-26","thanksgiving"],
    ["2026-12-12","virginguadalupe"],
  ])("%s -> %s", (iso, hol) => expect(detectAutoHoliday(d(iso))).toBe(hol));
  it("non-holiday -> none", () => expect(detectAutoHoliday(d("2026-01-20"))).toBe("none"));
  it("diadelosmuertos boundary: 11/02 in, 11/03 out", () => {
    expect(detectAutoHoliday(d("2026-11-02"))).toBe("diadelosmuertos");
    expect(detectAutoHoliday(d("2026-11-03"))).toBe("none");
  });
  it("christmas boundary: 12/14 out, 12/15 in", () => {
    expect(detectAutoHoliday(d("2026-12-14"))).toBe("none");
    expect(detectAutoHoliday(d("2026-12-15"))).toBe("christmas");
  });
  it("stpatricks boundary: 3/13 out, 3/14 in", () => {
    expect(detectAutoHoliday(d("2026-03-13"))).toBe("none");
    expect(detectAutoHoliday(d("2026-03-14"))).toBe("stpatricks");
  });
  it("thanksgiving boundary: 11/28 in, 11/29 out", () => {
    expect(detectAutoHoliday(d("2026-11-28"))).toBe("thanksgiving");
    expect(detectAutoHoliday(d("2026-11-29"))).toBe("none");
  });
});
describe("HOLIDAY_PALETTE", () => {
  it("has 11 holiday entries", () => {
    const keys = Object.keys(HOLIDAY_PALETTE);
    expect(keys).toHaveLength(11);
  });
  it("every accent is opaque hex and yields a 4.5:1 foreground", () => {
    for (const [k,v] of Object.entries(HOLIDAY_PALETTE)) {
      expect(parseHexColor((v as any).accent), k).not.toBeNull();
      const safe = contrastSafeTextAccent((v as any).accent, "#FFFFFF", "#000000");
      expect(contrastRatio(safe, "#FFFFFF"), `${k} safe text vs light surface`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
describe("HOLIDAY_STYLE", () => {
  it("covers 11 holidays with particle + label", () => {
    expect(Object.keys(HOLIDAY_STYLE)).toHaveLength(11);
  });
});
