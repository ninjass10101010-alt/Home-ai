// Task 15 — the point-adjustment confirm chip. Chat never moves points: a
// tool `status` frame carrying a `proposal` grows a "Confirm with PIN" chip
// under the assistant bubble, and ONLY the PIN submitted through that chip
// POSTs /api/consuela/planner/apply (with x-consuela-pin). Page-level tests
// reuse the chat-page-stream harness mocking idiom.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const streamMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/chat-stream", () => ({ streamConsuelaChat: (opts: any) => streamMock.fn(opts) }));

const kidStore = vi.hoisted(() => ({
  verifyPinRemote: vi.fn(),
  unreachableCopy: vi.fn(() => "Couldn't reach Consuela — check the connection and try again."),
}));
vi.mock("@/modes/kid/kid-store", () => ({
  verifyPinRemote: kidStore.verifyPinRemote,
  unreachableCopy: kidStore.unreachableCopy,
}));

const authMock = vi.hoisted(() => ({
  state: { currentUser: null as any, isLoggedIn: false },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authMock.state }));

const inputProps = vi.hoisted(() => ({ current: null as null | { onSendMessage: (t: string) => Promise<void> } }));
vi.mock("@/components/chat/UnifiedInput", () => ({
  UnifiedInput: (props: any) => {
    inputProps.current = props;
    return <textarea data-testid="composer" readOnly />;
  },
}));
vi.mock("@/components/ui/CapsuleNav", () => ({ default: () => null }));
vi.mock("@/components/ui/Avatar", () => ({ default: () => null }));
vi.mock("@/components/ui/SigmaImage", () => ({ default: () => null }));
vi.mock("@/components/3d", () => ({ Icon3D: () => null }));
// Modal gated on `open` so "no modal before the chip is tapped" is assertable.
vi.mock("@/components/ui/Modal", () => ({
  default: ({ open, title, description, children, footer }: any) =>
    open ? (
      <div data-testid="pin-modal">
        {title && <h3>{title}</h3>}
        {description && <p>{description}</p>}
        {children}
        {footer}
      </div>
    ) : null,
}));
vi.mock("@/app/chat/FamilyBrief", () => ({ FamilyBrief: () => <div data-testid="family-brief-mock" /> }));
vi.mock("@/app/chat/OpenLoopChips", () => ({ OpenLoopChips: () => <div data-testid="open-loops-mock" /> }));
vi.mock("@/hooks/usePendingChatQuery", () => ({ usePendingChatQuery: () => {} }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/db", () => ({ db: { selectMembers: () => [] } }));

import ChatPage from "@/app/chat/page";
import AdjustPointsChip from "@/components/chat/AdjustPointsChip";
import { __resetChatStoreForTests } from "@/lib/chat-store";

const PROPOSAL = {
  tool: "adjust_points" as const,
  args: { member: "Emily G", delta: 10, reason: "helping carry groceries" },
};

let activeRoot: ReturnType<typeof createRoot> | null = null;
function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => { activeRoot = createRoot(el); activeRoot.render(ui); });
  return el;
}

const applyCalls: Array<{ url: string; init: any }> = [];
function stubFetch(applyResponse: { status: number; body: unknown }) {
  applyCalls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
    const u = String(url);
    if (u.includes("/api/consuela/planner/apply")) {
      applyCalls.push({ url: u, init });
      return new Response(JSON.stringify(applyResponse.body), {
        status: applyResponse.status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, messages: [] }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }));
}

