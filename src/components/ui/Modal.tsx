/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import useDialogA11y from "@/components/ui/useDialogA11y";

const EXIT_MS = 150;

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  panelClassName?: string;
}

export default function Modal({ open, onClose, title, description, children, footer, panelClassName }: ModalProps) {
  const [phase, setPhase] = useState<"closed" | "open" | "closing">("closed");
  const titleId = useId();
  const descriptionId = useId();

  // Focus trap, Escape, background inerting and focus return live in the
  // shared hook every dialog uses — this file only owns the enter/exit phases.
  const panelRef = useDialogA11y<HTMLDivElement>({ active: phase === "open", onClose });

  useEffect(() => {
    if (open) {
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

  if (phase === "closed") return null;
  const closing = phase === "closing";

  // Portaled to <body>: rendered inline the overlay inherits PageShell's
  // `relative z-10` <main> stacking context, so its z-[80] can't beat the
  // z-50 CapsuleNav — on mobile (bottom-aligned sheet) the nav painted over
  // tall-form footers (e.g. Tasks → Add Task Save/Delete/Cancel). The
  // max-h + overflow keeps forms taller than the viewport fully reachable.
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-4 backdrop-blur-md sm:items-center"
      style={closing ? { animation: `overlayExit ${EXIT_MS}ms var(--ease-standard) both` } : undefined}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`material-thick flex max-h-[85dvh] w-full max-w-lg flex-col rounded-2xl border border-white/12 bg-[var(--color-surface-0)]/80 p-5 shadow-2xl backdrop-blur-2xl outline-none sm:pb-safe${panelClassName ? ` ${panelClassName}` : ""}`}
        style={{
          animation: closing ? `modalExit ${EXIT_MS}ms var(--ease-standard) both` : `modalEnter 0.35s var(--ease-spring) both`,
          // `.material-thick` is unlayered CSS, so it beats any Tailwind
          // background utility on this element — which left `bg-surface-0/80`
          // inert and the light-theme panel at the class's own rgba(255,255,255,
          // .8). Over a 55% scrim that composited to a dead grey slab DARKER
          // than the fields inside it: the elevation read inverted. An inline
          // value outranks the class, so the surface token is finally the thing
          // deciding the panel colour, at an alpha that stays above its fields
          // in both themes while the 26px backdrop blur keeps the glass.
          background: "color-mix(in srgb, var(--color-surface-1) 94%, transparent)",
          // `.material-thick`'s light-theme shadow is 0 4px 16px .08 — too soft
          // to lift a near-white sheet off a near-white page.
          boxShadow: "0 28px 80px -16px rgba(0,0,0,0.62), 0 4px 12px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.10)",
          // One step under the 36px field radius, so the panel reads as the
          // container rather than as another pill.
          borderRadius: "var(--radius-xl)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 shrink-0">
          <h3 id={titleId} className="text-lg font-bold text-text-primary">{title}</h3>
          {description && <p id={descriptionId} className="mt-1 text-sm text-text-secondary">{description}</p>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1">{children}</div>
        {/* The hairline is what tells a reader that the field sliced by the
            scroll edge continues UNDER the actions instead of being cut off. */}
        {footer && (
          <div className="mt-4 flex shrink-0 gap-2 border-t border-[var(--color-border)] pt-4">{footer}</div>
        )}
      </div>
    </div>,
    document.body
  );
}
