"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";
import TextField from "@/components/ui/TextField";
import Toast from "@/components/ui/Toast";
import { verifyPinRemote, unreachableCopy } from "@/modes/kid/kid-store";

// Task 14 — the ONLY way a chat reward redemption becomes real: the reward
// OWNER lands their PIN and the chip POSTs /api/rewards/redeem, which re-reads
// the stored row for the real price and re-verifies both PINs server-side.
// Chat NEVER spends points; the tool side (propose_reward_redemption) validates
// and returns an inert proposal. Submit / wrong-PIN / unreachable /
// clear-on-close mirrors AdjustPointsChip, and the PINs live in memory only.
//
// NOT /api/consuela/planner/apply: that route's ALLOWED_TOOLS may ONLY ever
// create a calendar event or apply a PIN-confirmed point adjustment, and it
// demands a live parent session. Widening a deliberately tight allowlist to
// reach a redemption would loosen an intentional boundary.

/** The redeem route's PARENT_APPROVAL_MIN_COST, mirrored so the chip asks for a
 *  parent PIN exactly when the route will demand one — strictly greater, so a
 *  100-point reward needs no grown-up. */
const PARENT_APPROVAL_MIN_COST = 100;

export interface RewardRedemptionProposal {
  tool: "redeem_reward";
  operationId: string;
  args: { member: string; rewardId: string; reward: string; cost: number; reason: string };
}

export function isRewardRedemptionProposal(value: unknown): value is RewardRedemptionProposal {
  const p = value as RewardRedemptionProposal | null;
  return (
    !!p &&
    p.tool === "redeem_reward" &&
    typeof p.operationId === "string" &&
    p.operationId.trim() !== "" &&
    !!p.args &&
    typeof p.args.member === "string" &&
    p.args.member.trim() !== "" &&
    typeof p.args.rewardId === "string" &&
    p.args.rewardId.trim() !== "" &&
    typeof p.args.reward === "string" &&
    Number.isFinite(p.args.cost) &&
    typeof p.args.reason === "string"
  );
}

export default function RedeemRewardChip({
  proposal,
  actorName,
}: {
  proposal: RewardRedemptionProposal;
  actorName: string | null;
}) {
  const { member, reward, cost, reason } = proposal.args;
  const firstName = member.split(" ")[0];
  const needsParent = cost > PARENT_APPROVAL_MIN_COST;
  // The idempotency key, frozen at mount. The redeem route validates it first
  // and answers 409 `duplicate` on a replay, so a retry that re-read the key
  // from a changing prop could spend the points a second time.
  const operationId = useRef(
    typeof proposal.operationId === "string" ? proposal.operationId.trim() : "",
  ).current;

  const [open, setOpen] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const [parentName, setParentName] = useState("");
  const [parentPin, setParentPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

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
    // PINs cleared on close (repo rule): a typed code never outlives the dialog.
    setOpen(false);
    setPinValue("");
    setParentPin("");
    setPinError(null);
    setBusy(false);
  }, []);

  const submitPin = useCallback(async () => {
    if (busy) return;
    const pin = pinValue;
    const approval = { name: parentName.trim(), pin: parentPin };
    setPinValue("");
    setParentPin("");
    if (pin.length < 4) return;
    if (!operationId) {
      setPinError("This redemption is out of date — ask Consuela for a fresh proposal.");
      return;
    }
    if (!actorName) {
      setPinError("Sign in on this device before redeeming a reward.");
      return;
    }
    setBusy(true);
    setPinError(null);
    // UX gate only, and it checks the PIN the route will check: the reward
    // OWNER's, whoever is holding the tablet. The route re-verifies anyway.
    const verify = await verifyPinRemote(member, pin);
    if (verify.status !== "ok") {
      setBusy(false);
      setPinError(verify.status === "unreachable" ? unreachableCopy() : "Wrong PIN. Try again.");
      return;
    }
    try {
      const res = await fetch("/api/rewards/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId,
          rewardId: String(proposal.args.rewardId),
          rewardName: proposal.args.reward || null,
          memberName: member,
          pin,
          parentName: approval.name,
          parentPin: approval.pin,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setBusy(false);
        // A 401 carries two meanings here and only one of them is a wrong PIN:
        // the route also answers 401 when a high-cost reward reached it with no
        // parent approval attached, and "Wrong PIN" would send the family
        // re-typing a code that was never the problem.
        setPinError(
          data?.reason === "parent_approval_required"
            ? String(data.error || "A parent has to approve this reward.")
            : "Wrong PIN. Try again.",
        );
        return;
      }
      // A replayed operationId comes back 409 + reason:"duplicate" — the points
      // were already spent once, which is the outcome the family wanted.
      if (res.status === 409 || data?.reason === "duplicate") {
        closePin();
        setDone(true);
        showToast("Already redeemed ✓ — the points were spent once.");
        return;
      }
      if (!res.ok || !data.ok) {
        setBusy(false);
        setPinError(String(data.error || "Could not redeem that reward. Try again."));
        return;
      }
      // The route's own week read is the balance to show — re-reading points
      // here could race the write it just made.
      const spentMember = typeof data.member === "string" && data.member.trim() ? data.member.trim() : member;
      const left = data?.weekData?.points?.[spentMember];
      closePin();
      setDone(true);
      setBalance(Number.isFinite(left) ? left : null);
      showToast(Number.isFinite(left) ? `Redeemed ✓ — ${firstName} has ${left} pts left` : "Redeemed ✓");
    } catch {
      setBusy(false);
      setPinError(unreachableCopy());
    }
  }, [
    busy,
    pinValue,
    parentName,
    parentPin,
    actorName,
    member,
    firstName,
    proposal.args.rewardId,
    proposal.args.reward,
    operationId,
    closePin,
    showToast,
  ]);

  if (done) {
    return (
      <>
        <SoftButton size="sm" variant="success" disabled className="min-h-[36px]">
          {balance === null ? "Done ✓" : `Done ✓ · ${balance} pts left`}
        </SoftButton>
        <Toast open={toast !== null} tone="success">
          {toast}
        </Toast>
      </>
    );
  }

  const signed = `${reward} for ${firstName} (${cost} pts): ${reason}`;
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
        title={`Redeem ${reward}`}
        description={
          needsParent
            ? `${firstName}'s own PIN confirms it, and a parent approves it too because ${reward} costs ${cost} pts — more than ${PARENT_APPROVAL_MIN_COST}. Enter their 4-digit PIN and a parent's PIN below.`
            : `${firstName}'s own PIN confirms it: ${cost} pts come off their balance once it lands. Enter their 4-digit PIN to redeem it.`
        }
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
          <TextField
            data-testid="member-pin"
            label={`${firstName}'s PIN`}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={pinValue}
            onChange={(e) => setPinValue(e.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && pinValue.length >= 4) void submitPin();
            }}
            placeholder="4-digit PIN"
            autoFocus
            className="py-4 text-center text-2xl tracking-[0.5em]"
          />
          {needsParent && (
            <>
              <TextField
                data-testid="parent-name"
                label="Parent's name"
                autoComplete="off"
                value={parentName}
                onChange={(e) => setParentName(e.target.value)}
                placeholder="As it appears in Settings"
              />
              <TextField
                data-testid="parent-pin"
                label="Parent's PIN"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={parentPin}
                onChange={(e) => setParentPin(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="4-digit PIN"
              />
            </>
          )}
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
