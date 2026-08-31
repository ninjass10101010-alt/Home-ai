"use client";

import { useState } from "react";
import { PINNED_STORES, ALL_STORES, StoreId } from "@/lib/stores";

interface StorePickerProps {
  open: boolean;
  onClose: () => void;
  currentStore: string;
  onSelect: (store: StoreId) => void;
}

export default function StorePicker({ open, onClose, currentStore, onSelect }: StorePickerProps) {
  const [showAll, setShowAll] = useState(false);
  const displayStores = showAll ? ALL_STORES : PINNED_STORES;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-t-3xl bg-[var(--color-surface-1)] p-6 shadow-2xl sm:rounded-3xl">
        <h3 className="mb-4 text-center text-lg font-bold text-text-primary">Pick a store</h3>
        <div className="grid grid-cols-3 gap-2">
          {displayStores.map((s) => (
            <button
              key={s.id}
              onClick={() => { onSelect(s.id); onClose(); }}
              className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition-all active:scale-[0.97] ${
                currentStore === s.id
                  ? "bg-[var(--color-accent-selected)]/20 text-[var(--color-accent-selected)] border-2 border-[var(--color-accent-selected)]/40"
                  : "bg-[var(--color-surface-2)] text-text-primary border-2 border-transparent hover:border-white/10"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        {!showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="mt-3 w-full text-center text-xs text-text-muted active:scale-[0.97]"
          >
            More stores ↓
          </button>
        )}
        <button
          onClick={onClose}
          className="mt-4 w-full rounded-xl bg-[var(--color-surface-2)] py-2.5 text-sm font-semibold text-text-primary hover:bg-[var(--color-surface-3)] active:scale-[0.97]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
