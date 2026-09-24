"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import Modal from "@/components/ui/Modal";
import ListRow from "@/components/ui/ListRow";
import EmptyState from "@/components/ui/EmptyState";
import FormField from "@/components/patterns/FormField";
import { REWARDS_KEY, loadRewards, saveRewards } from "@/lib/task-utils";
import { writeRewardsStamp } from "@/modes/kid/kid-store";
import type { TaskConfigResponse } from "@/lib/task-config";

// Retired Settings-only key. The live shop (RewardsShop) and the Tasks page
// read/write REWARDS_KEY via task-utils — one catalog, one source.
const LEGACY_CATALOG_KEY = "consuela-rewards-catalog";

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

const REWARDS_UPDATED_EVENT = "consuela-rewards-updated";
const EMPTY_REWARDS: any[] = [];
let cachedRewardsRaw: string | null | undefined;
let cachedRewards: any[] = EMPTY_REWARDS;

function getRewardsSnapshot(): any[] {
  if (typeof window === "undefined") return EMPTY_REWARDS;
  const raw = localStorage.getItem(REWARDS_KEY);
  if (raw !== cachedRewardsRaw) {
    cachedRewardsRaw = raw;
    cachedRewards = loadRewards<any[]>([]);
  }
  return cachedRewards;
}

function getServerRewardsSnapshot(): any[] {
  return EMPTY_REWARDS;
}

function subscribeToRewards(onStoreChange: () => void): () => void {
  window.addEventListener(REWARDS_UPDATED_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(REWARDS_UPDATED_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function emitRewardsUpdate(): void {
  window.dispatchEvent(new Event(REWARDS_UPDATED_EVENT));
}

function configOperationId(action: "replace" | "upsert" | "delete"): string {
  return `config-rewards-${action}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function postRewardCommand(command: Record<string, unknown>): Promise<TaskConfigResponse> {
  const response = await fetch("/api/tasks/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = await response.json();
  if (!response.ok || !body?.success || !Array.isArray(body.items)) {
    throw new Error("config_write_failed");
  }
  return body as TaskConfigResponse;
}

export default function RewardSection({ showToast }: RewardSectionProps) {
  const rewards = useSyncExternalStore(
    subscribeToRewards,
    getRewardsSnapshot,
    getServerRewardsSnapshot,
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ name: "", emoji: "🎁", cost: 25, category: "fun" });

  useEffect(() => {
    // One-time heal: a device whose only catalog is the retired Settings key
    // migrates it into the live shop key (REWARDS_KEY) so parent edits
    // survive — and the legacy key is removed ONLY once that copy has
    // landed. When both keys exist the live key wins for reads and the
    // legacy copy stays in place: the conflict path never destroys data.
    try {
      const legacy = localStorage.getItem(LEGACY_CATALOG_KEY);
      if (legacy !== null && localStorage.getItem(REWARDS_KEY) === null) {
        localStorage.setItem(REWARDS_KEY, legacy);
        localStorage.removeItem(LEGACY_CATALOG_KEY);
      }
    } catch {}
    emitRewardsUpdate();
  }, []);

  const openModal = (reward?: any) => {
    setEditing(reward || null);
    setForm(reward || { name: "", emoji: "🎁", cost: 25, category: "fun" });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) return;
    const reward = { ...form, name: form.name.trim(), id: editing?.id || `reward-${Date.now()}` };
    try {
      const result = await postRewardCommand({
        operationId: configOperationId("upsert"),
        kind: "rewards",
        action: "upsert",
        updatedAt: new Date().toISOString(),
        item: reward,
      });
      saveRewards(result.items);
      writeRewardsStamp(result.updatedAt);
      emitRewardsUpdate();
      showToast(editing ? `✅ Updated "${reward.name}"` : `✅ Added "${reward.name}"`);
      setModalOpen(false);
    } catch {
      showToast("Couldn't save the reward. Check the connection and try again.");
    }
  };

  const remove = async (reward: any) => {
    try {
      const result = await postRewardCommand({
        operationId: configOperationId("delete"),
        kind: "rewards",
        action: "delete",
        updatedAt: new Date().toISOString(),
        itemId: reward.id,
      });
      saveRewards(result.items);
      writeRewardsStamp(result.updatedAt);
      emitRewardsUpdate();
      showToast(`🗑️ Removed "${reward.name}"`);
    } catch {
      showToast("Couldn't remove the reward. Check the connection and try again.");
    }
  };

  const resetDefaults = async () => {
    try {
      const result = await postRewardCommand({
        operationId: configOperationId("replace"),
        kind: "rewards",
        action: "replace",
        updatedAt: new Date().toISOString(),
        items: [],
      });
      saveRewards(result.items);
      writeRewardsStamp(result.updatedAt);
      emitRewardsUpdate();
      showToast("✅ Rewards cleared — the shop starts empty");
    } catch {
      showToast("Couldn't clear the rewards. Check the connection and try again.");
    }
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
            description="The shop starts empty — rewards you add here are what kids can redeem with their points."
            icon="🏪"
            actionLabel="Add reward"
            onAction={() => openModal()}
          />
        )}
      </div>
      <div className="mt-4 flex gap-2">
        <SoftButton onClick={() => openModal()} className="flex-1">Add reward</SoftButton>
        <SoftButton variant="secondary" className="flex-1" onClick={resetDefaults}>Clear all</SoftButton>
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
