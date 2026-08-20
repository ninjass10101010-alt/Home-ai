"use client";

import type { ReactNode } from "react";
import SoftButton from "./SoftButton";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Drop the nested glass-card chrome (border/bg/blur/min-height) when rendering inside a widget body. */
  flat?: boolean;
}

export default function EmptyState({ icon = "✨", title, description, actionLabel, onAction, flat = false }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${flat ? "py-2" : "min-h-56 rounded-3xl border border-white/10 bg-[var(--color-surface-0)]/30 p-8 backdrop-blur-xl"}`}>
      <div className="mb-4 text-4xl">{icon}</div>
      <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-text-secondary">{description}</p>
      {actionLabel && onAction && (
        <SoftButton onClick={onAction} className="mt-5" size="md">
          {actionLabel}
        </SoftButton>
      )}
    </div>
  );
}
