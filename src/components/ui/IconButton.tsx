"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type IconButtonSize = "sm" | "md" | "lg";
export type IconButtonVariant = "glass" | "accent" | "danger" | "ghost";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  "aria-label"?: string;
}

const sizeMap: Record<IconButtonSize, string> = {
  sm: "h-9 w-9 [&>svg]:h-4 [&>svg]:w-4",
  md: "h-11 w-11 [&>svg]:h-5 [&>svg]:w-5",
  lg: "h-12 w-12 [&>svg]:h-6 [&>svg]:w-6",
};

const variantMap: Record<IconButtonVariant, string> = {
  glass: "bg-[var(--color-surface-0)]/35 text-text-primary border border-white/10 backdrop-blur-xl",
  accent: "bg-[var(--color-accent-selected)]/15 text-[var(--color-accent-selected)] border border-[var(--color-accent-selected)]/25",
  danger: "bg-rose-500 text-white border border-rose-300/20",
  ghost: "bg-transparent text-text-secondary border border-transparent",
};

export default function IconButton({
  children,
  size = "md",
  variant = "glass",
  className = "",
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={`grid place-items-center rounded-full tap disabled:pointer-events-none disabled:opacity-50 ${sizeMap[size]} ${variantMap[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
