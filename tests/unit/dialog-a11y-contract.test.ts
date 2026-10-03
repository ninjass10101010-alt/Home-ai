import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * P1 remediation — the dialog accessibility contract.
 *
 * 17 of the app's 18 `aria-modal` dialogs were decorative: no focus trap, no
 * Escape, no focus return. `src/components/ui/useDialogA11y.ts` is now the one
 * implementation, and this file makes it structural rather than a convention:
 * a NEW dialog cannot opt out by forgetting to wire the hook.
 */

const SRC = join(process.cwd(), "src");
const HOOK = join(SRC, "components/ui/useDialogA11y.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** Every `*.tsx` that declares a modal dialog (the hook's own doc block quotes
 *  `aria-modal="true"`, so it is excluded — it is the implementation). */
function modalDialogs(): { rel: string; src: string }[] {
  return walk(SRC)
    .map((file) => ({ rel: file.slice(process.cwd().length + 1), src: readFileSync(file, "utf8") }))
    .filter(({ rel, src }) => rel !== "src/components/ui/useDialogA11y.ts" && src.includes('aria-modal="true"'));
}

/** A file may hold a dialog AND a widget with its own Escape. Each entry needs a
 *  written reason, and it does not exempt the dialog itself — only the widget. */
const ESCAPE_HANDLER_EXEMPT: Record<string, string> = {
  "src/components/ui/WeatherWidget.tsx":
    "The timeline scrubber's Escape resets the previewed hour. The Details dialog's Escape is the hook's.",
};

describe("dialog a11y adoption (P1)", () => {
  it("finds the dialogs it is meant to govern", () => {
    const rels = modalDialogs().map((d) => d.rel).sort();
    // Sanity floor: the app has more than the two that already worked.
    expect(rels.length).toBeGreaterThanOrEqual(18);
    expect(rels).toContain("src/components/ui/Modal.tsx");
    expect(rels).toContain("src/components/auth/PinModal.tsx");
    expect(rels).toContain("src/components/wall/WallPinPad.tsx");
    expect(rels).toContain("src/components/ha/AlarmPinModal.tsx");
    expect(rels).toContain("src/components/meals/RecipeModal.tsx");
    expect(rels).toContain("src/components/meals/CookMode.tsx");
  });

  it("routes EVERY modal dialog through the shared focus-trap hook", () => {
    const missing = modalDialogs()
      .filter(({ src }) => !src.includes("useDialogA11y"))
      .map(({ rel }) => rel);
    expect(missing).toEqual([]);
  });

  it("gives every wired dialog a focusable panel (tabIndex={-1})", () => {
    const missing = modalDialogs()
      .filter(({ src }) => src.includes("useDialogA11y") && !/role="dialog"[\s\S]{0,400}?tabIndex=\{-1\}|tabIndex=\{-1\}[\s\S]{0,400}?role="dialog"/.test(src))
      .map(({ rel }) => rel);
    expect(missing).toEqual([]);
  });

  it("leaves no bespoke dialog-level Escape listener behind", () => {
    // The hook owns Tab/Escape. A second dialog-level listener is how a
    // dialog ends up closing twice per keypress. Per-FIELD handlers (Enter to
    // submit, arrow keys on the weather slider) are unrelated and stay legal.
    const offenders = modalDialogs()
      .filter(({ src }) => /addEventListener\(\s*["']keydown["']/.test(src))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);

    const escapeHandlers = modalDialogs()
      .filter(({ rel, src }) => !ESCAPE_HANDLER_EXEMPT[rel] && /onKeyDown[\s\S]{0,400}?["']Escape["']/.test(src))
      .map(({ rel }) => rel);
    expect(escapeHandlers).toEqual([]);
  });

  it("keeps the focus trap independent of the exit animation", () => {
    // `prefers-reduced-motion` may decide how fast a dialog LEAVES; it must
    // never decide whether focus is managed. Comments may name it; code may not.
    const code = readFileSync(HOOK, "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/matchMedia/);
    expect(code).not.toMatch(/prefers-reduced-motion/);
    expect(code).not.toMatch(/requestAnimationFrame/);
  });

  it("excludes effectively disabled controls from the cycle, like the shared Modal", () => {
    const hook = readFileSync(HOOK, "utf8");
    expect(hook).toContain(":disabled");
  });

  it("moves focus in before hiding the background, and un-hides before restoring it", () => {
    const hook = readFileSync(HOOK, "utf8");
    const moveIn = hook.indexOf("initial.focus()");
    const hide = hook.indexOf("const marked = hideBackground");
    const unhide = hook.indexOf("unhideBackground(marked);");
    const restore = hook.indexOf("restoreFocus(triggerRef.current");
    expect(moveIn).toBeGreaterThan(-1);
    expect(hide).toBeGreaterThan(moveIn);
    expect(unhide).toBeGreaterThan(hide);
    expect(restore).toBeGreaterThan(unhide);
  });
});