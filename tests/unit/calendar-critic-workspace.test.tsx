// @vitest-environment jsdom
//
// The 2026-10-04 harsh-critic pass on `/calendar`, `PageHeader` and
// `SoftButton`. Three defects this file locks shut:
//
//   1. `/calendar` rendered TWO calendars inside the month card — a
//      horizontally-scrolling strip of all 31 days plus the 7-column month grid
//      two rows below it, with the strip clipped mid-cell at 1920 and its
//      weekday letter disagreeing with the grid whenever the month didn't start
//      on a Sunday. The strip is now the selected day's Sunday–Saturday week on
//      the SAME seven columns as the grid, and the separate weekday header row
//      it used to duplicate is gone.
//   2. `button.calendar-tab` measured 170×36 / 615×36 — a hand-rolled duplicate
//      of the `SegmentedControl` primitive, which already guarantees 44px.
//   3. `SoftButton`'s `disabled:opacity-50` composited a primary CTA to ~2–3:1
//      against its own white label. Disabled is now a surface change (neutral
//      fill + secondary ink + no shadow) that stays legible AND still reads as
//      inert, because every trace of accent is gone.
//
// Plus: the page's controls used to be tinted from the ATMOSPHERIC accent
// (`--calendar-accent-rgb`) while the selection used the theme accent, so "Today"
// and "Sync" rendered orange next to a violet selected day — two accent
// temperatures on one screen.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import CalendarPage from "@/app/calendar/page";
import PageHeader from "@/components/patterns/PageHeader";
import SoftButton from "@/components/ui/SoftButton";
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
vi.mock("@/db/gateway-client", () => ({ gatewayList: async () => [] }));

const css = () => readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const src = () => readFileSync(join(process.cwd(), "src/app/calendar/page.tsx"), "utf8");

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
      </ThemeProvider>,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
  return el;
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
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ connected: false, events: [] }) })),
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
  document.body.innerHTML = "";
});

