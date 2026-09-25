// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import CalendarPage from "@/app/calendar/page";
import { AtmosphericProvider } from "@/hooks/useAtmosphericTheme";
import { WeatherProvider } from "@/hooks/useWeather";
import { ThemeProvider } from "@/hooks/useTheme";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/calendar",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

vi.mock("@/db", () => ({
  db: {
    selectMembersForCalendar: () => [],
    insertEvent: async () => null,
    updateEvent: async () => null,
    deleteEvent: async () => false,
    insertSchedule: async () => null,
    updateSchedule: async () => null,
    deleteSchedule: async () => false,
  },
}));

const server = vi.hoisted(() => ({ events: [] as any[] }));

vi.mock("@/db/gateway-client", () => ({
  gatewayList: async () => server.events.map((r) => ({ ...r })),
}));

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
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function todayISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

describe("Calendar page cross-device refresh", () => {
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
    server.events = [];
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
  });

  it("ignores a Google response that started before disconnect", async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: any) => {
      if (String(input).includes("/api/google-calendar")) {
        return { ok: true, status: 200, json: async () => pending as any };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }));
    const el = await renderAsync(
      <ThemeProvider>
        <WeatherProvider>
          <AtmosphericProvider>
            <CalendarPage />
          </AtmosphericProvider>
        </WeatherProvider>
      </ThemeProvider>
    );
    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-google-disconnected"));
      release({
        ok: true,
        connected: true,
        events: [{ google_id: "late", summary: "Late Google Event", start_iso: new Date().toISOString(), end_iso: new Date().toISOString(), all_day: true }],
      });
      await Promise.resolve();
    });
    await settle();

    expect(el.textContent).not.toContain("Late Google Event");
  });

  it("labels retained Google rows as stale after a partial refresh", async () => {
    localStorage.setItem("consuela-events", JSON.stringify([
      { id: "g-stale", title: "Stale Google Event", time: "All day", member: "Google", day: new Date().getDate(), month: new Date().getMonth(), year: new Date().getFullYear() },
    ]));
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({ ok: false, partial: true, stale: true, error: "calendar_partial_failure" }),
    })));

    const el = await renderAsync(
      <ThemeProvider>
        <WeatherProvider>
          <AtmosphericProvider>
            <CalendarPage />
          </AtmosphericProvider>
        </WeatherProvider>
      </ThemeProvider>
    );
    await settle();

    expect(el.textContent).toContain("Stale Google Event");
    expect(el.textContent).toContain("Google Calendar unavailable — showing saved events");
  });

  it("removes cached Google events when the direct grant is disconnected", async () => {
    localStorage.setItem("consuela-events", JSON.stringify([
      { id: "g-stale", title: "Stale Google Event", time: "All day", member: "Google", day: new Date().getDate(), month: new Date().getMonth(), year: new Date().getFullYear() },
    ]));

    const el = await renderAsync(
      <ThemeProvider>
        <WeatherProvider>
          <AtmosphericProvider>
            <CalendarPage />
          </AtmosphericProvider>
        </WeatherProvider>
      </ThemeProvider>
    );
    await settle();

    expect(el.textContent).not.toContain("Stale Google Event");
  });

  it("merges another device's event when consuela-data-refreshed fires", async () => {
    const el = await renderAsync(
      <ThemeProvider>
        <WeatherProvider>
          <AtmosphericProvider>
            <CalendarPage />
          </AtmosphericProvider>
        </WeatherProvider>
      </ThemeProvider>
    );
    await settle();
    expect(el.textContent).not.toContain("Phone Party XYZ");

    // Another device adds an event for today; the server list now has it.
    server.events = [
      { id: "pb_ev9", title: "Phone Party XYZ", date: todayISO(), time: "6:00 PM", member: "All" },
    ];
    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
    });
    await settle();

    expect(el.textContent).toContain("Phone Party XYZ");
  });
});
