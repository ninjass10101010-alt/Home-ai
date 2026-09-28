// @vitest-environment jsdom
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import Chip from "@/components/ui/Chip";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * UI audit Phase 5.2 — design-system convergence: the legacy `Card` / `Button`
 * / `Badge` trio is gone (callers use `Surface` / `SoftButton` / `Chip`), and
 * the local `--color-text-*` re-scopes Phase 1 made redundant are retired.
 */

const ROOT = process.cwd();
const LEGACY = ["Card", "Button", "Badge"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}

function sourceFiles(): string[] {
  return [...walk(join(ROOT, "src")), ...walk(join(ROOT, "tests"))];
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("design-system convergence (audit 5.2)", () => {
  it("the legacy Card/Button/Badge components stay deleted", () => {
    for (const name of LEGACY) {
      expect(existsSync(join(ROOT, "src/components/ui", `${name}.tsx`)), `${name}.tsx must stay deleted`).toBe(false);
    }
  });

  it("no source file imports or renders the legacy components", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const src = readFileSync(file, "utf8");
      for (const name of LEGACY) {
        if (src.includes(`components/ui/${name}`)) offenders.push(`${file}: imports ${name}`);
        if (new RegExp(`<${name}\\b`).test(src)) offenders.push(`${file}: renders <${name}>`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("globals.css carries no local --color-text-* re-scopes (widget cards or kitchen)", () => {
    const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
    expect(css, ".kitchen-text is retired").not.toContain(".kitchen-text {");
    for (const selector of [".widget-card {", ':root:not([data-theme="dark"]) .widget-card {']) {
      const start = css.indexOf(selector);
      expect(start, `selector ${selector} must exist`).toBeGreaterThan(-1);
      const block = css.slice(start, css.indexOf("}", start));
      expect(block, `${selector} must not re-scope text tokens`).not.toContain("--color-text-secondary");
      expect(block, `${selector} must not re-scope text tokens`).not.toContain("--color-text-muted");
    }
  });

  it("Chip renders a passive label as a span (Badge's static case), not a button", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    act(() => createRoot(host).render(<Chip as="span" tone="violet" size="sm">AI picks</Chip>));
    const el = host.querySelector("span");
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe("AI picks");
    expect(el!.className).toContain("--color-accent-violet");
    expect(el!.className, "a label must not claim a tap target").not.toContain("hit-44");
    expect(host.querySelector("button")).toBeNull();
  });
});
