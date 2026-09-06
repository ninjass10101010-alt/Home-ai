// @vitest-environment jsdom
// Calendar glass refresh — Task 2 (JSX): the grid card's month title replays
// the calendarMonthSettle animation on every month change (key remount), and
// a horizontal day strip renders inside the grid card driving the SAME
// selectedDay state as the grid cells (shared selection contract).
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

vi.mock("@/db/gateway-client", () => ({
  gatewayList: async () => [],
}));

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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

function stripSelected(el: HTMLElement): Element[] {
  return Array.from(el.querySelectorAll(".calendar-strip-day.is-selected"));
}

function gridSelected(el: HTMLElement): Element[] {
  return Array.from(el.querySelectorAll(".calendar-day-btn.is-selected"));
}

describe("calendar glass refresh — month title + day strip", () => {
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

  it("month title carries is-animating and re-runs the settle on month change (keyed remount)", async () => {
    const today = new Date();
    const el = await renderCalendar();

    const titleBefore = el.querySelector("h2.calendar-month-title")!;
    expect(titleBefore).toBeTruthy();
    expect(titleBefore.classList.contains("is-animating")).toBe(true);
    expect(titleBefore.textContent).toContain(MONTHS[today.getMonth()]);

    const nextBtn = el.querySelector('button[aria-label="Next month"]') as HTMLButtonElement;
    await act(async () => { nextBtn.click(); });

    const titleAfter = el.querySelector("h2.calendar-month-title")!;
    const nextMonthIdx = (today.getMonth() + 1) % 12;
    expect(titleAfter.classList.contains("is-animating")).toBe(true);
    expect(titleAfter.textContent).toContain(MONTHS[nextMonthIdx]);
    // The key on `${year}-${month}` remounts the node so the CSS settle replays.
    expect(titleAfter).not.toBe(titleBefore);
  });

  it("renders a day strip with exactly one selected day matching selectedDay (today initially)", async () => {
    const today = new Date();
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const el = await renderCalendar();

    const strip = el.querySelector(".calendar-day-strip-wrap .calendar-day-strip");
    expect(strip).toBeTruthy();
    expect(strip!.getAttribute("role")).toBe("group");
    expect(strip!.getAttribute("aria-label")).toBe("Jump to day");

    const days = Array.from(strip!.querySelectorAll("button.calendar-strip-day"));
    expect(days.length).toBe(daysInMonth);
    for (const btn of days) {
      expect(btn.querySelector(".wd")).toBeTruthy();
      expect(btn.querySelector(".num")).toBeTruthy();
    }

    const selected = stripSelected(el);
    expect(selected.length).toBe(1);
    expect(selected[0].querySelector(".num")!.textContent).toBe(String(today.getDate()));
    expect(selected[0].getAttribute("aria-pressed")).toBe("true");
    expect(selected[0].getAttribute("aria-label")).toBe(`${MONTHS[today.getMonth()]} ${today.getDate()}`);
  });

  it("clicking a strip day updates the shared selectedDay — the grid cell gets is-selected too", async () => {
    const today = new Date();
    const target = today.getDate() === 1 ? 2 : 1;
    const el = await renderCalendar();

    const stripBtn = Array.from(el.querySelectorAll(".calendar-strip-day"))
      .find((b) => b.querySelector(".num")?.textContent === String(target)) as HTMLButtonElement;
    expect(stripBtn).toBeTruthy();
    await act(async () => { stripBtn.click(); });

    // The strip moved its selection...
    const stripSel = stripSelected(el);
    expect(stripSel.length).toBe(1);
    expect(stripSel[0].querySelector(".num")!.textContent).toBe(String(target));
    expect(stripSel[0].getAttribute("aria-pressed")).toBe("true");

    // ...and the grid shows the SAME day selected — one shared state, no parallel state.
    const gridSel = gridSelected(el);
    expect(gridSel.length).toBe(1);
    expect(gridSel[0].querySelector(".calendar-day-number")!.textContent).toBe(String(target));

    // Selection stays within the current month: title unchanged by the strip tap.
    expect(el.querySelector("h2.calendar-month-title")!.textContent).toContain(MONTHS[today.getMonth()]);
  });
});
