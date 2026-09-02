// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const streamMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/chat-stream", () => ({ streamConsuelaChat: (opts: any) => streamMock.fn(opts) }));

let capturedSend: ((text: string) => Promise<void>) | null = null;
vi.mock("@/components/chat/UnifiedInput", () => ({
  UnifiedInput: ({ onSendMessage }: { onSendMessage: (t: string) => Promise<void> }) => {
    capturedSend = onSendMessage;
    return null;
  },
}));
vi.mock("@/components/ui/CapsuleNav", () => ({ default: () => null }));
vi.mock("@/components/ui/Avatar", () => ({ default: () => null }));
vi.mock("@/components/ui/SigmaImage", () => ({ default: () => null }));
vi.mock("@/components/3d", () => ({ Icon3D: () => null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ currentUser: null, isLoggedIn: false }) }));
vi.mock("@/hooks/usePendingChatQuery", () => ({ usePendingChatQuery: () => {} }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/db", () => ({ db: { selectMembers: () => [] } }));

import ChatPage from "@/app/chat/page";

let activeRoot: ReturnType<typeof createRoot> | null = null;
function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => { activeRoot = createRoot(el); activeRoot.render(ui); });
  return el;
}

beforeEach(() => {
  capturedSend = null;
  streamMock.fn.mockReset();
  localStorage.clear();
  // jsdom has no scrollIntoView; the chat page's auto-scroll effect calls it on mount.
  Element.prototype.scrollIntoView = vi.fn();
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
});
afterEach(() => {
  // Tear down the mounted ChatPage so its async effects can't leak into the
  // next test (they share the module-level capturedSend / streamMock seams).
  act(() => { activeRoot?.unmount(); });
  activeRoot = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("chat page streaming", () => {
  it("appends tokens progressively into one assistant bubble", async () => {
    streamMock.fn.mockImplementation(async ({ onToken }: any) => {
      onToken("Hel", "Hel");
      await new Promise((r) => setTimeout(r, 0));
      onToken("Hello", "lo");
      await new Promise((r) => setTimeout(r, 0));
      return { content: "Hello", streamed: true };
    });
    const el = render(<ChatPage />);
    await act(async () => { await capturedSend!("hi"); });
    const bubbles = Array.from(el.querySelectorAll("[role='log'] *")).length; // render happened
    expect(el.textContent).toContain("Hello");
    // exactly one assistant bubble with the final content
    expect((el.textContent?.match(/Hello/g) || []).length).toBe(1);
    void bubbles;
  });

  it("shows the tool status line while waiting for the first token", async () => {
    let resolveStream: ((r: { content: string; streamed: boolean }) => void) | null = null;
    streamMock.fn.mockImplementation(({ onStatus }: any) => {
      onStatus("Checking the pantry…");
      return new Promise((res) => { resolveStream = res; });
    });
    const el = render(<ChatPage />);
    // Fire the send without awaiting the (still-pending) stream.
    let sendPromise: Promise<void> | undefined;
    act(() => { sendPromise = capturedSend!("any low?"); });
    expect(el.textContent).toContain("Checking the pantry…");
    await act(async () => { resolveStream!({ content: "all stocked", streamed: true }); await sendPromise; });
    expect(el.textContent).toContain("all stocked");
    // Status line clears once the reply lands.
    expect(el.textContent).not.toContain("Checking the pantry…");
  });

  it("ignores a second send while the first stream is in flight", async () => {
    const resolvers: ((r: { content: string; streamed: boolean }) => void)[] = [];
    streamMock.fn.mockImplementation(({ onToken }: any) => {
      onToken("STREAMED-REPLY", "STREAMED-REPLY");
      return new Promise((res) => { resolvers.push(res); });
    });
    const el = render(<ChatPage />);
    let first: Promise<void> | undefined;
    act(() => { first = capturedSend!("first-message"); });
    // Second send fires while the first stream is still appending (the typing
    // indicator is already false after the first token — the old guard let this through).
    let second: Promise<void> | undefined;
    act(() => { second = capturedSend!("SECOND-SEND"); });
    await act(async () => {
      for (const res of resolvers) res({ content: "STREAMED-REPLY", streamed: true });
      await first;
      await second;
    });
    expect(streamMock.fn).toHaveBeenCalledTimes(1);
    // exactly one assistant bubble, carrying the first stream's content
    expect((el.textContent?.match(/STREAMED-REPLY/g) || []).length).toBe(1);
    expect(el.textContent).not.toContain("SECOND-SEND");
  });

  it("shows the error bubble + Try again when the stream throws", async () => {
    streamMock.fn.mockRejectedValue(new Error("boom"));
    const el = render(<ChatPage />);
    await act(async () => { await capturedSend!("hi"); });
    expect(el.textContent).toContain("Sorry, I'm having trouble right now.");
    expect(el.textContent).toContain("Try again");
  });
});
