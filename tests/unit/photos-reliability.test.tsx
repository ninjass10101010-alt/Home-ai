// @vitest-environment jsdom
/**
 * T4 — photo widget reliability (bug-audit regression suite).
 *
 * Each block pins a defect that was CONFIRMED in the audit, not a style
 * preference:
 *
 *  1. The walk-end refresh never rewound the queue cursor, so after the first
 *     full walk EVERY rotation fired a feed fetch (one per ~75s, forever).
 *  2. "error" and "empty" were terminal: rotation only runs in "ready", so a
 *     feed blip left a dead tile until a page reload.
 *  3. The feed fetch had no timeout and no cancellation path.
 *  4. A failed decode burned the whole rotation AND marked the unseen photo
 *     as seen, holding it back from the refresh that follows.
 *  5. The wall's `.hit-44::before` override inherited the centring translate
 *     and max() sizing from the base rule, landing the box offset up-left.
 *  6. The uploader's retry replaced the status list wholesale (successful rows
 *     vanished) and re-read the live caption/album inputs (stale state).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import PhotosWidget from "@/components/photos/PhotosWidget";
import PhotoUploader from "@/components/photos/PhotoUploader";
import type { WallPhoto } from "@/db/features/photos";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
// T6: the widget no longer declares CROSSFADE_MS itself — settings.ts is the
// single source it imports (spec §3.4), so the token parity is asserted there.
const settingsSrc = readFileSync(
  join(process.cwd(), "src/lib/photos/settings.ts"),
  "utf8",
);

/** jsdom never decodes images, and the widget waits on decode() to composite. */
class FakeImage {
  static failSrcs = new Set<string>();
  static decoded: string[] = [];
  src = "";
  complete = false;
  decoding = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decode(): Promise<void> {
    FakeImage.decoded.push(this.src);
    return FakeImage.failSrcs.has(this.src)
      ? Promise.reject(new Error("decode failed"))
      : Promise.resolve();
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

const THREE = [shot("aaa"), shot("bbb"), shot("ccc")];

function okFeed(photos: WallPhoto[]) {
  const mock = vi.fn(async (_url?: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, photos }),
  }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

function downFeed() {
  const mock = vi.fn(async () => ({
    ok: false,
    status: 503,
    json: async () => ({ ok: false, error: "photos_unreachable" }),
  }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

/**
 * Feed calls only. Since T6 the widget also GETs `/api/photos/settings` on
 * mount, after each rotation, and on visibility — a separate, spec-mandated
 * budget (§3/§3.1) that shares the global fetch stub here. The budgets are
 * counted apart; conflating them would make "one feed fetch per queue walk"
 * unmeasurable.
 */
const feedCalls = (mock: { mock: { calls: unknown[][] } }) =>
  mock.mock.calls.filter(([url]) => !String(url).includes("/api/photos/settings"));

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
  // the rotation path awaits image.decode() and the feed chain (fetch → json)
  // before it lands state, and a plain advanceTimersByTime would strand those
  // awaits mid-flight.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

function visibleImg(container: HTMLElement): HTMLImageElement | null {
  return container.querySelector("img:not(.wall-photo-incoming)");
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeImage.decoded = [];
  FakeImage.failSrcs = new Set();
  vi.stubGlobal("Image", FakeImage);
  document.body.innerHTML = "";
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("PhotosWidget feed refetch budget", () => {
  it("refetches once per queue walk, not on every rotation", async () => {
    const fetchMock = okFeed(THREE);
    render(<PhotosWidget rotateMs={1000} />);
    await flush();
    expect(feedCalls(fetchMock)).toHaveLength(1);

    // Two-plus full walks of a 3-photo queue (8 rotation ticks). The budget:
    // the mount fetch plus ONE walk-end refresh per walk. Before the cursor
    // reset this was a fetch on every advance after the first walk (~8).
    for (let i = 0; i < 8; i++) await tick(1000);

    const calls = feedCalls(fetchMock).length;
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(calls).toBeLessThanOrEqual(4);
  });

  it("skips an undecodable photo inside the same rotation and never marks it seen", async () => {
    const fetchMock = okFeed(THREE);
    const el = render(<PhotosWidget rotateMs={1000} />);
    await flush();

    FakeImage.failSrcs.add(THREE[1].url);
    await tick(1000); // one rotation: bbb fails to decode, ccc takes its place
    expect(FakeImage.decoded).toEqual([THREE[1].url, THREE[2].url]);

    // The walk-end refresh carries only what actually went on screen — the
    // failed photo must not sit in `recent` being held back from the feed.
    expect(feedCalls(fetchMock)).toHaveLength(2);
    const url = String(feedCalls(fetchMock)[1][0]);
    expect(url).toContain(`recent=${THREE[2].id}`);
    expect(url).not.toContain(THREE[1].id);

    await tick(1000); // the crossfade commit — no rotation was burned on bbb
    expect(visibleImg(el)?.getAttribute("src")).toContain("r=ccc");
  });

  it("floors the rotation interval at one second", async () => {
    okFeed([shot("aaa"), shot("bbb")]);
    render(<PhotosWidget rotateMs={400} />);
    await flush();

    await tick(600); // a 400ms interval would have rotated by now
    expect(FakeImage.decoded).toHaveLength(0);
    await tick(400); // t=1000 — the floor
    expect(FakeImage.decoded).toHaveLength(1);
  });
});

describe("PhotosWidget terminal states recover", () => {
  it("retries a dead feed on a bounded backoff, then stops hammering it", async () => {
    const fetchMock = downFeed();
    render(<PhotosWidget />);
    await flush();
    expect(feedCalls(fetchMock)).toHaveLength(1);

    for (let i = 0; i < 5; i++) await tick(30_000);
    expect(feedCalls(fetchMock).length).toBe(6); // 1 initial + 5 capped attempts

    await tick(120_000);
    expect(feedCalls(fetchMock).length).toBe(6); // budget spent: no more
  });

  it("retries an empty library so a photo added elsewhere shows up", async () => {
    let photos: WallPhoto[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, photos }) })),
    );
    const el = render(<PhotosWidget rotateMs={1000} />);
    await flush();
    expect(el.textContent).toContain("No photos yet");

    photos = [shot("aaa")];
    await tick(30_000);
    expect(el.textContent).not.toContain("No photos yet");
    expect(visibleImg(el)?.getAttribute("src")).toContain("r=aaa");
  });

  it("refetches when the tab becomes visible again from the error state", async () => {
    const fetchMock = downFeed();
    render(<PhotosWidget />);
    await flush();
    expect(feedCalls(fetchMock)).toHaveLength(1);

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(feedCalls(fetchMock)).toHaveLength(2);
  });

  it("does NOT refetch the FEED on visibility while photos are showing — rotation owns ready", async () => {
    const fetchMock = okFeed(THREE);
    render(<PhotosWidget rotateMs={1000} />);
    await flush();
    expect(feedCalls(fetchMock)).toHaveLength(1);

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    // The settings GET DOES refetch here by design (spec §3 — the wall picks
    // up changes on visibility); the feed does not: rotation owns "ready".
    expect(feedCalls(fetchMock)).toHaveLength(1);
  });

  it("offers Try again on the error state and lands on a photo", async () => {
    let up = false;
    const fetchMock = vi.fn(async () =>
      up
        ? { ok: true, status: 200, json: async () => ({ ok: true, photos: [shot("aaa")] }) }
        : { ok: false, status: 503, json: async () => ({ ok: false, error: "down" }) },
    );
    vi.stubGlobal("fetch", fetchMock);
    const el = render(<PhotosWidget />);
    await flush();
    expect(el.textContent).toContain("Photos unavailable");

    const retry = Array.from(el.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Try again"),
    );
    expect(retry, "the error state needs a manual recovery control").toBeDefined();

    up = true;
    await act(async () => {
      retry!.click();
    });
    await flush();
    expect(feedCalls(fetchMock)).toHaveLength(2);
    expect(visibleImg(el)?.getAttribute("src")).toContain("r=aaa");
  });
});

describe("PhotosWidget fetch cancellation", () => {
  it("passes an abort signal and cancels the in-flight load on unmount", async () => {
    let captured: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: unknown, init?: { signal?: AbortSignal }) => {
        captured = init?.signal;
        return new Promise(() => {}); // hangs: the wall is mid-load
      }),
    );
    render(<PhotosWidget />);
    await flush();
    expect(captured).toBeInstanceOf(AbortSignal);
    expect(captured!.aborted).toBe(false);

    act(() => root!.unmount());
    root = null;
    expect(captured!.aborted).toBe(true);
  });

  it("a recovery retry supersedes the load still in flight", async () => {
    let calls = 0;
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: unknown, init?: { signal?: AbortSignal }) => {
        // The settings GET shares this stub but is a separate budget: it
        // succeeds (→ defaults) and never carries the feed's abort signal.
        if (String(_url).includes("/api/photos/settings")) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, settings: {} }) });
        }
        calls += 1;
        if (init?.signal) signals.push(init.signal);
        if (calls === 1) {
          return Promise.resolve({ ok: false, status: 503, json: async () => ({ ok: false }) });
        }
        return new Promise(() => {}); // every retry after the first hangs
      }),
    );
    render(<PhotosWidget />);
    await flush(); // call 1 fails → error state
    expect(calls).toBe(1);

    const retry = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Try again"),
    );
    await act(async () => {
      retry!.click();
    });
    expect(calls).toBe(2);
    expect(signals[1].aborted).toBe(false);

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(calls).toBe(3);
    expect(signals[1].aborted).toBe(true); // call 2 was cancelled, not raced
  });
});