function typePin(el: HTMLElement, pin: string) {
  const input = el.querySelector('input[type="password"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, pin);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clickButton(el: HTMLElement | Document, label: string): boolean {
  const root: ParentNode = el;
  const btn = Array.from(root.querySelectorAll("button")).find(
    (b) => b.textContent?.includes(label),
  ) as HTMLButtonElement | undefined;
  if (!btn) return false;
  act(() => { btn.click(); });
  return true;
}

beforeEach(() => {
  __resetChatStoreForTests();
  inputProps.current = null;
  authMock.state = {
    currentUser: { name: "Rebecca G", role: "parent", emoji: "🐱", color: "rose" },
    isLoggedIn: true,
  };
  streamMock.fn.mockReset();
  kidStore.verifyPinRemote.mockReset();
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })));
});
afterEach(() => {
  act(() => { activeRoot?.unmount(); });
  activeRoot = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("chat page — point-proposal chip wiring", () => {
  it("a status frame carrying a proposal renders the Confirm chip; nothing POSTs before a PIN lands", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    streamMock.fn.mockImplementation(async ({ onStatus, onToken }: any) => {
      onStatus("Preparing that point adjustment…", {
        label: "Preparing that point adjustment…",
        proposal: PROPOSAL,
      });
      onToken("Ask the parent to confirm", "Ask the parent to confirm");
      return { content: "Ask the parent to confirm", streamed: true };
    });
    const el = render(<ChatPage />);
    await act(async () => { await inputProps.current!.onSendMessage("add 10 points to Emily"); });

    // The chip is there, with the locked label shape.
    expect(el.textContent).toContain("Confirm with PIN");
    expect(el.textContent).toContain("+10 pts to Emily");
    expect(el.textContent).toContain("helping carry groceries");
    // And NOTHING hit the apply route — the proposal is inert until the PIN.
    expect(applyCalls).toHaveLength(0);
  });

  it("the buffered (non-stream) path surfaces proposals too", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    streamMock.fn.mockResolvedValue({
      content: "Ready for confirmation",
      streamed: false,
      proposals: [PROPOSAL],
    });
    const el = render(<ChatPage />);
    await act(async () => { await inputProps.current!.onSendMessage("add 10 points to Emily"); });
    expect(el.textContent).toContain("Confirm with PIN");
    expect(applyCalls).toHaveLength(0);
  });

  it("submitting the PIN POSTs the apply route with x-consuela-pin + the exact body, then confirms", async () => {
    stubFetch({ status: 200, body: { ok: true, member: "Emily G", delta: 10, newTotal: 23 } });
    kidStore.verifyPinRemote.mockResolvedValue({ status: "ok", member: { name: "Rebecca G" } });
    streamMock.fn.mockImplementation(async ({ onStatus, onToken }: any) => {
      onStatus("x", { label: "x", proposal: PROPOSAL });
      onToken("done", "done");
      return { content: "done", streamed: true };
    });
    const el = render(<ChatPage />);
    await act(async () => { await inputProps.current!.onSendMessage("add 10 points to Emily"); });
    expect(applyCalls).toHaveLength(0);

    // Tap the chip → PIN modal opens; still no POST until a PIN is submitted.
    expect(clickButton(el, "Confirm with PIN")).toBe(true);
    expect(el.querySelector('[data-testid="pin-modal"]')).not.toBeNull();
    expect(applyCalls).toHaveLength(0);

    typePin(el, "1234");
    expect(clickButton(el, "Submit")).toBe(true);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(kidStore.verifyPinRemote).toHaveBeenCalledWith("Rebecca G", "1234");
    expect(applyCalls).toHaveLength(1);
    const { init } = applyCalls[0];
    expect(init.headers["x-consuela-pin"]).toBe("1234");
    expect(JSON.parse(init.body)).toEqual({ tool: "adjust_points", args: PROPOSAL.args });
    // Success: toast + button becomes Done.
    expect(document.body.textContent).toContain("Points adjusted ✓");
    expect(el.textContent).toContain("Done ✓");
    expect(el.textContent).not.toContain("Confirm with PIN");
  });

  it("an unknown/garbage proposal payload renders no chip", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    streamMock.fn.mockImplementation(async ({ onStatus, onToken }: any) => {
      onStatus("x", { label: "x", proposal: { tool: "remove_event", args: { title: "x" } } });
      onStatus("y", { label: "y" });
      onToken("ok", "ok");
      return { content: "ok", streamed: true };
    });
    const el = render(<ChatPage />);
    await act(async () => { await inputProps.current!.onSendMessage("hi"); });
    expect(el.textContent).not.toContain("Confirm with PIN");
  });
});

describe("AdjustPointsChip — PIN modal behavior (mirrors SuggestionPinModal)", () => {
  it("wrong PIN re-prompts and never POSTs", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    kidStore.verifyPinRemote.mockResolvedValue({ status: "wrongPin" });
    const el = render(<AdjustPointsChip proposal={PROPOSAL} actorName="Rebecca G" />);
    expect(clickButton(el, "Confirm with PIN")).toBe(true);
    typePin(el, "9999");
    expect(clickButton(el, "Submit")).toBe(true);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(el.textContent).toContain("Wrong PIN");
    expect(applyCalls).toHaveLength(0);
    // Re-prompt: the modal is still open for another try.
    expect(el.querySelector('[data-testid="pin-modal"]')).not.toBeNull();
  });

  it("unreachable verification surfaces the honest copy, not a fake success", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    kidStore.verifyPinRemote.mockResolvedValue({ status: "unreachable" });
    const el = render(<AdjustPointsChip proposal={PROPOSAL} actorName="Rebecca G" />);
    clickButton(el, "Confirm with PIN");
    typePin(el, "1234");
    clickButton(el, "Submit");
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(el.textContent).toContain("Couldn't reach Consuela");
    expect(applyCalls).toHaveLength(0);
    expect(el.textContent).not.toContain("Done ✓");
  });

  it("a 401 from the apply route re-prompts (server says the PIN is wrong)", async () => {
    stubFetch({ status: 401, body: { error: "pin required" } });
    kidStore.verifyPinRemote.mockResolvedValue({ status: "ok", member: {} });
    const el = render(<AdjustPointsChip proposal={PROPOSAL} actorName="Rebecca G" />);
    clickButton(el, "Confirm with PIN");
    typePin(el, "1234");
    clickButton(el, "Submit");
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(applyCalls).toHaveLength(1);
    expect(el.textContent).toContain("Wrong PIN");
    expect(el.textContent).not.toContain("Done ✓");
  });

  it("closing the modal clears the PIN — reopening starts empty", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    const el = render(<AdjustPointsChip proposal={PROPOSAL} actorName="Rebecca G" />);
    clickButton(el, "Confirm with PIN");
    typePin(el, "1234");
    expect(clickButton(el, "Cancel")).toBe(true);
    clickButton(el, "Confirm with PIN");
    const input = el.querySelector('input[type="password"]') as HTMLInputElement;
    expect(input.value).toBe("");
    expect(applyCalls).toHaveLength(0);
  });

  it("no actor (signed-out) → honest refusal instead of a POST", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    const el = render(<AdjustPointsChip proposal={PROPOSAL} actorName={null} />);
    clickButton(el, "Confirm with PIN");
    typePin(el, "1234");
    clickButton(el, "Submit");
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(kidStore.verifyPinRemote).not.toHaveBeenCalled();
    expect(applyCalls).toHaveLength(0);
    expect(el.textContent).toMatch(/sign in/i);
  });
});
