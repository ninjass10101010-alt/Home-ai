"use client";

import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";
import { GroceryItem } from "@/types/meals";
import { getStoreLabel, ALL_STORES } from "@/lib/stores";

interface StoreOrderSheetProps {
  open: boolean;
  onClose: () => void;
  items: GroceryItem[];
  stores: Record<string, GroceryItem[]>;
  onOrderStore: (storeId: string, items: GroceryItem[]) => void;
  onOrderAll: () => void;
  ordering: boolean;
  orderingStore: string | null;
}

function walmartSearchUrl(items: GroceryItem[]): string {
  const query = items.map((item) => item.name).join(", ");
  return `https://www.walmart.com/search?q=${encodeURIComponent(query)}`;
}

export default function StoreOrderSheet({
  open,
  onClose,
  items,
  stores,
  onOrderStore,
  onOrderAll,
  ordering,
  orderingStore,
}: StoreOrderSheetProps) {
  // Known stores in registry order, then any unknown ids (defensive), excluding "any".
  const knownIds: string[] = ALL_STORES.map((s) => s.id);
  const storeIds = [
    ...knownIds.filter((id) => (stores[id]?.length ?? 0) > 0),
    ...Object.keys(stores).filter(
      (id) => id !== "any" && !knownIds.includes(id) && (stores[id]?.length ?? 0) > 0
    ),
  ];
  const unassigned = stores["any"] ?? [];
  const storeCount = Math.max(storeIds.length, 1);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Order groceries"
      description={`${items.length} item${items.length === 1 ? "" : "s"} across ${storeCount} store${storeCount === 1 ? "" : "s"}`}
    >
      <div className="nice-scroll max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        {storeIds.map((storeId) => {
          const storeItems = stores[storeId] ?? [];
          const isOrderingThis = ordering && orderingStore === storeId;
          return (
            <section
              key={storeId}
              className="rounded-2xl border border-white/10 bg-[var(--color-surface-1)]/50 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-text-primary">{getStoreLabel(storeId)}</h4>
                <span className="shrink-0 text-xs text-text-muted">
                  {storeItems.length} item{storeItems.length === 1 ? "" : "s"}
                </span>
              </div>
              <ul className="space-y-1.5">
                {storeItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 rounded-xl bg-[var(--color-surface-2)] px-3 py-2"
                  >
                    <span className="text-lg" aria-hidden>{item.emoji}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
                      {item.name}
                    </span>
                    {item.quantity && (
                      <span className="shrink-0 text-xs font-bold text-text-muted">{item.quantity}</span>
                    )}
                  </li>
                ))}
              </ul>
              {storeId === "walmart" ? (
                <>
                  <SoftButton
                    variant="primary"
                    size="sm"
                    className="mt-3 w-full"
                    onClick={() => window.open(walmartSearchUrl(storeItems), "_blank", "noopener,noreferrer")}
                  >
                    🛒 walmart.com search
                  </SoftButton>
                  <p className="mt-2 text-xs text-text-muted">
                    Walmart isn&apos;t on Instacart in Holland — use walmart.com search instead
                  </p>
                </>
              ) : (
                <SoftButton
                  variant="primary"
                  size="sm"
                  className="mt-3 w-full"
                  loading={isOrderingThis}
                  disabled={ordering}
                  onClick={() => onOrderStore(storeId, storeItems)}
                >
                  {isOrderingThis ? "Creating…" : "Order from Instacart →"}
                </SoftButton>
              )}
            </section>
          );
        })}

        {unassigned.length > 0 && (
          <section className="rounded-2xl border border-white/10 bg-[var(--color-surface-1)]/50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-text-primary">Unassigned</h4>
              <span className="shrink-0 text-xs text-text-muted">
                {unassigned.length} item{unassigned.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="space-y-1.5">
              {unassigned.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-xl bg-[var(--color-surface-2)] px-3 py-2"
                >
                  <span className="text-lg" aria-hidden>{item.emoji}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
                    {item.name}
                  </span>
                  {item.quantity && (
                    <span className="shrink-0 text-xs font-bold text-text-muted">{item.quantity}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {storeIds.length > 1 && (
        <SoftButton
          variant="primary"
          size="md"
          className="mt-4 w-full"
          loading={ordering && orderingStore === "all"}
          disabled={ordering}
          onClick={onOrderAll}
        >
          {ordering && orderingStore === "all" ? "Creating…" : "Order All Stores"}
        </SoftButton>
      )}
    </Modal>
  );
}
