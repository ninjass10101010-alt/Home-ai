// The unwired mode screens and their orphaned siblings stay deleted.
//
// Eleven files had **zero importers anywhere** — `src/`, `tests/` and `scripts/`
// all checked — so they were carried in the build, type-checked and linted on
// every run while rendering nothing. `src/modes/modes.css` had been carrying the
// stale note "FamilyHome/AdultHome remain unwired" as if it were current fact.
//
// `AdultHome` and `FamilyHome` are whole Home screens (733 and 247 lines) that
// lost their mount in `0f5bb1e` (2026-08-04) and have been unreachable since.
// Phase 5.1 set the precedent by deleting the dead stylesheets and having
// contract B2 assert they stay deleted; this is the same shape.
//
// **The deletion cascaded, and the cascade was measured rather than assumed.**
// A reference scan after the first eight came back with three NEW orphans that
// had not been unreferenced before: `ProductSearchWidget`, `TravelTimeCard` and
// `InstacartButton` were imported *only* by the `AdultHome` we just removed, so
// removing it orphaned them. They are listed here as the second wave. A
// single-pass "is it referenced?" check would have silently left them behind.
//
// Deliberately TARGETED, not a general "unreferenced file" scan. A whole-tree
// scan was built and measured, and it has at least three false-positive classes
// that would have made it a nuisance rather than a guard:
//   - barrel `index.ts` files that exist to be a public entry point;
//   - modules referenced only from `tests/` or `scripts/` (`RewardSection` has
//     5 references and 0 importers, `action-runner` 3 and 0) — "unused by the
//     product" is not the same claim as "safe to delete";
//   - dynamic-import and `next/dynamic` shapes the resolver has to guess at.
// The remaining candidates are therefore left for a deliberate per-file audit,
// not deleted on a regex's word — notably `useSafeFetch`, which has a real
// dedicated test but no product caller, and so is "ready to wire" rather than
// "dead".
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { globSync } from "fs";
import { join } from "path";

/** Deleted 2026-09-29. Each was unreferenced across src/, tests/ and scripts/. */
const DELETED: Record<string, string> = {
  "src/modes/adult/AdultHome.tsx":
    "Adult Home screen — lost its mount in `0f5bb1e` (2026-08-04); unreachable since.",
  "src/modes/family/FamilyHome.tsx":
    "Family (signed-out) Home screen — unwired alongside AdultHome; `modes.css` recorded it as such.",
  "src/hooks/useOpenClaw.ts":
    "Orphaned hook for a gateway integration that is not imported anywhere.",
  "src/components/conflicts/ConflictWarning.tsx":
    "Orphaned conflict banner; superseded by the server-owned task commands.",
  "src/hooks/useWidgetTheme.ts":
    "Orphaned summer-theme hook; the live weather skinning reads other tokens.",
  "src/components/ui/ModeTransition.tsx":
    "Orphaned mode cross-fade; the shell owns the page-settle transition instead.",
  "src/components/ui/PetAvatar.tsx": "Orphaned avatar variant; `Avatar` covers it.",
  "src/components/ui/SigmaAvatar.tsx": "Orphaned avatar variant; `Avatar` covers it.",
  // ── Second wave: orphaned BY the deletions above, not pre-existing debt ──
  "src/components/integrations/ProductSearchWidget.tsx":
    "Imported only by the deleted `AdultHome.tsx`; nothing in src/, tests/ or scripts/ referenced it.",
  "src/components/integrations/TravelTimeCard.tsx":
    "Imported only by the deleted `AdultHome.tsx`; nothing in src/, tests/ or scripts/ referenced it.",
  "src/components/ui/InstacartButton.tsx":
    "Imported only by the deleted `AdultHome.tsx`; nothing in src/, tests/ or scripts/ referenced it.",
};

function allSource(): string[] {
  return globSync(join(process.cwd(), "src/**/*.{ts,tsx}"))
    .concat(globSync(join(process.cwd(), "tests/**/*.{ts,tsx}")))
    .concat(globSync(join(process.cwd(), "scripts/**/*.{mjs,ts}")));
}

describe("unwired modules stay deleted", () => {
  it("every entry is actually gone from the working tree", () => {
    for (const [rel, why] of Object.entries(DELETED)) {
      expect(why.length, `${rel} needs a written reason`).toBeGreaterThan(20);
      expect(
        existsSync(join(process.cwd(), rel)),
        `${rel} must stay deleted — nothing imported it`
      ).toBe(false);
    }
  });

  it("nothing in src/, tests/ or scripts/ references them again", () => {
    // A surviving import would break the build at best, or silently re-wire a
    // screen that was deliberately retired at best.
    const names = Object.keys(DELETED).map((p) => p.replace(/^.*\//, "").replace(/\.tsx?$/, ""));
    const offenders: string[] = [];
    for (const f of allSource()) {
      const src = readFileSync(f, "utf8");
      for (const n of names) {
        if (new RegExp(`from\\s+["'][^"']*/${n}["']`).test(src)) offenders.push(`${f} → ${n}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("modes.css no longer claims the deleted screens are 'unwired'", () => {
    const css = readFileSync(join(process.cwd(), "src/modes/modes.css"), "utf8");
    expect(
      css,
      "modes.css must not describe deleted files as current state"
    ).not.toMatch(/FamilyHome|AdultHome/);
  });
});
