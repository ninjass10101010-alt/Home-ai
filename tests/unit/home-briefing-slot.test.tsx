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
    summary: {
      events: unknown[];
      tasks: unknown[];
      meals: unknown[];
      suggestions: unknown[];
      taskSource?: string;
    } | null;
  },
  // Audit P0-4: the slot must keep a card, and name the failure, when the read fails.
  failure: null as null | "offline" | "unauthorised" | "error",
  stale: false,
  retrying: false,
  emptySections: true,
  // The remediation's emptiness rule, as a CONTROLLABLE input. It used to be
  // derived from `emptySections` here, which re-derived the very composition
  // this file exists to pin — and modelled neither half of it: the real
  // `briefingShowsCard` also admits a briefing whose chore list is unavailable.
  showsCard: true,
}));

// How many times the slot/widget asked "is there anything to show or admit?".
// The failure path must never ask, so the new cases can assert the ordering
// rather than infer it from whether a card happened to render.
const briefingShowsCardSpy = vi.hoisted(() => vi.fn());

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
  // read one of them; dropping either makes this file fail to load, which is
  // itself the pin that both sides of the merge survived. `briefingSectionsEmpty`
  // still decides the widget's own empty-vs-failure card; `briefingShowsCard`
  // decides the slot's collapse and is a plain controllable value, never a
  // re-derivation of the other.
  briefingSectionsEmpty: () => briefingState.emptySections,
  briefingShowsCard: (briefing: unknown) => {
    briefingShowsCardSpy(briefing);
    return briefingState.showsCard;
  },
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
    briefingState.showsCard = true;
    briefingShowsCardSpy.mockClear();
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
    // Nothing to show and nothing to admit, so the remediation's rule collapses
    // the slot even though the briefing is acknowledged.
    briefingState.showsCard = false;

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

  // The merge composition itself. `briefingShowsCard` is the remediation's
  // emptiness rule; audit P0-4's rule is that a failed read keeps a card. The
  // merged slot must consult the first ONLY when there is no failure, so a
  // hostile `false` can never swallow the failure card again.
  it("a false briefingShowsCard never suppresses the P0-4 failure card", async () => {
    // A briefing that exists but has no summary: the real `briefingSectionsEmpty`
    // and `briefingShowsCard` agree with all three of these values, so the only
    // hostile input is the guard itself — which isolates the fault to where the
    // guard sits. A null `briefing` would instead return early for the "no
    // briefing" reason and pass even with the gate hoisted.
    briefingState.briefing = {
      id: "briefing-no-summary",
      scopeDate: "2026-09-28",
      acknowledged: false,
      summary: null,
    };
    briefingState.failure = "error";
    briefingState.emptySections = true;
    briefingState.showsCard = false;   // the emptiness check is hostile

    const el = await renderAsync(<HomePage />);
    await settle();

    expect(el.textContent).toContain("Morning Briefing");
    expect(el.textContent).toContain("Morning briefing:");
    expect(el.textContent).toContain("Showing your saved copy");
    expect(
      Array.from(el.querySelectorAll("button")).some((b) => b.textContent?.includes("Try again")),
    ).toBe(true);
    // The strongest form of the pin: on the failure path the emptiness rule is
    // not merely outranked, it is never evaluated — so no reordering of the
    // guards can hide the card behind it.
    expect(briefingShowsCardSpy).not.toHaveBeenCalled();
  });

  it("a successful read with nothing to admit still collapses the slot", async () => {
    briefingState.briefing = {
      id: "briefing-full",
      scopeDate: "2026-09-28",
      acknowledged: false,
      summary: { events: [{ title: "School" }], tasks: [], meals: [], suggestions: [] },
    };
    briefingState.failure = null;
    briefingState.emptySections = false;
    briefingState.showsCard = false;   // honest emptiness, no failure to excuse it

    const el = await renderAsync(<HomePage />);
    await settle();

    // The emptiness check is still wired in — deleting it to make the failure
    // case pass would render this card again.
    expect(briefingShowsCardSpy).toHaveBeenCalled();
    expect(el.textContent).not.toContain("Morning Briefing");
    expect(el.querySelector('svg[data-variant="briefing"]')).toBeNull();
  });
});
