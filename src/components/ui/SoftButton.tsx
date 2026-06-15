"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type SoftButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
export type SoftButtonSize = "sm" | "md" | "lg" | "icon";

interface SoftButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: SoftButtonVariant;
  size?: SoftButtonSize;
  loading?: boolean;
  children: ReactNode;
}

const variantMap: Record<SoftButtonVariant, string> = {
  primary: "bg-[var(--color-accent-button)] text-white border border-[var(--color-accent-selected)]/20 shadow-[0_12px_24px_rgba(0,0,0,0.16)]",
  secondary: "bg-[var(--color-surface-2)] text-[var(--color-accent-button)] border border-[var(--color-accent-selected)]/25",
  ghost: "bg-transparent text-text-secondary hover:text-text-primary border border-transparent",
  danger: "bg-rose-500 text-white border border-rose-300/20 shadow-[0_12px_24px_rgba(244,63,94,0.18)]",
  success: "bg-emerald-500 text-white border border-emerald-300/20 shadow-[0_12px_24px_rgba(16,185,129,0.18)]",
};

const sizeMap: Record<SoftButtonSize, string> = {
  sm: "h-9 px-3.5 text-xs rounded-xl gap-1.5",
  md: "h-11 px-4 text-sm rounded-2xl gap-2",
  lg: "h-12 px-5 text-sm font-semibold rounded-2xl gap-2",
  icon: "h-11 w-11 px-0 text-sm rounded-2xl",
};

export default function SoftButton({
  variant = "primary",
  size = "md",
  loading = false,
  children,
  className = "",
  disabled,
  type = "button",
  ...props
}: SoftButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled ?? loading}
      className={`inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 ${variantMap[variant]} ${sizeMap[size]} ${className}`}
      {...props}
    >
      {loading && (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
        </svg>
      )}
      {children}
    </button>
  );
}
