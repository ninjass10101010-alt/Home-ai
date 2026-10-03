// @vitest-environment jsdom
//
// Bug 1 (P1) — kids and guests never saw school events.
//
// `/calendar` is `ALL_ROLES`, but its ONLY Google load used `?sync=now`, which
// `/api/google-calendar` answers behind the parent gate. A child, guest or pet
// therefore got a 401 on every mount and a permanently blank calendar — no
// error, no explanation, no school events. The route's plain GET is session
// scoped for exactly this reason ("Plain GET remains session-scoped for
// product calendar events").
//
// The fix keeps the parent gate where it earns its keep: `sync=now` (a fresh
// pull from Google) stays parent-only, and the Sync button that triggers it is
// parent-only. The READ happens for everyone.
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

// The page selects today, so the school row has to land on today to be on screen.
const TODAY = new Date().toLocaleString("en-CA", { timeZone: "America/Detroit" }).split(",")[0];

const SCHOOL_EVENT = {
  google_id: "school-1",
  summary: "School assembly",
  calendar_id: "school@example.org",
};

/**
 * A school event authored at 09:00 in a -07:00 calendar. The page selects
 * TODAY, so the row is stamped with today's local day — 09:00 Pacific is
 * 12:00 in the family's zone, which is the shared time rule under test.
 */
function schoolEventToday() {
  return {
    ...SCHOOL_EVENT,
    start_iso: `${TODAY}T09:00:00-07:00`,
    end_iso: `${TODAY}T10:00:00-07:00`,
  };
}
function connectedBody() {
  return {
    ok: true,
    connected: true,
    calendar_colors: { "school@example.org": "#616161" },
    events: [schoolEventToday()],
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

/** Every URL the page asked for. */
function requestedUrls(): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0]));
}

function text(el: HTMLElement): string {
  return (el.textContent || "").replace(/\s+/g, " ");
}

const EVERY_ROLE: Array<[string, string]> = [
  ["parent", "parent"],
  ["child", "child"],
  ["guest", "guest"],
  ["pet", "pet"],
];

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
  fetchMock = vi.fn(async (url: any) => {
    if (String(url).startsWith("/api/google-calendar")) {
      return { ok: true, status: 200, json: async () => connectedBody() } as any;
    }
    return { ok: true, status: 200, json: async () => ({}) } as any;
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  if (activeRoot) act(() => activeRoot!.unmount());
  activeRoot = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Bug 1 — every role reads the school calendar", () => {
  for (const [label, role] of EVERY_ROLE) {
    it(`a ${label} loads Google via the UNGATED read path`, async () => {
      mockAuth.currentUser = { name: label, role };
      await renderCalendar();
      const urls = requestedUrls();
      expect(urls.some((u) => u.startsWith("/api/google-calendar"))).toBe(true);
      expect(urls.every((u) => !u.includes("sync=now"))).toBe(true);
    });

    it(`a ${label} sees the school event on screen`, async () => {
      mockAuth.currentUser = { name: label, role };
      const el = await renderCalendar();
      expect(text(el)).toContain("School assembly");
      // And in the family's timezone, per the shared time rule.
      expect(text(el)).toContain("12:00 PM");
    });
  }
});

describe("Bug 1 — the parent gate is kept where it earns its keep", () => {
  it("a parent gets a Sync control that pulls fresh from Google (sync=now)", async () => {
    mockAuth.currentUser = { name: "Alex", role: "parent" };
    const el = await renderCalendar();
    const sync = Array.from(el.querySelectorAll("button")).find((b) =>
      (b.textContent || "").includes("Sync"),
    );
    expect(sync).toBeDefined();
    expect(sync!.hasAttribute("disabled")).toBe(false);
    fetchMock.mockClear();
    await act(async () => {
      (sync as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(requestedUrls().some((u) => u.includes("sync=now"))).toBe(true);
  });

  for (const [label, role] of EVERY_ROLE.filter(([, role]) => role !== "parent")) {
    it(`a ${label} is offered no Sync control at all (no dead control)`, async () => {
      mockAuth.currentUser = { name: label, role };
      const el = await renderCalendar();
      const sync = Array.from(el.querySelectorAll("button")).find((b) =>
        (b.textContent || "").includes("Sync"),
      );
      expect(sync).toBeUndefined();
    });
  }
});

describe("Bug 1 — an honest, non-alarming state instead of a silent blank", () => {
  for (const [label, role] of EVERY_ROLE) {
    it(`a ${label} is told the calendar isn't connected, and who can connect it`, async () => {
      mockAuth.currentUser = { name: label, role };
      fetchMock.mockImplementation(async (url: any) => {
        if (String(url).startsWith("/api/google-calendar")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, connected: false, source: "none", events: [] }),
          } as any;
        }
        return { ok: true, status: 200, json: async () => ({}) } as any;
      });
      const el = await renderCalendar();
      const body = text(el);
      expect(body).toMatch(/school events/i);
      expect(body).toMatch(/parent/i);
      expect(body).toMatch(/settings/i);
      // Non-alarming: no alarm semantics on a not-connected calendar.
      expect(body).not.toMatch(/error|failed|✗|❌/i);
    });

    it(`a ${label} is told when the calendar read itself failed`, async () => {
      mockAuth.currentUser = { name: label, role };
      fetchMock.mockImplementation(async (url: any) => {
        if (String(url).startsWith("/api/google-calendar")) {
          return { ok: false, status: 500, json: async () => ({ ok: false, error: "boom" }) } as any;
        }
        return { ok: true, status: 200, json: async () => ({}) } as any;
      });
      const el = await renderCalendar();
      const body = text(el);
      expect(body).toMatch(/couldn.t reach|could not reach/i);
      expect(body).toMatch(/school calendar/i);
    });
  }

  it("says NOTHING when the calendar is connected and simply has no events today", async () => {
    mockAuth.currentUser = { name: "Alex", role: "parent" };
    fetchMock.mockImplementation(async (url: any) => {
      if (String(url).startsWith("/api/google-calendar")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, connected: true, events: [] }),
        } as any;
      }
      return { ok: true, status: 200, json: async () => ({}) } as any;
    });
    const el = await renderCalendar();
    const body = text(el);
    expect(body).not.toMatch(/school events/i);
    expect(body).not.toMatch(/couldn.t reach/i);
  });

  it("never renders the server's raw error string to a user", async () => {
    mockAuth.currentUser = { name: "Alex", role: "parent" };
    fetchMock.mockImplementation(async (url: any) => {
      if (String(url).startsWith("/api/google-calendar")) {
        return {
          ok: false,
          status: 502,
          json: async () => ({ ok: false, error: "GOOGLE_TOKEN_REFRESH blew up in token-store" }),
        } as any;
      }
      return { ok: true, status: 200, json: async () => ({}) } as any;
    });
    const el = await renderCalendar();
    expect(text(el)).not.toContain("GOOGLE_TOKEN_REFRESH");
    expect(text(el)).not.toContain("token-store");
  });
});