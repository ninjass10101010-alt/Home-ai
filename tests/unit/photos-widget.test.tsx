// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import PhotosWidget from "@/components/photos/PhotosWidget";
import type { WallPhoto } from "@/db/features/photos";

/**
 * The wall photo tile. The behaviour worth locking down is not "renders an
 * <img>" — it's the four states a family can end up in (loading, empty,
 * unreachable, playing), and the promise that the wall never shows a
 * half-loaded picture: compositing is gated on decode, so a failed decode must
 * leave the current photo standing.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

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

function shot(id: string, over: Partial<WallPhoto> = {}): WallPhoto {
  return {
    id,
    url: `/api/photos/file?r=${id}&f=${id}.jpg`,
    width: 1600,
    height: 1000,
    takenAt: "2026-01-15T12:00:00.000Z",
    caption: `Photo ${id}`,
    ...over,
  };
}

function stubFeed(result: "ok" | "empty" | "down", photos: WallPhoto[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      result === "down"
        ? { ok: false, status: 503, json: async () => ({ ok: false, error: "photos_unreachable" }) }
        : { ok: true, status: 200, json: async () => ({ ok: true, photos }) },
    ),
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
  // advanceTimersByTimeAsync flushes the microtasks each timer callback queues;
  // the rotation path awaits image.decode() before it composites, and a plain
  // advanceTimersByTime would run the timer but strand that await mid-flight.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

function visibleImg(container: HTMLElement): HTMLImageElement | null {
  return container.querySelector("img:not(.wall-photo-incoming)");
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeImage.failNext = false;
  FakeImage.decoded = [];
  vi.stubGlobal("Image", FakeImage);
  document.body.innerHTML = "";
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PhotosWidget states", () => {
  it("shows it is working rather than an empty frame while the feed is in flight", async () => {
    // The feed never settles: this is the state a panel sits in while PocketBase
    // is restarting, and the tile must say "loading", not "no photos".
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const el = render(<PhotosWidget />);
    await flush();
    expect(el.querySelector("[aria-busy]")).not.toBeNull();
    expect(el.textContent).toContain("Loading photos");
  });

  it("says the library is unreachable instead of dressing up a failure as an empty wall", async () => {
    stubFeed("down");
    const el = render(<PhotosWidget />);
    await flush();
    expect(el.textContent).toContain("Photos unavailable");
    expect(el.querySelector("img")).toBeNull();
  });

  it("offers a way to add the first picture when the library is empty", async () => {
    stubFeed("empty");
    const el = render(<PhotosWidget />);
    await flush();
    expect(el.textContent).toContain("No photos yet");
    const action = Array.from(el.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Add a photo"),
    );
    expect(action).toBeDefined();
    await act(async () => {
      action!.click();
    });
    expect(mockPush).toHaveBeenCalledWith("/photos");
  });
});

describe("PhotosWidget rotation", () => {
  it("plays the first photo with its caption", async () => {
    stubFeed("ok", [shot("aaa"), shot("bbb")]);
    const el = render(<PhotosWidget rotateMs={1000} />);
    await flush();
    expect(visibleImg(el)?.getAttribute("src")).toContain("r=aaa");
    expect(el.textContent).toContain("Photo aaa");
  });

  it("decodes the next photo before compositing it, so the wall never flashes a broken frame", async () => {
    stubFeed("ok", [shot("aaa"), shot("bbb")]);
    const el = render(<PhotosWidget rotateMs={1000} />);
    await flush();

    await tick(1000); // the rotation timer fires and starts decoding
    expect(FakeImage.decoded).toHaveLength(1);
    await tick(1000); // the crossfade and the commit timer
    expect(visibleImg(el)?.getAttribute("src")).toContain("r=bbb");
  });

  it("keeps the current photo when the next one cannot be decoded", async () => {
    stubFeed("ok", [shot("aaa"), shot("bbb")]);
    const el = render(<PhotosWidget rotateMs={1000} />);
    await flush();

    FakeImage.failNext = true;
    await tick(1000);
    await tick(1000);
    expect(visibleImg(el)?.getAttribute("src")).toContain("r=aaa");
  });

  it("holds the queue order the feed chose, walking it rather than shuffling per render", async () => {
    stubFeed("ok", [shot("aaa"), shot("bbb"), shot("ccc")]);
    const el = render(<PhotosWidget rotateMs={1000} />);
    await flush();
    // Two ticks per step: the rotation fires at 1000ms, but its crossfade
    // commit is scheduled only once React has landed the incoming layer — so a
    // single 1800ms tick would end with the commit timer not yet on the clock.
    // The second tick carries the commit, and its 2000/3000ms edge fires the
    // next rotation.
    await tick(1000);
    await tick(1000);
    expect(visibleImg(el)?.getAttribute("src")).toContain("r=bbb");
    await tick(1000);
    expect(visibleImg(el)?.getAttribute("src")).toContain("r=ccc");
  });

  it("labels an anniversary picture as such", async () => {
    const now = new Date();
    const anniversary = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate(), 9, 0, 0);
    stubFeed("ok", [shot("aaa", { takenAt: anniversary.toISOString(), caption: undefined })]);
    const el = render(<PhotosWidget rotateMs={1000} />);
    await flush();
    expect(el.textContent).toContain("On this day");
  });
});
