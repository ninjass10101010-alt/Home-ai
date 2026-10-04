// @vitest-environment jsdom
// CapsuleNav chrome contracts — the dock is the app's ONLY navigation surface, so
// the three defects pinned here are the ones that made it read as a row of cheap
// outlined buttons instead of a shipped control. They are all *measured* defects,
// and all three are invisible to jsdom (which reports 0x0 rects), so each one is
// pinned against the source of truth rather than a rendered box.
//
//   C1 (the edge that was never drawn). `--border-frost-1/2` are BORDER
//       SHORTHANDS — `1px solid rgba(255,255,255,0.14)` — not colours. The dock
//       inlined them (`border: 1px solid var(--border-frost-2)`,
//       `border-color: var(--border-frost-1)`), which is a declaration the browser
//       DROPS. Measured in Chromium: `border-top-width: 0px` on the bar (the glass
//       had no boundary, and page content read straight through it) and a 1px ring
//       at 100% `--color-text-primary` on all seven IDLE caps — `rgb(240,244,255)`
//       on Night, `rgb(26,26,26)` on Day — seven hard outlines louder than the
//       active state they were meant to sit behind. The dock now draws both
//       hairlines from colour-only custom properties derived from
//       `--color-text-primary`, the one token that inverts with the theme.
//
//   C2 (the glyph was a speck). The glyph inherited a 24-in-56 ratio (`3/7`),
//       which at 320px left a 17.5px mark marooned inside a 40.8px ring. It is now
//       half its circle at every width.
//
//   C3 (the dock never said where you were). The active pill expands by putting
//       its label in a `0fr → 1fr` grid column, and seven 44px caps plus their
//       spacers leave no slack for it: measured visible width of that column was
//       2.1px at 320px, 2.2px at 390px and 4.0px at 480px — every iPhone width
//       showed seven icons and never named the section. Below 560px the dock names
//       it in a caption row inside the same capsule, and the pill stops pretending
//       to expand so all seven circles share one pixel-exact grid. Above 560px,
//       and on the wall, the expanding pill is unchanged.
//
// 560px is the measured breakpoint, not a guess: above 480px the bar's cap is
// pinned at its 56px maximum, so the active label's column is exactly
// `100vw − 478px`, and `Calendar` (the longest of the seven) needs 62px including
// its padding. 540px gives it 62px — zero margin, one font metric from
// truncation. 560px gives it 68px.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const navState = vi.hoisted(() => ({ path: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => navState.path,
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));
const wallState = vi.hoisted(() => ({ wall: false }));
vi.mock("@/hooks/useWallMode", () => ({ useWallMode: () => wallState }));
const mockUseAuth = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useAuth", () => ({ useAuth: mockUseAuth }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

import CapsuleNav, { GEOMETRY } from "@/components/ui/CapsuleNav";

const SRC = join(process.cwd(), "src");
const CAPSULE = readFileSync(join(SRC, "components/ui/CapsuleNav.tsx"), "utf8");
const GLOBALS = readFileSync(join(SRC, "app/globals.css"), "utf8");
const CODE = CAPSULE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

let root: Root | null = null;
function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => root!.render(ui));
  return el;
}

const PARENT = {
  hydrated: true,
  currentUser: { id: 1, name: "Jeffery", role: "parent", emoji: "👨", color: "#fff", pin: "1234" },
};

