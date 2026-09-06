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
