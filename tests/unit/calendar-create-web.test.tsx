// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import CalendarPage from "@/app/calendar/page";
import { AtmosphericProvider } from "@/hooks/useAtmosphericTheme";
import { WeatherProvider } from "@/hooks/useWeather";
import { ThemeProvider } from "@/hooks/useTheme";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/calendar",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

const mockAuth = vi.hoisted(() => ({ currentUser: null as any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

const state = vi.hoisted(() => ({ familyRows: [] as any[] }));
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
vi.mock("@/db/gateway-client", () => ({
  gatewayList: async (collection: string) => (collection === "events" ? state.familyRows : []),
}));

let activeRoot: Root | null = null;
let fetchMock: any;

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
      </ThemeProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  return el;
}

function setValue(selector: string, value: string) {
  const input = document.querySelector(selector) as HTMLInputElement;
  if (!input) throw new Error(`missing ${selector}`);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function click(selector: string) {
  const button = document.querySelector(selector) as HTMLElement;
  if (!button) throw new Error(`missing ${selector}`);
  button.click();
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

function callFor(method: string, path: string) {
  const hit = fetchMock.mock.calls.find(([url, init]: [any, any]) => {
    const target = String(url);
    return target.includes(path) && String((init as RequestInit | undefined)?.method ?? "GET") === method;
  });
  expect(hit).toBeTruthy();
  return hit![1] as RequestInit;
}

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
  state.familyRows = [];
  mockAuth.currentUser = { id: 1, name: "Rebecca (Mom)", role: "parent" };
  mockAuth.isLoggedIn = true;
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET");
    if (url.includes("/api/google-calendar")) {
      return jsonResponse({ ok: true, connected: true, stale: false, events: [] });
    }
    if (/\/api\/calendar\/events\/[^/]+\/retry-google$/.test(url) && method === "POST") {
      return jsonResponse({
        ok: true,
        event: {
          id: "e1", title: "Dentist", date: todayISO(), time: "09:00", endTime: "10:00",
          allDay: false, member: "All", source: "family", googleSyncStatus: "synced",
        },
        google: { status: "synced", eventId: "g1" },
      });
    }
    if (/\/api\/calendar\/events\/[^/]+$/.test(url) && method === "PATCH") {
      return jsonResponse({
        ok: true,
        event: {
          id: "e1", title: "Dentist", date: tomorrowISO(), time: "09:00", endTime: "10:00",
          allDay: false, member: "All", source: "family", googleSyncStatus: "pending",
        },
        google: { status: "pending" },
      });
    }
    if (url.includes("/api/calendar/events") && method === "POST") {
      return jsonResponse({
        ok: true,
        event: {
          id: "e1", title: "Dentist", date: tomorrowISO(), time: "09:00", endTime: "10:00",
          allDay: false, member: "All", source: "family", googleSyncStatus: "pending",
        },
        google: { status: "pending" },
      }, 201);
    }
    return jsonResponse({ ok: true, events: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (activeRoot) {
    await act(async () => {
      activeRoot!.unmount();
    });
    activeRoot = null;
  }
  document.body.innerHTML = "";
});

describe("web calendar create/edit gate and API contract", () => {
  it("shows Add only to a parent", async () => {
    mockAuth.currentUser = { id: 1, name: "Rebecca (Mom)", role: "parent" };
    const parentEl = await renderCalendar();
    expect(parentEl.querySelector('[data-testid="calendar-add-button"]')).toBeTruthy();

    mockAuth.currentUser = { id: 2, name: "Aurora", role: "child" };
    const childEl = await renderCalendar();
    expect(childEl.querySelector('[data-testid="calendar-add-button"]')).toBeNull();
    expect(childEl.textContent).toContain("Ask a parent to add or change events.");
  });

  it("creates through the parent route and renders the pending Google chip", async () => {
    const el = await renderCalendar();
    click('[data-testid="calendar-add-button"]');
    setValue("#ev-title", "Dentist");
    setValue("#ev-date", tomorrowISO());
    setValue("#ev-start", "09:00");
    setValue("#ev-end", "10:00");
    click('[data-testid="calendar-save-event"]');
    await settle();

    const init = callFor("POST", "/api/calendar/events");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      title: "Dentist",
      date: tomorrowISO(),
      startTime: "09:00",
      endTime: "10:00",
      allDay: false,
      member: "All",
    });
    expect(el.textContent).toContain("Google pending");
    expect(el.textContent).toContain("Retry");
  });

  it("retries a pending mirror through the retry route", async () => {
    const el = await renderCalendar();
    click('[data-testid="calendar-add-button"]');
    setValue("#ev-title", "Dentist");
    click('[data-testid="calendar-save-event"]');
    await settle();
    click(".ev-sync-chip");
    await settle();
    const init = callFor("POST", "/api/calendar/events/e1/retry-google");
    expect(init).toBeTruthy();
    expect(el.textContent).not.toContain("Google pending");
  });

  it("sends the edited date in the PATCH body", async () => {
    state.familyRows = [{
      id: "e1", title: "Dentist", date: todayISO(), time: "09:00", endTime: "10:00",
      allDay: false, member: "All", source: "family", googleSyncStatus: "pending",
    }];
    const el = await renderCalendar();
    click('button[aria-label="Edit Dentist"]');
    setValue("#ev-date", tomorrowISO());
    click('[data-testid="calendar-save-event"]');
    await settle();

    const init = callFor("PATCH", "/api/calendar/events/e1");
    expect(JSON.parse(String(init.body)).date).toBe(tomorrowISO());
  });

  it("reconciles a row deleted on another device", async () => {
    state.familyRows = [{
      id: "e1", title: "Dentist", date: todayISO(), time: "09:00", source: "family",
    }];
    const el = await renderCalendar();
    expect(el.textContent).toContain("Dentist");
    state.familyRows = [];
    window.dispatchEvent(new Event("consuela-data-refreshed"));
    await settle();
    expect(el.textContent).not.toContain("Dentist");
  });

  it("never renders a raw provider error", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({
      ok: false,
      message: "Google Calendar couldn't save this event.",
    }, 503));
    const el = await renderCalendar();
    click('[data-testid="calendar-add-button"]');
    setValue("#ev-title", "Dentist");
    click('[data-testid="calendar-save-event"]');
    await settle();
    expect(el.textContent).toContain("Google Calendar couldn't save this event.");
    expect(el.textContent).not.toMatch(/composio|api[_ -]?key|secret/i);
  });
});
