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

type FeedbackTone = "neutral" | "success" | "error";

function queueWeeklyPrizes(items: WeeklyPrize[]): void {
  void writeTaskConfig({
    operationId: "",
    kind: "weekly-prizes",
    action: "replace",
    updatedAt: new Date().toISOString(),
    items,
  }).catch(() => {});
}

/**
 * A stored catalog can arrive with a nameless prize (an older device, a
 * hand-edited store, a pre-fix save). The prize card would then render a
 * gold-medal row with a holder and nothing to win — so a blank text is prefilled
 * with that rank's default, the same fallback the add-row path already uses for
 * an emoji. Display only: the row still reads as untouched and empty-text saves
 * are refused, so nothing is silently written to the server.
 */
function withPrizeDefaults(list: WeeklyPrize[]): WeeklyPrize[] {
  return list.map((p) => {
    if (p.text.trim()) return p;
    const fallback = DEFAULT_WEEKLY_PRIZES.find((d) => d.rank === p.rank)?.text;
    return fallback ? { ...p, text: fallback } : p;
  });
}

interface WeeklyPrizesCardProps {
  showToast: (msg: string, tone?: FeedbackTone) => void;
}

export default function WeeklyPrizesCard({ showToast }: WeeklyPrizesCardProps) {
  const { currentUser } = useAuth();
  // The Settings surface owns its own queue counters (never mounted alongside
  // Tasks or KidHome), so a parent sees the save is still in flight — and a
  // refusal (a stale catalog, a dead server) is visible instead of swallowed.
  const { entries, counts, cancel } = useTaskCommandQueue();
  const failedEntries = entries.filter((entry) => entry.status === "failed");
  const [prizes, setPrizes] = useState<WeeklyPrize[]>(() => withPrizeDefaults(loadWeeklyPrizes()));
  // The only real in-flight state is the outbox's: a command that has not been
  // acknowledged yet is still travelling (queued, retrying, reconciling, or
  // waiting on a PIN — `counts.queued` alone stops counting the moment the send
  // starts reconciling). The old local `saving` flag was set and cleared inside
  // one synchronous handler, so React batched it away and every
  // `disabled={saving}` / "Saving…" was a state no user could ever see. A
  // terminal failure is excluded: it is discardable below and never resolves.
  const sending = counts.pending > counts.failed;
  // Dirty seam: while the parent has unsaved in-field edits, the 60s pulse
  // must NOT re-read over them (a peer's edit would wipe mid-typing state).
  const dirtyRef = useRef(false);
  // A nameless prize must never reach the server: it would come back
  // authoritative and render as a gold-medal row with a holder and no prize.
  // Keyed by prize id so the message survives the outbox's catalog adoption.
  const [textError, setTextError] = useState<{ id: string; message: string } | null>(null);

  // An acknowledgment adopts the AUTHORITATIVE prize list into the store, so
  // the card re-reads it the moment the command lands or is refused — a stale
  // catalog repairs the visible list at once, not 60s later. A parent with
  // unsaved in-field edits keeps them: the dirty guard is still the last word.
  useEffect(
    () =>
      onTaskOutboxAdopted(() => {
        if (dirtyRef.current) return;
        setPrizes(withPrizeDefaults(loadWeeklyPrizes()));
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
      setPrizes(withPrizeDefaults(loadWeeklyPrizes()));
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
    if (sending) return;
    dirtyRef.current = true;
    if (patch.text !== undefined) {
      // Typing (or clearing) resolves this row's error immediately.
      setTextError((prev) => (prev?.id === id ? null : prev));
    }
    setPrizes((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const removeRow = (id: string) => {
    if (sending) return;
    dirtyRef.current = true;
    setTextError((prev) => (prev?.id === id ? null : prev));
    setPrizes((prev) =>
      prev.filter((p) => p.id !== id).map((p, i) => ({ ...p, rank: (i + 1) as 1 | 2 | 3 }))
    );
  };

  const addRow = () => {
    if (sending) return;
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
    if (sending) return;
    // A blank prize is refused with a field-level message rather than dropped:
    // dropping it would re-pack the ranks and move the rank contract (ranks
    // must stay contiguous 1..n), and the empty row also counts toward
    // raceGap's `maxPrizeRank`, so a nameless row would silently decide the
    // gap everyone is shown.
    const blank = prizes.find((p) => !p.text.trim());
    if (blank) {
      setTextError({
        id: blank.id,
        message: `Add a prize for #${prizes.indexOf(blank) + 1} — a prize needs a name.`,
      });
      showToast("Give every prize a name before saving.", "error");
      return;
    }
    setTextError(null);
    const list = prizes.map((p, i) => ({
      ...p,
      rank: (i + 1) as 1 | 2 | 3,
      // An emoji the parent cleared falls back to the rank's medal, so the row
      // is never blank. A cleared TEXT is refused above instead — the same
      // "never render a nameless prize" rule.
      emoji: p.emoji.trim() || MEDALS[i],
      text: p.text.trim(),
    }));
    queueWeeklyPrizes(list);
    dirtyRef.current = false;
    showToast("🏆 Saving the weekly prizes…");
  };

  return (
    <SectionCard
      title="Weekly prizes"
      description="What the top racers win at Monday's reset."
      icon="🏆"
      // Token, not a fixed hex: the amber accent has a dark-theme and a
      // light-theme value, and this card is the one surface on the tab that
      // used to keep the dark tint in both themes.
      tone="var(--color-accent-amber)"
      headingLevel="h2"
    >
      {counts.pending > 0 && (
        <div
          data-testid="prizes-command-queue"
          className="mb-3 rounded-xl px-3 py-2 text-xs font-semibold"
          style={{
            background: "color-mix(in srgb, var(--color-accent-amber) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-accent-amber) 25%, transparent)",
            // `-ink-amber` is the READABLE amber (accent mixed into the primary ink):
            // raw `--color-accent-amber` measured 2.95:1 for 12px text on this
            // card in the light theme.
            color: "var(--color-accent-ink-amber)",
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
              <span className="text-xs text-text-secondary">Weekly prizes</span>
              <button
                type="button"
                aria-label="Discard unsaved weekly prizes"
                onClick={() => cancel(entry.operationId)}
                className="tap-sm text-xs font-semibold text-[var(--color-accent-ink-rose)]"
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
          const error = textError?.id === p.id ? textError.message : null;
          return (
            <div
              key={p.id}
              className="flex items-center gap-2 rounded-2xl border border-border bg-[var(--color-surface-0)]/30 p-3"
            >
              <span className="shrink-0 text-xl" aria-hidden>{MEDALS[i]}</span>
              <input
                aria-label={`Prize ${rank} emoji`}
                value={p.emoji}
                disabled={sending}
                onChange={(e) => updateRow(p.id, { emoji: e.target.value })}
                className="w-11 shrink-0 rounded-xl border border-border bg-[var(--color-surface-2)] px-2 py-2 text-center text-lg text-text-primary outline-none"
              />
              {/* A prize's text is the whole row's meaning — never render it
                  blank. The fallback mirrors the emoji's: a nameless row shows
                  what the rank is for, and an EMPTY save is refused. */}
              <input
                aria-label={`Prize ${rank} text`}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `prize-${p.id}-error` : undefined}
                value={p.text}
                disabled={sending}
                placeholder={`What does #${rank} win?`}
                onChange={(e) => updateRow(p.id, { text: e.target.value })}
                className="min-w-0 flex-1 rounded-xl border border-border bg-[var(--color-surface-2)] px-3 py-2 text-sm text-text-primary outline-none"
              />
              <IconButton
                size="sm"
                variant="ghost"
                aria-label={`Remove prize ${rank}`}
                className="hover:!text-[var(--color-accent-rose)] hover:!bg-[var(--color-accent-rose)]/10"
                disabled={sending}
                onClick={() => removeRow(p.id)}
              >
                ×
              </IconButton>
              {error && (
                <p
                  id={`prize-${p.id}-error`}
                  role="alert"
                  className="basis-full text-xs font-semibold text-[var(--color-accent-ink-rose)]"
                >
                  {error}
                </p>
              )}
            </div>
          );
        })}
        {prizes.length === 0 && (
          <p className="text-sm text-text-secondary">No weekly prizes yet — add one to start the race.</p>
        )}
      </div>
      <div className="mt-4 flex gap-2">
        {prizes.length < MAX_PRIZES && (
          <SoftButton variant="secondary" onClick={addRow} disabled={sending} className="flex-1">Add prize</SoftButton>
        )}
        <SoftButton onClick={saveAll} disabled={sending} className="flex-1">
          {sending ? "Sending…" : "Save prizes"}
        </SoftButton>
      </div>
      <p className="mt-3 text-xs text-text-muted">Winners are locked in when the week resets Monday.</p>
    </SectionCard>
  );
}
