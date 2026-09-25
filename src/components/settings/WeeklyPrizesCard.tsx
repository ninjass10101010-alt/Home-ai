"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import SectionCard from "@/components/patterns/SectionCard";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import { db } from "@/db";
import {
  loadWeeklyPrizes,
  saveWeeklyPrizes,
  touchWeeklyPrizesStamp,
  DEFAULT_WEEKLY_PRIZES,
} from "@/lib/task-utils";
import type { WeeklyPrize } from "@/types/tasks";

const MEDALS = ["🥇", "🥈", "🥉"] as const;
const MAX_PRIZES = 3;

type FeedbackTone = "neutral" | "success" | "error";

interface WeeklyPrizesCardProps {
  showToast: (msg: string, tone?: FeedbackTone) => void;
}

export default function WeeklyPrizesCard({ showToast }: WeeklyPrizesCardProps) {
  const { currentUser } = useAuth();
  const [prizes, setPrizes] = useState<WeeklyPrize[]>(() => loadWeeklyPrizes());
  const [saving, setSaving] = useState(false);
  // Dirty seam: while the parent has unsaved in-field edits, the 60s pulse
  // must NOT re-read over them (a peer's edit would wipe mid-typing state).
  const dirtyRef = useRef(false);

  // Re-read on the 60s CacheRefresher pulse so another device's prize edits
  // land — but only when the card is clean (no unsaved edits in flight).
  useEffect(() => {
    const onRefreshed = () => {
      if (dirtyRef.current) return;
      setPrizes(loadWeeklyPrizes());
    };
    window.addEventListener("consuela-data-refreshed", onRefreshed);
    return () => window.removeEventListener("consuela-data-refreshed", onRefreshed);
  }, []);

  // Parent-only surface — kids and guests never see the prize race controls.
  if (currentUser?.role !== "parent") return null;

  const updateRow = (id: string, patch: Partial<WeeklyPrize>) => {
    if (saving) return;
    dirtyRef.current = true;
    setPrizes((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  // Ranks always stay contiguous 1..N — removing a row shifts the ones below
  // up so a save never leaves a hole (PB rows are rank-keyed and there is no
  // delete API, so a compact ladder is what keeps the two stores aligned).
  const removeRow = (id: string) => {
    if (saving) return;
    dirtyRef.current = true;
    setPrizes((prev) =>
      prev.filter((p) => p.id !== id).map((p, i) => ({ ...p, rank: (i + 1) as 1 | 2 | 3 }))
    );
  };

  const addRow = () => {
    if (saving) return;
    dirtyRef.current = true;
    setPrizes((prev) => {
      if (prev.length >= MAX_PRIZES) return prev;
      const nextRank = (prev.length + 1) as 1 | 2 | 3;
      const fallbackEmoji = DEFAULT_WEEKLY_PRIZES.find((d) => d.rank === nextRank)?.emoji ?? "🎁";
      return [...prev, { id: `prize-${Date.now()}`, rank: nextRank, emoji: fallbackEmoji, text: "" }];
    });
  };

  const saveAll = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const list = prizes.map((p, i) => ({
        ...p,
        rank: (i + 1) as 1 | 2 | 3,
        emoji: p.emoji.trim() || MEDALS[i],
        text: p.text.trim(),
      }));
      setPrizes(list);
      if (!saveWeeklyPrizes(list)) {
        dirtyRef.current = true;
        showToast("Couldn't save the weekly prize catalog on this device. Try again.", "error");
        return;
      }
      // Stamp BEFORE the push — every local save is the family's latest claim
      // of truth, so a peer's snapshot older than this moment loses.
      if (!touchWeeklyPrizesStamp()) {
        dirtyRef.current = true;
        showToast(
          "Weekly prize catalog is saved on this device, but its sync marker could not be saved. Try again.",
          "error",
        );
        return;
      }
      // One row's failure never blocks the rest — the next push retries.
      const results = await Promise.allSettled(
        list.map((p) => Promise.resolve().then(() => db.upsertWeeklyPrize({ rank: p.rank, emoji: p.emoji, text: p.text }))),
      );
      const failedCount = results.filter(
        (result) => result.status === "rejected" || (result.status === "fulfilled" && !result.value),
      ).length;
      // Save landed — the card is clean again, so the next refresh pulse may
      // re-read (a peer's newer edit can land after this point).
      dirtyRef.current = false;
      if (failedCount > 0) {
        showToast(
          `Weekly prize catalog is saved on this device and ${failedCount} ${failedCount === 1 ? "row" : "rows"} did not sync.`,
          "error",
        );
      } else {
        showToast("🏆 Weekly prizes saved", "success");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title="Weekly prizes"
      description="What the top racers win at Monday's reset."
      icon="🏆"
      tone="#f59e0b"
      headingLevel="h2"
    >
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
                disabled={saving}
                onChange={(e) => updateRow(p.id, { emoji: e.target.value })}
                className="w-11 shrink-0 rounded-xl border border-white/10 bg-[var(--color-surface-2)] px-2 py-2 text-center text-lg text-text-primary outline-none"
              />
              <input
                aria-label={`Prize ${rank} text`}
                value={p.text}
                disabled={saving}
                placeholder={`What does #${rank} win?`}
                onChange={(e) => updateRow(p.id, { text: e.target.value })}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[var(--color-surface-2)] px-3 py-2 text-sm text-text-primary outline-none"
              />
              <IconButton
                size="sm"
                variant="danger"
                aria-label={`Remove prize ${rank}`}
                disabled={saving}
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
          <SoftButton variant="secondary" onClick={addRow} disabled={saving} className="flex-1">Add prize</SoftButton>
        )}
        <SoftButton onClick={saveAll} disabled={saving} className="flex-1">
          {saving ? "Saving…" : "Save prizes"}
        </SoftButton>
      </div>
      <p className="mt-3 text-xs text-text-muted">Winners are locked in when the week resets Monday.</p>
    </SectionCard>
  );
}
