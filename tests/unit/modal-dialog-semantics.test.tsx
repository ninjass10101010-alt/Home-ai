// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import Modal from "@/components/ui/Modal";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Reduced-motion path: the exit phase unmounts instantly (no EXIT_MS timer),
// which keeps the close/focus-return assertions deterministic.
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

let root: Root | null = null;
let container: HTMLElement;

function mount(ui: React.ReactElement) {
  if (!root) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  return act(async () => { root!.render(ui); });
}

function panel(): HTMLElement | null {
  return document.querySelector('[role="dialog"]');
}

function pressKey(key: string, shiftKey = false) {
  return act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true }));
  });
}

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  document.body.innerHTML = "";
  container = undefined as unknown as HTMLElement;
});

describe("Modal dialog semantics", () => {
  it("panel is a labelled modal dialog wired to its title", async () => {
    await mount(
      <Modal open onClose={() => {}} title="Add Task">
        <p>form</p>
      </Modal>
    );
    const dialog = panel();
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute("aria-modal")).toBe("true");
    const labelId = dialog!.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    const heading = document.querySelector("h3");
    expect(heading?.id).toBe(labelId);
    expect(heading?.textContent).toBe("Add Task");
  });

  it("Escape closes the dialog", async () => {
    const onClose = vi.fn();
    await mount(
      <Modal open onClose={onClose} title="Add Task">
        <p>form</p>
      </Modal>
    );
    await pressKey("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("focus moves into the panel on open and Tab/Shift+Tab cycle inside it", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    await mount(
      <Modal open onClose={() => {}} title="Pin" footer={<button id="c">Save</button>}>
        <button id="a">A</button>
        <button id="b">B</button>
      </Modal>
    );
    const dialog = panel()!;
    // Focus lands on the first focusable inside the dialog, not the trigger.
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement!.id).toBe("a");

    // Tab from the last focusable wraps to the first.
    (document.getElementById("c") as HTMLElement).focus();
    await pressKey("Tab");
    expect(document.activeElement!.id).toBe("a");

    // Shift+Tab from the first focusable wraps to the last.
    await pressKey("Tab", true);
    expect(document.activeElement!.id).toBe("c");
  });

  it("autoFocus inside the panel wins over the first focusable", async () => {
    // Regression: the Tasks claim/redeem modal renders a "Claim for" <select>
    // before the autoFocus PIN input — the initial focus move must not
    // override React's autoFocus commit.
    await mount(
      <Modal open onClose={() => {}} title="Claim a task">
        <select id="who"><option>Rebecca</option></select>
        <input id="pin" type="password" autoFocus />
      </Modal>
    );
    expect(panel()!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement!.id).toBe("pin");
  });

  it("focus still enters the dialog when nothing has autoFocus", async () => {
    await mount(
      <Modal open onClose={() => {}} title="Claim a task">
        <select id="who"><option>Rebecca</option></select>
        <input id="pin" type="password" />
      </Modal>
    );
    expect(panel()!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement!.id).toBe("who");
  });

  it("focus returns to the previously focused element on close", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();

    const ui = (open: boolean) => (
      <Modal open={open} onClose={() => {}} title="Pin">
        <button id="a">A</button>
      </Modal>
    );
    await mount(ui(true));
    expect(panel()!.contains(document.activeElement)).toBe(true);

    await mount(ui(false));
    expect(document.activeElement).toBe(trigger);
    expect(panel()).toBeNull();
  });

  it("with an autoFocus input the close still returns focus to the TRIGGER, not the unmounted panel", async () => {
    // Regression: lastFocusedRef used to be captured in the focus effect,
    // which runs AFTER React's autoFocus commit — so it recorded the panel's
    // input (gone on close) and focus vanished to <body> instead of the
    // trigger. The capture must happen when `open` flips, before the panel
    // exists.
    const trigger = document.createElement("button");
    trigger.textContent = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();

    const ui = (open: boolean) => (
      <Modal open={open} onClose={() => {}} title="PIN">
        <input id="pin" type="password" autoFocus />
      </Modal>
    );
    await mount(ui(true));
    // autoFocus wins for the focus-MOVE decision…
    expect(document.activeElement!.id).toBe("pin");

    await mount(ui(false));
    // …but the return target is the trigger.
    expect(document.activeElement).toBe(trigger);
    expect(panel()).toBeNull();
  });
});