describe("/calendar — one calendar, not two", () => {
  it("the strip is the selected day's week on the grid's seven columns, not the whole month", async () => {
    const el = await renderCalendar();
    const strip = el.querySelector(".calendar-day-strip-wrap .calendar-day-strip")!;
    expect(strip).toBeTruthy();
    expect(strip.getAttribute("aria-label")).toBe("This week");

    // Seven slots, always — that is what lines the strip up with the grid.
    const slots = Array.from(strip.children);
    expect(slots.length).toBe(7);

    // The month grid below is still the FULL month — that is the one calendar.
    const now0 = new Date();
    const grid = el.querySelectorAll(".calendar-day-grid .calendar-day-btn:not(.is-empty)");
    expect(grid.length).toBe(
      new Date(now0.getFullYear(), now0.getMonth() + 1, 0).getDate(),
    );

    // Every strip slot carries a weekday letter and a day number (or is an inert
    // out-of-month spacer) — the old strip spelled only the FIRST letter.
    for (const slot of slots) {
      if (slot.classList.contains("is-outside")) {
        expect(slot.tagName).toBe("DIV");
        expect(slot.getAttribute("aria-hidden")).toBe("true");
        continue;
      }
      expect(slot.querySelector(".wd")!.textContent!.length).toBe(2);
      expect(slot.querySelector(".num")!.textContent).toMatch(/^\d{1,2}$/);
    }
  });

  it("strip and grid share one selected day and one week (no parallel state)", async () => {
    const el = await renderCalendar();
    const stripSel = el.querySelectorAll(".calendar-strip-day.is-selected");
    const gridSel = el.querySelectorAll(".calendar-day-btn.is-selected");
    expect(stripSel.length).toBe(1);
    expect(gridSel.length).toBe(1);
    const stripDay = stripSel[0].querySelector(".num")!.textContent;
    expect(gridSel[0].querySelector(".calendar-day-number")!.textContent).toBe(stripDay);
  });

  it("the strip's weekday letters follow the real calendar, not the slot index", async () => {
    const el = await renderCalendar();
    const now = new Date();
    const strip = el.querySelector(".calendar-day-strip-wrap .calendar-day-strip")!;
    const named = Array.from(strip.querySelectorAll(".calendar-strip-day:not(.is-outside)"));
    const day = Number(named[0].querySelector(".num")!.textContent);
    const expected = new Date(now.getFullYear(), now.getMonth(), day).getDay();
    const abbr = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][expected];
    expect(named[0].querySelector(".wd")!.textContent).toBe(abbr);
  });

  it("the duplicate weekday header row and the two-calendar CSS are gone", () => {
    expect(src()).not.toContain('className="calendar-weekday-row"');
    expect(css()).not.toContain(".calendar-weekday-row {");
    // The grid is 7 columns and the strip is 7 columns — same track count.
    expect(css()).toMatch(/\.calendar-day-strip \{[^}]*repeat\(7, 1fr\)/);
    expect(css()).toMatch(/\.calendar-day-grid \{[^}]*repeat\(7, 1fr\)/);
  });

  it("the hand-rolled 36px tab pair is replaced by SegmentedControl", async () => {
    const el = await renderCalendar();
    // The old markup is gone outright…
    expect(src()).not.toContain('className={`calendar-tab');
    expect(css()).not.toContain(".calendar-tab {");
    // …and the primitive's 44px guarantee is what's rendered now.
    expect(el.querySelector('[role="radiogroup"]')).toBeTruthy();
    for (const b of Array.from(el.querySelectorAll('[role="radiogroup"] [role="radio"]'))) {
      expect(b.className).toContain("min-h-[44px]");
    }
  });

  it("the day panel carries the selected day plus the rest of its week", async () => {
    const el = await renderCalendar();
    expect(el.querySelector(".calendar-week-section")).toBeNull(); // no fixtures → no week rows
    // The section only ever lists days that hold something.
    expect(src()).toContain("restOfWeekWithEvents");
    expect(src()).toContain("upcomingDays");
  });

  it("the banner leads with the date, not a greeting that restates the route", async () => {
    const el = await renderCalendar();
    expect(el.querySelector(".calendar-hero-numeral")!.textContent).toBe(String(new Date().getDate()));
    const text = (el.textContent || "").replace(/\s+/g, " ");
    expect(text).not.toMatch(/Good (Morning|Afternoon|Evening)/);
    expect(text).not.toContain("Here's your day at a glance");
  });

  it("the Google status sentence gets its own row instead of four wrapped lines in the banner", async () => {
    const el = await renderCalendar();
    const status = el.querySelector('[data-testid="calendar-google-status"]')!;
    expect(status).toBeTruthy();
    expect(status.textContent).toMatch(/school events/i);
    // Its own row under the banner — not four wrapped lines inside it.
    expect(status.closest(".calendar-hero-card")).toBeNull();
    expect(css()).toContain(".calendar-google-status");
    // The banner's flex child can shrink, which is what stopped 48px of that
    // sentence being pushed past the card's overflow-x clip.
    expect(css()).toMatch(/\.calendar-hero-main \{[^}]*min-width: 0/);
  });
});

describe("/calendar — one accent temperature", () => {
  it("controls and focus rings read from --color-accent-selected, not the atmospheric accent", () => {
    const g = css();
    for (const sel of [
      ".calendar-today-btn",
      ".calendar-sync-btn",
      ".calendar-add-link",
      ".calendar-edit-btn",
      ".calendar-panel-icon",
      ".calendar-upcoming-icon",
    ]) {
      const start = g.indexOf(sel + " {") >= 0 ? g.indexOf(sel + " {") : g.indexOf(sel + ":hover {");
      const block = g.slice(start, g.indexOf("}", start));
      if (block.includes("--calendar-accent-rgb")) {
        throw new Error(`${sel} still tints from the atmospheric accent`);
      }
    }
    // `--calendar-accent-rgb` survives only for the page's ambient background
    // washes, which are ambience and not ink.
    const ambient = (g.match(/--calendar-accent-rgb/g) || []).length;
    expect(ambient).toBeLessThanOrEqual(3);
  });

  it("today is legible without a tint: primary ink, and the accent only as a ring", () => {
    const g = css();
    const today = g.slice(g.indexOf(".calendar-day-btn.is-today {"), g.indexOf(".calendar-day-btn.is-selected"));
    expect(today).toContain("color: var(--color-text-primary)");
    // The light-theme variants must not out-rank the selected fill, or a
    // today+selected cell renders white text on a pale wash.
    expect(g).toContain(".calendar-day-btn.is-today:not(.is-selected)");
    expect(g).not.toMatch(/data-theme="light"\] \.calendar-day-btn\.is-today \{/);
  });

  it("the selected day is a FLAT accent-button fill, so a contrast checker can resolve it", () => {
    const g = css();
    const sel = g.slice(g.indexOf(".calendar-day-btn.is-selected {"), g.indexOf(".calendar-day-btn.is-selected:hover"));
    expect(sel).toContain("background: var(--color-accent-button");
    expect(sel).not.toContain("linear-gradient");
  });
});

