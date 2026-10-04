// @vitest-environment jsdom
//
// Home fold composition — the round-2 critic findings, locked.
//
// Each case below is a defect that was MEASURED on the rendered page, not a
// style opinion:
//
//  1. The header reserved `pr-16` for the fixed Emergency shield on the ROW
//     that also held the greeting, so the greeting inherited the reservation:
//     139px of measure at 390 and 69px at 320 — which split "AUTUMN · SAT," /
//     "OCT 3 — 11:48 PM" across two lines and broke "Rebecca" to "Rebec / a".
//  2. The date eyebrow carried four values (season, weekday, date, clock) in one
//     tracked 12px line and wrapped mid-value.
//  3. `.widget-card` declares `display: flex` in an UNLAYERED rule, which
//     out-ranks Tailwind's `@layer utilities` — so `flex-row`/`grid` on a
//     StatTile lost silently and the compact KPI chip stayed a 178px poster
//     around one digit at every width.
//  4. `DayLine` painted its rail and fill through `.dayline-track` /
//     `.dayline-fill`, class names with NO rule anywhere in the token layer, so
//     an empty day rendered a lone floating NOW dot over nothing.
//  5. The family strip hard-clipped its last avatar with no scroll affordance
//     (492px of content in a 358px scroller at 390, 288px at 320).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement, ReactNode } from "react";

import HomePage from "@/app/page";
import StatTile from "@/components/patterns/StatTile";
import DayLine from "@/components/patterns/DayLine";
import FamilyStrip from "@/components/home/FamilyStrip";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    currentUser: { id: 1, name: "Rebecca (Mom)", role: "parent", emoji: "🧑", color: "amber", avatarSize: "md", glow: false },
    isLoggedIn: true,
    isParent: true,
    logout: vi.fn(),
    sessionRemainingMs: 30 * 60 * 1000,
    sessionWarning: false,
    extendSession: vi.fn(),
    quickLogin: vi.fn(),
  }),
}));
vi.mock("@/hooks/useDashboardMode", () => ({
  useDashboardMode: () => ({ mode: "adult", isBedtime: false, isWeekend: false, currentHour: 12, currentDay: 3, previousMode: null }),
}));
vi.mock("@/db", () => ({
  db: {
    selectMembersDetailed: () => [],
    selectMembers: () => ["Rebecca (Mom)"],
    selectTodaysEvents: () => [],
    selectTodaysSchedules: () => [],
    mealsStore: [] as any[],
    gatewayReadStatus: async () => ({ items: [], blocked: false }),
  },
}));
vi.mock("@/components/briefing/hooks/useMorningBriefing", () => ({
  useMorningBriefing: () => ({ briefing: null, loading: false, ack: null, ackError: null }),
  briefingShowsCard: () => false,
}));
vi.mock("@/hooks/useHomeEvents", () => ({ useHomeEvents: () => ({ upcomingImportant: [] }) }));
vi.mock("@/hooks/useAtmosphericTheme", () => ({
  AtmosphericProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAtmosphericTheme: () => ({
    theme: { season: "autumn", holiday: null, isNight: false },
    accentColor: "#7c6ff7",
    glowColor: "rgba(124,111,247,0.28)",
  }),
}));
vi.mock("@/hooks/useHomeLayout", () => ({ useHomeLayout: () => ({ visibleWidgets: [], orientation: "phone", mounted: true }) }));

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

let activeRoot: Root | null = null;

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { activeRoot = createRoot(el); activeRoot.render(ui); });
  return el;
}
async function settle(ms = 120) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}
function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

/** Every ancestor of `el`, nearest first. */
function ancestors(el: Element): Element[] {
  const out: Element[] = [];
  for (let p = el.parentElement; p; p = p.parentElement) out.push(p);
  return out;
}

describe("Home header: the greeting owns its measure", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })));
  });
  afterEach(() => {
    act(() => { activeRoot?.unmount(); });
    activeRoot = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("the Emergency-shield clearance never sits on an ancestor of the greeting", async () => {
    const el = await renderAsync(<HomePage />);
    await settle();
    const h1 = el.querySelector("h1");
    expect(h1).not.toBeNull();

    // pr-14/pr-16 (56/64px) is the shield reservation. On an ancestor of the
    // greeting it is what squeezed the display serif to 139px at 390.
    for (const a of ancestors(h1!)) {
      const cls = a.getAttribute("class") ?? "";
      expect(cls, `greeting ancestor carries shield clearance: ${cls}`).not.toMatch(/(^|\s)pr-1[46](\s|$)/);
    }
  });

  it("the date eyebrow is one unbreakable run — no mid-value wrap, no second value", async () => {
    const el = await renderAsync(<HomePage />);
    await settle();
    const eyebrow = Array.from(el.querySelectorAll("p")).find((p) => p.className.includes("text-eyebrow") && !p.textContent?.includes(":"));
    expect(eyebrow, "the date eyebrow is missing").toBeTruthy();
    const text = (eyebrow!.textContent ?? "").trim();
    // Exactly two values, one separator: "SUN · OCT 4". The clock and the
    // season word moved off this line — four values in tracked 12px caps is
    // what wrapped it.
    expect(text).toMatch(/^\S+ · \S+ \d{1,2}$/);
    expect(eyebrow!.className).toContain("whitespace-nowrap");
  });

  it("the Events KPI tile carries no fill fraction (a day-elapsed % read as a share of events)", async () => {
    const el = await renderAsync(<HomePage />);
    await settle();
    const label = Array.from(el.querySelectorAll("div")).find((d) => d.textContent === "Events" && d.childElementCount === 0);
    const tile = label?.parentElement;
    expect(tile).toBeTruthy();
    expect(tile!.textContent).not.toMatch(/\d+%/);
  });
});