describe("PhotosWidget broken images never show a broken tile", () => {
  it("abandons a failing incoming layer and keeps the shown photo", async () => {
    okFeed(THREE);
    const el = render(<PhotosWidget rotateMs={1000} />);
    await flush();

    await tick(1000); // rotation composites bbb as the incoming layer
    const incoming = el.querySelector("img.wall-photo-incoming");
    expect(incoming).not.toBeNull();

    await act(async () => {
      incoming!.dispatchEvent(new Event("error"));
    });
    expect(el.querySelector("img.wall-photo-incoming")).toBeNull();
    expect(visibleImg(el)?.getAttribute("src")).toContain("r=aaa");
  });

  it("rescues a broken shown layer with one rotation when the queue has more", async () => {
    okFeed(THREE);
    const el = render(<PhotosWidget rotateMs={1000} />);
    await flush();

    const shown = visibleImg(el)!;
    await act(async () => {
      shown.dispatchEvent(new Event("error"));
    });
    await flush();
    const incoming = el.querySelector("img.wall-photo-incoming");
    expect(incoming).not.toBeNull();
    expect(incoming?.getAttribute("src")).toContain("r=bbb");
  });

  it("falls to the error state when the only photo is broken", async () => {
    const el = render(<PhotosWidget photos={[shot("only")]} />);
    await flush();
    const shown = visibleImg(el)!;
    await act(async () => {
      shown.dispatchEvent(new Event("error"));
    });
    expect(el.textContent).toContain("Photos unavailable");
  });
});

