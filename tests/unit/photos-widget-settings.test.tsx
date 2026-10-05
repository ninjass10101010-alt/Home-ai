// @vitest-environment jsdom
/**
 * T6 — photo widget settings wiring (spec §3).
 *
 * The widget now reads a shared, server-backed settings record. What is worth
 * locking down here is the CONTRACT between that record and the tile:
 *
 *  - the rotation cadence follows `rotateSeconds`, while the `rotateMs` prop
 *    keeps its test-seam precedence (§3.2);
 *  - `showCaption` gates the caption AND its scrim together (§3.6);
 *  - each transition renders its own classes and beats: crossfade as today,
 *    dissolve's veil covering a timed swap, slide's in/out transforms, cut's
 *    frame-armed instant commit (§3.3/§3.4);
 *  - reduced motion forces a hard cut even over an explicit `slide` — via
 *    `usePrefersReducedMotion`, never a raw matchMedia (§3.5, contract test);
 *  - a FAILED settings read still shows the family's photo (§3, amendment 2);
 *  - `refresh()` rides the rotation instead of polling (§3.1);
 *  - changing `order` refires the feed load with `?order=` (§3.7).
 *
 * The fetch router always answers `/api/photos/settings` with a settings body
 * and everything else with the feed; the two pre-existing widget suites stub
 * EVERY url with feed JSON, which this hook is required to normalise silently.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import PhotosWidget from "@/components/photos/PhotosWidget";
import type { WallPhoto } from "@/db/features/photos";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

/** Reduced motion is an INPUT here, toggled per test — mocked at the authority
 *  hook (the contract test forbids this component from reading matchMedia). */
const reducedMotionMock = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/hooks/useReducedMotionPreference", () => ({
  usePrefersReducedMotion: () => reducedMotionMock(),
}));

