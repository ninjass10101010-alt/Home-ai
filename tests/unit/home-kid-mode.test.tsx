// @vitest-environment jsdom
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

// Faithful-enough next/dynamic for the test: resolve the loader and render it
// (the real one lazy-loads; ssr:false is irrelevant under jsdom).
vi.mock("next/dynamic", async () => {
  const { useEffect, useState } = await import("react");
  return {
    default: (loader: () => Promise<{ default: any }>) => {
      return function DynamicComp() {
        const [Comp, setComp] = useState<any>(null);
        useEffect(() => {
          let alive = true;
          loader().then((m) => { if (alive) setComp(() => m.default); });
          return () => { alive = false; };
        }, []);
        return Comp ? <Comp /> : null;
      };
    },
  };
});

vi.mock("@/components/ui/FogBackground", () => ({ default: () => null }));
vi.mock("@/modes/kid/KidHome", () => ({
  default: () => <div data-testid="kid-home-marker">KID HOME</div>,
}));

const modeMock = vi.hoisted(() => ({ mode: "family" }));
vi.mock("@/hooks/useDashboardMode", () => ({
  useDashboardMode: () => ({ mode: modeMock.mode, isBedtime: false, isWeekend: false, currentHour: 12, currentDay: 3, previousMode: null }),
}));

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false, isParent: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ ...mockAuth, logout: vi.fn(), sessionRemainingMs: 30 * 60 * 1000, sessionWarning: false, extendSession: vi.fn() }) }));

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

describe("Home branches on dashboard mode", () => {
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
    modeMock.mode = "family";
    mockAuth.currentUser = null;
    mockAuth.isLoggedIn = false;
    mockAuth.isParent = false;
  });

  afterEach(() => {
    act(() => { activeRoot?.unmount(); });
    activeRoot = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("renders KidHome instead of the family bento when mode is kid", async () => {
    modeMock.mode = "kid";
    mockAuth.currentUser = { name: "Caspian", role: "child" };
    mockAuth.isLoggedIn = true;
    const el = await renderAsync(<HomePage />);
    await settle();
    expect(el.querySelector('[data-testid="kid-home-marker"]')).not.toBeNull();
    // The family bento must NOT render for kids.
    expect(el.textContent).not.toContain("Days planned");
    expect(el.textContent).not.toContain("Plan Meals");
  });

  it("renders the family bento (no KidHome) for family and adult modes", async () => {
    for (const mode of ["family", "adult"] as const) {
      modeMock.mode = mode;
      const el = await renderAsync(<HomePage />);
      await settle();
      expect(el.querySelector('[data-testid="kid-home-marker"]')).toBeNull();
      expect(el.textContent).toContain("Days planned");
      act(() => { activeRoot?.unmount(); activeRoot = null; });
      document.body.innerHTML = "";
    }
  });
});
