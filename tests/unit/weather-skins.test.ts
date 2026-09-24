import { describe, expect, it } from "vitest";
import { accentForeground, contrastSafeTextAccent } from "@/components/ui/WeatherSkins";

describe("WeatherSkins contrast inputs", () => {
  it.each(["", "not-a-color", "#12", "#12345", "#1234567", "#123456789", "rgba(0,0,0,0.4)"])(
    "rejects malformed accent %s",
    (accent) => {
      expect(() => contrastSafeTextAccent(accent, "#FFFFFF", "#000000")).toThrow();
    },
  );

  it("rejects empty, malformed, and alpha-bearing surfaces", () => {
    expect(() => contrastSafeTextAccent("#123456", [], "#000000")).toThrow();
    expect(() => contrastSafeTextAccent("#123456", ["#FFFFFF", ""], "#000000")).toThrow();
    expect(() => contrastSafeTextAccent("#123456", "#FFFFFF80", "#000000")).toThrow();
  });

  it("rejects malformed fallbacks", () => {
    expect(() => contrastSafeTextAccent("#123456", "#FFFFFF", "")).toThrow();
    expect(() => contrastSafeTextAccent("#123456", "#FFFFFF", "#12")).toThrow();
    expect(() => contrastSafeTextAccent("#123456", "#FFFFFF", "#00000080")).toThrow();
  });

  it("accepts fully opaque 4/8-digit alpha forms and rejects non-opaque alpha forms", () => {
    expect(() => contrastSafeTextAccent("#123f", "#FFFFFF", "#000000")).not.toThrow();
    expect(() => contrastSafeTextAccent("#123456ff", "#FFFFFF", "#000000")).not.toThrow();
    expect(() => contrastSafeTextAccent("#1233", "#FFFFFF", "#000000")).toThrow();
    expect(() => contrastSafeTextAccent("#12345677", "#FFFFFF", "#000000")).toThrow();
    expect(() => contrastSafeTextAccent("#123456", "#123f", "#000000")).not.toThrow();
    expect(() => contrastSafeTextAccent("#123456", "#123456ff", "#000000")).not.toThrow();
    expect(() => contrastSafeTextAccent("#123456", "#1233", "#000000")).toThrow();
    expect(() => contrastSafeTextAccent("#123456", "#12345677", "#000000")).toThrow();
    expect(() => contrastSafeTextAccent("#123456", "#FFFFFF", "#123f")).not.toThrow();
    expect(() => contrastSafeTextAccent("#123456", "#FFFFFF", "#123456ff")).not.toThrow();
    expect(() => contrastSafeTextAccent("#123456", "#FFFFFF", "#1233")).toThrow();
    expect(() => contrastSafeTextAccent("#123456", "#FFFFFF", "#12345677")).toThrow();
    expect(() => accentForeground("#123f")).not.toThrow();
    expect(() => accentForeground("#123456ff")).not.toThrow();
    expect(() => accentForeground("#1233")).toThrow();
    expect(() => accentForeground("#12345677")).toThrow();
  });

  it("does not return white for an invalid accent foreground", () => {
    expect(() => accentForeground("")).toThrow();
    expect(() => accentForeground("not-a-color")).toThrow();
    expect(() => accentForeground("#12345")).toThrow();
  });
});
