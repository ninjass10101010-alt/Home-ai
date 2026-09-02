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
