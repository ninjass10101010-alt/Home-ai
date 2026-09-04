import { describe, it, expect } from "vitest";
import {
  accentAlpha,
  accentColor,
  dinnerForToday,
  nextEventToday,
  isTelegramMessage,
  messageOrigin,
} from "@/lib/consuela/chat-context";

describe("accentAlpha / accentColor", () => {
  it("converts a hex accent + alpha into an rgba() color", () => {
    expect(accentAlpha("#7c6ff7", 0.24)).toBe("rgba(124,111,247,0.24)");
  });

  it("returns the fallback color when the token is empty or unset", () => {
    expect(accentColor("", 0.5, "#7c6ff7")).toBe("#7c6ff7");
    expect(accentColor(undefined, 0.5, "#111827")).toBe("#111827");
  });

  it("passes through a resolved var() reference (CSS handles alpha via color-mix fallback)", () => {
    // When callers pass a var() token directly (already resolved by the time
    // the helper sees computed styles in components), non-hex input falls back.
    expect(accentColor("var(--color-accent-selected)", 0.5, "#7c6ff7")).toBe("#7c6ff7");
  });
});

describe("dinnerForToday", () => {
  const week = "2026-09-01"; // a Monday
  it("finds dinner by local weekday within the current week", () => {
    const meals = [
      { name: "Tacos", mealType: "dinner", time: "Tue", weekOf: week },
      { name: "Pancakes", mealType: "breakfast", time: "Tue", weekOf: week },
    ];
    const dinner = dinnerForToday(meals, week, "Tue");
    expect(dinner?.name).toBe("Tacos");
  });

  it("falls back to the day's first meal when no explicit dinner exists", () => {
    const meals = [{ name: "Leftover night", mealType: "lunch", time: "Tue", weekOf: week }];
    expect(dinnerForToday(meals, week, "Tue")?.name).toBe("Leftover night");
  });

  it("returns null (honest empty) when the day has no meals", () => {
    expect(dinnerForToday([{ name: "Tacos", mealType: "dinner", time: "Wed", weekOf: week }], week, "Tue")).toBeNull();
    expect(dinnerForToday([], week, "Tue")).toBeNull();
  });

  it("ignores meals from other weeks", () => {
    const meals = [{ name: "Tacos", mealType: "dinner", time: "Tue", weekOf: "2026-08-25" }];
    expect(dinnerForToday(meals, week, "Tue")).toBeNull();
  });
});

describe("nextEventToday", () => {
  const now = new Date("2026-09-02T18:00:00"); // 6 PM local — parseMinutes uses local wall clock
  it("returns the next event at or after the current minute", () => {
    const events = [
      { title: "Soccer", time: "4:00 PM" },
      { title: "Dinner", time: "6:30 PM" },
    ];
    expect(nextEventToday(events, now)?.title).toBe("Dinner");
  });

  it("returns null when the day's events are all past (quiet rest of day)", () => {
    const events = [{ title: "Soccer", time: "4:00 PM" }];
    expect(nextEventToday(events, now)).toBeNull();
  });

  it("parses 24-hour times as well as AM/PM", () => {
    const events = [{ title: "Bedtime story", time: "19:30" }];
    expect(nextEventToday(events, now)?.title).toBe("Bedtime story");
  });

  it("returns null for empty or malformed event lists", () => {
    expect(nextEventToday([], now)).toBeNull();
    expect(nextEventToday([{ title: "X", time: "whenever" }], now)).toBeNull();
  });
});

describe("telegram origin", () => {
  it("flags rows carrying source=telegram", () => {
    expect(isTelegramMessage({ source: "telegram" })).toBe(true);
    expect(isTelegramMessage({ source: "dashboard" })).toBe(false);
    expect(isTelegramMessage({})).toBe(false);
  });

  it("produces an origin label only for telegram rows", () => {
    expect(messageOrigin({ source: "telegram", userId: "Rebecca" })).toBe("via Telegram · Rebecca");
    expect(messageOrigin({ source: "dashboard", userId: "Rebecca" })).toBeNull();
  });

  it("omits the member name when the telegram row has none", () => {
    expect(messageOrigin({ source: "telegram" })).toBe("via Telegram");
  });
});
