// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ login: mocks.login }),
}));

import SettingsSignInDialog from "@/components/settings/SettingsSignInDialog";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

let root: Root | null = null;
let host: HTMLElement | null = null;

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

function button(text: string): HTMLButtonElement {
  const value = Array.from(dialog().querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === text);
  if (!value) throw new Error(`Button not found: ${text}`);
  return value;
}

function setPin(value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input(), value);
  input().dispatchEvent(new Event("input", { bubbles: true }));
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  mocks.login.mockReset();
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
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SettingsSignInDialog", () => {
  it("blocks every dismissal while login is busy and keeps the read-only PIN focused", async () => {
    const pending = deferred<{ success: boolean; error?: string }>();
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    mocks.login.mockReturnValue(pending.promise);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<SettingsSignInDialog open memberName="Rebecca" onClose={onClose} onSuccess={onSuccess} />);
    });
    await settle();

    await act(async () => setPin("1234"));
    await act(async () => button("Sign in").click());

    expect(input().readOnly).toBe(true);
    expect(document.activeElement).toBe(input());
    expect(button("Cancel").disabled).toBe(true);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      dialog().parentElement?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button("Cancel").click();
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(input());

    await act(async () => {
      pending.resolve({ success: true });
      await pending.promise;
    });
    await settle();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("releases the synchronous guard after a wrong PIN so dismissal and retry work", async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    mocks.login
      .mockResolvedValueOnce({ success: false, error: "Wrong PIN" })
      .mockResolvedValueOnce({ success: true });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<SettingsSignInDialog open memberName="Rebecca" onClose={onClose} onSuccess={onSuccess} />);
    });
    await settle();

    await act(async () => setPin("1234"));
    await act(async () => button("Sign in").click());
    await settle();

    expect(dialog().textContent).toContain("Wrong PIN");
    expect(button("Cancel").disabled).toBe(false);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      dialog().parentElement?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button("Cancel").click();
    });
    expect(onClose).toHaveBeenCalledTimes(3);

    await act(async () => setPin("5678"));
    await act(async () => button("Sign in").click());
    await settle();

    expect(mocks.login).toHaveBeenCalledTimes(2);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("releases the synchronous guard after a network exception so dismissal and retry work", async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    mocks.login
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ success: true });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<SettingsSignInDialog open memberName="Rebecca" onClose={onClose} onSuccess={onSuccess} />);
    });
    await settle();

    await act(async () => setPin("1234"));
    await act(async () => button("Sign in").click());
    await settle();

    expect(dialog().textContent).toContain("check the connection");
    expect(button("Cancel").disabled).toBe(false);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      dialog().parentElement?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button("Cancel").click();
    });
    expect(onClose).toHaveBeenCalledTimes(3);

    await act(async () => setPin("5678"));
    await act(async () => button("Sign in").click());
    await settle();

    expect(mocks.login).toHaveBeenCalledTimes(2);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
