"use client";

import { getStoreLabel, STORE_COLORS, type StoreId } from "@/lib/stores";

interface StorePillProps {
  store: string;
  onClick?: () => void;
  className?: string;
}

export default function StorePill({ store, onClick, className = "" }: StorePillProps) {
  const label = getStoreLabel(store);
  const isAny = store === "any" || !store;
  const tone = isAny ? null : STORE_COLORS[store as StoreId] ?? "var(--color-accent-selected)";

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all ${
        isAny ? "bg-[var(--color-surface-3)] text-text-muted" : ""
      } ${onClick ? "cursor-pointer hover:brightness-110 active:scale-[0.97]" : "cursor-default"} ${className}`}
      style={tone ? { backgroundColor: `color-mix(in srgb, ${tone} 15%, transparent)`, color: tone } : undefined}
      disabled={!onClick}
      type="button"
    >
      {label}
    </button>
  );
}
