// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { UnifiedInput } from "@/components/chat/UnifiedInput";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/voice-input/VoiceInputButton", () => ({ VoiceInputButton: () => null }));
vi.mock("@/components/photo-input/PhotoInputButton", () => ({ PhotoInputButton: () => null }));

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

function typeInto(el: HTMLElement, text: string) {
  const textarea = el.querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clickSend(el: HTMLElement) {
  const btn = Array.from(el.querySelectorAll("button")).find((b) => b.title === "Send message")!;
  act(() => { btn.click(); });
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("UnifiedInput — direct send", () => {
  it("calls onSendMessage with no pre-flight network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onSend = vi.fn();
    const el = render(<UnifiedInput onSendMessage={onSend} />);
    typeInto(el, "what is for dinner?");
    clickSend(el);
    expect(onSend).toHaveBeenCalledWith("what is for dinner?");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears the textarea after sending", () => {
    vi.stubGlobal("fetch", vi.fn());
    const el = render(<UnifiedInput onSendMessage={vi.fn()} />);
    typeInto(el, "milk");
    clickSend(el);
    expect((el.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
  });

  it("does not send empty or whitespace input", () => {
    vi.stubGlobal("fetch", vi.fn());
    const onSend = vi.fn();
    const el = render(<UnifiedInput onSendMessage={onSend} />);
    typeInto(el, "   ");
    clickSend(el);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("is disabled while the assistant is typing", () => {
    vi.stubGlobal("fetch", vi.fn());
    const el = render(<UnifiedInput onSendMessage={vi.fn()} disabled />);
    expect((el.querySelector("textarea") as HTMLTextAreaElement).disabled).toBe(true);
  });
});

describe("UnifiedInput — drafting during generation", () => {
  it("sendDisabled blocks sending but keeps the textarea editable", () => {
    vi.stubGlobal("fetch", vi.fn());
    const onSend = vi.fn();
    const el = render(<UnifiedInput onSendMessage={onSend} sendDisabled />);
    const textarea = el.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
    typeInto(el, "next question");
    clickSend(el);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows a stop control while streaming and calls it instead of sending", () => {
    vi.stubGlobal("fetch", vi.fn());
    const onSend = vi.fn();
    const onStop = vi.fn();
    const el = render(<UnifiedInput onSendMessage={onSend} streaming onStop={onStop} />);
    const stop = el.querySelector("button[aria-label='Stop generating']") as HTMLButtonElement;
    expect(stop).toBeDefined();
    act(() => { stop.click(); });
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
    // Drafting stays possible while the reply streams.
    expect((el.querySelector("textarea") as HTMLTextAreaElement).disabled).toBe(false);
  });

  it("prefills the composer with initialValue (quick-action draft)", () => {
    vi.stubGlobal("fetch", vi.fn());
    const el = render(<UnifiedInput onSendMessage={vi.fn()} initialValue="Add soccer practice tomorrow at 4pm" />);
    expect((el.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Add soccer practice tomorrow at 4pm");
  });

  it("labels the message field for screen readers", () => {
    vi.stubGlobal("fetch", vi.fn());
    const el = render(<UnifiedInput onSendMessage={vi.fn()} />);
    expect(el.querySelector("textarea")!.getAttribute("aria-label")).toBe("Message Consuela");
  });

  it("hides the tip line when showTip is false (thread underway)", () => {
    vi.stubGlobal("fetch", vi.fn());
    const el = render(<UnifiedInput onSendMessage={vi.fn()} showTip={false} />);
    expect(el.textContent).not.toContain("💡 Tip:");
  });
});
