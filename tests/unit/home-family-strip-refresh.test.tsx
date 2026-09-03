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
vi.mock("next/dynamic", () => {
  const Noop = () => null;
  return { default: () => Noop };
});

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

const rosterMock = vi.hoisted(() => ({ members: [] as any[] }));
vi.mock("@/db", () => ({
  db: {
    selectMembersDetailed: () => rosterMock.members.map((m) => ({ ...m })),
    selectTodaysEvents: () => [],
    selectPendingTasks: () => [],
    selectTodaysSchedules: () => [],
    selectMeals: async () => [],
    mealsStore: [] as any[],
  },
}));

vi.mock("@/components/briefing/hooks/useMorningBriefing", () => ({
  useMorningBriefing: () => ({ briefing: null, loading: false, ack: null, ackError: null }),
  briefingSectionsEmpty: () => true,
}));

const homeEventsMock = vi.hoisted(() => ({ upcomingImportant: [] as any[] }));
vi.mock("@/hooks/useHomeEvents", () => ({ useHomeEvents: () => homeEventsMock }));

const atmosMock = vi.hoisted(() => ({
  theme: {
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
  },
  filterId: "atmos",
  accentRgb: "124, 111, 247",
  colors: { glow: "rgba(124,111,247,0.5)", gradientStop: "#7c6ff7", accentColor: "#7c6ff7" },
}));
vi.mock("@/hooks/useAtmosphericTheme", () => ({
  AtmosphericProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAtmosphericTheme: () => atmosMock,
}));

const layoutMock = vi.hoisted(() => ({
  visibleWidgets: [] as string[],
  orientation: "phone" as const,
  mounted: true,
}));
vi.mock("@/hooks/useHomeLayout", () => ({ useHomeLayout: () => layoutMock }));

vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

const PHOTO = "data:image/webp;base64,UklGRkIZAABXRUJQVlA4WAoAAAAQREBEQA==";

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

describe("Home family strip live roster (consuela-members-updated)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })));
    rosterMock.members = [
      { name: "Rebecca", role: "Parent", emoji: "👩", color: "violet", avatarSize: "md", glow: false },
      { name: "Emily", role: "Child", emoji: "👧", color: "rose", avatarSize: "md", glow: false },
    ];
    mockAuth.currentUser = null;
    mockAuth.isLoggedIn = false;
  });

  afterEach(() => {
    act(() => { activeRoot?.unmount(); });
    activeRoot = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("family strip avatars swap to the new photo after consuela-members-updated fires", async () => {
    const el = await renderAsync(<HomePage />);
    await settle();
    // Strip renders the pre-refresh emoji roster (avatar buttons, no photo <img> yet).
    const stripBtns = Array.from(el.querySelectorAll("button[aria-label^='Sign in as']"));
    expect(stripBtns.length).toBeGreaterThan(0);
    expect(el.querySelector("img")).toBeNull();

    // The 60s roster refresh lands: Emily now has a photo avatar.
    rosterMock.members = rosterMock.members.map((m) =>
      m.name === "Emily" ? { ...m, emoji: PHOTO } : m
    );

    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-members-updated"));
    });
    await settle();

    const img = el.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(PHOTO);
  });
});
