/* eslint-disable react-hooks/set-state-in-effect */
/**
 * RewardsShop — Where kids spend their hard-earned points on rewards.
 *
 * Parents set up rewards in Settings (e.g., "30 min screen time = 25pts",
 * "Pick a movie = 50pts", "Ice cream trip = 100pts"). Kids browse and
 * "buy" rewards with their points.
 *
 * This is the motivation engine — it turns chores into currency.
 */
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import PageShell from "@/components/ui/PageShell";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import Modal from "@/components/ui/Modal";
import Avatar from "@/components/ui/Avatar";
import IconButton from "@/components/ui/IconButton";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { db } from "@/db";
import { loadWeekData, loadRewards, saveWeekData, addTransaction, syncWeekDataToPB } from "@/lib/task-utils";
import { currentWeekPoints, verifyPinRemote, unreachableCopy } from "./kid-store";

// ─── Reward catalog ────────────────────────────────────────────────────────
// The shop reads the SAME reward list the parents manage on the Tasks page
// (task-utils loadRewards). No fabricated defaults: an empty catalog renders
// an honest empty state.

interface Reward {
  id: number | string;
  name: string;
  emoji: string;
  cost: number;
  category?: string;
}

// ─── Category Icons ─────────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  screen: { icon: "📱", label: "Screen Time", color: "rgba(59, 130, 246, 0.15)" },
  fun: { icon: "🎉", label: "Fun Activities", color: "rgba(245, 158, 11, 0.15)" },
  treat: { icon: "🍦", label: "Treats", color: "rgba(244, 63, 94, 0.15)" },
  privilege: { icon: "⭐", label: "Privileges", color: "rgba(124, 111, 247, 0.15)" },
  chore: { icon: "✅", label: "Chore Pass", color: "rgba(74, 222, 128, 0.15)" },
};

// ─── Purchase Animation ────────────────────────────────────────────────────

function PurchaseAnimation({ reward, onComplete }: { reward: Reward; onComplete: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onComplete, 2000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
      {/* Background glow */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--color-accent-amber) 12%, transparent), transparent 60%)",
          animation: "shopFlash 2s ease-out forwards",
        }}
      />

      {/* Reward card */}
      <div
        className="relative flex flex-col items-center gap-3"
        style={{ animation: "shopRewardPop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards" }}
      >
        <span className="text-7xl" style={{ filter: "drop-shadow(0 8px 16px rgba(0,0,0,0.3))" }}>
          {reward.emoji}
        </span>
        <span
          className="text-xl font-black text-text-primary"
          style={{ textShadow: "0 2px 8px rgba(0,0,0,0.2)" }}
        >
          {reward.name}
        </span>
        <span className="text-sm font-bold text-[var(--color-accent-amber)]">
          🎉 Redeemed!
        </span>
      </div>

      {/* Coins flying out */}
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = (i / 8) * Math.PI * 2;
        // Deterministic per-index jitter — Math.random() during render is a
        // purity/hydration hazard (lint react-hooks/purity).
        const spread = 40 + ((i * 37) % 40);
        const x = Math.cos(angle) * spread;
        const y = Math.sin(angle) * spread;
        return (
          <span
            key={i}
            className="absolute text-2xl"
            style={{
              animation: `shopCoin 0.8s ease-out ${i * 0.05}s forwards`,
              "--coin-x": `${x}px`,
              "--coin-y": `${y}px`,
            } as React.CSSProperties}
          >
            🪙
          </span>
        );
      })}

      <style>{`
        @keyframes shopFlash {
          0% { opacity: 0; }
          15% { opacity: 1; }
          80% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes shopRewardPop {
          0% { transform: scale(0) rotate(-10deg); opacity: 0; }
          50% { transform: scale(1.1) rotate(2deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes shopCoin {
          0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(calc(-50% + var(--coin-x)), calc(-50% + var(--coin-y))) scale(0.3); }
        }
      `}</style>
    </div>
  );
}

// ─── Reward Card ────────────────────────────────────────────────────────────

