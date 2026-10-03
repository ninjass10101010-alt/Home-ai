"use client";

import { useEffect, useRef, type RefObject } from "react";

/** Focusable candidates inside a dialog, matching the shared `Modal` rule.
 *  Effectively-disabled controls (`disabled`, or inside a disabled `<fieldset>`)
 *  are filtered out at query time via `:disabled`. */
const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const NATIVELY_FOCUSABLE = /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|IFRAME)$/;

interface Marked {
  el: HTMLElement;
  inert: string | null;
  ariaHidden: string | null;
}

/** Open-dialog stack. Only the TOP-most dialog reacts to Tab / Escape, so a
 *  nested dialog (the photo cropper opened from the Profile sheet) never lets a
 *  key escape through to the dialog underneath it. */
const openDialogs: symbol[] = [];

function focusablesIn(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.matches(":disabled"),
  );
}

/** Mark everything that is *not* an ancestor-or-self of the dialog as inert and
 *  hidden from assistive tech. Walks the ancestor chain so an inline dialog and
 *  a body-portaled one are both covered. */
function hideBackground(panel: HTMLElement | null): Marked[] {
  if (!panel) return [];
  const marked: Marked[] = [];
  const seen = new Set<HTMLElement>();
  let node: HTMLElement | null = panel;
  while (node && node !== document.body && node !== document.documentElement) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    for (const child of Array.from(parent.children)) {
      const el = child as HTMLElement;
      if (el === node || seen.has(el)) continue;
      seen.add(el);
      marked.push({
        el,
        inert: el.getAttribute("inert"),
        ariaHidden: el.getAttribute("aria-hidden"),
      });
      el.setAttribute("inert", "");
      el.setAttribute("aria-hidden", "true");
    }
    node = parent;
  }
  return marked;
}

function unhideBackground(marked: Marked[]) {
  for (const { el, inert, ariaHidden } of marked) {
    if (inert === null) el.removeAttribute("inert");
    else el.setAttribute("inert", inert);
    if (ariaHidden === null) el.removeAttribute("aria-hidden");
    else el.setAttribute("aria-hidden", ariaHidden);
  }
}

/** Focus the trigger again. If the trigger is gone (row deleted, route swapped)
 *  fall back to the nearest surviving ancestor that can hold focus, then to
 *  `<body>` — never leave focus on nothing. */
function restoreFocus(trigger: HTMLElement | null, chain: HTMLElement[]) {
  if (trigger && document.contains(trigger)) {
    trigger.focus();
    if (document.activeElement === trigger) return;
  }
  for (const node of chain) {
    if (!document.contains(node)) continue;
    if (!node.hasAttribute("tabindex") && !NATIVELY_FOCUSABLE.test(node.tagName)) continue;
    if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
    node.focus();
    if (document.activeElement === node) return;
  }
  if (!document.body.hasAttribute("tabindex")) document.body.setAttribute("tabindex", "-1");
  document.body.focus();
}

export interface DialogA11yOptions {
  /** The dialog is open. `false` tears the trap down and returns focus. */
  active: boolean;
  /** Escape closes the dialog. Omit for a dialog that only leaves its own way. */
  onClose?: () => void;
  /** Escape is inert — a destructive confirmation is mid-flight (alarm arm /
   *  disarm, PIN verification in flight). Keeps the rule to one switch instead
   *  of a per-dialog "is discarding unsaved input?" heuristic. */
  escapeDisabled?: boolean;
}

/**
 * The one dialog accessibility contract (WCAG 2.1.1 Keyboard, 2.1.2 No Keyboard
 * Trap — here inverted, so Tab must NOT leave, 4.1.2 Name/Role/Value).
 *
 * Every `role="dialog" aria-modal="true"` overlay in the app routes through
 * this hook — the shared `Modal` first, then the hand-rolled PIN pads, the
 * full-screen recipe/cook editors, the pickers and the legacy form sheets — so
 * a new dialog inherits the behaviour instead of re-implementing it:
 *
 *  - focus moves into the dialog on open (an `autoFocus` child wins, then the
 *    first focusable, then the panel itself, which needs `tabIndex={-1}`);
 *  - Tab / Shift+Tab wrap at both ends and pull focus back if it escaped;
 *  - Escape calls `onClose` (unless `escapeDisabled`);
 *  - everything outside the dialog is `inert` + `aria-hidden` while open;
 *  - focus returns to the trigger on close, or to a surviving ancestor;
 *  - only the top-most dialog answers keys, so nested dialogs restore in order.
 *
 * Independent of `prefers-reduced-motion` — focus is not motion.
 */
export default function useDialogA11y<T extends HTMLElement = HTMLElement>({ active, onClose, escapeDisabled }: DialogA11yOptions): RefObject<T | null> {
  const panelRef = useRef<T | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const chainRef = useRef<HTMLElement[]>([]);

  // The pre-open focus target, read during render: on the render where the
  // dialog activates its panel is not committed yet and React's autoFocus has
  // not run, so `document.activeElement` is still the real trigger. Reading it
  // in an effect instead would record the autoFocus'd input inside the panel —
  // an element that unmounts on close and silently loses the focus return.
  // Guarded because this runs during SSR too, where there is no document.
  const openFocusTarget = typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null);
  const latestOpenFocusTarget = useRef<HTMLElement | null>(null);
  const latestOnClose = useRef<(() => void) | undefined>(undefined);
  const latestEscapeDisabled = useRef(false);

  // Declared BEFORE the trap effect so a value written here is visible to it on
  // the very same commit (React flushes sibling effects in declaration order).
  useEffect(() => {
    latestOpenFocusTarget.current = openFocusTarget;
    latestOnClose.current = onClose;
    latestEscapeDisabled.current = Boolean(escapeDisabled);
  });

  useEffect(() => {
    if (!active) return;

    const token = Symbol("dialog");
    openDialogs.push(token);

    const trigger = latestOpenFocusTarget.current;
    triggerRef.current = trigger;
    const chain: HTMLElement[] = [];
    for (let node = trigger?.parentElement ?? null; node; node = node.parentElement) chain.push(node);
    chainRef.current = chain;

    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      const initial = focusablesIn(panel)[0];
      if (initial) initial.focus();
      else panel.focus();
    }

    // AFTER focus moved in — marking a subtree aria-hidden while it still holds
    // focus is what makes browsers drop focus back to <body>.
    const marked = hideBackground(panelRef.current);

    const onKeyDown = (event: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== token) return;
      if (event.key === "Escape") {
        if (latestEscapeDisabled.current) return;
        latestOnClose.current?.();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const items = focusablesIn(panelRef.current);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      const inside = panelRef.current.contains(current);
      if (event.shiftKey && (current === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };

    // Capture on `window` so the listener fires exactly once whether the event
    // is dispatched on window, on document, or on a control inside the dialog.
    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      const at = openDialogs.indexOf(token);
      if (at >= 0) openDialogs.splice(at, 1);
      // Un-hide before restoring: focusing a still-inert ancestor is a no-op.
      unhideBackground(marked);
      restoreFocus(triggerRef.current, chainRef.current);
      triggerRef.current = null;
      chainRef.current = [];
    };
  }, [active]);

  return panelRef;
}