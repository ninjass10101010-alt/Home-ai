// @vitest-environment jsdom
// Shared dialog accessibility contract (P1: 17 of 18 `aria-modal` dialogs had
// no focus trap / no Escape / no focus restore). `useDialogA11y` is the single
// implementation every dialog inherits — this suite pins its behaviour.
import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, type ReactNode } from "react";
import useDialogA11y from "@/components/ui/useDialogA11y";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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

function mount(ui: ReactNode) {
  if (!root) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  return act(async () => { root!.render(ui); });
}

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  document.body.innerHTML = "";
});

function pressKey(key: string, shiftKey = false) {
  return act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true }));
  });
}

function panel(): HTMLElement | null {
  return document.querySelector('[role="dialog"]');
}

function makeTrigger(text = "trigger"): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = text;
  document.body.appendChild(b);
  return b;
}

/** Minimal dialog wired through the shared hook — mirrors every call site. */
function Dialog({
  active = true,
  onClose,
  escapeDisabled,
  label = "Test dialog",
  children,
}: {
  active?: boolean;
  onClose?: () => void;
  escapeDisabled?: boolean;
  label?: string;
  children?: ReactNode;
}) {
  const panelRef = useDialogA11y<HTMLDivElement>({ active, onClose, escapeDisabled });
  if (!active) return null;
  return (
    <div className="overlay">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}

describe("useDialogA11y — focus trap, Escape and focus return", () => {
  it("moves focus into the panel on open, onto the first focusable", async () => {
    const trigger = makeTrigger();
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    await mount(
      <Dialog>
        <button id="a">A</button>
        <button id="b">B</button>
      </Dialog>
    );
    expect(panel()!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement!.id).toBe("a");
  });

  it("honors an autoFocus inside the panel instead of the first focusable", async () => {
    await mount(
      <Dialog>
        <select id="who"><option>Rebecca</option></select>
        <input id="pin" autoFocus />
      </Dialog>
    );
    expect(panel()!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement!.id).toBe("pin");
  });

  it("focuses the panel itself when it has no focusable children", async () => {
    await mount(<Dialog><p>read-only confirmation</p></Dialog>);
    expect(document.activeElement).toBe(panel());
  });

  it("wraps Tab from the last focusable back to the first", async () => {
    await mount(
      <Dialog>
        <button id="a">A</button>
        <button id="b">B</button>
        <button id="c">C</button>
      </Dialog>
    );
    (document.getElementById("c") as HTMLElement).focus();
    await pressKey("Tab");
    expect(document.activeElement!.id).toBe("a");
  });

  it("wraps Shift+Tab from the first focusable to the last", async () => {
    await mount(
      <Dialog>
        <button id="a">A</button>
        <button id="b">B</button>
        <button id="c">C</button>
      </Dialog>
    );
    (document.getElementById("a") as HTMLElement).focus();
    await pressKey("Tab", true);
    expect(document.activeElement!.id).toBe("c");
  });

  it("pulls focus back in when focus has escaped the panel entirely", async () => {
    const outside = makeTrigger("outside");
    await mount(
      <Dialog>
        <button id="a">A</button>
        <button id="b">B</button>
      </Dialog>
    );
    outside.focus();
    await pressKey("Tab");
    expect(panel()!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement!.id).toBe("a");
  });

  it("excludes effectively disabled controls (ancestor fieldset) from the cycle", async () => {
    await mount(
      <Dialog>
        <fieldset disabled>
          <button id="fieldset-disabled">Unavailable</button>
        </fieldset>
        <button id="enabled">Continue</button>
      </Dialog>
    );
    expect(document.activeElement!.id).toBe("enabled");
    await pressKey("Tab");
    expect(document.activeElement!.id).toBe("enabled");
  });

  it("Escape closes the dialog", async () => {
    const onClose = vi.fn();
    await mount(<Dialog onClose={onClose}><button>A</button></Dialog>);
    await pressKey("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("escapeDisabled keeps a destructive confirmation in flight", async () => {
    const onClose = vi.fn();
    await mount(<Dialog onClose={onClose} escapeDisabled><button>A</button></Dialog>);
    await pressKey("Escape");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("marks the background inert + aria-hidden while open and restores it on close", async () => {
    const trigger = makeTrigger();
    trigger.focus();
    const ui = (active: boolean) => <Dialog active={active}><button id="a">A</button></Dialog>;

    await mount(ui(true));
    expect(trigger.hasAttribute("inert")).toBe(true);
    expect(trigger.getAttribute("aria-hidden")).toBe("true");
    // The panel's own subtree must stay reachable.
    expect(container.hasAttribute("inert")).toBe(false);
    expect(panel()!.closest("[inert]")).toBeNull();

    await mount(ui(false));
    expect(trigger.hasAttribute("inert")).toBe(false);
    expect(trigger.getAttribute("aria-hidden")).toBeNull();
  });

  it("returns focus to the trigger on close", async () => {
    const trigger = makeTrigger();
    trigger.focus();
    const ui = (active: boolean) => <Dialog active={active}><button id="a">A</button></Dialog>;

    await mount(ui(true));
    expect(panel()!.contains(document.activeElement)).toBe(true);

    await mount(ui(false));
    expect(document.activeElement).toBe(trigger);
    expect(panel()).toBeNull();
  });

  it("returns focus to the trigger, not the autoFocus input that unmounts on close", async () => {
    const trigger = makeTrigger();
    trigger.focus();
    const ui = (active: boolean) => (
      <Dialog active={active}><input id="pin" autoFocus /></Dialog>
    );

    await mount(ui(true));
    expect(document.activeElement!.id).toBe("pin");
    await mount(ui(false));
    expect(document.activeElement).toBe(trigger);
  });

  it("falls back to a still-present ancestor when the trigger is gone", async () => {
    const wrapper = document.createElement("div");
    wrapper.tabIndex = -1;
    document.body.appendChild(wrapper);
    const trigger = document.createElement("button");
    wrapper.appendChild(trigger);
    trigger.focus();

    const ui = (active: boolean) => <Dialog active={active}><button id="a">A</button></Dialog>;
    await mount(ui(true));
    // The trigger vanishes mid-dialog (row deleted, route swapped).
    trigger.remove();
    await mount(ui(false));

    expect(document.activeElement).toBe(wrapper);
  });

  it("falls back to <body> when neither the trigger nor any ancestor survives", async () => {
    const trigger = makeTrigger();
    trigger.focus();
    const ui = (active: boolean) => <Dialog active={active}><button id="a">A</button></Dialog>;
    await mount(ui(true));
    trigger.remove();
    await mount(ui(false));

    expect(document.activeElement).toBe(document.body);
  });

  it("nested dialogs: Escape closes only the top-most one", async () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    await mount(
      <>
        <Dialog label="outer" onClose={outerClose}><button id="o">O</button></Dialog>
        <Dialog label="inner" onClose={innerClose}><button id="i">I</button></Dialog>
      </>
    );
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);

    await pressKey("Escape");
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });

  it("nested dialogs restore focus to the inner trigger, then to the outer one", async () => {
    const trigger = makeTrigger();
    trigger.focus();

    function Nested({ outer, inner }: { outer: boolean; inner: boolean }) {
      return (
        <Dialog active={outer}>
          <button id="open-inner">open inner</button>
          <Dialog active={inner} label="inner"><button id="inner-a">I</button></Dialog>
        </Dialog>
      );
    }

    await mount(<Nested outer inner={false} />);
    (document.getElementById("open-inner") as HTMLElement).focus();
    await mount(<Nested outer inner />);
    expect(document.activeElement!.id).toBe("inner-a");

    await mount(<Nested outer inner={false} />);
    expect(document.activeElement!.id).toBe("open-inner");

    await mount(<Nested outer={false} inner={false} />);
    expect(document.activeElement).toBe(trigger);
  });

  it("a second open of the same dialog re-captures the current trigger", async () => {
    const first = makeTrigger("first");
    const second = makeTrigger("second");
    const ui = (active: boolean) => <Dialog active={active}><button id="a">A</button></Dialog>;

    first.focus();
    await mount(ui(true));
    await mount(ui(false));
    expect(document.activeElement).toBe(first);

    second.focus();
    await mount(ui(true));
    await mount(ui(false));
    expect(document.activeElement).toBe(second);
  });

  it("keeps the wall-mode 64px control floor on its keys (no layout change)", async () => {
    await mount(
      <Dialog>
        <button id="key" className="tap h-[72px]">1</button>
      </Dialog>
    );
    expect(document.getElementById("key")!.className).toContain("h-[72px]");
  });
});

/** The hook must not depend on motion preference to move focus. */
describe("useDialogA11y — reduced motion", () => {
  it("still traps and returns focus when prefers-reduced-motion is set", async () => {
    const trigger = makeTrigger();
    trigger.focus();
    const ui = (active: boolean) => (
      <Dialog active={active} onClose={() => {}}><button id="a">A</button></Dialog>
    );
    await mount(ui(true));
    expect(document.activeElement!.id).toBe("a");
    await mount(ui(false));
    expect(document.activeElement).toBe(trigger);
  });
});