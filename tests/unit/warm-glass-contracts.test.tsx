// @vitest-environment jsdom
// Warm Glass v2 contracts, locked by the 2026-09 polish pass (approved fixes A+B+C):
//   A. Raw Tailwind palette classes (bg-emerald-500, text-amber-400, ...) are banned
//      in src — component color must come from design tokens (--color-accent-*,
//      --color-surface-*, text-text-*). Weather widget / WxToys / screensaver are
//      self-contained scenes and stay allowlisted.
//   B. The documented type floor is 11px. text-[10px] compacts are deliberately
//      grandfathered (Podium all-time lines, HallOfFame count badge). Anything
//      below 10px (text-[8px], text-[9px]) is banned outright.
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

describe("Warm Glass contract B: 11px type floor", () => {
  it("no type below 10px (text-[8px] / text-[9px] banned)", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = file.slice(process.cwd().length + 1);
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const m = line.match(/text-\[(?:[0-8](?:\.\d+)?|9(?:\.0+)?)px\]/);
        if (m) offenders.push(`${rel}:${i + 1}: ${m[0]}`);
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
