// @vitest-environment jsdom
/**
 * The Photos settings card (spec §5, plan T7).
 *
 * The behaviours pinned here are the erase-guard rules from §5.1 — they are
 * the reason this file exists:
 *
 *  - every control is disabled until the first GET settles;
 *  - a `degraded` read keeps the card disabled AND never fires a PATCH;
 *  - a single change sends exactly one key (subset-only write);
 *  - the slider debounces to one request, rolls a failure back to server
 *    truth, and toasts "Couldn't save photo settings";
 *  - reset is the one full-body write, behind a confirm dialog;
 *  - the reduced-motion honesty line appears only when motion is reduced.
 *
 * Harness: createRoot + act (no @testing-library), url-aware fetch stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import PhotoSettingsSection from "@/components/settings/PhotoSettingsSection";
import { PHOTO_SETTINGS_DEFAULTS, type PhotoSettings } from "@/lib/photos/settings";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface FetchCall {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

interface StubResponse {
  status?: number;
  body: Record<string, unknown>;
}

let calls: FetchCall[] = [];
let serverSettings: PhotoSettings = { ...PHOTO_SETTINGS_DEFAULTS };
let getResponse: () => StubResponse;
let patchResponse: (body: Record<string, unknown>) => StubResponse;
let holdGet: Promise<void> | null = null;
let osReducedMotion = false;

function installMatchMedia() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? osReducedMotion : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ url, method, body });

      let out: StubResponse;
      if (method === "PATCH") {
        out = patchResponse(body ?? {});
      } else if (url.includes("/api/photos/settings")) {
        if (holdGet) await holdGet;
        out = getResponse();
      } else {
        out = { status: 404, body: { ok: false } };
      }
      const status = out.status ?? 200;
      return { ok: status >= 200 && status < 300, status, json: async () => out.body };
    }),
  );
}

const roots: Root[] = [];

/** Flush enough microtasks for the stubbed fetch chain (fetch → json → setState). */
async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(<PhotoSettingsSection />);
  });
  await flush();
  return host;
}

function buttonByText(scope: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!button) throw new Error(`button ${text} not found`);
  return button;
}

function radioByText(scope: ParentNode, text: string): HTMLButtonElement {
  const radio = Array.from(scope.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!radio) throw new Error(`radio ${text} not found`);
  return radio;
}

function transitionGroup(host: ParentNode): HTMLElement {
  const group = host.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Photo transition"]');
  if (!group) throw new Error("transition radiogroup not found");
  return group;
}

function orderGroup(host: ParentNode): HTMLElement {
  const group = host.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Photo order"]');
  if (!group) throw new Error("order radiogroup not found");
  return group;
}

function controls(host: HTMLElement) {
  const slider = host.querySelector<HTMLInputElement>('input[type="range"]');
  const caption = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!slider || !caption) throw new Error("slider or caption toggle not found");
  return {
    slider,
    caption,
    reset: buttonByText(host, "Reset"),
    fast: buttonByText(host, "Fast 30s"),
    normal: buttonByText(host, "Normal 75s"),
    slow: buttonByText(host, "Slow 5min"),
    transition: transitionGroup(host),
    order: orderGroup(host),
  };
}

function expectEnabled(host: HTMLElement, enabled: boolean) {
  const c = controls(host);
  expect(c.slider.disabled, "slider").toBe(!enabled);
  expect(c.caption.disabled, "caption toggle").toBe(!enabled);
  expect(c.reset.disabled, "reset button").toBe(!enabled);
  expect(c.fast.disabled, "preset chip").toBe(!enabled);
  expect(c.transition.parentElement?.getAttribute("aria-disabled"), "transition").toBe(enabled ? null : "true");
  expect(c.order.parentElement?.getAttribute("aria-disabled"), "order").toBe(enabled ? null : "true");
}

function patchCalls(): FetchCall[] {
  return calls.filter((call) => call.method === "PATCH");
}

function settingsGets(): FetchCall[] {
  return calls.filter((call) => call.method === "GET" && call.url.includes("/api/photos/settings"));
}

