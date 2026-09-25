// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  refreshCaches: vi.fn(async () => undefined),
  patchMemberLocal: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ logout: mocks.logout }) }));
vi.mock("@/db", () => ({ db: { refreshCaches: mocks.refreshCaches, patchMemberLocal: mocks.patchMemberLocal } }));
vi.mock("@/components/profile/AvatarPicker", () => ({
  default: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" aria-label="Set avatar" onClick={() => onChange("🦊")}>Set avatar</button>
  ),
}));

import ProfileSheet from "@/components/profile/ProfileSheet";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const member = { id: 1, name: "Rebecca", role: "parent" as const, emoji: "😊", color: "green", avatarSize: "md" as const, glow: false };
let root: Root;
let host: HTMLElement;

function render(open: boolean) {
  return act(async () => {
    root.render(<ProfileSheet open={open} onClose={mocks.logout} member={member} />);
    await Promise.resolve();
    if (vi.isFakeTimers()) {
      await act(async () => { vi.runAllTimers(); await Promise.resolve(); });
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(label: string): HTMLButtonElement {
  const result = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((candidate) => candidate.getAttribute("aria-label") === label || candidate.textContent?.trim() === label || candidate.textContent?.includes(label));
  if (!result) throw new Error(`Missing button ${label}`);
  return result;
}

beforeEach(() => {
  mocks.refreshCaches.mockClear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    return {
      ok: false,
      status: 400,
      json: async () => ({ error: url.includes("/pin") ? "PIN failed" : "Avatar failed" }),
    };
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ProfileSheet sensitive state", () => {
  it("clears avatar failure and PIN state after close and reopen", async () => {
    await render(true);
    const avatarPin = document.querySelector<HTMLInputElement>('input[placeholder="Enter PIN to confirm"]')!;
    await act(async () => button("Set avatar").click());
    await act(async () => setInput(avatarPin, "1234"));
    await act(async () => button("Save avatar").click());
    expect(document.body.textContent).toContain("Avatar failed");

    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    await render(false);
    await render(true);
    expect(document.querySelector<HTMLInputElement>('input[placeholder="Enter PIN to confirm"]')!.value).toBe("");
    expect(document.body.textContent).not.toContain("Avatar failed");

    await act(async () => button("🔑 Change PIN").click());
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[placeholder="Current PIN"], input[placeholder="New PIN"], input[placeholder="Confirm new PIN"]'));
    await act(async () => {
      setInput(inputs[0], "1111");
      setInput(inputs[1], "2222");
      setInput(inputs[2], "2222");
    });
    await act(async () => button("Save PIN").click());
    expect(document.body.textContent).toContain("PIN failed");

    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    await render(false);
    await render(true);
    expect(document.body.textContent).not.toContain("PIN failed");
    expect(document.body.textContent).toContain("🔑 Change PIN");
  });

  it("clears success timers and stale success copy when closed and reopened", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({ member: member }) } as any);
    await render(true);
    await act(async () => button("Set avatar").click());
    const avatarPin = document.querySelector<HTMLInputElement>('input[placeholder="Enter PIN to confirm"]')!;
    await act(async () => setInput(avatarPin, "1234"));
    await act(async () => button("Save avatar").click());
    expect(document.body.textContent).toContain("Saved ✓");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    await render(false);
    await act(async () => { vi.advanceTimersByTime(2500); });
    await render(true);
    expect(document.body.textContent).not.toContain("Saved ✓");
  });

  it("ignores a deferred avatar completion after close and reopen", async () => {
    let resolveFetch!: (value: unknown) => void;
    const response = new Promise((resolve) => { resolveFetch = resolve; });
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/members/profile")) return response as any;
      return { ok: true, status: 200, json: async () => ({}) } as any;
    });
    await render(true);
    await act(async () => button("Set avatar").click());
    const avatarPin = document.querySelector<HTMLInputElement>('input[placeholder="Enter PIN to confirm"]')!;
    await act(async () => setInput(avatarPin, "1234"));
    await act(async () => { button("Save avatar").click(); });
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    await render(false);
    await render(true);
    await act(async () => { resolveFetch({ ok: true, status: 200, json: async () => ({ member }) }); await Promise.resolve(); });
    expect(document.body.textContent).not.toContain("Saved ✓");
    expect(mocks.refreshCaches).not.toHaveBeenCalled();
  });

  it("ignores a deferred PIN completion after close and reopen", async () => {
    let resolveFetch!: (value: unknown) => void;
    const response = new Promise((resolve) => { resolveFetch = resolve; });
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/members/pin")) return response as any;
      return { ok: true, status: 200, json: async () => ({}) } as any;
    });
    await render(true);
    await act(async () => button("🔑 Change PIN").click());
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[placeholder="Current PIN"], input[placeholder="New PIN"], input[placeholder="Confirm new PIN"]'));
    await act(async () => {
      setInput(inputs[0], "1111");
      setInput(inputs[1], "2222");
      setInput(inputs[2], "2222");
    });
    await act(async () => { button("Save PIN").click(); });
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    await render(false);
    await render(true);
    await act(async () => { resolveFetch({ ok: true, status: 200, json: async () => ({}) }); await Promise.resolve(); });
    expect(document.body.textContent).not.toContain("PIN updated");
    expect(document.body.textContent).toContain("🔑 Change PIN");
  });
});
