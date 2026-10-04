// @vitest-environment jsdom
// P1: the PIN dialogs were `aria-modal` in name only — no focus trap, no
// Escape, no focus return. jsdom gives real focus behaviour, so every claim
// below is asserted on `document.activeElement`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, type ReactNode } from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.stubGlobal("matchMedia", (query: string) => ({
  matches: true,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

const loginMock = vi.fn();
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ login: loginMock }) }));

import PinModal from "@/components/auth/PinModal";
import WallPinPad from "@/components/wall/WallPinPad";
import AlarmPinModal from "@/components/ha/AlarmPinModal";

let root: Root | null = null;
let show: (open: boolean) => void = () => {};

/** A page with a real trigger; the dialog mounts beside it (a sibling, so the
 *  page really is "behind" the dialog for the inert/aria-hidden contract). */
function Page({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <>
      <main>
        <button id="trigger">open the PIN pad</button>
        <p id="page-copy">content behind the dialog</p>
      </main>
      {open ? children : null}
    </>
  );
}

function renderPage(children: ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  show = (open) => { act(() => { root!.render(<Page open={open}>{children}</Page>); }); };
  show(false);
  return document.getElementById("trigger") as HTMLButtonElement;
}

/** Focus the trigger, then open the dialog — the real user sequence. */
async function openVia(trigger: HTMLElement) {
  trigger.focus();
  expect(document.activeElement).toBe(trigger);
  await act(async () => { show(true); });
}

async function close() {
  await act(async () => { show(false); });
}

async function pressKey(key: string, shiftKey = false) {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true }));
  });
}

function dialog(): HTMLElement | null {
  return document.querySelector('[role="dialog"]');
}

function focusables(): HTMLElement[] {
  const panel = dialog()!;
  return Array.from(
    panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
  ).filter((el) => !el.matches(":disabled"));
}

beforeEach(() => {
  loginMock.mockReset();
  show = () => {};
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  document.body.innerHTML = "";
});

