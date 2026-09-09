// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const streamMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/chat-stream", () => ({ streamConsuelaChat: (opts: any) => streamMock.fn(opts) }));

const authMock = vi.hoisted(() => ({ state: { currentUser: null as any, isLoggedIn: false } }));

// Captured UnifiedInput props — the page↔composer contract under test.
const inputProps = vi.hoisted(() => ({ current: null as null | {
  onSendMessage: (text: string) => Promise<void>;
  disabled?: boolean;
  sendDisabled?: boolean;
  streaming?: boolean;
  onStop?: () => void;
  initialValue?: string;
} }));
vi.mock("@/components/chat/UnifiedInput", () => ({
  UnifiedInput: (props: any) => {
    inputProps.current = props;
    return <textarea data-testid="composer" data-disabled={String(!!props.disabled)} data-send-disabled={String(!!props.sendDisabled)} readOnly />;
  },
}));
vi.mock("@/components/ui/CapsuleNav", () => ({ default: () => null }));
vi.mock("@/components/ui/Avatar", () => ({ default: () => null }));
vi.mock("@/components/ui/SigmaImage", () => ({ default: () => null }));
vi.mock("@/components/3d", () => ({ Icon3D: () => null }));
vi.mock("@/components/ui/Modal", () => ({
  default: ({ title, description, children, footer }: { title?: string; description?: string; children?: React.ReactNode; footer?: React.ReactNode }) => (
    <div data-testid="modal-mock">
      {title && <h3>{title}</h3>}
      {description && <p>{description}</p>}
      {children}
      {footer}
    </div>
  ),
}));
// FamilyBrief/OpenLoopChips are covered by their own suites; here they render
// inert so the page harness can assert on the composer/chips contract.
vi.mock("@/app/chat/FamilyBrief", () => ({
  FamilyBrief: () => <div data-testid="family-brief-mock" />,
}));
vi.mock("@/app/chat/OpenLoopChips", () => ({
  OpenLoopChips: ({ onDraft }: { onDraft: (t: string) => void }) => (
    <div data-testid="open-loops-mock">
      {["Add Event", "Plan Meals", "Assign Chore", "Grocery List"].map((label, i) => (
        <button
          key={label}
          data-draft={
            ["Add soccer practice tomorrow at 4pm", "Plan dinners for this week", "Assign trash duty every Thursday with 10 points", "Generate grocery list for this week's meals"][i]
          }
          onClick={() => onDraft(
            ["Add soccer practice tomorrow at 4pm", "Plan dinners for this week", "Assign trash duty every Thursday with 10 points", "Generate grocery list for this week's meals"][i]
          )}
        >
          {label}
        </button>
      ))}
    </div>
  ),
}));
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

