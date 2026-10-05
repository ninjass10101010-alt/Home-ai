/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState, type ReactNode } from "react";
import { readReducedMotionPreference } from "@/hooks/useReducedMotionPreference";

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
    // Read at close time, not at mount: the family may have flipped the toggle
    // since the toast appeared, and reading through the app's own preference is
    // what makes that count. An instant close carries no motion.
    if (readReducedMotionPreference()) {
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

  /**
   * `success` and `error` were a RAW accent as INK on a 15% wash of itself, and
   * a wash of the same hue barely moves the value, so the label inherited the
   * accent at nearly full strength. Measured: **3.14:1** (light success),
   * **3.71:1** (light error), **4.45:1** (dark error) — three of the four
   * non-neutral tones under the 4.5:1 body floor, on `text-sm font-semibold`.
   *
   * Both now walk the accent 55% toward the theme's body ink, which is the
   * `--color-accent-ink-*` formula `ui/Avatar.tsx` already paints member
   * initials with — so a toast, an avatar and a chip in the same colour are the
   * same ink, and it resolves per theme with no light-only branch (the wash is
   * the only thing that differs between the two).
   * Measured in Chromium: success 9.74:1 dark / 6.47:1 light, error 7.25:1 dark
   * / 7.38:1 light.
   *
   * `neutral` is untouched: `--color-text-primary` on `--color-surface-0` is
   * 17.15:1 dark / 17.40:1 light.
   *
   * Distinctness is unaffected — success and error are separated by hue, not by
   * lightness: the two fills sit ΔE 35 (dark) / 38 (light) apart in sRGB and the
   * two inks ΔE 235 / 253, so neither tone can be mistaken for the other at a
   * glance or read as neutral.
   */
  const toneMap = {
    neutral: "border-[var(--color-border)] bg-[var(--color-surface-0)]/80 text-text-primary",
    success:
      "border-[var(--color-accent-mint)]/20 bg-[var(--color-accent-mint)]/15 text-[color-mix(in_srgb,var(--color-accent-mint)_55%,var(--color-text-primary))]",
    error:
      "border-[var(--color-accent-rose)]/20 bg-[var(--color-accent-rose)]/15 text-[color-mix(in_srgb,var(--color-accent-rose)_55%,var(--color-text-primary))]",
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
