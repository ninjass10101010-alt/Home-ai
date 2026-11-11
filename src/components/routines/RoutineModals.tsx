"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";
import TextField from "@/components/ui/TextField";
import {
  ALL_ROUTINE_DAYS,
  ROUTINE_DAY_META,
  ROUTINE_SLOT_META,
  WEEKDAY_ROUTINE_DAYS,
  WEEKEND_ROUTINE_DAYS,
  type FamilyRoutine,
  type RoutineDayCode,
  type RoutineSettings,
  type RoutineSlot,
  type RoutineStep,
} from "@/types/routines";
import {
  effectiveDaysOfWeek,
  rawRoutineTargets,
  type RoutineRosterMember,
} from "@/lib/routine-rules";

const SLOTS: RoutineSlot[] = ["morning", "afternoon", "evening", "weekend"];
const EMOJI_PRESETS = ["☀️", "🪥", "🎒", "🧹", "🌙", "📚", "🗑️", "🧽", "🐶", "🧺"];
const POINT_PRESETS = [5, 10, 15, 25, 50];

export function RoutineFocusTimerModal({
  routine,
  open,
  onClose,
}: {
  routine: FamilyRoutine | null;
  open: boolean;
  onClose: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(300);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!open || !running) return;
    const t = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [open, running]);

  if (!routine) return null;

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;

  return (
    <Modal open={open} onClose={onClose} title={`Focus Timer · ${routine.emoji} ${routine.title}`}>
      <div className="space-y-5 py-2 text-center">
        <div className="mx-auto flex h-40 w-40 flex-col items-center justify-center rounded-full border-4 border-[var(--color-accent-selected)] bg-[var(--color-surface-2)] shadow-inner">
          <div className="text-4xl font-bold tabular-nums text-text-primary">
            {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
          </div>
          <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-text-secondary">
            {secondsLeft === 0 ? "Time's Up! 🎉" : running ? "Focusing..." : "Paused"}
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {[120, 300, 600, 900].map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => {
                setRunning(false);
                setSecondsLeft(sec);
              }}
              className="hit-44 rounded-full border border-border bg-[var(--color-surface-2)] px-4 py-2 text-xs font-semibold text-text-secondary hover:text-text-primary"
            >
              {sec / 60}m
            </button>
          ))}
        </div>

        <div className="flex justify-center gap-3">
          <SoftButton
            variant={running ? "secondary" : "primary"}
            onClick={() => setRunning((prev) => !prev)}
          >
            {running ? "Pause" : secondsLeft === 0 ? "Restart" : "Start Timer"}
          </SoftButton>
          <SoftButton
            variant="ghost"
            onClick={() => {
              setRunning(false);
              setSecondsLeft(300);
            }}
          >
            Reset
          </SoftButton>
        </div>
      </div>
    </Modal>
  );
}

export interface RoutineComposerProps {
  open: boolean;
  onClose: () => void;
  editingRoutine: FamilyRoutine | null;
  rosterMembers: RoutineRosterMember[];
  settings: RoutineSettings;
  onSave: (routine: FamilyRoutine) => Promise<void> | void;
  saving?: boolean;
  error?: string | null;
}

export function RoutineComposerModal(props: RoutineComposerProps) {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={
        props.editingRoutine
          ? `Edit Routine · ${props.editingRoutine.title}`
          : "Add New Routine"
      }
      panelClassName="max-w-xl"
    >
      {props.open ? (
        <RoutineComposerForm
          key={`${props.editingRoutine?.id ?? "new"}:${props.settings.defaultPoints}`}
          {...props}
        />
      ) : null}
    </Modal>
  );
}

function initialTargetState(editingRoutine: FamilyRoutine | null): {
  mode: "group" | "members";
  group: "All" | "Kids" | "Adults";
  members: string[];
} {
  if (!editingRoutine) {
    return { mode: "group", group: "All", members: [] };
  }
  const raw = rawRoutineTargets(editingRoutine);
  const first = raw[0]?.toLowerCase() ?? "all";
  if (raw.length === 1 && (first === "all" || first === "kids" || first === "adults")) {
    return {
      mode: "group",
      group: first === "kids" ? "Kids" : first === "adults" ? "Adults" : "All",
      members: [],
    };
  }
  return { mode: "members", group: "All", members: raw };
}

