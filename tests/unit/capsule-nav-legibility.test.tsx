// @vitest-environment jsdom
// CapsuleNav legibility contracts — the dock is the ONLY navigation surface in
// the app, on every device, width and role, so its two P1 defects were the two
// things standing between the whole product and "readable":
//
//   D1 (contrast). The bar colour and the ink used to be hard-coded per theme
//       in JS (`rgba(8,10,12,0.60)` / `rgba(0,0,0,0.16)` bar, `text-white/55`
//       glyphs, `text-white/95` label). In Day mode the primary navigation of a
//       wall-mounted family dashboard measured **1.27:1** for the inactive
//       glyphs and **1.65:1** for the active label over the real composited
//       bar — invisible. The dock is now driven from `--color-nav-active*`
//       (the only active ink, AGENTS.md) plus the theme-aware surface/text
//       tokens, so BOTH themes are correct by construction instead of by two
//       hand-tuned constants. This suite computes the WCAG ratios from the real
//       token values in `globals.css` — for every accent the family can pick —
//       so a token change cannot silently un-fix the dock.
//
//   D2 (tap targets). The bar used to carry
//       `transform: scale((100vw - 24px) / 452px)`, which scales the whole
//       subtree INCLUDING `.hit-44`'s pseudo box: a 44px hit box rendered
//       36.7px at a 320px viewport, 41.6 at 360 and 43.5 at 375 — under the
//       house floor everywhere below 379px (AGENTS.md: 44x44, and the dock is
//       on every route). The scale is gone; the caps are fluidly sized with a
//       44px floor and carry `.hit-44`, so every cap is a true 44x44 in
//       rendered CSS px at every width from 320px up.
//
// Both contracts are checked against the source of truth (`globals.css` tokens
// and the component's own CSS), not against a jsdom rect — jsdom reports 0x0,
// which is why `tap-target-contract.test.ts` scans class strings instead.
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

import CapsuleNav, { BAR_ALPHA, IDLE_CIRCLE_PCT, GEOMETRY } from "@/components/ui/CapsuleNav";

const SRC = join(process.cwd(), "src");
const CAPSULE = readFileSync(join(SRC, "components/ui/CapsuleNav.tsx"), "utf8");
const GLOBALS = readFileSync(join(SRC, "app/globals.css"), "utf8");

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
  document.documentElement.removeAttribute("data-theme");
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Minimal CSS length evaluator: enough for clamp()/min()/max()/calc() over px,
// vw and var() — the exact subset the dock's geometry uses.
// ─────────────────────────────────────────────────────────────────────────────
type Tok = { k: "n"; v: number } | { k: "o"; v: string } | { k: "f"; v: string } | { k: "p"; v: string };

function lex(src: string, vw: number): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const n = parseFloat(src.slice(i, j));
      let unit = "";
      let k = j;
      while (k < src.length && /[a-z%]/i.test(src[k])) { unit += src[k]; k++; }
      i = k;
      if (unit === "vw") out.push({ k: "n", v: (n / 100) * vw });
      else if (unit === "px" || unit === "") out.push({ k: "n", v: n });
      else if (unit === "rem") out.push({ k: "n", v: n * 16 });
      else throw new Error(`unsupported unit ${unit}`);
      continue;
    }
    if (/[a-z]/i.test(c)) {
      let j = i;
      while (j < src.length && /[a-z0-9-]/i.test(src[j])) j++;
      const name = src.slice(i, j).toLowerCase();
      i = j;
      if (["calc", "clamp", "min", "max"].includes(name)) out.push({ k: "f", v: name });
      else throw new Error(`unexpected ident ${name}`);
      continue;
    }
    if ("+-*/".includes(c)) { out.push({ k: "o", v: c }); i++; continue; }
    if ("(),".includes(c)) { out.push({ k: "p", v: c }); i++; continue; }
    throw new Error(`unexpected char ${c} in ${src}`);
  }
  return out;
}

