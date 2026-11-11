"use client";

import { useMemo, useState } from "react";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import EmptyState from "@/components/ui/EmptyState";
import { useRoutines } from "@/hooks/useRoutines";
import { RoutineFocusTimerModal } from "@/components/routines/RoutineModals";
import {
  ROUTINE_SLOT_META,
  type FamilyRoutine,
} from "@/types/routines";
import {
  formatRoutineDaysLabel,
  getMemberCheckedSteps,
  getMemberCompletionMeta,
  isRoutineScheduledForDate,
  isSingleMemberRoutine,
  memberKey,
  routineAppliesToMember,
  type RoutineRosterMember,
} from "@/lib/routine-rules";

interface RoutinesTodaySectionProps {
  memberName: string;
  memberRole: "parent" | "child" | "pet";
  rosterMembers: RoutineRosterMember[];
  showAllMissedForParent?: boolean;
  onOpenComposer?: (editing: FamilyRoutine | null) => void;
  onOpenSettings?: () => void;
  routineHook?: ReturnType<typeof useRoutines>;
  title?: string;
}

export default function RoutinesTodaySection({
  memberName,
  memberRole,
  rosterMembers,
  showAllMissedForParent = false,
  onOpenComposer,
  onOpenSettings,
  routineHook,
  title = "Today's Routines",
}: RoutinesTodaySectionProps) {
  const internalHook = useRoutines();
  const state = routineHook ?? internalHook;

  const {
    todayISO,
    yesterdayISO,
    routines,
    settings,
    progress,
    accountability,
    busyIds,
    toggleStep,
    completeRoutine,
    uncompleteRoutine,
    approveRoutine,
    sendBackRoutine,
    excuseMissed,
  } = state;

  const [banner, setBanner] = useState<string | null>(null);
  const [focusRoutine, setFocusRoutine] = useState<FamilyRoutine | null>(null);

  const isParent = memberRole === "parent";
  const mKey = memberKey(memberName);
  const myStreak = accountability.streaks[mKey]?.current ?? 0;

  const myTodayRoutines = useMemo(() => {
    return routines
      .filter(
        (r) =>
          isRoutineScheduledForDate(r, todayISO) &&
          routineAppliesToMember(
            r,
            { name: memberName, fullName: memberName, role: memberRole },
            rosterMembers,
          ),
      )
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [routines, todayISO, memberName, memberRole, rosterMembers]);

  const completedTodayCount = useMemo(() => {
    return myTodayRoutines.filter((r) => {
      const meta = getMemberCompletionMeta(
        progress,
        r.id,
        memberName,
        isSingleMemberRoutine(r, rosterMembers),
      );
      return meta?.status === "completed" || meta?.status === "approved";
    }).length;
  }, [myTodayRoutines, progress, memberName, rosterMembers]);

  const unexcusedMissed = useMemo(() => {
    return accountability.missedEntries.filter((e) => {
      if (e.excused) return false;
      if (isParent && showAllMissedForParent) {
        return e.date >= yesterdayISO;
      }
      return e.memberKey === mKey && e.date === yesterdayISO;
    });
  }, [accountability.missedEntries, isParent, showAllMissedForParent, yesterdayISO, mKey]);

  const pendingApprovals = useMemo(() => {
    if (!isParent) return [];
    const list: Array<{
      key: string;
      routine: FamilyRoutine;
      memberName: string;
      at: string;
    }> = [];
    for (const [key, meta] of Object.entries(progress.memberCompleted ?? {})) {
      if (meta.status !== "pending_approval") continue;
      const [routineId] = key.split("::");
      const rt = routines.find((r) => r.id === routineId);
      if (!rt) continue;
      list.push({
        key,
        routine: rt,
        memberName: meta.by,
        at: meta.at,
      });
    }
    return list;
  }, [isParent, progress.memberCompleted, routines]);

  const showToast = (msg: string) => {
    setBanner(msg);
    setTimeout(() => {
      setBanner((prev) => (prev === msg ? null : prev));
    }, 3500);
  };

  const handleStep = async (routine: FamilyRoutine, stepId: string) => {
    const res = await toggleStep(routine.id, stepId, memberName);
    if (!res.ok) {
      showToast(res.error || "Could not save step.");
      return;
    }
    if (res.completion?.status === "pending_approval") {
      showToast(`${routine.emoji} ${routine.title} submitted for parent approval!`);
    } else if (res.pointsDelta && res.pointsDelta > 0) {
      const bonus = res.completion?.streakBonusAwarded
        ? ` (includes +${res.completion.streakBonusAwarded} streak bonus!)`
        : "";
      showToast(`🎉 ${routine.title} done! +${res.pointsDelta} pts${bonus}`);
    }
  };

  const handleToggleAll = async (routine: FamilyRoutine, isDone: boolean) => {
    const res = isDone
      ? await uncompleteRoutine(routine.id, memberName)
      : await completeRoutine(routine.id, memberName);
    if (!res.ok) {
      showToast(res.error || "Could not update routine.");
      return;
    }
    if (res.completion?.status === "pending_approval") {
      showToast(`${routine.emoji} ${routine.title} sent for parent approval!`);
    } else if (!isDone && res.pointsDelta && res.pointsDelta > 0) {
      showToast(`🎉 ${routine.title} finished! +${res.pointsDelta} pts`);
    } else if (isDone && res.pointsDelta && res.pointsDelta < 0) {
      showToast(`Reopened ${routine.title} (${res.pointsDelta} pts)`);
    }
  };

  return (
    <section className="space-y-4" data-testid="routines-today-section">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
          <span className="rounded-full border border-border bg-[var(--color-surface-2)] px-3 py-1 text-xs font-semibold text-text-secondary">
            {completedTodayCount} / {myTodayRoutines.length} done
          </span>
          <span
            className="rounded-full bg-[var(--color-accent-amber)]/15 px-3 py-1 text-xs font-semibold text-[var(--color-accent-ink-amber)]"
            data-testid="routine-member-streak"
          >
            🔥 {myStreak}d streak
          </span>
        </div>

        {isParent && (onOpenComposer || onOpenSettings) && (
          <div className="flex flex-wrap items-center gap-2">
            {onOpenSettings && (
              <SoftButton variant="ghost" size="sm" onClick={onOpenSettings}>
                ⚙️ Point Rules
              </SoftButton>
            )}
            {onOpenComposer && (
              <SoftButton variant="secondary" size="sm" onClick={() => onOpenComposer(null)}>
                + Add Routine
              </SoftButton>
            )}
          </div>
        )}
      </div>

      {banner && (
        <div
          role="status"
          className="rounded-2xl border border-[var(--color-accent-mint)]/35 bg-[var(--color-accent-mint)]/15 px-4 py-2.5 text-sm font-medium text-[var(--color-accent-ink-mint)]"
        >
          {banner}
        </div>
      )}

      {/* Accountability Alert: Missed Yesterday */}
      {unexcusedMissed.length > 0 && (
        <Surface
          variant="glass-subtle"
          padding="md"
          data-testid="missed-routines-alert"
          className="border border-[var(--color-accent-rose)]/35 bg-[var(--color-accent-rose)]/10"
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-[var(--color-accent-ink-rose)]">
                ⚠️ Missed Yesterday · Daily Accountability
              </div>
              <span className="text-xs font-medium text-text-secondary">
                {unexcusedMissed.length} missed
              </span>
            </div>
            <div className="space-y-2">
              {unexcusedMissed.map((entry) => (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-[var(--color-surface-1)]/80 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text-primary">
                      {entry.routineEmoji} {entry.routineTitle}
                      {isParent && showAllMissedForParent ? ` · ${entry.memberName}` : ""}
                    </div>
                    <div className="text-xs text-text-secondary">
                      {entry.date} · Streak reset
                      {entry.deductedPoints > 0
                        ? ` · -${entry.deductedPoints} pts deducted`
                        : entry.penaltyPoints > 0
                          ? ` · ${entry.penaltyPoints} pts rule (0 deducted)`
                          : ""}
                    </div>
                  </div>
                  {isParent && (
                    <SoftButton
                      variant="secondary"
                      size="sm"
                      loading={!!busyIds[`excuse:${entry.id}`]}
                      onClick={async () => {
                        const res = await excuseMissed(entry.id);
                        if (res.ok) {
                          showToast(
                            `Excused ${entry.routineTitle} for ${entry.memberName}${
                              entry.deductedPoints > 0
                                ? ` (+${entry.deductedPoints} pts refunded)`
                                : ""
                            }.`,
                          );
                        }
                      }}
                    >
                      Excuse{entry.deductedPoints > 0 ? ` & Refund +${entry.deductedPoints}` : ""}
                    </SoftButton>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Surface>
      )}

      {/* Pending Approvals for Parents */}
      {isParent && pendingApprovals.length > 0 && (
        <Surface
          variant="glass-subtle"
          padding="md"
          data-testid="pending-routine-approvals"
          className="border border-[var(--color-accent-amber)]/35 bg-[var(--color-accent-amber)]/10"
        >
          <div className="mb-2 text-sm font-semibold text-[var(--color-accent-ink-amber)]">
            ⏳ Routine Approvals Waiting ({pendingApprovals.length})
          </div>
          <div className="space-y-2">
            {pendingApprovals.map((item) => (
              <div
                key={item.key}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-[var(--color-surface-1)]/80 px-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium text-text-primary">
                    {item.routine.emoji} {item.routine.title} · {item.memberName}
                  </div>
                  <div className="text-xs text-text-secondary">
                    +{item.routine.points} pts upon approval
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <SoftButton
                    variant="ghost"
                    size="sm"
                    loading={!!busyIds[`sendback:${item.routine.id}:${item.memberName}`]}
                    onClick={() => sendBackRoutine(item.routine.id, item.memberName)}
                  >
                    Send Back
                  </SoftButton>
                  <SoftButton
                    variant="primary"
                    size="sm"
                    loading={!!busyIds[`approve:${item.routine.id}:${item.memberName}`]}
                    onClick={async () => {
                      const res = await approveRoutine(item.routine.id, item.memberName);
                      if (res.ok) {
                        showToast(
                          `Approved ${item.memberName}'s ${item.routine.title} (+${res.pointsDelta ?? item.routine.points} pts)!`,
                        );
                      }
                    }}
                  >
                    Approve +{item.routine.points}
                  </SoftButton>
                </div>
              </div>
            ))}
          </div>
        </Surface>
      )}

      {/* Routine Cards */}
      {myTodayRoutines.length === 0 ? (
        <EmptyState
          title="No routines scheduled for today"
          description="You're all clear on your routine schedule today."
          icon="✨"
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {myTodayRoutines.map((routine) => {
            const slotMeta = ROUTINE_SLOT_META[routine.slot] ?? ROUTINE_SLOT_META.morning;
            const allowLegacy = isSingleMemberRoutine(routine, rosterMembers);
            const checked = getMemberCheckedSteps(
              progress,
              routine.id,
              memberName,
              allowLegacy,
            );
            const meta = getMemberCompletionMeta(
              progress,
              routine.id,
              memberName,
              allowLegacy,
            );
            const totalSteps = routine.steps.length;
            const isComplete =
              meta?.status === "completed" || meta?.status === "approved";
            const isPendingApproval = meta?.status === "pending_approval";
            const pct =
              totalSteps > 0
                ? Math.min(100, Math.round((checked.length / totalSteps) * 100))
                : isComplete
                  ? 100
                  : 0;
            const effectivePenalty =
              routine.missedPenalty !== undefined
                ? routine.missedPenalty
                : settings.accountabilityEnabled
                  ? settings.defaultMissedPenalty
                  : 0;
            const routineBusy = !!busyIds[`routine:${routine.id}:${memberName}`];

            return (
              <Surface
                key={routine.id}
                variant="glass-subtle"
                padding="md"
                data-testid={`today-routine-card-${routine.id}`}
                className={`flex flex-col gap-3 transition ${
                  isComplete
                    ? "border-[var(--color-accent-mint)]/35 bg-[var(--color-accent-mint)]/10"
                    : isPendingApproval
                      ? "border-[var(--color-accent-amber)]/35 bg-[var(--color-accent-amber)]/10"
                      : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="text-2xl">{routine.emoji}</span>
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-text-primary">
                        {routine.title}
                      </div>
                      <div className="text-xs text-text-secondary">
                        {slotMeta.label} · {routine.time} ·{" "}
                        {formatRoutineDaysLabel(routine.daysOfWeek, routine.slot)}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        isComplete
                          ? "bg-[var(--color-accent-mint)]/20 text-[var(--color-accent-ink-mint)]"
                          : isPendingApproval
                            ? "bg-[var(--color-accent-amber)]/20 text-[var(--color-accent-ink-amber)]"
                            : "bg-[var(--color-surface-2)] text-text-secondary"
                      }`}
                    >
                      {isComplete
                        ? `✓ +${meta?.pointsAwarded ?? routine.points} pts`
                        : isPendingApproval
                          ? "⏳ Waiting"
                          : `+${routine.points} pts`}
                    </span>
                    {effectivePenalty > 0 && settings.accountabilityEnabled && !isComplete && (
                      <span className="text-xs text-text-secondary">
                        -{effectivePenalty} if missed
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${pct}%`,
                      background: isComplete
                        ? "var(--color-accent-mint)"
                        : "var(--color-accent-selected)",
                    }}
                  />
                </div>

                {/* Interactive Steps */}
                <div className="space-y-1.5">
                  {routine.steps.map((step) => {
                    const stepDone = checked.includes(step.id);
                    const stepBusy = !!busyIds[`step:${routine.id}:${memberName}`];
                    return (
                      <button
                        key={step.id}
                        type="button"
                        disabled={stepBusy || routineBusy}
                        onClick={() => handleStep(routine, step.id)}
                        className={`hit-44 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${
                          stepDone
                            ? "bg-[var(--color-surface-2)]/60 text-text-secondary line-through"
                            : "bg-[var(--color-surface-2)] text-text-primary hover:bg-[var(--color-surface-1)]"
                        }`}
                      >
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs font-bold ${
                            stepDone
                              ? "border-[var(--color-accent-mint)] bg-[var(--color-accent-mint)] text-white"
                              : "border-border bg-[var(--color-surface-1)]"
                          }`}
                        >
                          {stepDone ? "✓" : ""}
                        </span>
                        <span className="text-base">{step.emoji}</span>
                        <span className="flex-1 text-sm font-medium">{step.title}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-1.5">
                    <SoftButton
                      variant="ghost"
                      size="sm"
                      onClick={() => setFocusRoutine(routine)}
                    >
                      ⏱ Timer
                    </SoftButton>
                    {isParent && onOpenComposer && (
                      <SoftButton
                        variant="ghost"
                        size="sm"
                        onClick={() => onOpenComposer(routine)}
                      >
                        ✏️ Edit
                      </SoftButton>
                    )}
                  </div>
                  <SoftButton
                    variant={isComplete || isPendingApproval ? "secondary" : "primary"}
                    size="sm"
                    loading={routineBusy}
                    onClick={() => handleToggleAll(routine, isComplete || isPendingApproval)}
                  >
                    {isComplete
                      ? "Undo"
                      : isPendingApproval
                        ? "Cancel Submission"
                        : `Check Off (+${routine.points})`}
                  </SoftButton>
                </div>
              </Surface>
            );
          })}
        </div>
      )}

      <RoutineFocusTimerModal
        routine={focusRoutine}
        open={focusRoutine !== null}
        onClose={() => setFocusRoutine(null)}
      />
    </section>
  );
}
