// @vitest-environment jsdom
// Fix-B cluster 1: Home's Tasks + Daily Schedule widgets must re-pull on the
// 60s `consuela-data-refreshed` pulse (the Week tile's contract) instead of
// freezing at whatever the mount effect read once.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import HomePage from "@/app/page";

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

const scheduleMock = vi.hoisted(() => ({ items: [] as any[] }));
vi.mock("@/db", () => ({
  db: {
    selectMembersDetailed: () => [],
    selectTodaysEvents: () => [],
    selectPendingTasks: () => [],
    selectTodaysSchedules: () => scheduleMock.items.map((s) => ({ ...s })),
    selectMeals: async () => [],
    gatewayReadStatus: async () => ({ items: [], blocked: false }),
    mealsStore: [] as any[],
  },
}));

vi.mock("@/components/briefing/hooks/useMorningBriefing", () => ({
  useMorningBriefing: () => ({ briefing: null, loading: false, ack: null, ackError: null }),
  briefingSectionsEmpty: () => true,
}));

const homeEventsMock = vi.hoisted(() => ({ upcomingImportant: [] as any[] }));
vi.mock("@/hooks/useHomeEvents", () => ({ useHomeEvents: () => homeEventsMock }));

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
  visibleWidgets: [{ id: "tasks" }, { id: "schedule" }] as any[],
  orientation: "phone" as const,
  mounted: true,
}));
vi.mock("@/hooks/useHomeLayout", () => ({ useHomeLayout: () => layoutMock }));

vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

function seedTasks(titles: string[]) {
  localStorage.setItem(
    "consuela-tasks",
    JSON.stringify(
      titles.map((title, i) => ({
        id: i + 1, title, assignee: "Caspian", assigneeEmoji: "🧒",
        due: "2099-01-01", points: 10, recurring: null,
        category: "chores", completed: false, priority: "medium",
      }))
    )
  );
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

describe("Home Tasks + Daily Schedule refresh (consuela-data-refreshed)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {},
    })));
    scheduleMock.items = [];
    mockAuth.currentUser = null;
    mockAuth.isLoggedIn = false;
  });

  afterEach(() => {
    act(() => { activeRoot?.unmount(); });
    activeRoot = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("Tasks widget re-reads loadTasks() when the 60s pulse fires", async () => {
    seedTasks(["Dishes"]);
    const el = await renderAsync(<HomePage />);
    await settle();
    expect(el.textContent).toContain("Dishes");
    expect(el.textContent).not.toContain("Feed the fish");

    // Another device's task lands in the store via the snapshot pull.
    seedTasks(["Dishes", "Feed the fish"]);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
    });
    await settle();

    expect(el.textContent).toContain("Feed the fish");
    expect(el.textContent).toContain("2 pending for the family");
  });

  it("Daily Schedule widget re-reads db.selectTodaysSchedules() when the pulse fires", async () => {
    seedTasks([]);
    const el = await renderAsync(<HomePage />);
    await settle();
    expect(el.textContent).toContain("No items scheduled");

    // The 60s refresh repopulated the schedules cache.
    scheduleMock.items = [
      { id: 1, title: "Soccer Practice", time: "23:59", type: "routine", color: "cyan", emoji: "⚽" },
    ];

    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
    });
    await settle();

    expect(el.textContent).toContain("Soccer Practice");
  });

  it("stops listening after unmount (no setState on a dead tree)", async () => {
    seedTasks(["Dishes"]);
    const el = await renderAsync(<HomePage />);
    await settle();

    act(() => { activeRoot?.unmount(); });
    activeRoot = null;

    seedTasks(["Dishes", "Ghost task"]);
    expect(() => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
    }).not.toThrow();
    expect(el.textContent).not.toContain("Ghost task");
  });
});