beforeEach(() => {
  mockUseAuth.mockReturnValue(PARENT);
  wallState.wall = false;
  navState.path = "/";
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("C1: the dock's hairlines are colours, not the border-frost SHORTHANDS", () => {
  it("never inlines a --border-frost-* token (the browser drops those declarations)", () => {
    // `--border-frost-1/2` are `1px solid rgba(…)`. Used as a `border` shorthand or
    // a `border-color`, that whole string is an invalid value, the declaration is
    // discarded, and the property falls back — to nothing on the bar, and to
    // `currentColor` on the caps. Both shipped that way.
    expect(CODE, "the dock must not consume a border shorthand as a colour").not.toMatch(
      /border-frost-/,
    );
  });

  it("gives the bar a real 1px edge from a colour-only custom property", () => {
    const bar = render(<CapsuleNav />).querySelector(".capsule-nav") as HTMLElement;
    // A shorthand that is only `1px solid <colour>` — width, style and colour.
    expect(bar.style.border).toMatch(/^1px solid var\(--capsule-edge-ink\)$/);
    expect(GLOBALS).toMatch(
      /--capsule-edge-ink:\s*color-mix\(in srgb, var\(--color-text-primary\)\s*\d+%,\s*transparent\)/,
    );
  });

  it("gives every idle cap a hairline ring, not a 100%-ink outline", () => {
    const caps = Array.from(render(<CapsuleNav />).querySelectorAll<HTMLElement>("nav button"));
    const idle = caps.filter((c) => c.getAttribute("aria-current") !== "page");
    expect(idle).toHaveLength(6);
    for (const cap of idle) {
      const ring = cap.querySelector("span") as HTMLElement;
      expect(ring.className, "an idle cap must name the dock's ring token").toContain(
        "var(--capsule-ring)",
      );
      // Hover is a real state on a real pointer, so it gets a real step.
      expect(ring.className).toContain("group-hover:border-[var(--capsule-ring-hover)]");
    }
    const active = caps.find((c) => c.getAttribute("aria-current") === "page")!;
    expect((active.querySelector("span") as HTMLElement).className).toContain(
      "border-transparent",
    );
    expect(GLOBALS).toMatch(
      /--capsule-ring:\s*color-mix\(in srgb, var\(--color-text-primary\)\s*\d+%,\s*transparent\)/,
    );
  });

  it("fills the active pill with the flat sheen, not a ramp that fades to nothing", () => {
    const caps = Array.from(render(<CapsuleNav />).querySelectorAll<HTMLElement>("nav button"));
    const active = caps.find((c) => c.getAttribute("aria-current") === "page")!;
    // 20% → 6% put the pill's right end ~2% off the bar, i.e. invisible, so the
    // label sat on bare glass inside an outline. One flat tint fills the lozenge.
    expect(active.style.background).toBe("var(--color-nav-active-sheen)");
    expect(CODE).not.toMatch(/linear-gradient\(135deg, var\(--color-nav-active-sheen\)/);
  });
});

describe("C2: the glyph fills half its circle at every width", () => {
  // Structural, not a second CSS evaluator: the ratio IS the contract, and
  // `capsule-nav-legibility.test.tsx` already resolves these expressions at
  // fifteen widths to prove the glyph fits its circle and never drops below the
  // type floor. Browser-measured glyph px, before → after:
  //   320: 17.5 → 20.4 · 360: 18.5 → 21.6 · 390: 18.9 → 22.0 · 428: 19.9 → 23.3
  //   480+: 24.0 → 28.0 (the cap's 56px maximum)
  it("is exactly half the circle — the old 3/7 ratio left a speck in the ring", () => {
    expect(GEOMETRY["--capsule-glyph"]).toBe("calc(var(--capsule-circle) / 2)");
  });

  it("keeps the wall glyph at 36px in a 72px circle — the same half", () => {
    wallState.wall = true;
    const caps = Array.from(render(<CapsuleNav />).querySelectorAll<HTMLElement>("nav button"));
    for (const cap of caps) {
      const glyph = cap.querySelector("span span") as HTMLElement;
      expect(glyph.className, "the wall glyph is 36px, not 32px").toContain("h-9 w-9");
    }
    wallState.wall = false;
  });

  it("never lets the wall label fall back to the phone's 16px", () => {
    wallState.wall = true;
    const caps = Array.from(render(<CapsuleNav />).querySelectorAll<HTMLElement>("nav button"));
    for (const cap of caps) {
      const label = cap.querySelector(".capsule-label-text") as HTMLElement;
      // 18px on a wall read from across a room; 16px was the body floor, i.e. no
      // distance scaling at all on the surface the family reads from furthest.
      expect(label.className).toContain("text-lg");
      expect(label.className).not.toContain("text-base");
    }
    wallState.wall = false;
  });

  it("centres the wall label instead of gluing it to its own icon", () => {
    wallState.wall = true;
    const caps = Array.from(render(<CapsuleNav />).querySelectorAll<HTMLElement>("nav button"));
    for (const cap of caps) {
      const label = cap.querySelector(".capsule-label-text") as HTMLElement;
      // `pr-4` was the pill's end-cap; on the wall it pushed every label 16px from
      // the next cap and 4px from its own circle, so the row skewed right.
      expect(label.className, "symmetric padding on the wall").toContain("px-2.5");
      expect(label.className).not.toMatch(/\bpr-4\b/);
    }
    wallState.wall = false;
  });
});

describe("C3: below the label breakpoint the dock names where you are", () => {
  it("renders a caption carrying the active item's label, and an accent tab", () => {
    navState.path = "/meals";
    const el = render(<CapsuleNav />);
    const caption = el.querySelector(".capsule-caption");
    expect(caption?.textContent).toBe("Meals");
    expect(el.querySelector(".capsule-heading")).not.toBeNull();
    expect(el.querySelector(".capsule-tick")).not.toBeNull();
  });

  it("follows the route — the caption is derived, never a second manifest", () => {
    for (const [path, label] of [
      ["/", "Home"],
      ["/tasks", "Tasks"],
      ["/calendar", "Calendar"],
      ["/settings", "Settings"],
      ["/settings/me", "Settings"],
      ["/meals", "Meals"],
    ] as const) {
      navState.path = path;
      const el = render(<CapsuleNav />);
      expect(el.querySelector(".capsule-caption")?.textContent, path).toBe(label);
    }
  });

  it("is aria-hidden: the active cap already carries that string + aria-current", () => {
    navState.path = "/tasks";
    const el = render(<CapsuleNav />);
    expect(el.querySelector(".capsule-heading")?.getAttribute("aria-hidden")).toBe("true");
    expect(el.querySelector(".capsule-tick")?.getAttribute("aria-hidden")).toBe("true");
    const active = el.querySelector('nav button[aria-current="page"]')!;
    expect(active.getAttribute("aria-label")).toBe("Tasks");
    // Exactly ONE element in the dock announces the name.
    expect(el.querySelectorAll(".capsule-caption")).toHaveLength(1);
  });

  it("withdraws entirely where the pill has room, so the name is never shown twice", () => {
    expect(GLOBALS).toMatch(/@media \(min-width: 560px\) \{\s*\.capsule-heading,\s*\.capsule-tick \{\s*display: none;/);
    // …and below it the pill stops expanding, so all seven circles share a grid.
    expect(GLOBALS).toMatch(
      /@media \(max-width: 559\.98px\) \{[\s\S]*?--capsule-col-active: var\(--capsule-cap\) 0fr;/,
    );
    // The active cap's column is the switch, never a JS branch.
    expect(CODE).toContain("var(--capsule-col-active)");
    expect(CODE).toContain("var(--capsule-col-idle)");
  });

  it("has no caption and no tab on the wall — the wall already labels all seven", () => {
    wallState.wall = true;
    const el = render(<CapsuleNav />);
    expect(el.querySelector(".capsule-caption")).toBeNull();
    expect(el.querySelector(".capsule-tick")).toBeNull();
    wallState.wall = false;
  });

  it("says nothing when no cap is active rather than guessing a section", () => {
    // /meals/archive is a standalone destination in OWN_DESTINATION_ROUTES: the
    // Meals cap must not light up, so the dock has no name to give.
    navState.path = "/meals/archive";
    const el = render(<CapsuleNav />);
    expect(el.querySelector('nav button[aria-current="page"]')).toBeNull();
    expect(el.querySelector(".capsule-caption")).toBeNull();
  });

  it("positions the tab from the active index, so the browser owns the slide", () => {
    navState.path = "/calendar";
    const bar = render(<CapsuleNav />).querySelector(".capsule-nav") as HTMLElement;
    expect(bar.style.getPropertyValue("--capsule-index")).toBe("4");
    // Arithmetic, not measurement — and `left`/`bottom` resolve against the PADDING
    // box, so the 1px border must not be added back (it put the tab 1px right of
    // every circle's centre before this was measured).
    expect(GLOBALS).toMatch(/left: calc\(var\(--capsule-pad\) \+ var\(--capsule-cap\) \/ 2\)/);
    expect(GLOBALS).toMatch(
      /translate: calc\(var\(--capsule-index\) \* \(var\(--capsule-cap\) \+ var\(--capsule-gap\)\) - 50%\) 0/,
    );
  });

  it("honours reduced motion: the caption and the tab stop moving, and stay visible", () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{\s*\.capsule-item,\s*\.capsule-item \.capsule-label-text,\s*\.capsule-caption,\s*\.capsule-tick \{\s*transition: none !important;\s*animation: none !important;/.test(
      GLOBALS,
    );
    expect(block, "caption + tab must be in the reduced-motion kill list").toBe(true);
    // …and nothing in that block may hide the caption, or reduce-motion users would
    // be the one population with an unnamed dock.
    const reduced = GLOBALS.slice(GLOBALS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced.slice(0, 900)).not.toMatch(/capsule-caption[^{]*\{[^}]*display: none/);
  });
});