"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";

export interface VerifiedParent {
  id?: string;
  name: string;
  role: string;
}

export async function verifyParentPin(
  pin: string,
): Promise<
  | { ok: true; parent: VerifiedParent }
  | { ok: false; error: string; status: number }
> {
  const clean = pin.trim();
  if (!/^\d{4}$/.test(clean)) {
    return { ok: false, error: "Enter a 4-digit parent PIN.", status: 400 };
  }
  try {
    const res = await fetch("/api/members/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: clean, requireRole: "parent" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 403 || data?.error === "adult_only") {
        return { ok: false, error: "Parent PIN required.", status: 403 };
      }
      if (res.status === 401) {
        return { ok: false, error: "Wrong PIN — try again.", status: 401 };
      }
      return {
        ok: false,
        error: data?.error || "Can't reach the family server right now.",
        status: res.status || 503,
      };
    }
    if (!data?.member || String(data.member.role || "").toLowerCase() !== "parent") {
      return { ok: false, error: "Parent PIN required.", status: 403 };
    }
    return { ok: true, parent: data.member as VerifiedParent };
  } catch {
    return { ok: false, error: "Can't reach the family server right now.", status: 503 };
  }
}

interface ParentPinGateModalProps {
  open: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  onClose: () => void;
  onVerified: (pin: string, parent: VerifiedParent) => Promise<void | { ok?: boolean; error?: string }> | void;
}

export default function ParentPinGateModal({
  open,
  title = "Parent PIN required",
  description = "Enter a parent's 4-digit PIN to save this change.",
  confirmLabel = "Confirm",
  onClose,
  onVerified,
}: ParentPinGateModalProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const resetAndClose = () => {
    setPin("");
    setError("");
    setBusy(false);
    onClose();
  };

  const submit = async () => {
    if (busy || pin.trim().length < 4) return;
    setBusy(true);
    setError("");
    const candidate = pin.trim();
    try {
      const verified = await verifyParentPin(candidate);
      if (!verified.ok) {
        setError(verified.error);
        setPin("");
        return;
      }
      const outcome = await onVerified(candidate, verified.parent);
      if (outcome && outcome.ok === false) {
        setError(outcome.error || "Could not complete change.");
        setPin("");
        return;
      }
      setPin("");
      setError("");
      setBusy(false);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (busy) return;
        resetAndClose();
      }}
      title={title}
      description={description}
      footer={
        <>
          <SoftButton
            variant="secondary"
            onClick={() => {
              if (busy) return;
              resetAndClose();
            }}
            className="flex-1"
            disabled={busy}
          >
            Cancel
          </SoftButton>
          <SoftButton
            variant="primary"
            onClick={() => void submit()}
            loading={busy}
            disabled={pin.trim().length < 4}
            className="flex-1"
          >
            {confirmLabel}
          </SoftButton>
        </>
      }
    >
      <div className="space-y-3">
        <input
          type="password"
          inputMode="numeric"
          maxLength={4}
          autoFocus
          value={pin}
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, "").slice(0, 4));
            if (error) setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="4-digit Parent PIN"
          aria-label="Parent 4-digit PIN"
          className="w-full rounded-2xl border border-border bg-[var(--color-surface-2)] px-4 py-3 text-center text-xl font-bold tracking-[0.4em] text-text-primary outline-none focus:border-[var(--color-accent-amber)]"
        />
        {error ? (
          <p role="alert" className="text-center text-xs font-semibold text-[var(--color-accent-ink-rose)]">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
