// Light-theme atmosphere contracts (visual review — Home `/`, light mode).
//
// These read `src/app/globals.css`, the only stylesheet that owns the token /
// theme layer. Nothing here asserts "the class is present": each claim is a
// NUMBER the browser would actually resolve, and each exists because the light
// theme shipped a measurable defect first.
//
// The root defect these pin: `FogBackground` mounts one full-viewport three.js
// canvas as a direct child of <body>, and its palette comes from
// `AtmosphericTheme`, which keys off the CLOCK (isNight + season) and never off
// the active theme. Light mode was therefore getting the night palette — a
// near-opaque brown flood between the near-white canvas and every white glass
// card above it. Measured on the canvas: rgb(224,214,208) instead of the light
// token's rgb(245,246,250), with the three stat tiles faithfully transmitting
// it as three unrelated pastels.
//
// The style precedent is `holiday-tint.test.ts` / `theme-token-contrast.test.ts`
// (jsdom cannot cascade or resolve color-mix(), so these read the file).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** The declaration bodies of every rule whose selector list contains `needle`. */
function rulesFor(needle: string): string[] {
  const out: string[] = [];
  // Walk top-level rule blocks. Nested at-rules (@media/@supports) are inlined
  // for this purpose: a token that only exists inside one is still shipped.
  const re = /([^{}]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const selector = m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (!selector.includes(needle)) continue;
    let depth = 1;
    let i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
      i += 1;
    }
    out.push(css.slice(re.lastIndex, i - 1).replace(/\/\*[\s\S]*?\*\//g, ""));
  }
  return out;
}

/** First `name: <value>` in any rule matching `needle`, value split on `;`. */
function decl(needle: string, name: string): string | undefined {
  return decls(needle, name)[0];
}

/** All `name: <value>` values across rules matching `needle`. */
function decls(needle: string, name: string): string[] {
  const found: string[] = [];
  for (const body of rulesFor(needle)) {
    for (const part of body.split(";")) {
      const [k, ...rest] = part.split(":");
      if (k && k.trim() === name) found.push(rest.join(":").replace(/!important/g, "").trim());
    }
  }
  return found;
}

const alpha = (v: string | undefined) => {
  if (!v) return NaN;
  const m = /rgba?\([^)]*?,\s*([\d.]+)\s*\)/.exec(v) ?? /([\d.]+)\s*\)/.exec(v);
  return m ? Number(m[1]) : NaN;
};

describe("light-theme atmosphere is an atmosphere, not a colour flood", () => {
  it("caps the seasonal fog canvas in light theme only", () => {
    const bodies = rulesFor('body > div:has(> canvas[data-engine])');
    expect(bodies.length).toBeGreaterThan(0);
    for (const selector of [
      ':root:not([data-theme="dark"])',
      ':root:not([data-theme="dark"])[data-contrast="boost"]',
    ]) {
      expect(css, `no light-scoped fog cap for ${selector}`).toContain(selector);
    }
    // Dark must keep the full-strength fog it was tuned for: no dark-scoped cap.
    expect(css).not.toMatch(/\[data-theme="dark"\][^{]*\{[^}]*body > div:has\(> canvas\[data-engine\]\)[^}]*opacity/);
  });

  it("keeps the light fog alpha at atmosphere strength (a whisper, not a veil)", () => {
    const values = decls('body > div:has(> canvas[data-engine])', "opacity").map(Number);
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      expect(v).toBeGreaterThan(0);
      // 0.30 was the brown flood; 0.17 was grey smoke. An atmosphere is < 0.12.
      expect(v, `light fog opacity ${v} is a flood, not an atmosphere`).toBeLessThanOrEqual(0.12);
    }
  });

  it("keeps the surviving hue warm rather than neutral grey", () => {
    // A dark desaturated fog at low alpha reads as SMOKE. saturate() is what
    // turns the residue into a seasonal cast instead of a grey cloud.
    const filters = decls('body > div:has(> canvas[data-engine])', "filter");
    expect(filters.length).toBeGreaterThan(0);
    for (const f of filters) {
      const s = Number(/saturate\(([\d.]+)\)/.exec(f)?.[1]);
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(1.8);
    }
  });

  it("re-asserts the cap under High Contrast, which force-resets element opacity", () => {
    const boost = rulesFor('body > div:has(> canvas[data-engine])').join("\n");
    expect(css).toContain(':root:not([data-theme="dark"])[data-contrast="boost"]');
    expect(boost).toMatch(/opacity:[^;]*!important/);
  });
});

