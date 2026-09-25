"use client";

import { useCallback } from "react";
import type { ReactNode } from "react";
import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";

export interface SettingsConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
  body?: ReactNode;
  error?: ReactNode;
  children?: ReactNode;
}

export default function SettingsConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
  body,
  error,
  children,
}: SettingsConfirmDialogProps) {
  const handleClose = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  const handleConfirm = useCallback(() => {
    onConfirm();
  }, [onConfirm]);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title}
      description={description}
      footer={
        <>
          <SoftButton variant="secondary" onClick={handleClose} disabled={busy} className="flex-1">
            Cancel
          </SoftButton>
          <SoftButton onClick={handleConfirm} loading={busy} className="flex-1">
            {confirmLabel}
          </SoftButton>
        </>
      }
      panelClassName="settings-dialog"
    >
      {error ? <div role="alert" className="mb-3 text-sm font-semibold text-[var(--color-accent-rose)]">{error}</div> : null}
      {body ?? children ?? null}
    </Modal>
  );
}
