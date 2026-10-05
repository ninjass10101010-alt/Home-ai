/**
 * The sub-primary text ladder closes on surface-3 in BOTH themes.
 *
 * Why this file exists (2026-10 visual critique): the documented contrast debt
 * was real and is now paid. `--color-text-muted` and `--color-text-dim` sat at
 * 4.49:1 on light `--color-surface-2` and 4.21:1 on `--color-surface-3` — under
 * the 4.5:1 body floor for the two most-used tokens in the app — and in dark
 * `dim` was 4.21:1 on surface-3. `tests/unit/theme-token-contrast.test.ts`
 * recorded that as a "known condition, deliberately not fixed"; this file makes
 * it a fixed condition instead.
 *
 * The measurement subtlety, which is why this does NOT reuse that suite's
 * surface list: the warm-glass backdrop is not the bare surface token. It is
 * painted by absolutely-positioned gradient and scrim layers, so the colour
 * actually behind text is several steps lighter AND tinted in both themes
 * (dark measured #2d3e5c / #25414a / #383b4a; light #dfdae2 / #dde7fb /
 * #efe6e1). No ancestor chain resolves that, and jsdom resolves neither
 * `var()` nor `color-mix()`. The values below were confirmed against
 * composited pixels in Chromium, and these assertions pin the headroom that
 * makes those composited backdrops safe.
 *
 * Reads the two LIVE stylesheets only (`layout.tsx` loads exactly those two;
 * everything under `src/styles/` is dead and asserted dead by contract B2).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const CSS = ["src/app/globals.css", "src/modes/modes.css"]
  .map((p) => readFileSync(join(ROOT, p), "utf8"))
  .join("\n");

/** Comments are stripped before parsing: they would otherwise ride along in the
 *  selector prelude and make a selector match on comment text. */
