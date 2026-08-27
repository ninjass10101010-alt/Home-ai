/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState, type ReactNode } from "react";

const EXIT_MS = 180;

interface ToastProps {
  open: boolean;
  children: ReactNode;
  tone?: "neutral" | "success" | "error";
}

export default function Toast({ open, children, tone = "neutral" }: ToastProps) {
  const [visible, setVisible] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setVisible(true);
      setClosing(false);
      return;
    }
    if (!visible) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(false);
      setClosing(false);
      return;
    }
    setClosing(true);
    const timer = setTimeout(() => {
      setVisible(false);
      setClosing(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [open, visible]);

  if (!visible) return null;

  const toneMap = {
    neutral: "border-white/10 bg-[var(--color-surface-0)]/80 text-text-primary",
    success: "border-emerald-300/20 bg-emerald-500/15 text-emerald-200",
    error: "border-rose-300/20 bg-rose-500/15 text-rose-200",
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed left-1/2 top-4 z-[90] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-2xl backdrop-blur-xl ${toneMap[tone]}`}
      style={{
        animation: closing
          ? `toastExit ${EXIT_MS}ms var(--ease-standard) both`
          : `toastSlide 0.4s var(--ease-spring) both`,
      }}
    >
      {children}
    </div>
  );
}
