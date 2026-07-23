/**
 * useDashboardMode — Determines which dashboard experience to render.
 *
 * Three modes:
 *   "family" — No one logged in. Warm, shared, balanced.
 *   "adult"  — Parent signed in. Clean, dense, efficient.
 *   "kid"    — Child/pet signed in. Fun, colorful, gamified.
 *
 * Also exposes bedtime + weekend modifiers that all modes can react to.
 */
"use client";

import { useState, useEffect, useMemo, createContext, useContext, type ReactNode } from "react";
import { useAuth } from "./useAuth";

// ─── Types ──────────────────────────────────────────────────────────────────

export type DashboardMode = "family" | "adult" | "kid";

export interface DashboardModeContext {
  /** The active dashboard mode based on auth state. */
  mode: DashboardMode;
  /** True when the clock is between 8pm–6am. */
  isBedtime: boolean;
  /** True on Saturday or Sunday. */
  isWeekend: boolean;
  /** The current hour (0–23), updated every 60s. */
  currentHour: number;
  /** The current day of week (0=Sun, 6=Sat). */
  currentDay: number;
  /** Whether the user was a parent before the last logout (for quick toggle). */
  previousMode: DashboardMode | null;
}

// ─── Context ────────────────────────────────────────────────────────────────

const DashboardModeCtx = createContext<DashboardModeContext | null>(null);

export const useDashboardMode = (): DashboardModeContext => {
  const ctx = useContext(DashboardModeCtx);
  if (!ctx) throw new Error("useDashboardMode must be used within DashboardModeProvider");
  return ctx;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveMode(isLoggedIn: boolean, role?: string): DashboardMode {
  if (!isLoggedIn) return "family";
  if (role === "parent") return "adult";
  return "kid"; // child or pet → kid mode
}

function detectBedtime(hour: number): boolean {
  return hour >= 20 || hour < 6;
}

function detectWeekend(day: number): boolean {
  return day === 0 || day === 6;
}

// ─── Provider ───────────────────────────────────────────────────────────────

export function DashboardModeProvider({ children }: { children: ReactNode }) {
  const { isLoggedIn, currentUser } = useAuth();

  const [now, setNow] = useState(() => new Date());
  const [previousMode, setPreviousMode] = useState<DashboardMode | null>(null);

  // Update clock every 60 seconds (we don't need second-level precision here)
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const currentHour = now.getHours();
  const currentDay = now.getDay();
  const isBedtime = detectBedtime(currentHour);
  const isWeekend = detectWeekend(currentDay);
  const mode = resolveMode(isLoggedIn, currentUser?.role);

  // Track mode transitions for animation
  useEffect(() => {
    // Store the last logged-in mode so we can reference it
    if (isLoggedIn) {
      setPreviousMode(mode);
    }
  }, [isLoggedIn, mode]);

  // Set data-mode on <html> for CSS-driven mode styling
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("data-mode", mode);
    html.setAttribute("data-bedtime", isBedtime ? "true" : "false");
    html.setAttribute("data-weekend", isWeekend ? "true" : "false");
  }, [mode, isBedtime, isWeekend]);

  const value = useMemo<DashboardModeContext>(
    () => ({ mode, isBedtime, isWeekend, currentHour, currentDay, previousMode }),
    [mode, isBedtime, isWeekend, currentHour, currentDay, previousMode],
  );

  return <DashboardModeCtx.Provider value={value}>{children}</DashboardModeCtx.Provider>;
}
