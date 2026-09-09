// @vitest-environment jsdom
// Conversation steering on the chat page:
//  - /new + /restart slash commands write a reset marker and start a fresh UI
//    conversation (history stays in PB; LLM context starts after the marker).
//  - The "Clear conversation" trash button is REWIRED to the same reset flow.
//  - A system reset row renders as a "New conversation" divider, not a bubble.
//  - The LLM history sent to the model cuts at the newest reset marker.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const streamMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/chat-stream", () => ({ streamConsuelaChat: (opts: any) => streamMock.fn(opts) }));

const authMock = vi.hoisted(() => ({ state: { currentUser: null as any, isLoggedIn: false } }));

const inputProps = vi.hoisted(() => ({ current: null as null | {
  onSendMessage: (text: string) => Promise<void>;
  sendDisabled?: boolean;
  initialValue?: string;
} }));
vi.mock("@/components/chat/UnifiedInput", () => ({
  UnifiedInput: (props: any) => {
    inputProps.current = props;
    return <textarea data-testid="composer" data-initial={props.initialValue || ""} readOnly />;
  },
}));
vi.mock("@/components/ui/CapsuleNav", () => ({ default: () => null }));
vi.mock("@/components/ui/Avatar", () => ({ default: () => null }));
vi.mock("@/components/ui/SigmaImage", () => ({ default: () => null }));
vi.mock("@/components/3d", () => ({ Icon3D: () => null }));
vi.mock("@/components/ui/Modal", () => ({
  default: ({ open, title, children, footer }: any) =>
    open ? (
      <div data-testid="modal-mock">
        {title && <h3>{title}</h3>}
        {children}
        {footer}
      </div>
    ) : null,
}));
vi.mock("@/app/chat/FamilyBrief", () => ({ FamilyBrief: () => <div data-testid="family-brief-mock" /> }));
vi.mock("@/app/chat/OpenLoopChips", () => ({ OpenLoopChips: () => <div data-testid="open-loops-mock" /> }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authMock.state }));
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

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, messages: [] }), {
  status: 200, headers: { "content-type": "application/json" },
}));

beforeEach(() => {
  inputProps.current = null;
  authMock.state = { currentUser: null, isLoggedIn: false };
  streamMock.fn.mockReset();
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} })));
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true, messages: [] }), {
    status: 200, headers: { "content-type": "application/json" },
  }));
});
afterEach(() => {
  act(() => { activeRoot?.unmount(); });
  activeRoot = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function postCalls(): Array<{ url: string; body: any }> {
  const calls = fetchMock.mock.calls as unknown as Array<[unknown, unknown]>;
  return calls
    .filter(([u]) => String(u).includes("/api/chat/messages"))
    .filter(([, init]) => (init as any)?.method === "POST")
    .map(([u, init]) => ({ url: String(u), body: JSON.parse((init as any).body) }));
}

describe("conversation steering", () => {
  it("/new writes a reset marker, clears the visible thread, keeps PB history untouched", async () => {
    const el = render(<ChatPage />);
    await act(async () => {});
    await act(async () => { await inputProps.current!.onSendMessage("/new"); });
    const posts = postCalls();
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({ action: "reset" });

    // Visible thread resets to the greeting; no error bubble; composer usable.
    expect(el.textContent).not.toContain("Stopped.");
    expect(inputProps.current?.sendDisabled).toBe(false);
    // The user's "/new" never appears as a visible chat row.
    expect(el.textContent).not.toContain("/new");
  });

  it("/restart behaves identically to /new", async () => {
    render(<ChatPage />);
    await act(async () => {});
    await act(async () => { await inputProps.current!.onSendMessage("/restart"); });
    expect(postCalls()).toHaveLength(1);
    expect(postCalls()[0].body).toMatchObject({ action: "reset" });
  });

  it("a system reset row from PB renders as a divider, not a bubble", async () => {
    fetchMock.mockImplementation(async (...args: unknown[]) => {
      if (String(args[0]).includes("/api/chat/messages")) {
        return new Response(JSON.stringify({ ok: true, messages: [
          { id: "r1", role: "user", content: "hi", createdAt: "2026-09-09T10:00:00Z", userId: "Rebecca" },
          { id: "r2", role: "system", content: "New conversation", createdAt: "2026-09-09T11:00:00Z" },
          { id: "r3", role: "assistant", content: "fresh start", createdAt: "2026-09-09T11:00:01Z" },
        ] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: true, items: [] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const el = render(<ChatPage />);
    await act(async () => {});
    await act(async () => {});
    expect(el.textContent).toContain("New conversation");
    expect(el.textContent).toContain("fresh start");
    expect(el.textContent).toContain("hi");
  });

  it("LLM history cuts at the newest reset marker — later messages only", async () => {
    streamMock.fn.mockImplementation(async ({ history }: any) => {
      (streamMock as any).lastHistory = history;
      return { content: "ok", streamed: true };
    });
    render(<ChatPage />);
    await act(async () => {});
    await act(async () => { await inputProps.current!.onSendMessage("pre-reset question"); });
    await act(async () => { await inputProps.current!.onSendMessage("/new"); });
    // First send after the reset: the marker is the newest prior message and
    // the current message travels as `message`, so history is EMPTY — the
    // brain starts clean (no greeting, no pre-reset exchange).
    await act(async () => { await inputProps.current!.onSendMessage("post-reset question"); });
    expect((streamMock as any).lastHistory).toEqual([]);
    // The next send carries only the post-reset exchange — never pre-reset.
    await act(async () => { await inputProps.current!.onSendMessage("follow-up"); });
    const contents = ((streamMock as any).lastHistory as Array<{ content: string }>).map((h) => h.content);
    expect(contents).toEqual(["post-reset question", "ok"]);
    expect(contents).not.toContain("pre-reset question");
  });

  it("the trash button performs a reset (marker POST + fresh thread), not a silent wipe", async () => {
    const el = render(<ChatPage />);
    await act(async () => {});
    const trash = el.querySelector('button[aria-label="Start a new conversation"]') as HTMLButtonElement;
    expect(trash).toBeTruthy();
    await act(async () => { trash.click(); });
    const modal = el.querySelector('[data-testid="modal-mock"]');
    expect(modal).toBeTruthy();
    const confirm = Array.from(modal!.querySelectorAll("button")).find((b) => b.textContent === "Start new conversation");
    expect(confirm).toBeTruthy();
    await act(async () => { confirm!.click(); });
    expect(postCalls()).toHaveLength(1);
    expect(postCalls()[0].body).toMatchObject({ action: "reset" });
  });
});
