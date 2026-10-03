// Every shipped route renders through `PageShell`, so the dock is reachable
// everywhere and no page is a dead end.
//
// `/memory` broke this: it rendered a bare `min-h-screen bg-background` div with
// no `PageShell`, no dock and no back control, yet Phase 3's `More…` sheet
// (nav-items.ts) put "Family Memory" in front of parents. Tapping it landed on a
// screen with no way out except the browser's own back button.
//
// This is the same shape as the repo's existing no-orphan contract
// (`nav-items.test.ts` walks every `src/app/**/page.tsx` and fails on a route
// that is neither in the manifest nor in `EXEMPT_ROUTES` with a written
// reason) — a walk plus an explicit, justified exemption list, so a NEW bare
// route cannot ship.
//
// The walk follows local `@/…` imports rather than grepping one file. The six
// `/settings/*` routes delegate to `SettingsSectionView`, which owns the shell,
// and a naive single-file scan reports them as seven dead ends — a false
// positive that would push someone to "fix" correct code. Depth is capped so an
// import cycle cannot hang the suite.
//
// A static scan, not a render: the question is about structure, and a render
// test would need the auth/PB mocks every page pulls in.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "fs";
import { globSync } from "fs";
import { join, relative } from "path";

/** Routes that legitimately do not render the shell, each with the reason. */
const SHELL_EXEMPT: Record<string, string> = {
  "src/app/design-system/page.tsx":
    "Dev-only design-system preview with its own live self-audit; production-gated and never linked from the dock or the More… sheet.",
  "src/app/grocery/page.tsx":
    "A pure `redirect('/meals?tab=grocery')` — it renders no UI at all, so there is nothing to give a shell or a dock to.",
  "src/app/screensaver/page.tsx":
    "The full-screen wall board. `CacheRefresher` special-cases it so the ApoloSign wall can sleep, and nav chrome on a sleeping wall is the wrong shape; it is reached by a typed URL only.",
  "src/app/settings/[section]/page.tsx":
    "The unknown-section fallback: it calls `notFound()` and returns null, so it renders no UI of its own — the 404 it raises is rendered elsewhere.",
  "src/app/meals/archive/page.tsx":
    "A full-screen drill-down that already carries its own `aria-label=\"Back to meal planner\"` control, so it is not a dead end. Giving it the shared dock as well is a UX decision, not a correctness fix — tracked, not silently dropped.",
};

/**
 * The same dead-end problem, one level up: an error/loading segment REPLACES the
 * route it interrupts, so if it renders no shell the dock disappears exactly when
 * the family most needs to navigate away. `page.tsx` walking cannot see this — an
 * `error.tsx` is not a `page.tsx`.
 *
 * `src/app/global-error.tsx` is the one structural exception, and it is a
 * platform constraint rather than a choice: Next replaces the whole root layout
 * there (the file must emit its own `<html>`/`<body>`), so there is no
 * `AuthProvider` — `useAuth` throws outside one, and `CapsuleNav` reads it — and
 * no `globals.css`, so every token is unavailable. It therefore owes a *hard*
 * escape instead, pinned below.
 */
const SEGMENT_SHELL_EXEMPT: Record<string, string> = {
  "src/app/global-error.tsx":
    "Next replaces the entire root layout here, so this file must emit its own <html>/<body> and has no AuthProvider (useAuth throws) or globals.css. The dock is structurally impossible; the suite below pins its full-document <a href=\"/\"> instead.",
};

/** Route-error shells that owe a hydration-free, client-renderable way out. */
const SEGMENT_FILES = [
  "src/app/error.tsx",
  "src/app/loading.tsx",
  "src/app/settings/layout.tsx",
];

const MAX_DEPTH = 3;

function abs(rel: string): string {
  return join(process.cwd(), rel);
}

function pageFiles(): string[] {
  return globSync(abs("src/app/**/page.tsx")).map((f) => relative(process.cwd(), f));
}

/** Resolve the `@/…` alias (rooted at `src/`) to a real FILE, trying TS/TSX. */
function resolveAlias(spec: string): string | null {
  const base = join("src", spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    const p = abs(candidate);
    // A bare directory satisfies existsSync, and readFileSync on it throws EISDIR
    // — so the file check has to come first.
    if (existsSync(p) && statSync(p).isFile()) return candidate;
  }
  return null;
}

