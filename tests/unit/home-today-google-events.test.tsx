// @vitest-environment jsdom
// Bug (user report 2026-09-18): today's all-day Google event "Bailey & Emily
// at home!" (start 2026-09-18 → end 2026-09-21) does not appear in Home's
// "Today" calendar widget. Root cause: the widget's todayEvents read only the
// family `events` collection via db.selectTodaysEvents() — Google-synced rows
// (consuela_google_calendar_events) were never merged into this surface (the
// 2026-09-15 multi-day coverage fix touched the Calendar page, chat tools,
// planner, and screensaver, but not Home). The widget must merge Google rows
// covering TODAY via the shared googleEventCoversDay contract.
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

const familyMock = vi.hoisted(() => ({ events: [] as any[] }));
vi.mock("@/db", () => ({
  db: {
    selectMembersDetailed: () => [],
    selectTodaysEvents: () => familyMock.events.map((e) => ({ ...e })),
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

vi.mock("@/hooks/useHomeEvents", () => ({
  useHomeEvents: () => ({ todayEvents: [], upcomingImportant: [], loading: false, error: null }),
}));

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
  visibleWidgets: [{ id: "todayEvents" }] as any[],
  orientation: "phone" as const,
  mounted: true,
}));
vi.mock("@/hooks/useHomeLayout", () => ({ useHomeLayout: () => layoutMock }));

vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

function localISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function dayFromNow(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return localISO(d);
}

const googleStub = vi.hoisted(() => ({ rows: [] as any[], fail: false, unavailable: false }));

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

async function settle(ms = 150) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

function expectTodayWidgetIcon(root: HTMLElement) {
  const slot = Array.from(root.querySelectorAll("div")).find(
    (div) => div.className.includes("absolute") && div.className.includes("z-30") && div.className.includes("pointer-events-none")
  );
  if (!slot) throw new Error("Today widget icon slot not found");
  expect(slot.querySelector('svg[data-variant="events"]')).not.toBeNull();
  expect(slot.textContent).not.toContain("📅");
}

describe("Home Today widget — Google Calendar events merged in", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.unstubAllGlobals();
    familyMock.events = [];
    googleStub.rows = [];
    googleStub.fail = false;
    googleStub.unavailable = false;
    mockAuth.currentUser = null;
    mockAuth.isLoggedIn = false;
    vi.stubGlobal("fetch", vi.fn(async (input: any) => {
      if (String(input).startsWith("/api/google-calendar")) {
        if (googleStub.unavailable) {
          return {
            ok: false,
            status: 503,
            json: async () => ({ ok: false, code: "unavailable", error: "Google token state unavailable" }),
          };
        }
        if (googleStub.fail) throw new Error("offline");
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, events: googleStub.rows, calendar_colors: {} }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows today's all-day Google event (Bailey & Emily at home!) in the Today widget", async () => {
    googleStub.rows = [{
      google_id: "n91ml7zsw3n5xzi",
      summary: "Bailey & Emily at home!",
      start_iso: dayFromNow(0),   // starts TODAY
      end_iso: dayFromNow(3),     // all-day exclusive end
      all_day: true,
      calendar_id: "primary",
    }];
    const el = await renderAsync(<HomePage />);
    await settle();
    expect(el.textContent).toContain("Bailey & Emily at home!");
    expect(el.textContent).toContain("1 event on the family calendar");
    expect(el.textContent).not.toContain("Quiet day");
    expectTodayWidgetIcon(el);
  });

  it("shows a multi-day Google event on a middle day (coverage, not just the start day)", async () => {
    googleStub.rows = [{
      google_id: "g-mid",
      summary: "Cabin weekend",
      start_iso: dayFromNow(-1),  // started YESTERDAY
      end_iso: dayFromNow(1),     // exclusive end tomorrow → covers today
      all_day: true,
      calendar_id: "primary",
    }];
    const el = await renderAsync(<HomePage />);
    await settle();
    expect(el.textContent).toContain("Cabin weekend");
  });

  it("orders all-day rows ahead of timed rows", async () => {
    familyMock.events = [
      { id: "f1", title: "Piano lesson", time: "9:00 AM", member: "Rebecca", color: "amber", icon: "🎹" },
    ];
    googleStub.rows = [{
      google_id: "g-allday",
      summary: "Bailey & Emily at home!",
      start_iso: dayFromNow(0),
      end_iso: dayFromNow(3),
      all_day: true,
      calendar_id: "primary",
    }];
    const el = await renderAsync(<HomePage />);
    await settle();
    const text = el.textContent || "";
    const googleIdx = text.indexOf("Bailey & Emily at home!");
    const familyIdx = text.indexOf("Piano lesson");
    expect(googleIdx).toBeGreaterThanOrEqual(0);
    expect(familyIdx).toBeGreaterThanOrEqual(0);
    expect(googleIdx).toBeLessThan(familyIdx);
  });

  it("keeps previously loaded Google rows when a later Google read is unavailable", async () => {
    googleStub.rows = [{
      google_id: "g-saved",
      summary: "Saved Google event",
      start_iso: dayFromNow(0),
      end_iso: dayFromNow(1),
      all_day: true,
      calendar_id: "primary",
    }];
    const el = await renderAsync(<HomePage />);
    await settle();
    expect(el.textContent).toContain("Saved Google event");

    googleStub.unavailable = true;
    await act(async () => {
      window.dispatchEvent(new Event("consuela-data-refreshed"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(el.textContent).toContain("Saved Google event");
    expect(el.textContent).toContain("Google Calendar is unavailable");
    expect(el.textContent).not.toContain("Quiet day");
  });

  it("re-filters cached Google events at local midnight when refresh is unavailable", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-24T12:00:00") });
    googleStub.rows = [{
      google_id: "g-midnight",
      summary: "Yesterday's event",
      start_iso: "2026-09-24",
      end_iso: "2026-09-25",
      all_day: true,
      calendar_id: "primary",
    }];
    const el = await renderAsync(<HomePage />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(el.textContent).toContain("Yesterday's event");

    vi.setSystemTime(new Date("2026-09-25T00:05:00"));
    googleStub.unavailable = true;
    await act(async () => {
      window.dispatchEvent(new Event("consuela-data-refreshed"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(el.textContent).not.toContain("Yesterday's event");
    expect(el.textContent).toContain("Google Calendar is unavailable");
    vi.useRealTimers();
  });

  it("ignores a Google response that started before disconnect", async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: any) => {
      if (String(input).startsWith("/api/google-calendar")) {
        return {
          ok: true,
          status: 200,
          json: async () => pending as any,
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }));
    const el = await renderAsync(<HomePage />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-google-disconnected"));
      release({
        ok: true,
        events: [{ google_id: "late", summary: "Late Google Event", start_iso: dayFromNow(0), end_iso: dayFromNow(1), all_day: true }],
      });
      await Promise.resolve();
    });
    await settle();

    expect(el.textContent).not.toContain("Late Google Event");
  });

  it("keeps family events when the Google read fails", async () => {
    familyMock.events = [
      { id: "f1", title: "Family dinner", time: "6:00 PM", member: "Rebecca", color: "amber", icon: "🍽️" },
    ];
    googleStub.fail = true;
    const el = await renderAsync(<HomePage />);
    await settle();
    expect(el.textContent).toContain("Family dinner");
    expect(el.textContent).not.toContain("Quiet day");
  });
});
