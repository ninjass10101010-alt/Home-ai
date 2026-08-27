"use client";
import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";
import { groceryCategories } from "@/data/meals";
import type { SyncPreview } from "@/services/mealSync";

const emojiFor = (category: string) => groceryCategories.find(c => c.id === category)?.emoji || "📦";

interface SyncPreviewSheetProps {
  open: boolean;
  title: string;
  preview: SyncPreview;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function SyncPreviewSheet({ open, title, preview, busy, onConfirm, onCancel }: SyncPreviewSheetProps) {
  const count = preview.items.length;
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={`This will add ${count} item${count === 1 ? "" : "s"} to your grocery list:`}
      footer={
        <>
          <SoftButton variant="primary" size="md" onClick={onConfirm} disabled={busy} className="flex-1">
            {busy ? "Adding…" : `Add ${count}`}
          </SoftButton>
          <SoftButton variant="ghost" size="md" onClick={onCancel} disabled={busy}>
            Cancel
          </SoftButton>
        </>
      }
    >
      <ul className="nice-scroll max-h-64 space-y-1.5 overflow-y-auto pr-1">
        {preview.items.map(item => (
          <li key={`${item.name}-${item.category}`} className="flex items-center gap-3 rounded-xl bg-[var(--color-surface-2)] px-3 py-2">
            <span className="text-lg" aria-hidden>{emojiFor(item.category)}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{item.name}</span>
            <span className="shrink-0 text-xs font-bold text-text-muted">{item.quantity}</span>
          </li>
        ))}
      </ul>
      {preview.alreadyOnList > 0 && (
        <p className="mt-3 text-xs font-semibold text-text-muted">
          {preview.alreadyOnList} more already on your list — they won&apos;t be added again.
        </p>
      )}
    </Modal>
  );
}
