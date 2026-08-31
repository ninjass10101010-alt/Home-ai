"use client";

import { useMemo } from "react";
import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";
import { PINNED_STORES, calculateCheapestSplit, formatStoreTotal, type PriceCompareItem } from "@/lib/stores";

interface PriceCompareSheetProps {
  open: boolean;
  onClose: () => void;
  items: PriceCompareItem[];
  onApply?: (cheapestStore: string) => void;
}

export default function PriceCompareSheet({ open, onClose, items, onApply }: PriceCompareSheetProps) {
  const result = useMemo(() => calculateCheapestSplit(items), [items]);

  const storesWithPrices = PINNED_STORES.filter(
    (s) => s.id !== "walmart" && result.totalByStore[s.id] !== undefined
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Compare prices"
      description={`${items.length} item${items.length === 1 ? "" : "s"} across ${storesWithPrices.length} store${storesWithPrices.length === 1 ? "" : "s"}`}
    >
      <div className="max-h-[60vh] overflow-auto">
        {/* Header row — store names */}
        <div className="sticky top-0 z-10 grid border-b border-white/10 bg-[var(--color-surface-1)]" style={{ gridTemplateColumns: `120px repeat(${storesWithPrices.length}, 1fr)` }}>
          <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Item</div>
          {storesWithPrices.map((s) => (
            <div key={s.id} className={`px-2 py-2 text-center text-[11px] font-semibold ${result.cheapestStore === s.id ? "text-[var(--color-accent-mint)]" : "text-text-muted"}`}>
              {s.label}
              {result.cheapestStore === s.id && <span className="ml-1 text-[9px]">★</span>}
            </div>
          ))}
        </div>

        {/* Item rows */}
        {items.map((item, idx) => (
          <div
            key={`${item.name}-${idx}`}
            className="grid border-b border-white/5 last:border-b-0"
            style={{ gridTemplateColumns: `120px repeat(${storesWithPrices.length}, 1fr)` }}
          >
            <div className="truncate px-3 py-2.5 text-sm text-text-primary">{item.name}</div>
            {storesWithPrices.map((s) => {
              const price = item.prices[s.id];
              const isLowest = price !== undefined && Object.values(item.prices).every(
                (p) => p === undefined || price <= p
              );
              return (
                <div
                  key={s.id}
                  className={`px-2 py-2.5 text-center text-sm tabular-nums ${
                    price === undefined
                      ? "text-text-muted"
                      : isLowest
                        ? "font-semibold text-[var(--color-accent-mint)]"
                        : "text-text-secondary"
                  }`}
                >
                  {price !== undefined ? `$${price.toFixed(2)}` : "—"}
                </div>
              );
            })}
          </div>
        ))}

        {/* Totals footer */}
        <div className="sticky bottom-0 grid border-t border-white/10 bg-[var(--color-surface-1)]" style={{ gridTemplateColumns: `120px repeat(${storesWithPrices.length}, 1fr)` }}>
          <div className="px-3 py-3 text-sm font-bold text-text-primary">Total</div>
          {storesWithPrices.map((s) => {
            const total = result.totalByStore[s.id];
            const isCheapest = result.cheapestStore === s.id;
            return (
              <div
                key={s.id}
                className={`px-2 py-3 text-center text-sm font-bold tabular-nums ${
                  isCheapest
                    ? "text-[var(--color-accent-mint)]"
                    : total !== undefined
                      ? "text-text-primary"
                      : "text-text-muted"
                }`}
              >
                {total !== undefined ? formatStoreTotal(total) : "—"}
              </div>
            );
          })}
        </div>
      </div>

      {/* Savings callout + action */}
      {result.cheapestStore && result.savings > 0 && (
        <div className="mt-4 rounded-2xl border border-[var(--color-accent-mint)]/20 bg-[var(--color-accent-mint)]/10 px-4 py-3 text-center">
          <p className="text-sm font-semibold text-[var(--color-accent-mint)]">
            Save {formatStoreTotal(result.savings)} at {PINNED_STORES.find((s) => s.id === result.cheapestStore)?.label}
          </p>
        </div>
      )}

      <div className="mt-4 flex gap-3">
        <SoftButton variant="ghost" size="md" onClick={onClose} className="flex-1">
          Close
        </SoftButton>
        {result.cheapestStore && onApply && (
          <SoftButton
            variant="primary"
            size="md"
            onClick={() => { onApply(result.cheapestStore!); onClose(); }}
            className="flex-1"
          >
            Apply to all
          </SoftButton>
        )}
      </div>
    </Modal>
  );
}
