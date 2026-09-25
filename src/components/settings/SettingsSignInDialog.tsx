"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";
import { useAuth } from "@/hooks/useAuth";

export interface SettingsSignInDialogProps {
  open: boolean;
  memberName: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SettingsSignInDialog({
  open,
  memberName,
  onClose,
  onSuccess,
}: SettingsSignInDialogProps) {
  const { login } = useAuth();
  const inputId = useId();
  const helperId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  const clearPin = () => {
    setPin("");
    setError(null);
    busyRef.current = false;
    setBusy(false);
  };

  const handleClose = () => {
    if (busyRef.current) return;
    requestRef.current += 1;
    clearPin();
    onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!memberName || pin.length !== 4 || busy || busyRef.current) return;

    requestRef.current += 1;
    const requestId = requestRef.current;
    busyRef.current = true;
    const isCurrentRequest = () =>
      mountedRef.current && requestRef.current === requestId;

    setBusy(true);
    setError(null);
    inputRef.current?.focus();

    try {
      const result = await login(memberName, pin);
      if (!isCurrentRequest()) return;

      if (result.success) {
        requestRef.current += 1;
        clearPin();
        onSuccess();
        return;
      }

      setPin("");
      setError(result.error || "Sign-in failed. Try again.");
    } catch {
      if (!isCurrentRequest()) return;
      setPin("");
      setError("Couldn't reach Consuela — check the connection and try again.");
    } finally {
      if (isCurrentRequest()) {
        busyRef.current = false;
        setBusy(false);
        inputRef.current?.focus();
      }
    }
  };

  const firstName = memberName?.split(" ")[0] || "yourself";

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`Sign in as ${firstName}`}
      description="Enter your 4-digit PIN to continue."
      panelClassName="settings-dialog"
      footer={
        <>
          <SoftButton
            variant="secondary"
            className="flex-1"
             onClick={handleClose}
             disabled={busy}
             aria-label="Cancel sign in"
          >
            Cancel
          </SoftButton>
          <SoftButton
            type="submit"
            form="settings-sign-in-form"
            className="flex-1"
            loading={busy}
            disabled={!memberName || pin.length !== 4 || busy}
          >
            Sign in
          </SoftButton>
        </>
      }
    >
      <form id="settings-sign-in-form" onSubmit={handleSubmit} aria-busy={busy} className="space-y-3">
        <label htmlFor={inputId} className="block text-sm font-semibold text-text-primary">
          4-digit PIN
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          value={pin}
          onChange={(event) => {
            setPin(event.target.value.replace(/\D/g, "").slice(0, 4));
            setError(null);
          }}
          readOnly={busy}
          aria-readonly={busy}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${helperId} ${errorId}` : helperId}
          className="w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-center text-2xl tracking-[0.4em] text-text-primary outline-none placeholder:text-text-muted focus:border-[var(--color-accent-selected)]"
          placeholder="••••"
          autoFocus
        />
        <p id={helperId} className="text-xs leading-5 text-text-secondary">
          Your PIN is used only to sign in and is cleared from this form after a failed attempt.
        </p>
        {error ? (
          <p id={errorId} role="alert" className="text-sm font-semibold text-[var(--color-accent-rose)]">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
