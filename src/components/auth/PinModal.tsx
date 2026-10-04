"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/hooks/useAuth";
import SigmaImage from "@/components/ui/SigmaImage";
import useDialogA11y from "@/components/ui/useDialogA11y";

interface PinModalProps {
  memberName: string;
  memberEmoji: string;
  memberColor: string;
  onClose: () => void;
  onSuccess?: () => void;
}

const colorVarMap: Record<string, string> = {
  green: "mint",
  violet: "violet",
  amber: "amber",
  cyan: "cyan",
  rose: "rose",
  blue: "nori",
};

export default function PinModal({ memberName, memberEmoji, memberColor, onClose, onSuccess }: PinModalProps) {
  const { login } = useAuth();
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const accentVar = colorVarMap[memberColor || "green"] || memberColor || "green";
  const safeEmoji = memberEmoji || "😊";
  const safeName = memberName || "User";

  // This component only renders while the pad is up, so the trap is always on.
  const panelRef = useDialogA11y<HTMLDivElement>({ active: true, onClose, escapeDisabled: loading });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    if (pinInput.length < 4 || loading) return;
    setLoading(true);
    setPinError("");

    const result = await login(safeName, pinInput);
    if (result.success) {
      onSuccess?.();
    } else {
      setPinError(result.error || "Incorrect PIN");
      setPinInput("");
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  // Portaled to <body> at z-[80] with the same surface recipe as the shared
  // Modal: inline at z-50 this scrim sat inside PageShell's `relative z-10`
  // stacking context, so the portaled CapsuleNav stayed bright and untappable
  // *on top of* the dimmed page instead of behind it — and the opaque
  // `bg-surface-0` card read as a black hole punched in the warm glass.
  return createPortal(
    <div
      ref={panelRef}
      tabIndex={-1}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4 backdrop-blur-md outline-none" role="dialog" aria-modal="true" aria-label="PIN entry"
      onClick={onClose}
    >
      <div
        className="material-thick flex w-full max-w-sm flex-col rounded-xl border border-white/12 p-5 shadow-2xl"
        style={{ background: "color-mix(in srgb, var(--color-surface-1) 94%, transparent)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 text-center">
          <div
            className="mx-auto grid h-16 w-16 place-items-center overflow-hidden rounded-full border-2 text-3xl transition-transform duration-200"
            style={{
              backgroundColor: `color-mix(in srgb, var(--color-accent-${accentVar}) 20%, transparent)`,
              // The old `ring-2` had no ring colour, so Tailwind's currentColor
              // default painted every member's halo white — the per-member
              // accent was invisible. A real border plus an accent halo says
              // whose card this is.
              borderColor: `var(--color-accent-${accentVar})`,
              boxShadow: `0 0 0 5px color-mix(in srgb, var(--color-accent-${accentVar}) 16%, transparent)`,
            }}
          >
            {safeEmoji.startsWith("data:") || safeEmoji.startsWith("http") ? (
              <SigmaImage src={safeEmoji} alt={safeName} shape="circle" />
            ) : (
              safeEmoji
            )}
          </div>
          <h3 className="mt-4 text-lg font-bold text-text-primary">Welcome, {safeName.split(" ")[0]}!</h3>
          <p className="mt-1 text-sm text-text-secondary">Enter your PIN to continue</p>
        </div>

        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pinInput}
          onChange={(e) => {
            setPinInput(e.target.value.replace(/[^0-9]/g, ""));
            setPinError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          placeholder="4-digit PIN"
          aria-label="4-digit PIN"
          /* `indent` re-centres the value: letter-spacing adds a trailing gap
             after the last digit, so a centred tracked field sits half a
             character to the left of true centre. The placeholder opts out of
             the tracking — at 0.5em the hyphen in "4-digit" reads as a minus. */
          className="w-full rounded-lg border-2 border-surface-3 bg-surface-2 px-4 py-3 text-center text-2xl tracking-[0.5em] indent-[0.5em] text-text-primary outline-none placeholder:text-base placeholder:tracking-normal placeholder:indent-0 placeholder:text-text-muted disabled:opacity-60"
          autoFocus
          disabled={loading}
        />

        {pinError && (
          <p className="mt-2 text-center text-xs text-[var(--color-accent-rose)] animate-in" role="alert">{pinError}</p>
        )}

        <div className="mt-5 flex gap-2">
          {/* `--color-accent-button` (accent mixed 60% toward black) instead of
              the hardcoded `bg-nori-500`: white on #3b82f6 is 3.68:1 and fails
              AA, and it ignored the active theme accent entirely. */}
          <button
            onClick={handleSubmit}
            disabled={pinInput.length < 4 || loading}
            className="tap min-h-11 flex-1 rounded-lg bg-[var(--color-accent-button)] font-semibold text-sm text-white transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Verifying..." : "Sign In"}
          </button>
          <button
            onClick={onClose}
            className="tap min-h-11 flex-1 rounded-lg bg-surface-2 font-medium text-sm text-text-secondary transition-colors hover:text-text-primary"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
