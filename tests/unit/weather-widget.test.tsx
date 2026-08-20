// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import WeatherWidget from "@/components/ui/WeatherWidget";
import { WeatherProvider } from "@/hooks/useWeather";
import { AtmosphericProvider } from "@/hooks/useAtmosphericTheme";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(
    <WeatherProvider>
      <AtmosphericProvider>{ui}</AtmosphericProvider>
    </WeatherProvider>
  ));
  return el.firstChild as HTMLElement;
}

describe("WeatherWidget details modal", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network"))));
    vi.stubGlobal("requestAnimationFrame", vi.fn((cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("opens the forecast in a modal instead of expanding inline", async () => {
    const el = render(<WeatherWidget />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    const button = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("More details"));
    expect(button).toBeTruthy();

    act(() => button!.click());

    // Forecast content now lives in the overlay modal.
    expect(document.body.textContent).toContain("5-Day Forecast");
    expect(document.body.textContent).toContain("Humidity");

    // The old inline expandable panel (max-height 440px) must be gone.
    const clippedPanel = Array.from(el.querySelectorAll("div")).find(
      (d) => (d as HTMLElement).style.maxHeight === "440px"
    );
    expect(clippedPanel).toBeUndefined();
  });

  it("closes the modal via the Close action", async () => {
    const el = render(<WeatherWidget />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    const button = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("More details"));
    act(() => button!.click());
    expect(document.body.textContent).toContain("5-Day Forecast");

    const close = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("Close"));
    expect(close).toBeTruthy();
    act(() => close!.click());
    expect(document.body.textContent).not.toContain("5-Day Forecast");
  });
});