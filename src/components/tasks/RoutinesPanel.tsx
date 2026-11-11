"use client";

import { useMemo, useState } from "react";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import EmptyState from "@/components/ui/EmptyState";
import { db } from "@/db";
import { useAuth } from "@/hooks/useAuth";
import { useRoutines } from "@/hooks/useRoutines";
import {
  ParentPinPromptModal,
  RoutineComposerModal,
  RoutineFocusTimerModal,
  RoutineSettingsModal,
} from "@/components/routines/RoutineModals";
import {
  ROUTINE_SLOT_META,
  type FamilyRoutine,
  type RoutineSettings,
  type RoutineSlot,
} from "@/types/routines";
import {
  formatRoutineDaysLabel,
  formatRoutineTargetsLabel,
  getMemberCheckedSteps,
  getMemberCompletionMeta,
  isRoutineScheduledForDate,
  isSingleMemberRoutine,
  memberKey,
  resolveRoutineTargets,
  routineAppliesToMember,
  type RoutineRosterMember,
} from "@/lib/routine-rules";

const SLOTS: RoutineSlot[] = ["morning", "afternoon", "evening", "weekend"];

interface RoutinesPanelProps {
  filterMember?: string;
  allMembers?: string[];
  canManage?: boolean;
}

type PendingParentOp =
  | { kind: "upsert_routine"; routine: FamilyRoutine }
  | { kind: "delete_routine"; routineId: string }
  | { kind: "update_settings"; settings: RoutineSettings }
  | { kind: "excuse_missed"; entryId: string }
  | { kind: "approve_routine"; routineId: string; memberName: string }
  | { kind: "send_back_routine"; routineId: string; memberName: string };

