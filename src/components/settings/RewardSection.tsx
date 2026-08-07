"use client";

import { useState, useEffect } from "react";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import Modal from "@/components/ui/Modal";
import ListRow from "@/components/ui/ListRow";
import EmptyState from "@/components/ui/EmptyState";
import FormField from "@/components/patterns/FormField";

const REWARD_CATEGORIES = [
  { id: "screen", label: "📱 Screen Time" },
  { id: "fun", label: "🎉 Fun Activities" },
  { id: "treat", label: "🍦 Treats" },
  { id: "privilege", label: "⭐ Privileges" },
  { id: "chore", label: "✅ Chore Pass" },
];

const REWARD_EMOJIS = ["🎁", "📱", "🎬", "🍦", "🌙", "⏭️", "🎮", "🧁", "🏠", "🎪", "🍕", "🎵", "📚", "🏊", "🎨"];

interface RewardSectionProps {
  showToast: (msg: string) => void;
}

export default function RewardSection({ showToast }: RewardSectionProps) {
  const [rewards, setRewards] = useState<any[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ name: "", emoji: "🎁", cost: 25, category: "fun" });

  useEffect(() => {
    try {
      const stored = localStorage.getItem("consuela-rewards-catalog");
      if (stored) setRewards(JSON.parse(stored));
    } catch {}
  }, []);

  const openModal = (reward?: any) => {
    setEditing(reward || null);
    setForm(reward || { name: "", emoji: "🎁", cost: 25, category: "fun" });
    setModalOpen(true);
  };

  const save = () => {
    if (!form.name.trim()) return;
    const reward = { ...form, name: form.name.trim(), id: editing?.id || `reward-${Date.now()}` };
    const updated = editing ? rewards.map((r) => r.id === editing.id ? reward : r) : [...rewards, reward];
    setRewards(updated);
    localStorage.setItem("consuela-rewards-catalog", JSON.stringify(updated));
    showToast(editing ? `✅ Updated "${reward.name}"` : `✅ Added "${reward.name}"`);
    setModalOpen(false);
  };

  const remove = (reward: any) => {
    const updated = rewards.filter((r) => r.id !== reward.id);
    setRewards(updated);
    localStorage.setItem("consuela-rewards-catalog", JSON.stringify(updated));
    showToast(`🗑️ Removed "${reward.name}"`);
  };

  const resetDefaults = () => {
    localStorage.removeItem("consuela-rewards-catalog");
    setRewards([]);
    showToast("✅ Reset to default rewards");
  };

  return (
    <>
      <div className="space-y-3">
        {rewards.map((reward) => (
          <ListRow
            key={reward.id}
            title={`${reward.emoji} ${reward.name}`}
            subtitle={`${reward.category} · ${reward.cost} pts`}
            leftRailColor="var(--color-accent-amber)"
            leading={<span className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--color-surface-2)] text-xl">{reward.emoji}</span>}
            trailing={
              <div className="flex items-center gap-1">
                <IconButton size="sm" variant="ghost" aria-label="Edit reward" onClick={() => openModal(reward)}>✎</IconButton>
                <IconButton size="sm" variant="danger" aria-label="Delete reward" onClick={() => remove(reward)}>×</IconButton>
              </div>
            }
          />
        ))}
        {rewards.length === 0 && (
          <EmptyState
            title="No custom rewards yet"
            description="Kids will see 8 default rewards. Add your own to personalize the shop!"
            icon="🏪"
            actionLabel="Add reward"
            onAction={() => openModal()}
          />
        )}
      </div>
      <div className="mt-4 flex gap-2">
        <SoftButton onClick={() => openModal()} className="flex-1">Add reward</SoftButton>
        <SoftButton variant="secondary" className="flex-1" onClick={resetDefaults}>Reset defaults</SoftButton>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Edit reward" : "Add reward"}
        description="Rewards appear in the kid's Reward Shop. They spend points to redeem them."
        footer={
          <>
            <SoftButton onClick={save} className="flex-1">Save</SoftButton>
            <SoftButton variant="secondary" onClick={() => setModalOpen(false)} className="flex-1">Cancel</SoftButton>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Reward name">
            <input
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none"
              placeholder="e.g., 30 min screen time"
            />
          </FormField>
          <FormField label="Emoji">
            <div className="flex flex-wrap gap-2">
              {REWARD_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, emoji }))}
                  className={`grid h-10 w-10 place-items-center rounded-2xl text-lg ${
                    form.emoji === emoji ? "bg-[var(--color-accent-selected)] text-white" : "bg-[var(--color-surface-2)] text-text-primary"
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </FormField>
          <FormField label="Cost (points)">
            <input
              type="number"
              min={1}
              max={999}
              value={form.cost}
              onChange={(e) => setForm((p) => ({ ...p, cost: parseInt(e.target.value) || 0 }))}
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none tabular-nums"
              placeholder="25"
            />
          </FormField>
          <FormField label="Category">
            <div className="flex flex-wrap gap-2">
              {REWARD_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, category: cat.id }))}
                  className={`rounded-xl px-3 py-2 text-xs font-bold transition-colors ${
                    form.category === cat.id ? "bg-[var(--color-accent-selected)] text-white" : "bg-[var(--color-surface-2)] text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </FormField>
        </div>
      </Modal>
    </>
  );
}
