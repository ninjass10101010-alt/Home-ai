"use client";

import type { ReactNode } from "react";
import SoftButton from "./SoftButton";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function EmptyState({ icon = "✨", title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-3xl border border-white/10 bg-[var(--color-surface-0)]/30 p-8 text-center backdrop-blur-xl">
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
