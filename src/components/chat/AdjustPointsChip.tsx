"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";
import Toast from "@/components/ui/Toast";
import { verifyPinRemote, unreachableCopy } from "@/modes/kid/kid-store";

// Task 15 — the ONLY way a chat point adjustment becomes real: a parent taps
// this chip and lands their PIN. Chat NEVER moves points directly; the tool
// side (propose_point_adjustment) validates and returns an inert proposal,
// and the /api/consuela/planner/apply route re-verifies the adult PIN
// server-side. Submit / wrong-PIN / unreachable / clear-on-close behavior
// mirrors SuggestionPinModal + ConsuelaWeekCard; the PIN is kept in memory
// only and cleared when the dialog closes.

export interface PointAdjustmentProposal {
  tool: "adjust_points";
  args: { member: string; delta: number; reason: string };
}

export function isPointAdjustmentProposal(value: unknown): value is PointAdjustmentProposal {
  const p = value as PointAdjustmentProposal | null;
  return (
    !!p &&
    p.tool === "adjust_points" &&
    !!p.args &&
    typeof p.args.member === "string" &&
    p.args.member.trim() !== "" &&
    Number.isFinite(p.args.delta) &&
    typeof p.args.reason === "string"
  );
}

export default function AdjustPointsChip({
  proposal,
  actorName,
}: {
  proposal: PointAdjustmentProposal;
  actorName: string | null;
}) {
  const { member, delta, reason } = proposal.args;
  const [open, setOpen] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);
  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    []
  );

  const closePin = useCallback(() => {
    // PIN cleared on close (repo rule): the typed code never outlives the dialog.
    setOpen(false);
    setPinValue("");
    setPinError(null);
    setBusy(false);
  }, []);

  const submitPin = useCallback(async () => {
    if (busy) return;
    const pin = pinValue;
    setPinValue("");
    if (pin.length < 4) return;
    if (!actorName) {
      setPinError("Sign in with a parent PIN to confirm this adjustment.");
      return;
    }
    setBusy(true);
    setPinError(null);
    const verify = await verifyPinRemote(actorName, pin);
    if (verify.status !== "ok") {
      setBusy(false);
      setPinError(verify.status === "unreachable" ? unreachableCopy() : "Wrong PIN. Try again.");
      return;
    }
    try {
      const res = await fetch("/api/consuela/planner/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-consuela-pin": pin },
        body: JSON.stringify({ tool: "adjust_points", args: { member, delta, reason } }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setBusy(false);
        setPinError("Wrong PIN. Try again.");
        return;
      }
      // 409 = the SAME adjustment already landed moments ago (double-tap or a
      // re-confirmed stale chip). Honest "already applied": points moved once.
      if (res.status === 409) {
        closePin();
        setDone(true);
        showToast("Already applied ✓ — points moved once.");
        return;
      }
      if (!res.ok || !data.ok) {
        setBusy(false);
        setPinError(String(data.error || "Could not adjust points. Try again."));
        return;
      }
      closePin();
      setDone(true);
      showToast("Points adjusted ✓");
    } catch {
      setBusy(false);
      setPinError(unreachableCopy());
    }
  }, [busy, pinValue, actorName, member, delta, reason, closePin, showToast]);

  if (done) {
    return (
      <>
        <SoftButton size="sm" variant="success" disabled className="min-h-[36px]">
          Done ✓
        </SoftButton>
        <Toast open={toast !== null} tone="success">
          {toast}
        </Toast>
      </>
    );
  }

  const signed = `${delta > 0 ? "+" : ""}${delta} pts to ${member.split(" ")[0]}: ${reason}`;
  return (
    <>
      <SoftButton
        size="sm"
        className="min-h-[36px]"
        onClick={() => setOpen(true)}
        aria-label={`Confirm with PIN: ${signed}`}
      >
        {"\u{1F510}"} Confirm with PIN — {signed}
      </SoftButton>
      {/* Mounted with the open flag — never conditionally mount the Modal
          wrapper, so its exit animation can play (repo contract). */}
      <Modal
        open={open}
        onClose={closePin}
        title="Confirm with your PIN"
        description={`A parent's PIN moves the points: ${signed}. Enter your 4-digit PIN to apply it.`}
        footer={
          <>
            <SoftButton onClick={() => void submitPin()} disabled={pinValue.length < 4 || busy} className="flex-1">
              Submit
            </SoftButton>
            <SoftButton variant="secondary" onClick={closePin} className="flex-1">
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
              if (e.key === "Enter" && pinValue.length >= 4) void submitPin();
            }}
            placeholder="4-digit PIN"
            autoFocus
            className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-4 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-muted"
          />
          {pinError && (
            <p role="status" className="text-center text-sm text-[var(--color-accent-rose)]">
              {pinError}
            </p>
          )}
        </div>
      </Modal>
      <Toast open={toast !== null} tone="success">
        {toast}
      </Toast>
    </>
  );
}