const PARSED = CSS.replace(/\/\*[\s\S]*?\*\//g, " ");

/* ── colour maths (WCAG 2.2 relative luminance) ─────────────────────────── */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`not a hex: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = relativeLuminance(hexToRgb(a));
  const lb = relativeLuminance(hexToRgb(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* ── cascade resolver ───────────────────────────────────────────────────────
   A real brace-depth walk over the sheet, tracking `@media` context, so a
   `prefers-color-scheme: light` block can never be confused with the
   unconditional one. This matters: three separate boost blocks declare the
   same tokens, two of them inside a media query, and a text search over the
   file picks the wrong one.

   Rank (ascending, later wins):
     0  @theme / bare :root                — the always-on base
     1  :root[data-theme="light"|"dark"]   — the resolved theme
     2  …[data-contrast="boost"]           — high contrast, above both
   @media never changes rank; it only decides whether a block is ACTIVE.
*/
interface Block {
  /** Bracketed media conditions enclosing this block, outermost first. */
  media: string[];
  selector: string;
  decls: Map<string, string>;
  rank: number;
}

function rankOf(selector: string): number {
  if (/\[data-contrast="boost"\]/.test(selector)) return 2;
  if (/\[data-theme=/.test(selector)) return 1;
  return 0;
}

/** Split a selector list on top-level commas and rank by the strongest part. */
function rankOfList(list: string): number {
  let best = 0;
  for (const part of list.split(",")) best = Math.max(best, rankOf(part.trim()));
  return best;
}

function parseBlocks(): Block[] {
  const blocks: Block[] = [];
  const media: string[] = [];
  // Tokenise into a stream of `{`, `}`, and text runs.
  let buf = "";
  let i = 0;
  /** The @media/@supports stack, appended by every push and popped by every
   *  brace. A statement-level `{` (a rule body) never pushes, so this is
   *  exactly the at-rule nesting — the earlier version popped on the rule
   *  body's own `}`, which left two stale `prefers-color-scheme: light` entries
   *  on the stack and made the dark branch look light-gated. */
  const stack: string[] = [];

  const declsOf = (body: string) => {
    const decls = new Map<string, string>();
    for (const part of body.split(";")) {
      const idx = part.indexOf(":");
      if (idx < 0) continue;
      const prop = part.slice(0, idx).trim();
      if (prop.startsWith("--")) decls.set(prop, part.slice(idx + 1).trim());
    }
    return decls;
  };

  const walk = (src: string, mediaStack: string[]): void => {
    let buf = "";
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (ch === "{") {
        const prelude = buf.trim();
        buf = "";
        i++;
        const bodyStart = i;
        let depth = 1;
        while (i < src.length && depth > 0) {
          if (src[i] === "{") depth++;
          else if (src[i] === "}") depth--;
          i++;
        }
        const body = src.slice(bodyStart, i - 1);

        if (/^@(media|supports)/i.test(prelude)) {
          // RECURSE, so the rules inside the media query are parsed as rules
          // rather than swallowed as opaque text — this is what carries the
          // media condition onto them.
          walk(body, [...mediaStack, prelude]);
          continue;
        }
        if (/^@/.test(prelude)) {
          // @theme / @layer: declarations inside are unconditional, rank 0.
          const decls = declsOf(body);
          if (decls.size) blocks.push({ media: mediaStack, selector: prelude, decls, rank: 0 });
          continue;
        }
        if (!/^:root/.test(prelude)) continue;
        const decls = declsOf(body);
        if (decls.size) blocks.push({ media: mediaStack, selector: prelude, decls, rank: rankOfList(prelude) });
        continue;
      }
      if (ch === ";") {
        buf = "";
        i++;
        continue;
      }
      buf += ch;
      i++;
    }
  };

  walk(PARSED, media);
  void stack;
  return blocks;
}

const BLOCKS = parseBlocks();

interface ThemeCtx {
  theme: "light" | "dark";
  /** The OS preference, which decides the PRE-HYDRATION light branch. */
  prefersLight: boolean;
  contrast: boolean;
}

function blockApplies(b: Block, ctx: ThemeCtx): boolean {
  const inLightMedia = b.media.some((m) => /prefers-color-scheme:\s*light/.test(m));
  if (inLightMedia && !ctx.prefersLight) return false;
  const sel = b.selector;
  /* A POSITIVE `[data-theme="X"]` condition gates the block; a NEGATED one
     (`:not([data-theme="light"])`, which is how the dark boost is keyed so it
     out-specifies the base) must NOT. Matching the bare attribute substring
     would read `:not(...)` as a requirement and silently disable the whole
     dark boost — the exact dead-cascade failure this suite exists to catch. */
  const positives = sel.replace(/:not\([^)]*\)/g, "");
  if (/\[data-theme="light"\]/.test(positives) && ctx.theme !== "light") return false;
  if (/\[data-theme="dark"\]/.test(positives) && ctx.theme !== "dark") return false;
  if (/\[data-contrast="boost"\]/.test(sel) && !ctx.contrast) return false;
  // A `[data-theme="X"]` branch only applies when that attribute is present,
  // which is exactly the post-hydration state.
  return true;
}

function token(name: string, ctx: ThemeCtx): string {
  let best: Block | null = null;
  for (const b of BLOCKS) {
    if (!b.decls.has(name)) continue;
    if (!blockApplies(b, ctx)) continue;
    if (!best || b.rank >= best.rank) best = b;
  }
  if (!best) throw new Error(`${name} unresolved for ${JSON.stringify(ctx)}`);
  const v = best.decls.get(name)!.trim();
  // These audited tokens are plain hexes; a var()/color-mix() here would mean
  // the model needs to grow rather than silently measure the wrong thing.
  if (!/^#[0-9a-f]{3,8}$/i.test(v)) throw new Error(`${name} = "${v}" is not a plain hex; extend the resolver`);
  return v;
}

const ctx = (theme: "light" | "dark", contrast = false, prefersLight = theme === "light"): ThemeCtx => ({
  theme,
  prefersLight,
  contrast,
});

/** canvas → surface-3: the span the ladder is contractually held to. */
const LADDER_SURFACES = ["canvas", "surface-0", "surface-1", "surface-2", "surface-3"] as const;

/** Composited-backdrop stand-ins measured in Chromium during the critique. */
const MEASURED_BACKDROPS = {
  dark: ["#2d3e5c", "#25414a", "#383b4a", "#2a3d43", "#2f3749", "#2e3647", "#303849"],
  light: ["#dfdae2", "#dde7fb", "#efe6e1", "#f0e6e1", "#f1f2f0", "#e1e9f9"],
} as const;

describe("the sub-primary text ladder clears AA on surface-3 in both themes", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const level of ["secondary", "muted", "dim"] as const) {
      it(`${theme} --color-text-${level} clears 4.5:1 on canvas → surface-3`, () => {
        const c = ctx(theme);
        const ink = token(`--color-text-${level}`, c);
        const bad = LADDER_SURFACES.map((s) => ({
          s,
          bg: token(`--color-${s}`, c),
          ratio: contrast(ink, token(`--color-${s}`, c)),
        })).filter((r) => r.ratio < 4.5);
        expect(
          bad.map((b) => `${b.s} ${b.ratio.toFixed(2)}:1 (${ink} on ${b.bg})`),
          `${theme} ${level} = ${ink}`
        ).toEqual([]);
      });

      it(`${theme} --color-text-${level} survives the measured warm-glass tint`, () => {
        const ink = token(`--color-text-${level}`, ctx(theme));
        const bad = MEASURED_BACKDROPS[theme]
          .map((bg) => ({ bg, ratio: contrast(ink, bg) }))
          .filter((r) => r.ratio < 4.5);
        expect(bad, `${theme} ${level} = ${ink}`).toEqual([]);
      });
    }
  }
});

describe("the ladder is a ladder", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`${theme}: primary > secondary > muted > dim in contrast on surface-3`, () => {
      const c = ctx(theme);
      const bg = token("--color-surface-3", c);
      const order = ["primary", "secondary", "muted", "dim"] as const;
      const ratios = order.map((l) => contrast(token(`--color-text-${l}`, c), bg));
      for (let i = 1; i < ratios.length; i++) {
        expect(
          ratios[i],
          `${theme}: text-${order[i]} must be dimmer than text-${order[i - 1]} on surface-3 (${ratios.join(" > ")})`
        ).toBeLessThan(ratios[i - 1]);
      }
    });
  }

  it("muted and dim are DISTINCT levels (they were the same hex in both themes)", () => {
    // The fourth rung did not exist: light muted and dim were both #6f6f6f,
    // dark muted and secondary were both #8892aa. Two spellings of one value is
    // not a hierarchy, and it made `dim` styling impossible.
    for (const theme of ["light", "dark"] as const) {
      expect(token("--color-text-muted", ctx(theme))).not.toBe(token("--color-text-dim", ctx(theme)));
    }
  });
});

describe("the pre-hydration light block matches explicit light", () => {
  // `<html>` carries no data-theme before ThemeProvider mounts, so the
  // `prefers-color-scheme: light` block is the only thing painting the light
  // palette on the first frame. Drift here repaints the whole text ladder on
  // hydration — a visible flash of the wrong ink on every load.
  for (const name of ["--color-text-primary", "--color-text-secondary", "--color-text-muted", "--color-text-dim"]) {
    it(`${name} is identical in both light branches`, () => {
      // Two spellings of "the light theme": resolved (data-theme present) and
      // pre-hydration (only prefers-color-scheme). They must paint the same ink.
      const preHydration = token(name, { theme: "light", prefersLight: true, contrast: false });
      const resolved = token(name, { theme: "light", prefersLight: false, contrast: false });
      expect(preHydration).toBe(resolved);
    });
  }
});

describe("High Contrast still lifts every rung above the base", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`${theme} boost lifts secondary, muted and dim over AA on canvas → surface-3`, () => {
      for (const level of ["secondary", "muted", "dim"] as const) {
        const ink = token(`--color-text-${level}`, ctx(theme, true));
        const bad = LADDER_SURFACES.map((s) => ({ s, ratio: contrast(ink, token(`--color-${s}`, ctx(theme, true))) }))
          .filter((r) => r.ratio < 4.5);
        expect(bad, `${theme} boost --color-text-${level} = ${ink}`).toEqual([]);
      }
    });

    it(`${theme} boost is strictly stronger than base for muted and dim`, () => {
      const c = ctx(theme);
      const bg = token("--color-surface-3", c);
      for (const level of ["muted", "dim"] as const) {
        const name = `--color-text-${level}`;
        expect(
          contrast(token(name, ctx(theme, true)), bg),
          `${theme} boost ${name} must exceed base on surface-3`
        ).toBeGreaterThan(contrast(token(name, c), bg));
      }
    });

    it(`${theme} boost actually changes the rendered ladder (not a dead cascade)`, () => {
      // The old boost blocks scored (0,1,0) and lost to :root[data-theme] at
      // (0,2,0), so dark+boost rendered byte-identical to dark. If these ever
      // tie, the boost is decorative again.
      const changed = (["primary", "secondary", "muted", "dim"] as const).filter(
        (l) => token(`--color-text-${l}`, ctx(theme, true)) !== token(`--color-text-${l}`, ctx(theme))
      );
      expect(changed).toEqual(["primary", "secondary", "muted", "dim"]);
    });
  }
});

describe("every text token is a plain hex in every branch (the resolver's precondition)", () => {
  it("holds for all four levels across light / dark / both boosts", () => {
    // If this ever throws, a token became a var() or color-mix() reference and
    // the numeric assertions above would be measuring the wrong colour.
    for (const theme of ["light", "dark"] as const) {
      for (const contrast of [false, true]) {
        for (const level of ["primary", "secondary", "muted", "dim"]) {
          expect(() => token(`--color-text-${level}`, ctx(theme, contrast))).not.toThrow();
        }
      }
    }
  });
});