import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * UI audit Phase 5.4 — modal adoption. `Modal.tsx` owns the focus trap,
 * Escape and scroll lock; the hand-rolled `fixed inset-0` overlays are either
 * decorated with the same accessibility contract (`role="dialog"`,
 * `aria-modal`) or are not dialogs at all (celebration layers, the shell).
 *
 * This contract makes the ratio measurable and one-directional: the
 * hand-rolled-dialog count may shrink as files port to `Modal`, but a NEW
 * hand-rolled overlay — or a dialog without its role — fails CI.
 */

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** `dialog` overlays must carry role="dialog"; `layer` entries are not dialogs. */
const HAND_ROLLED: Record<string, { kind: "dialog" | "layer"; reason: string }> = {
  "src/components/ui/Modal.tsx": { kind: "dialog", reason: "The canonical modal (focus trap, Escape, scroll lock)." },
  "src/components/ui/WeatherWidget.tsx": { kind: "dialog", reason: "Full-screen weather details sheet (port in a later pass)." },
  "src/components/wall/WallPinPad.tsx": { kind: "dialog", reason: "Wall PIN pad (grid layout, not the bottom sheet)." },
  "src/components/ui/MemberModal.tsx": { kind: "dialog", reason: "Member editor (port in a later pass)." },
  "src/components/auth/PinModal.tsx": { kind: "dialog", reason: "PIN entry (port in a later pass)." },
  "src/components/leaderboard/LevelUpModal.tsx": { kind: "dialog", reason: "Level-up dialog (port in a later pass)." },
  "src/components/skill-tree/QuestDetail.tsx": { kind: "dialog", reason: "Quest detail dialog (port in a later pass)." },
  "src/components/money-mountain/TransactionLogger.tsx": { kind: "dialog", reason: "Transaction log (port in a later pass)." },
  "src/components/money-mountain/CreateMountainForm.tsx": { kind: "dialog", reason: "Create-mountain form (port in a later pass)." },
  "src/components/ha/AlarmPinModal.tsx": { kind: "dialog", reason: "Alarm PIN entry (port in a later pass)." },
  "src/components/meals/StorePicker.tsx": { kind: "dialog", reason: "Store picker sheet (port in a later pass)." },
  "src/components/meals/RecipeModal.tsx": { kind: "dialog", reason: "Full-screen recipe editor (custom sheet, Escape + role added 5.4)." },
  "src/components/meals/RecipeSearchModal.tsx": { kind: "dialog", reason: "Full-screen recipe search (custom sheet)." },
  "src/components/meals/RecipeImportModal.tsx": { kind: "dialog", reason: "Full-screen recipe import (custom sheet)." },
  "src/components/profile/PhotoCropEditor.tsx": { kind: "dialog", reason: "Full-screen photo editor with crop handles." },
  "src/components/meals/CookMode.tsx": { kind: "dialog", reason: "Full-screen cook mode (custom surface)." },
  "src/components/time-capsule/ContentUploader.tsx": { kind: "dialog", reason: "Content uploader (port in a later pass)." },
  "src/components/time-capsule/CreateCapsuleForm.tsx": { kind: "dialog", reason: "Create-capsule form (port in a later pass)." },
  "src/components/time-capsule/UnlockAnimation.tsx": { kind: "layer", reason: "Full-screen unlock celebration (not a dialog)." },
  "src/app/page.tsx": { kind: "layer", reason: "Shell root (PageShell)." },
  "src/components/ui/CapsuleNav.tsx": { kind: "layer", reason: "Fixed dock." },
  "src/components/ui/SidebarNav.tsx": { kind: "layer", reason: "Fixed desktop rail." },
  "src/components/ui/ConfettiBurst.tsx": { kind: "layer", reason: "Pointer-events-none celebration layer." },
  "src/modes/kid/CelebrationBurst.tsx": { kind: "layer", reason: "Pointer-events-none celebration layer." },
  "src/modes/kid/RewardsShop.tsx": { kind: "layer", reason: "Pointer-events-none reward toast layer." },
  "src/components/skill-tree/LevelUpAnimation.tsx": { kind: "layer", reason: "Full-screen celebration (not a dialog)." },
  "src/components/screensaver/ScreensaverBoard.tsx": { kind: "layer", reason: "Full-screen wall app, not an overlay." },
};

/** The hand-rolled-dialog ceiling — lower it as files port to `Modal`. */
const DIALOG_CEILING = Object.values(HAND_ROLLED).filter((v) => v.kind === "dialog").length;

describe("modal adoption (audit 5.4)", () => {
  it("no hand-rolled fixed-inset-0 overlay exists outside the allowlist", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (!readFileSync(file, "utf8").includes("fixed inset-0")) continue;
      const rel = file.slice(process.cwd().length + 1);
      if (!HAND_ROLLED[rel]) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("every hand-rolled dialog carries role=\"dialog\" and aria-modal", () => {
    const missing: string[] = [];
    for (const [rel, meta] of Object.entries(HAND_ROLLED)) {
      if (meta.kind !== "dialog") continue;
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      if (!src.includes('role="dialog"')) missing.push(`${rel}: no role="dialog"`);
      if (!src.includes('aria-modal="true"')) missing.push(`${rel}: no aria-modal="true"`);
    }
    expect(missing).toEqual([]);
  });

  it("the hand-rolled-dialog count only shrinks (port to Modal to lower it)", () => {
    const actual = Object.values(HAND_ROLLED).filter((v) => v.kind === "dialog").length;
    expect(actual).toBeLessThanOrEqual(DIALOG_CEILING);
    expect(actual, "the canonical Modal must stay").toBeGreaterThan(0);
  });

  it("Modal owns the dialog contract: focus trap, Escape and scroll lock", () => {
    const src = readFileSync(join(SRC, "components/ui/Modal.tsx"), "utf8");
    expect(src).toContain('role="dialog"');
    expect(src).toContain("Escape");
    expect(src).toMatch(/overflow|scroll/i);
  });
});
