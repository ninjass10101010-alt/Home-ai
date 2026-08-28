// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import CurrentMealWidget from "@/components/meals/CurrentMealWidget";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useAtmosphericTheme", () => ({
  useAtmosphericTheme: () => ({
    accentColor: "#10b981",
    glowColor: "rgba(16,185,129,0.3)",
    particleEmoji: "🍂",
    atmosphereOpacity: 0.1,
  }),
}));

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

// Thu Aug 27 2026, 5:00 PM — matches the "Thu" weekday used in consuela-meals seeds.
const THURSDAY_5PM = new Date(2026, 7, 27, 17, 0, 0);

function seedSchedule(time: string, mealType = "dinner") {
  localStorage.setItem(
    "consuela-schedules",
    JSON.stringify([{ title: mealType, mealType, time }])
  );
}

function seedMeal(overrides: Record<string, unknown> = {}) {
  localStorage.setItem(
    "consuela-meals",
    JSON.stringify([
      { time: "Thu", mealType: "dinner", name: "Tacos", emoji: "🌮", tags: ["easy"], ...overrides },
    ])
  );
}

describe("CurrentMealWidget", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: THURSDAY_5PM });
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("header title keeps whitespace-nowrap and the clock badge keeps shrink-0", () => {
    const el = render(<CurrentMealWidget />);
    const title = Array.from(el.querySelectorAll("h2")).find((h) => h.textContent?.includes("Time"));
    expect(title?.className).toContain("whitespace-nowrap");
    const badge = Array.from(el.querySelectorAll("span")).find((s) => s.className.includes("meal-time-badge"));
    expect(badge?.className).toContain("shrink-0");
  });

  it("shows the quiet prompt when no schedule exists", () => {
    const el = render(<CurrentMealWidget />);
    expect(el.textContent).toContain("Set a meal schedule to see times");
  });

  it("a meal 30 min away reads 'In 30m · at 5:30 PM'", () => {
    seedSchedule("5:30 PM");
    const el = render(<CurrentMealWidget />);
    expect(el.textContent).toContain("In 30m · at 5:30 PM");
  });

  it("a meal 3h away reads 'Scheduled at 8:00 PM'", () => {
    seedSchedule("8:00 PM");
    const el = render(<CurrentMealWidget />);
    expect(el.textContent).toContain("Scheduled at 8:00 PM");
  });

  it("within 15 min reads 'Almost time · in 10m'", () => {
    seedSchedule("5:10 PM");
    const el = render(<CurrentMealWidget />);
    expect(el.textContent).toContain("Almost time · in 10m");
  });

  it("once the meal has started it reads 'Started at 4:30 PM'", () => {
    seedSchedule("4:30 PM");
    const el = render(<CurrentMealWidget />);
    expect(el.textContent).toContain("Started at 4:30 PM");
  });

  it("proximity ramps the meal card glow (0px far away, stronger at 30m)", () => {
    seedSchedule("8:00 PM");
    const far = render(<CurrentMealWidget />);
    const farCard = far.querySelector(".meal-card-glow") as HTMLElement;
    expect(farCard.style.boxShadow).toContain("0px");

    document.body.innerHTML = "";
    seedSchedule("5:30 PM");
    const near = render(<CurrentMealWidget />);
    const nearCard = near.querySelector(".meal-card-glow") as HTMLElement;
    expect(nearCard.style.boxShadow).toContain("14px");
    const emojiBox = near.querySelector(".meal-emoji-glow") as HTMLElement;
    expect(emojiBox.style.boxShadow).toContain("24px");
  });

  it("long meal names wrap via line-clamp-2 instead of truncate", () => {
    seedSchedule("5:30 PM");
    seedMeal({ name: "Grandma's Slow-Cooked Sunday Pot Roast With Root Vegetables" });
    const el = render(<CurrentMealWidget />);
    const name = el.querySelector("h3");
    expect(name?.className).toContain("line-clamp-2");
    expect(name?.className).not.toContain("truncate");
  });

  it("caps tags at 3 with a quiet +N chip", () => {
    seedSchedule("5:30 PM");
    seedMeal({ tags: ["easy", "family", "quick", "spicy", "one-pot"] });
    const el = render(<CurrentMealWidget />);
    expect(el.textContent).toContain("easy");
    expect(el.textContent).toContain("quick");
    expect(el.textContent).toContain("+2");
    expect(el.textContent).not.toContain("spicy");
    expect(el.textContent).not.toContain("one-pot");
  });
});
