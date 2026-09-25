// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LayoutProvider, useHomeLayout } from "@/hooks/useHomeLayout";
import HomeSettingsSection from "@/components/settings/HomeSettingsSection";
import { LAYOUT_STORAGE_KEY, cloneDefaultLayout, saveLayoutConfig, type HomeLayoutConfig, type WidgetId } from "@/lib/layout-config";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Root[] = [];
let reducedMotion = false;
const originalWidth = window.innerWidth;
const originalHeight = window.innerHeight;
const originalAnimateDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");

function installMatchMedia() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reducedMotion : query.includes("orientation"),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: width === 390 ? 844 : 1024 });
}

function ordered(prefix: WidgetId[], base: WidgetId[]): WidgetId[] {
  return [...prefix, ...base.filter((id) => !prefix.includes(id))];
}

function seedConfig(): HomeLayoutConfig {
  const config = cloneDefaultLayout();
  config.phone.widgets = ordered(["weather", "tasks"], config.phone.widgets);
  config.phone.hidden = ["tasks"];
  config.tablet.widgets = ordered(["morningBriefing", "weather", "aiQuickAsk"], config.tablet.widgets);
  config.tablet.hidden = ["weather"];
  config.desktop.widgets = ordered(["leaderboard", "weather", "morningBriefing"], config.desktop.widgets);
  config.desktop.hidden = ["leaderboard"];
  saveLayoutConfig(config);
  return config;
}

async function renderView() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mountedRoots.push(root);
  await act(async () => {
    root.render(
      <LayoutProvider>
        <HomeSettingsSection />
      </LayoutProvider>,
    );
  });
  return { host, root };
}

function LayoutProbe() {
  const { config, orientation } = useHomeLayout();
  return (
    <output
      data-testid="layout-probe"
      data-orientation={orientation}
      data-hidden={config.phone.hidden.join(",")}
    >
      {JSON.stringify(config)}
    </output>
  );
}

async function renderProbe(showSection: boolean) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mountedRoots.push(root);
  await act(async () => {
    root.render(
      <LayoutProvider>
        <LayoutProbe />
        {showSection ? <HomeSettingsSection /> : null}
      </LayoutProvider>,
    );
  });
  return { host, root };
}

async function rerenderProbe(root: Root, showSection: boolean) {
  await act(async () => {
    root.render(
      <LayoutProvider>
        <LayoutProbe />
        {showSection ? <HomeSettingsSection /> : null}
      </LayoutProvider>,
    );
  });
}

function rowIds(scope: ParentNode) {
  return Array.from(scope.querySelectorAll<HTMLElement>("[data-widget-id]")).map((row) => row.dataset.widgetId ?? "");
}

function rowById(scope: ParentNode, id: WidgetId) {
  const row = scope.querySelector<HTMLElement>(`[data-widget-id="${id}"]`);
  if (!row) throw new Error(`row ${id} not found`);
  return row;
}

function buttonByText(scope: ParentNode, text: string) {
  const button = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((candidate) => candidate.textContent?.trim() === text);
  if (!button) throw new Error(`button ${text} not found`);
  return button;
}

function radioByText(scope: ParentNode, text: string) {
  const radio = Array.from(scope.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((candidate) => candidate.textContent?.trim() === text);
  if (!radio) throw new Error(`radio ${text} not found`);
  return radio;
}

function dispatchDrag(target: Element, type: string, transfer: DataTransfer) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  act(() => target.dispatchEvent(event));
}

function makeTransfer(source?: WidgetId) {
  let value = source ?? "";
  return {
    effectAllowed: "none",
    dropEffect: "none",
    setData: vi.fn((_type: string, next: string) => { value = next; }),
    getData: vi.fn(() => value),
  } as unknown as DataTransfer;
}

interface AnimationCall {
  element: HTMLElement;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  animation: Animation;
  cancel: ReturnType<typeof vi.fn>;
}

