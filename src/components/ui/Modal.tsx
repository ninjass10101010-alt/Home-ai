/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState, type ReactNode } from "react";

const EXIT_MS = 150;

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

  useEffect(() => {
    if (phase !== "open") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [phase, onClose]);

  if (phase === "closed") return null;
  const closing = phase === "closing";

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm sm:items-center"
      style={closing ? { animation: `overlayExit ${EXIT_MS}ms var(--ease-standard) both` } : undefined}
      onClick={onClose}
    >
      <div
        className="material-thick w-full max-w-lg rounded-[2rem] border border-white/12 bg-[var(--color-surface-0)]/80 p-5 shadow-2xl backdrop-blur-2xl sm:pb-safe"
        style={{ animation: closing ? `modalExit ${EXIT_MS}ms var(--ease-standard) both` : `modalEnter 0.35s var(--ease-spring) both` }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4">
          <h3 className="text-lg font-bold text-text-primary">{title}</h3>
          {description && <p className="mt-1 text-sm text-text-secondary">{description}</p>}
        </div>
        <div>{children}</div>
        {footer && <div className="mt-5 flex gap-2">{footer}</div>}
      </div>
    </div>
  );
}
