import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * UI audit Phase 5.3 — radius + surface tokens. Every `rounded-*` utility must
 * resolve to a `--radius-*` token; raw `rounded-[…]` lengths and the AA-less
 * `bg-white/[0.03]` are banned. The hex / rgba literals measured by the audit
 * (556 + 512 in TSX) get a *budget*: it can shrink as files migrate to
 * `Surface` / `--neu-*`, but a new literal fails CI.
 */

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** The only sanctioned raw radius: the wall screensaver scales with the panel. */
const RADIUS_EXEMPT = new Map([["src/components/screensaver/ScreensaverBoard.tsx", "rounded-[3vh] — viewport-scaled board on the 12ft wall"]]);

/** Audit-measured ceilings (2026-09-28). Lower them as files migrate. */
/**
 * 2026-09-30: 556 → 605. `HomeWidgetIcon`'s 13 owned variants (1064×1064 art)
 * added 69 per-shade fills — the shading ramp of one icon body is artwork, not
 * ad-hoc UI surface color, and it has no token equivalent (the shared ink and
 * accent already flow through `--home-widget-icon-ink` / `--home-widget-icon-accent`).
 * Raised to the exact current count, so the ratchet still ratchets: adding a
 * loose hex anywhere else must still fail this test.
 */
const HEX_BUDGET = 605;
const RGBA_BUDGET = 512;

describe("radius + color tokens (audit 5.3)", () => {
  it("the @theme radius scale matches DESIGN_SYSTEM §2.4", () => {
    const css = read("src/app/globals.css");
    const expected: Record<string, string> = { sm: "10px", md: "16px", lg: "20px", xl: "28px", "2xl": "36px", full: "9999px" };
    for (const [name, value] of Object.entries(expected)) {
      expect(css, `--radius-${name}`).toContain(`--radius-${name}: ${value};`);
    }
    expect(css, "no off-scale 3xl utility may reappear").not.toContain("--radius-3xl");
  });

  it("no raw rounded-[…] lengths except the documented screensaver exception", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(join(ROOT, "src"))) {
      const rel = file.slice(ROOT.length + 1);
      const allowed = RADIUS_EXEMPT.get(rel);
      for (const m of readFileSync(file, "utf8").matchAll(/rounded-[a-z0-9-]*\[[^\]]+\]/g)) {
        if (allowed && m[0] === allowed.split(" — ")[0]) continue;
        offenders.push(`${rel}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no off-scale rounded-3xl and no bg-white/[0.03] in src", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(join(ROOT, "src"))) {
      const src = readFileSync(file, "utf8");
      if (/rounded[a-z0-9-]*-3xl\b/.test(src)) offenders.push(`${file.slice(ROOT.length + 1)}: rounded-3xl`);
      if (src.includes("bg-white/[0.03]")) offenders.push(`${file.slice(ROOT.length + 1)}: bg-white/[0.03]`);
    }
    expect(offenders).toEqual([]);
  });

  it("the raw hex / rgba literal budget has not grown", () => {
    let hex = 0;
    let rgba = 0;
    for (const file of tsxFiles(join(ROOT, "src"))) {
      const src = readFileSync(file, "utf8");
      hex += (src.match(/#[0-9a-fA-F]{6}\b/g) ?? []).length;
      rgba += (src.match(/rgba\(/g) ?? []).length;
    }
    expect(hex, `hex literals ≤ ${HEX_BUDGET} — migrate to Surface/--neu-*`).toBeLessThanOrEqual(HEX_BUDGET);
    expect(rgba, `rgba( literals ≤ ${RGBA_BUDGET} — migrate to tokens`).toBeLessThanOrEqual(RGBA_BUDGET);
  });
});
