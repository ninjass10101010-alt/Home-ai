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

import { useState, useEffect, useCallback } from "react";
import PageShell from "@/components/ui/PageShell";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import Avatar from "@/components/ui/Avatar";
import IconButton from "@/components/ui/IconButton";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";

// ─── Default Rewards (shown when parents haven't set any) ──────────────────

const DEFAULT_REWARDS: Reward[] = [
  { id: "screen-30", name: "30 min screen time", emoji: "📱", cost: 25, category: "screen" },
  { id: "pick-movie", name: "Pick movie night", emoji: "🎬", cost: 50, category: "fun" },
  { id: "ice-cream", name: "Ice cream trip", emoji: "🍦", cost: 100, category: "treat" },
  { id: "stay-up", name: "Stay up 30 min late", emoji: "🌙", cost: 75, category: "privilege" },
  { id: "skip-chore", name: "Skip one chore", emoji: "⏭️", cost: 60, category: "chore" },
  { id: "game-time", name: "Family game night", emoji: "🎮", cost: 80, category: "fun" },
  { id: "bake", name: "Bake something together", emoji: "🧁", cost: 40, category: "fun" },
  { id: "sleepover", name: "Sleepover with friend", emoji: "🏠", cost: 200, category: "privilege" },
];

interface Reward {
  id: string;
  name: string;
  emoji: string;
  cost: number;
  category: string;
}

interface Purchase {
  rewardId: string;
  timestamp: string;
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
          background: "radial-gradient(circle at 50% 50%, rgba(251, 191, 36, 0.12), transparent 60%)",
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
        <span className="text-sm font-bold text-amber-400">
          🎉 Redeemed!
        </span>
      </div>

      {/* Coins flying out */}
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = (i / 8) * Math.PI * 2;
        const x = Math.cos(angle) * (40 + Math.random() * 40);
        const y = Math.sin(angle) * (40 + Math.random() * 40);
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
  const config = CATEGORY_CONFIG[reward.category] || CATEGORY_CONFIG.fun;

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
        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
          {config.label}
        </span>
      </div>
      <div
        className="shrink-0 flex flex-col items-center justify-center w-16 h-12 rounded-xl"
        style={{
          background: canAfford ? "rgba(251, 191, 36, 0.12)" : "rgba(255,255,255,0.03)",
          border: canAfford ? "1px solid rgba(251, 191, 36, 0.2)" : "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <span className={`text-base font-black tabular-nums ${canAfford ? "text-amber-400" : "text-text-muted"}`}>
          {reward.cost}
        </span>
        <span className="text-[8px] text-text-muted font-bold -mt-0.5">pts</span>
      </div>
    </button>
  );
}

// ─── Purchase History ───────────────────────────────────────────────────────

function PurchaseHistory({ purchases, rewards }: { purchases: Purchase[]; rewards: Reward[] }) {
  if (purchases.length === 0) return null;

  const getReward = (id: string) => rewards.find((r) => r.id === id);

  return (
    <div>
      <h3 className="text-sm font-bold text-text-primary mb-2">🧾 Recently Redeemed</h3>
      <div className="space-y-1.5">
        {purchases.slice(-5).reverse().map((purchase, i) => {
          const reward = getReward(purchase.rewardId);
          if (!reward) return null;
          return (
            <div
              key={i}
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl opacity-60"
              style={{ background: "rgba(74, 222, 128, 0.05)", border: "1px solid rgba(74, 222, 128, 0.1)" }}
            >
              <span className="text-lg">{reward.emoji}</span>
              <span className="text-xs text-text-secondary flex-1 truncate">{reward.name}</span>
              <span className="text-[10px] text-amber-400 font-bold tabular-nums">-{reward.cost}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function RewardsShop() {
  const { currentUser } = useAuth();
  const router = useRouter();
  const [points, setPoints] = useState(0);
  const [rewards, setRewards] = useState<Reward[]>(DEFAULT_REWARDS);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [purchasing, setPurchasing] = useState<Reward | null>(null);

  const POINTS_PER_LEVEL = 50;
  const level = Math.floor(points / POINTS_PER_LEVEL) + 1;
  const firstName = currentUser?.name?.split(" ")[0] || "Buddy";

  useEffect(() => {
    if (!currentUser) return;

    // Load points
    const myPoints = typeof window !== "undefined"
      ? parseInt(localStorage.getItem(`consuela-points-${currentUser.name}`) || "0")
      : 0;
    setPoints(myPoints);

    // Load custom rewards
    const storedRewards = typeof window !== "undefined"
      ? localStorage.getItem("consuela-rewards-catalog")
      : null;
    if (storedRewards) {
      try { setRewards(JSON.parse(storedRewards)); } catch {}
    }

    // Load purchase history
    const storedPurchases = typeof window !== "undefined"
      ? localStorage.getItem(`consuela-purchases-${currentUser.name}`)
      : null;
    if (storedPurchases) {
      try { setPurchases(JSON.parse(storedPurchases)); } catch {}
    }
  }, [currentUser]);

  const handlePurchase = useCallback((reward: Reward) => {
    if (!currentUser || points < reward.cost) return;

    // Deduct points
    const newPoints = points - reward.cost;
    const key = `consuela-points-${currentUser.name}`;
    localStorage.setItem(key, String(newPoints));
    setPoints(newPoints);

    // Record purchase
    const newPurchase: Purchase = { rewardId: reward.id, timestamp: new Date().toISOString() };
    const updatedPurchases = [...purchases, newPurchase];
    localStorage.setItem(`consuela-purchases-${currentUser.name}`, JSON.stringify(updatedPurchases));
    setPurchases(updatedPurchases);

    // Show animation
    setPurchasing(reward);
  }, [currentUser, points, purchases]);

  // Group rewards by category
  const categories = Object.keys(CATEGORY_CONFIG);
  const rewardsByCategory = categories.map((cat) => ({
    category: cat,
    config: CATEGORY_CONFIG[cat],
    items: rewards.filter((r) => r.category === cat),
  })).filter((group) => group.items.length > 0);

  return (
    <PageShell>
      {/* Purchase animation overlay */}
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
                <span className="text-3xl font-black text-amber-400 tabular-nums">{points}</span>
                <span className="text-sm text-text-secondary font-semibold">points</span>
                <span className="text-xs text-text-muted">· Level {level}</span>
              </div>
            </div>
          </div>
        </Surface>
      </div>

      {/* Rewards by category */}
      <div className="px-4 space-y-5 pb-8">
        {rewardsByCategory.map((group) => (
          <div key={group.category}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">{group.config.icon}</span>
              <h3 className="text-base font-bold text-text-primary">{group.config.label}</h3>
              <span className="text-[10px] text-text-muted font-semibold">{group.items.length} available</span>
            </div>
            <div className="space-y-2">
              {group.items.map((reward) => (
                <RewardCard
                  key={reward.id}
                  reward={reward}
                  points={points}
                  onPurchase={handlePurchase}
                />
              ))}
            </div>
          </div>
        ))}

        {/* Purchase history */}
        <PurchaseHistory purchases={purchases} rewards={rewards} />

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
    </PageShell>
  );
}
