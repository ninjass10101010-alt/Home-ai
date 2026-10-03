// @vitest-environment jsdom
/**
 * WCAG 2.2.2 Pause, Stop, Hide (Level A) on the wall photo tile.
 *
 * The tile autoplays: a ~75s timer crossfades to the next family photo, with no
 * control of any kind to stop it. That is a Level A failure, and it was worse
 * than a plain omission — the only reduced-motion handling shortened the
 * crossfade, while the ROTATION itself (the thing that actually keeps moving
 * content moving) was never gated at all.
 *
 * The contract locked here:
 *  - a real, keyboard-reachable pause/play control exists (a `<button>`, not a
 *    div, not a gesture);
 *  - its state is exposed to assistive tech (`aria-pressed`) and its accessible
 *    name describes what it controls;
 *  - the control itself meets the house 44px tap-target floor via `.hit-44`;
 *  - pressing it stops the rotation dead;
 *  - under reduced motion the carousel does not autoplay AT ALL — it starts
 *    paused, whether reduced motion came from the OS or from the family's own
 *    Settings → Appearance toggle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import PhotosWidget from "@/components/photos/PhotosWidget";
import { MOTION_PREFERENCE_EVENT } from "@/hooks/useReducedMotionPreference";
import type { WallPhoto } from "@/db/features/photos";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

class FakeImage {
  static decoded: string[] = [];
  static failNext = false;
  src = "";
  complete = false;
  decoding = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decode(): Promise<void> {
    FakeImage.decoded.push(this.src);
    return FakeImage.failNext ? Promise.reject(new Error("decode failed")) : Promise.resolve();
  }
}

function shot(id: string): WallPhoto {
  return {
    id,
    url: `/api/photos/file?r=${id}&f=${id}.jpg`,
    width: 1600,
    height: 1000,
    takenAt: "2026-01-15T12:00:00.000Z",
    caption: `Photo ${id}`,
  };
}

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

/** What ThemeProvider does when the family flips the in-app toggle. */
function setInAppToggle(on: boolean) {
  if (on) document.documentElement.setAttribute("data-reduce-motion", "true");
  else document.documentElement.removeAttribute("data-reduce-motion");
  window.dispatchEvent(new Event(MOTION_PREFERENCE_EVENT));
}

const THREE = [shot("aaa"), shot("bbb"), shot("ccc")];

function stubFeed(photos: WallPhoto[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, photos }) })),
  );
}

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
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const ROTATE_MS = 1000;

function pauseControl(el: HTMLElement): HTMLButtonElement | null {
  return el.querySelector<HTMLButtonElement>('button[aria-pressed]');
}
const visibleSrc = (el: HTMLElement) =>
  el.querySelector("img:not(.wall-photo-incoming)")?.getAttribute("src") ?? "";

beforeEach(() => {
  vi.useFakeTimers();
  osReduced = false;
  document.documentElement.removeAttribute("data-reduce-motion");
  FakeImage.decoded = [];
  FakeImage.failNext = false;
  vi.stubGlobal("Image", FakeImage);
  stubMatchMedia();
  stubFeed(THREE);
  document.body.innerHTML = "";
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.documentElement.removeAttribute("data-reduce-motion");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PhotosWidget exposes a pause control (WCAG 2.2.2)", () => {
  it("renders a real button that keyboard activation reaches", async () => {
    const el = render(<PhotosWidget photos={THREE} rotateMs={ROTATE_MS} />);
    await flush();
    const btn = pauseControl(el);
    expect(btn, "the autoplaying carousel must offer a pause control").not.toBeNull();
    // A div with a click handler would satisfy a querySelector but not a keyboard.
    expect(btn!.tagName).toBe("BUTTON");
    expect(btn!.type).toBe("button");
  });

  it("names the control and exposes its state to assistive tech", async () => {
    const el = render(<PhotosWidget photos={THREE} rotateMs={ROTATE_MS} />);
    await flush();
    const btn = pauseControl(el)!;
    expect(btn.getAttribute("aria-label")).toMatch(/photo/i);
    // Not pressed = rotating; pressed = paused. A glyph-only control with no
    // label and no state would be invisible to a screen reader either way.
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("meets the house 44x44 tap-target floor via hit-44", async () => {
    const el = render(<PhotosWidget photos={THREE} rotateMs={ROTATE_MS} />);
    await flush();
    expect(pauseControl(el)!.className).toContain("hit-44");
  });

  it("stops rotating once paused, and resumes when pressed again", async () => {
    const el = render(<PhotosWidget photos={THREE} rotateMs={ROTATE_MS} />);
    await flush();
    expect(visibleSrc(el)).toContain("r=aaa");

    const btn = pauseControl(el)!;
    await act(async () => {
      btn.click();
    });
    expect(btn.getAttribute("aria-pressed")).toBe("true");

    // Two full rotation periods plus the crossfade commit window: a live timer
    // would have advanced at least one photo in this time.
    await tick(ROTATE_MS);
    await tick(ROTATE_MS);
    await tick(ROTATE_MS);
    expect(visibleSrc(el)).toContain("r=aaa");

    await act(async () => {
      btn.click();
    });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    await tick(ROTATE_MS);
    await tick(ROTATE_MS);
    expect(visibleSrc(el)).not.toContain("r=aaa");
  });

  it("starts paused and never autoplays under reduced motion from the OS", async () => {
    osReduced = true;
    const el = render(<PhotosWidget photos={THREE} rotateMs={ROTATE_MS} />);
    await flush();
    expect(pauseControl(el)!.getAttribute("aria-pressed")).toBe("true");
    await tick(ROTATE_MS);
    await tick(ROTATE_MS);
    await tick(ROTATE_MS);
    expect(visibleSrc(el)).toContain("r=aaa");
  });

  it("starts paused under the in-app toggle too, not just the OS setting", async () => {
    osReduced = false;
    setInAppToggle(true);
    const el = render(<PhotosWidget photos={THREE} rotateMs={ROTATE_MS} />);
    await flush();
    expect(pauseControl(el)!.getAttribute("aria-pressed")).toBe("true");
    await tick(ROTATE_MS);
    await tick(ROTATE_MS);
    await tick(ROTATE_MS);
    expect(visibleSrc(el)).toContain("r=aaa");
  });

  it("lets a reduced-motion user opt into rotation by hand", async () => {
    osReduced = true;
    const el = render(<PhotosWidget photos={THREE} rotateMs={ROTATE_MS} />);
    await flush();
    const btn = pauseControl(el)!;
    await act(async () => {
      btn.click();
    });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    await tick(ROTATE_MS);
    await tick(ROTATE_MS);
    expect(visibleSrc(el)).not.toContain("r=aaa");
  });

  it("offers no pause control when there is nothing to rotate", async () => {
    const el = render(<PhotosWidget photos={[shot("only")]} rotateMs={ROTATE_MS} />);
    await flush();
    // A single static photo is not moving content, so 2.2.2 does not apply and
    // a dead control would be noise.
    expect(pauseControl(el)).toBeNull();
  });
});