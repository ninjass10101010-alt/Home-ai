"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { queueTaskCommandAndFlush, onTaskOutboxAdopted } from "@/lib/task-command-queue";
import { useTaskCommandQueue } from "@/hooks/useTaskCommandQueue";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import Modal from "@/components/ui/Modal";
import ListRow from "@/components/ui/ListRow";
import EmptyState from "@/components/ui/EmptyState";
import FormField from "@/components/patterns/FormField";
import { REWARDS_KEY, loadRewards } from "@/lib/task-utils";

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

function queueRewardsCommand(action: "replace" | "upsert" | "delete", rest: Record<string, unknown>): void {
  queueTaskCommandAndFlush({
    route: "/api/tasks/config",
    action,
    payload: { kind: "rewards", updatedAt: new Date().toISOString(), ...rest },
    displayTarget: { kind: "config" },
  });
}

export default function RewardSection({ showToast }: RewardSectionProps) {
  // The Settings surface owns its OWN queue counters (it is never mounted at
  // the same time as Tasks or KidHome), so a parent editing the catalog sees
  // the command is still sending — and a refusal is visible, not swallowed.
  const { entries, counts, cancel } = useTaskCommandQueue();
  const failedEntries = entries.filter((entry) => entry.status === "failed");
  const rewards = useSyncExternalStore(
    subscribeToRewards,
    getRewardsSnapshot,
    getServerRewardsSnapshot,
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ name: "", emoji: "🎁", cost: 25, category: "fun" });

  // An adoption rewrites the canonical catalog, so the rendered list has to be
  // told to re-read: a REFUSED (stale) command repairs the visible catalog
  // immediately, at the moment of the refusal, instead of on the next 60s pull.
  useEffect(() => onTaskOutboxAdopted(emitRewardsUpdate), []);

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

  // Every catalog write is a durable config command queued BEFORE the local
  // list changes. The outbox acknowledgment adopts the authoritative list —
  // this component never writes a "success" into localStorage first, and the
  // edit survives a reload or a dead NAS because the command is persisted.
  const save = () => {
    if (!form.name.trim()) return;
    const reward = { ...form, name: form.name.trim(), id: editing?.id || `reward-${Date.now()}` };
    queueRewardsCommand("upsert", { item: reward });
    showToast(editing ? `✅ Updating "${reward.name}"…` : `✅ Adding "${reward.name}"…`);
    setModalOpen(false);
  };

  const remove = (reward: any) => {
    queueRewardsCommand("delete", { itemId: reward.id });
    showToast(`🗑️ Removing "${reward.name}"…`);
  };

  const resetDefaults = () => {
    queueRewardsCommand("replace", { items: [] });
    showToast("✅ Clearing the rewards…");
  };

  return (
    <>
      {counts.pending > 0 && (
        <div
          data-testid="rewards-command-queue"
          className="mb-3 rounded-xl px-3 py-2 text-[11px] font-semibold"
          style={{
            background: "color-mix(in srgb, var(--color-accent-amber) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-accent-amber) 25%, transparent)",
            color: "var(--color-accent-amber)",
          }}
        >
          {counts.queued > 0
            ? `⏳ Sending ${counts.queued} change${counts.queued !== 1 ? "s" : ""} to the family server…`
            : ""}
          {counts.authRequired > 0 ? " 🔒 Waiting on a PIN." : ""}
          {counts.reconciling > 0 ? " ⏳ Finishing up." : ""}
          {counts.failed > 0 ? " ⚠️ Couldn't be saved." : ""}
        </div>
      )}
      {counts.failed > 0 && (
        <ul data-testid="rewards-command-failures" className="mb-3 space-y-1">
          {failedEntries.map((entry) => (
            <li key={entry.operationId} className="flex items-center gap-2">
              <span className="text-[11px] text-text-secondary">
                {entry.displayTarget.title || entry.action}
              </span>
              <button
                type="button"
                aria-label={`Discard unsaved ${entry.displayTarget.title || entry.action}`}
                onClick={() => cancel(entry.operationId)}
                className="tap-sm text-[11px] font-semibold text-[var(--color-accent-rose)]"
              >
                Discard
              </button>
            </li>
          ))}
        </ul>
      )}
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
