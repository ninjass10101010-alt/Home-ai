"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/hooks/useAuth";
import Avatar from "@/components/ui/Avatar";
import useDialogA11y from "@/components/ui/useDialogA11y";

const WRONG_PIN_COPY = "Wrong PIN — try again.";
const UNREACHABLE_COPY = "Couldn't reach Consuela — check the connection and try again.";

/** Wall-scale PIN pad: member header, big dots, 4×3 keypad with ≥64px keys.
 *  Verification stays server-side via useAuth().login (POST /api/auth/login);
 *  the PIN is never stored client-side. Honest failures per spec §6.
 *
 *  Network-failure note: useAuth().login RESOLVES `{ success: false, error: "Network error" }`
 *  on a failed fetch (src/hooks/useAuth.tsx:296) — it does not reject. Both the
 *  resolved "Network error" shape and a genuine promise rejection surface the
 *  honest unreachable copy.
 *
 *  onVerify seam (spec §6 amendment, "Kid mode on the wall"): when provided,
 *  the pad does NOT sign in — the caller (e.g. KidHome's quest gate) owns the
 *  verification and receives the typed code. Outcomes: ok → onSuccess;
 *  !ok → the caller's error string verbatim (or WRONG_PIN_COPY when absent);
 *  a literal "Network error" or a thrown rejection → the honest unreachable
 *  copy. Input clears on every failure. */
export default function WallPinPad({
  member,
  onClose,
  onSuccess,
  onVerify,
}: {
  member: { name: string; emoji: string; color?: string };
  onClose: () => void;
  onSuccess: () => void;
  onVerify?: (pin: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const { login } = useAuth();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Rendered only while the pad is up. Escape must not dismiss a verification
  // still in flight — the caller may be arming an alarm behind it.
  const panelRef = useDialogA11y<HTMLDivElement>({ active: true, onClose, escapeDisabled: busy });

  const submit = async (code: string) => {
    setBusy(true);
    setError(null);
    try {
      if (onVerify) {
        const res = await onVerify(code);
        if (res.ok) {
          setPin("");
          onSuccess();
          return;
        }
        setError(res.error === "Network error" ? UNREACHABLE_COPY : res.error ?? WRONG_PIN_COPY);
        setPin("");
        return;
      }
      const res = await login(member.name, code);
      if (res.success) {
        setPin("");
        onSuccess();
        return;
      }
      if (res.error === "Network error") setError(UNREACHABLE_COPY);
      else setError(WRONG_PIN_COPY);
      setPin("");
    } catch {
      setError(UNREACHABLE_COPY);
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  const press = (d: string) => {
    if (busy) return;
    setError(null);
    const next = (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4) void submit(next);
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "Clear", "0", "⌫"];

  const onKey = (k: string) => {
    if (k === "Clear") { setPin(""); setError(null); return; }
    if (k === "⌫") { setPin(pin.slice(0, -1)); return; }
    press(k);
  };

  // Portaled to <body>: rendered inline this overlay inherited PageShell's
  // `relative z-10` <main> stacking context, so the portaled z-50 CapsuleNav
  // painted straight over it — on the wall and on phones the dock swallowed
  // the sheet's own footer. A z index only means anything at body level.
  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/55 p-6 backdrop-blur-md" onClick={onClose}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Sign in as ${member.name}`}
        onClick={(e) => e.stopPropagation()}
        className="material-thick w-full max-w-xl rounded-2xl border border-white/12 p-6 shadow-2xl outline-none lg:max-w-3xl lg:p-8"
        style={{ background: "color-mix(in srgb, var(--color-surface-1) 94%, transparent)" }}
      >
        {/* On the wall (>=lg) the pad goes side-by-side: the 72px keys are
            pinned by the wall control floor, so a single 576px column left them
            2.2:1 wide in a card that read as a postage stamp on a 1920 screen.
            Beside the identity block the keys land near 1.3:1 and the panel
            claims the width it is entitled to. Phones keep the stacked column. */}
        <div className="flex flex-col lg:grid lg:grid-cols-[auto_auto] lg:justify-center lg:items-center lg:gap-14">
          <div className="flex flex-col items-center gap-3 lg:items-start lg:gap-4">
            <Avatar name={member.name} color={member.color || "green"} emoji={member.emoji} size="lg" variant="emoji" />
            <p className="text-2xl font-bold tracking-tight text-text-primary lg:text-4xl">Hi {member.name.split(" ")[0]} 👋</p>
            <p className="text-base text-text-secondary lg:text-xl">Enter your 4-digit PIN</p>
            <div className="flex gap-3 py-1 lg:gap-4 lg:py-2" aria-label={`${pin.length} of 4 digits entered`}>
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  aria-hidden="true"
                  className={`grid h-11 w-11 place-items-center rounded-xl border text-xl transition-colors lg:h-14 lg:w-14 lg:text-3xl ${
                    i < pin.length
                      ? "border-[var(--color-accent-selected)] bg-[color-mix(in_srgb,var(--color-accent-selected)_18%,transparent)] text-[var(--color-accent-selected)]"
                      : "border-[color-mix(in_srgb,var(--color-text-primary)_16%,transparent)]"
                  }`}
                >
                  {i < pin.length ? "●" : null}
                </span>
              ))}
            </div>
            {error && <p className="text-center text-base font-semibold text-[var(--color-accent-rose)] lg:text-left" role="alert">{error}</p>}
          </div>
          <div className="mt-6 w-full lg:mt-0 lg:w-auto">
            <div className="grid grid-cols-3 gap-3 lg:gap-4">
              {keys.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-label={k === "⌫" ? "Backspace" : k}
                  onClick={() => onKey(k)}
                  disabled={busy}
                  className={`tap grid h-[72px] place-items-center rounded-2xl border border-[color-mix(in_srgb,var(--color-text-primary)_14%,transparent)] bg-[color-mix(in_srgb,var(--color-text-primary)_7%,transparent)] font-bold text-text-primary hover:bg-[color-mix(in_srgb,var(--color-text-primary)_13%,transparent)] disabled:opacity-50 ${
                k === "Clear" ? "text-xl lg:text-2xl" : "text-2xl lg:text-4xl"
              }`}
                >
                  {k === "⌫" ? "⌫" : k}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="tap mt-4 h-16 w-full rounded-2xl border border-[color-mix(in_srgb,var(--color-text-primary)_14%,transparent)] bg-[color-mix(in_srgb,var(--color-text-primary)_7%,transparent)] text-lg font-semibold text-text-secondary hover:bg-[color-mix(in_srgb,var(--color-text-primary)_13%,transparent)] hover:text-text-primary lg:mt-6 lg:text-2xl"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
    ,
    document.body
  );
}
