// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import ChatPage from "@/app/chat/page";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const streamMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/chat-stream", () => ({ streamConsuelaChat: (opts: any) => streamMock.fn(opts) }));

vi.mock("@/components/chat/UnifiedInput", () => ({
  UnifiedInput: () => <textarea data-testid="composer" readOnly />,
}));
vi.mock("@/components/ui/CapsuleNav", () => ({ default: () => null }));
vi.mock("@/components/3d", () => ({ Icon3D: () => null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ currentUser: null, isLoggedIn: false }) }));
vi.mock("@/hooks/usePendingChatQuery", () => ({ usePendingChatQuery: () => {} }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

const PHOTO = "data:image/webp;base64,UklGRkIZAABXRUJQVlA4WAoAAAAQREBEQA==";

const rosterMock = vi.hoisted(() => ({ members: [] as any[] }));
vi.mock("@/db", () => ({
  db: {
    selectMembers: () => rosterMock.members.map((m) => ({ ...m })),
  },
}));

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

async function settle(ms = 120) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

describe("Chat speaker picker live roster (consuela-members-updated)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.unstubAllGlobals();
    Element.prototype.scrollIntoView = vi.fn() as any;
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, messages: [] }), {
      status: 200, headers: { "content-type": "application/json" },
    })));
    rosterMock.members = [
      { name: "Rebecca", role: "parent", emoji: "👩", color: "violet" },
      { name: "Emily", role: "child", emoji: "👧", color: "rose" },
    ];
  });

  afterEach(() => {
    act(() => { activeRoot?.unmount(); });
    activeRoot = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("speaker picker shows the new photo emoji option after consuela-members-updated fires", async () => {
    const el = await renderAsync(<ChatPage />);
    await settle();

    // Open the speaker picker (guest mode shows the picker button).
    await act(async () => {
      const btn = el.querySelector("button[aria-label^='Speaking as']") as HTMLButtonElement | null;
      expect(btn).toBeTruthy();
      btn!.click();
    });
    await settle();

    let items = Array.from(el.querySelectorAll("[role='menuitem']"));
    expect(items.length).toBe(2);
    // Pre-event: emoji roster — no photo <img> in the picker yet.
    expect(el.querySelector("[role='menu'] img")).toBeNull();

    // The roster refreshes: Emily's emoji is now a photo data URL.
    rosterMock.members = rosterMock.members.map((m) =>
      m.name === "Emily" ? { ...m, emoji: PHOTO } : m
    );

    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-members-updated"));
    });
    await settle();

    // Picker re-renders from the fresh roster: Emily's row now shows her photo.
    const img = el.querySelector("[role='menu'] img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(PHOTO);
    items = Array.from(el.querySelectorAll("[role='menuitem']"));
    expect(items.length).toBe(2);
  });
});
