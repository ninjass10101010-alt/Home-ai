// @vitest-environment jsdom
// Role-aware session timeouts + the KidHome session controls (Switch member,
// countdown chip) from the 2026-09-20 kid-session lift.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("next/dynamic", () => {
  const Noop = () => null;
  return { default: () => Noop };
});

const mockAuth = vi.hoisted(() => ({
  currentUser: { name: "Caspian Garcia", role: "child", age: 5, emoji: "🧒", color: "cyan" } as any,
  isLoggedIn: true,
  logout: vi.fn(),
  sessionWarning: false,
  sessionRemainingMs: 0,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

const modeMock = vi.hoisted(() => ({ isBedtime: false, isWeekend: false }));
vi.mock("@/hooks/useDashboardMode", () => ({
  useDashboardMode: () => ({ mode: "kid", isBedtime: modeMock.isBedtime, isWeekend: modeMock.isWeekend, currentHour: 12, currentDay: 3, previousMode: null }),
}));

vi.mock("@/db", () => ({
  db: {
    selectMembers: () => [
      { name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", color: "violet", emoji: "👩" },
      { name: "Caspian", fullName: "Caspian Garcia", role: "child", color: "cyan", emoji: "🧒" },
    ],
    selectMembersDetailed: () => [
      { name: "Caspian Garcia", role: "child", emoji: "🧒", color: "cyan", avatarSize: "md", glow: false, age: 5 },
    ],
    selectTodaysEvents: () => [],
    selectMeals: async () => [],
    selectMembersFallback: () => [],
  },
}));

vi.mock("@/lib/task-utils", async () => {
  const actual = await vi.importActual("@/lib/task-utils");
  return { ...actual };
});

vi.mock("@/components/integrations/SpotifyWidget", () => ({ default: () => null }));
vi.mock("@/components/integrations/AllowanceWidget", () => ({ default: () => null }));
vi.mock("@/components/integrations/LearningWidget", () => ({ default: () => null }));
vi.mock("@/components/ui/EmergencyButton", () => ({ default: () => <div data-testid="emergency-button" /> }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));
vi.mock("@/components/leaderboard/WeeklyWinModal", () => ({ default: () => null }));
vi.mock("@/hooks/useAtmosphericTheme", () => ({
  AtmosphericProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAtmosphericTheme: () => ({ theme: {}, filterId: "atmos", accentRgb: "0,0,0", colors: { glow: "", gradientStop: "", accentColor: "" } }),
}));

import KidHome from "@/modes/kid/KidHome";
import { AuthProvider } from "@/hooks/useAuth";

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
async function settle(ms = 100) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} })));
  modeMock.isBedtime = false;
  modeMock.isWeekend = false;
  mockAuth.sessionWarning = false;
  mockAuth.sessionRemainingMs = 0;
  mockAuth.logout.mockClear();
});

afterEach(() => {
  act(() => { activeRoot?.unmount(); });
  activeRoot = null;
});

describe("KidHome session controls", () => {
  it("one-tap 'Switch member' signs out immediately (non-wall)", async () => {
    const el = await renderAsync(<KidHome />);
    await settle();
    const btn = el.querySelector('button[aria-label="Switch member"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    await act(async () => { btn.click(); });
    expect(mockAuth.logout).toHaveBeenCalled();
  });

  it("bedtime hides the Switch member button (calm surface)", async () => {
    modeMock.isBedtime = true;
    const el = await renderAsync(<KidHome />);
    await settle();
    expect(el.querySelector('button[aria-label="Switch member"]')).toBeNull();
  });

  it("shows the countdown chip only while the warning is live", async () => {
    mockAuth.sessionWarning = true;
    mockAuth.sessionRemainingMs = 3 * 60 * 1000;
    const el = await renderAsync(<KidHome />);
    await settle();
    expect(el.textContent).toContain("3 min left");
    mockAuth.sessionWarning = false;
  });

  it("countdown chip hides at bedtime", async () => {
    modeMock.isBedtime = true;
    mockAuth.sessionWarning = true;
    mockAuth.sessionRemainingMs = 3 * 60 * 1000;
    const el = await renderAsync(<KidHome />);
    await settle();
    expect(el.textContent).not.toContain("min left");
  });
});
