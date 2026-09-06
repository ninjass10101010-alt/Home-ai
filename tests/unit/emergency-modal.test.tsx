// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import EmergencyButton from "@/components/ui/EmergencyButton";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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

let root: Root | null = null;

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  return act(async () => { root!.render(<EmergencyButton />); });
}

function shield(): HTMLButtonElement {
  return document.querySelector('button[aria-label="Emergency"]') as HTMLButtonElement;
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

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
});

describe("EmergencyButton on the shared Modal", () => {
  it("shield is a 44px+ alarm-rose target (not the seasonal accent)", async () => {
    await mount();
    const btn = shield();
    expect(btn.className).toContain("h-11");
    expect(btn.className).toContain("w-11");
    expect(btn.className).toContain("bg-[var(--color-accent-rose)]");
    expect(btn.className).not.toContain("rose-500");
  });

  it("tapping the shield opens a real modal dialog", async () => {
    await mount();
    expect(dialog()).toBeNull();
    await click(shield());
    expect(dialog()).not.toBeNull();
    expect(dialog()!.parentElement?.parentElement).toBe(document.body);
    expect(dialog()!.getAttribute("aria-modal")).toBe("true");
    expect(dialog()!.querySelector('input[aria-label="Family PIN"]')).not.toBeNull();
  });

  it("alert types stay disabled until a 4-digit PIN is entered", async () => {
    await mount();
    await click(shield());
    const fire = typeButton("Fire");
    expect(fire).toBeTruthy();
    expect(fire!.hasAttribute("disabled")).toBe(true);
    await typePin("1234");
    expect(typeButton("Fire")!.hasAttribute("disabled")).toBe(false);
  });

  it("success is persistent: no auto-close, shows counts + 911 line, Done closes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: "Alert sent", details: { successful: 2, total: 3 } }),
    }));
    await mount();
    await click(shield());
    await typePin("1234");
    await click(typeButton("Fire"));
    expect(dialog()!.textContent).toContain("Sent to 2 of 3 contacts");
    expect(dialog()!.textContent).toContain("If this is a life-threatening emergency, call 911.");
    const done = typeButton("Done");
    expect(done).toBeTruthy();
    // The old flow auto-closed after 3s — the success screen must persist.
    await act(async () => { await new Promise((r) => setTimeout(r, 3200)); });
    expect(dialog()).not.toBeNull();
    await click(done);
    expect(dialog()).toBeNull();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe("/api/emergency");
    expect(JSON.parse(String((call[1] as RequestInit).body)).type).toBe("fire");
  });

  it("failure keeps Try Again and returns to type selection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Invalid PIN" }),
    }));
    await mount();
    await click(shield());
    await typePin("0000");
    await click(typeButton("Water Leak"));
    expect(dialog()!.textContent).toContain("Alert Failed");
    await click(typeButton("Try Again"));
    expect(dialog()!.querySelector('input[aria-label="Family PIN"]')).not.toBeNull();
    expect(dialog()!.textContent).toContain("Fire");
  });

  it("Try Again keeps focus inside the dialog and clears the stale PIN", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Invalid PIN" }),
    }));
    await mount();
    await click(shield());
    await typePin("0000");
    await click(typeButton("Water Leak"));
    expect(dialog()!.textContent).toContain("Alert Failed");
    await click(typeButton("Try Again"));
    const input = dialog()!.querySelector('input[aria-label="Family PIN"]') as HTMLInputElement;
    // The focused Try Again button unmounts on this path — focus must land on
    // the PIN input (not body), and the stale PIN must be dropped.
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("");
  });
});