function setSlider(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("no native value setter");
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  calls = [];
  serverSettings = { ...PHOTO_SETTINGS_DEFAULTS };
  getResponse = () => ({ body: { ok: true, settings: { ...serverSettings } } });
  patchResponse = (body) => {
    serverSettings = { ...serverSettings, ...(body as Partial<PhotoSettings>) };
    return { body: { ok: true, settings: { ...serverSettings } } };
  };
  holdGet = null;
  osReducedMotion = false;
  installMatchMedia();
  installFetch();
});

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) act(() => root.unmount());
  }
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PhotoSettingsSection — the erase-guard (§5.1)", () => {
  it("keeps every control disabled until the initial GET settles, then enables", async () => {
    let releaseGet!: () => void;
    holdGet = new Promise<void>((resolve) => {
      releaseGet = resolve;
    });

    const host = await render();
    expectEnabled(host, false);

    releaseGet();
    holdGet = null;
    await flush();

    expectEnabled(host, true);
    expect(settingsGets()).toHaveLength(1);
  });

  it("stays disabled on a degraded read, tells the truth, and never PATCHes", async () => {
    getResponse = () => ({
      body: { ok: true, settings: { ...PHOTO_SETTINGS_DEFAULTS }, degraded: true },
    });

    const host = await render();
    expect(host.textContent).toContain("Couldn't read saved settings — showing defaults.");
    expectEnabled(host, false);
    // Defaults are VISIBLE, just not editable.
    expect(controls(host).slider.value).toBe("75");
    expect(host.textContent).toContain("1m 15s");

    act(() => buttonByText(host, "Fast 30s").click());
    act(() => radioByText(transitionGroup(host), "Slide").click());
    act(() => controls(host).caption.click());
    act(() => buttonByText(host, "Reset").click());
    await flush();

    expect(patchCalls()).toHaveLength(0);
    expectEnabled(host, false);
  });

  it("sends only the changed field when one control changes", async () => {
    const host = await render();

    act(() => radioByText(transitionGroup(host), "Slide").click());
    await flush();

    const patches = patchCalls();
    expect(patches).toHaveLength(1);
    expect(patches[0].url).toContain("/api/photos/settings");
    expect(Object.keys(patches[0].body ?? {})).toEqual(["transition"]);
    expect(patches[0].body).toEqual({ transition: "slide" });
    // The optimistic control shows the new value immediately.
    expect(radioByText(transitionGroup(host), "Slide").getAttribute("aria-checked")).toBe("true");
  });

  it("debounces a slider drag into exactly one PATCH, and never fires it after unmount", async () => {
    vi.useFakeTimers();
    const host = await render();
    const { slider } = controls(host);
    expect(patchCalls()).toHaveLength(0);

    setSlider(slider, "100");
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    setSlider(slider, "150");
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    setSlider(slider, "200");
    await act(async () => {
      vi.advanceTimersByTime(399);
    });
    expect(patchCalls()).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await flush();
    const patches = patchCalls();
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toEqual({ rotateSeconds: 200 });

    // Unmount clears the pending timer (spec: clear on unmount).
    setSlider(slider, "250");
    const root = roots.pop();
    await act(async () => {
      root?.unmount();
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(patchCalls()).toHaveLength(1);
  });
});

describe("PhotoSettingsSection — optimistic write, honest rollback (§5.1)", () => {
  const failures: Array<{ name: string; response: StubResponse }> = [
    { name: "a 503 settings_unreachable", response: { status: 503, body: { ok: false, error: "settings_unreachable" } } },
    { name: "an ok:false body", response: { status: 200, body: { ok: false, error: "invalid_transition" } } },
  ];

  it.each(failures)("reverts to the server value and toasts on $name", async ({ response }) => {
    patchResponse = () => response;
    const host = await render();
    const group = transitionGroup(host);
    expect(radioByText(group, "Crossfade").getAttribute("aria-checked")).toBe("true");

    act(() => radioByText(group, "Slide").click());
    // Optimistic: the control moves at once.
    expect(radioByText(group, "Slide").getAttribute("aria-checked")).toBe("true");

    await flush();
    // Failed write must never look saved.
    expect(radioByText(group, "Crossfade").getAttribute("aria-checked")).toBe("true");
    expect(radioByText(group, "Slide").getAttribute("aria-checked")).toBe("false");
    expect(host.textContent).toContain("Couldn't save photo settings");
  });

  it("adopts the server's normalized settings from a successful PATCH", async () => {
    // Server-side clamp/normalization: it answers 45 whatever we sent.
    patchResponse = () => ({ body: { ok: true, settings: { ...PHOTO_SETTINGS_DEFAULTS, rotateSeconds: 45 } } });
    const host = await render();

    act(() => buttonByText(host, "Fast 30s").click());
    await flush();

    expect(patchCalls()).toHaveLength(1);
    expect(patchCalls()[0].body).toEqual({ rotateSeconds: 30 });
    expect(controls(host).slider.value).toBe("45");
    expect(host.textContent).toContain("45s");
    // 45 matches no preset, so none is lit — the UI shows server truth.
    expect(controls(host).fast.className).not.toContain("chip-selected");
    expect(controls(host).normal.className).not.toContain("chip-selected");
    expect(controls(host).slow.className).not.toContain("chip-selected");
  });
});

