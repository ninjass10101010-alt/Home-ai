// @vitest-environment jsdom
// Wave 2 Task 1 — the Calendar chip roster snapshot must never render a
// fabricated family in production. Same gate as the server roster
// (src/lib/member-fallback.ts canonicalMemberFallbacksEnabled()): the 7-name
// DEFAULT_CALENDAR_MEMBERS list is a non-production opt-in only, so an
// unavailable PocketBase resolves to an EMPTY chip strip (the page's hardcoded
// "All" chip still renders).
//
// Also pins the consumer contract: with zero members the /calendar page renders
// without crashing and shows no invented names.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import CalendarPage from "@/app/calendar/page";
import { AtmosphericProvider } from "@/hooks/useAtmosphericTheme";
import { WeatherProvider } from "@/hooks/useWeather";
import { ThemeProvider } from "@/hooks/useTheme";
import {
  DEFAULT_CALENDAR_MEMBERS,
  getClientMembersSnapshot,
  getServerMembersSnapshot,
  resetClientMembersSnapshotForTests,
  subscribeMembersSnapshot,
} from "@/lib/calendar-member-snapshot";
import { NEXT_PUBLIC_CANONICAL_MEMBER_FALLBACKS } from "@/lib/member-fallback";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/calendar",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

// PocketBase unavailable: the live roster read yields only the "All" chip the
// db layer always prepends. No family members reach the snapshot.
const rosterMock = vi.hoisted(() => ({
  members: [] as any[],
}));
vi.mock("@/db", () => ({
  db: {
    selectMembersForCalendar: () => rosterMock.members.map((m) => ({ ...m })),
    insertEvent: async () => null,
    updateEvent: async () => null,
    deleteEvent: async () => false,
    insertSchedule: async () => null,
    updateSchedule: async () => null,
    deleteSchedule: async () => false,
  },
}));

vi.mock("@/db/gateway-client", () => ({
  gatewayList: async () => [],
}));

const FABRICATED_NAMES = DEFAULT_CALENDAR_MEMBERS.map((m) => m.name).filter(
  (name) => name !== "All"
);

let activeRoot: Root | null = null;

async function renderCalendar(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    activeRoot = createRoot(el);
    activeRoot.render(
      <ThemeProvider>
        <WeatherProvider>
          <AtmosphericProvider>
            <CalendarPage />
          </AtmosphericProvider>
        </WeatherProvider>
      </ThemeProvider>
    );
  });
  return el;
}

function chipNames(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll(".calendar-member-chip")).map((chip) =>
    (chip.lastElementChild?.textContent ?? "").trim()
  );
}

describe("calendar member snapshot — production fallback gate", () => {
  afterEach(() => {
    resetClientMembersSnapshotForTests();
    vi.unstubAllEnvs();
  });

  it("production renders an EMPTY snapshot, never the fabricated roster", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(NEXT_PUBLIC_CANONICAL_MEMBER_FALLBACKS, undefined);

    expect(getServerMembersSnapshot()).toEqual([]);
    expect(getClientMembersSnapshot()).toEqual([]);
    for (const name of FABRICATED_NAMES) {
      expect(getServerMembersSnapshot().map((m) => m.name)).not.toContain(name);
    }
  });

  it("production ignores the opt-in env — the gate is not user-overridable", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(NEXT_PUBLIC_CANONICAL_MEMBER_FALLBACKS, "true");

    expect(getServerMembersSnapshot()).toEqual([]);
    expect(getClientMembersSnapshot()).toEqual([]);
  });

  it("production keeps the snapshot identity stable (useSyncExternalStore safety)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(NEXT_PUBLIC_CANONICAL_MEMBER_FALLBACKS, undefined);

    // A fresh array per call would loop useSyncExternalStore forever; both
    // branches must hand back the same module-level reference.
    expect(getServerMembersSnapshot()).toBe(getServerMembersSnapshot());
    expect(getClientMembersSnapshot()).toBe(getClientMembersSnapshot());
    expect(getServerMembersSnapshot()).toBe(getClientMembersSnapshot());
  });

  it("resetClientMembersSnapshotForTests re-honors the gate", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(NEXT_PUBLIC_CANONICAL_MEMBER_FALLBACKS, undefined);
    resetClientMembersSnapshotForTests();
    expect(getClientMembersSnapshot()).toEqual([]);

    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(NEXT_PUBLIC_CANONICAL_MEMBER_FALLBACKS, "true");
    resetClientMembersSnapshotForTests();
    expect(getClientMembersSnapshot()).toBe(DEFAULT_CALENDAR_MEMBERS);
  });

  it("positive control: a non-production opt-in still gets the fallback roster", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(NEXT_PUBLIC_CANONICAL_MEMBER_FALLBACKS, "true");

    expect(getServerMembersSnapshot()).toBe(DEFAULT_CALENDAR_MEMBERS);
    expect(DEFAULT_CALENDAR_MEMBERS[0]).toEqual({
      name: "All",
      color: "green",
      emoji: "👨‍👩‍👧‍👦",
    });
  });

  it("positive control: non-production WITHOUT the opt-in gets the empty roster", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(NEXT_PUBLIC_CANONICAL_MEMBER_FALLBACKS, undefined);

    expect(getServerMembersSnapshot()).toEqual([]);
  });
});

describe("calendar page — zero members", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    if (!window.matchMedia) {
      (window as any).matchMedia = (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      });
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ connected: false }) }))
    );
    // Production, no opt-in, PocketBase answering with only the "All" row.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(NEXT_PUBLIC_CANONICAL_MEMBER_FALLBACKS, undefined);
    rosterMock.members = [{ name: "All", color: "green", emoji: "👨‍👩‍👧‍👦" }];
    resetClientMembersSnapshotForTests();
    mockAuth.currentUser = null;
    mockAuth.isLoggedIn = false;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (activeRoot) {
      await act(async () => {
        activeRoot!.unmount();
      });
      activeRoot = null;
    }
    vi.unstubAllEnvs();
  });

  it("renders the page with an 'All' chip only — no crash, no invented names", async () => {
    const el = await renderCalendar();

    // The month grid still rendered — the page did not blow up on [].
    expect(el.querySelector(".calendar-month-title")).toBeTruthy();

    const chips = chipNames(el);
    expect(chips).toEqual(["All"]);
    for (const name of FABRICATED_NAMES) {
      expect(chips).not.toContain(name);
    }
  });
});
