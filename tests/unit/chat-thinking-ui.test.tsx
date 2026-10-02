// Task 10 — the live thinking transcript + per-tool activity chips.
//
// Two display-only surfaces on top of Task 8/9's wire + client state:
//   * `ThinkingDisclosure` — a 💭 transcript, OPEN while Consuela thinks and
//     collapsed the moment the answer starts, re-openable on the finished
//     message. The STORE owns the text; the page owns only the toggle.
//   * `ToolActivityChips` — one ⏳/✅/❌ chip per tool call.
//
// The page-level cases ride the same harness as chat-points-chip.test.tsx /
// chat-page-stream.test.tsx (createRoot + act, IS_REACT_ACT_ENVIRONMENT, a
// URL-routing fetch stub, an open-gated Modal mock). No testing-library.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act, useState } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const streamMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/chat-stream", () => ({ streamConsuelaChat: (opts: any) => streamMock.fn(opts) }));

const authMock = vi.hoisted(() => ({
  state: { currentUser: null as any, isLoggedIn: false },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authMock.state }));

const inputProps = vi.hoisted(() => ({
  current: null as null | { onSendMessage: (t: string) => Promise<void> },
}));
vi.mock("@/components/chat/UnifiedInput", () => ({
  UnifiedInput: (props: any) => {
    inputProps.current = props;
    return <textarea data-testid="composer" readOnly />;
  },
}));

// Render counter, not a DOM probe: jsdom reuses DOM nodes across renders, so
// "did this row reconcile?" cannot be read off the tree. Avatar is rendered
// only inside a user bubble, so its call count IS the row's render count.
const avatarMock = vi.hoisted(() => ({ renders: 0 }));
vi.mock("@/components/ui/Avatar", () => ({
  default: () => {
    avatarMock.renders += 1;
    return null;
  },
}));

vi.mock("@/components/ui/CapsuleNav", () => ({ default: () => null }));
vi.mock("@/components/ui/SigmaImage", () => ({ default: () => null }));
vi.mock("@/components/3d", () => ({ Icon3D: () => null }));
vi.mock("@/components/ui/Modal", () => ({
  default: ({ open, title, description, children, footer }: any) =>
    open ? (
      <div data-testid="modal-mock">
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
vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/db", () => ({ db: { selectMembers: () => [] } }));

import ChatPage from "@/app/chat/page";
import ThinkingDisclosure from "@/components/chat/ThinkingDisclosure";
import ToolActivityChips from "@/components/chat/ToolActivityChips";
import { __resetChatStoreForTests } from "@/lib/chat-store";

let activeRoot: ReturnType<typeof createRoot> | null = null;
function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => {
    activeRoot = createRoot(el);
    activeRoot.render(ui);
  });
  return el;
}

/** URL-routed so a chat-thread read never answers with a planner payload. */
function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = String(url).includes("/api/chat/messages")
        ? { ok: true, messages: [] }
        : { ok: true };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

let scrollCalls = 0;

function thinkingButton(el: HTMLElement): HTMLButtonElement {
  const btn = Array.from(el.querySelectorAll("button")).find((b) =>
    /thinking/i.test(b.textContent || ""),
  );
  expect(btn, "a thinking disclosure header").toBeDefined();
  return btn as HTMLButtonElement;
}

/** Every class attribute under a rendered subtree, one string per element. */
function classNames(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll("*")).map((n) => n.getAttribute("class") ?? "");
}

beforeEach(() => {
  __resetChatStoreForTests();
  inputProps.current = null;
  avatarMock.renders = 0;
  authMock.state = { currentUser: null, isLoggedIn: false };
  streamMock.fn.mockReset();
  localStorage.clear();
  scrollCalls = 0;
  Element.prototype.scrollIntoView = vi.fn(() => {
    scrollCalls += 1;
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })),
  );
  stubFetch();
});

