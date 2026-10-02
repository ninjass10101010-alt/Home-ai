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
  });

  it("states the tool state as real screen-reader text, not as an attribute AT may drop", () => {
    const el = render(
      <ToolActivityChips
        events={[
          { name: "get_weather", state: "running" },
          { name: "get_calendar_range", state: "error" },
        ]}
      />,
    );
    // The chip <span> carries no `role`, so it maps to implicit `generic` — and
    // ARIA 1.2 marks naming PROHIBITED there, which means an `aria-label` on it
    // is not something a browser/screen reader is obliged to announce at all.
    // The old check asserted the attribute was present in the DOM, which is a
    // statement about the markup and not about the experience. The state has to
    // exist as TEXT, because `state: "error"` also covers routine refusals
    // ("Already completed — waiting for parent approval") that must not read as
    // a crash.
    for (const state of ["running", "error"]) {
      const chip = el.querySelector(`[data-state="${state}"]`) as HTMLElement;
      expect(chip, `a ${state} chip rendered`).not.toBeNull();
      expect(chip.hasAttribute("role"), "no role, so naming stays prohibited").toBe(false);

      const spoken = chip.querySelector(".sr-only");
      expect(spoken, `${state} carries screen-reader text`).not.toBeNull();
      expect(spoken!.textContent).toContain(state);

      // …and the glyph must not be what carries it: strip every aria-hidden
      // node and the state word has to survive on its own.
      const withoutGlyph = chip.cloneNode(true) as HTMLElement;
      withoutGlyph.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
      expect(withoutGlyph.textContent, `${state} survives without its glyph`).toContain(state);
    }
  });

  it("keeps one DOM node per tool across a running→ok flip", () => {
    // A state transition is a FIELD change, not a new element. Keying the chip
    // on `state` made React unmount and remount the node on every running→ok
    // flip, which throws away any state or animation the chip ever grows.
    function Host({ state }: { state: "running" | "ok" }) {
      return <ToolActivityChips events={[{ name: "get_pantry", state }]} />;
    }
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    act(() => {
      root.render(<Host state="running" />);
    });
    const first = el.querySelector("[data-state]");
    expect(first, "the running chip rendered").not.toBeNull();

    act(() => {
      root.render(<Host state="ok" />);
    });
    const after = el.querySelector("[data-state]");
    // Identity, not equality: a remount would have handed back a NEW node.
    expect(after).toBe(first);
    expect(after!.getAttribute("data-state")).toBe("ok");
    act(() => {
      root.unmount();
    });
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
    const state: {
      opts: any;
      resolve: ((r: { content: string; streamed: boolean }) => void) | null;
      reject: ((e: unknown) => void) | null;
    } = { opts: null, resolve: null, reject: null };
    streamMock.fn.mockImplementation((o: any) => {
      state.opts = o;
      return new Promise((res, rej) => {
        state.resolve = res;
        state.reject = rej;
      });
    });
    return state;
  }

  it("shows the chips and an open transcript under the dots, then collapses on the answer and keeps both on the finished message", async () => {
    // The store hands the turn's activity to the finished bubble at finalize and
    // only clears the live copy afterwards, and its server reconcile sits
    // BETWEEN those two writes. Parking that read is what makes the handoff
    // observable instead of batched away — without it there is no render in
    // which both copies could coexist, and the guard would go untested.
    let park = false;
    let release: (() => void) | null = null;
    const threadBody = () =>
      new Response(JSON.stringify({ ok: true, messages: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    vi.stubGlobal("fetch", vi.fn(() => {
      if (!park) return Promise.resolve(threadBody());
      return new Promise<Response>((res) => { release = () => res(threadBody()); });
    }));

    const s = pendingStream();
    const el = render(<ChatPage />);
    let send: Promise<void> | undefined;
    act(() => {
      send = inputProps.current!.onSendMessage("what's for dinner?");
    });
    // The route's real frame order: an attempt frame precedes EVERY provider
    // call, so the round that reached for the pantry and the ANSWERING round each
    // announce one. A mock that never calls `onAttempt` asserts a frame order the
    // route cannot produce — which is how the chips "passed" here while being
    // unreachable in production.
    act(() => {
      s.opts.onAttempt({ round: 1, target: "t0" });
    });
    act(() => {
      s.opts.onToolEvent({ name: "get_pantry", state: "running" });
    });
    act(() => {
      s.opts.onToolEvent({ name: "get_pantry", state: "ok" });
    });
    // The answering round thinks for itself before it answers.
    act(() => {
      s.opts.onAttempt({ round: 2, target: "t0" });
    });
    act(() => {
      s.opts.onReasoning("The user wants dinner — check the pantry first.", "…");
    });

    // LIVE: one chip per tool call (running then ok — NOT two chips), and the
    // transcript open under the typing indicator.
    expect(el.querySelectorAll('[data-testid="tool-activity"] [data-state]')).toHaveLength(1);
    expect(el.querySelector('[data-state="ok"]')).not.toBeNull();
    expect(el.textContent).toContain("The user wants dinner — check the pantry first.");
    expect(el.textContent).toContain("Consuela is thinking…");

    // The answer's first token opens the bubble; the turn ends and the store
    // parks on its reconcile with the chips already handed to the message.
    act(() => {
      s.opts.onToken("We have chicken and rice.", "We have chicken and rice.");
    });
    park = true;
    s.resolve!({ content: "We have chicken and rice.", streamed: true });
    for (let i = 0; i < 20 && !release; i += 1) {
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
    expect(release, "the store parked on its reconcile read").not.toBeNull();
    // The live copy is gone AND the message owns the chips — never both at once.
    expect(el.textContent).toContain("We have chicken and rice.");
    expect(el.querySelectorAll('[data-testid="tool-activity"]')).toHaveLength(1);
    expect(el.querySelector('[data-state="ok"]')).not.toBeNull();

    park = false;
    release!();
    await act(async () => {
      await send;
    });

    // The transcript collapsed on the answer…
    expect(el.textContent).not.toContain("The user wants dinner — check the pantry first.");
    expect(thinkingButton(el).textContent).toContain("Show thinking");
    // …and the chips + transcript stayed on the finished message.
    expect(el.querySelectorAll('[data-testid="tool-activity"]')).toHaveLength(1);

    // Re-openable from the finished message.
    act(() => {
      thinkingButton(el).click();
    });
    expect(el.textContent).toContain("The user wants dinner — check the pantry first.");
    expect(el.textContent).toContain("We have chicken and rice.");
  });

  it("keeps the turn's chips on screen while the answer streams, not only until its first token", async () => {
    // `isTyping` drops on the answer's FIRST token, but the turn is still in
    // flight and the finished bubble does not own the activity yet — it only
    // takes it at finalize. Gating the live surfaces on `isTyping` therefore
    // left a whole long answer with no chips anywhere, which is the window the
    // reported "a tool error never comes back" symptom lives in.
    const s = pendingStream();
    const el = render(<ChatPage />);
    act(() => {
      void inputProps.current!.onSendMessage("what's in the pantry?");
    });
    act(() => {
      s.opts.onAttempt({ round: 1, target: "t0" });
    });
    act(() => {
      s.opts.onToolEvent({ name: "get_pantry", state: "error" });
    });
    act(() => {
      s.opts.onAttempt({ round: 2, target: "t0" });
    });
    act(() => {
      s.opts.onToken("I could not check the pantry.", "I could not check the pantry.");
    });

    expect(el.textContent).toContain("I could not check the pantry.");
    expect(
      el.querySelectorAll('[data-testid="tool-activity"] [data-state="error"]'),
      "the chips survive the answer's first token",
    ).toHaveLength(1);
    // The dots are the one thing that DOES drop on the first token. Scoped to
    // the bubbles: the signed-out banner is also a `role="status"` region.
    expect(el.querySelector('[role="status"] .chat-dot')).toBeNull();
  });

  it("shows the live chips and transcript on a SECOND turn while it gathers", async () => {
    // Turn 1's chip and transcript live on its finished bubble for the life of
    // the page — they are in-memory display state that only persistence strips
    // (stripVolatile), never a clear. So from turn 2 onward the newest settled
    // assistant row always "owns activity", and a gate that reads THAT row hides
    // the live chips and the 💭 for turn 2's whole tool-gathering phase — exactly
    // when a kid waiting on an answer needs to see what Consuela is doing.
    // Every other case here drives ONE turn, which is why this slipped through.
    const turn2: {
      opts: any;
      resolve: ((r: { content: string; streamed: boolean }) => void) | null;
    } = { opts: null, resolve: null };
    streamMock.fn
      .mockImplementationOnce(async ({ onAttempt, onToolEvent, onToken }: any) => {
        onAttempt({ round: 1, target: "t0" });
        onToolEvent({ name: "get_weather", state: "running" });
        onToolEvent({ name: "get_weather", state: "ok" });
        onAttempt({ round: 2, target: "t0" });
        onToken("Sunny and warm.", "Sunny and warm.");
        return { content: "Sunny and warm.", streamed: true };
      })
      .mockImplementation((o: any) => {
        turn2.opts = o;
        return new Promise((res) => {
          turn2.resolve = res;
        });
      });

    const el = render(<ChatPage />);
    await act(async () => {
      await inputProps.current!.onSendMessage("what's the weather?");
    });
    // Turn 1 settled, and its chip is on the finished message.
    expect(el.querySelectorAll('[data-testid="tool-activity"] [data-state]')).toHaveLength(1);
    expect(el.querySelector('[data-state="ok"]')).not.toBeNull();

    // Turn 2 opens and reaches for a tool before it says anything.
    let send2: Promise<void> | undefined;
    act(() => {
      send2 = inputProps.current!.onSendMessage("and tomorrow?");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    act(() => {
      turn2.opts.onAttempt({ round: 1, target: "t0" });
    });
    act(() => {
      turn2.opts.onReasoning("Turn two: check the calendar first.", "…");
    });
    act(() => {
      turn2.opts.onToolEvent({ name: "get_calendar_range", state: "running" });
    });

    // Turn 2's LIVE chip is on screen beside turn 1's settled one…
    expect(el.querySelectorAll('[data-testid="tool-activity"] [data-state]')).toHaveLength(2);
    expect(el.querySelector('[data-state="running"]'), "turn 2's live chip").not.toBeNull();
    // …and so is its live transcript, not only turn 1's finished one.
    expect(el.textContent).toContain("Turn two: check the calendar first.");

    // Turn 2's answer takes its chip over; turn 1's chip stays put.
    act(() => {
      turn2.opts.onAttempt({ round: 2, target: "t0" });
    });
    act(() => {
      turn2.opts.onToken("Rain on Saturday.", "Rain on Saturday.");
    });
    await act(async () => {
      turn2.resolve!({ content: "Rain on Saturday.", streamed: true });
      await send2;
    });
    expect(el.querySelectorAll('[data-testid="tool-activity"] [data-state]')).toHaveLength(2);
    expect(el.textContent).toContain("Sunny and warm.");
    expect(el.textContent).toContain("Rain on Saturday.");
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

  it("buckets the think for auto-pin — a 512-char growth re-pins, a sub-bucket delta does not", async () => {
    // The live think adds height without touching `messages`/`isTyping`, so the
    // scroll effect depends on `thinkGrowthBucket` — but a transcript-length dep
    // used whole would re-scroll on EVERY delta of a think that runs to
    // thousands of characters. The bucket has to be coarse enough to avoid that
    // and fine enough to keep the thread pinned as the transcript grows.
    const s = pendingStream();
    render(<ChatPage />);
    act(() => {
      void inputProps.current!.onSendMessage("hi");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Crossing a 512-char bucket → the thread follows the growth.
    const beforeGrowth = scrollCalls;
    act(() => {
      s.opts.onReasoning("x".repeat(600), "x");
    });
    expect(scrollCalls, "crossing the growth bucket re-pins").toBeGreaterThan(beforeGrowth);

    // Staying inside the bucket → no re-scroll, or a real think would fight the
    // reader hundreds of times per turn.
    const beforeDelta = scrollCalls;
    act(() => {
      s.opts.onReasoning("x".repeat(610), "x");
    });
    expect(scrollCalls, "a sub-512 delta does not re-pin").toBe(beforeDelta);
  });

  it("re-arms the live transcript on retry, not only on send", async () => {
    // Only `sendMessage` re-armed `liveThinkingOpen`, and "Try again" goes
    // onRetry → retryMessage → retry → send(), bypassing it entirely. So a
    // retry the reader kicked off after collapsing the live think rendered
    // already collapsed — the retry's reasoning was unreachable.
    const s = pendingStream();
    const el = render(<ChatPage />);
    let send: Promise<void> | undefined;
    act(() => {
      send = inputProps.current!.onSendMessage("what's for dinner?");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    act(() => {
      s.opts.onReasoning("thinking about the pantry", "…");
    });
    // The reader collapses the live think mid-think.
    expect(thinkingButton(el).getAttribute("aria-expanded")).toBe("true");
    act(() => {
      thinkingButton(el).click();
    });
    expect(thinkingButton(el).getAttribute("aria-expanded")).toBe("false");

    // The turn errors → an honest error bubble with "Try again".
    await act(async () => {
      s.reject!(new Error("boom"));
      await send;
    });
    const retryBtn = Array.from(el.querySelectorAll("button")).find((b) =>
      /Try again/i.test(b.textContent || ""),
    );
    expect(retryBtn, "the error bubble offers Try again").toBeDefined();

    // Re-arm the stream stub so the retry itself stays observable.
    const s2 = pendingStream();
    act(() => {
      retryBtn!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    act(() => {
      s2.opts.onReasoning("thinking about the pantry again", "…");
    });

    const live = el.querySelector('[data-testid="thinking-transcript"]');
    expect(live, "the retry's think is rendered").not.toBeNull();
    expect(live!.textContent).toContain("thinking about the pantry again");
    expect(thinkingButton(el).getAttribute("aria-expanded")).toBe("true");
  });
});
