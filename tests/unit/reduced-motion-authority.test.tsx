// @vitest-environment jsdom
/**
 * The in-app "Reduce motion" toggle must be AUTHORITATIVE for every JS-driven
 * animation, not just for CSS.
 *
 * The bug this locks down: thirteen animation sites called
 * `window.matchMedia("(prefers-reduced-motion: reduce)")` themselves instead of
 * going through the app's own preference reader. That query only knows about the
 * OS — so on the shared wall (a kiosk whose OS never asks) the Settings →
 * Appearance toggle did nothing at all, and only the OS preference reached them.
 *
 * The fix is one owner (`src/hooks/useReducedMotionPreference.ts`) that composes
 * BOTH inputs — the OS media query AND `<html data-reduce-motion="true">`, the
 * attribute `ThemeProvider` mirrors the user's toggle onto — plus a source
 * contract so a fourteenth direct call cannot reappear silently.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, globSync } from "fs";
import { join } from "path";
import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import {
  MOTION_PREFERENCE_EVENT,
  inAppReduceMotionEnabled,
  readReducedMotionPreference,
  usePrefersReducedMotion,
} from "@/hooks/useReducedMotionPreference";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** OS-level preference, independent of anything the app stored. */
let osReduced = false;

function stubMatchMedia() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? osReduced : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

/** What `ThemeProvider` does when the family flips the Settings → Appearance toggle. */
function setInAppToggle(on: boolean) {
  if (on) document.documentElement.setAttribute("data-reduce-motion", "true");
  else document.documentElement.removeAttribute("data-reduce-motion");
  window.dispatchEvent(new Event(MOTION_PREFERENCE_EVENT));
}

beforeEach(() => {
  osReduced = false;
  setInAppToggle(false);
  document.documentElement.removeAttribute("data-reduce-motion");
  stubMatchMedia();
});

afterEach(() => {
  document.documentElement.removeAttribute("data-reduce-motion");
  vi.unstubAllGlobals();
});

let root: Root | null = null;
function render(ui: ReactElement) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => {
    root = createRoot(el);
    root.render(ui);
  });
  return el;
}
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("readReducedMotionPreference composes the OS query AND the in-app toggle", () => {
  it("honours the in-app toggle on its own, with the OS saying no", () => {
    // The reported bug exactly: the wall kiosk's OS never sets reduce, so only
    // the family's own Settings choice is in play here.
    osReduced = false;
    setInAppToggle(true);
    expect(readReducedMotionPreference()).toBe(true);
  });

  it("honours the OS preference on its own, with the in-app toggle off", () => {
    osReduced = true;
    setInAppToggle(false);
    expect(readReducedMotionPreference()).toBe(true);
  });

  it("is false only when neither input asks for less motion", () => {
    osReduced = false;
    setInAppToggle(false);
    expect(readReducedMotionPreference()).toBe(false);
  });

  it("reads the in-app toggle off <html>, not off localStorage", () => {
    setInAppToggle(true);
    expect(inAppReduceMotionEnabled()).toBe(true);
    document.documentElement.removeAttribute("data-reduce-motion");
    expect(inAppReduceMotionEnabled()).toBe(false);
  });

  it("treats a missing matchMedia (SSR / jsdom) as no OS preference, not a crash", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(readReducedMotionPreference()).toBe(false);
    setInAppToggle(true);
    expect(readReducedMotionPreference()).toBe(true);
  });
});

