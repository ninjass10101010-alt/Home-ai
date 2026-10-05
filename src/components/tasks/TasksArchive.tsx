"use client";

import { useId, useState } from "react";
import SectionCard from "@/components/patterns/SectionCard";
import TreasurePath from "@/components/leaderboard/TreasurePath";
import FamilyGoal from "@/components/leaderboard/FamilyGoal";
import HallOfFame from "@/components/leaderboard/HallOfFame";
import AchievementWall from "@/components/leaderboard/AchievementWall";
import { textEmojiOrFallback } from "@/components/ui/EmojiText";
import type { LeaderboardEntry, Task, Transaction, WeekData } from "@/types/tasks";

/**
 * The deep archive of the Leaderboard tab (UI audit 5.7): journey, family
 * goal, hall of fame and the recent-activity feed. History, not the live
 * race — it stays behind the expander.
 */
interface TasksArchiveProps {
  weekData: WeekData;
  tasks: Task[];
  currentUser: { name: string; emoji?: string } | null;
  isLoggedIn: boolean;
  leaderboard: LeaderboardEntry[];
  memberColors: Record<string, string>;
  isParent: boolean;
  /**
   * The signed-in member's canonical all-time totals, recomputed server-side
   * from transaction history (`GET /api/tasks/all-time`). `null` means the
   * value could NOT be read — journey and wall must say so rather than derive a
   * level from a missing number. The page owns the data; this block owns the
   * markup.
   */
  allTimePoints: number | null | undefined;
  allTimeCompletions: number | null | undefined;
}

/**
 * Split a parent-typed reason out of a stored ledger description.
 *
 * `task-ledger-command.ts` writes one description for both the aggregate
 * entry and the per-member row, and the row's version splices the reason in
 * verbatim: `Manual adjust: -10pts (took it back after hitting your sister)`.
 * That feed is family-wide and readable by any guest, so a private note a
 * parent typed into an optional field was broadcast as if the ledger itself
 * had said it. The STORED description is money history and other surfaces read
 * it — it is not rewritten here; only how this row presents it changes.
 *
 * The parenthesised tail is peeled from the END of the sentence rather than
 * pattern-matched, which is the exact inverse of the producer
 * (`" (" + reason + ")"`), so a reason that itself contains a parenthesis
 * round-trips whole. Only the `Manual adjust` sentence is touched, so a
 * `Penalty: <name> (-5pts)` row is never mangled.
 */
function splitParentReason(description: string): { sentence: string; reason: string | null } {
  const match = /^Manual adjust:\s*([+-]?\d+)\s*pts([\s\S]*)$/.exec(description.trim());
  if (!match) return { sentence: description, reason: null };
  const tail = match[2].trim();
  const reason = tail.startsWith("(") && tail.endsWith(")") ? tail.slice(1, -1).trim() : "";
  return { sentence: `Manual adjust: ${match[1]}pts`, reason: reason.length > 0 ? reason : null };
}

const TX_ICON: Record<Transaction["type"], string> = {
  earn: "✅",
  redeem: "🎁",
  penalty: "⚠️",
  adjust: "⚙️",
};

export default function TasksArchive({
  weekData,
  tasks,
  currentUser,
  isLoggedIn,
  leaderboard,
  memberColors,
  isParent,
  allTimePoints,
  allTimeCompletions,
}: TasksArchiveProps) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  return (
    <>
        {/* The deep archive folds behind one expander: journey, family goal, and
            hall are history — the tab leads with the live race, not its museum.
            It was a `<details>` whose `py-3` sat on the CONTAINER, so the
            `<summary>`'s own hit box was one 20px text line — and the
            tap-target contract scans button/a/Link/role=button, never
            `<summary>`, so the 44px floor was unguarded on the one control that
            holds the whole hall of fame on a kitchen-wall touch display. */}
        <div className="rounded-2xl border border-white/10">
          <button
            type="button"
            data-testid="archive-disclosure"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setExpanded((prev) => !prev)}
            className="hit-44 tap-sm flex min-h-[44px] w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-text-secondary"
          >
            <span aria-hidden="true">🏅</span>
            <span className="flex-1">Trophies, journey &amp; history</span>
            <span aria-hidden="true" className="text-xs">{expanded ? "▾" : "▸"}</span>
          </button>
          {expanded && (
          <div id={panelId} className="px-4 pb-4">
            <div className="mt-2 space-y-6">
              {isLoggedIn && currentUser && (() => {
                const myAllTimePoints = allTimePoints ?? null;
                return (
                  <SectionCard headingLevel="h2" title="Your Journey" description={`${textEmojiOrFallback(currentUser.emoji)} Level progress & badges`}>
                    <TreasurePath
                      allTimePoints={myAllTimePoints}
                      memberEmoji={currentUser.emoji || "🌱"}
                      memberColor={memberColors[currentUser.name] || "green"}
                    />
                    <div className="mt-4">
                      <AchievementWall
                        allTimePoints={myAllTimePoints}
                        streak={leaderboard.find(e => e.name === currentUser.name || e.name.startsWith(currentUser.name))?.streak ?? 0}
                        completions={allTimeCompletions ?? null}
                      />
                    </div>
                  </SectionCard>
                );
              })()}

              <FamilyGoal weekData={weekData} isParent={isParent} />

              <HallOfFame />
            </div>
          </div>
          )}
        </div>

        {weekData.history.length > 0 && (
          <SectionCard headingLevel="h2" title="Recent Activity" description="Latest point transactions" icon="📜">
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {weekData.history.slice().reverse().slice(0, 15).map((tx) => {
                const { sentence, reason } = splitParentReason(tx.description);
                return (
                  <div key={tx.id} className="flex items-start gap-2 rounded-xl px-2 py-1 text-xs">
                    <span className="shrink-0 pt-0.5 text-base" aria-hidden="true">
                      {TX_ICON[tx.type] ?? "⚙️"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-text-secondary">
                        <span className="font-medium text-text-primary">{tx.member.split(" ")[0]}</span>{" "}
                        <span data-testid="ledger-tx-description">{sentence}</span>
                      </div>
                      {reason && (
                        <div
                          data-testid="ledger-tx-reason"
                          className="line-clamp-2 text-text-muted"
                          title={reason}
                        >
                          &ldquo;{reason}&rdquo; — note from a parent
                        </div>
                      )}
                    </div>
                    <span
                      className="shrink-0 font-semibold"
                      /* The ink tokens, not the raw accents: at 12px on this
                         card the bare accents measured 3.63:1 (mint) and
                         4.52:1 (rose) on light glass — the "−10" a family is
                         reading about their own money was the least legible
                         number in the panel. */
                      style={{ color: tx.amount > 0 ? "var(--color-accent-ink-mint)" : "var(--color-accent-ink-rose)" }}
                    >
                      {tx.amount > 0 ? "+" : ""}{tx.amount}
                    </span>
                    <span className="text-text-muted shrink-0">
                      {new Date(tx.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    </span>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        )}
    </>
  );
}
