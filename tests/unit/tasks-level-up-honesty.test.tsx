// @vitest-environment jsdom
// The level-up ceremony must only ever celebrate a REAL promotion. Before the
// all-time read is known the level is unknown (not 0), so a read that resolves
// after the first render must never look like "0 → N" and fire the modal.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import TasksPage from "@/app/tasks/page";
import { WEEK_DATA_KEY } from "@/lib/task-utils";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/tasks",
}));
vi.mock("next/dynamic", () => {
  const Noop = () => null;
  return { default: () => Noop };
});

const mockAuth = vi.hoisted(() => ({ currentUser: { name: "Emily", role: "parent", emoji: "👧" } as any, isLoggedIn: true }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

vi.mock("@/hooks/useDashboardMode", () => ({
  useDashboardMode: () => ({ mode: "adult", isBedtime: false, isWeekend: false, currentHour: 12, currentDay: 3, previousMode: null }),
}));

vi.mock("@/db", () => ({
  db: {
    refreshMembersCache: vi.fn(async () => {}),
    selectMembers: () => [
      { id: 1, name: "Emily", fullName: "Emily", role: "parent", emoji: "👧", color: "mint" },
    ],
    selectMembersDetailed: () => [{ name: "Emily", role: "parent", emoji: "👧", color: "mint" }],
    selectTodaysEvents: () => [],
    selectMeals: async () => [],
  },
}));

vi.mock("@/components/integrations/SpotifyWidget", () => ({ default: () => null }));
vi.mock("@/components/integrations/AllowanceWidget", () => ({ default: () => null }));
vi.mock("@/components/integrations/LearningWidget", () => ({ default: () => null }));
vi.mock("@/components/ui/EmergencyButton", () => ({ default: () => null }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));
vi.mock("@/components/leaderboard/WeeklyWinModal", () => ({ default: () => null }));
vi.mock("@/components/leaderboard/hooks/useWeeklyPrizes", () => ({ useWeeklyPrizes: () => [] }));
vi.mock("@/hooks/useAtmosphericTheme", () => ({
  AtmosphericProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAtmosphericTheme: () => ({
    theme: {}, filterId: "atmos", accentRgb: "0,0,0",
    colors: { glow: "", gradientStop: "", accentColor: "" },
  }),
}));

Element.prototype.scrollIntoView = vi.fn() as any;

const ALL_TIME_FETCHED_AT = "2026-09-24T10:00:00.000Z";
const allTime = vi.hoisted(() => ({ respond: null as null | (() => unknown) }));

function payloadWith(totals: Record<string, { points: number | null; completions: number | null }>) {
  return {
    weekStart: "2026-09-21",
    totals,
    historyComplete: true,
    source: "pocketbase",
    fetchedAt: ALL_TIME_FETCHED_AT,
  };
}

function serveAllTime(totals: Record<string, { points: number | null; completions: number | null }>) {
  allTime.respond = () => payloadWith(totals);
}

function serveAllTimeFailure(status = 503) {
  allTime.respond = () => ({ __httpError: status });
}

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

function thisMondayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function seedWeek() {
  localStorage.setItem(WEEK_DATA_KEY, JSON.stringify({
    weekStart: thisMondayISO(),
    points: { Emily: 10 },
    streak: {},
    lastActive: {},
    history: [],
  }));
}

function celebrateText(el: HTMLElement): string {
  return `${el.textContent || ""}${document.body.textContent || ""}`;
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  serveAllTime({ Emily: { points: 60, completions: 4 } });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/api/tasks/all-time")) {
      const body = allTime.respond ? allTime.respond() : null;
      if (body && typeof body === "object" && "__httpError" in body) {
        return { ok: false, status: (body as any).__httpError, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => body };
    }
    return { ok: false, status: 401, json: async () => ({}) };
  }));
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
  })));
});

afterEach(() => {
  act(() => { activeRoot?.unmount(); });
  activeRoot = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("the level-up ceremony only celebrates a real promotion", () => {
  it("a read that lands after the first render never opens the level-up modal", async () => {
    seedWeek();
    const el = await renderAsync(<TasksPage />);
    await settle();

    // The first render has no totals (the read is in flight), the settled
    // render has level 2. The unknown in between must not look like a 0 → 2
    // promotion.
    expect(celebrateText(el)).not.toContain("became a");
    expect(celebrateText(el)).not.toContain("Level Up!");
  });

  it("a failed read that later succeeds never opens the level-up modal", async () => {
    seedWeek();
    serveAllTimeFailure(503);
    const el = await renderAsync(<TasksPage />);
    await settle();
    expect(celebrateText(el)).not.toContain("became a");

    serveAllTime({ Emily: { points: 60, completions: 4 } });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
    });
    await settle();

    expect(celebrateText(el)).not.toContain("became a");
  });

  it("a REAL level increase still celebrates", async () => {
    seedWeek();
    serveAllTime({ Emily: { points: 60, completions: 4 } });
    const el = await renderAsync(<TasksPage />);
    await settle();
    expect(celebrateText(el)).not.toContain("became a");

    // Emily crosses 150 points: level 2 (Task Scout) → level 3 (Chore Champ).
    serveAllTime({ Emily: { points: 200, completions: 9 } });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
    });
    await settle();

    const text = celebrateText(el);
    expect(text).toContain("Level Up!");
    expect(text).toContain("Emily became a");
    expect(text).toContain("Chore Champ");
    expect(text).toContain("reached level 3");
  });

  it("an unchanged level never re-opens the modal on a later pulse", async () => {
    seedWeek();
    serveAllTime({ Emily: { points: 60, completions: 4 } });
    const el = await renderAsync(<TasksPage />);
    await settle();

    serveAllTime({ Emily: { points: 61, completions: 4 } });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
    });
    await settle();

    expect(celebrateText(el)).not.toContain("became a");
  });
});
