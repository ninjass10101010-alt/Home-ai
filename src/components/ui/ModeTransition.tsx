/**
 * ModeTransition — Wraps the home page content and animates the switch
 * between Family / Adult / Kid modes.
 *
 * When the mode changes, it:
 *   1. Fades current content to blur (200ms)
 *   2. Swaps in new mode's content
 *   3. Fades in with a subtle scale (300ms)
 *
 * Total transition: ~500ms, respects prefers-reduced-motion.
 */
"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { useDashboardMode, type DashboardMode } from "@/hooks/useDashboardMode";

interface ModeTransitionProps {
  children: ReactNode;
}

export default function ModeTransition({ children }: ModeTransitionProps) {
  const { mode } = useDashboardMode();
  const [displayedMode, setDisplayedMode] = useState<DashboardMode>(mode);
  const [phase, setPhase] = useState<"idle" | "exit" | "enter">("idle");
  const pendingMode = useRef<DashboardMode>(mode);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (mode === displayedMode) return;

    pendingMode.current = mode;

    // Phase 1: Exit — blur and fade out the old content
    setPhase("exit");

    timeoutRef.current = setTimeout(() => {
      // Phase 2: Swap content while invisible
      setDisplayedMode(mode);
      setPhase("enter");

      timeoutRef.current = setTimeout(() => {
        // Phase 3: Settle — fully visible
        setPhase("idle");
      }, 300);
    }, 200);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [mode, displayedMode]);

  // Build the transition class
  const transitionClass =
    phase === "exit"
      ? "mode-exit"
      : phase === "enter"
        ? "mode-enter"
        : "";

  return (
    <div className={`mode-transition-root ${transitionClass}`}>
      {children}
    </div>
  );
}
