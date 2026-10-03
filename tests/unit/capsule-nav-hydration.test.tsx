// The dock must never paint a role it cannot prove.
//
// `useAuth` starts with `currentUser === null` and only fills it in from
// localStorage inside a mount effect, so before `hydrated` flips the role is
// genuinely unknown — `navRoleForUser(null)` returns "guest". For a parent and a
// guest the cap list is identical, so the flash was invisible there; for a kid it
// was not: a child's dock rendered the parent's **House** cap (Home Assistant,
// which `HOUSE_ROLES` deliberately withholds from kids) for a frame, and a fast
// tap could land a child on an adult screen. Both Settings surfaces
// (`SettingsSectionView`, the Settings launcher) already wait on `hydrated`.
//
// Rendering nothing until hydration is also what makes the dock hydration-safe:
// the previous behaviour rendered different caps on the server than the client
// could end up with. The dock is `fixed`, so hiding it costs no layout.
//
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mutable so one render can straddle the hydration boundary. */
const auth = vi.hoisted(() => ({
  currentUser: null as { role: string; name: string } | null,
  hydrated: false,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useWallMode", () => ({ useWallMode: () => ({ wall: false }) }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

import CapsuleNav from "@/components/ui/CapsuleNav";

const RAW = readFileSync(join(process.cwd(), "src/components/ui/CapsuleNav.tsx"), "utf8");

/**
 * Source with comments removed. This component's own header explains the audit
 * finding in prose — "a `pathname === href` check that disagreed with the desktop
 * rail" — so an unstripped scan reads the history of the bug as the bug.
 */
const SRC = RAW
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** `const { currentUser, hydrated } = useAuth();` — or any destructure naming it. */
const DESTRUCTURE = /const\s*\{[^}]*\bhydrated\b[^}]*\}\s*=\s*useAuth\(\)/;

describe("CapsuleNav waits for auth before painting caps", () => {
  it("reads the hydrated flag out of useAuth", () => {
    expect(SRC).toMatch(DESTRUCTURE);
  });

  it("gates the caps on it rather than inferring a role from a null user", () => {
    const gate = /if\s*\(\s*!\s*hydrated\s*\)\s*(?:return null;|\{\s*return null;)/.exec(SRC);
    expect(
      gate,
      "CapsuleNav must render nothing until `hydrated` — navRoleForUser(null) reports guest, which is a kid's House-cap flash"
    ).toBeTruthy();
  });

  it("keeps the gate before the dock is rendered so no cap list is built from a guess", () => {
    const gateAt = SRC.search(/if\s*\(\s*!\s*hydrated\s*\)\s*(?:return null;|\{\s*return null;)/);
    // `<nav` is the dock's own markup; anything that reaches it has already
    // decided to paint caps.
    const dockAt = SRC.indexOf("<nav");
    expect(gateAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(dockAt);
  });
});

describe("CapsuleNav owns nothing but the capsule", () => {
  it("still reads every destination from the manifest", () => {
    expect(SRC).toContain("navItemsForRole");
    expect(SRC).toContain("navRoleForUser");
    expect(SRC).toContain("isNavItemActive");
  });

  it("adds no second nav surface, icon set or hard-coded route", () => {
    // The single-nav contract: the dock may not inline a path list or its own
    // active-item check. `href="/..."` appearing anywhere would be a second nav.
    expect(SRC).not.toMatch(/href=["']\//);
    expect(SRC).not.toMatch(/pathname\s*===/);
  });
});

let root: Root | null = null;

function mount(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => {
    root = createRoot(el);
    root.render(<CapsuleNav />);
  });
  return el;
}

function labels(el: HTMLElement): (string | null)[] {
  return Array.from(el.querySelectorAll("nav button")).map((b) => b.getAttribute("aria-label"));
}

describe("a kid never sees the parent's House cap before auth hydrates", () => {
  beforeEach(() => {
    auth.hydrated = false;
    auth.currentUser = null;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    document.body.innerHTML = "";
  });

  it("paints no caps at all while the role is unknown", () => {
    const el = mount();
    expect(labels(el)).toEqual([]);
    expect(el.querySelector("nav")).toBeNull();
  });

  it("swaps to the kid capsule on hydration, never through a House frame", () => {
    auth.currentUser = { role: "child", name: "Caspian" };
    const el = mount();
    expect(labels(el)).toEqual([]);

    auth.hydrated = true;
    act(() => {
      root!.render(<CapsuleNav />);
    });

    const painted = labels(el);
    expect(painted).toEqual(["Home", "Ask", "Meals", "Tasks", "Rewards", "Calendar", "Settings"]);
    expect(painted).not.toContain("House");
  });

  it("gives a parent the same seven caps it always had", () => {
    auth.hydrated = true;
    auth.currentUser = { role: "parent", name: "Jeffery" };
    const el = mount();
    expect(labels(el)).toEqual(["Home", "Ask", "Meals", "Tasks", "Calendar", "House", "Settings"]);
  });

  it("still shows the wall's guest capsule once a signed-out session has hydrated", () => {
    auth.hydrated = true;
    auth.currentUser = null;
    const el = mount();
    expect(labels(el)).toHaveLength(7);
  });
});