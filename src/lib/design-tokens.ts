import type { AccentColor } from "@/lib/theme-config";

export const warmGlassAccentOptions: Array<{
  id: AccentColor;
  label: string;
  hex: string;
  glow: string;
  description: string;
}> = [
  { id: "nori", label: "Nori", hex: "#3b82f6", glow: "rgba(59,130,246,0.25)", description: "Trust, default family blue" },
  { id: "violet", label: "Violet", hex: "#7c6ff7", glow: "rgba(124,111,247,0.25)", description: "Premium and special moments" },
  { id: "rose", label: "Rose", hex: "#f43f5e", glow: "rgba(244,63,94,0.25)", description: "Urgent and alert" },
  { id: "coral", label: "Coral", hex: "#fb7185", glow: "rgba(251,113,133,0.25)", description: "Warm emphasis" },
  { id: "lavender", label: "Lavender", hex: "#a78bfa", glow: "rgba(167,139,250,0.25)", description: "Calm and creative" },
  { id: "cyan", label: "Cyan", hex: "#06b6d4", glow: "rgba(6,182,212,0.25)", description: "Information and clarity" },
  { id: "mint", label: "Mint", hex: "#4ade80", glow: "rgba(74,222,128,0.25)", description: "Success and health" },
  { id: "amber", label: "Amber", hex: "#f59e0b", glow: "rgba(245,158,11,0.25)", description: "Warnings and energy" },
  { id: "apricot", label: "Apricot", hex: "#fb923c", glow: "rgba(251,146,60,0.28)", description: "Family warmth and kids" },
  { id: "sage", label: "Sage", hex: "#84cc16", glow: "rgba(132,204,22,0.25)", description: "Routine and calm" },
];

export const warmGlassRadius = {
  sm: "10px",
  md: "16px",
  lg: "20px",
  xl: "28px",
  "2xl": "36px",
  pill: "9999px",
} as const;

export const warmGlassMotion = {
  fast: "150ms",
  base: "240ms",
  slow: "400ms",
  glide: "600ms",
  standard: "cubic-bezier(0.4, 0, 0.2, 1)",
  emphasized: "cubic-bezier(0.2, 0, 0, 1)",
  decel: "cubic-bezier(0, 0, 0.2, 1)",
} as const;