describe("usePrefersReducedMotion reacts to both inputs mid-session", () => {
  /** Every value the hook returned, in render order — the first is the lazy init. */
  const seen: boolean[] = [];
  const Probe = () => {
    const reduced = usePrefersReducedMotion();
    seen.push(reduced);
    return createElement("span", null, reduced ? "reduced" : "motion");
  };
  beforeEach(() => {
    seen.length = 0;
  });

  it("reports motion on its very first render, so SSR and the first client paint agree", () => {
    osReduced = true;
    setInAppToggle(true);
    const el = render(<Probe />);
    expect(seen[0], "first render must not read the DOM — it would mismatch the server").toBe(false);
    expect(el.textContent).toBe("reduced");
  });

  it("lands on the composed answer after mount", () => {
    osReduced = true;
    setInAppToggle(true);
    const el = render(<Probe />);
    act(() => {});
    expect(el.textContent).toBe("reduced");
  });

  it("updates when the family flips the in-app toggle, with no reload", () => {
    const el = render(<Probe />);
    act(() => {});
    expect(el.textContent).toBe("motion");

    act(() => {
      setInAppToggle(true);
    });
    expect(el.textContent).toBe("reduced");
  });

  it("releases back to motion when the in-app toggle is turned back off", () => {
    act(() => {
      setInAppToggle(true);
    });
    const el = render(<Probe />);
    act(() => {});
    expect(el.textContent).toBe("reduced");

    act(() => {
      setInAppToggle(false);
    });
    expect(el.textContent).toBe("motion");
  });
});

/**
 * The source contract. Without this the bug is one careless `matchMedia` away
 * from coming back, because nothing at runtime can tell a bypassing call site
 * from a routed one.
 */
describe("no animation site reads the OS query behind the app's back", () => {
  /**
   * Deliberately NOT fixed by this agent: `Modal.tsx` is a dialog, owned
   * concurrently. It still reads the OS query directly, so it is the one
   * permitted exemption — named, so it can be deleted when that file is fixed.
   */
  const EXEMPT = new Set(["components/ui/Modal.tsx"]);

  const directCallers = () => {
    const out: string[] = [];
    for (const abs of globSync(join(process.cwd(), "src/**/*.tsx"))) {
      const rel = abs.replace(`${process.cwd()}/src/`, "");
      if (EXEMPT.has(rel)) continue;
      const src = readFileSync(abs, "utf8");
      src.split("\n").forEach((line, i) => {
        if (/matchMedia[\s\S]{0,80}prefers-reduced-motion|prefers-reduced-motion[\s\S]{0,80}matchMedia/.test(line)) {
          out.push(`${rel}:${i + 1}`);
        }
      });
    }
    return out;
  };

  it("finds no direct matchMedia(prefers-reduced-motion) outside the one exemption", () => {
    expect(directCallers()).toEqual([]);
  });

  it("keeps the exemption list honest — Modal is still the only file needing it", () => {
    const modal = readFileSync(join(process.cwd(), "src/components/ui/Modal.tsx"), "utf8");
    expect(modal).toMatch(/matchMedia[\s\S]{0,80}prefers-reduced-motion/);
  });

  it("routes the owned call sites through the one owner", () => {
    const owner = readFileSync(join(process.cwd(), "src/hooks/useReducedMotionPreference.ts"), "utf8");
    expect(owner).toContain('"(prefers-reduced-motion: reduce)"');

    /**
     * Files that make their own motion decision and must therefore read the
     * preference themselves. `WeeklyWinModal` is deliberately absent: its guard
     * moved INTO `ConfettiBurst`, so the component owns the decision and no
     * caller can forget one.
     */
    const routed = [
      "components/ui/Toast.tsx",
      "components/ui/FogBackground.tsx",
      "components/ui/WxToys.tsx",
      "components/ui/WeatherWidget.tsx",
      "components/ui/ConfettiBurst.tsx",
      "components/photos/PhotosWidget.tsx",
      "components/settings/HomeSettingsSection.tsx",
      "app/chat/page.tsx",
      "app/calendar/page.tsx",
      "app/tasks/page.tsx",
    ];
    for (const rel of routed) {
      const src = readFileSync(join(process.cwd(), "src", rel), "utf8");
      expect(
        src,
        `${rel} must read the app's own reduced-motion preference, not window.matchMedia`,
      ).toMatch(/useReducedMotionPreference/);
    }
  });

  it("gates the confetti burst in the component, not in each caller", () => {
    // The old contract documented "callers own the reduced-motion guard", which
    // is why two call sites got it wrong. The gate now lives in the component.
    const burst = readFileSync(join(process.cwd(), "src/components/ui/ConfettiBurst.tsx"), "utf8");
    expect(burst).toMatch(/usePrefersReducedMotion\(\)/);
    expect(burst).toMatch(/if \(!active \|\| reduceMotion\) return null;/);
  });
});