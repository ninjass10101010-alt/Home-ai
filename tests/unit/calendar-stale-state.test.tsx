// @vitest-environment jsdom
//
// Task 12 — a stale Google read must never masquerade as a live one.
//
// `/api/google-calendar` answers with `stale:true` when the rows it can offer
// are saved rather than freshly synced (no active connection, or the sync
// itself failed). The page only read `connected`, so a connected-but-stale
// response took the success path: it replaced the on-screen rows and cleared
// the status line, presenting cached school events as current.
//
// The three answers this file pins:
//   - not connected (even with `stale:true`) -> drop Google rows and tell the
//     family who can connect it;
//   - connected + `stale:true`               -> KEEP the saved rows and say
//     they are saved and not refreshing right now;
//   - a failed read (`ok:false`)             -> stays unavailable, rows are
//     not thrown away, and the server's raw error string never reaches a user.
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

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

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
vi.mock("@/db/gateway-client", () => ({ gatewayList: async () => [] }));

let activeRoot: Root | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

/** A previously synced school row, exactly as the page saves it. */
function savedGoogleEvent() {
  const now = new Date();
  return {
    id: "g_school-1_1_1_2026_9:00 AM",
    title: "Saved school assembly",
    time: "9:00 AM",
    member: "Google",
    color: "cyan",
    emoji: "\uD83D\uDCC5",
    day: now.getDate(),
    month: now.getMonth(),
    year: now.getFullYear(),
  };
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
  // Flush the mount load, which the page defers behind setTimeout(0).
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
  return el;
}

function stubGoogle(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  fetchMock.mockImplementation(async (url: any) => {
    if (String(url).startsWith("/api/google-calendar")) {
      return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body } as any;
    }
    return { ok: true, status: 200, json: async () => ({}) } as any;
  });
}

function text(el: HTMLElement): string {
  return (el.textContent || "").replace(/\s+/g, " ");
}

/** The status line's copy, or "" when the honest state is "say nothing". */
function statusLine(el: HTMLElement): string {
  const node = el.querySelector('[data-testid="calendar-google-status"]');
  return node ? (node.textContent || "").replace(/\s+/g, " ") : "";
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
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  if (activeRoot) act(() => activeRoot!.unmount());
  activeRoot = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Task 12 — stale Google rows are never shown as current", () => {
  beforeEach(() => {
    mockAuth.currentUser = { name: "Alex", role: "parent" };
    localStorage.setItem("consuela-events", JSON.stringify([savedGoogleEvent()]));
  });

  it("not connected + stale: drops the saved Google rows and addresses the parent directly", async () => {
    stubGoogle({ ok: true, connected: false, source: "none", stale: true, events: [] });
    const el = await renderCalendar();
    expect(text(el)).not.toContain("Saved school assembly");
    expect(statusLine(el)).toMatch(/school events aren't on the calendar yet/i);
    expect(statusLine(el)).toContain("connect Google Calendar in Settings \u2192 Connections & System");
    expect(statusLine(el)).not.toMatch(/a parent can connect/i);
  });

  it("not connected + child: asks a parent and names the corrected Settings path", async () => {
    mockAuth.currentUser = { name: "Sam", role: "child" };
    stubGoogle({ ok: true, connected: false, source: "none", stale: true, events: [] });
    const el = await renderCalendar();
    expect(text(el)).not.toContain("Saved school assembly");
    expect(statusLine(el)).toContain(
      "a parent can connect Google Calendar in Settings \u2192 Connections & System",
    );
    expect(statusLine(el)).not.toContain("yet \u2014 connect Google Calendar");
  });

  it("connected + stale: keeps the saved Google rows and says they are not refreshing", async () => {
    stubGoogle({ ok: true, connected: true, stale: true, source: "google", events: [] });
    const el = await renderCalendar();
    expect(text(el)).toContain("Saved school assembly");
    expect(statusLine(el)).toMatch(/showing saved school events/i);
    expect(statusLine(el)).toMatch(/not refreshing right now/i);
  });

  it("a failed read stays unavailable, keeps rows, and never echoes the server error", async () => {
    stubGoogle(
      { ok: false, stale: true, error: "GOOGLE_TOKEN_REFRESH blew up in token-store" },
      { ok: false, status: 502 },
    );
    const el = await renderCalendar();
    expect(statusLine(el)).toMatch(/couldn.t reach/i);
    expect(statusLine(el)).not.toMatch(/showing saved/i);
    expect(text(el)).not.toContain("GOOGLE_TOKEN_REFRESH");
    expect(text(el)).not.toContain("token-store");
    // A failed refresh does not throw away the rows already on screen.
    expect(text(el)).toContain("Saved school assembly");
  });
});
