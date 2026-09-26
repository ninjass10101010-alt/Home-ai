"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import SectionCard from "@/components/patterns/SectionCard";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import {
  loadWeeklyPrizes,
  applyTaskConfigSnapshotToStores,
  DEFAULT_WEEKLY_PRIZES,
} from "@/lib/task-utils";
import { onTaskOutboxAdopted } from "@/lib/task-command-queue";
import { readTaskConfig, writeTaskConfig } from "@/lib/task-config-client";
import { useTaskCommandQueue } from "@/hooks/useTaskCommandQueue";
import type { TaskConfigResponse } from "@/lib/task-config";
import type { WeeklyPrize } from "@/types/tasks";

const MEDALS = ["🥇", "🥈", "🥉"] as const;
const MAX_PRIZES = 3;

function queueWeeklyPrizes(items: WeeklyPrize[]): void {
  void writeTaskConfig({
    operationId: "",
    kind: "weekly-prizes",
    action: "replace",
    updatedAt: new Date().toISOString(),
    items,
  }).catch(() => {});
}

interface WeeklyPrizesCardProps {
  showToast: (msg: string) => void;
}

export default function WeeklyPrizesCard({ showToast }: WeeklyPrizesCardProps) {
  const { currentUser } = useAuth();
  // The Settings surface owns its own queue counters (never mounted alongside
  // Tasks or KidHome), so a parent sees the save is still in flight — and a
  // refusal (a stale catalog, a dead server) is visible instead of swallowed.
  const { entries, counts, cancel } = useTaskCommandQueue();
  const failedEntries = entries.filter((entry) => entry.status === "failed");
  const [prizes, setPrizes] = useState<WeeklyPrize[]>(() => loadWeeklyPrizes());
  const [saving, setSaving] = useState(false);
  // Dirty seam: while the parent has unsaved in-field edits, the 60s pulse
  // must NOT re-read over them (a peer's edit would wipe mid-typing state).
  const dirtyRef = useRef(false);

  // An acknowledgment adopts the AUTHORITATIVE prize list into the store, so
  // the card re-reads it the moment the command lands or is refused — a stale
  // catalog repairs the visible list at once, not 60s later. A parent with
  // unsaved in-field edits keeps them: the dirty guard is still the last word.
  useEffect(
    () =>
      onTaskOutboxAdopted(() => {
        if (dirtyRef.current) return;
        setPrizes(loadWeeklyPrizes());
      }),
    [],
  );

  useEffect(() => {
    let active = true;
    const adopt = (response: TaskConfigResponse | null) => {
      if (!active || dirtyRef.current) return;
      if (response) {
        applyTaskConfigSnapshotToStores({
          weeklyPrizes: response.items,
          weeklyPrizesStamp: response.updatedAt,
        });
      }
      setPrizes(loadWeeklyPrizes());
    };
    const read = () => {
      void readTaskConfig("weekly-prizes").then(adopt).catch(() => adopt(null));
    };
    read();
    window.addEventListener("consuela-data-refreshed", read);
    return () => {
      active = false;
      window.removeEventListener("consuela-data-refreshed", read);
    };
  }, []);

  // Parent-only surface — kids and guests never see the prize race controls.
  if (currentUser?.role !== "parent") return null;

  const updateRow = (id: string, patch: Partial<WeeklyPrize>) => {
    dirtyRef.current = true;
    setPrizes((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const removeRow = (id: string) => {
    dirtyRef.current = true;
    setPrizes((prev) =>
      prev.filter((p) => p.id !== id).map((p, i) => ({ ...p, rank: (i + 1) as 1 | 2 | 3 }))
    );
  };

  const addRow = () => {
    dirtyRef.current = true;
    setPrizes((prev) => {
      if (prev.length >= MAX_PRIZES) return prev;
      const nextRank = (prev.length + 1) as 1 | 2 | 3;
      const fallbackEmoji = DEFAULT_WEEKLY_PRIZES.find((d) => d.rank === nextRank)?.emoji ?? "🎁";
      return [...prev, { id: `prize-${Date.now()}`, rank: nextRank, emoji: fallbackEmoji, text: "" }];
    });
  };

  // The prize list is a durable config command queued BEFORE any local
  // success: the authoritative catalog arrives with the outbox acknowledgment
  // (via the cross-device snapshot pull), so a dead NAS or a reload can never
  // lose the edit or show a catalog the server never accepted.
  const saveAll = () => {
    if (saving) return;
    setSaving(true);
    const list = prizes.map((p, i) => ({
      ...p,
      rank: (i + 1) as 1 | 2 | 3,
      emoji: p.emoji.trim() || MEDALS[i],
      text: p.text.trim(),
    }));
    queueWeeklyPrizes(list);
    dirtyRef.current = false;
    showToast("🏆 Saving the weekly prizes…");
    setSaving(false);
  };

  return (
    <SectionCard
      title="Weekly prizes"
      description="What the top racers win at Monday's reset."
      icon="🏆"
      tone="#f59e0b"
      headingLevel="h2"
    >
      {counts.pending > 0 && (
        <div
          data-testid="prizes-command-queue"
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
        <ul data-testid="prizes-command-failures" className="mb-3 space-y-1">
          {failedEntries.map((entry) => (
            <li key={entry.operationId} className="flex items-center gap-2">
              <span className="text-[11px] text-text-secondary">Weekly prizes</span>
              <button
                type="button"
                aria-label="Discard unsaved weekly prizes"
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
        {prizes.map((p, i) => {
          const rank = i + 1;
          return (
            <div
              key={p.id}
              className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/30 p-3"
            >
              <span className="shrink-0 text-xl" aria-hidden>{MEDALS[i]}</span>
              <input
                aria-label={`Prize ${rank} emoji`}
                value={p.emoji}
                onChange={(e) => updateRow(p.id, { emoji: e.target.value })}
                className="w-11 shrink-0 rounded-xl border border-white/10 bg-[var(--color-surface-2)] px-2 py-2 text-center text-lg text-text-primary outline-none"
              />
              <input
                aria-label={`Prize ${rank} text`}
                value={p.text}
                placeholder={`What does #${rank} win?`}
                onChange={(e) => updateRow(p.id, { text: e.target.value })}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[var(--color-surface-2)] px-3 py-2 text-sm text-text-primary outline-none"
              />
              <IconButton
                size="sm"
                variant="danger"
                aria-label={`Remove prize ${rank}`}
                onClick={() => removeRow(p.id)}
              >
                ×
              </IconButton>
            </div>
          );
        })}
        {prizes.length === 0 && (
          <p className="text-sm text-text-secondary">No weekly prizes yet — add one to start the race.</p>
        )}
      </div>
      <div className="mt-4 flex gap-2">
        {prizes.length < MAX_PRIZES && (
          <SoftButton variant="secondary" onClick={addRow} className="flex-1">Add prize</SoftButton>
        )}
        <SoftButton onClick={saveAll} disabled={saving} className="flex-1">
          {saving ? "Saving…" : "Save prizes"}
        </SoftButton>
      </div>
      <p className="mt-3 text-xs text-text-muted">Winners are locked in when the week resets Monday.</p>
    </SectionCard>
  );
}
