// @vitest-environment jsdom
// Warm Glass v2 contracts, locked by the 2026-09 polish pass (approved fixes A+B+C):
//   A. Raw Tailwind palette classes (bg-emerald-500, text-amber-400, ...) are banned
//      in src — component color must come from design tokens (--color-accent-*,
//      --color-surface-*, text-text-*). Weather widget / WxToys / screensaver are
//      self-contained scenes and stay allowlisted.
//   B. The type floor is 12px (0.75rem / text-xs) — raised from 11px by the 2026-09-26
//      UI audit (docs/UI_AUDIT_2026-09.md, AGENTS.md "UI Contracts"). Arbitrary px text
//      below 12px — text-[10px], text-[11px], the old grandfathered Podium / HallOfFame
//      compacts included — is banned outright: px sizes ignore the rem root and defeat
//      Dynamic Type. Sizes >=12px stay legal (display numerals use text-[96px] etc.).
//   C. Sub-44px tap targets (SoftButton sm, IconButton sm, Stepper buttons) must
//      carry .hit-44 so their hit area expands to 44px (globals.css).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { createRoot } from "react-dom/client";
import { act } from "react";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import Stepper from "@/components/ui/Stepper";

const SRC = join(process.cwd(), "src");
const PALETTE_ALLOWLIST = new Set([
  "src/components/ui/WeatherWidget.tsx",
  "src/components/ui/WxToys.tsx",
  "src/components/screensaver/ScreensaverBoard.tsx",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const PALETTE_RE =
  /\b(?:bg|text|border|ring|shadow|fill|stroke|from|via|to|divide|outline|decoration)-(?:red|orange|amber|yellow|lime|green|emerald|teal|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/;

describe("Warm Glass contract A: no raw Tailwind palette classes in src", () => {
  it("every *.tsx uses design tokens instead of raw palette colors", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = file.slice(process.cwd().length + 1);
      if (PALETTE_ALLOWLIST.has(rel)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const m = line.match(PALETTE_RE);
        if (m) offenders.push(`${rel}:${i + 1}: ${m[0]}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("Warm Glass contract B: 12px type floor", () => {
  it("no arbitrary px text size below 12px (rem-based text-xs is the floor)", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = file.slice(process.cwd().length + 1);
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const m of line.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
          if (parseFloat(m[1]) < 12) offenders.push(`${rel}:${i + 1}: ${m[0]}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

// Contract B reads class strings only, so raw CSS and inline styles used to slip past it —
// the 2026-09 residual pass found 12 sub-12px rules in globals.css that nothing asserted on
// (see docs/UI_AUDIT_2026-09.md, "Residual pass"). Same floor, same file, so a regression
// fails in either direction. Out of scope by design (decorative, aria-hidden): dynamic
// template sizes (`fontSize: `${p.size}px`` in WeatherParticles) and SVG `fontSize="…"`
// attributes inside illustrations, which scale with their viewBox.
// Only two stylesheets are live — layout.tsx imports ./globals.css and @/modes/modes.css, and
// globals.css imports nothing but tailwindcss. Everything under src/styles/ is orphaned.
const CSS_DEAD = new Set([
  "src/styles/animations.css",
  "src/styles/tokens.css",
  "src/styles/materials.css",
  "src/styles/components.css",
]);

function walkCss(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkCss(p, out);
    else if (p.endsWith(".css")) out.push(p);
  }
  return out;
}

const CSS_FLOOR_RE = /font-size:\s*(\d*\.\d+|\d+)(rem|px)/g;
const INLINE_PX_RE = /fontSize:\s*["'](\d*\.\d+|\d+)px["']/g;
const INLINE_BARE_RE = /fontSize:\s*(\d*\.\d+|\d+)\s*[,}]/g;

describe("Warm Glass contract B2: the 12px floor also covers raw CSS and inline styles", () => {
  it("the dead stylesheets stay dead — nothing imports them", () => {
    const globals = readFileSync(join(SRC, "app/globals.css"), "utf8");
    for (const dead of CSS_DEAD) expect(globals.includes(dead.split("/").pop()!)).toBe(false);
  });

  it("no live stylesheet declares a font-size below 12px", () => {
    const offenders: string[] = [];
    for (const file of walkCss(SRC)) {
      const rel = file.slice(process.cwd().length + 1);
      if (CSS_DEAD.has(rel)) continue;
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        for (const m of line.matchAll(CSS_FLOOR_RE)) {
          const px = m[2] === "rem" ? parseFloat(m[1]) * 16 : parseFloat(m[1]);
          if (px < 12) offenders.push(`${rel}:${i + 1}: ${m[0]}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("no inline style hard-codes a literal font size below 12px", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = file.slice(process.cwd().length + 1);
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        for (const re of [INLINE_PX_RE, INLINE_BARE_RE]) {
          for (const m of line.matchAll(re)) {
            if (parseFloat(m[1]) < 12) offenders.push(`${rel}:${i + 1}: ${m[0]}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("Warm Glass contract C: hit-44 on sub-44px tap targets", () => {
  function render(ui: React.ReactElement): HTMLElement {
    const el = document.createElement("div");
    document.body.appendChild(el);
    act(() => createRoot(el).render(ui));
    return el;
  }

  it("SoftButton sm carries hit-44; md and lg do not", () => {
    const sm = render(<SoftButton size="sm">S</SoftButton>).querySelector("button")!;
    expect(sm.className).toContain("hit-44");
    for (const size of ["md", "lg"] as const) {
      const btn = render(<SoftButton size={size}>B</SoftButton>).querySelector("button")!;
      expect(btn.className).not.toContain("hit-44");
    }
  });

  it("IconButton sm carries hit-44; md and lg do not", () => {
    const sm = render(<IconButton size="sm">x</IconButton>).querySelector("button")!;
    expect(sm.className).toContain("hit-44");
    for (const size of ["md", "lg"] as const) {
      const btn = render(<IconButton size={size}>x</IconButton>).querySelector("button")!;
      expect(btn.className).not.toContain("hit-44");
    }
  });

  it("Stepper's - and + buttons both carry hit-44", () => {
    const el = render(<Stepper value={1} onChange={() => {}} />);
    const buttons = Array.from(el.querySelectorAll("button"));
    expect(buttons).toHaveLength(2);
    for (const b of buttons) {
      expect(b.className).toContain("hit-44");
    }
  });
});