describe("light-theme card material is ONE material", () => {
  it("keeps the tone wash below the level that turns a card into a pastel", () => {
    const bg = decl(':root[data-theme="light"] .widget-card', "background") ?? "";
    const washes = [...bg.matchAll(/color-mix\(in srgb, var\(--widget-tone\) ([\d.]+)%/g)].map((m) => Number(m[1]));
    expect(washes.length).toBeGreaterThanOrEqual(2);
    const [from, to] = washes;
    // Dark runs 16%/5%; anything near that in light makes the Home bento a
    // pastel quilt (eight cards, six hues) instead of one system.
    expect(from).toBeLessThanOrEqual(5);
    expect(to).toBeLessThanOrEqual(2.5);
  });

  it("never amplifies the backdrop's chroma through light glass", () => {
    // `saturate(1.35)` is the dark-theme trick; in light it only drags the
    // season's hue into every white card.
    const blurs = decls(':root[data-theme="light"] .widget-card', "-webkit-backdrop-filter")
      .concat(decls(':root[data-theme="light"] .widget-card', "backdrop-filter"));
    expect(blurs.length).toBeGreaterThan(0);
    for (const b of blurs) {
      const s = Number(/saturate\(([\d.]+)\)/.exec(b)?.[1]);
      expect(Number.isFinite(s)).toBe(true);
      expect(s, `light card saturate(${s}) re-amplifies the backdrop`).toBeLessThanOrEqual(1.15);
      expect(/blur\(/.test(b)).toBe(true);
    }
  });

  it("lifts the light glass off the canvas instead of veiling it", () => {
    const strong = alpha(decl(':root[data-theme="light"]', "--glass-tint-strong"));
    const soft = alpha(decl(':root[data-theme="light"]', "--glass-tint-soft"));
    expect(strong).toBeGreaterThan(0.7);
    expect(soft).toBeGreaterThan(0.4);
    expect(strong).toBeGreaterThan(soft);
    // The prefers-color-scheme mirror must not drift from the explicit block:
    // pre-hydration `<html>` carries no data-theme, so the mirror is what the
    // first paint uses and a drifted pair flashes a different material.
    const mirrors = css.slice(css.indexOf("@media (prefers-color-scheme: light)"));
    const mirrored = (name: string) => {
      const m = new RegExp(`${name}:\\s*rgba\\(255,255,255,([\\d.]+)\\)`).exec(mirrors);
      return m ? Number(m[1]) : NaN;
    };
    expect(mirrored("--glass-tint-strong")).toBeCloseTo(strong, 5);
    expect(mirrored("--glass-tint-soft")).toBeCloseTo(soft, 5);
  });
});

describe("data eyebrows inside cards stay legible", () => {
  it("does not fade a card eyebrow below AA", () => {
    // The stat tiles render their fill fraction as `.text-eyebrow` +
    // `opacity-60`: 60% of --color-text-muted over white glass composites to
    // ~2.2:1. The machine audit cannot see it — it resolves element opacity
    // separately from colour — so the contract lives here.
    const body = rulesFor(".widget-card .text-eyebrow").join("\n");
    expect(body).toMatch(/opacity:\s*1\b/);
    expect(body).not.toMatch(/opacity:\s*0?\.\d/);
    expect(body).toContain("--color-text-secondary");
  });

  it("keeps .text-eyebrow on an AA token with no alpha baked into the token", () => {
    const body = rulesFor(".text-eyebrow").join("\n");
    expect(body).toContain("color: var(--color-text-muted)");
    // An rgba() text token would fade the eyebrow a second time on top of any
    // element-level opacity — the exact failure this suite exists to prevent.
    const light = decl(':root[data-theme="light"]', "--color-text-muted");
    expect(light).toMatch(/^#[0-9a-f]{6}$/i);
    const dark = decl(':root[data-theme="dark"]', "--color-text-muted");
    expect(dark).toMatch(/^#[0-9a-f]{6}$/i);
  });
});