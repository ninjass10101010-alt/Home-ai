"use client";
import Modal from "@/components/ui/Modal";
import { GroceryItem } from "@/types/meals";

interface GroceryItemActionsSheetProps {
  open: boolean;
  item: GroceryItem | null;
  onClose: () => void;
  onToggleLock: (item: GroceryItem) => void;
  onEdit: (item: GroceryItem) => void;
  onDelete: (item: GroceryItem) => void;
  onSendToPantry: (item: GroceryItem) => void;
  pantryBusy?: boolean;
}

const rowClass = "w-full rounded-xl bg-[var(--color-surface-2)] px-4 py-3 text-left text-sm font-semibold text-text-primary hover:bg-[var(--color-surface-3)] tap-sm";

export default function GroceryItemActionsSheet({ open, item, onClose, onToggleLock, onEdit, onDelete, onSendToPantry, pantryBusy }: GroceryItemActionsSheetProps) {
  if (!item) return null;
  return (
    <Modal open={open} onClose={onClose} title={`${item.emoji} ${item.name}`} description="Item actions">
      <div className="space-y-2">
        {!item.needed && (
          <button type="button" className={rowClass} disabled={pantryBusy}
            aria-label={`Send ${item.name} to pantry`}
            onClick={() => { onSendToPantry(item); onClose(); }}>
            🥫 Send to pantry
          </button>
        )}
        <button type="button" className={rowClass}
          aria-label={item.manualOverride ? `unlock ${item.name} for auto-sync` : `lock ${item.name} from auto-sync`}
          onClick={() => { onToggleLock(item); onClose(); }}>
          📌 {item.manualOverride ? "Unlock auto-sync" : "Lock from auto-sync"}
        </button>
        <button type="button" className={rowClass}
          aria-label={`Edit ${item.name}`}
          onClick={() => { onEdit(item); onClose(); }}>
          ✎ Edit details
        </button>
        <button type="button"
          className={`${rowClass} text-[var(--color-accent-rose)] hover:bg-[var(--color-accent-rose)]/10`}
          aria-label={`Delete ${item.name}`}
          onClick={() => { onDelete(item); onClose(); }}>
          🗑️ Delete
        </button>
      </div>
    </Modal>
  );
}