afterEach(() => {
  act(() => {
    activeRoot?.unmount();
  });
  activeRoot = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("ThinkingDisclosure", () => {
  it("renders the live reasoning transcript while thinking", () => {
    const el = render(
      <ThinkingDisclosure text="The pantry has chicken — check the calendar." open onOpenChange={() => {}} />,
    );
    expect(el.querySelector('[data-testid="thinking-disclosure"]')).not.toBeNull();
    expect(el.textContent).toContain("💭");
    expect(el.textContent).toContain("The pantry has chicken — check the calendar.");
    const header = thinkingButton(el);
    expect(header.getAttribute("aria-expanded")).toBe("true");
  });

  it("collapses when the answer starts and can be re-opened", () => {
    function Host({ open }: { open: boolean }) {
      const [isOpen, setIsOpen] = useState(open);
      return <ThinkingDisclosure text="step one" open={isOpen} onOpenChange={setIsOpen} />;
    }

    // Open while thinking.
    const thinking = render(<Host open />);
    expect(thinking.textContent).toContain("step one");

    // The answer starts: the page hands `open={false}`, so it collapses.
    const answered = render(<Host open={false} />);
    const header = thinkingButton(answered);
    expect(answered.textContent).not.toContain("step one");
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(header.textContent).toContain("Show thinking");

    // …and it is re-openable afterwards.
    act(() => {
      header.click();
    });
    expect(answered.textContent).toContain("step one");
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(header.textContent).toContain("Hide thinking");
  });

  it("shows no transcript when there was no reasoning", () => {
    const el = render(<ThinkingDisclosure text="" open onOpenChange={() => {}} />);
    expect(el.querySelector('[data-testid="thinking-disclosure"]')).toBeNull();
  });

  it("keeps the type floor at 12px and the target at 44px", () => {
    const el = render(<ThinkingDisclosure text="reasoning…" open onOpenChange={() => {}} />);
    for (const cls of classNames(el)) {
      for (const m of cls.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
        expect(parseFloat(m[1]), `arbitrary type size ${m[0]}`).toBeGreaterThanOrEqual(12);
      }
      // Every text-bearing element rides the rem scale, never a px literal.
      expect(cls).not.toMatch(/text-\[(?:1[01]|[0-9])/);
    }
    expect(thinkingButton(el).className).toContain("hit-44");
  });

  it("caps a tall transcript in its own scroll box so it cannot push the answer away", () => {
    const el = render(
      <ThinkingDisclosure text={"a very long think\n".repeat(400)} open onOpenChange={() => {}} />,
    );
    const body = el.querySelector('[data-testid="thinking-transcript"]');
    expect(body).not.toBeNull();
    expect(body!.className).toMatch(/max-h-\[/);
    expect(body!.className).toContain("overflow-y-auto");
    expect(body!.className).toContain("whitespace-pre-wrap");
  });
});

describe("ToolActivityChips", () => {
  it("renders running, ok and error chips with distinct labels", () => {
    const el = render(
      <ToolActivityChips
        events={[
          { name: "get_weather", state: "running" },
          { name: "get_pantry", state: "ok" },
          { name: "get_calendar_range", state: "error" },
        ]}
      />,
    );
    expect(el.textContent).toContain("Weather");
    expect(el.textContent).toContain("Pantry");
    expect(el.textContent).toContain("Calendar range");
    expect(el.querySelector('[data-state="running"]')).not.toBeNull();
    expect(el.querySelector('[data-state="ok"]')).not.toBeNull();
    expect(el.querySelector('[data-state="error"]')).not.toBeNull();
    // The state is carried by the glyph AND by data-state, never by colour alone.
    const error = el.querySelector('[data-state="error"]') as HTMLElement;
    expect(error.textContent).toContain("❌");
    expect(error.getAttribute("aria-label")).toContain("Calendar range");
  });

  it("renders nothing at all when no tool ran", () => {
    const el = render(<ToolActivityChips events={[]} />);
    expect(el.querySelector('[data-testid="tool-activity"]')).toBeNull();
    expect(el.textContent).toBe("");
  });

  it("keeps the type floor at 12px", () => {
    const el = render(<ToolActivityChips events={[{ name: "get_weather", state: "ok" }]} />);
    // Guard so this cannot pass by rendering nothing at all.
    expect(el.querySelector('[data-testid="tool-activity"]')).not.toBeNull();
    for (const cls of classNames(el)) {
      for (const m of cls.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
        expect(parseFloat(m[1]), `arbitrary type size ${m[0]}`).toBeGreaterThanOrEqual(12);
      }
    }
  });
});

describe("chat page — thinking transcript + tool activity wiring", () => {
  /** A stream that stays open so the LIVE surfaces are observable. */
  function pendingStream() {
    const state: { opts: any; resolve: ((r: { content: string; streamed: boolean }) => void) | null } = {
      opts: null,
      resolve: null,
    };
    streamMock.fn.mockImplementation((o: any) => {
      state.opts = o;
      return new Promise((res) => {
        state.resolve = res;
      });
    });
    return state;
  }

  it("shows the chips and an open transcript under the dots, then collapses on the answer and keeps both on the finished message", async () => {
    const s = pendingStream();
    const el = render(<ChatPage />);
    let send: Promise<void> | undefined;
    act(() => {
      send = inputProps.current!.onSendMessage("what's for dinner?");
    });
    act(() => {
      s.opts.onReasoning("The user wants dinner — check the pantry first.", "…");
    });
    act(() => {
      s.opts.onToolEvent({ name: "get_pantry", state: "running" });
    });
    act(() => {
      s.opts.onToolEvent({ name: "get_pantry", state: "ok" });
    });

    // LIVE: one chip per tool call (running then ok — NOT two chips), and the
    // transcript open under the typing indicator.
    expect(el.querySelectorAll('[data-testid="tool-activity"] [data-state]')).toHaveLength(1);
    expect(el.querySelector('[data-state="ok"]')).not.toBeNull();
    expect(el.textContent).toContain("The user wants dinner — check the pantry first.");
    expect(el.textContent).toContain("Consuela is thinking…");

    await act(async () => {
      s.resolve!({ content: "We have chicken and rice.", streamed: true });
      await send;
    });

    // The answer started → the transcript collapsed…
    expect(el.textContent).not.toContain("The user wants dinner — check the pantry first.");
    expect(thinkingButton(el).textContent).toContain("Show thinking");
    // …and the chips + transcript stayed on the finished message.
    expect(el.querySelector('[data-testid="tool-activity"]')).not.toBeNull();
    expect(el.querySelector('[data-state="ok"]')).not.toBeNull();

    // Re-openable from the finished message.
    act(() => {
      thinkingButton(el).click();
    });
    expect(el.textContent).toContain("The user wants dinner — check the pantry first.");
    expect(el.textContent).toContain("We have chicken and rice.");
  });

  it("a transcript-less turn leaves no disclosure header behind", async () => {
    streamMock.fn.mockResolvedValue({ content: "Straight answer.", streamed: true });
    const el = render(<ChatPage />);
    await act(async () => {
      await inputProps.current!.onSendMessage("hi");
    });
    expect(el.querySelector('[data-testid="thinking-disclosure"]')).toBeNull();
    expect(el.querySelector('[data-testid="tool-activity"]')).toBeNull();
  });

  it("a reasoning-only update does not reconcile the settled rows", async () => {
    // A2: `onReasoning` writes the whole store on every delta and the page
    // subscribes to all of it, so without a memo seam on the row a GLM-class
    // think re-renders the entire thread hundreds of times.
    const s = pendingStream();
    render(<ChatPage />);
    act(() => {
      void inputProps.current!.onSendMessage("hi");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const settled = avatarMock.renders;
    expect(settled, "the user row rendered at least once").toBeGreaterThan(0);

    for (let i = 0; i < 6; i += 1) {
      act(() => {
        s.opts.onReasoning(`${"thinking ".repeat(40)}${i}`, "x");
      });
    }
    expect(avatarMock.renders).toBe(settled);
  });

  it("a new tool chip re-pins the thread to the bottom", async () => {
    const s = pendingStream();
    render(<ChatPage />);
    act(() => {
      void inputProps.current!.onSendMessage("hi");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const before = scrollCalls;
    act(() => {
      s.opts.onToolEvent({ name: "get_weather", state: "running" });
    });
    expect(scrollCalls).toBeGreaterThan(before);
  });
});