describe("StatTile: compact KPI chip", () => {
  it("sets `display` inline, because .widget-card's unlayered display:flex out-ranks utilities", () => {
    const el = render(<StatTile label="Events" value={0} detail="Today" compact />);
    const card = el.querySelector(".widget-card") as HTMLElement;
    // A `grid`/`flex-row` utility alone loses to the unlayered `.widget-card`
    // rule; this is the assertion that the tile cannot silently go back to a
    // 178px stacked poster.
    expect(card.style.display).toBe("grid");
  });

  it("keeps value → label → detail as direct siblings, in that order", () => {
    const el = render(<StatTile label="Week" value={3} detail="Days planned" compact />);
    const card = el.querySelector(".widget-card")!;
    const texts = Array.from(card.children)
      .map((c) => (c.textContent ?? "").trim())
      .filter((t) => t !== "");
    expect(texts).toEqual(["3", "Week", "Days planned"]);
    const label = Array.from(card.children).find((c) => c.textContent === "Week")!;
    expect(label.previousElementSibling!.textContent).toBe("3");
  });

  it("draws the base hairline out of flow (in flow it was an 11px rule under a 70px tile)", () => {
    const el = render(<StatTile label="Week" value={3} compact progress={0.5} />);
    const bar = Array.from(el.querySelectorAll("div")).find((d) => d.className.includes("bottom-0"));
    expect(bar).toBeTruthy();
    expect((bar as HTMLElement).className).toContain("absolute");
  });
});

describe("DayLine: the rail is painted, not class-named", () => {
  it("has no CSS rule for the class names it used to depend on", () => {
    // If a future token-layer pass DOES define these, the inline styles below
    // become redundant rather than wrong — this test then tells us to delete.
    expect(css).not.toMatch(/\.dayline-track\b/);
    expect(css).not.toMatch(/\.dayline-fill\b/);
  });

  it("renders a visible rail and a visible consumed fill", () => {
    const el = render(<DayLine progress={0.5} />);
    const painted = Array.from(el.querySelectorAll("div")).filter(
      (d) => (d.getAttribute("style") ?? "").includes("background")
    );
    expect(painted.length).toBeGreaterThanOrEqual(2);
    for (const d of painted) expect(d.getAttribute("style")).toContain("color-mix");
  });
});

describe("FamilyStrip: overflow reads as deliberate", () => {
  const members = [
    { name: "A", color: "green", emoji: "🧑", avatarSize: "md", glow: false },
    { name: "B", color: "cyan", emoji: "🧒", avatarSize: "md", glow: false },
  ];

  function scroller(el: HTMLElement): HTMLElement {
    return el.querySelector("[data-strip-fade]") as HTMLElement;
  }
  const fade = (el: HTMLElement) => el.getAttribute("data-strip-fade");
  /** jsdom reports 0 for every box, so the scroller's metrics are declared. */
  function setMetrics(el: HTMLElement, scrollWidth: number, clientWidth: number, scrollLeft = 0) {
    Object.defineProperty(el, "scrollWidth", { value: scrollWidth, configurable: true });
    Object.defineProperty(el, "clientWidth", { value: clientWidth, configurable: true });
    el.scrollLeft = scrollLeft;
  }

  it("does not fade a roster that fits", () => {
    const el = render(<FamilyStrip members={members} isSelf={() => false} onSelect={() => {}} onSelfProfile={() => {}} />);
    const s = scroller(el);
    setMetrics(s, 200, 358);
    act(() => { s.dispatchEvent(new Event("scroll")); });
    expect(fade(s)).toBe("none");
  });

  it("fades only the edge that still has content behind it", () => {
    const el = render(<FamilyStrip members={members} isSelf={() => false} onSelect={() => {}} onSelfProfile={() => {}} />);
    const s = scroller(el);
    setMetrics(s, 492, 358, 0);
    act(() => { s.dispatchEvent(new Event("scroll")); });
    expect(fade(s)).toBe("right");

    setMetrics(s, 492, 358, 134);
    act(() => { s.dispatchEvent(new Event("scroll")); });
    expect(fade(s)).toBe("left");

    setMetrics(s, 492, 358, 60);
    act(() => { s.dispatchEvent(new Event("scroll")); });
    expect(fade(s)).toBe("both");
  });

  it("every roster circle keeps a 44px tap target", () => {
    const el = render(<FamilyStrip members={members} isSelf={() => false} onSelect={() => {}} onSelfProfile={() => {}} />);
    for (const b of Array.from(el.querySelectorAll("button"))) {
      const cls = b.getAttribute("class") ?? "";
      expect(cls, `sub-44 roster control: ${cls}`).toMatch(/min-h-11/);
    }
  });
});
