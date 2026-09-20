// @vitest-environment jsdom
// Role-aware inactivity timeouts: kid/pet sessions end at 15 min, parents at 30.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
}));

vi.mock("@/db", () => ({
  db: {
    selectMembersDetailed: () => [
      { name: "Caspian Garcia", role: "child", emoji: "🧒", color: "cyan", avatarSize: "md", glow: false, age: 5 },
      { name: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet", avatarSize: "md", glow: false },
    ],
    selectMembers: () => [],
  },
}));

vi.mock("@/lib/pending-writes", () => ({ flushPendingWrites: vi.fn(async () => {}) }));

import { AuthProvider } from "@/hooks/useAuth";

let activeRoot: Root | null = null;
async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    activeRoot = createRoot(el);
    activeRoot.render(ui);
  });
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} })));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});

afterEach(() => {
  act(() => { activeRoot?.unmount(); });
  activeRoot = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AuthProvider — role-aware timeouts", () => {
  it("a CHILD session ends at 15 idle minutes (kid window)", async () => {
    vi.useFakeTimers();
    localStorage.setItem("consuela-auth-user", JSON.stringify({ id: 6, name: "Caspian Garcia", role: "child", emoji: "🧒", color: "cyan" }));
    await renderAsync(<AuthProvider><div /></AuthProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(14 * 60 * 1000); });
    expect(localStorage.getItem("consuela-auth-user")).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60 * 1000); });
    expect(localStorage.getItem("consuela-auth-user")).toBeNull();
  });

  it("a PARENT session survives 16 idle minutes (30-minute window)", async () => {
    vi.useFakeTimers();
    localStorage.setItem("consuela-auth-user", JSON.stringify({ id: 1, name: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" }));
    await renderAsync(<AuthProvider><div /></AuthProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(16 * 60 * 1000); });
    expect(localStorage.getItem("consuela-auth-user")).not.toBeNull();
  });

  it("activity keeps a kid session alive past 15 minutes", async () => {
    vi.useFakeTimers();
    localStorage.setItem("consuela-auth-user", JSON.stringify({ id: 6, name: "Caspian Garcia", role: "child", emoji: "🧒", color: "cyan" }));
    await renderAsync(<AuthProvider><div /></AuthProvider>);
    for (let i = 0; i < 3; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(8 * 60 * 1000); });
    window.dispatchEvent(new Event("click"));
    }
    expect(localStorage.getItem("consuela-auth-user")).not.toBeNull();
  });
});
