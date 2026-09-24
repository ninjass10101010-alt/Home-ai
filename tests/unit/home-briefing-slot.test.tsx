// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
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

const authState = vi.hoisted(() => ({ currentUser: null, isLoggedIn: false, isParent: false }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    ...authState,
    logout: vi.fn(),
    sessionRemainingMs: 30 * 60 * 1000,
    sessionWarning: false,
    extendSession: vi.fn(),
    quickLogin: vi.fn(),
  }),
}));

vi.mock("@/hooks/useDashboardMode", () => ({
  useDashboardMode: () => ({ mode: "family", isBedtime: false, isWeekend: false, currentHour: 12, currentDay: 3, previousMode: null }),
}));

vi.mock("@/hooks/useWallMode", () => ({
  useWallMode: () => ({ wall: false, mounted: true }),
}));

const layoutState = vi.hoisted(() => ({
  visibleWidgets: [{ id: "morningBriefing" }],
  orientation: "phone" as const,
  mounted: true,
}));
vi.mock("@/hooks/useHomeLayout", () => ({ useHomeLayout: () => layoutState }));

vi.mock("@/db", () => ({
  db: {
    selectMembersDetailed: () => [],
    selectTodaysEvents: () => [],
    selectTodaysSchedules: () => [],
    gatewayReadStatus: async () => ({ items: [], blocked: false }),
    mealsStore: [],
  },
}));

const briefingState = vi.hoisted(() => ({
  briefing: {
    id: "briefing-empty",
    scopeDate: "2026-09-24",
    acknowledged: true,
    summary: { events: [], tasks: [], meals: [], suggestions: [] },
  },
}));
vi.mock("@/components/briefing/hooks/useMorningBriefing", () => ({
  useMorningBriefing: () => ({
    briefing: briefingState.briefing,
    loading: false,
    ack: vi.fn(async () => true),
    ackError: false,
  }),
  briefingSectionsEmpty: () => true,
}));

vi.mock("@/hooks/useHomeEvents", () => ({ useHomeEvents: () => ({ upcomingImportant: [] }) }));

vi.mock("@/hooks/useAtmosphericTheme", () => ({
  AtmosphericProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAtmosphericTheme: () => ({
    season: "summer",
    holiday: null,
    isNight: false,
    accentColor: "#7c6ff7",
    glowColor: "#7c6ff7",
    bgGradient: "",
    particleEmoji: "",
    atmosphereOpacity: 0,
    bridgeGradient: "",
    bridgeGlow: "",
  }),
}));

vi.mock("@/components/ui/EmergencyButton", () => ({ default: () => null }));

let activeRoot: Root | null = null;

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    activeRoot = createRoot(container);
    activeRoot.render(ui);
  });
  return container;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
}

describe("Home morning briefing slot", () => {
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
  });

  afterEach(() => {
    act(() => activeRoot?.unmount());
    activeRoot = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("keeps an acknowledged empty briefing in the Home slot", async () => {
    const el = await renderAsync(<HomePage />);
    await settle();

    expect(el.textContent).toContain("Morning Briefing");
    expect(el.textContent).toContain("Acknowledged ✓");
    expect(el.querySelector('svg[data-variant="briefing"]')).not.toBeNull();
  });
});
