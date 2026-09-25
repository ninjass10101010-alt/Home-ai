// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import EmergencyTestDialog from "@/components/settings/EmergencyTestDialog";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

interface FetchCall {
  url: string;
  init?: RequestInit;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

let root: Root | null = null;
let host: HTMLElement | null = null;
let calls: FetchCall[] = [];

function stubFetch(response: { ok: boolean; status?: number; data?: Record<string, unknown> }) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: async () => response.data ?? {},
    };
  }));
}

async function mount(props: { open: boolean; onClose?: () => void }) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<EmergencyTestDialog open={props.open} onClose={props.onClose ?? (() => {})} />);
  });
  await settle();
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function dialog(): HTMLElement {
  const value = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!value) throw new Error("Dialog not found");
  return value;
}

function input(): HTMLInputElement {
  const value = dialog().querySelector<HTMLInputElement>('input[type="password"]');
  if (!value) throw new Error("PIN input not found");
  return value;
}

function setInputValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonByText(scope: HTMLElement, text: string): HTMLButtonElement {
  const value = Array.from(scope.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === text);
  if (!value) throw new Error(`Button not found: ${text}`);
  return value;
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: true,
    media: "",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
  stubFetch({ ok: true, data: { success: true } });
});

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
  }
  root = null;
  host?.remove();
  host = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EmergencyTestDialog", () => {
  it("warns that the test reaches real primary recipients and accepts exactly four digits", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    await mount({ open: true });

    expect(dialog().textContent).toMatch(/test alert/i);
    expect(dialog().textContent).toMatch(/real/i);
    expect(dialog().textContent).toMatch(/primary recipients/i);
    expect(dialog().textContent).toMatch(/SMS/);
    expect(dialog().textContent).toMatch(/email/);
    expect(dialog().textContent).toMatch(/house/i);
    expect(dialog().textContent).not.toMatch(/call 911/i);

    const pin = input();
    expect(pin.getAttribute("inputmode")).toBe("numeric");
    expect(pin.getAttribute("maxlength")).toBe("4");
    expect(pin.getAttribute("autocomplete")).toBe("off");
    expect(pin.hasAttribute("name")).toBe(false);
    expect(buttonByText(dialog(), "Send test").disabled).toBe(true);

    await act(async () => setInputValue(pin, "12a345"));
    expect(input().value).toBe("1234");
    expect(buttonByText(dialog(), "Send test").disabled).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("posts a dedicated real test with the PIN and keeps success until Done", async () => {
    const onClose = vi.fn();
    await mount({ open: true, onClose });
    const pin = input();
    await act(async () => setInputValue(pin, "1234"));
    await act(async () => buttonByText(dialog(), "Send test").click());
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/emergency/test");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers).toMatchObject({ "Content-Type": "application/json" });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toEqual({ pin: "1234" });
    expect(dialog().textContent).toMatch(/sent|success/i);
    expect(buttonByText(dialog(), "Done")).toBeTruthy();
    expect(document.activeElement).toBe(buttonByText(dialog(), "Done"));
    expect(dialog().querySelector("button")?.textContent).not.toBe("Cancel");
    await act(async () => {
      setInputValue(input(), "9999");
      dialog().querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(input().value).toBe("");
    expect(calls).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => buttonByText(dialog(), "Done").click());
    await act(async () => {
      root!.render(<EmergencyTestDialog open={false} onClose={onClose} />);
    });
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps a failed result visible, prevents a false success, and offers Retry", async () => {
    stubFetch({ ok: false, status: 500, data: { error: "Alert failed" } });
    const onClose = vi.fn();
    await mount({ open: true, onClose });
    await act(async () => setInputValue(input(), "1234"));
    await act(async () => buttonByText(dialog(), "Send test").click());
    await settle();

    expect(dialog().textContent).toContain("Alert failed");
    expect(dialog().textContent).not.toMatch(/sent successfully|test alert sent/i);
    expect(buttonByText(dialog(), "Retry")).toBeTruthy();
    expect(document.activeElement).toBe(buttonByText(dialog(), "Retry"));
    const errorNode = document.getElementById("settings-emergency-test-pin-error");
    expect(errorNode?.getAttribute("role")).toBe("alert");
    expect(dialog().querySelectorAll('[role="alert"]')).toHaveLength(1);
    const describedBy = input().getAttribute("aria-describedby")?.split(/\s+/) ?? [];
    expect(describedBy.every((id) => document.getElementById(id) !== null)).toBe(true);
    await act(async () => {
      setInputValue(input(), "9999");
      dialog().querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(input().value).toBe("");
    expect(calls).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      dialog().parentElement?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => buttonByText(dialog(), "Retry").click());
    expect(buttonByText(dialog(), "Send test")).toBeTruthy();
    expect(calls).toHaveLength(1);
  });

  it("shows server retry guidance for a duplicate-send cooldown", async () => {
    stubFetch({
      ok: false,
      status: 429,
      data: {
        error: "test_alert_cooldown",
        message: "A real test alert was sent recently. Wait 27 seconds before trying again.",
        retryAfterMs: 27000,
      },
    });
    await mount({ open: true });
    await act(async () => setInputValue(input(), "1234"));
    await act(async () => buttonByText(dialog(), "Send test").click());
    await settle();

    expect(dialog().textContent).toContain("Wait 27 seconds before trying again");
    expect(buttonByText(dialog(), "Retry")).toBeTruthy();
  });

  it("renders house-only partial delivery instead of a generic success", async () => {
    stubFetch({
      ok: true,
      data: {
        success: true,
        partial: true,
        warning: "House channels delivered, but no primary contact confirmed SMS or email. Retry may duplicate house delivery.",
        details: {
          total: 1,
          successful: 0,
          failed: 1,
          partial: true,
          contactsSource: "cache",
          results: [{
            contact: "Rebecca",
            results: [
              { method: "SMS", success: false, error: "sms unavailable" },
              { method: "Email", success: false, error: "email unavailable" },
            ],
          }],
          channelResults: [
            { contact: "Rebecca", method: "SMS", success: false, error: "sms unavailable" },
            { contact: "Rebecca", method: "Email", success: false, error: "email unavailable" },
          ],
          houseAlert: { sent: 2, failed: 0, notes: ["telegram delivered"] },
        },
      },
    });
    await mount({ open: true });
    await act(async () => setInputValue(input(), "1234"));
    await act(async () => buttonByText(dialog(), "Send test").click());
    await settle();

    expect(dialog().textContent).toMatch(/partially delivered|partial/i);
    expect(dialog().textContent).toContain("0 of 1");
    expect(dialog().textContent).toContain("House channels: 2 sent, 0 failed");
    expect(dialog().textContent).toContain("telegram delivered");
    expect(dialog().textContent).toMatch(/stale cached contacts/i);
    expect(dialog().textContent).not.toMatch(/test alert sent\. check the configured channels/i);
  });

  it("renders delivery details when every channel fails", async () => {
    stubFetch({
      ok: false,
      status: 502,
      data: {
        error: "delivery_failed",
        partial: true,
        warning: "No house channel confirmed delivery.",
        details: {
          total: 1,
          successful: 0,
          failed: 1,
          partial: true,
          channelResults: [{ contact: "Rebecca", method: "SMS", success: false, error: "sms unavailable" }],
          houseAlert: { sent: 0, failed: 1, notes: ["telegram unavailable"] },
        },
      },
    });
    await mount({ open: true });
    await act(async () => setInputValue(input(), "1234"));
    await act(async () => buttonByText(dialog(), "Send test").click());
    await settle();

    expect(dialog().textContent).toContain("0 of 1");
    expect(dialog().textContent).toContain("House channels: 0 sent, 1 failed");
    expect(dialog().textContent).toContain("telegram unavailable");
  });

  it("keeps house-only route errors test-specific and non-alarming", async () => {
    stubFetch({
      ok: false,
      status: 500,
      data: { error: "Test alert reached house channels, but no primary recipient confirmed SMS or email. Retry may duplicate house delivery." },
    });
    await mount({ open: true });
    await act(async () => setInputValue(input(), "1234"));
    await act(async () => buttonByText(dialog(), "Send test").click());
    await settle();

    expect(dialog().textContent).toContain("Test alert reached house channels");
    expect(dialog().textContent).toMatch(/retry may duplicate house delivery/i);
    expect(dialog().textContent).not.toMatch(/emergency alert|911/i);
    expect(buttonByText(dialog(), "Retry")).toBeTruthy();
  });

  it("blocks two programmatic submits dispatched in the same render", async () => {
    const pending = deferred<{ ok: boolean; json: () => Promise<Record<string, unknown>> }>();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return pending.promise;
    }));
    await mount({ open: true });
    await act(async () => setInputValue(input(), "1234"));

    await act(async () => {
      const form = dialog().querySelector("form")!;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(calls).toHaveLength(1);

    await act(async () => {
      pending.resolve({ ok: true, json: async () => ({ success: true }) });
      await pending.promise;
    });
    await settle();
    expect(buttonByText(dialog(), "Done")).toBeTruthy();
  });

  it("blocks Escape, backdrop, and Cancel in the same render as submit", async () => {
    const pending = deferred<{ ok: boolean; json: () => Promise<Record<string, unknown>> }>();
    const onClose = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return pending.promise;
    }));
    await mount({ open: true, onClose });
    await act(async () => setInputValue(input(), "1234"));

    await act(async () => {
      dialog().querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      dialog().parentElement?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      buttonByText(dialog(), "Cancel").click();
    });

    expect(calls).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => {
      pending.resolve({ ok: true, json: async () => ({ success: true }) });
      await pending.promise;
    });
    await settle();
  });

  it("blocks every dismissal while sending and keeps the read-only PIN focused", async () => {
    const pending = deferred<{ ok: boolean; json: () => Promise<Record<string, unknown>> }>();
    const onClose = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return pending.promise;
    }));
    await mount({ open: true, onClose });
    await act(async () => setInputValue(input(), "1234"));
    await act(async () => buttonByText(dialog(), "Send test").click());

    expect(input().readOnly).toBe(true);
    expect(document.activeElement).toBe(input());
    expect(buttonByText(dialog(), "Cancel").disabled).toBe(true);
    await act(async () => {
      setInputValue(input(), "9999");
      dialog().querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      dialog().parentElement?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      buttonByText(dialog(), "Cancel").click();
    });
    expect(input().value).toBe("1234");
    expect(document.activeElement).toBe(input());
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(calls).toHaveLength(1);

    await act(async () => {
      pending.resolve({ ok: true, json: async () => ({ success: true }) });
      await pending.promise;
    });
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(buttonByText(dialog(), "Done"));

    await act(async () => buttonByText(dialog(), "Done").click());
    await act(async () => {
      root!.render(<EmergencyTestDialog open={false} onClose={onClose} />);
    });
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clears the memory-only PIN when an idle dialog is closed and reopened", async () => {
    const onClose = vi.fn();
    await mount({ open: true, onClose });
    await act(async () => setInputValue(input(), "1234"));
    await act(async () => buttonByText(dialog(), "Cancel").click());
    await settle();

    await act(async () => {
      root!.render(<EmergencyTestDialog open={false} onClose={onClose} />);
    });
    await settle();
    await act(async () => {
      root!.render(<EmergencyTestDialog open onClose={onClose} />);
    });
    await settle();

    expect(input().value).toBe("");
    expect(calls).toHaveLength(0);
  });
});