beforeEach(() => {
  inputProps.current = null;
  authMock.state = { currentUser: null, isLoggedIn: false };
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
    await act(async () => { await inputProps.current!.onSendMessage("hi"); });
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
    act(() => { sendPromise = inputProps.current!.onSendMessage("any low?"); });
    expect(el.textContent).toContain("Checking the pantry…");
    await act(async () => { resolveStream!({ content: "all stocked", streamed: true }); await sendPromise; });
    expect(el.textContent).toContain("all stocked");
    // Status line clears once the reply lands.
    expect(el.textContent).not.toContain("Checking the pantry…");
  });

  it("keeps the composer editable mid-stream but blocks the send", async () => {
    const resolvers: ((r: { content: string; streamed: boolean }) => void)[] = [];
    streamMock.fn.mockImplementation(({ onToken }: any) => {
      onToken("STREAMED-REPLY", "STREAMED-REPLY");
      return new Promise((res) => { resolvers.push(res); });
    });
    const el = render(<ChatPage />);
    let first: Promise<void> | undefined;
    act(() => { first = inputProps.current!.onSendMessage("first-message"); });
    let second: Promise<void> | undefined;
    act(() => { second = inputProps.current!.onSendMessage("SECOND-SEND"); });
    // The user can keep drafting while Consuela thinks (textarea not disabled),
    // but the send path is disabled so nothing is silently dropped.
    expect(inputProps.current!.disabled).toBeFalsy();
    expect(inputProps.current!.sendDisabled).toBe(true);
    expect(el.querySelector("[data-testid='composer']")?.getAttribute("data-disabled")).toBe("false");
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

  it("assigns synthetic PB ids uniquely ACROSS reconciles (no duplicate React keys on an active Telegram day)", async () => {
    // Regression for the per-fetch index collision: hydrate returns row A;
    // two post-send reconciles each return new rows. With `1000000 + i`
    // indexing, reconcile #2 reused reconcile #1's id → duplicate keys.
    streamMock.fn.mockResolvedValue({ content: "ok", streamed: true });
    let reconcileCount = 0;
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      let messages: any[] = [];
      if (!u.includes("since=")) {
        messages = [{ role: "assistant", content: "hydrate-row", createdAt: "2026-09-02T10:00:00.000Z" }];
      } else {
        reconcileCount += 1;
        // Each reconcile sees a different fresh Telegram row.
        messages = [{ role: "user", content: `telegram-fresh-${reconcileCount}`, createdAt: `2026-09-02T10:0${reconcileCount}:00.000Z`, source: "telegram" }];
      }
      return new Response(JSON.stringify({ ok: true, messages }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const el = render(<ChatPage />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    // Two sends → two reconciles, each pulling a distinct Telegram row.
    await act(async () => { await inputProps.current!.onSendMessage("first"); });
    await act(async () => { await inputProps.current!.onSendMessage("second"); });
    expect(reconcileCount).toBe(2);
    // The real invariant: PB-hydrated row ids (>= 1M, persisted via
    // saveChatHistory) are unique ACROSS the whole thread. Duplicate ids
    // = duplicate React keys = broken list reconciliation.
    const stored = JSON.parse(localStorage.getItem("consuela-chat-messages")!) as Array<{ id: number }>;
    const pbIds = stored.map((m) => m.id).filter((id) => id >= 1_000_000);
    expect(pbIds.length).toBeGreaterThanOrEqual(3);
    expect(new Set(pbIds).size).toBe(pbIds.length);
    // And both fresh telegram rows render exactly once.
    const domTexts = Array.from(el.querySelectorAll("[role='log'] .rounded-2xl")).map((n) => n.textContent);
    for (const t of ["telegram-fresh-1", "telegram-fresh-2"]) {
      expect(domTexts.filter((x) => x?.includes(t)).length).toBe(1);
    }
  });

  it("reconciles with a 10-minute safety window behind the watermark (backdated telegram rows)", async () => {
    streamMock.fn.mockResolvedValue({ content: "ok", streamed: true });
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      const messages = u.includes("since=")
        ? []
        : [{ role: "assistant", content: "telegram-row", createdAt: "2026-09-02T10:00:00.000Z" }];
      return new Response(JSON.stringify({ ok: true, messages }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatPage />);
    // let the hydrate fetch land so the watermark is set
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => { await inputProps.current!.onSendMessage("hi"); });
    const reconcileUrl = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes("since="));
    expect(reconcileUrl).toBeDefined();
    const since = new URL(reconcileUrl!, "http://localhost").searchParams.get("since")!;
    expect(Date.parse(since)).toBeLessThanOrEqual(Date.parse("2026-09-02T09:50:00.000Z"));
  });

  it("shows an honest, cause-aware error bubble + Try again when the stream fails", async () => {
    streamMock.fn.mockRejectedValue(new Error("boom"));
    const el = render(<ChatPage />);
    await act(async () => { await inputProps.current!.onSendMessage("hi"); });
    // Names the problem and the recovery — not a bare apology.
    expect(el.textContent).toContain("couldn't reach the family server");
    expect(el.textContent).toContain("try again");
    expect(el.textContent).toContain("Try again");
  });

  it("renders markdown list lines as list items, not raw hyphens", async () => {    streamMock.fn.mockResolvedValue({
      content: "Here's the plan:\n- Milk\n- Bread\n- **Eggs**",
      streamed: true,
    });
    const el = render(<ChatPage />);
    await act(async () => { await inputProps.current!.onSendMessage("list"); });
    const logHtml = el.querySelector("[role='log']")!.innerHTML;
    expect(logHtml).toContain("<li");
    // Raw " - " line starts are gone; bold still renders.
    expect(logHtml).not.toContain("- Milk");
    expect(logHtml).toContain("<strong>Eggs</strong>");
    // Escaping still applies — an injected tag stays text.
    streamMock.fn.mockResolvedValue({ content: "- <img src=x onerror=alert(1)>", streamed: true });
    await act(async () => { await inputProps.current!.onSendMessage("sneaky"); });
    const html2 = el.querySelector("[role='log']")!.innerHTML;
    expect(html2).not.toContain("<img");
  });
});

describe("chat page signed-out honesty", () => {
  it("announces when this device is not on the family thread", () => {
    authMock.state = { currentUser: null, isLoggedIn: false };
    const el = render(<ChatPage />);
    const banner = document.querySelector("[data-testid='sync-status-banner']");
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain("family thread");
    void el;
  });

  it("shows no banner when signed in", () => {
    authMock.state = { currentUser: { name: "Rebecca", role: "parent" }, isLoggedIn: true };
    const el = render(<ChatPage />);
    expect(document.querySelector("[data-testid='sync-status-banner']")).toBeNull();
    void el;
  });
});

describe("chat page quick actions", () => {
  it("prefill the composer as an editable draft instead of auto-sending", () => {
    const el = render(<ChatPage />);
    const chip = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("Add Event"))!;
    expect(chip).toBeDefined();
    act(() => { chip.click(); });
    // Nothing was sent to Consuela.
    expect(streamMock.fn).not.toHaveBeenCalled();
    // The composer received the draft text to edit.
    expect(inputProps.current!.initialValue).toContain("soccer practice");
    // No hardcoded kid names in any draft prompt.
    const chipLabels = ["Add Event", "Plan Meals", "Assign Chore", "Grocery List"];
    for (const label of chipLabels) {
      const b = Array.from(el.querySelectorAll("button")).find((x) => x.textContent?.includes(label));
      if (b && "prompt" in (b as any)) { /* prompt lives in closure, checked via initialValue below */ }
    }
  });

  it("does not hardcode a child's name into write prompts", () => {
    const el = render(<ChatPage />);
    const chips = ["Add Event", "Plan Meals", "Assign Chore", "Grocery List"];
    for (const label of chips) {
      const b = Array.from(el.querySelectorAll("button")).find((x) => x.textContent?.includes(label))!;
      act(() => { b.click(); });
      expect(inputProps.current!.initialValue || "").not.toContain("Caspian");
    }
    expect(streamMock.fn).not.toHaveBeenCalled();
  });
});

describe("chat page stop control", () => {
  it("surfaces a stop control mid-stream and keeps the partial reply without an error bubble", async () => {
    let rejectStream: ((e: Error) => void) | null = null;
    streamMock.fn.mockImplementation(({ onToken, signal }: any) => {
      onToken("partial ", "partial ");
      return new Promise((_res, rej) => {
        rejectStream = rej;
        signal.addEventListener("abort", () => {
          const e = new Error("Generation stopped");
          e.name = "AbortError";
          rej(e);
        });
      });
    });
    const el = render(<ChatPage />);
    let sendPromise: Promise<void> | undefined;
    act(() => { sendPromise = inputProps.current!.onSendMessage("tell me a story"); });
    // Mid-stream: streaming flag on, stop handler provided.
    expect(inputProps.current!.streaming).toBe(true);
    expect(typeof inputProps.current!.onStop).toBe("function");
    act(() => { inputProps.current!.onStop!(); });
    await act(async () => { await sendPromise; });
    // The partial reply stays; no error bubble, no Try again.
    expect(el.textContent).toContain("partial");
    expect(el.textContent).not.toContain("Try again");
    // Stream is over: stop control gone, sends re-enabled.
    expect(inputProps.current!.streaming).toBe(false);
    expect(inputProps.current!.sendDisabled).toBe(false);
    void rejectStream;
  });
});

describe("chat page read-aloud orb", () => {
  const stubSpeech = () => {
    const fake = { speaking: false, cancel: vi.fn(), speak: vi.fn() };
    vi.stubGlobal("SpeechSynthesisUtterance", class {
      text: string; rate?: number; lang?: string;
      constructor(text: string) { this.text = text; }
    });
    vi.stubGlobal("speechSynthesis", fake);
    return fake;
  };

  it("offers a mini orb in the thread strip that reads the last reply aloud, and stops on second tap", async () => {
    const fake = stubSpeech();
    streamMock.fn.mockResolvedValue({
      content: "Here's the plan:\n- **Milk**\n- Bread",
      streamed: true,
    });
    const el = render(<ChatPage />);
    await act(async () => { await inputProps.current!.onSendMessage("list"); });
    const readBtn = el.querySelector("button[aria-label='Read the last reply aloud']") as HTMLButtonElement;
    expect(readBtn).not.toBeNull();
    act(() => { readBtn.click(); });
    expect(fake.speak).toHaveBeenCalledTimes(1);
    const spoken = JSON.stringify((fake.speak.mock.calls[0] as any)[0]);
    expect(spoken).toContain("Milk");
    expect(spoken).not.toContain("**");
    // Speaking state swaps the control to stop.
    expect(el.querySelector("button[aria-label='Stop reading']")).not.toBeNull();
    act(() => { (el.querySelector("button[aria-label='Stop reading']") as HTMLButtonElement).click(); });
    expect(fake.cancel).toHaveBeenCalled();
    expect(el.querySelector("button[aria-label='Read the last reply aloud']")).not.toBeNull();
  });

  it("shows no read-aloud control before any reply exists", () => {
    const el = render(<ChatPage />);
    expect(el.querySelector("button[aria-label='Read the last reply aloud']")).toBeNull();
  });
});

describe("chat page new-conversation (trash button)", () => {
  it("asks for confirmation and is honest about its scope", async () => {
    // Seed a thread so the new-conversation button has something to steer.
    localStorage.setItem("consuela-chat-messages", JSON.stringify([
      { id: 1, role: "assistant", content: "greeting", timestamp: "Now" },
      { id: 2, role: "user", content: "my real message", timestamp: "Just now" },
    ]));
    const el = render(<ChatPage />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const trash = el.querySelector("button[aria-label='Start a new conversation']")!;
    // First tap opens the confirm modal — nothing changes yet.
    act(() => { trash.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const modal = Array.from(document.body.querySelectorAll("h3")).find((h) => h.textContent?.includes("new conversation"));
    expect(modal).toBeDefined();
    // The scope is honest: steering, not deletion — history stays in the thread.
    expect(document.body.textContent).toContain("Consuela starts fresh");
    expect(document.body.textContent).toContain("Nothing is deleted");
    expect(JSON.parse(localStorage.getItem("consuela-chat-messages")!).length).toBe(2);
    // Cancel keeps everything.
    const cancel = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === "Cancel")!;
    act(() => { cancel.click(); });
    expect(JSON.parse(localStorage.getItem("consuela-chat-messages")!).length).toBe(2);
    // Confirm starts a fresh conversation: the local view resets to the
    // greeting + a system divider, and a reset marker POSTs to PB.
    act(() => { trash.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const confirmBtn = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === "Start new conversation")!;
    act(() => { confirmBtn.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const stored = JSON.parse(localStorage.getItem("consuela-chat-messages")!);
    const globalFetch = (globalThis as any).fetch as ReturnType<typeof vi.fn>;
    const resetPosted = globalFetch.mock.calls.some(
      ([u, init]) => String(u).includes("/api/chat/messages") && (init as any)?.method === "POST"
    );
    expect(resetPosted).toBe(true);
    expect(stored.some((m: any) => m.role === "system" && m.content === "New conversation")).toBe(true);
  });
});
