"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SectionCard from "@/components/patterns/SectionCard";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import Modal from "@/components/ui/Modal";
import TextField from "@/components/ui/TextField";
import EmptyState from "@/components/ui/EmptyState";
import { localTodayISO } from "@/lib/local-date";
import {
  DEFAULT_ROUTINES,
  ROUTINE_SLOT_META,
  type DailyRoutineProgress,
  type FamilyRoutine,
  type RoutineSlot,
  type RoutineStep,
} from "@/types/routines";

const SLOTS: RoutineSlot[] = ["morning", "afternoon", "evening", "weekend"];
const POINT_OPTIONS = [10, 15, 20, 30];

interface RoutinesPanelProps {
  filterMember?: string;
  allMembers?: string[];
  canManage?: boolean;
}

export default function RoutinesPanel({
  filterMember = "All",
  allMembers = [],
  canManage = true,
}: RoutinesPanelProps) {
  const todayISO = useMemo(() => localTodayISO(), []);
  const [routines, setRoutines] = useState<FamilyRoutine[]>(DEFAULT_ROUTINES);
  const [progress, setProgress] = useState<DailyRoutineProgress>({
    checkedSteps: {},
    completedRoutines: {},
  });
  const [slotFilter, setSlotFilter] = useState<"all" | RoutineSlot>("all");
  const [loading, setLoading] = useState(true);

  // Composer / Editor modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftEmoji, setDraftEmoji] = useState("☀️");
  const [draftSlot, setDraftSlot] = useState<RoutineSlot>("morning");
  const [draftTime, setDraftTime] = useState("07:30");
  const [draftAssignee, setDraftAssignee] = useState("All");
  const [draftPoints, setDraftPoints] = useState<number>(15);
  const [draftSteps, setDraftSteps] = useState<Array<{ id: string; title: string; emoji: string }>>([]);
  const [saving, setSaving] = useState(false);

  // Load routines and progress from server
  const loadData = useCallback(async () => {
    try {
      const [routinesRes, progressRes] = await Promise.all([
        fetch("/api/routines").then((r) => r.json()).catch(() => null),
        fetch(`/api/routines/progress?date=${todayISO}`).then((r) => r.json()).catch(() => null),
      ]);

      if (routinesRes?.ok && Array.isArray(routinesRes.routines)) {
        setRoutines(routinesRes.routines);
      }
      if (progressRes?.ok && progressRes.progress) {
        setProgress(progressRes.progress);
      }
    } finally {
      setLoading(false);
    }
  }, [todayISO]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Filter routines by slot and assignee
  const filteredRoutines = useMemo(() => {
    return routines.filter((r) => {
      if (slotFilter !== "all" && r.slot !== slotFilter) return false;
      if (
        filterMember &&
        filterMember !== "All" &&
        filterMember !== "Open" &&
        filterMember !== "My Tasks" &&
        r.assignee !== "All" &&
        r.assignee.toLowerCase() !== filterMember.toLowerCase()
      ) {
        return false;
      }
      return true;
    });
  }, [routines, slotFilter, filterMember]);

  // Toggle a step's completed status
  const handleToggleStep = useCallback(
    async (routine: FamilyRoutine, stepId: string) => {
      const current = progress.checkedSteps[routine.id] ?? [];
      const exists = current.includes(stepId);
      const nextSteps = exists ? current.filter((id) => id !== stepId) : [...current, stepId];
      const allDone = routine.steps.length > 0 && nextSteps.length >= routine.steps.length;

      const nextProgress: DailyRoutineProgress = {
        checkedSteps: {
          ...progress.checkedSteps,
          [routine.id]: nextSteps,
        },
        completedRoutines: {
          ...progress.completedRoutines,
          [routine.id]: allDone,
        },
      };

      // Optimistic update
      setProgress(nextProgress);

      // Persist to server
      try {
        await fetch("/api/routines/progress", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: todayISO, progress: nextProgress }),
        });
      } catch (err) {
        console.error("Failed to save routine progress", err);
      }
    },
    [progress, todayISO]
  );

  // Open modal to add a new routine
  const handleOpenAdd = useCallback(() => {
    setEditingId(null);
    setDraftTitle("");
    setDraftEmoji("☀️");
    setDraftSlot("morning");
    setDraftTime("07:30");
    setDraftAssignee(filterMember !== "All" && filterMember !== "Open" && filterMember !== "My Tasks" ? filterMember : "All");
    setDraftPoints(15);
    setDraftSteps([
      { id: `step-${Date.now()}-1`, title: "First habit step", emoji: "✨" },
      { id: `step-${Date.now()}-2`, title: "Second habit step", emoji: "✨" },
    ]);
    setModalOpen(true);
  }, [filterMember]);

  // Open modal to edit an existing routine
  const handleOpenEdit = useCallback((routine: FamilyRoutine) => {
    setEditingId(routine.id);
    setDraftTitle(routine.title);
    setDraftEmoji(routine.emoji);
    setDraftSlot(routine.slot);
    setDraftTime(routine.time);
    setDraftAssignee(routine.assignee);
    setDraftPoints(routine.points);
    setDraftSteps(
      routine.steps.map((s) => ({
        id: s.id,
        title: s.title,
        emoji: s.emoji || "✨",
      }))
    );
    setModalOpen(true);
  }, []);

  // Save routine changes to server
  const handleSaveRoutine = useCallback(async () => {
    if (!draftTitle.trim()) return;
    setSaving(true);

    const validSteps: RoutineStep[] = draftSteps
      .filter((s) => s.title.trim().length > 0)
      .map((s, idx) => ({
        id: s.id || `s-${idx}-${Date.now()}`,
        title: s.title.trim(),
        emoji: s.emoji.trim() || "✨",
      }));

    const cleanSteps =
      validSteps.length > 0
        ? validSteps
        : [{ id: `s-1-${Date.now()}`, title: "Complete routine", emoji: "✓" }];

    const routineToSave: FamilyRoutine = {
      id: editingId || `rt-${Date.now()}`,
      title: draftTitle.trim(),
      emoji: draftEmoji.trim() || "⏰",
      slot: draftSlot,
      time: draftTime.trim() || "08:00",
      assignee: draftAssignee,
      points: Number(draftPoints) || 15,
      steps: cleanSteps,
    };

    const nextRoutines = editingId
      ? routines.map((r) => (r.id === editingId ? routineToSave : r))
      : [...routines, routineToSave];

    setRoutines(nextRoutines);
    setModalOpen(false);

    try {
      await fetch("/api/routines", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routines: nextRoutines }),
      });
    } catch (err) {
      console.error("Failed to save routines", err);
    } finally {
      setSaving(false);
    }
  }, [draftTitle, draftSteps, draftEmoji, draftSlot, draftTime, draftAssignee, draftPoints, editingId, routines]);

  // Delete an existing routine
  const handleDeleteRoutine = useCallback(async () => {
    if (!editingId) return;
    setSaving(true);
    const nextRoutines = routines.filter((r) => r.id !== editingId);
    setRoutines(nextRoutines);
    setModalOpen(false);

    try {
      await fetch("/api/routines", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routines: nextRoutines }),
      });
    } catch (err) {
      console.error("Failed to delete routine", err);
    } finally {
      setSaving(false);
    }
  }, [editingId, routines]);

  const memberOptions = useMemo(() => {
    const custom = allMembers.filter(
      (m) => m !== "All" && m !== "Open" && m !== "My Tasks"
    );
    return ["All", ...custom];
  }, [allMembers]);

  return (
    <div id="tasks-routines-panel" role="tabpanel" aria-labelledby="tasks-view-switch" className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-text-primary">
            Family Routine Checklists
          </h2>
          <p className="text-sm text-text-secondary">
            Time-of-day habit checklists for the family wall and devices
          </p>
        </div>

        {canManage && (
          <SoftButton
            variant="primary"
            onClick={handleOpenAdd}
            className="self-start sm:self-auto"
          >
            + Add Routine
          </SoftButton>
        )}
      </div>

      {/* Time Slot Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSlotFilter("all")}
          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
            slotFilter === "all"
              ? "bg-[var(--color-accent-selected)] text-white shadow-sm"
              : "border border-border bg-[var(--color-surface-2)] text-text-secondary hover:text-text-primary"
          }`}
        >
          All ({routines.length})
        </button>
        {SLOTS.map((slot) => {
          const meta = ROUTINE_SLOT_META[slot];
          const count = routines.filter((r) => r.slot === slot).length;
          const active = slotFilter === slot;
          return (
            <button
              key={slot}
              type="button"
              onClick={() => setSlotFilter(slot)}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
                active
                  ? "bg-[var(--color-accent-selected)] text-white shadow-sm"
                  : "border border-border bg-[var(--color-surface-2)] text-text-secondary hover:text-text-primary"
              }`}
            >
              <span>{meta.emoji}</span>
              <span>{meta.label}</span>
              <span className="opacity-75">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Routines Grid */}
      {filteredRoutines.length === 0 ? (
        <EmptyState
          title="No routines found"
          description={
            slotFilter !== "all"
              ? `No routines found for the ${ROUTINE_SLOT_META[slotFilter].label} slot.`
              : "No routines configured. Click '+ Add Routine' to create your first family habit checklist."
          }
          icon="⏰"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filteredRoutines.map((routine) => {
            const slotMeta = ROUTINE_SLOT_META[routine.slot] || ROUTINE_SLOT_META.morning;
            const checked = progress.checkedSteps[routine.id] ?? [];
            const totalSteps = routine.steps.length;
            const completedCount = checked.length;
            const pct = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0;
            const isAllDone = totalSteps > 0 && completedCount >= totalSteps;

            return (
              <Surface
                key={routine.id}
                className="flex flex-col justify-between overflow-hidden rounded-3xl border border-border bg-[var(--color-surface-1)] p-5 transition-all hover:border-[var(--color-accent-selected)]/40 shadow-sm"
              >
                <div>
                  {/* Routine Top Row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-surface-2)] text-2xl shadow-inner">
                        {routine.emoji || slotMeta.emoji}
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-text-primary">
                          {routine.title}
                        </h3>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="rounded-md bg-[var(--color-surface-2)] px-2 py-0.5 font-medium text-text-secondary">
                            ⏰ {routine.time}
                          </span>
                          <span className="rounded-md bg-[var(--color-surface-2)] px-2 py-0.5 font-medium text-text-secondary">
                            👤 {routine.assignee}
                          </span>
                          <span className="rounded-md bg-[var(--color-accent-amber)]/15 px-2 py-0.5 font-semibold text-[var(--color-accent-amber)]">
                            +{routine.points} pts
                          </span>
                        </div>
                      </div>
                    </div>

                    {canManage && (
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(routine)}
                        className="rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-[var(--color-surface-2)] hover:text-text-primary"
                        aria-label={`Edit ${routine.title}`}
                        title="Edit routine"
                      >
                        ✏️
                      </button>
                    )}
                  </div>

                  {/* Progress Bar */}
                  <div className="mt-4">
                    <div className="flex justify-between text-xs font-medium text-text-secondary">
                      <span>
                        {completedCount} of {totalSteps} completed
                      </span>
                      <span>{pct}%</span>
                    </div>
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                      <div
                        className={`h-full transition-all duration-300 ${
                          isAllDone
                            ? "bg-[var(--color-accent-emerald)]"
                            : "bg-[var(--color-accent-selected)]"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  {/* Checklist Steps */}
                  <div className="mt-4 space-y-2">
                    {routine.steps.map((step) => {
                      const isStepDone = checked.includes(step.id);
                      return (
                        <button
                          key={step.id}
                          type="button"
                          onClick={() => handleToggleStep(routine, step.id)}
                          className={`flex w-full items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left text-sm transition-all ${
                            isStepDone
                              ? "border-[var(--color-accent-emerald)]/30 bg-[var(--color-accent-emerald)]/10 text-text-secondary"
                              : "border-border bg-[var(--color-surface-2)] text-text-primary hover:border-border/80"
                          }`}
                        >
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs transition-colors ${
                              isStepDone
                                ? "border-[var(--color-accent-emerald)] bg-[var(--color-accent-emerald)] text-white"
                                : "border-border bg-[var(--color-surface-1)]"
                            }`}
                          >
                            {isStepDone ? "✓" : ""}
                          </span>
                          <span className="text-base">{step.emoji || "✨"}</span>
                          <span
                            className={`flex-1 font-medium ${
                              isStepDone ? "line-through opacity-75" : ""
                            }`}
                          >
                            {step.title}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* All Done Celebration Badge */}
                {isAllDone && (
                  <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-[var(--color-accent-emerald)]/15 py-2 text-xs font-bold text-[var(--color-accent-emerald)]">
                    <span>🎉</span>
                    <span>All steps completed! +{routine.points} pts earned</span>
                  </div>
                )}
              </Surface>
            );
          })}
        </div>
      )}

      {/* Routine Add / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? "Edit Routine" : "Add Routine"}
        description="Configure checklist habits for the family wall and dashboard"
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            {editingId ? (
              <SoftButton
                variant="danger"
                onClick={handleDeleteRoutine}
                disabled={saving}
              >
                Delete
              </SoftButton>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <SoftButton
                variant="secondary"
                onClick={() => setModalOpen(false)}
                disabled={saving}
              >
                Cancel
              </SoftButton>
              <SoftButton
                variant="primary"
                onClick={handleSaveRoutine}
                disabled={saving || !draftTitle.trim()}
              >
                {saving ? "Saving..." : "Save Routine"}
              </SoftButton>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Title & Emoji */}
          <div className="grid grid-cols-[3rem_1fr] gap-3">
            <TextField
              label="Icon"
              value={draftEmoji}
              onChange={(e) => setDraftEmoji(e.target.value)}
              placeholder="☀️"
              maxLength={4}
            />
            <TextField
              label="Routine Title"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="e.g. Morning Launchpad"
              autoFocus
            />
          </div>

          {/* Slot & Time */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                Time Slot
              </span>
              <select
                value={draftSlot}
                onChange={(e) => setDraftSlot(e.target.value as RoutineSlot)}
                className="w-full rounded-2xl border border-border bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none"
              >
                {SLOTS.map((slot) => (
                  <option key={slot} value={slot}>
                    {ROUTINE_SLOT_META[slot].emoji} {ROUTINE_SLOT_META[slot].label}
                  </option>
                ))}
              </select>
            </label>

            <TextField
              label="Target Time"
              value={draftTime}
              onChange={(e) => setDraftTime(e.target.value)}
              placeholder="07:30"
            />
          </div>

          {/* Assignee & Points */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                Assignee
              </span>
              <select
                value={draftAssignee}
                onChange={(e) => setDraftAssignee(e.target.value)}
                className="w-full rounded-2xl border border-border bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none"
              >
                {memberOptions.map((m) => (
                  <option key={m} value={m}>
                    {m === "All" ? "👥 Everyone" : `👤 ${m}`}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                Reward Points
              </span>
              <div className="grid grid-cols-4 gap-1.5">
                {POINT_OPTIONS.map((pts) => (
                  <button
                    key={pts}
                    type="button"
                    onClick={() => setDraftPoints(pts)}
                    className={`rounded-xl py-2 text-xs font-bold transition-all ${
                      draftPoints === pts
                        ? "bg-[var(--color-accent-selected)] text-white shadow-sm"
                        : "border border-border bg-[var(--color-surface-2)] text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    +{pts}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Checklist Steps Editor */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                Checklist Steps ({draftSteps.length})
              </span>
              <button
                type="button"
                onClick={() =>
                  setDraftSteps((prev) => [
                    ...prev,
                    { id: `step-${Date.now()}`, title: "", emoji: "✨" },
                  ])
                }
                className="text-xs font-semibold text-[var(--color-accent-selected)] hover:underline"
              >
                + Add Step
              </button>
            </div>

            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {draftSteps.map((step, idx) => (
                <div key={step.id || idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={step.emoji}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDraftSteps((prev) =>
                        prev.map((s, i) => (i === idx ? { ...s, emoji: val } : s))
                      );
                    }}
                    placeholder="✨"
                    className="w-12 rounded-xl border border-border bg-[var(--color-surface-2)] py-2 text-center text-sm text-text-primary outline-none"
                    maxLength={4}
                  />
                  <input
                    type="text"
                    value={step.title}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDraftSteps((prev) =>
                        prev.map((s, i) => (i === idx ? { ...s, title: val } : s))
                      );
                    }}
                    placeholder={`Step ${idx + 1}`}
                    className="flex-1 rounded-xl border border-border bg-[var(--color-surface-2)] px-3 py-2 text-sm text-text-primary outline-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDraftSteps((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="rounded-lg p-2 text-text-secondary hover:bg-[var(--color-surface-2)] hover:text-[var(--color-accent-rose)]"
                    title="Remove step"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
