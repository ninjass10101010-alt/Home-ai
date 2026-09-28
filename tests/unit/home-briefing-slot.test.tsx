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
  } as null | {
    id: string;
    scopeDate: string;
    acknowledged: boolean;
    summary: { events: unknown[]; tasks: unknown[]; meals: unknown[]; suggestions: unknown[] };
  },
  // Audit P0-4: the slot must keep a card, and name the failure, when the read fails.
  failure: null as null | "offline" | "unauthorised" | "error",
  stale: false,
  retrying: false,
  emptySections: true,
}));
vi.mock("@/components/briefing/hooks/useMorningBriefing", () => ({
  useMorningBriefing: () => ({
    briefing: briefingState.briefing,
    loading: false,
    ack: vi.fn(async () => true),
    ackError: false,
    failure: briefingState.failure,
    stale: briefingState.stale,
    retrying: briefingState.retrying,
    retry: vi.fn(),
  }),
  // BOTH predicates are exported by the merged hook and the slot/widget each
  // read one of them; dropping either makes this file fail to load. Until the
  // dedicated `showsCard` flag lands (Task 7), `briefingShowsCard` is the
  // complement of `emptySections` — i.e. "something to show, nothing to admit".
  briefingSectionsEmpty: () => briefingState.emptySections,
  briefingShowsCard: () => !briefingState.emptySections,
  briefingTaskSourceNote: () => null,
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
    briefingState.briefing = {
      id: "briefing-empty",
      scopeDate: "2026-09-24",
      acknowledged: true,
      summary: { events: [], tasks: [], meals: [], suggestions: [] },
    };
    briefingState.failure = null;
    briefingState.stale = false;
    briefingState.retrying = false;
    briefingState.emptySections = true;
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

  it("does not add a grid slot for an acknowledged empty briefing", async () => {
    const el = await renderAsync(<HomePage />);
    await settle();

    expect(el.textContent).not.toContain("Morning Briefing");
    expect(el.textContent).not.toContain("Acknowledged ✓");
    expect(el.querySelector('svg[data-variant="briefing"]')).toBeNull();
    const bentoGrid = Array.from(el.querySelectorAll<HTMLElement>("div")).find(
      (node) => node.className.includes("grid-cols-1") && node.className.includes("gap-6") && !node.className.includes("grid-cols-3")
    );
    expect(bentoGrid).toBeTruthy();
    expect(bentoGrid?.children).toHaveLength(0);
  });

  it("keeps the slot and names the failure when the briefing read fails (audit P0-4)", async () => {
    briefingState.briefing = null;
    briefingState.failure = "error";

    const el = await renderAsync(<HomePage />);
    await settle();

    expect(el.textContent).toContain("Morning Briefing");
    expect(el.textContent).toContain("Morning briefing: Couldn't load this right now.");
    const retry = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("Try again"));
    expect(retry).toBeTruthy();
  });

  it("calls an old briefing a saved copy instead of passing it as today's", async () => {
    briefingState.failure = "error";
    briefingState.stale = true;

    const el = await renderAsync(<HomePage />);
    await settle();

    expect(el.textContent).toContain("Morning Briefing");
    expect(el.textContent).toContain("Showing your saved copy");
    expect(el.textContent).not.toContain("What Consuela lined up for today");
  });
});
