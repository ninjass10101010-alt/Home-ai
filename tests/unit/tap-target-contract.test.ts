// Tap-target contract — the house 44x44 floor, enforced on hand-rolled buttons.
//
// AGENTS.md ("UI Contracts"): *Tap targets ≥44x44. Visual size may stay compact
// when the element carries `.hit-44` … or an equivalent documented
// `after:-inset-*` region.* `globals.css:607` defines `.hit-44::before` as a
// centred `width/height: max(100%, 44px)` pseudo box — a 44px hit area with no
// layout change, which is why a 24px ✕ can be visually compact and still be
// comfortably tappable.
//
// The primitives already carry it (`SoftButton sm`, `IconButton sm`, `Stepper` —
// pinned by contract C in `warm-glass-contracts.test.tsx`). This suite covers the
// OTHER half: `<button>` elements written by hand, which no primitive check sees.
//
// Why a source scan and not a DOM measurement: jsdom returns a 0x0 rect for
// every element, so any `getBoundingClientRect().height < 44` assertion passes
// vacuously. Contract B already established the `*.tsx`-class-string idiom in
// this repo for exactly this reason, and the wall profile's 44px floor works the
// same way (a CSS rule, not a measurement).
//
// The allowlist below is the KNOWN debt, each entry with a reason. The list may
// only shrink: adding a new sub-44 button without `hit-44` fails this suite, and
// removing a `hit-44` from an allowlisted control fails it too.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { globSync } from "fs";
import { join } from "path";

/**
 * Tailwind spacing units below 44px: 6=24px 7=28 8=32 9=36 10=40.
 * `11` IS 44px, so it is the floor and is not a violation.
 */
const SUB_44 = /(?:^|[\s"'`])(?:min-)?(?:h|w)-?(6|7|8|9|10)(?![\w-])/;

/**
 * Known sub-44 controls, keyed `relative/path` → reason. These are the only
 * three where `.hit-44` genuinely cannot be added; everything else in `src/`
 * now carries it.
 */
const ALLOWLIST: Record<string, string> = {
  "components/photo-input/PhotoInputButton.tsx":
    "ALREADY 44px, by the rule's other permitted mechanism: 24px button + `before:-inset-2.5` (2×10px) = 44px. Listed only because the class string carries no `hit-44`.",
  "components/meals/RecipeImportModal.tsx":
    "Emoji picker in a `grid-cols-8 gap-1` (4px gap): a 44px box on a 32px cell extends 6px per side against a 2px half-gap, so the cells would overlap. Meeting 44px needs a wider grid — a design change, not a class.",
  "components/meals/RecipeModal.tsx":
    "Same `grid-cols-8 gap-1` emoji picker as RecipeImportModal — 32px cells, 4px gap, 44px boxes would overlap.",
};

/** Static class tokens of one `<button>`, with `${…}` holes and quoted choices dropped. */
function staticClasses(classAttr: string): string {
  return classAttr.replace(/\$\{[^}]*\}/g, " ");
}

function buttonOffenders(rel: string, src: string): { rel: string; snippet: string }[] {
  const out: { rel: string; snippet: string }[] = [];
  let idx = 0;
  while ((idx = src.indexOf("<button", idx)) !== -1) {
    // Stop at the next <button so a className-less button cannot borrow the
    // next one's classes.
    const next = src.indexOf("<button", idx + 1);
    const limit = next === -1 ? src.length : next;
    const m = /className=(?:"([^"]*)"|\{([^}]*(?:\{[^}]*\}[^}]*)*)\})/.exec(
      src.slice(idx, limit)
    );
    if (m) {
      const attr = staticClasses(m[1] ?? m[2] ?? "").replace(/\s+/g, " ").trim();
      if (attr && SUB_44.test(attr) && !attr.includes("hit-44")) {
        out.push({ rel, snippet: attr.slice(0, 60) });
      }
    }
    idx += 6;
  }
  return out;
}

describe("Tap-target contract: no sub-44px <button> without hit-44", () => {
  const files = globSync(join(process.cwd(), "src/**/*.tsx"));

  it("scanned the source tree", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("every sub-44px button either carries hit-44 or is a documented allowlist entry", () => {
    const offenders: string[] = [];
    const seenAllowlist = new Set<string>();
    for (const abs of files) {
      const rel = abs.replace(`${process.cwd()}/src/`, "");
      for (const { snippet } of buttonOffenders(rel, readFileSync(abs, "utf8"))) {
        const reason = ALLOWLIST[rel];
        if (reason) {
          seenAllowlist.add(rel);
          expect(reason.length, `${rel} needs a written reason`).toBeGreaterThan(10);
        } else {
          offenders.push(`${rel}  [${snippet}]`);
        }
      }
    }
    expect(offenders, "add .hit-44, or an allowlist entry with a reason").toEqual([]);
    // The two controls repaired on 2026-09-29 must NOT be allowlisted — if they
    // regress, the offender list above fails instead of being excused.
    expect(seenAllowlist.has("components/tasks/CrewTasksCard.tsx")).toBe(false);
    expect(seenAllowlist.has("components/leaderboard/DailyQuestCard.tsx")).toBe(false);
  });

  it("has no stale allowlist entries (an allowlisted file must still violate)", () => {
    const stale: string[] = [];
    for (const rel of Object.keys(ALLOWLIST)) {
      const found = buttonOffenders(rel, readFileSync(join(process.cwd(), "src", rel), "utf8"));
      if (found.length === 0) stale.push(rel);
    }
    expect(stale, "these controls are fixed or renamed — drop the allowlist entry").toEqual([]);
  });
});