/**
 * Source with comments removed.
 *
 * A bare `\bPageShell\b` search false-positives on prose: `Modal.tsx:105`
 * explains that it portals to `<body>` because "rendered inline the overlay
 * inherits PageShell's clipping" — and `Modal` is transitively imported by the
 * design-system page, so a comment made that route look shell-covered.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Does this module, or anything it imports from `src/`, render PageShell? */
function reachesPageShell(rel: string, seen = new Set<string>(), depth = 0): boolean {
  if (seen.has(rel) || depth > MAX_DEPTH) return false;
  seen.add(rel);
  if (!existsSync(abs(rel)) || !statSync(abs(rel)).isFile()) return false;
  const raw = readFileSync(abs(rel), "utf8");
  if (/\bPageShell\b/.test(stripComments(raw))) return true;

  // Only `@/…` aliases resolve without a bundler; `next/*` and packages cannot
  // carry the shell.
  for (const m of raw.matchAll(/from\s+["']@\/([^"']+)["']/g)) {
    const target = resolveAlias(m[1]);
    if (target && reachesPageShell(target, seen, depth + 1)) return true;
  }
  return false;
}

describe("every route renders through PageShell", () => {
  it("found the app routes", () => {
    expect(pageFiles().length).toBeGreaterThan(10);
  });

  it("no route is a shell-less dead end", () => {
    const bare = pageFiles().filter((rel) => !reachesPageShell(rel));
    const unexplained = bare.filter((rel) => !(rel in SHELL_EXEMPT));
    expect(
      unexplained,
      "these routes reach no PageShell — wrap them, or add a SHELL_EXEMPT entry with a reason"
    ).toEqual([]);
    for (const rel of bare) {
      expect(SHELL_EXEMPT[rel].length, `${rel} needs a written reason`).toBeGreaterThan(20);
    }
  });

  it("has no stale exemptions (an exempt route must still not use the shell)", () => {
    const stale = Object.keys(SHELL_EXEMPT).filter((rel) => reachesPageShell(rel));
    expect(stale, "these routes adopted PageShell — drop the exemption").toEqual([]);
  });

  it("/memory specifically is no longer a dead end", () => {
    // Named explicitly so the fix that motivated this suite stays pinned: the
    // parent-reachable memory bank must reach the shell, and must not be able to
    // hide behind an exemption.
    expect(
      reachesPageShell("src/app/memory/page.tsx"),
      "/memory must render through PageShell"
    ).toBe(true);
    expect(
      "src/app/memory/page.tsx" in SHELL_EXEMPT,
      "/memory must not be exempt from the walk"
    ).toBe(false);
  });
});

describe("every error/loading segment keeps the dock reachable", () => {
  it("the interrupting segments it walks all exist", () => {
    for (const rel of SEGMENT_FILES) {
      expect(existsSync(abs(rel)), `${rel} must ship`).toBe(true);
    }
    expect(existsSync(abs("src/app/global-error.tsx"))).toBe(true);
  });

  it("no error or loading segment is a dock-less dead end", () => {
    const bare = SEGMENT_FILES.filter((rel) => !reachesPageShell(rel));
    const unexplained = bare.filter((rel) => !(rel in SEGMENT_SHELL_EXEMPT));
    expect(
      unexplained,
      "an error/loading segment replaces the route it interrupts — without PageShell there is no dock left to navigate with"
    ).toEqual([]);
    for (const rel of bare) {
      expect(SEGMENT_SHELL_EXEMPT[rel].length, `${rel} needs a written reason`).toBeGreaterThan(20);
    }
  });

  it("global-error is the only segment exempt from the shell, and says why", () => {
    expect(reachesPageShell("src/app/global-error.tsx")).toBe(false);
    expect(SEGMENT_SHELL_EXEMPT["src/app/global-error.tsx"]).toBeTruthy();
  });

  it("global-error still offers a full-document way back to Home", () => {
    // The one thing a root-layout failure can always offer: a plain anchor, which
    // works with no React, no providers and no hydration.
    const src = stripComments(readFileSync(abs("src/app/global-error.tsx"), "utf8"));
    expect(src).toMatch(/<a[\s\S]{0,400}href=["']\/["']/);
  });

  it("the root error boundary is the one that names the digest and retries", () => {
    // Not a structural check — a copy check, because the shell is only worth
    // rendering if the family can still act: retry, leave, and quote the code.
    const src = stripComments(readFileSync(abs("src/app/error.tsx"), "utf8"));
    expect(src).toContain("reset");
    expect(src).toContain("error.digest");
    expect(src).toMatch(/href=["']\/["']/);
  });
});
