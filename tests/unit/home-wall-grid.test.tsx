// @vitest-environment jsdom
// Task 3 (wall profile): Home renders the 2-col/440px wall grid when
// useWallMode resolves wall=true, and never otherwise.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import HomePage from "@/app/page";
import { WALL_GRID_CLASS } from "@/lib/layout-config";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("next/dynamic", () => {
  const Noop = () => null;
  return { default: () => Noop };
});

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

vi.mock("@/hooks/useDashboardMode", () => ({
  useDashboardMode: () => ({ mode: "family", isBedtime: false, isWeekend: false, currentHour: 12, currentDay: 3, previousMode: null }),
}));

const wallState = vi.hoisted(() => ({ wall: false, mounted: true }));
vi.mock("@/hooks/useWallMode", () => ({
  useWallMode: () => wallState,
}));

vi.mock("@/db", () => ({
  db: {
    selectMembersDetailed: () => [],
    selectTodaysEvents: () => [],
    selectPendingTasks: () => [],
    selectTodaysSchedules: () => [],
    selectMeals: async () => [],
    gatewayReadStatus: async () => ({ items: [], blocked: false }),
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
    season: "summer", holiday: null, isNight: false,
    accentColor: "#7c6ff7", glowColor: "#7c6ff7", bgGradient: "", particleEmoji: "",
    atmosphereOpacity: 0, bridgeGradient: "", bridgeGlow: "",
    filterId: "atmos", accentRgb: "124, 111, 247",
    colors: { glow: "rgba(124,111,247,0.5)", gradientStop: "#7c6ff7", accentColor: "#7c6ff7" },
  }),
}));

const layoutMock = vi.hoisted(() => ({
  visibleWidgets: [] as any[],
  orientation: "tablet" as const,
  mounted: true,
}));
vi.mock("@/hooks/useHomeLayout", () => ({ useHomeLayout: () => layoutMock }));

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

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  wallState.wall = false;
  wallState.mounted = true;
});

afterEach(() => {
  act(() => { activeRoot?.unmount(); });
  activeRoot = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.wall;
});

describe("Home wall grid", () => {
  it("renders the 2-col/440px wall grid when wall mode is on", async () => {
    wallState.wall = true;
    const el = await renderAsync(<HomePage />);
    expect(el.innerHTML).toContain(WALL_GRID_CLASS);
  });

  it("does not render the wall grid when wall mode is off", async () => {
    const el = await renderAsync(<HomePage />);
    expect(el.innerHTML).not.toContain(WALL_GRID_CLASS);
  });
});