/** jsdom never decodes images, and the widget waits on decode() to composite. */
class FakeImage {
  static failNext = false;
  static decoded: string[] = [];
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

const THREE = [shot("aaa"), shot("bbb"), shot("ccc")];

interface SettingsPayload {
  ok: boolean;
  settings?: Record<string, unknown>;
  degraded?: boolean;
}

/** Mutable so a test can change what the NEXT settings GET returns. */
let settingsBody: SettingsPayload;

function stubFetch(opts: { rejectSettings?: boolean } = {}, photos: WallPhoto[] = THREE) {
  const mock = vi.fn(async (url?: unknown) => {
    const u = String(url);
    if (u.includes("/api/photos/settings")) {
      if (opts.rejectSettings) throw new Error("settings unreachable");
      // Read the CURRENT body, so a test can change what the next GET returns.
      return { ok: true, status: 200, json: async () => settingsBody };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, photos }) };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const callsTo = (mock: ReturnType<typeof vi.fn>, part: string) =>
  mock.mock.calls.filter(([url]) => String(url).includes(part));

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
  // advanceTimersByTimeAsync flushes the microtasks each timer callback
  // queues — the rotation path awaits image.decode() and the fetch chain
  // before it lands state.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const visibleImg = (el: HTMLElement) => el.querySelector("img:not(.wall-photo-incoming)");
const incomingImg = (el: HTMLElement) => el.querySelector("img.wall-photo-incoming");

beforeEach(() => {
  vi.useFakeTimers();
  FakeImage.failNext = false;
  FakeImage.decoded = [];
  vi.stubGlobal("Image", FakeImage);
  reducedMotionMock.mockReturnValue(false);
  settingsBody = { ok: true, settings: { rotateSeconds: 75, transition: "crossfade", order: "shuffle", showCaption: true } };
  document.body.innerHTML = "";
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("rotation cadence (spec §3.2)", () => {
  it("honours the shared rotateSeconds instead of the old 75s constant", async () => {
    settingsBody = { ok: true, settings: { rotateSeconds: 20 } };
    stubFetch();
    render(<PhotosWidget />); // no rotateMs prop — the setting drives it
    await flush();

    await tick(19_000); // before 20s: nothing has been decoded for rotation
    expect(FakeImage.decoded).toHaveLength(0);
    await tick(1_500); // past 20s — and nowhere near the old 75s
    expect(FakeImage.decoded).toHaveLength(1);
  });

  it("keeps the rotateMs prop as the override that wins over the setting", async () => {
    settingsBody = { ok: true, settings: { rotateSeconds: 600 } };
    stubFetch();
    render(<PhotosWidget rotateMs={1000} />);
    await flush();

    await tick(1000);
    expect(FakeImage.decoded).toHaveLength(1); // 1s, not the 600s setting
  });
});

describe("caption and scrim (spec §3.6)", () => {
  it("hides the caption AND the scrim together when showCaption is false", async () => {
    settingsBody = { ok: true, settings: { showCaption: false } };
    stubFetch();
    const el = render(<PhotosWidget />);
    await flush();

    expect(visibleImg(el)).not.toBeNull(); // the photo itself still renders
    expect(el.querySelector(".wall-photo-caption")).toBeNull();
    // The scrim with no caption is unexplained darkening across the photo.
    expect(el.querySelector(".wall-photo-scrim")).toBeNull();
  });

  it("shows both when showCaption is true (the default path)", async () => {
    settingsBody = { ok: true, settings: { showCaption: true } };
    stubFetch();
    const el = render(<PhotosWidget />);
    await flush();

    expect(el.querySelector(".wall-photo-caption")).not.toBeNull();
    expect(el.querySelector(".wall-photo-scrim")).not.toBeNull();
  });
});

describe("transition variants (spec §3.3)", () => {
  it("crossfade keeps today's layering: plain incoming layer, no veil", async () => {
    settingsBody = { ok: true, settings: { transition: "crossfade" } };
    stubFetch();
    const el = render(<PhotosWidget rotateMs={1000} />);
    await flush();

    await tick(1000); // rotation composites the incoming layer
    const incoming = incomingImg(el);
    expect(incoming).not.toBeNull();
    expect(incoming!.classList.contains("wall-photo-incoming")).toBe(true);
    expect(incoming!.classList.contains("is-slide")).toBe(false);
    expect(el.querySelector(".wall-photo-veil")).toBeNull();
    expect(el.querySelector(".wall-photo-outgoing")).toBeNull();
  });

  it("dissolve veils the swap: cover, commit under a full veil, reveal, unmount", async () => {
    settingsBody = { ok: true, settings: { transition: "dissolve" } };
    stubFetch();
    const el = render(<PhotosWidget rotateMs={1000} />);
    await flush();

    await tick(1000); // rotation: incoming lands, the veil mounts to cover
    expect(visibleImg(el)!.getAttribute("src")).toContain("r=aaa");
    const veil = el.querySelector(".wall-photo-veil");
    expect(veil, "dissolve must render its veil").not.toBeNull();
    expect(veil!.classList.contains("is-armed")).toBe(false); // fade-in not started

    await tick(50); // the arm frame: veil fades toward full opacity
    expect(el.querySelector(".wall-photo-veil")!.classList.contains("is-armed")).toBe(true);

    await tick(350); // commit lands (arm + 300ms) — swap happens UNDER the veil
    expect(visibleImg(el)!.getAttribute("src")).toContain("r=bbb");
    expect(el.querySelector(".wall-photo-veil"), "veil reveals after the swap").not.toBeNull();
    expect(el.querySelector(".wall-photo-veil")!.classList.contains("is-armed")).toBe(false);

    await tick(350); // the 300ms reveal finishes and the veil unmounts
    expect(el.querySelector(".wall-photo-veil")).toBeNull();
  });

  it("slide slides the shown layer out and the incoming layer in", async () => {
    settingsBody = { ok: true, settings: { transition: "slide" } };
    stubFetch();
    const el = render(<PhotosWidget rotateMs={1000} />);
    await flush();

    await tick(1000);
    const incoming = incomingImg(el);
    expect(incoming!.classList.contains("is-slide")).toBe(true);
    // The SHOWN layer is the one walking left, and the tile backs black.
    const shown = visibleImg(el)!;
    expect(shown.classList.contains("wall-photo-outgoing")).toBe(true);
    expect(shown.classList.contains("is-armed")).toBe(false);
    expect(el.querySelector(".wall-photo-tile")!.classList.contains("is-sliding")).toBe(true);
    expect(el.querySelector(".wall-photo-veil")).toBeNull(); // slide never veils

    await tick(50); // armed: both transforms run
    expect(incomingImg(el)!.classList.contains("is-armed")).toBe(true);
    expect(visibleImg(el)!.classList.contains("is-armed")).toBe(true);
  });

  it("cut commits on the arm frame with no transition class at all", async () => {
    settingsBody = { ok: true, settings: { transition: "cut" } };
    stubFetch();
    const el = render(<PhotosWidget rotateMs={1000} />);
    await flush();

    await tick(1000);
    const incoming = incomingImg(el);
    expect(incoming).not.toBeNull();
    expect(incoming!.classList.contains("is-slide")).toBe(false);
    expect(incoming!.classList.contains("is-instant")).toBe(true);
    expect(el.querySelector(".wall-photo-veil")).toBeNull();

    await tick(50); // arm frame + 0ms commit — no 720ms crossfade budget
    expect(visibleImg(el)!.getAttribute("src")).toContain("r=bbb");
    expect(incomingImg(el)).toBeNull();
  });

  it("reduced motion forces a hard cut over an explicit slide selection", async () => {
    // The app preference (OS OR in-app toggle) is authoritative — §3.5.
    reducedMotionMock.mockReturnValue(true);
    settingsBody = { ok: true, settings: { transition: "slide" } };
    stubFetch();
    const el = render(<PhotosWidget rotateMs={1000} />);
    await flush();

    // Reduced motion starts the carousel paused; the family may press play.
    const btn = el.querySelector<HTMLButtonElement>('button[aria-pressed]');
    expect(btn!.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      btn!.click();
    });

    await tick(1000);
    const incoming = incomingImg(el);
    expect(incoming, "rotation must still happen (burn-in requirement)").not.toBeNull();
    expect(incoming!.classList.contains("is-slide"), "reduced motion overrides the slide").toBe(false);
    expect(incoming!.classList.contains("is-instant")).toBe(true);
    expect(el.querySelector(".wall-photo-tile")!.classList.contains("is-sliding")).toBe(false);
  });
});

describe("settings failure and refresh cadence (spec §3, §3.1)", () => {
  it("still shows the family's photo when the settings GET fails", async () => {
    const fetchMock = stubFetch({ rejectSettings: true });
    const el = render(<PhotosWidget />);
    await flush();

    // Defaults render silently: the read failed, the wall did not.
    expect(visibleImg(el)).not.toBeNull();
    expect(visibleImg(el)!.getAttribute("src")).toContain("r=aaa");
    expect(el.querySelector(".wall-photo-caption")).not.toBeNull(); // default showCaption
    expect(callsTo(fetchMock, "/api/photos/settings")).toHaveLength(1);
    expect(callsTo(fetchMock, "/api/photos?")).toHaveLength(1);
  });

  it("refreshes the settings after an advance instead of polling", async () => {
    settingsBody = { ok: true, settings: { rotateSeconds: 75 } };
    const fetchMock = stubFetch();
    render(<PhotosWidget rotateMs={1000} />);
    await flush();
    expect(callsTo(fetchMock, "/api/photos/settings")).toHaveLength(1); // mount GET

    await tick(1000); // one successful advance
    // §3.1: the rotation carries the refresh — one GET per advance, no timer.
    expect(callsTo(fetchMock, "/api/photos/settings").length).toBeGreaterThanOrEqual(2);
  });
});

describe("order threading (spec §3.7)", () => {
  it("refires the feed load with the new ?order= when the setting changes", async () => {
    settingsBody = { ok: true, settings: { order: "shuffle" } };
    const fetchMock = stubFetch();
    render(<PhotosWidget />);
    await flush();

    const feedCalls = () => callsTo(fetchMock, "/api/photos?");
    expect(feedCalls()).toHaveLength(1);
    expect(String(feedCalls()[0][0])).toContain("order=shuffle");

    // The family switches the order on their phone; the wall refetches on
    // visibility, `load`'s identity changes, and the mount effect reseeds.
    settingsBody = { ok: true, settings: { order: "newest" } };
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();

    expect(feedCalls().length).toBeGreaterThanOrEqual(2);
    expect(feedCalls().some(([url]) => String(url).includes("order=newest"))).toBe(true);
  });
});
