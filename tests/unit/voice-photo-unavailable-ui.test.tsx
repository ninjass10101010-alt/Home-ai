// @vitest-environment jsdom
//
// Bug 3 (P1) — the UI half.
//
// "Shipping a control that throws is not acceptable in either direction." With
// no transcription and no OCR provider in the app (see
// `voice-photo-input-honesty.test.ts`), the honest state is UNAVAILABLE: a
// disabled control plus a real explanation the parent can read. The composer
// must therefore stop promising a mic and a camera it cannot deliver.
//
// A disabled control is dropped from the tab order, so the explanation is
// rendered as visible text (and announced once through the live region) — a
// `title` nobody can reach is not an explanation.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { VoiceInputButton } from "@/components/voice-input/VoiceInputButton";
import { PhotoInputButton } from "@/components/photo-input/PhotoInputButton";
import { UnifiedInput } from "@/components/chat/UnifiedInput";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let activeRoot: Root | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => {
    activeRoot = createRoot(el);
    activeRoot.render(ui);
  });
  return el;
}

function text(el: HTMLElement): string {
  return (el.textContent || "").replace(/\s+/g, " ");
}

beforeEach(() => {
  document.body.innerHTML = "";
  (globalThis as any).navigator.mediaDevices = undefined;
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, transcript: "should never be called" }),
  })) as any;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  if (activeRoot) act(() => activeRoot!.unmount());
  activeRoot = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Bug 3 UI — the mic is honestly unavailable", () => {
  it("is disabled, not a control that throws", () => {
    const el = render(<VoiceInputButton onTranscript={vi.fn()} />);
    const btn = el.querySelector("button")!;
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  it("says WHY, in text a parent can read", () => {
    const el = render(<VoiceInputButton onTranscript={vi.fn()} />);
    const body = text(el);
    expect(body).toMatch(/voice/i);
    expect(body).toMatch(/type|message/i);
  });

  it("never asks for the microphone and never calls the route", async () => {
    const el = render(<VoiceInputButton onTranscript={vi.fn()} />);
    const btn = el.querySelector("button")!;
    await act(async () => {
      btn.click();
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((navigator as any).mediaDevices).toBeUndefined();
  });

  it("keeps a live region so the state is announced once", () => {
    const el = render(<VoiceInputButton onTranscript={vi.fn()} />);
    expect(el.querySelector("[role='status']")).not.toBeNull();
  });
});

describe("Bug 3 UI — the camera is honestly unavailable", () => {
  it("is disabled, not a control that throws", () => {
    const el = render(<PhotoInputButton onExtracted={vi.fn()} />);
    const btn = el.querySelector("button[aria-label='Take photo or upload image']")!;
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  it("says WHY, in text a parent can read", () => {
    const el = render(<PhotoInputButton onExtracted={vi.fn()} />);
    expect(text(el)).toMatch(/photo|image/i);
    expect(text(el)).toMatch(/type|paste|message/i);
  });

  it("never calls the route even if the file input is driven directly", async () => {
    const el = render(<PhotoInputButton onExtracted={vi.fn()} />);
    const input = el.querySelector("input[type='file']") as HTMLInputElement;
    expect(input.disabled || input.hasAttribute("disabled")).toBe(true);
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Bug 3 UI — the composer stops promising a mic and a camera", () => {
  it("no longer advertises saying a request or snapping a flyer", () => {
    const el = render(<UnifiedInput onSendMessage={vi.fn()} />);
    const body = text(el);
    expect(body).not.toMatch(/voice\/photo/i);
    expect(body).not.toMatch(/snap a photo/i);
    expect(body).not.toMatch(/dentist appointment/i);
  });

  it("keeps the honest controls and the real capabilities", () => {
    const el = render(<UnifiedInput onSendMessage={vi.fn()} />);
    const body = text(el);
    expect(el.querySelector("button[aria-label='Take photo or upload image']")).not.toBeNull();
    // The composer's own affordance must now describe what actually works.
    const ta = el.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta.getAttribute("placeholder")).toMatch(/type a message/i);
    expect(ta.getAttribute("placeholder")).not.toMatch(/voice|photo/i);
    // The `/new` tip is the one that still works — keep it.
    expect(body).toMatch(/\/new/);
  });

  it("still sends a typed message (the only working input path)", async () => {
    const onSend = vi.fn();
    const el = render(<UnifiedInput onSendMessage={onSend} />);
    const ta = el.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(ta, "swim practice at 4");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = el.querySelector("button[aria-label='Send message']") as HTMLButtonElement;
    expect(send.hasAttribute("disabled")).toBe(false);
    await act(async () => {
      send.click();
    });
    expect(onSend).toHaveBeenCalledWith("swim practice at 4");
  });
});