export default function RoutinesPanel({
  filterMember = "All",
  allMembers = [],
  canManage = false,
}: RoutinesPanelProps) {
  const { currentUser, isLoggedIn } = useAuth();
  const {
    todayISO,
    yesterdayISO,
    routines,
    settings,
    progress,
    accountability,
    loading,
    busyIds,
    toggleStep,
    completeRoutine,
    uncompleteRoutine,
    approveRoutine,
    sendBackRoutine,
    excuseMissed,
    upsertRoutine,
    deleteRoutine,
    updateSettings,
  } = useRoutines();

  const detailedRoster = db.selectMembers();
  const rosterMembers: RoutineRosterMember[] =
    detailedRoster.length > 0
      ? detailedRoster.map((m: any) => ({
          id: m.pbId,
          name: m.name,
          fullName: m.fullName || m.name,
          role: m.role,
          emoji: m.emoji,
        }))
      : allMembers
          .filter((n) => n && n !== "All")
          .map((n) => ({ name: n, fullName: n }));

  const isParentSession =
    canManage || (isLoggedIn && currentUser?.role?.toLowerCase() === "parent");
  const isChildSession =
    isLoggedIn && !!currentUser && currentUser.role?.toLowerCase() !== "parent";

  const [slotFilter, setSlotFilter] = useState<RoutineSlot | "all">("all");
  const [scheduleScope, setScheduleScope] = useState<"today" | "week">("today");
  const [selectedCardActor, setSelectedCardActor] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [editingRoutine, setEditingRoutine] = useState<FamilyRoutine | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [focusRoutine, setFocusRoutine] = useState<FamilyRoutine | null>(null);

  const [pendingOp, setPendingOp] = useState<PendingParentOp | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSubmitting, setPinSubmitting] = useState(false);

  const showToast = (msg: string) => {
    setErrorBanner(null);
    setBanner(msg);
    setTimeout(() => {
      setBanner((prev) => (prev === msg ? null : prev));
    }, 3500);
  };

  const specificFilterMember = useMemo(() => {
    const f = (filterMember || "All").trim();
    if (
      f === "All" ||
      f === "Open" ||
      f === "My Tasks" ||
      f === "Kids" ||
      f === "Adults"
    ) {
      if (f === "My Tasks" && currentUser?.name) return currentUser.name;
      return null;
    }
    return f;
  }, [filterMember, currentUser]);

  const filteredRoutines = useMemo(() => {
    return routines.filter((r) => {
      if (slotFilter !== "all" && r.slot !== slotFilter) return false;
      if (scheduleScope === "today" && !isRoutineScheduledForDate(r, todayISO)) {
        return false;
      }
      if (specificFilterMember) {
        return routineAppliesToMember(r, specificFilterMember, rosterMembers);
      }
      if (filterMember === "Kids") {
        const targets = resolveRoutineTargets(r, rosterMembers);
        return targets.some((t) => t.role === "child");
      }
      if (filterMember === "Adults") {
        const targets = resolveRoutineTargets(r, rosterMembers);
        return targets.some((t) => t.role === "parent");
      }
      return true;
    });
  }, [
    routines,
    slotFilter,
    scheduleScope,
    todayISO,
    specificFilterMember,
    filterMember,
    rosterMembers,
  ]);

  const unexcusedMissed = useMemo(() => {
    return accountability.missedEntries.filter((e) => {
      if (e.excused) return false;
      if (e.date < yesterdayISO) return false;
      if (specificFilterMember) {
        return e.memberKey === memberKey(specificFilterMember);
      }
      return true;
    });
  }, [accountability.missedEntries, yesterdayISO, specificFilterMember]);

  const pendingApprovals = useMemo(() => {
    const list: Array<{ key: string; routine: FamilyRoutine; memberName: string }> = [];
    for (const [key, meta] of Object.entries(progress.memberCompleted ?? {})) {
      if (meta.status !== "pending_approval") continue;
      const [routineId] = key.split("::");
      const rt = routines.find((r) => r.id === routineId);
      if (!rt) continue;
      if (
        specificFilterMember &&
        memberKey(meta.by) !== memberKey(specificFilterMember)
      ) {
        continue;
      }
      list.push({ key, routine: rt, memberName: meta.by });
    }
    return list;
  }, [progress.memberCompleted, routines, specificFilterMember]);

  const resolveActiveActorForCard = (routine: FamilyRoutine): string => {
    if (isChildSession && currentUser?.name) return currentUser.name;
    if (specificFilterMember) return specificFilterMember;
    const explicit = selectedCardActor[routine.id];
    if (explicit) return explicit;
    const targets = resolveRoutineTargets(routine, rosterMembers);
    if (currentUser?.name) {
      const signedMatch = targets.find(
        (t) =>
          memberKey(t.fullName || t.name) === memberKey(currentUser.name) ||
          (t.name &&
            t.name.toLowerCase() === currentUser.name.split(" ")[0]?.toLowerCase()),
      );
      if (signedMatch) return signedMatch.fullName || signedMatch.name;
    }
    return targets[0]?.fullName || targets[0]?.name || rosterMembers[0]?.name || "";
  };

  const executeParentOp = async (op: PendingParentOp, pin?: string) => {
    if (op.kind === "upsert_routine") {
      const res = await upsertRoutine(op.routine, pin);
      if (!res.ok) return res;
      setComposerOpen(false);
      setEditingRoutine(null);
      showToast(`Saved routine "${op.routine.title}".`);
      return res;
    }
    if (op.kind === "delete_routine") {
      const res = await deleteRoutine(op.routineId, pin);
      if (!res.ok) return res;
      showToast("Routine removed.");
      return res;
    }
    if (op.kind === "update_settings") {
      const res = await updateSettings(op.settings, pin);
      if (!res.ok) return res;
      setSettingsOpen(false);
      showToast("Routine point rules & accountability updated.");
      return res;
    }
    if (op.kind === "excuse_missed") {
      const res = await excuseMissed(op.entryId, pin);
      if (!res.ok) return res;
      showToast("Missed routine excused & points refunded if applicable.");
      return res;
    }
    if (op.kind === "approve_routine") {
      const res = await approveRoutine(op.routineId, op.memberName, pin);
      if (!res.ok) return res;
      showToast(
        `Approved ${op.memberName} (+${res.pointsDelta ?? 0} pts added to leaderboard)!`,
      );
      return res;
    }
    const res = await sendBackRoutine(op.routineId, op.memberName, pin);
    if (!res.ok) return res;
    showToast(`Sent routine back to ${op.memberName}.`);
    return res;
  };

  const runWithParentAuth = async (op: PendingParentOp) => {
    if (isParentSession) {
      const res = await executeParentOp(op);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setPinError(null);
          setPendingOp(op);
          return;
        }
        setErrorBanner(res.error || "Action failed.");
      }
      return;
    }
    setPinError(null);
    setPendingOp(op);
  };

  const handlePinConfirm = async (pin: string) => {
    if (!pendingOp) return;
    setPinSubmitting(true);
    setPinError(null);
    try {
      const res = await executeParentOp(pendingOp, pin);
      if (!res.ok) {
        setPinError(
          res.error === "adult_only"
            ? "A parent PIN is required."
            : res.error === "invalid_pin" || res.status === 401
              ? "Incorrect PIN. Try again."
              : res.error || "Could not complete action.",
        );
        return;
      }
      setPendingOp(null);
    } finally {
      setPinSubmitting(false);
    }
  };

  return (
    <div className="space-y-5" data-testid="routines-panel">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-text-primary">
            Daily & Weekly Routines
          </h2>
          <p className="text-xs text-text-secondary">
            Scheduled per member & day · Completes credit real weekly points ·{" "}
            {settings.accountabilityEnabled
              ? `Auto-penalty -${settings.defaultMissedPenalty} pts at midnight`
              : "Auto-penalties paused"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border border-border bg-[var(--color-surface-2)] p-0.5">
            <button
              type="button"
              onClick={() => setScheduleScope("today")}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                scheduleScope === "today"
                  ? "bg-[var(--color-accent-selected)] text-white"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Scheduled Today
            </button>
            <button
              type="button"
              onClick={() => setScheduleScope("week")}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                scheduleScope === "week"
                  ? "bg-[var(--color-accent-selected)] text-white"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Full Schedule ({routines.length})
            </button>
          </div>

          {!isChildSession && (
            <>
              <SoftButton
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSettingsError(null);
                  setSettingsOpen(true);
                }}
              >
                ⚙️ Point Rules
              </SoftButton>
              <SoftButton
                variant="primary"
                size="sm"
                onClick={() => {
                  setComposerError(null);
                  setEditingRoutine(null);
                  setComposerOpen(true);
                }}
              >
                + Add Routine
              </SoftButton>
            </>
          )}
        </div>
      </div>

      {banner && (
        <div
          role="status"
          className="rounded-2xl border border-[var(--color-accent-mint)]/35 bg-[var(--color-accent-mint)]/15 px-4 py-2.5 text-sm font-medium text-[var(--color-accent-ink-mint)]"
        >
          {banner}
        </div>
      )}

      {errorBanner && (
        <div
          role="alert"
          className="rounded-2xl border border-[var(--color-accent-rose)]/35 bg-[var(--color-accent-rose)]/10 px-4 py-2.5 text-sm font-medium text-[var(--color-accent-ink-rose)]"
        >
          {errorBanner}
        </div>
      )}

      {/* Accountability Banner */}
      {unexcusedMissed.length > 0 && (
        <Surface
          variant="glass-subtle"
          padding="md"
          data-testid="panel-missed-accountability"
          className="border border-[var(--color-accent-rose)]/35 bg-[var(--color-accent-rose)]/10"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-[var(--color-accent-ink-rose)]">
              ⚠️ Missed Yesterday · Accountability Log
            </span>
            <span className="text-xs text-text-secondary">
              {unexcusedMissed.length} unexcused
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {unexcusedMissed.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-[var(--color-surface-1)]/85 px-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium text-text-primary">
                    {entry.routineEmoji} {entry.routineTitle} · {entry.memberName}
                  </div>
                  <div className="text-xs text-text-secondary">
                    {entry.date} · Streak reset
                    {entry.deductedPoints > 0
                      ? ` · -${entry.deductedPoints} pts deducted`
                      : " · 0 pts deducted"}
                  </div>
                </div>
                {!isChildSession && (
                  <SoftButton
                    variant="secondary"
                    size="sm"
                    loading={!!busyIds[`excuse:${entry.id}`]}
                    onClick={() =>
                      runWithParentAuth({ kind: "excuse_missed", entryId: entry.id })
                    }
                  >
                    Excuse{entry.deductedPoints > 0 ? ` +${entry.deductedPoints}` : ""}
                  </SoftButton>
                )}
              </div>
            ))}
          </div>
        </Surface>
      )}

      {/* Pending Approvals Queue */}
      {!isChildSession && pendingApprovals.length > 0 && (
        <Surface
          variant="glass-subtle"
          padding="md"
          data-testid="panel-pending-approvals"
          className="border border-[var(--color-accent-amber)]/35 bg-[var(--color-accent-amber)]/10"
        >
          <div className="mb-2 text-sm font-semibold text-[var(--color-accent-ink-amber)]">
            ⏳ Routines Waiting Parent Approval ({pendingApprovals.length})
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {pendingApprovals.map((item) => (
              <div
                key={item.key}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-[var(--color-surface-1)]/85 px-3 py-2"
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
                    onClick={() =>
                      runWithParentAuth({
                        kind: "send_back_routine",
                        routineId: item.routine.id,
                        memberName: item.memberName,
                      })
                    }
                  >
                    Send Back
                  </SoftButton>
                  <SoftButton
                    variant="primary"
                    size="sm"
                    onClick={() =>
                      runWithParentAuth({
                        kind: "approve_routine",
                        routineId: item.routine.id,
                        memberName: item.memberName,
                      })
                    }
                  >
                    Approve +{item.routine.points}
                  </SoftButton>
                </div>
              </div>
            ))}
          </div>
        </Surface>
      )}

      {/* Slot Filter Pills */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSlotFilter("all")}
          className={`hit-44 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
            slotFilter === "all"
              ? "bg-[var(--color-accent-selected)] text-white"
              : "border border-border bg-[var(--color-surface-2)] text-text-secondary hover:text-text-primary"
          }`}
        >
          All Slots
        </button>
        {SLOTS.map((slot) => {
          const meta = ROUTINE_SLOT_META[slot];
          const active = slotFilter === slot;
          return (
            <button
              key={slot}
              type="button"
              onClick={() => setSlotFilter(slot)}
              className={`hit-44 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                active
                  ? "bg-[var(--color-accent-selected)] text-white"
                  : "border border-border bg-[var(--color-surface-2)] text-text-secondary hover:text-text-primary"
              }`}
            >
              <span>{meta.emoji}</span>
              <span>{meta.label}</span>
            </button>
          );
        })}
      </div>

      {/* Routines Grid */}
      {loading && routines.length === 0 ? (
        <div className="py-10 text-center text-sm text-text-secondary">Loading routines...</div>
      ) : filteredRoutines.length === 0 ? (
        <EmptyState
          title="No routines match this filter"
          description={
            scheduleScope === "today"
              ? "Switch to 'Full Schedule' to view routines scheduled for other days (e.g., Sunday trash)."
              : "Create a routine using '+ Add Routine'."
          }
          icon="⏰"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filteredRoutines.map((routine) => {
            const slotMeta = ROUTINE_SLOT_META[routine.slot] ?? ROUTINE_SLOT_META.morning;
            const targets = resolveRoutineTargets(routine, rosterMembers);
            const activeActor = resolveActiveActorForCard(routine);
            const allowLegacy = isSingleMemberRoutine(routine, rosterMembers);
            const checked = getMemberCheckedSteps(
              progress,
              routine.id,
              activeActor || undefined,
              allowLegacy,
            );
            const completion = getMemberCompletionMeta(
              progress,
              routine.id,
              activeActor || undefined,
              allowLegacy,
            );
            const isComplete =
              completion?.status === "completed" || completion?.status === "approved";
            const isPending = completion?.status === "pending_approval";
            const totalSteps = routine.steps.length;
            const pct =
              totalSteps > 0
                ? Math.min(100, Math.round((checked.length / totalSteps) * 100))
                : isComplete
                  ? 100
                  : 0;
            const actorStreak = activeActor
              ? accountability.streaks[memberKey(activeActor)]?.current ?? 0
              : 0;
            const effectivePenalty =
              routine.missedPenalty !== undefined
                ? routine.missedPenalty
                : settings.accountabilityEnabled
                  ? settings.defaultMissedPenalty
                  : 0;

            return (
              <Surface
                key={routine.id}
                variant="glass-subtle"
                padding="md"
                data-testid={`routine-card-${routine.id}`}
                className={`flex flex-col gap-3 transition ${
                  isComplete
                    ? "border-[var(--color-accent-mint)]/35 bg-[var(--color-accent-mint)]/10"
                    : isPending
                      ? "border-[var(--color-accent-amber)]/35 bg-[var(--color-accent-amber)]/10"
                      : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="text-2xl">{routine.emoji}</span>
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-text-primary">
                        {routine.title}
                      </h3>
                      <p className="text-xs text-text-secondary">
                        {slotMeta.label} · {routine.time} ·{" "}
                        {formatRoutineDaysLabel(routine.daysOfWeek, routine.slot)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        isComplete
                          ? "bg-[var(--color-accent-mint)]/20 text-[var(--color-accent-ink-mint)]"
                          : isPending
                            ? "bg-[var(--color-accent-amber)]/20 text-[var(--color-accent-ink-amber)]"
                            : "bg-[var(--color-surface-2)] text-text-secondary"
                      }`}
                    >
                      {isComplete
                        ? `✓ +${completion?.pointsAwarded ?? routine.points} pts`
                        : isPending
                          ? "⏳ Pending"
                          : `+${routine.points} pts`}
                    </span>
                    <span className="text-xs text-text-secondary">
                      {formatRoutineTargetsLabel(routine)}
                      {effectivePenalty > 0 && settings.accountabilityEnabled
                        ? ` · -${effectivePenalty} if missed`
                        : ""}
                    </span>
                  </div>
                </div>

                {/* Member switcher when viewing a group routine in "All" */}
                {!specificFilterMember && !isChildSession && targets.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-text-secondary">
                      Checking for:
                    </span>
                    {targets.map((t) => {
                      const tName = t.fullName || t.name;
                      const active = memberKey(tName) === memberKey(activeActor);
                      const tMeta = getMemberCompletionMeta(progress, routine.id, tName, false);
                      const tDone = tMeta?.status === "completed" || tMeta?.status === "approved";
                      return (
                        <button
                          key={tName}
                          type="button"
                          onClick={() =>
                            setSelectedCardActor((prev) => ({ ...prev, [routine.id]: tName }))
                          }
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                            active
                              ? "bg-[var(--color-accent-selected)] text-white"
                              : "border border-border bg-[var(--color-surface-2)] text-text-secondary hover:text-text-primary"
                          }`}
                        >
                          {tDone ? "✓ " : ""}
                          {t.emoji ? `${t.emoji} ` : ""}
                          {tName.split(" ")[0]}
                        </button>
                      );
                    })}
                    {actorStreak > 0 && (
                      <span className="ml-auto text-xs font-semibold text-[var(--color-accent-ink-amber)]">
                        🔥 {actorStreak}d
                      </span>
                    )}
                  </div>
                )}

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

                <div className="space-y-1.5">
                  {routine.steps.map((step) => {
                    const stepDone = checked.includes(step.id);
                    return (
                      <button
                        key={step.id}
                        type="button"
                        disabled={!activeActor || !!busyIds[`step:${routine.id}:${activeActor}`]}
                        onClick={async () => {
                          if (!activeActor) return;
                          const res = await toggleStep(routine.id, step.id, activeActor);
                          if (!res.ok) {
                            setErrorBanner(res.error || "Could not update step.");
                            return;
                          }
                          if (res.completion?.status === "pending_approval") {
                            showToast(`${routine.title} sent for parent approval!`);
                          } else if (res.pointsDelta && res.pointsDelta > 0) {
                            showToast(
                              `🎉 ${activeActor.split(" ")[0]} finished ${routine.title}! +${res.pointsDelta} pts posted to leaderboard`,
                            );
                          }
                        }}
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
                    {!isChildSession && (
                      <>
                        <SoftButton
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setComposerError(null);
                            setEditingRoutine(routine);
                            setComposerOpen(true);
                          }}
                        >
                          ✏️ Edit
                        </SoftButton>
                        <SoftButton
                          variant="ghost"
                          size="sm"
                          className="text-[var(--color-accent-ink-rose)]"
                          onClick={() =>
                            runWithParentAuth({
                              kind: "delete_routine",
                              routineId: routine.id,
                            })
                          }
                        >
                          🗑
                        </SoftButton>
                      </>
                    )}
                  </div>

                  {activeActor && (
                    <SoftButton
                      variant={isComplete || isPending ? "secondary" : "primary"}
                      size="sm"
                      loading={!!busyIds[`routine:${routine.id}:${activeActor}`]}
                      onClick={async () => {
                        const res =
                          isComplete || isPending
                            ? await uncompleteRoutine(routine.id, activeActor)
                            : await completeRoutine(routine.id, activeActor);
                        if (!res.ok) {
                          setErrorBanner(res.error || "Could not update routine.");
                          return;
                        }
                        if (res.completion?.status === "pending_approval") {
                          showToast(`${routine.title} sent for parent approval!`);
                        } else if (!isComplete && res.pointsDelta && res.pointsDelta > 0) {
                          showToast(
                            `🎉 ${activeActor.split(" ")[0]} earned +${res.pointsDelta} pts!`,
                          );
                        }
                      }}
                    >
                      {isComplete
                        ? "Undo"
                        : isPending
                          ? "Cancel"
                          : `Complete (+${routine.points})`}
                    </SoftButton>
                  )}
                </div>
              </Surface>
            );
          })}
        </div>
      )}

      <RoutineComposerModal
        open={composerOpen}
        onClose={() => {
          setComposerOpen(false);
          setEditingRoutine(null);
        }}
        editingRoutine={editingRoutine}
        rosterMembers={rosterMembers}
        settings={settings}
        error={composerError}
        onSave={async (routine) => {
          await runWithParentAuth({ kind: "upsert_routine", routine });
        }}
      />

      <RoutineSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        error={settingsError}
        onSave={async (next) => {
          await runWithParentAuth({ kind: "update_settings", settings: next });
        }}
      />

      <ParentPinPromptModal
        open={pendingOp !== null}
        onClose={() => setPendingOp(null)}
        error={pinError}
        loading={pinSubmitting}
        onSubmit={handlePinConfirm}
      />

      <RoutineFocusTimerModal
        routine={focusRoutine}
        open={focusRoutine !== null}
        onClose={() => setFocusRoutine(null)}
      />
    </div>
  );
}