function installAnimationMock() {
  const calls: AnimationCall[] = [];
  const animate = vi.fn(function (this: HTMLElement, keyframes: Keyframe[], options?: number | KeyframeAnimationOptions) {
    const cancel = vi.fn();
    const animation = { cancel } as unknown as Animation;
    calls.push({
      element: this,
      keyframes,
      options: typeof options === "number" ? { duration: options } : options ?? {},
      animation,
      cancel,
    });
    return animation;
  });
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, writable: true, value: animate });
  return { animate, calls };
}

function installRowPositionMock() {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const index = this.parentElement ? Array.from(this.parentElement.children).indexOf(this) : 0;
    return { top: index * 40, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: index * 40, toJSON: () => ({}) } as DOMRect;
  });
}

async function waitForDialogClose() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 220));
  });
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  reducedMotion = false;
  setViewport(390);
  installMatchMedia();
  seedConfig();
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const root = mountedRoots.pop();
    if (root) act(() => root.unmount());
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
  if (originalAnimateDescriptor) {
    Object.defineProperty(HTMLElement.prototype, "animate", originalAnimateDescriptor);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "animate");
  }
});

describe("HomeSettingsSection", () => {
  it("renders the complete selected layout and wall display control", async () => {
    const config = seedConfig();
    const { host } = await renderView();

    expect(host.querySelector('[data-settings-home="true"]')).toBeTruthy();
    expect(host.textContent).toContain("Layout & display");
    expect(radioByText(host, "📱 Phone").getAttribute("aria-checked")).toBe("true");
    expect(radioByText(host, "📱 Tablet").getAttribute("aria-checked")).toBe("false");
    expect(radioByText(host, "🖥️ Desktop").getAttribute("aria-checked")).toBe("false");
    expect(host.querySelector('[role="radiogroup"][aria-label="Wall display (ApoloSign)"]')).toBeTruthy();
    expect(rowIds(host)).toEqual(config.phone.widgets);
    expect(host.textContent).toContain("12 on Home");
  });

  it("keeps phone, tablet, and desktop order and hidden rows independent", async () => {
    const config = seedConfig();
    const { host } = await renderView();

    expect(rowById(host, "tasks").dataset.widgetHidden).toBe("true");
    expect(host.textContent).toContain("Tasks");

    act(() => radioByText(host, "📱 Tablet").click());
    expect(rowIds(host)).toEqual(config.tablet.widgets);
    expect(rowById(host, "weather").dataset.widgetHidden).toBe("true");
    expect(rowById(host, "tasks").dataset.widgetHidden).toBe("false");

    act(() => radioByText(host, "🖥️ Desktop").click());
    expect(rowIds(host)).toEqual(config.desktop.widgets);
    expect(rowById(host, "leaderboard").dataset.widgetHidden).toBe("true");
    expect(rowById(host, "weather").dataset.widgetHidden).toBe("false");
  });

  it("uses a dashed, explicit Hidden state without disabling row controls", async () => {
    const { host } = await renderView();
    const hidden = rowById(host, "tasks");

    expect(hidden.className).toContain("border-dashed");
    expect(hidden.className).not.toMatch(/opacity/);
    expect(hidden.querySelector('[data-widget-hidden-badge]')?.textContent).toBe("Hidden");
    expect(hidden.querySelector<HTMLInputElement>('input[aria-label="Show Tasks"]')).toBeTruthy();
    expect(hidden.querySelector<HTMLInputElement>('input[aria-label="Show Tasks"]')?.checked).toBe(false);
    expect(hidden.querySelector<HTMLInputElement>('input[aria-label="Show Tasks"]')?.disabled).toBe(false);
    expect(hidden.querySelector<HTMLButtonElement>('button[aria-label="Move Tasks up"]')?.disabled).toBe(false);
    expect(hidden.querySelector<HTMLButtonElement>('button[aria-label="Move Tasks down"]')?.disabled).toBe(false);
    expect(hidden.querySelector('[data-widget-drag-handle="true"]')).toBeTruthy();
  });

  it("updates visibility through the selected layout and keeps the row in place", async () => {
    const { host } = await renderView();
    const before = rowIds(host);
    const toggle = host.querySelector<HTMLInputElement>('input[aria-label="Show Tasks"]')!;

    act(() => toggle.click());

    expect(rowIds(host)).toEqual(before);
    expect(rowById(host, "tasks").dataset.widgetHidden).toBe("false");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Show Tasks"]')?.checked).toBe(true);
    expect(host.textContent).toContain("Showing Tasks");
  });

  it("keeps Show labels stable while checked means visible", async () => {
    const { host } = await renderView();
    const weatherToggle = host.querySelector<HTMLInputElement>('input[aria-label="Show Weather"]')!;

    expect(weatherToggle.checked).toBe(true);
    act(() => weatherToggle.click());
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Show Weather"]')?.checked).toBe(false);
    expect(host.textContent).toContain("Hiding Weather");

    act(() => host.querySelector<HTMLInputElement>('input[aria-label="Show Weather"]')!.click());
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Show Weather"]')?.checked).toBe(true);
    expect(host.textContent).toContain("Showing Weather");
  });

  it("keeps the dedicated handle separate from row clicks and reorders on drop", async () => {
    const { host } = await renderView();
    const rows = Array.from(host.querySelectorAll<HTMLElement>("[data-widget-id]"));
    expect(rows.every((row) => !row.hasAttribute("draggable"))).toBe(true);
    expect(host.querySelectorAll('[draggable="true"]')).toHaveLength(13);

    const handle = rowById(host, "weather").querySelector<HTMLElement>('[data-widget-drag-handle="true"]')!;
    const target = rowById(host, "tasks");
    const transfer = makeTransfer("weather");

    dispatchDrag(handle, "dragstart", transfer);
    dispatchDrag(target, "dragover", transfer);
    dispatchDrag(target, "drop", transfer);

    expect(rowIds(host).slice(0, 2)).toEqual(["tasks", "weather"]);
    expect(host.querySelector('[data-drag-target="true"]')).toBeNull();
    expect(host.textContent).toContain("Reordered Weather");
  });

  it("keeps the decorative drag handle out of the accessibility tree while arrows remain controls", async () => {
    const { host } = await renderView();
    const row = rowById(host, "weather");
    const handle = row.querySelector<HTMLElement>('[data-widget-drag-handle="true"]')!;

    expect(handle.tagName).toBe("SPAN");
    expect(handle.getAttribute("aria-hidden")).toBe("true");
    expect(handle.tabIndex).toBe(-1);
    expect(handle.hasAttribute("tabindex")).toBe(false);
    expect(handle.hasAttribute("role")).toBe(false);
    expect(row.querySelector('button[aria-label^="Drag Weather"]')).toBeNull();
    expect(row.querySelector<HTMLButtonElement>('button[aria-label="Move Weather up"]')).toBeTruthy();
    expect(row.querySelector<HTMLButtonElement>('button[aria-label="Move Weather down"]')).toBeTruthy();
  });

  it("animates the exact FLIP delta for 260ms and skips animation for reduced motion", async () => {
    const { host } = await renderView();
    const rectSpy = installRowPositionMock();
    const { animate, calls } = installAnimationMock();

    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Move Weather down"]')!.click());
    const weatherAnimation = calls.find((call) => call.element.dataset.widgetId === "weather")!;
    expect(weatherAnimation.keyframes).toEqual([
      { transform: "translateY(-40px)" },
      { transform: "translateY(0)" },
    ]);
    expect(weatherAnimation.options).toEqual({
      duration: 260,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    });

    const callCount = calls.length;
    reducedMotion = true;
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Move Weather up"]')!.click());
    expect(calls).toHaveLength(callCount);
    expect(animate).toHaveBeenCalledTimes(callCount);
    rectSpy.mockRestore();
  });

  it("keeps FLIP active across unrelated feedback rerenders and cancels before the next order measurement", async () => {
    const { host } = await renderView();
    const rectSpy = installRowPositionMock();
    const { calls } = installAnimationMock();

    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Move Weather down"]')!.click());
    const firstBatchSize = calls.length;
    const firstWeatherAnimation = calls.find((call) => call.element.dataset.widgetId === "weather")!;

    act(() => host.querySelector<HTMLInputElement>('input[aria-label="Show Tasks"]')!.click());
    expect(host.textContent).toContain("Showing Tasks");
    expect(calls).toHaveLength(firstBatchSize);
    expect(firstWeatherAnimation.cancel).not.toHaveBeenCalled();

    const measurementOffset = rectSpy.mock.calls.length;
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Move Weather up"]')!.click());
    const secondWeatherAnimation = calls.slice(firstBatchSize).find((call) => call.element.dataset.widgetId === "weather")!;

    expect(firstWeatherAnimation.cancel).toHaveBeenCalledTimes(1);
    const cancelOrder = firstWeatherAnimation.cancel.mock.invocationCallOrder[0];
    const nextMeasurementOrder = rectSpy.mock.invocationCallOrder[measurementOffset];
    expect(cancelOrder).toBeLessThan(nextMeasurementOrder);
    expect(secondWeatherAnimation.keyframes).toEqual([
      { transform: "translateY(40px)" },
      { transform: "translateY(0)" },
    ]);
    expect(secondWeatherAnimation.options).toEqual({
      duration: 260,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    });
    rectSpy.mockRestore();
  });

  it("cancels stale FLIP animations before rapid successive reorders and on cleanup", async () => {
    const { host, root } = await renderView();
    const rectSpy = installRowPositionMock();
    const { calls } = installAnimationMock();

    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Move Weather down"]')!.click());
    const firstBatchSize = calls.length;
    const firstWeatherAnimation = calls.find((call) => call.element.dataset.widgetId === "weather")!;

    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Move Weather up"]')!.click());
    const secondWeatherAnimation = calls.slice(firstBatchSize).find((call) => call.element.dataset.widgetId === "weather")!;

    expect(firstWeatherAnimation.keyframes).toEqual([
      { transform: "translateY(-40px)" },
      { transform: "translateY(0)" },
    ]);
    expect(firstWeatherAnimation.cancel).toHaveBeenCalledTimes(1);
    expect(secondWeatherAnimation.keyframes).toEqual([
      { transform: "translateY(40px)" },
      { transform: "translateY(0)" },
    ]);
    expect(secondWeatherAnimation.cancel).not.toHaveBeenCalled();

    mountedRoots.pop();
    act(() => root.unmount());
    for (const call of calls.slice(firstBatchSize)) {
      expect(call.cancel).toHaveBeenCalledTimes(1);
    }
    rectSpy.mockRestore();
  });

  it("suppresses focus rehydration on mount and restores it after unmount", async () => {
    vi.useFakeTimers();
    const { host, root } = await renderProbe(true);
    const probe = () => host.querySelector<HTMLElement>('[data-testid="layout-probe"]')!;
    const weatherToggle = host.querySelector<HTMLInputElement>('input[aria-label$="Weather"]')!;

    act(() => weatherToggle.click());
    vi.clearAllTimers();
    const changedHidden = probe().dataset.hidden;
    const externalConfig = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!);
    externalConfig.phone.hidden = ["tasks"];
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(externalConfig));
    act(() => window.dispatchEvent(new Event("focus")));
    expect(probe().dataset.hidden).toBe(changedHidden);

    await rerenderProbe(root, false);
    act(() => window.dispatchEvent(new Event("focus")));
    expect(probe().dataset.hidden).toBe("tasks");
  });

  it("uses the same visibilitychange handler for registration and cleanup", async () => {
    const addEventListener = vi.spyOn(document, "addEventListener");
    const removeEventListener = vi.spyOn(document, "removeEventListener");
    const { root } = await renderProbe(false);

    await rerenderProbe(root, true);
    await rerenderProbe(root, false);

    const addedHandlers = addEventListener.mock.calls
      .filter(([type]) => type === "visibilitychange")
      .map(([, handler]) => handler);
    const removedHandlers = removeEventListener.mock.calls
      .filter(([type]) => type === "visibilitychange")
      .map(([, handler]) => handler);

    expect(removedHandlers.length).toBeGreaterThan(0);
    for (const handler of removedHandlers) {
      expect(addedHandlers).toContain(handler);
    }
  });

  it("ignores visibilitychange while suppressed and rehydrates after unmount", async () => {
    vi.useFakeTimers();
    const { host, root } = await renderProbe(false);
    await rerenderProbe(root, true);
    const probe = () => host.querySelector<HTMLElement>('[data-testid="layout-probe"]')!;
    const weatherToggle = host.querySelector<HTMLInputElement>('input[aria-label$="Weather"]')!;
    act(() => weatherToggle.click());
    vi.clearAllTimers();
    const changedHidden = probe().dataset.hidden;
    const externalConfig = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!);
    externalConfig.phone.hidden = ["tasks"];
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(externalConfig));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");

    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(probe().dataset.hidden).toBe(changedHidden);

    await rerenderProbe(root, false);
    const afterUnmountConfig = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!);
    afterUnmountConfig.phone.hidden = ["leaderboard"];
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(afterUnmountConfig));
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(probe().dataset.hidden).toBe("leaderboard");
  });

  it("requires confirmation before resetting all three layouts", async () => {
    const { host } = await renderView();
    const resetButton = buttonByText(host, "Reset layout");
    resetButton.focus();
    expect(document.activeElement).toBe(resetButton);

    act(() => resetButton.click());
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Reset layout?");
    expect(dialog.className).toContain("settings-dialog");
    expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!).phone.hidden).toEqual(["tasks"]);

    act(() => buttonByText(dialog, "Cancel").click());
    await waitForDialogClose();
    expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!).phone.hidden).toEqual(["tasks"]);
    expect(document.activeElement).toBe(resetButton);

    act(() => resetButton.click());
    const confirmDialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    act(() => buttonByText(confirmDialog, "Reset layout").click());
    expect(rowIds(host)[0]).toBe("morningBriefing");
    expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "null")).toBeNull();
  });

  it("explains the uniform grid, Weather tier, and odd tablet row exactly", async () => {
    const { host } = await renderView();
    const helpButton = buttonByText(host, "Help");
    helpButton.focus();

    act(() => helpButton.click());
    const help = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(help.textContent).toContain("uniform widget grid");
    expect(help.textContent).toContain(
      "Weather has no special hero tier; it follows the same grid rules as every other widget. When an odd number of visible widgets fills a tablet row, the last visible widget may span that final row.",
    );
    expect(help.textContent).not.toContain("Weather is the same size");
    expect(help.textContent).not.toMatch(/2\s*[×x]\s*2|two[- ]by[- ]two/i);

    act(() => buttonByText(help, "Got it").click());
    await waitForDialogClose();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(helpButton);
  });

  it("keeps the wall preference tri-state inside Home settings", async () => {
    const { host } = await renderView();
    const wallGroup = host.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Wall display (ApoloSign)"]')!;

    act(() => radioByText(wallGroup, "🧱 Wall on").click());
    expect(localStorage.getItem("consuela-wall-mode")).toBe("on");
    act(() => radioByText(wallGroup, "🧱 Wall off").click());
    expect(localStorage.getItem("consuela-wall-mode")).toBe("off");
    act(() => radioByText(wallGroup, "✨ Auto").click());
    expect(localStorage.getItem("consuela-wall-mode")).toBeNull();
  });

  it("persists layout mutations through the provider after its debounce", async () => {
    vi.useFakeTimers();
    const { host } = await renderView();
    const toggle = host.querySelector<HTMLInputElement>('input[aria-label="Show Tasks"]')!;
    vi.clearAllTimers();

    act(() => toggle.click());
    expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!).phone.hidden).toEqual(["tasks"]);
    vi.advanceTimersByTime(249);
    expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!).phone.hidden).toEqual(["tasks"]);
    vi.advanceTimersByTime(1);
    expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!).phone.hidden).toEqual([]);
  });
});