describe("PinModal — shared dialog a11y", () => {
  const pinUi = (onClose: () => void) => (
    <PinModal memberName="Aurora" memberEmoji="🌈" memberColor="green" onClose={onClose} />
  );

  it("moves focus into the PIN input on open", async () => {
    const trigger = renderPage(pinUi(vi.fn()));
    await openVia(trigger);
    expect(document.activeElement).toBe(dialog()!.querySelector("input"));
  });

  it("cycles Tab / Shift+Tab inside the pad and never reaches the page behind", async () => {
    const onClose = vi.fn();
    const trigger = renderPage(pinUi(onClose));
    await openVia(trigger);
    const items = focusables();
    const first = items[0];
    const last = items[items.length - 1];

    last.focus();
    await pressKey("Tab");
    expect(document.activeElement).toBe(first);

    first.focus();
    await pressKey("Tab", true);
    expect(document.activeElement).toBe(last);
    expect(dialog()!.contains(document.activeElement)).toBe(true);
  });

  it("makes the page behind inert to focus and to assistive tech while open", async () => {
    const onClose = vi.fn();
    const trigger = renderPage(pinUi(onClose));
    await openVia(trigger);
    // `closest` rather than `hasAttribute`: the pad is portaled to <body>, so
    // the hook marks the page's mount subtree inert and <main> is *inside* it.
    // What matters is that nothing behind the pad is reachable or announced.
    expect(document.querySelector("main")!.closest("[inert]")).not.toBeNull();
    expect(document.querySelector("main")!.closest("[aria-hidden='true']")).not.toBeNull();
    expect(trigger.closest("[inert]")).not.toBeNull();
    expect(dialog()!.closest("[inert]")).toBeNull();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    const trigger = renderPage(pinUi(onClose));
    await openVia(trigger);
    await pressKey("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the trigger on close", async () => {
    const onClose = vi.fn();
    const trigger = renderPage(pinUi(onClose));
    await openVia(trigger);
    expect(document.activeElement).not.toBe(trigger);
    await close();
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelector("main")!.hasAttribute("inert")).toBe(false);
  });
});

describe("WallPinPad — shared dialog a11y", () => {
  const padUi = (onClose: () => void, onVerify?: (pin: string) => Promise<{ ok: boolean; error?: string }>) => (
    <WallPinPad member={{ name: "Aurora", emoji: "🌈" }} onClose={onClose} onSuccess={vi.fn()} onVerify={onVerify} />
  );

  it("moves focus to the first keypad key and keeps Tab inside the grid", async () => {
    const onClose = vi.fn();
    const trigger = renderPage(padUi(onClose));
    await openVia(trigger);
    const items = focusables();
    expect(document.activeElement).toBe(items[0]);
    expect(items[0].getAttribute("aria-label")).toBe("1");

    const last = items[items.length - 1];
    last.focus();
    await pressKey("Tab");
    expect(document.activeElement).toBe(items[0]);
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    const trigger = renderPage(padUi(onClose));
    await openVia(trigger);
    await pressKey("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the wall-scale 72px keypad keys (64px control floor untouched)", async () => {
    const onClose = vi.fn();
    const trigger = renderPage(padUi(onClose));
    await openVia(trigger);
    for (const label of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "Clear", "0", "Backspace"]) {
      const key = dialog()!.querySelector(`button[aria-label="${label}"]`) as HTMLElement;
      expect(key.className, label).toContain("h-[72px]");
    }
  });

  it("returns focus to the trigger on close", async () => {
    const onClose = vi.fn();
    const trigger = renderPage(padUi(onClose));
    await openVia(trigger);
    expect(document.activeElement).not.toBe(trigger);
    await close();
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape does not close while a verification is in flight", async () => {
    const onClose = vi.fn();
    let release!: (value: { ok: boolean }) => void;
    const onVerify = vi.fn(() => new Promise<{ ok: boolean }>((r) => { release = r; }));
    const ui = padUi(onClose, onVerify as never);
    const trigger = renderPage(ui);
    await openVia(trigger);
    for (const d of ["1", "2", "3", "4"]) {
      await act(async () => { (dialog()!.querySelector(`button[aria-label="${d}"]`) as HTMLButtonElement).click(); });
    }
    expect(onVerify).toHaveBeenCalled();

    await pressKey("Escape");
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { release({ ok: false }); });
    await pressKey("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("AlarmPinModal — shared dialog a11y", () => {
  const alarmUi = (onClose: () => void, onSubmit: (pin: string) => Promise<boolean> = vi.fn()) => (
    <AlarmPinModal action="disarm" onSubmit={onSubmit} onClose={onClose} />
  );

  it("moves focus to the PIN input on open", async () => {
    const onClose = vi.fn();
    const ui = alarmUi(onClose);
    const trigger = renderPage(ui);
    await openVia(trigger);
    expect(document.activeElement).toBe(dialog()!.querySelector("input"));
  });

  it("cycles Tab / Shift+Tab inside the confirmation", async () => {
    const onClose = vi.fn();
    const ui = alarmUi(onClose);
    const trigger = renderPage(ui);
    await openVia(trigger);
    const items = focusables();
    items[items.length - 1].focus();
    await pressKey("Tab");
    expect(document.activeElement).toBe(items[0]);
    await pressKey("Tab", true);
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    const ui = alarmUi(onClose);
    const trigger = renderPage(ui);
    await openVia(trigger);
    await pressKey("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on Escape while the arm/disarm confirmation is in flight", async () => {
    const onClose = vi.fn();
    let release!: (value: boolean) => void;
    const onSubmit = vi.fn(() => new Promise<boolean>((r) => { release = r; }));
    const ui = alarmUi(onClose, onSubmit);
    const trigger = renderPage(ui);
    await openVia(trigger);

    const input = dialog()!.querySelector("input") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "1234");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onSubmit).toHaveBeenCalledWith("1234");

    await pressKey("Escape");
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { release(true); });
    expect(onClose).toHaveBeenCalled();
  });

  it("returns focus to the trigger on close", async () => {
    const onClose = vi.fn();
    const ui = alarmUi(onClose);
    const trigger = renderPage(ui);
    await openVia(trigger);
    expect(document.activeElement).not.toBe(trigger);
    await close();
    expect(document.activeElement).toBe(trigger);
  });
});