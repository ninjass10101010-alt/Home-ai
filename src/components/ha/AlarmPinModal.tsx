"use client";

import { useEffect, useRef, useState } from "react";

interface AlarmPinModalProps {
  action: "arm_home" | "disarm";
  onSubmit: (pin: string) => Promise<boolean>;
  onClose: () => void;
}

/** Human-only confirmation for alarm arm/disarm. Asks for any family-member
 * PIN; the server verifies it before Home Assistant is touched. */
export default function AlarmPinModal({ action, onSubmit, onClose }: AlarmPinModalProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const label = action === "disarm" ? "Disarm" : "Arm home";

  const handleSubmit = async () => {
    if (pin.length < 4 || loading) return;
    setLoading(true);
    setError("");
    const ok = await onSubmit(pin);
    if (ok) {
      onClose();
      return;
    }
    setLoading(false);
    setPin("");
    setError("Incorrect PIN");
    inputRef.current?.focus();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={loading ? undefined : onClose}
    >
      <div
        className="mx-4 w-full max-w-sm rounded-2xl border border-surface-3 bg-surface-0 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-accent-rose)]/15 text-3xl">
            {action === "disarm" ? "🔓" : "🛡️"}
          </div>
          <h3 className="mt-3 text-lg font-semibold text-text-primary">{label} alarm</h3>
          <p className="mt-1 text-sm text-text-secondary">
            Enter a family PIN to {action === "disarm" ? "disarm" : "arm"} the alarm system.
          </p>
        </div>

        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={(e) => {
            setPin(e.target.value.replace(/[^0-9]/g, ""));
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSubmit();
          }}
          placeholder="4-digit PIN"
          disabled={loading}
          className="mt-4 w-full rounded-2xl border-2 border-surface-3 bg-surface-2 px-4 py-3 text-center text-2xl tracking-[0.5em] text-text-primary outline-none focus:border-nori-500/50 placeholder:text-text-muted"
        />

        {error && (
          <p className="mt-2 animate-in text-center text-xs text-rose-400">{error}</p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 rounded-2xl border border-white/10 py-2.5 text-sm font-semibold text-text-secondary transition-colors hover:bg-white/5 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={pin.length < 4 || loading}
            className={`flex-1 rounded-2xl py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-40 ${
              action === "disarm" ? "bg-rose-500 hover:bg-rose-400" : "bg-nori-500 hover:bg-nori-400"
            }`}
          >
            {loading ? "Verifying…" : `Confirm ${label}`}
          </button>
        </div>
      </div>
    </div>
  );
}
