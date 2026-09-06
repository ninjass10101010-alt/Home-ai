/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const EXIT_MS = 150;

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export default function Modal({ open, onClose, title, description, children, footer }: ModalProps) {
  const [phase, setPhase] = useState<"closed" | "open" | "closing">("closed");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      // Capture the trigger HERE — while phase is still "closed" the panel
      // isn't in the DOM, so activeElement is the real pre-open focus. The
      // focus effect below runs AFTER React's autoFocus commit, which would
      // record the autoFocus'd input inside the panel instead (and that
      // element unmounts on close, silently losing the focus return).
      lastFocusedRef.current = document.activeElement as HTMLElement | null;
      setPhase("open");
      return;
    }
    setPhase((prev) => (prev === "closed" ? prev : "closing"));
  }, [open]);

  useEffect(() => {
    if (phase !== "closing") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase("closed");
      return;
    }
    const t = setTimeout(() => setPhase("closed"), EXIT_MS);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "open") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [phase, onClose]);

  // Real dialog semantics: focus lands inside the panel on open, Tab /
  // Shift+Tab cycle within it, and focus returns to the trigger on close —
  // the same trap pattern the weather Details modal uses.
  useEffect(() => {
    if (phase !== "open") return;
    const focusables = () =>
      panelRef.current
        ? Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => !el.hasAttribute("disabled"))
        : [];
    // The trigger was already captured in the open effect above. React's
    // autoFocus commit runs before this effect — if it already placed focus
    // inside the panel, honor it (e.g. the Tasks claim modal has a
    // <select> before its autoFocus PIN input). Otherwise move focus in.
    if (!panelRef.current?.contains(document.activeElement)) {
      const initialFocus = focusables()[0];
      if (initialFocus) initialFocus.focus();
      else panelRef.current?.focus();
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !panelRef.current) return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panelRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panelRef.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const restore = lastFocusedRef.current;
      if (restore && document.contains(restore)) restore.focus();
    };
  }, [phase]);

  if (phase === "closed") return null;
  const closing = phase === "closing";

  // Portaled to <body>: rendered inline the overlay inherits PageShell's
  // `relative z-10` <main> stacking context, so its z-[80] can't beat the
  // z-50 CapsuleNav — on mobile (bottom-aligned sheet) the nav painted over
  // tall-form footers (e.g. Tasks → Add Task Save/Delete/Cancel). The
  // max-h + overflow keeps forms taller than the viewport fully reachable.
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm sm:items-center"
      style={closing ? { animation: `overlayExit ${EXIT_MS}ms var(--ease-standard) both` } : undefined}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="material-thick flex max-h-[85dvh] w-full max-w-lg flex-col rounded-[2rem] border border-white/12 bg-[var(--color-surface-0)]/80 p-5 shadow-2xl backdrop-blur-2xl outline-none sm:pb-safe"
        style={{ animation: closing ? `modalExit ${EXIT_MS}ms var(--ease-standard) both` : `modalEnter 0.35s var(--ease-spring) both` }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 shrink-0">
          <h3 id={titleId} className="text-lg font-bold text-text-primary">{title}</h3>
          {description && <p className="mt-1 text-sm text-text-secondary">{description}</p>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="mt-5 flex shrink-0 gap-2">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
