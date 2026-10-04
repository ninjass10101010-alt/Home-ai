"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { PINNED_STORES, ALL_STORES, StoreId } from "@/lib/stores";
import useDialogA11y from "@/components/ui/useDialogA11y";

interface StorePickerProps {
  open: boolean;
  onClose: () => void;
  currentStore: string;
  onSelect: (store: StoreId) => void;
}

export default function StorePicker({ open, onClose, currentStore, onSelect }: StorePickerProps) {
  const [showAll, setShowAll] = useState(false);
  const displayStores = showAll ? ALL_STORES : PINNED_STORES;

  const panelRef = useDialogA11y<HTMLDivElement>({ active: open, onClose });

  if (!open) return null;

  // Portaled to <body>: rendered inline this overlay inherited PageShell's
  // `relative z-10` <main> stacking context, so the portaled z-50 CapsuleNav
  // painted straight over it — on the wall and on phones the dock swallowed
  // the sheet's own footer. A z index only means anything at body level.
  return createPortal(
    <div ref={panelRef} tabIndex={-1} className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center outline-none" role="dialog" aria-modal="true" aria-label="Store picker">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-t-2xl bg-[var(--color-surface-1)] p-6 shadow-2xl sm:rounded-2xl">
        <h3 className="mb-4 text-center text-lg font-bold text-text-primary">Pick a store</h3>
        <div className="grid grid-cols-3 gap-2">
          {displayStores.map((s) => (
            <button
              key={s.id}
              onClick={() => { onSelect(s.id); onClose(); }}
              aria-label={s.label}
              className={`tap min-h-11 rounded-xl px-3 text-sm font-semibold ${
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
            className="mt-3 w-full text-center text-xs text-text-muted tap-sm"
          >
            More stores ↓
          </button>
        )}
        <button
          onClick={onClose}
          className="tap mt-4 min-h-11 w-full rounded-xl bg-[var(--color-surface-2)] text-sm font-semibold text-text-primary hover:bg-[var(--color-surface-3)]"
        >
          Cancel
        </button>
      </div>
    </div>
    ,
    document.body
  );
}