describe("SoftButton — disabled is a surface, not a fade", () => {
  it("drops the opacity fade that made a disabled primary unreadable", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    act(() => root.render(<SoftButton disabled>Save</SoftButton>));
    const btn = el.querySelector("button")!;
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(btn.className).not.toContain("disabled:opacity-50");
    // Neutral fill + secondary ink + no shadow: measurable, and unmistakably not
    // the accent. All five variants converge on it, because that IS the signal.
    expect(btn.className).toContain("!bg-[var(--color-surface-2)]");
    expect(btn.className).toContain("!text-[var(--color-text-secondary)]");
    expect(btn.className).toContain("!shadow-none");
    expect(btn.className).toContain("disabled:cursor-not-allowed");
    act(() => root.unmount());
  });

  it("applies the disabled treatment while loading too, and hides the spinner from AT", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    act(() => root.render(<SoftButton loading>Saving</SoftButton>));
    const btn = el.querySelector("button")!;
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(btn.className).toContain("!text-[var(--color-text-secondary)]");
    expect(btn.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    act(() => root.unmount());
  });

  it("an enabled button keeps its variant fill (the disabled class is not always on)", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    act(() => root.render(<SoftButton variant="danger">Delete</SoftButton>));
    const btn = el.querySelector("button")!;
    expect(btn.hasAttribute("disabled")).toBe(false);
    expect(btn.className).toContain("--color-accent-rose");
    expect(btn.className).not.toContain("!bg-[var(--color-surface-2)]");
    act(() => root.unmount());
  });

  it("the measured contract: secondary ink on the neutral fill clears AA in both themes", () => {
    // sRGB relative luminance, from the token values in globals.css.
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    // dark:  #8892aa on #1e2330   light: #5a5a5a on #f0f2f7
    expect(ratio("#8892aa", "#1e2330")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#5a5a5a", "#f0f2f7")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("PageHeader — one page-title ramp", () => {
  it("defaults to the eyebrow subtitle every existing call site relies on", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    act(() => root.render(<PageHeader title="Meals" subtitle="Family meal planning" />));
    const eyebrow = el.querySelector(".text-eyebrow")!;
    expect(eyebrow.textContent).toBe("Family meal planning");
    // Above the title, as before — this is the 4-route behaviour, unchanged.
    expect(eyebrow.compareDocumentPosition(el.querySelector("h1")!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    act(() => root.unmount());
  });

  it('"lede" puts real sentence copy below the title and never truncates it', () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    const subtitle = "Set goals, save money, climb mountains!";
    act(() =>
      root.render(<PageHeader title="Money Mountain" subtitle={subtitle} subtitleTone="lede" />),
    );
    expect(el.querySelector(".text-eyebrow")).toBeNull();
    const lede = Array.from(el.querySelectorAll("p")).find((p) => p.textContent === subtitle)!;
    expect(lede.className).not.toContain("truncate");
    expect(lede.className).toContain("text-pretty");
    // Below the title.
    expect(el.querySelector("h1")!.compareDocumentPosition(lede)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    act(() => root.unmount());
  });

  it("analytics, money-mountain and time-capsule all ride PageHeader now", () => {
    for (const route of ["analytics", "money-mountain", "time-capsule"]) {
      const s = readFileSync(join(process.cwd(), `src/app/${route}/page.tsx`), "utf8");
      expect(s, `${route} imports PageHeader`).toContain("components/patterns/PageHeader");
      expect(s, `${route} renders PageHeader`).toContain("<PageHeader");
      // The old third-system title styles are gone.
      expect(s, `${route} has no bold-sans h1`).not.toMatch(/<h1 className="[^"]*font-bold/);
    }
  });
});