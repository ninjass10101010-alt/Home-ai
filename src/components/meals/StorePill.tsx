"use client";

import { getStoreLabel } from "@/lib/stores";

interface StorePillProps {
  store: string;
  onClick?: () => void;
  className?: string;
}

export default function StorePill({ store, onClick, className = "" }: StorePillProps) {
  const label = getStoreLabel(store);
  const isAny = store === "any" || !store;

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all ${
        isAny
          ? "bg-[var(--color-surface-3)] text-text-muted"
          : "bg-[var(--color-accent-selected)]/15 text-[var(--color-accent-selected)]"
      } ${onClick ? "cursor-pointer hover:brightness-110 active:scale-[0.97]" : "cursor-default"} ${className}`}
      disabled={!onClick}
      type="button"
    >
      {label}
    </button>
  );
}
