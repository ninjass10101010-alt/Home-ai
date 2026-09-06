// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import HomePage, { plannedDaysThisWeek } from "@/app/page";
import { todayMondayISO } from "@/lib/meals-week-utils";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("next/dynamic", () => {
  const Noop = () => null;
  return { default: () => Noop };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentUser: null, isLoggedIn: false, isParent: false, logout: vi.fn(), sessionRemainingMs: 30 * 60 * 1000, sessionWarning: false, extendSession: vi.fn() }),
}));

vi.mock("@/hooks/useDashboardMode", () => ({
  useDashboardMode: () => ({ mode: "family", isBedtime: false, isWeekend: false, currentHour: 12, currentDay: 3, previousMode: null }),
}));

const mealsMock = vi.hoisted(() => ({ status: { items: [] as any[], blocked: false } }));
vi.mock("@/db", () => ({
  db: {
    selectMembersDetailed: () => [],
    selectTodaysEvents: () => [],
    selectPendingTasks: () => [],
    selectTodaysSchedules: () => [],
    selectMeals: async () => [],
    gatewayReadStatus: async () => mealsMock.status,
    mealsStore: [] as any[],
  },
}));

vi.mock("@/components/briefing/hooks/useMorningBriefing", () => ({
  useMorningBriefing: () => ({ briefing: null, loading: false, ack: null, ackError: null }),
  briefingSectionsEmpty: () => true,
}));

vi.mock("@/hooks/useHomeEvents", () => ({ useHomeEvents: () => ({ upcomingImportant: [] }) }));

vi.mock("@/hooks/useAtmosphericTheme", () => ({
  AtmosphericProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAtmosphericTheme: () => ({
    theme: { season: "summer", holiday: null, isNight: false, accentColor: "#7c6ff7", glowColor: "#7c6ff7", bgGradient: "", particleEmoji: "", atmosphereOpacity: 0, bridgeGradient: "", bridgeGlow: "" },
    filterId: "atmos",
    accentRgb: "124, 111, 247",
    colors: { glow: "rgba(124,111,247,0.5)", gradientStop: "#7c6ff7", accentColor: "#7c6ff7" },
  }),
}));

vi.mock("@/hooks/useHomeLayout", () => ({
  useHomeLayout: () => ({ visibleWidgets: [], orientation: "phone", mounted: true }),
}));

vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

let activeRoot: Root | null = null;

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    activeRoot = createRoot(el);
    activeRoot.render(ui);
  });
  return el;
}

async function settle(ms = 120) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

function meal(time: string, weekOf?: string): any {
  return { time, mealType: "dinner", name: `Meal ${time}`, weekOf };
}

function weekTileValue(el: HTMLElement): string | null {
  // StatTile renders value → label → detail; find the tile by its detail text.
  const detail = Array.from(el.querySelectorAll("div")).find((d) => d.textContent === "Days planned" && d.childElementCount === 0);
  const tile = detail?.parentElement;
  if (!tile) return null;
  const value = Array.from(tile.children).find((c) => c.textContent === "Week")?.previousElementSibling;
  return value?.textContent ?? null;
}

describe("plannedDaysThisWeek (pure)", () => {
  const wk = "2026-09-01";

  it("returns 0 for an empty week", () => {
    expect(plannedDaysThisWeek([], wk)).toBe(0);
  });

  it("counts distinct days partially planned", () => {
    const meals = [meal("Mon"), meal("Mon", wk), meal("Wed"), meal("Fri", "2026-08-24")];
    // Mon + Wed in-week; the Fri row belongs to last week; dupes collapse.
    expect(plannedDaysThisWeek(meals, wk)).toBe(2);
  });

  it("counts a full week as 7", () => {
    const meals = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => meal(d, wk));
    expect(plannedDaysThisWeek(meals, wk)).toBe(7);
  });

  it("treats weekOf-less legacy meals as the current week", () => {
    expect(plannedDaysThisWeek([meal("Tue")], wk)).toBe(1);
  });

  it("returns null (unavailable) for null meal data", () => {
    expect(plannedDaysThisWeek(null, wk)).toBe(null);
  });
});

describe("Home Week tile honesty", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })));
    mealsMock.status = { items: [], blocked: false };
  });

  afterEach(() => {
    act(() => { activeRoot?.unmount(); });
    activeRoot = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("shows the real planned-day count, not a hardcoded 7", async () => {
    const wk = todayMondayISO();
    mealsMock.status = { items: [meal("Mon", wk), meal("Mon", wk), meal("Wed", wk)], blocked: false };
    const el = await renderAsync(<HomePage />);
    await settle();
    expect(weekTileValue(el)).toBe("2");
  });

  it("shows 0 when the week genuinely has no meals", async () => {
    mealsMock.status = { items: [], blocked: false };
    const el = await renderAsync(<HomePage />);
    await settle();
    expect(weekTileValue(el)).toBe("0");
  });

  it("shows — when the meal read is blocked (guest), never a fake number", async () => {
    mealsMock.status = { items: [], blocked: true };
    const el = await renderAsync(<HomePage />);
    await settle();
    expect(weekTileValue(el)).toBe("—");
  });
});
