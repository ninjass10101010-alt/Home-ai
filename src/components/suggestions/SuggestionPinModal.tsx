"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";
import { useAuth } from "@/hooks/useAuth";

// C3 — shared PIN gate for the suggestions write routes (PATCH + POST /act).
// Mirrors the tasks-page PIN modal pattern (Modal + numeric 4-digit input +
// submit/cancel footer). Rendered by HomeSuggestionsWidget and /suggestions
// when useSuggestions exposes needsPin=true; the submitted PIN is kept in
// memory only (never persisted) and retried against the queued action.
function PinModalInner({
  error,
  onClose,
  onSubmit,
}: {
  error: string | null;
  onClose: () => void;
  onSubmit: (pin: string) => void;
}) {
  const [pinValue, setPinValue] = useState("");
  const { isLoggedIn } = useAuth();

  const submit = () => {
    const raw = pinValue;
    if (raw.length < 4) return;
    setPinValue("");
    onSubmit(raw);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Enter a PIN"
      description={
        isLoggedIn
          ? "Actions on suggestions are protected. Enter your 4-digit PIN to continue."
          : "Suggestions actions are protected. Enter any family member's 4-digit PIN to continue."
      }
      footer={
        <>
          <SoftButton onClick={submit} disabled={pinValue.length < 4} className="flex-1">
            Submit
          </SoftButton>
          <SoftButton variant="secondary" onClick={onClose} className="flex-1">
            Cancel
          </SoftButton>
        </>
      }
    >
      <div className="space-y-4">
        <input
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pinValue}
          onChange={(e) => setPinValue(e.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="4-digit PIN"
          autoFocus
          className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-4 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-muted"
        />
        {error && <p className="text-center text-sm text-rose-300">{error}</p>}
      </div>
    </Modal>
  );
}

export default function SuggestionPinModal({
  open,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (pin: string) => void;
}) {
  if (!open) return null;
  // fresh mount per open so the input always starts empty
  return <PinModalInner key="pin" error={error} onClose={onClose} onSubmit={onSubmit} />;
}