describe("PhotoSettingsSection — presets (§5)", () => {
  const presetCases: Array<[number, string, string]> = [
    [30, "Fast 30s", "30s"],
    [75, "Normal 75s", "1m 15s"],
    [300, "Slow 5min", "5m"],
  ];

  it.each(presetCases)(
    "lights only the preset matching %i and reads it in plain units",
    async (seconds, label, readout) => {
      serverSettings = { ...PHOTO_SETTINGS_DEFAULTS, rotateSeconds: seconds };
      const host = await render();
      const lit = (chip: HTMLButtonElement) => chip.className.includes("chip-selected");

      expect(controls(host).slider.value).toBe(String(seconds));
      expect(host.textContent).toContain(readout);
      expect(lit(buttonByText(host, label))).toBe(true);
      expect(lit(controls(host).fast)).toBe(seconds === 30);
      expect(lit(controls(host).normal)).toBe(seconds === 75);
      expect(lit(controls(host).slow)).toBe(seconds === 300);
    },
  );

  it("moves the highlight to the preset you pick and patches just that field", async () => {
    const host = await render();
    expect(controls(host).normal.className).toContain("chip-selected");

    act(() => buttonByText(host, "Slow 5min").click());
    await flush();

    expect(controls(host).slow.className).toContain("chip-selected");
    expect(controls(host).normal.className).not.toContain("chip-selected");
    expect(patchCalls()).toHaveLength(1);
    expect(patchCalls()[0].body).toEqual({ rotateSeconds: 300 });
  });
});

describe("PhotoSettingsSection — reset writes all four defaults", () => {
  it("asks for confirmation, then PATCHes the full default body once", async () => {
    serverSettings = { rotateSeconds: 120, transition: "slide", order: "oldest", showCaption: false };
    const host = await render();
    expect(controls(host).slider.value).toBe("120");

    act(() => buttonByText(host, "Reset").click());
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.textContent).toContain("Reset photo settings?");
    expect(patchCalls()).toHaveLength(0);

    act(() => buttonByText(dialog!, "Reset").click());
    await flush();

    const patches = patchCalls();
    expect(patches).toHaveLength(1);
    expect(Object.keys(patches[0].body ?? {}).sort()).toEqual([
      "order",
      "rotateSeconds",
      "showCaption",
      "transition",
    ]);
    expect(patches[0].body).toEqual({
      rotateSeconds: 75,
      transition: "crossfade",
      order: "shuffle",
      showCaption: true,
    });
    expect(controls(host).slider.value).toBe("75");
    expect(host.textContent).toContain("Tune how family photos change on the wall.");
  });
});

describe("PhotoSettingsSection — reduced-motion honesty (§5.2)", () => {
  const HONESTY =
    "Your device asks for reduced motion, so photos change with a hard cut regardless.";

  it("states the honesty line when the device asks for less motion, control enabled", async () => {
    osReducedMotion = true;
    const host = await render();

    expect(host.textContent).toContain(HONESTY);
    // Contrast with the degraded state: this control stays usable.
    expectEnabled(host, true);
    expect(transitionGroup(host).parentElement?.getAttribute("aria-disabled")).toBeNull();
  });

  it("omits the line when motion is allowed", async () => {
    const host = await render();
    expect(host.textContent).not.toContain(HONESTY);
  });
});