describe("PhotosWidget assistive-tech contract", () => {
  it("announces the loading shell as a status region", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const el = render(<PhotosWidget />);
    await flush();
    const status = el.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.getAttribute("aria-busy")).toBe("true");
    expect(el.textContent).toContain("Loading photos");
  });

  it("keeps the pause tooltip in step with the accessible name", async () => {
    const el = render(<PhotosWidget photos={THREE} rotateMs={1000} />);
    await flush();
    const btn = el.querySelector<HTMLButtonElement>("button[aria-pressed]");
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("title")).toBe(btn!.getAttribute("aria-label"));
  });

  it("dates an on-this-day photo down to the day of month", async () => {
    const now = new Date();
    const anniversary = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate(), 9, 0, 0);
    okFeed([shot("aaa", { takenAt: anniversary.toISOString(), caption: undefined })]);
    const el = render(<PhotosWidget rotateMs={1000} />);
    await flush();
    const expected = anniversary.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    expect(el.textContent).toContain(`On this day · ${expected}`);
  });
});

describe("PhotoUploader retry", () => {
  // The widget suites above run on fake timers; the uploader's upload loop is
  // real async I/O, so this block drops back to the real clock.
  beforeEach(() => {
    vi.useRealTimers();
  });

  function makeFile(name: string): File {
    return new File(["x"], name, { type: "image/jpeg", lastModified: 1700000000000 });
  }

  /**
   * Set a controlled input's value the way a real browser does — straight to
   * the prototype setter — so React's value tracker sees a change and fires
   * onChange. Assigning `input.value = …` goes through the tracker's own
   * intercepted setter and is swallowed as "no change".
   */
  function typeInto(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("keeps finished rows and the batch's own caption when a retry runs", async () => {
    const captions: unknown[] = [];
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { body?: FormData }) => {
        calls += 1;
        captions.push(init?.body?.get("caption") ?? null);
        if (calls === 2) {
          return { ok: false, status: 500, json: async () => ({ ok: false, error: "boom" }) };
        }
        return { ok: true, status: 201, json: async () => ({ ok: true }) };
      }),
    );

    const el = render(<PhotoUploader />);

    const captionInput = el.querySelector('input[placeholder="Beach day"]') as HTMLInputElement;
    await act(async () => {
      typeInto(captionInput, "First trip");
    });

    const fileInput = el.querySelector('input[type="file"]') as HTMLInputElement;
    const files = [makeFile("one.jpg"), makeFile("two.jpg")];
    await act(async () => {
      Object.defineProperty(fileInput, "files", { value: files, configurable: true });
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(calls).toBe(2);
    expect(captions).toEqual(["First trip", "First trip"]);
    let rows = Array.from(el.querySelectorAll("li"));
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Added to the wall");
    expect(rows[1].textContent).toContain("Failed");

    // The family edits the caption while the failure is still on screen…
    await act(async () => {
      typeInto(captionInput, "Changed later");
    });

    const retry = Array.from(el.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Retry failed"),
    );
    expect(retry).toBeDefined();
    expect(retry!.hasAttribute("disabled")).toBe(false);
    await act(async () => {
      retry!.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(calls).toBe(3);
    // The retried upload still carries the caption the batch was queued with.
    expect(captions[2]).toBe("First trip");
    rows = Array.from(el.querySelectorAll("li"));
    // Merged by key: two rows, not one replaced row and not a duplicate.
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Added to the wall"); // survived the retry
    expect(rows[1].textContent).toContain("Added to the wall");
  });

  it("keeps the file input out of the tab order — the dropzone is the button", async () => {
    const el = render(<PhotoUploader />);
    const fileInput = el.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput.getAttribute("tabindex")).toBe("-1");
    expect(fileInput.getAttribute("aria-hidden")).toBe("true");
    const dropzone = el.querySelector('[role="button"]');
    expect(dropzone).not.toBeNull();
    expect(dropzone!.contains(fileInput)).toBe(true);
  });
});

describe("photo wall contract tokens", () => {
  it("--motion-glide is 600ms and matches CROSSFADE_MS (the widget's single source)", () => {
    const glide = css.match(/--motion-glide:\s*(\d+)ms/);
    expect(glide, "--motion-glide token missing from globals.css").not.toBeNull();
    const crossfade = settingsSrc.match(/const CROSSFADE_MS = (\d+)/);
    expect(crossfade, "CROSSFADE_MS missing from lib/photos/settings").not.toBeNull();
    expect(Number(crossfade![1])).toBe(600);
    expect(Number(glide![1])).toBe(Number(crossfade![1]));
  });

  it("the wall hit-44 override defines its own centred box instead of inheriting the offset", () => {
    const block = css.match(/html\[data-wall="true"\]\s+\.hit-44::before\s*\{([^}]*)\}/);
    expect(block, "wall hit-44 override missing from globals.css").not.toBeNull();
    const body = block![1];
    expect(body).toMatch(/inset:\s*-12px/);
    expect(body).toMatch(/width:\s*auto/);
    expect(body).toMatch(/height:\s*auto/);
    expect(body).toMatch(/translate:\s*none/);
  });
});