function RewardCard({
  reward, points, onPurchase,
}: {
  reward: Reward; points: number; onPurchase: (reward: Reward) => void;
}) {
  const canAfford = points >= reward.cost;
  const config = CATEGORY_CONFIG[reward.category || "fun"] || CATEGORY_CONFIG.fun;

  return (
    <button
      onClick={() => canAfford && onPurchase(reward)}
      disabled={!canAfford}
      className={`flex items-center gap-3 p-4 rounded-2xl w-full text-left transition-all ${
        canAfford ? "tap cursor-pointer" : "opacity-50 cursor-not-allowed"
      }`}
      style={{
        background: canAfford
          ? `linear-gradient(135deg, ${config.color}, rgba(255,255,255,0.03))`
          : "rgba(255,255,255,0.03)",
        border: canAfford
          ? "1px solid rgba(255,255,255,0.12)"
          : "1px solid rgba(255,255,255,0.06)",
      }}
      aria-label={`${reward.name} — ${reward.cost} points${canAfford ? "" : " — not enough points"}`}
    >
      <div
        className="w-14 h-14 rounded-2xl grid place-items-center text-2xl shrink-0"
        style={{
          background: config.color,
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {reward.emoji}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className={`text-sm font-bold ${canAfford ? "text-text-primary" : "text-text-muted"}`}>
          {reward.name}
        </h3>
        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
          {config.label}
        </span>
      </div>
      <div
        className="shrink-0 flex flex-col items-center justify-center w-16 h-12 rounded-xl"
        style={{
          background: canAfford ? "color-mix(in srgb, var(--color-accent-amber) 12%, transparent)" : "rgba(255,255,255,0.03)",
          border: canAfford ? "1px solid color-mix(in srgb, var(--color-accent-amber) 20%, transparent)" : "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <span className={`text-base font-black tabular-nums ${canAfford ? "text-[var(--color-accent-amber)]" : "text-text-muted"}`}>
          {reward.cost}
        </span>
        <span className="text-[11px] text-text-muted font-bold -mt-0.5">pts</span>
      </div>
    </button>
  );
}

// ─── Purchase History ───────────────────────────────────────────────────────

function PurchaseHistory({ redemptions }: { redemptions: { description: string; timestamp: string }[] }) {
  if (redemptions.length === 0) return null;

  return (
    <div>
      <h3 className="text-sm font-bold text-text-primary mb-2">🧾 Recently Redeemed</h3>
      <div className="space-y-1.5">
        {redemptions.slice(-5).reverse().map((r, i) => (
          <div
            key={`${r.timestamp}-${i}`}
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl opacity-60"
            style={{ background: "color-mix(in srgb, var(--color-accent-mint) 5%, transparent)", border: "1px solid color-mix(in srgb, var(--color-accent-mint) 10%, transparent)" }}
          >
            <span className="text-lg">🎁</span>
            <span className="text-xs text-text-secondary flex-1 truncate">{r.description.replace(/^Redeemed: /, "")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function RewardsShop() {
  const { currentUser } = useAuth();
  const router = useRouter();
  const [points, setPoints] = useState(0);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [redemptions, setRedemptions] = useState<{ description: string; timestamp: string }[]>([]);
  const [purchasing, setPurchasing] = useState<Reward | null>(null);
  // Redemption PIN gate — same server-verified flow as the Tasks page. The
  // typed PIN lives in state only and is cleared after every attempt.
  const [pinReward, setPinReward] = useState<Reward | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  // Large-reward (>100pts) parent-approval gate — same flow as the Tasks
  // page: a parent PIN unlocks the redemption BEFORE the kid's own PIN step.
  const [parentApprovalReward, setParentApprovalReward] = useState<Reward | null>(null);
  const [parentApprovalPin, setParentApprovalPin] = useState("");
  const [parentApprovalError, setParentApprovalError] = useState("");
  // The wrong-PIN nudge auto-clears; the timer must die with the component
  // (an unmounted setState was the review finding).
  const approvalErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (approvalErrorTimer.current) clearTimeout(approvalErrorTimer.current);
    };
  }, []);

  const POINTS_PER_LEVEL = 50;
  const level = Math.floor(points / POINTS_PER_LEVEL) + 1;
  const firstName = currentUser?.name?.split(" ")[0] || "Buddy";

  // One truth with the Tasks page: catalog from loadRewards, balance from
  // the weekData ledger, history from its redeem transactions.
  const refresh = useCallback(() => {
    if (!currentUser) return;
    const week = loadWeekData();
    const { points: pts, key } = currentWeekPoints(currentUser.name);
    setPoints(pts);
    setRedemptions(
      week.history
        .filter((tx: any) => tx.type === "redeem" && (tx.member === key || tx.member?.split(" ")[0] === key.split(" ")[0]))
        .map((tx: any) => ({ description: tx.description, timestamp: tx.timestamp }))
    );
    setRewards(loadRewards<Reward[]>([]));
  }, [currentUser]);

  useEffect(() => {
    refresh();
    const onRefreshed = () => refresh();
    window.addEventListener("consuela-data-refreshed", onRefreshed);
    return () => window.removeEventListener("consuela-data-refreshed", onRefreshed);
  }, [refresh]);

  const openRedeem = useCallback((reward: Reward) => {
    // Same gate as the Tasks page: big rewards (>100pts) need a parent PIN
    // BEFORE the kid's own redemption PIN step.
    if (reward.cost > 100) {
      setParentApprovalReward(reward);
      setParentApprovalPin("");
      setParentApprovalError("");
      return;
    }
    setPinReward(reward);
    setPin("");
    setPinError("");
  }, []);

  const approveParentReward = async () => {
    if (!parentApprovalReward || !parentApprovalPin || pinBusy) return;
    setPinBusy(true);
    try {
      let parent: any = null;
      for (const m of db.selectMembers().filter((m: any) => m.role === "parent")) {
        const result = await verifyPinRemote(m.fullName, parentApprovalPin);
        if (result.status === "unreachable") {
          // The server never answered — say so instead of blaming the PIN.
          setParentApprovalError(unreachableCopy());
          setParentApprovalPin("");
          return;
        }
        if (result.status === "ok") {
          parent = m;
          break;
        }
      }
      if (!parent) {
        setParentApprovalError("Parent PIN required to approve large rewards.");
        setParentApprovalPin("");
        if (approvalErrorTimer.current) clearTimeout(approvalErrorTimer.current);
        approvalErrorTimer.current = setTimeout(() => setParentApprovalError(""), 2500);
        return;
      }
      // Approved — hand off to the normal kid-PIN redemption step.
      setPinReward(parentApprovalReward);
      setParentApprovalReward(null);
      setParentApprovalPin("");
      setParentApprovalError("");
      setPin("");
      setPinError("");
    } finally {
      setPinBusy(false);
    }
  };

  const closeRedeem = useCallback(() => {
    setPinReward(null);
    setPin("");
    setPinError("");
  }, []);

  const submitRedeem = async () => {
    if (!pinReward || !currentUser || pinBusy || pin.length < 4) return;
    setPinBusy(true);
    const reward = pinReward;
    try {
      const result = await verifyPinRemote(currentUser.name, pin);
      if (result.status === "wrongPin") {
        setPinError("Wrong PIN. Try again.");
        setPin("");
        return;
      }
      if (result.status === "unreachable") {
        // Network/5xx is not a wrong PIN — give the honest offline-vs-server
        // copy and clear the typed PIN.
        setPinError(unreachableCopy());
        setPin("");
        return;
      }
      const week = loadWeekData();
      const { points: nowPoints, key } = currentWeekPoints(currentUser.name);
      if (nowPoints < reward.cost) {
        setPinError(`Not enough points — ${reward.name} costs ${reward.cost}pts, you have ${nowPoints}pts.`);
        setPin("");
        return;
      }
      const updated = addTransaction(
        { ...week, points: { ...week.points, [key]: nowPoints - reward.cost } },
        "redeem",
        -reward.cost,
        `Redeemed: ${reward.name} (-${reward.cost}pts)`,
        key
      );
      saveWeekData(updated);
      void syncWeekDataToPB(updated);
      setPinReward(null);
      setPin("");
      setPoints(nowPoints - reward.cost);
      refresh();
      setPurchasing(reward);
    } finally {
      setPinBusy(false);
    }
  };

  // Group rewards by category (Tasks-page rewards carry no category — they
  // land in the Fun group).
  const categories = Object.keys(CATEGORY_CONFIG);
  const rewardsByCategory = categories.map((cat) => ({
    category: cat,
    config: CATEGORY_CONFIG[cat],
    items: rewards.filter((r) => (r.category || "fun") === cat),
  })).filter((group) => group.items.length > 0);

  return (
    <PageShell>
      {/* Purchase animation overlay — fires only AFTER a PIN-verified redeem */}
      {purchasing && (
        <PurchaseAnimation reward={purchasing} onComplete={() => setPurchasing(null)} />
      )}

      {/* Header */}
      <div className="px-4 pt-8 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <IconButton size="sm" variant="ghost" aria-label="Back" onClick={() => router.back()}>
            <span>←</span>
          </IconButton>
          <h1 className="text-lg font-bold text-text-primary">🏪 Reward Shop</h1>
        </div>
      </div>

      {/* Points banner */}
      <div className="px-4 mb-5">
        <Surface variant="warm" radius="2xl" padding="lg">
          <div className="flex items-center gap-4">
            <Avatar
              name={currentUser?.name || "Buddy"}
              color={currentUser?.color || "green"}
              emoji={currentUser?.emoji || "😊"}
              size="md"
              variant="emoji"
              glow
            />
            <div className="flex-1">
              <h2 className="text-base font-bold text-text-primary">Hey {firstName}!</h2>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-3xl font-black text-[var(--color-accent-amber)] tabular-nums">{points}</span>
                <span className="text-sm text-text-secondary font-semibold">points</span>
                <span className="text-xs text-text-muted">· Level {level}</span>
              </div>
            </div>
          </div>
        </Surface>
      </div>

      {/* Rewards by category */}
      <div className="px-4 space-y-5 pb-8">
        {rewardsByCategory.length === 0 ? (
          <Surface variant="warm" radius="2xl" padding="lg">
            <div className="text-center py-6">
              <span className="text-4xl mb-3 block">🛍️</span>
              <h3 className="text-base font-bold text-text-primary">No rewards yet</h3>
              <p className="text-sm text-text-secondary mt-1">
                Ask a parent to add rewards on the Tasks page — they&apos;ll show up here.
              </p>
            </div>
          </Surface>
        ) : (
          rewardsByCategory.map((group) => (
            <div key={group.category}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">{group.config.icon}</span>
                <h3 className="text-base font-bold text-text-primary">{group.config.label}</h3>
                <span className="text-[11px] text-text-muted font-semibold">{group.items.length} available</span>
              </div>
              <div className="space-y-2">
                {group.items.map((reward) => (
                  <RewardCard
                    key={reward.id}
                    reward={reward}
                    points={points}
                    onPurchase={openRedeem}
                  />
                ))}
              </div>
            </div>
          ))
        )}

        {/* Purchase history */}
        <PurchaseHistory redemptions={redemptions} />

        {/* Info card */}
        <Surface variant="glass-subtle" radius="xl" padding="md">
          <div className="flex items-start gap-3">
            <span className="text-xl shrink-0">💡</span>
            <div>
              <h4 className="text-sm font-bold text-text-primary">How it works</h4>
              <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                Complete quests to earn points. Spend your points here to unlock fun rewards!
                Ask a parent to approve your redemption.
              </p>
            </div>
          </div>
        </Surface>
      </div>

      {/* Redemption PIN gate (server-verified, never persisted) */}
      <Modal
        open={pinReward !== null}
        onClose={closeRedeem}
        title="Redeem with your PIN"
        description={pinReward ? `Enter your PIN to redeem "${pinReward.name}" for ${pinReward.cost} points` : ""}
        footer={
          <>
            <SoftButton variant="secondary" className="flex-1" onClick={closeRedeem}>
              Cancel
            </SoftButton>
            <SoftButton
              className="flex-1"
              loading={pinBusy}
              disabled={pin.length < 4 || pinBusy}
              onClick={submitRedeem}
            >
              Redeem
            </SoftButton>
          </>
        }
      >
        <div className="space-y-3">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, ""));
              setPinError("");
            }}
            onKeyDown={(e) => { if (e.key === "Enter") submitRedeem(); }}
            aria-label="Your 4-digit PIN"
            className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-center text-2xl font-bold tracking-[0.5em] text-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-selected)]"
          />
          {pinError && <p className="text-xs text-[var(--color-accent-rose)]" role="alert">{pinError}</p>}
        </div>
      </Modal>

      {/* Parent approval gate for >100pt rewards (same flow as the Tasks page) */}
      {parentApprovalReward && (
        <Modal
          open
          onClose={() => { setParentApprovalReward(null); setParentApprovalPin(""); }}
          title="Parent Approval Required"
          description={`"${parentApprovalReward.name}" costs ${parentApprovalReward.cost}pts — needs a parent PIN to unlock.`}
          footer={
            <>
              <SoftButton variant="secondary" onClick={() => { setParentApprovalReward(null); setParentApprovalPin(""); }} className="flex-1">
                Cancel
              </SoftButton>
              <SoftButton onClick={approveParentReward} loading={pinBusy} disabled={!parentApprovalPin || pinBusy} className="flex-1">
                Approve
              </SoftButton>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">Large rewards (&gt;100pts) require a parent to approve. Enter a parent PIN to continue.</p>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={parentApprovalPin}
              onChange={(e) => { setParentApprovalPin(e.target.value.replace(/[^0-9]/g, "")); setParentApprovalError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") approveParentReward(); }}
              placeholder="Parent PIN"
              aria-label="Parent PIN"
              autoFocus
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-4 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-muted"
            />
            {parentApprovalError && <p className="text-center text-sm text-[var(--color-accent-rose)]" role="alert">{parentApprovalError}</p>}
          </div>
        </Modal>
      )}
    </PageShell>
  );
}
