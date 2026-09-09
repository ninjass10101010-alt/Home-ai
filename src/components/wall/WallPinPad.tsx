"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import Avatar from "@/components/ui/Avatar";

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

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/40 p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Sign in as ${member.name}`}
        onClick={(e) => e.stopPropagation()}
        className="material-thick w-full max-w-xl rounded-[2rem] border border-white/12 p-8 shadow-2xl"
      >
        <div className="flex flex-col items-center gap-3">
          <Avatar name={member.name} color={member.color || "green"} emoji={member.emoji} size="lg" variant="emoji" />
          <p className="text-2xl font-bold tracking-tight text-text-primary">Hi {member.name.split(" ")[0]} 👋</p>
          <p className="text-base text-text-secondary">Enter your 4-digit PIN</p>
          <div className="flex gap-3 py-2 text-3xl tracking-[0.5em] text-text-primary" aria-label={`${pin.length} of 4 digits entered`}>
            {pin.padEnd(4, " ").split("").map((c, i) => (
              <span key={i}>{c.trim() ? "●" : "·"}</span>
            ))}
          </div>
          {error && <p className="text-center text-base font-semibold text-[var(--color-accent-rose)]" role="alert">{error}</p>}
        </div>
        <div className="mt-6 grid grid-cols-3 gap-4">
          {keys.map((k) => (
            <button
              key={k}
              type="button"
              aria-label={k === "⌫" ? "Backspace" : k}
              onClick={() => onKey(k)}
              disabled={busy}
              className="tap grid h-[72px] place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-2xl font-bold text-text-primary hover:bg-white/[0.12] disabled:opacity-50"
            >
              {k === "⌫" ? "⌫" : k}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="tap mt-6 h-16 w-full rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/35 text-lg font-semibold text-text-secondary hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
