// P0 follow-on — the emergency result screen must never show a raw route error
// code (`emergency_cooldown` / `emergency_in_flight`) to a parent who is in the
// middle of a real emergency, and it must honor `retryAfterMs` instead of
// ignoring it (which let a parent hammer the 30s cooldown with re-submits).
// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import EmergencyButton from "@/components/ui/EmergencyButton";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function stubMatchMedia() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
stubMatchMedia();

let root: Root | null = null;

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  return act(async () => { root!.render(<EmergencyButton />); });
}

function dialog(): HTMLElement | null {
  return document.querySelector('[role="dialog"]');
}

function click(el: Element | null | undefined) {
  return act(async () => { (el as HTMLElement).click(); });
}

function typePin(pin: string) {
  const input = document.querySelector('input[aria-label="Family PIN"]') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  return act(async () => {
    setter.call(input, pin);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function typeButton(label: string) {
  return Array.from(dialog()!.querySelectorAll("button")).find((b) => b.textContent?.includes(label));
}

async function sendWithResponse(payload: unknown, status: number) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  });
  vi.stubGlobal("fetch", fetchMock);
  await mount();
  await click(document.querySelector('button[aria-label="Emergency"]'));
  await typePin("1234");
  await click(typeButton("Fire"));
  return fetchMock;
}

describe("EmergencyButton result copy — human sentences, never route codes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubMatchMedia();
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    root = null;
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.unstubAllGlobals();
    stubMatchMedia();
  });

  it("shows the route's human cooldown message, never emergency_cooldown", async () => {
    await sendWithResponse({
      ok: false,
      error: "emergency_cooldown",
      message: "An emergency alert was sent recently. Wait 12 seconds before trying again.",
      retryAfterMs: 12_000,
    }, 429);

    expect(dialog()!.textContent).toContain("An emergency alert was sent recently.");
    expect(dialog()!.textContent).not.toContain("emergency_cooldown");
  });

  it("shows the route's human in-flight message, never emergency_in_flight", async () => {
    await sendWithResponse({
      ok: false,
      error: "emergency_in_flight",
      message: "An emergency alert is already sending for this member. Wait for it to finish before trying again.",
    }, 409);

    expect(dialog()!.textContent).toContain("is already sending for this member");
    expect(dialog()!.textContent).not.toContain("emergency_in_flight");
  });

  it("translates a cooldown code into human copy even when the route sends no message", async () => {
    await sendWithResponse({ ok: false, error: "emergency_cooldown", retryAfterMs: 5_000 }, 429);

    expect(dialog()!.textContent).not.toContain("emergency_cooldown");
    expect(dialog()!.textContent).toMatch(/wait \d+ seconds/i);
  });

  it("never renders an unknown snake_case error code verbatim", async () => {
    await sendWithResponse({ ok: false, error: "totally_internal_code" }, 500);

    expect(dialog()!.textContent).not.toContain("totally_internal_code");
    expect(dialog()!.textContent).toMatch(/try again|call emergency services/i);
  });

  it("still surfaces a human error string verbatim (Invalid PIN)", async () => {
    await sendWithResponse({ ok: false, error: "Invalid PIN" }, 401);

    expect(dialog()!.textContent).toContain("Invalid PIN");
  });

  it("honors retryAfterMs: no re-submit during the cooldown, then it re-enables", async () => {
    const fetchMock = await sendWithResponse({
      ok: false,
      error: "emergency_cooldown",
      message: "An emergency alert was sent recently. Wait 12 seconds before trying again.",
      retryAfterMs: 12_000,
    }, 429);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const tryAgain = typeButton("Try Again")!;
    // Still focusable (the dialog always needs a focus target) but inert.
    expect(tryAgain.hasAttribute("disabled")).toBe(false);
    expect(tryAgain.getAttribute("aria-disabled")).toBe("true");

    await click(tryAgain);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Still on the result screen — no re-submit, no bounce back to the picker.
    expect(dialog()!.querySelector('input[aria-label="Family PIN"]')).toBeNull();
    expect(dialog()!.textContent).toContain("Alert Failed");

    await act(async () => { await vi.advanceTimersByTimeAsync(13_000); });
    expect(typeButton("Try Again")!.getAttribute("aria-disabled")).toBeNull();

    // Re-armed: Try Again hands the parent back to the picker, and the next
    // alert really goes out.
    await click(typeButton("Try Again"));
    expect(dialog()!.querySelector('input[aria-label="Family PIN"]')).not.toBeNull();
    await typePin("1234");
    await click(typeButton("Fire"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows the remaining cooldown seconds to the parent", async () => {
    await sendWithResponse({
      ok: false,
      error: "emergency_cooldown",
      message: "An emergency alert was sent recently.",
      retryAfterMs: 30_000,
    }, 429);

    expect(dialog()!.textContent).toMatch(/try again in \d+ seconds/i);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    // Counts down rather than staying frozen at the initial value.
    expect(dialog()!.textContent).not.toMatch(/try again in 30 seconds/i);
  });
});