function RoutineComposerForm({
  onClose,
  editingRoutine,
  rosterMembers,
  settings,
  onSave,
  saving = false,
  error,
}: RoutineComposerProps) {
  const initTarget = initialTargetState(editingRoutine);
  const [title, setTitle] = useState(editingRoutine?.title ?? "");
  const [emoji, setEmoji] = useState(editingRoutine?.emoji || "☀️");
  const [slot, setSlot] = useState<RoutineSlot>(editingRoutine?.slot || "morning");
  const [time, setTime] = useState(editingRoutine?.time || "07:30");
  const [targetMode, setTargetMode] = useState<"group" | "members">(initTarget.mode);
  const [groupTarget, setGroupTarget] = useState<"All" | "Kids" | "Adults">(initTarget.group);
  const [selectedMembers, setSelectedMembers] = useState<string[]>(initTarget.members);
  const [daysOfWeek, setDaysOfWeek] = useState<RoutineDayCode[]>(
    editingRoutine ? effectiveDaysOfWeek(editingRoutine) : [...ALL_ROUTINE_DAYS],
  );
  const [pointsText, setPointsText] = useState(
    String(editingRoutine?.points ?? settings.defaultPoints),
  );
  const [penaltyText, setPenaltyText] = useState(
    editingRoutine?.missedPenalty === undefined ? "" : String(editingRoutine.missedPenalty),
  );
  const [requiresApproval, setRequiresApproval] = useState(
    editingRoutine?.requiresApproval ?? settings.defaultRequiresApproval,
  );
  const [steps, setSteps] = useState<RoutineStep[]>(() =>
    editingRoutine
      ? editingRoutine.steps.length > 0
        ? [...editingRoutine.steps]
        : [{ id: "st-draft-1", title: "Complete checklist", emoji: "✅" }]
      : [
          { id: "st-draft-1", title: "Step 1", emoji: "✨" },
          { id: "st-draft-2", title: "Step 2", emoji: "✅" },
        ],
  );
  const [newStepTitle, setNewStepTitle] = useState("");
  const [newStepEmoji, setNewStepEmoji] = useState("✨");

  const toggleDay = (day: RoutineDayCode) => {
    setDaysOfWeek((prev) => {
      if (prev.includes(day)) {
        return prev.length <= 1 ? prev : prev.filter((d) => d !== day);
      }
      return ALL_ROUTINE_DAYS.filter((d) => prev.includes(d) || d === day);
    });
  };

  const toggleMember = (name: string) => {
    setTargetMode("members");
    setSelectedMembers((prev) =>
      prev.includes(name) ? prev.filter((m) => m !== name) : [...prev, name],
    );
  };

  const addDraftStep = () => {
    const clean = newStepTitle.trim();
    if (!clean) return;
    setSteps((prev) => [
      ...prev,
      { id: `st-${Date.now()}-${prev.length + 1}`, title: clean, emoji: newStepEmoji || "✓" },
    ]);
    setNewStepTitle("");
  };

  const submit = async () => {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    const validSteps = steps.filter((s) => s.title.trim().length > 0);
    if (validSteps.length === 0) return;

    const points = Math.max(0, Math.min(500, Math.round(Number(pointsText) || 0)));
    const trimmedPenalty = penaltyText.trim();
    const missedPenalty =
      trimmedPenalty === ""
        ? undefined
        : Math.max(0, Math.min(500, Math.round(Number(trimmedPenalty) || 0)));

    const activeAssignees =
      targetMode === "members" && selectedMembers.length > 0 ? selectedMembers : undefined;
    const primaryAssignee =
      activeAssignees && activeAssignees.length > 0 ? activeAssignees[0] : groupTarget;

    const routine: FamilyRoutine = {
      id: editingRoutine?.id || `rt-${Date.now()}`,
      title: cleanTitle,
      emoji: emoji.trim() || "☀️",
      slot,
      time: time.trim() || ROUTINE_SLOT_META[slot].timeDefault,
      assignee: primaryAssignee,
      ...(activeAssignees ? { assignees: activeAssignees } : {}),
      daysOfWeek,
      points,
      ...(missedPenalty !== undefined ? { missedPenalty } : {}),
      requiresApproval,
      active: editingRoutine?.active ?? true,
      ...(editingRoutine?.createdAt ? { createdAt: editingRoutine.createdAt } : {}),
      steps: validSteps,
    };

    await onSave(routine);
  };

  const nonPetRoster = rosterMembers.filter((m) => m.role !== "pet");

  return (
      <div className="space-y-4">
        {error && (
          <div className="rounded-xl border border-[var(--color-accent-rose)]/40 bg-[var(--color-accent-rose)]/10 px-3 py-2 text-xs font-medium text-[var(--color-accent-ink-rose)]">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <TextField
              label="Routine Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Sunday Trash Run"
            />
          </div>
          <TextField
            label="Emoji"
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            placeholder="🗑️"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {EMOJI_PRESETS.map((em) => (
            <button
              key={em}
              type="button"
              onClick={() => setEmoji(em)}
              className={`hit-44 rounded-xl px-2.5 py-1.5 text-base transition ${
                emoji === em
                  ? "bg-[var(--color-accent-selected)] text-white"
                  : "border border-border bg-[var(--color-surface-2)]"
              }`}
            >
              {em}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
              Time Block
            </span>
            <select
              value={slot}
              onChange={(e) => setSlot(e.target.value as RoutineSlot)}
              className="w-full rounded-2xl border border-border bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none"
            >
              {SLOTS.map((s) => (
                <option key={s} value={s}>
                  {ROUTINE_SLOT_META[s].emoji} {ROUTINE_SLOT_META[s].label}
                </option>
              ))}
            </select>
          </label>
          <TextField
            label="Target Time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            placeholder="07:30 or 19:00"
          />
        </div>

        {/* Who does this routine */}
        <div>
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
            Who Is Responsible?
          </span>
          <div className="flex flex-wrap gap-2">
            {(["All", "Kids", "Adults"] as const).map((grp) => {
              const selected = targetMode === "group" && groupTarget === grp;
              return (
                <button
                  key={grp}
                  type="button"
                  onClick={() => {
                    setTargetMode("group");
                    setGroupTarget(grp);
                    setSelectedMembers([]);
                  }}
                  className={`hit-44 rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                    selected
                      ? "bg-[var(--color-accent-selected)] text-white"
                      : "border border-border bg-[var(--color-surface-2)] text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {grp === "All" ? "Everyone" : grp}
                </button>
              );
            })}
            {nonPetRoster.map((m) => {
              const full = m.fullName || m.name;
              const active =
                targetMode === "members" &&
                selectedMembers.some((s) => s.toLowerCase() === full.toLowerCase());
              return (
                <button
                  key={full}
                  type="button"
                  onClick={() => toggleMember(full)}
                  className={`hit-44 rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                    active
                      ? "bg-[var(--color-accent-selected)] text-white"
                      : "border border-border bg-[var(--color-surface-2)] text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {m.emoji ? `${m.emoji} ` : ""}
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Days of week schedule */}
        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
              Schedule Days
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setDaysOfWeek([...ALL_ROUTINE_DAYS])}
                className="rounded-full border border-border bg-[var(--color-surface-2)] px-2.5 py-1 text-xs font-semibold text-text-secondary hover:text-text-primary"
              >
                Every day
              </button>
              <button
                type="button"
                onClick={() => setDaysOfWeek([...WEEKDAY_ROUTINE_DAYS])}
                className="rounded-full border border-border bg-[var(--color-surface-2)] px-2.5 py-1 text-xs font-semibold text-text-secondary hover:text-text-primary"
              >
                Weekdays
              </button>
              <button
                type="button"
                onClick={() => setDaysOfWeek([...WEEKEND_ROUTINE_DAYS])}
                className="rounded-full border border-border bg-[var(--color-surface-2)] px-2.5 py-1 text-xs font-semibold text-text-secondary hover:text-text-primary"
              >
                Weekends
              </button>
              <button
                type="button"
                onClick={() => setDaysOfWeek(["sun"])}
                className="rounded-full border border-border bg-[var(--color-surface-2)] px-2.5 py-1 text-xs font-semibold text-text-secondary hover:text-text-primary"
              >
                Sun Only
              </button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {ALL_ROUTINE_DAYS.map((day) => {
              const active = daysOfWeek.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={`hit-44 rounded-xl py-2 text-xs font-bold transition ${
                    active
                      ? "bg-[var(--color-accent-selected)] text-white"
                      : "border border-border bg-[var(--color-surface-2)] text-text-secondary"
                  }`}
                >
                  {ROUTINE_DAY_META[day].short}
                </button>
              );
            })}
          </div>
        </div>

        {/* Reward Points & Missed Penalty */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <TextField
              label="Completion Points"
              type="number"
              min={0}
              max={500}
              value={pointsText}
              onChange={(e) => setPointsText(e.target.value)}
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {POINT_PRESETS.map((pt) => (
                <button
                  key={pt}
                  type="button"
                  onClick={() => setPointsText(String(pt))}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    Number(pointsText) === pt
                      ? "bg-[var(--color-accent-amber)]/25 text-[var(--color-accent-ink-amber)]"
                      : "border border-border bg-[var(--color-surface-2)] text-text-secondary"
                  }`}
                >
                  +{pt}
                </button>
              ))}
            </div>
          </div>

          <TextField
            label="Missed Penalty (pts)"
            type="number"
            min={0}
            max={500}
            value={penaltyText}
            onChange={(e) => setPenaltyText(e.target.value)}
            placeholder={`Default (${settings.defaultMissedPenalty} pts)`}
            helperText="Leave blank to use family default; 0 disables deduction"
          />
        </div>

        {/* Approval gate toggle */}
        <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-border bg-[var(--color-surface-2)] px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-text-primary">
              Require Parent Approval
            </div>
            <div className="text-xs text-text-secondary">
              Hold points until a parent approves when a child checks this off
            </div>
          </div>
          <input
            type="checkbox"
            checked={requiresApproval}
            onChange={(e) => setRequiresApproval(e.target.checked)}
            className="h-5 w-5 accent-[var(--color-accent-selected)]"
          />
        </label>

        {/* Checklist Steps */}
        <div>
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
            Checklist Steps ({steps.length})
          </span>
          <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
            {steps.map((st, idx) => (
              <div
                key={st.id}
                className="flex items-center gap-2 rounded-xl border border-border bg-[var(--color-surface-2)] px-3 py-2"
              >
                <input
                  value={st.emoji}
                  onChange={(e) =>
                    setSteps((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, emoji: e.target.value } : x)),
                    )
                  }
                  aria-label="Step emoji"
                  className="w-10 rounded-lg bg-[var(--color-surface-1)] py-1 text-center text-sm outline-none"
                />
                <input
                  value={st.title}
                  onChange={(e) =>
                    setSteps((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x)),
                    )
                  }
                  aria-label="Step title"
                  className="flex-1 bg-transparent text-sm text-text-primary outline-none"
                />
                <button
                  type="button"
                  onClick={() => setSteps((prev) => prev.filter((_, i) => i !== idx))}
                  className="hit-44 rounded-lg px-2 text-xs font-semibold text-[var(--color-accent-ink-rose)] hover:bg-[var(--color-accent-rose)]/10"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <input
              value={newStepEmoji}
              onChange={(e) => setNewStepEmoji(e.target.value)}
              aria-label="New step emoji"
              className="w-12 rounded-xl border border-border bg-[var(--color-surface-2)] py-2.5 text-center text-sm outline-none"
            />
            <input
              value={newStepTitle}
              onChange={(e) => setNewStepTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addDraftStep()}
              placeholder="Add another step..."
              className="flex-1 rounded-xl border border-border bg-[var(--color-surface-2)] px-3.5 py-2.5 text-sm text-text-primary outline-none"
            />
            <SoftButton variant="secondary" size="sm" onClick={addDraftStep}>
              + Step
            </SoftButton>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <SoftButton variant="ghost" onClick={onClose}>
            Cancel
          </SoftButton>
          <SoftButton
            variant="primary"
            loading={saving}
            disabled={!title.trim() || steps.filter((s) => s.title.trim()).length === 0}
            onClick={submit}
          >
            {editingRoutine ? "Save Routine" : "Create Routine"}
          </SoftButton>
        </div>
      </div>
  );
}

export interface RoutineSettingsModalProps {
  open: boolean;
  onClose: () => void;
  settings: RoutineSettings;
  onSave: (next: RoutineSettings) => Promise<void> | void;
  saving?: boolean;
  error?: string | null;
}

export function RoutineSettingsModal(props: RoutineSettingsModalProps) {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Routine Point Rules & Accountability"
      description="Customize default routine rewards, daily missed-routine penalties, and parent race participation."
      panelClassName="max-w-lg"
    >
      {props.open ? (
        <RoutineSettingsForm
          key={`${props.settings.defaultPoints}:${props.settings.defaultMissedPenalty}`}
          {...props}
        />
      ) : null}
    </Modal>
  );
}

function RoutineSettingsForm({
  onClose,
  settings,
  onSave,
  saving = false,
  error,
}: RoutineSettingsModalProps) {
  const [draft, setDraft] = useState<RoutineSettings>(settings);

  return (
      <div className="space-y-4">
        {error && (
          <div className="rounded-xl border border-[var(--color-accent-rose)]/40 bg-[var(--color-accent-rose)]/10 px-3 py-2 text-xs font-medium text-[var(--color-accent-ink-rose)]">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            label="Default Completion Points"
            type="number"
            min={0}
            max={500}
            value={draft.defaultPoints}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                defaultPoints: Math.max(0, Math.round(Number(e.target.value) || 0)),
              }))
            }
          />
          <TextField
            label="Default Missed Penalty (pts)"
            type="number"
            min={0}
            max={500}
            value={draft.defaultMissedPenalty}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                defaultMissedPenalty: Math.max(0, Math.round(Number(e.target.value) || 0)),
              }))
            }
          />
          <TextField
            label="Streak Bonus Cadence (days)"
            type="number"
            min={0}
            max={365}
            value={draft.streakBonusEveryDays}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                streakBonusEveryDays: Math.max(0, Math.round(Number(e.target.value) || 0)),
              }))
            }
            helperText="0 disables automatic streak bonuses"
          />
          <TextField
            label="Streak Milestone Bonus (pts)"
            type="number"
            min={0}
            max={500}
            value={draft.streakBonusPoints}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                streakBonusPoints: Math.max(0, Math.round(Number(e.target.value) || 0)),
              }))
            }
          />
        </div>

        <div className="space-y-2.5">
          <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-border bg-[var(--color-surface-2)] px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-text-primary">
                Auto-Deduct Missed Routines at Rollover
              </div>
              <div className="text-xs text-text-secondary">
                Deducts penalty points & resets streaks after midnight when a routine goes unchecked
              </div>
            </div>
            <input
              type="checkbox"
              checked={draft.accountabilityEnabled}
              onChange={(e) =>
                setDraft((d) => ({ ...d, accountabilityEnabled: e.target.checked }))
              }
              className="h-5 w-5 accent-[var(--color-accent-selected)]"
            />
          </label>

          <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-border bg-[var(--color-surface-2)] px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-text-primary">
                Parent Points Count Toward Weekly Race
              </div>
              <div className="text-xs text-text-secondary">
                Include adults&apos; routine points and penalties on the family leaderboard
              </div>
            </div>
            <input
              type="checkbox"
              checked={draft.parentCountsTowardRace}
              onChange={(e) =>
                setDraft((d) => ({ ...d, parentCountsTowardRace: e.target.checked }))
              }
              className="h-5 w-5 accent-[var(--color-accent-selected)]"
            />
          </label>

          <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-border bg-[var(--color-surface-2)] px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-text-primary">
                Require Parent Approval by Default
              </div>
              <div className="text-xs text-text-secondary">
                Hold routine points until a parent approves when kids check off
              </div>
            </div>
            <input
              type="checkbox"
              checked={draft.defaultRequiresApproval}
              onChange={(e) =>
                setDraft((d) => ({ ...d, defaultRequiresApproval: e.target.checked }))
              }
              className="h-5 w-5 accent-[var(--color-accent-selected)]"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <SoftButton variant="ghost" onClick={onClose}>
            Cancel
          </SoftButton>
          <SoftButton variant="primary" loading={saving} onClick={() => onSave(draft)}>
            Save Point Rules
          </SoftButton>
        </div>
      </div>
  );
}

export interface ParentPinPromptModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  error?: string | null;
  onSubmit: (pin: string) => Promise<void> | void;
  loading?: boolean;
}

export function ParentPinPromptModal({
  open,
  onClose,
  title = "Parent PIN Required",
  description = "Enter a parent PIN to save this change.",
  error,
  onSubmit,
  loading = false,
}: ParentPinPromptModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} description={description}>
      {open ? (
        <ParentPinPromptForm
          onClose={onClose}
          error={error}
          onSubmit={onSubmit}
          loading={loading}
        />
      ) : null}
    </Modal>
  );
}

function ParentPinPromptForm({
  onClose,
  error,
  onSubmit,
  loading = false,
}: Omit<ParentPinPromptModalProps, "open" | "title" | "description">) {
  const [pin, setPin] = useState("");

  return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (pin.trim()) void onSubmit(pin.trim());
        }}
        className="space-y-4"
      >
        <TextField
          label="Parent PIN"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="Enter parent PIN"
          errorText={error || undefined}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <SoftButton variant="ghost" onClick={onClose}>
            Cancel
          </SoftButton>
          <SoftButton
            type="submit"
            variant="primary"
            loading={loading}
            disabled={!pin.trim()}
          >
            Confirm
          </SoftButton>
        </div>
      </form>
  );
}