function evalCssLength(expr: string, vw: number, vars: Record<string, string>): number {
  let s = expr;
  for (let pass = 0; pass < 12; pass++) {
    const m = /var\(\s*(--[a-z0-9-]+)\s*\)/i.exec(s);
    if (!m) break;
    const raw = vars[m[1]];
    if (raw === undefined) throw new Error(`unknown custom property ${m[1]}`);
    s = s.slice(0, m.index) + raw + s.slice(m.index + m[0].length);
  }
  const toks = lex(s, vw);
  let p = 0;
  const peek = () => toks[p];
  const eat = () => toks[p++];
  const expr_ = (): number => {
    let v = term();
    while (peek()?.k === "o" && (peek()!.v === "+" || peek()!.v === "-")) {
      const op = eat().v;
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const term = (): number => {
    let v = factor();
    while (peek()?.k === "o" && (peek()!.v === "*" || peek()!.v === "/")) {
      const op = eat().v;
      const r = factor();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const factor = (): number => {
    const t = eat();
    if (t.k === "n") return t.v;
    if (t.k === "p" && t.v === "(") {
      const v = expr_();
      if (eat().v !== ")") throw new Error("unbalanced (");
      return v;
    }
    if (t.k === "f") {
      const open = eat();
      if (open.v !== "(") throw new Error(`expected ( after ${t.v}`);
      const args: number[] = [];
      for (;;) {
        args.push(expr_());
        const sep = eat();
        if (sep.v === ")") break;
        if (sep.v !== ",") throw new Error(`expected , or ) got ${sep.v}`);
      }
      if (t.v === "calc") return args[0];
      if (t.v === "clamp") return Math.min(Math.max(args[1], args[0]), args[2]);
      if (t.v === "min") return Math.min(...args);
      return Math.max(...args);
    }
    throw new Error("unexpected token");
  };
  return expr_();
}

/** The dock's `--capsule-*` geometry, resolved at a viewport width. */
function dockGeometry(viewportWidth: number) {
  const vars: Record<string, string> = { ...GEOMETRY };
  const g: Record<string, number> = {};
  for (const name of Object.keys(vars)) {
    // Resolve in declaration order so --capsule-cap is known before its uses.
    for (let pass = 0; pass < 8; pass++) {
      try {
        // Already-resolved numbers shadow the raw expressions, so declaration
        // order inside GEOMETRY is what lets --capsule-cap read the spacers.
        const env: Record<string, string> = { ...vars };
        for (const [k, v] of Object.entries(g)) env[k] = `${v}px`;
        g[name] = evalCssLength(vars[name], viewportWidth, env);
        break;
      } catch {
        if (pass === 7) throw new Error(`could not resolve ${name}`);
      }
    }
  }
  const CAPS = 7; // the manifest invariant: exactly 7 caps for every role
  const barWidth =
    CAPS * g["--capsule-cap"] + 6 * g["--capsule-gap"] + 2 * g["--capsule-pad"] + 2;
  const geo: Record<string, number> & { cell: number; barWidth: number } = {
    ...g,
    cell: g["--capsule-cap"],
    barWidth,
  };
  return geo;
}

// ─────────────────────────────────────────────────────────────────────────────
// Colour maths over the REAL token values in globals.css
// ─────────────────────────────────────────────────────────────────────────────
type Rgb = [number, number, number];

function block(selector: string): string {
  const from = GLOBALS.indexOf(selector);
  if (from === -1) throw new Error(`no ${selector} block in globals.css`);
  const open = GLOBALS.indexOf("{", from);
  let depth = 0;
  for (let i = open; i < GLOBALS.length; i++) {
    if (GLOBALS[i] === "{") depth++;
    else if (GLOBALS[i] === "}") {
      depth--;
      if (depth === 0) return GLOBALS.slice(open + 1, i);
    }
  }
  throw new Error("unbalanced braces");
}

const DARK_SOURCES = [':root[data-theme="dark"] {', "@theme {"];
const LIGHT_SOURCES = [':root[data-theme="light"] {', "@theme {"];

/** Flatten a theme's custom properties down to literal colours. */
function tokens(theme: "dark" | "light"): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const sel of theme === "dark" ? DARK_SOURCES : LIGHT_SOURCES) {
    let body: string;
    try {
      body = block(sel);
    } catch {
      continue;
    }
    for (const m of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
      if (raw[m[1]] === undefined) raw[m[1]] = m[2].trim();
    }
  }
  return raw;
}

/** Every accent preset the family can pick, read out of the theme's own block. */
function accents(theme: "dark" | "light"): string[] {
  const t = tokens(theme);
  return Object.entries(t)
    .filter(([name, value]) => /^--color-accent-[a-z]+$/.test(name) && value.startsWith("#"))
    .map(([, hex]) => hex);
}

function hexToRgb(hex: string): Rgb {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** `color-mix(in srgb, <hex> P%, transparent)` — the token recipe used app-wide. */
function mixPct(colour: string, pct: number, over: Rgb): Rgb {
  const [r, g, b] = hexToRgb(colour);
  const a = pct / 100;
  return [
    a * r + (1 - a) * over[0],
    a * g + (1 - a) * over[1],
    a * b + (1 - a) * over[2],
  ];
}

/** `color-mix(in srgb, A P%, B)` — two opaque colours, the --widget-accent recipe. */
function mixTwo(a: Rgb, pct: number, b: Rgb): Rgb {
  const p = pct / 100;
  return [p * a[0] + (1 - p) * b[0], p * a[1] + (1 - p) * b[1], p * a[2] + (1 - p) * b[2]];
}

function luminance([r, g, b]: Rgb): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = luminance(a) > luminance(b) ? [luminance(a), luminance(b)] : [luminance(b), luminance(a)];
  return (hi + 0.05) / (lo + 0.05);
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The dock's whole paint stack, composited by hand from the token values.
 *
 *   page substrate -> bar (--color-surface-0 @ --capsule-bar-alpha)
 *                -> cap circle -> ink
 *
 * Two substrates bracket what can actually sit under a fixed bottom dock: the
 * page canvas (dimmest in dark, brightest in light) and `--color-surface-7`,
 * the most extreme value a real surface can reach in either theme.
 */
/**
 * The dock's whole paint stack, composited by hand from the token values:
 *
 *   page substrate → bar (--color-surface-0 @ --capsule-bar-alpha)
 *                → cap circle → ink
 *
 * The percentages are read out of the component and `globals.css` so the maths
 * and the shipped CSS cannot drift apart.
 */
function dockPaint(theme: "dark" | "light", accent: string, substrate: Rgb) {
  const t = tokens(theme);
  const bar = mixPct(t["--color-surface-0"], BAR_ALPHA * 100, substrate);
  // --color-nav-active-wash: the active pill's own tint over the bar.
  const wash = mixPct(accent, WASH_PCT, bar);
  // --color-nav-active-fill: the accent deepened against black, then opaque.
  const fill = mixTwo(hexToRgb(accent), FILL_PCT, [0, 0, 0]);
  return {
    bar,
    idleCircle: mixPct(t["--color-surface-2"], IDLE_CIRCLE_PCT, bar),
    idleGlyph: hexToRgb(t["--color-text-secondary"]),
    activePill: wash,
    activeLabel: hexToRgb(t["--color-text-primary"]),
    activeCircle: fill,
    activeGlyph: [255, 255, 255] as Rgb,
  };
}

const pct = (src: string, re: RegExp) => Number(re.exec(src)?.[1] ?? NaN);
const WASH_PCT = pct(
  GLOBALS,
  /--color-nav-active-wash:\s*color-mix\(in srgb, var\(--color-nav-active\)\s*(\d+)%/,
);
const FILL_PCT = pct(
  GLOBALS,
  /--color-nav-active-fill:\s*color-mix\(in srgb, var\(--color-nav-active\)\s*(\d+)%/,
);

// ─────────────────────────────────────────────────────────────────────────────

describe("CapsuleNav D1: the dock's colours are token-driven, not per-theme constants", () => {
  it("reads no data-theme attribute and hard-codes no colour literal", () => {
    // Comments explain the old branch by name; the CODE must not contain it.
    const code = CAPSULE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code, "the dock must not branch on the theme").not.toMatch(/data-theme/);
    expect(code, "the dock must not branch on the theme").not.toMatch(/\bisLight\b/);
    // No colour literal may reach a surface or an ink (the rendered styles are
    // asserted token-by-token below). The only literals left are the glass
    // speculars inside a box-shadow, and those are white in BOTH themes by
    // design — one light source, the same reason `--neu-light` and
    // `--glass-tint-strong` are white in both — so they are asserted, not banned.
    expect(code, "no #hex colour literal in the dock").not.toMatch(/#[0-9a-f]{3,8}\b/i);
    for (const m of code.matchAll(/rgba\(([^)]*)\)/g)) {
      expect(m[1], "a glass specular must stay white in both themes").toMatch(
        /^255,\s*255,\s*255,/,
      );
    }
  });

  it("drives the bar, the ink and the active fill from design tokens", () => {
    const bar = render(<CapsuleNav />).querySelector(".capsule-nav") as HTMLElement;
    expect(bar.style.background).toContain("var(--color-surface-0)");
    expect(bar.style.border).toContain("var(--border-frost-2)");
    expect(bar.style.boxShadow).toContain("var(--neu-dark)");

    const caps = Array.from(render(<CapsuleNav />).querySelectorAll<HTMLElement>("nav button"));
    const active = caps.find((c) => c.getAttribute("aria-current") === "page")!;
    const idle = caps.find((c) => c.getAttribute("aria-current") !== "page")!;
    const circleOf = (cap: HTMLElement) => cap.querySelector("span") as HTMLElement;
    const glyphOf = (cap: HTMLElement) => circleOf(cap).querySelector("span") as HTMLElement;
    const labelOf = (cap: HTMLElement) => cap.querySelector(".capsule-label-text") as HTMLElement;

    // the ONLY active ink is --color-nav-active* (AGENTS.md)
    expect(circleOf(active).style.background).toContain("var(--color-nav-active-fill)");
    expect(circleOf(idle).style.background).toContain("var(--color-surface-2)");
    expect(glyphOf(idle).className).toContain("var(--color-text-secondary)");
    expect(glyphOf(active).className).toContain("text-white");
    expect(labelOf(active).className).toContain("var(--color-text-primary)");
  });

  it("paints the same styles in light and dark — the tokens are what flip", () => {
    const paint = (theme: string) => {
      document.documentElement.setAttribute("data-theme", theme);
      const el = render(<CapsuleNav />);
      const bar = el.querySelector(".capsule-nav") as HTMLElement;
      const caps = Array.from(el.querySelectorAll<HTMLElement>("nav button"));
      const active = caps.find((c) => c.getAttribute("aria-current") === "page")!;
      return [
        bar.getAttribute("style"),
        (active.querySelector("span") as HTMLElement).getAttribute("style"),
        (active.querySelector(".capsule-label-text") as HTMLElement).getAttribute("class"),
      ].join("|");
    };
    expect(paint("light")).toBe(paint("dark"));
  });
});

describe("CapsuleNav D1: WCAG AA over the real composited dock, every accent", () => {
  it("reads the tokens it composites (sanity: values exist and are hex)", () => {
    for (const theme of ["dark", "light"] as const) {
      const t = tokens(theme);
      expect(accents(theme).length, `${theme} has every accent preset`).toBeGreaterThanOrEqual(8);
      for (const name of [
        "--color-surface-0",
        "--color-surface-2",
        "--color-surface-7",
        "--color-canvas",
        "--color-text-primary",
        "--color-text-secondary",
      ]) {
        expect(t[name], `${theme} ${name}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
      expect(Number.isNaN(BAR_ALPHA), "component must declare --capsule-bar-alpha").toBe(false);
      expect(Number.isNaN(IDLE_CIRCLE_PCT)).toBe(false);
      expect(Number.isNaN(FILL_PCT), "globals.css --color-nav-active-fill pct").toBe(false);
      expect(Number.isNaN(WASH_PCT), "globals.css --color-nav-active-wash pct").toBe(false);
    }
  });

  for (const theme of ["dark", "light"] as const) {
    const presets = accents(theme);
    const substrates: ("canvas" | "surface-7")[] = ["canvas", "surface-7"];

    for (const which of substrates) {
      for (const accent of presets) {
        it(`${theme}: active label ≥4.5:1 and both glyphs clear AA over ${which} (accent ${accent})`, () => {
          const t = tokens(theme);
          const substrate = hexToRgb(t[`--color-${which}`]);
          const p = dockPaint(theme, accent, substrate);
          const label = contrast(p.activeLabel, p.activePill);
          const idleGlyph = contrast(p.idleGlyph, p.idleCircle);
          const activeGlyph = contrast(p.activeGlyph, p.activeCircle);
          expect(
            round(label),
            `active label on the accent pill (${theme}/${which}/${accent})`,
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            round(idleGlyph),
            `inactive glyph on its circle (${theme}/${which}/${accent})`,
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            round(activeGlyph),
            `active glyph on --color-nav-active-fill (${theme}/${which}/${accent})`,
          ).toBeGreaterThanOrEqual(3);
        });
      }
    }
  }
});

describe("CapsuleNav D2: every cap is a true 44x44 at every width from 320px", () => {
  const WIDTHS = [320, 344, 360, 375, 390, 412, 428, 452, 478, 540, 640, 768, 1024, 1080, 1280];

  it("every cap carries .hit-44 and nothing scales the bar's hit boxes", () => {
    const el = render(<CapsuleNav />);
    const caps = Array.from(el.querySelectorAll<HTMLElement>("nav button"));
    expect(caps).toHaveLength(7);
    for (const cap of caps) expect(cap.className).toContain("hit-44");
    // A transform on the bar (or any ancestor) shrinks .hit-44's ::before too.
    const code = CAPSULE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code, "the dock must not transform-scale itself").not.toMatch(/transform:\s*["']scale/);
    expect(code, "the dock must not scale via --capsule-scale").not.toMatch(/capsule-scale/);
  });

  for (const width of WIDTHS) {
    it(`${width}px: cap cell ≥44x44, fits the viewport, circle and glyph inside it`, () => {
      const g = dockGeometry(width);
      const inset = g["--capsule-inset"];
      const circle = g["--capsule-circle"];
      const glyph = g["--capsule-glyph"];
      const edges = g["--capsule-edge"];

      expect(
        round(g.cell),
        `cap cell at ${width}px`,
      ).toBeGreaterThanOrEqual(44);
      expect(round(circle), `circle fits its cell at ${width}px`).toBeLessThanOrEqual(g.cell);
      expect(circle, `--capsule-circle == cell - 2*inset at ${width}px`).toBeCloseTo(
        g.cell - 2 * inset,
        6,
      );
      expect(round(glyph), `glyph at ${width}px`).toBeGreaterThanOrEqual(14);
      expect(round(glyph), `glyph fits the circle at ${width}px`).toBeLessThanOrEqual(circle);
      // The bar = 7 cells + 6 gaps + 2 pads + 2px border, and must never leave
      // the viewport, whatever the labels want. Between 420px (every spacer has
      // reached its max) and 480px (the cell reaches its 56px max) nothing is
      // clamped, so the bar fits *exactly* — which is what makes this a real
      // guard on all four expressions instead of a loose inequality.
      expect(round(g.barWidth + 2 * edges), `bar + margins must fit ${width}px`).toBeLessThanOrEqual(width);
      if (width >= 420 && width <= 480) {
        expect(g.barWidth + 2 * edges, `bar fills ${width}px exactly`).toBeCloseTo(width, 2);
      }
    });
  }

  it("keeps the dock compact — the 44px floor is a hit box, not a bigger dock", () => {
    for (const width of WIDTHS) {
      const g = dockGeometry(width);
      expect(g.cell, `cap never exceeds 56px (${width}px)`).toBeLessThanOrEqual(56);
      expect(g["--capsule-gap"], `gap never exceeds 6px (${width}px)`).toBeLessThanOrEqual(6);
    }
    // …and it still reaches the full 56px cap on a phone, as before.
    expect(round(dockGeometry(478).cell)).toBe(56);
  });

  it("wall mode keeps its 72px caps with always-visible labels", () => {
    wallState.wall = true;
    const el = render(<CapsuleNav />);
    const caps = Array.from(el.querySelectorAll<HTMLElement>("nav button"));
    expect(caps).toHaveLength(7);
    for (const cap of caps) expect(cap.className).toContain("h-[72px]");
    for (const cap of caps) {
      expect(cap.querySelector(".capsule-label-text")!.className).toContain("opacity-100");
    }
    wallState.wall = false;
  });
});