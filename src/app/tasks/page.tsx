/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useState, useEffect, useMemo, useCallback, useRef, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { mapTaskIdeas, mapRewardIdeas } from "@/lib/ai-suggestions";
import { localTodayISO, localWeekStartISO } from "@/lib/local-date";
import { getISO, previousWeekStartISO } from "@/lib/due-date-utils";
import PageShell from "@/components/ui/PageShell";
import PageHeader from "@/components/patterns/PageHeader";
import SectionCard from "@/components/patterns/SectionCard";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import SwipeableRow from "@/components/ui/SwipeableRow";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import Toast from "@/components/ui/Toast";
import SegmentedControl from "@/components/ui/SegmentedControl";
import Toggle from "@/components/ui/Toggle";
import Stepper from "@/components/ui/Stepper";
import Chip from "@/components/ui/Chip";
import StatTile from "@/components/patterns/StatTile";
import ProgressRing from "@/components/ui/ProgressRing";
import Avatar from "@/components/ui/Avatar";
import { textEmojiOrFallback } from "@/components/ui/EmojiText";
import TasksStats, { TASKS_PANEL_IDS, TASKS_VIEW_SWITCH_ID } from "@/components/tasks/TasksStats";
import CrewTasksCard from "@/components/tasks/CrewTasksCard";
import DueDatePicker from "@/components/tasks/DueDatePicker";
import TasksArchive from "@/components/tasks/TasksArchive";
import TasksRewardsPanel from "@/components/tasks/TasksRewardsPanel";
import { db } from "@/db";
import { useAuth } from "@/hooks/useAuth";
import { useWallMode } from "@/hooks/useWallMode";
import { useWallConfirm } from "@/hooks/useWallConfirm";
import type { Task, LeaderboardEntry, Reward, Penalty, WeekData, HallOfFameEntry } from "@/types/tasks";
import type { ArchivedTaskDef } from "@/lib/task-week-rollover";
import {
  TASKS_STORAGE_KEY, REWARDS_KEY, PENALTIES_KEY,
  emptyWeekData,
  loadWeekData, saveWeekData,
  calculateRealStreak,
  getThisWeeksCompletedDates, getThisWeeksCompletedTasks, isCompletedInWeek,
  groupCompletedTasksByWeek,
  loadTasks, saveTasks,
  saveRewards, savePenalties,
  getPreviousWeekRanks, loadHallOfFame, loadHallOfFameMerged,
  loadPreviousWeekRanksMerged,
  loadWeeklyPrizes,
  loadTaskTemplates, saveTaskTemplates,
  applyTaskConfigSnapshotToStores,
  pickDefaultClaimMember, isSnatchable, isPendingApproval,
  completesWithoutPin, completesWithPendingApproval,
  resolveMemberName,
  mergeTasksSnapshot, getDaysUntilWeekReset,
  saveDeletedTaskIds,
  isCrewTask, crewMembers, crewMemberCount, crewFull, crewHasMember,
  crewMemberCheckedIn, crewCheckinProgress,
  crewCloseModeOf,
  normalizeSpeedBonus,
  needsStreakSave,
} from "@/lib/task-utils";
import { useTaskCommandQueue } from "@/hooks/useTaskCommandQueue";
import type { TaskOutboxAcknowledgedEvent } from "@/lib/task-command-store";
import { listTaskOutbox, onTaskOutboxAdopted } from "@/lib/task-command-store";
import { writeTaskConfig } from "@/lib/task-config-client";
import type { TaskConfigCommand, TaskTemplateConfigItem } from "@/lib/task-config";
import {
  verifyPinRemote, unreachableCopy,
} from "@/modes/kid/kid-store";
import Podium from "@/components/leaderboard/Podium";
import PrizeRaceCard from "@/components/leaderboard/PrizeRaceCard";
import YourCard from "@/components/leaderboard/YourCard";
import MemberSheet from "@/components/leaderboard/MemberSheet";
import LeaderboardRow from "@/components/leaderboard/LeaderboardRow";
import LevelUpModal from "@/components/leaderboard/LevelUpModal";
import DailyQuestCard from "@/components/leaderboard/DailyQuestCard";
import StreakSaverBanner from "@/components/leaderboard/StreakSaverBanner";
import CatchUpNudge from "@/components/leaderboard/CatchUpNudge";
import TreasurePath from "@/components/leaderboard/TreasurePath";
import FamilyGoal from "@/components/leaderboard/FamilyGoal";
import AchievementWall from "@/components/leaderboard/AchievementWall";
import HallOfFame from "@/components/leaderboard/HallOfFame";
import TrophyCase from "@/components/leaderboard/TrophyCase";
import ShareCard from "@/components/leaderboard/ShareCard";
import WeeklyWinModal from "@/components/leaderboard/WeeklyWinModal";
import ConfettiBurst from "@/components/ui/ConfettiBurst";
import Skeleton from "@/components/ui/Skeleton";
import TaskLedgerQuarantineNotice from "@/components/tasks/TaskLedgerQuarantineNotice";
import AllTimeValue from "@/components/leaderboard/AllTimeValue";
import { earnedBadgeEmojis, resolveAllTimeLevel } from "@/components/leaderboard/level";
import { useAllTimeTotals } from "@/hooks/useAllTimeTotals";
import { readReducedMotionPreference } from "@/hooks/useReducedMotionPreference";
import { familyAllTimePoints } from "@/lib/all-time-totals";

function formatDueLabel(dateStr: string): string {
  if (!dateStr) return "";
  if (dateStr === "Today" || dateStr === "Tomorrow" || dateStr === "This week") return dateStr;
  if (["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].includes(dateStr)) return dateStr;

  const dueDate = new Date(dateStr + "T00:00:00");
  if (isNaN(dueDate.getTime())) return dateStr;

  const diffMs = dueDate.getTime() - new Date().setHours(0, 0, 0, 0);
  const diffDays = Math.round(diffMs / 86400000);

  if (diffDays > 1 && diffDays <= 7) {
    return dueDate.toLocaleDateString("en-US", { weekday: "short" });
  }

  return dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** >180 s of waiting earns a visible "⏳ waiting N min|h|d" age hint — the
 * cross-device latency contract behind the queue banner's "up to 5 min".
 * Null under the threshold or for an unparseable instant; never a fake "0". */
function approvalAgeHint(atIso: string, nowMs: number = Date.now()): string | null {
  const tapped = Date.parse(atIso);
  if (!Number.isFinite(tapped)) return null;
  const ageMs = nowMs - tapped;
  if (ageMs <= 180_000) return null;
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `⏳ waiting ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `⏳ waiting ${hours} h`;
  return `⏳ waiting ${Math.floor(hours / 24)} d`;
}

function migrateDueToISO(tasks: Task[]): Task[] {
  return tasks.map((t) => {
    if (t.due === "Today") return { ...t, due: getISO.today };
    if (t.due === "Tomorrow") return { ...t, due: getISO.tomorrow };
    if (t.due === "This week") return { ...t, due: getISO.thisWeek };
    const dayMap: Record<string, string> = {
      Fri: getISO.fri, Sat: getISO.sat, Sun: getISO.sun, Mon: getISO.mon, Tue: getISO.tue, Wed: getISO.wed, Thu: getISO.thu,
    };
    if (dayMap[t.due]) return { ...t, due: dayMap[t.due] };
    return t;
  });
}

// PINs are verified server-side against PocketBase truth — the client bundle
// never sees member pins. The shared kid-store helper returns a DISCRIMINATED
// {ok | wrongPin | unreachable} result so a flaky network or an asleep NAS is
// never reported to a parent as "Wrong PIN" (honesty rule: offline-vs-server
// distinction, same contract the kid lanes shipped).

function safeDisplayEmoji(emoji: any): string {
  // Delegates to the shared text-safe helper: photo data-URLs never belong
  // in a text string (share text, toasts, descriptions, select options).
  return textEmojiOrFallback(emoji);
}

function memberOptionLabel(member: any): string {
  return `${safeDisplayEmoji(member?.emoji)} ${member?.fullName || member?.name || "Member"}`;
}

const memberColorValues: Record<string, string> = {
  green: "var(--color-accent-selected)",
  violet: "var(--color-accent-violet)",
  amber: "var(--color-accent-amber)",
  cyan: "var(--color-accent-cyan)",
  rose: "var(--color-accent-rose)",
  blue: "var(--color-accent-nori)",
};

function memberChipColor(colorName?: string): string {
  return memberColorValues[colorName ?? "green"] ?? "var(--color-accent-selected)";
}

function priorityColor(priority: Task["priority"]): string {
  return priority === "high" ? "var(--color-accent-rose)" : priority === "medium" ? "var(--color-accent-amber)" : "var(--color-accent-mint)";
}

/**
 * THE row tint, as one formula instead of nine hand-written gradients.
 *
 * At 40%/20% every row's own metadata line measured 2.89–4.16:1 against the
 * painted backdrop — the tint, not the ink, was the problem: `--color-text-
 * secondary` clears 4.5:1 on glass but not on a 40% mint flood. Measured over
 * the four accents in both themes, 10%→4% is the loudest wash that keeps
 * `text-secondary` at or above 4.5:1 (dark worst case mint 4.69:1, light worst
 * case rose 5.46:1).
 *
 * The priority SIGNAL did not weaken with it: the saturated 2px rail down the
 * row's left edge and the points chip still carry full-strength accent, so the
 * wash is now purely the material, which is what a wash is for.
 */
function rowTint(color: string): string {
  return `linear-gradient(135deg, color-mix(in srgb, ${color} 10%, transparent) 0%, color-mix(in srgb, ${color} 4%, transparent) 100%)`;
}

/** The points chip's own fill, sized so `text-primary` on it clears AA in both themes. */
function chipFill(color: string): string {
  return `linear-gradient(135deg, color-mix(in srgb, ${color} 22%, transparent), color-mix(in srgb, ${color} 10%, transparent))`;
}

const initialTasks: Task[] = [];

// The ONE "nobody owns this yet" assignee sentinel. `universal: true` is the
// authoritative signal; this string is what the board prints, and two writers
// that disagree ("Open" from the Add sheet, "All" from Repeat-last-week) made
// one mode render under two names. "All" is the value the rollover snapshot and
// the archived defs already carry.
const OPEN_ASSIGNEE = "All";

// An exhausted retry is NOT a server refusal: the command may have applied
// while nothing confirmed it (a lost response, an unreconciled projection).
// This is the ONLY honest sentence for that terminal state — a paid approval
// must never be described as refused.
const UNCONFIRMED_CHANGE_COPY = "Consuela couldn't confirm that change — it may still land.";

// The ledger route's refusal codes, said the way the family reads them. The
// honest distinction the route itself draws: a 401 is "that PIN was wrong", a
// 403 is "an adult has to do this", a 404 is "that name or item isn't on the
// roster any more", and a 503 is "Consuela is asleep — try again" (the outbox
// retries it, so nothing is lost). No 4xx is ever dressed as a confirmation.
// The approval route's own codes ride the same table (its 404 display slug is
// hyphenated, so both spellings of `unknown_task` are listed).
const LEDGER_REFUSAL_COPY: Record<string, string> = {
  adult_only: "Only a grown-up can move points.",
  unauthorized: "That PIN wasn't right.",
  unknown_member: "That member isn't on the roster any more.",
  unknown_penalty: "That penalty isn't in the list any more.",
  pet_target: "A pet can't hold points.",
  insufficient_balance: "Not enough points to take that off.",
  operation_conflict: "That change was already applied once.",
  invalid_task_state: "That amount wasn't accepted.",
  invalid_body: "That change wasn't in the shape the server expects.",
  member_roster_unavailable: "Consuela couldn't read the family list — it'll retry.",
  ledger_unavailable: "Consuela is unreachable right now — it'll retry.",
  snapshot_write_failed: "Consuela couldn't save that yet — it'll retry.",
  outbox_evicted: "It was dropped from the pending list before it sent.",
  projection_pending: UNCONFIRMED_CHANGE_COPY,
  unknown_task: "That chore isn't on the family's list any more.",
  "unknown-task": "That chore isn't on the family's list any more.",
  ambiguous_task: "That chore matched more than one row on the family's list.",
  semantic_duplicate: "That tap was already approved once.",
  repair_required: "That approval is still landing — try again in a moment.",
  task_store_unavailable: "Consuela couldn't read the chores — it'll retry.",
  forbidden_approval_payload: "That change wasn't in the shape the server expects.",
  invalid_action: "That review action isn't one the server knows.",
  invalid_task_id: "That chore's id wasn't accepted.",
};

function ledgerRefusalCopy(reason?: string): string {
  if (!reason) return "";
  return LEDGER_REFUSAL_COPY[reason] ?? "";
}

/**
 * The card's amount contract: the persisted award (`awardedPoints`, survives
 * approval) → the pending record's promised amount (`pendingApproval.points`)
 * → the chore's own base. The base is the pre-B1a legacy read (a pending record
 * with no recorded amount); the server pays the same via parsePending.
 */
function baseTaskPoints(task: Pick<Task, "points">): number {
  return task.points;
}

const categories = ["Chores", "Errands", "Admin", "Health", "Pets", "School"];

function emptyTask(firstMember?: { name?: string; emoji?: string }): Task {
  return {
    id: Date.now(),
    title: "",
    assignee: firstMember?.name || "",
    assigneeEmoji: firstMember?.emoji || "🧒",
    due: localTodayISO(),
    points: 5,
    recurring: null,
    category: "Chores",
    completed: false,
    priority: "medium",
    universal: false,
    stealable: false,
    crewSize: null,
    crew: null,
    crewCloseMode: "strict",
  };
}

function migrateAssigneeNames(tasks: Task[], members: any[]): Task[] {
  // Through the SHARED resolver, not a prefix guess: `t.assignee.startsWith(m.name)`
  // folded "Alexandra Garcia" into "Alex Garcia" (Alex is a prefix of Alexandra),
  // so two family members became one row key at MOUNT — before any identity
  // lookup on this page could compare exactly.
  return tasks.map((t) => {
    const fullName = resolveMemberName(members, t.assignee);
    if (fullName && fullName !== t.assignee) {
      const match = members.find((m: any) => (m.fullName || m.name) === fullName);
      if (match) return { ...t, assignee: match.fullName, assigneeEmoji: match.emoji };
    }
    return t;
  });
}

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (key === TASKS_STORAGE_KEY && Array.isArray(parsed)) {
        return migrateDueToISO(parsed as Task[]) as T;
      }
      return parsed as T;
    }
    return fallback;
  } catch { return fallback; }
}

// ConfettiBurst now lives in src/components/ui/ConfettiBurst.tsx (extracted
// verbatim so the tasks page and the WeeklyWinModal share one component).

export default function TasksPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Live roster: db/index.ts dispatches consuela-members-updated whenever the
  // members cache refreshes (60s CacheRefresher pull, patchMemberLocal after a
  // profile save). Bump a version so the member memos below re-read the roster
  // instead of freezing at whatever the cache held at mount — same pattern as
  // PlanTab's familyMembers.
  const [membersVersion, setMembersVersion] = useState(0);
  useEffect(() => {
    const onMembersUpdated = () => setMembersVersion(v => v + 1);
    window.addEventListener("consuela-members-updated", onMembersUpdated);
    return () => window.removeEventListener("consuela-members-updated", onMembersUpdated);
  }, []);

  // membersVersion bumps when the async members cache refreshes (see the
  // consuela-members-updated listener above) so the roster memos recompute —
  // deliberate recompute trigger, same pattern as PlanTab's familyMembers.
  const membersData = useMemo(() => db.selectMembers(), [membersVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Weekly prizes: re-read whenever the cross-device refresh lands — a fresher
  // snapshot may have adopted a new prize catalog (restoreFromSnapshot below).
  // Same listener-and-version pattern as membersVersion above.
  const [prizesVersion, setPrizesVersion] = useState(0);
  useEffect(() => {
    const onDataRefreshed = () => setPrizesVersion(v => v + 1);
    window.addEventListener("consuela-data-refreshed", onDataRefreshed);
    return () => window.removeEventListener("consuela-data-refreshed", onDataRefreshed);
  }, []);
  const weeklyPrizes = useMemo(() => loadWeeklyPrizes(), [prizesVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const allTime = useAllTimeTotals();
  const { currentUser, isLoggedIn } = useAuth();
  const router = useRouter();
  // P0 gate: creating, editing, and deleting family chores is parent-only.
  const isParent = isLoggedIn && currentUser?.role === "parent";
  // P0 redirect: a kid's task screen is their KidHome quest list — kids never
  // see the (dense, adult) Tasks page. Catches every entry path (capsule nav,
  // Home widget links, bookmarks). Pets ride the kid surface the same way.
  useEffect(() => {
    if (isLoggedIn && (currentUser?.role === "child" || currentUser?.role === "pet")) {
      router.replace("/");
    }
  }, [isLoggedIn, currentUser, router]);
  const allMembers = useMemo(() => {
    // Pets are never assignees — a task handed to 🐶 would strand its points
    // (leaderboard and claims exclude pets by design).
    const names = membersData.filter((m: any) => m.role !== "pet").map((m: any) => m.fullName);
    return isLoggedIn ? ["My Tasks", ...names, "Open"] : ["All", ...names, "Open"];
  }, [membersData, isLoggedIn]);

  const memberEmojis: Record<string, string> = useMemo(() => ({
    All: "👨‍👩‍👧‍👦",
    "My Tasks": currentUser?.emoji || "👤",
    "Open": "🫳",
    // Raw emoji here: every consumer renders it through <Avatar variant="emoji">,
    // which turns photo data URLs into real images. The 👤 sanitizing in
    // safeDisplayEmoji belongs ONLY in text contexts (memberOptionLabel).
    ...Object.fromEntries(membersData.map((m: any) => [m.fullName, m.emoji || "👤"]))
  }), [membersData, currentUser]);

  // Roster-first avatar resolution for TASK ROWS (2026-09-23 review): task
  // rows may carry assigneeEmoji "👤" — the persistedTaskEmoji write gate
  // collapses photo avatars at every PB boundary, so rendering the stored
  // field as the member's avatar shows a silhouette for photo members on
  // exactly the rows the family looks at (pending, approval queue, on-the-
  // way, completed). The live roster holds the real photo (members.emoji);
  // the stored glyph stays the fallback for non-member assignees
  // ("Open"/"Crew"/"All") and legacy first-name rows.
  const assigneeEmojis: Record<string, string> = useMemo(() =>
    Object.fromEntries(membersData.map((m: any) => [m.fullName, m.emoji || "👤"])),
  [membersData]);

  const memberColors: Record<string, string> = useMemo(() => {
    const colors = Object.fromEntries(membersData.map((m: any) => [m.fullName, m.color]));
    if (currentUser) colors["My Tasks"] = currentUser.color;
    return colors;
  }, [membersData, currentUser]);

  const [weekData, setWeekData] = useState<WeekData>(() => {
    if (typeof window === "undefined") return emptyWeekData();
    return loadWeekData();
  });

  const [tasks, setTasks] = useState<Task[]>(() => {
    if (typeof window === "undefined") return initialTasks;
    const loaded = loadTasks();
    if (loaded.length === 0) return initialTasks;
    try {
      const members = db.selectMembers();
      return migrateAssigneeNames(migrateDueToISO(loaded), members);
    } catch {
      return migrateDueToISO(loaded);
    }
  });

  const [hallOfFame, setHallOfFame] = useState<HallOfFameEntry[]>(() => loadHallOfFame());
  const [previousRanks, setPreviousRanks] = useState<Record<string, number>>(() => getPreviousWeekRanks());

  useEffect(() => {
    if (!mounted) return;
    let active = true;
    void Promise.all([
      loadHallOfFameMerged(),
      loadPreviousWeekRanksMerged(weekData.weekStart),
    ]).then(([serverHall, serverRanks]) => {
      if (!active) return;
      setHallOfFame(serverHall);
      setPreviousRanks(serverRanks);
    });
    return () => {
      active = false;
    };
  }, [mounted, prizesVersion, weekData.weekStart]);

  useEffect(() => { saveTasks(tasks); }, [tasks]);
  useEffect(() => { saveWeekData(weekData); }, [weekData]);

  const [filterMember, setFilterMember] = useState("All");
  useEffect(() => {
    if (isLoggedIn && filterMember === "All") setFilterMember("My Tasks");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  const [activeTab, setActiveTab] = useState<"tasks" | "leaderboard">("tasks");
  const { wall } = useWallMode();
  // Wall 2-step chore confirm (wall-only UI gate on the row-tap ENTRY point;
  // every downstream path — PIN-free, PIN-gated, undo — is unchanged). The
  // armed row resets whenever the filter member or the tab changes.
  const { confirmId: wallConfirmId, armOrConfirm: wallConfirm } = useWallConfirm(
    wall,
    `${filterMember}|${activeTab}`
  );
  const [showCompleted, setShowCompleted] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Task>(() => emptyTask(membersData.find((m: any) => m.role !== "pet")));
  const [isAdding, setIsAdding] = useState(false);
  // Favorites (task templates) are PREFILL-ONLY: a template never creates a
  // task on its own. `saveAsFavorite` / `templateId` are sheet-local — they
  // never ride the task payload.
  const [templates, setTemplates] = useState<TaskTemplateConfigItem[]>(() => loadTaskTemplates());
  const [manageTemplate, setManageTemplate] = useState<TaskTemplateConfigItem | null>(null);
  const [saveAsFavorite, setSaveAsFavorite] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);
  // Prefill moves focus back to Title AFTER the state commit (token-keyed).
  const [focusTitleToken, setFocusTitleToken] = useState(0);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  // ONE source of truth for the PIN dialog. `pinTaskId` / `pinCrewAction` /
  // `pinReward` / `pinPenalty` were four independent fields written by three
  // different openers and cleared by three different closers, so a crew dialog
  // dismissed with Escape left its `crew-join` arm behind and the NEXT normal
  // chore's Submit dispatched it against the previous crew task (variant B: a
  // dead "Select who is joining" loop forever). The intent is discriminated by
  // kind, so exactly one arm can be open and every writer goes through
  // `openPin()`, which also resets the per-attempt input state.
  type PinIntent =
    | { kind: "task"; taskId: number }
    | { kind: "crew"; taskId: number; action: "crew-join" | "crew-checkin" }
    | { kind: "reward"; reward: Reward }
    | { kind: "penalty"; penalty: Penalty };
  const [pinIntent, setPinIntent] = useState<PinIntent | null>(null);
  const pinTaskId = pinIntent && (pinIntent.kind === "task" || pinIntent.kind === "crew") ? pinIntent.taskId : null;
  const pinCrewAction = pinIntent?.kind === "crew" ? { taskId: pinIntent.taskId, action: pinIntent.action } : null;
  const pinReward = pinIntent?.kind === "reward" ? pinIntent.reward : null;
  const pinPenalty = pinIntent?.kind === "penalty" ? pinIntent.penalty : null;
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinSuccess, setPinSuccess] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [snatchForMember, setSnatchForMember] = useState("");
  const [redeemForMember, setRedeemForMember] = useState("");
  const [penaltyForMember, setPenaltyForMember] = useState("");
  // The PIN-free completion branch has no `pinBusy` to guard it (it never opens
  // a dialog), so a double-tap queued the command twice. Ref, not state: the
  // guard has to be synchronous with the tap, before the next render lands.
  const pinFreeInFlightRef = useRef<Set<number>>(new Set());
  // The PAGE-identity every "is this me?" comparison runs against: the
  // roster-resolved FULL name. The old `e.name === currentUser.name ||
  // e.name.startsWith(currentUser.name)` lookups matched "Alex Garcia" to
  // "Alexandra Garcia", so YourCard / the streak banner / the level-up effect
  // could all read another person's points and record their level under the
  // wrong key.
  const myIdentity = useMemo(() => {
    const name = isLoggedIn && currentUser ? resolveMemberName(membersData, currentUser.name) : null;
    return {
      name,
      isMe: (raw?: string | null) => !!name && resolveMemberName(membersData, raw) === name,
    };
  }, [membersData, isLoggedIn, currentUser]);
  const myRosterName = myIdentity.name;
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<Task[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  // The tone is PASSED, never sniffed out of the message: the old
  // `toast.includes("Failed")` test matched the literal "Failed" exactly once in
  // the whole file — inside itself — so every failure rendered mint-on-mint as a
  // success. An unknown is "neutral", not "success".
  const [toastTone, setToastTone] = useState<"neutral" | "success" | "error">("neutral");
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Optimistic row ids. The counter used to be a `let` INSIDE the component, so
  // it restarted at 0 on every render and `uid()` was `Date.now() + 1` almost
  // every time — two AI suggestions adopted inside one millisecond minted the
  // same id and rendered as a duplicate React key. Monotonic across renders.
  const idCounterRef = useRef(0);
  const uid = useCallback(() => {
    idCounterRef.current += 1;
    return Date.now() * 1000 + (idCounterRef.current % 1000);
  }, []);
  const [rewards, setRewards] = useState<Reward[]>(() => loadFromStorage(REWARDS_KEY, []));
  const [editingRewardId, setEditingRewardId] = useState<number | null>(null);
  const [rewardForm, setRewardForm] = useState<Reward>({ id: 0, name: "", emoji: "🎁", cost: 50 });
  const [addingReward, setAddingReward] = useState(false);
  const [aiRewardSuggesting, setAiRewardSuggesting] = useState(false);
  const [aiRewards, setAiRewards] = useState<Reward[]>([]);
  const [penalties, setPenalties] = useState<Penalty[]>(() => loadFromStorage(PENALTIES_KEY, []));
  const [editingPenaltyId, setEditingPenaltyId] = useState<number | null>(null);
  const [penaltyForm, setPenaltyForm] = useState<Penalty>({ id: 0, name: "", emoji: "⚠️", points: 10 });
  const [addingPenalty, setAddingPenalty] = useState(false);
  const [adjustMember, setAdjustMember] = useState<string | null>(null);
  const [sheetMember, setSheetMember] = useState<string | null>(null);
  const [levelUpInfo, setLevelUpInfo] = useState<{ name: string; emoji: string; oldLevel: number; newLevel: number } | null>(null);
  const [shareCard, setShareCard] = useState<{ memberName: string; memberEmoji: string; rank: number; points: number } | null>(null);
  const prevLevelsRef = useRef<Record<string, number>>({});
  const [adjustAmount, setAdjustAmount] = useState<string>("10");
  const [adjustDir, setAdjustDir] = useState<"+" | "-">("-");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustPin, setAdjustPin] = useState("");
  const [adjustError, setAdjustError] = useState("");
  const [adjustSuccess, setAdjustSuccess] = useState("");
  const [confettiActive, setConfettiActive] = useState(false);
  const [undoTaskId, setUndoTaskId] = useState<number | null>(null);
  const [undoPin, setUndoPin] = useState("");
  const [undoError, setUndoError] = useState("");
  const [parentApprovalReward, setParentApprovalReward] = useState<Reward | null>(null);
  const [parentApprovalPin, setParentApprovalPin] = useState("");
  const [parentApprovalError, setParentApprovalError] = useState("");
  // A high-cost redemption needs BOTH PINs on the wire (the member's, and the
  // grown-up's who approved it). The parent PIN lives only in this ref between
  // the approval step and the redemption command, and is cleared the moment the
  // command is queued — it is never React state, storage, or a render value.
  const parentApprovalPinRef = useRef<string>("");
  const parentApprovalNameRef = useRef<string>("");
  const [approvalTaskId, setApprovalTaskId] = useState<number | null>(null);
  const [approvalMode, setApprovalMode] = useState<"approve" | "sendback" | "approve-all">("approve");
  // P0: deleting a family chore is destructive + cross-device — confirm first
  // (the shared-Modal rose pattern, like the AI-Models provider remove).
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [approvalPin, setApprovalPin] = useState("");
  const [approvalError, setApprovalError] = useState("");
  // Parent removes a non-checked-in crew member (spec §3 flake handling).
  const [crewRemoveTarget, setCrewRemoveTarget] = useState<{ taskId: number; memberName: string } | null>(null);
  const [crewRemovePin, setCrewRemovePin] = useState("");
  const [crewRemoveError, setCrewRemoveError] = useState("");
  const [crewCloseTarget, setCrewCloseTarget] = useState<{ taskId: number } | null>(null);
  const [crewClosePin, setCrewClosePin] = useState("");
  const [crewCloseError, setCrewCloseError] = useState("");
  // Repeat last week (spec §5): the feed is exactly the archived one-off defs
  // keyed by the previous week's Monday (written by the rollover, adopted from
  // the sync snapshot). Nothing is created until a parent confirms — the
  // sheet's rows are a removable draft, and each confirmed row is its own
  // durable manage add through the existing outbox.
  const [archivedTasks, setArchivedTasks] = useState<Record<string, ArchivedTaskDef[]>>({});
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [repeatRows, setRepeatRows] = useState<ArchivedTaskDef[]>([]);
  const lastWeekDefs = archivedTasks[previousWeekStartISO()] ?? [];

  useEffect(() => { saveRewards(rewards); }, [rewards]);
  useEffect(() => { savePenalties(penalties); }, [penalties]);

  // The ONE durable write seam for this page: every claim, completion, undo,
  // approval, crew action, task edit and config edit is enqueued here BEFORE
  // any local state change, and the outbox is what decides whether the family's
  // points, ledger and task rows actually move. `onAdopted` re-reads the stores
  // the acknowledgment just wrote — the only path that can change the visible
  // task/week state.
  // One display-only mark per queued command: the row it is about to create,
  // the row it is about to hide, or the "on the way" / "taking it back" note.
  type OptimisticRow =
    | { kind: "add"; task: Task }
    | { kind: "update"; task: Task }
    | { kind: "remove"; taskId: number }
    | { kind: "pending"; taskId: number }
    | { kind: "cancelling"; taskId: number };
  const [optimisticRows, setOptimisticRows] = useState<Record<string, OptimisticRow>>({});
  // The mark list is memoised so every memo that reads it has a STABLE input:
  // deriving it inline would hand each a fresh array every render and make the
  // memoisation decorative. Declared HERE, above every consumer — including
  // submitApproval's approve-all id selection — so the React Compiler can
  // preserve the manual memoization.
  const optimisticRowsList = useMemo(() => Object.values(optimisticRows), [optimisticRows]);
  const optimisticRemoved = useMemo(
    () => optimisticRowsList
      .filter((row): row is Extract<OptimisticRow, { kind: "remove" }> => row.kind === "remove")
      .map((row) => row.taskId),
    [optimisticRowsList],
  );
  // Latest-state mirrors for the async snapshot restore: the fetch resolves long
  // after commit, and these effects re-sync before any merge runs, so
  // mergeTasksSnapshot always sees the CURRENT state (never a stale closure).
  // Declared ABOVE `adoptStores` because that seam assigns them too.
  const tasksRef = useRef<Task[]>(tasks);
  const weekDataRef = useRef<WeekData>(weekData);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { weekDataRef.current = weekData; }, [weekData]);
  const adoptStores = useCallback(() => {
    // The refs move with the state: `restoreFromSnapshot` merges from them
    // immediately after calling this, and they used to be updated only by the
    // render-commit effects above — so the merge read the PRE-adoption values
    // and then overwrote what this had just adopted. The divergence is the
    // normal case (`db.refreshCaches` writes localStorage via
    // applyTasksSnapshotToStores and only THEN dispatches the event this page
    // listens on), not an edge case.
    const nextTasks = loadTasks();
    const nextWeek = loadWeekData();
    tasksRef.current = nextTasks;
    weekDataRef.current = nextWeek;
    setTasks(nextTasks);
    setWeekData(nextWeek);
    setRewards(loadFromStorage(REWARDS_KEY, []));
    setPenalties(loadFromStorage(PENALTIES_KEY, []));
    setTemplates(loadTaskTemplates());
  }, []);

  useEffect(() => {
    if (!focusTitleToken) return;
    titleInputRef.current?.focus();
  }, [focusTitleToken]);
  // Display-only optimism, keyed by OPERATION ID. A mark is created when a
  // command is queued and released when THAT command leaves the outbox (an
  // acknowledgment, a cancel, or a terminal failure) — never by a global queue
  // count, so one operation's landing can never clear another's optimism and a
  // retrying command keeps its honest "still sending" row.
  const addOptimisticRow = useCallback((operationId: string, row: OptimisticRow) => {
    setOptimisticRows((prev) => ({ ...prev, [operationId]: row }));
  }, []);
  // D9: the marks are display state, but the commands are durable. A reload
  // between the tap and the ack used to drop the affordance and render the
  // chore as untouched — exactly what "the tap never reached the card" looks
  // like. One mount pass re-seeds a mark per persisted non-terminal command,
  // keyed by its own operationId (the same key the ack releases), so every
  // surface still shows the command waiting.
  useEffect(() => {
    const entries = listTaskOutbox();
    if (!entries.length) return;
    setOptimisticRows((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const entry of entries) {
        if (entry.status !== "queued" && entry.status !== "retrying") continue;
        const taskId = Number(entry.displayTarget?.taskId ?? entry.payload?.taskId);
        if (!Number.isSafeInteger(taskId) || taskId <= 0) continue;
        const row: OptimisticRow | null =
          entry.action === "delete"
            ? { kind: "remove", taskId }
            : entry.action === "undo" || entry.action === "send-back"
              ? { kind: "cancelling", taskId }
              : entry.route === "/api/tasks/claim"
                ? { kind: "pending", taskId }
                : null;
        if (!row) continue;
        if (!(entry.operationId in next)) {
          next[entry.operationId] = row;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);
  // Dialog auto-dismiss timers, in ONE registry. Every PIN dialog used to clear
  // ITSELF from an uncancelled `setTimeout`, so a success that showed for 1500ms
  // and was then dismissed with Escape would null the id of the chore the user
  // had opened in the meantime and make the dialog they were typing into
  // vanish. One registry is cleared at the top of every open handler, on every
  // close, and on unmount — so no timer can ever outlive the attempt it belongs
  // to.
  const dialogTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const armDialogTimer = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => { dialogTimersRef.current.delete(id); fn(); }, ms);
    dialogTimersRef.current.add(id);
  }, []);
  const clearDialogTimers = useCallback(() => {
    for (const id of dialogTimersRef.current) clearTimeout(id);
    dialogTimersRef.current.clear();
  }, []);
  useEffect(() => clearDialogTimers, [clearDialogTimers]);
  // Defined above the acknowledgment listener so that listener can raise the
  // eligibility copy from the same stable callback. The TONE is passed: an
  // earlier toast's timer used to cut a newer message short, and the tone used
  // to be sniffed out of the text (which never matched "Failed" anywhere).
  const showToast = useCallback((msg: string, tone: "neutral" | "success" | "error" = "neutral") => {
    setToast(msg);
    setToastTone(tone);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);
  // Queued ledger movements (redeem / penalty / manual adjust) are DURABLE
  // COMMANDS: `queueCommand` only persists them and schedules a flush, so the
  // acknowledgement — never the queue call — is what may say "done". The
  // operation id is parked here with the copy that is true ONLY once the server
  // has answered, plus the honest refusal line for a 4xx.
  const ledgerOpsRef = useRef<Map<string, { done: string; refused: string }>>(new Map());
  const trackLedgerOp = useCallback((operationId: string, done: string, refused: string) => {
    ledgerOpsRef.current.set(operationId, { done, refused });
  }, []);
  const onAcknowledged = useCallback((acknowledged: TaskOutboxAcknowledgedEvent) => {
    // An approval ack carries how many award-list members the family server
    // left out (roster changed between close and approve). Say it as
    // eligibility: a replay recomputes that set from the CURRENT roster, so
    // "N not eligible" stays true either way — "skipped N just now" would not.
    if (
      (acknowledged.action === "approve" || acknowledged.action === "approve-all") &&
      typeof acknowledged.skipped === "number" &&
      acknowledged.skipped > 0
    ) {
      showToast(`${acknowledged.skipped} not eligible`, "neutral");
    }
    const operationId = acknowledged?.operationId;
    if (!operationId) return;
    // A TERMINAL outcome without a landing: the command will never be applied,
    // so the mark comes off exactly as it does on a success — and a family that
    // was told "sending" is told why it stopped. A 4xx is never a confirmation.
    const terminal = acknowledged.failed === true || acknowledged.evicted === true;
    // A `network`-category terminal is retry EXHAUSTION (or a lost response):
    // the server never refused it — the command may even have applied. That
    // state gets the unconfirmed sentence, never "refused".
    const unconfirmed = terminal && acknowledged.category === "network";
    const tracked = ledgerOpsRef.current.get(operationId);
    if (tracked) {
      ledgerOpsRef.current.delete(operationId);
      if (terminal) {
        showToast(
          unconfirmed
            ? UNCONFIRMED_CHANGE_COPY
            : `${tracked.refused} ${ledgerRefusalCopy(acknowledged.reason)}`.trim(),
          "error",
        );
      } else {
        showToast(tracked.done, "success");
      }
    } else if (terminal) {
      showToast(
        unconfirmed
          ? UNCONFIRMED_CHANGE_COPY
          : acknowledged.evicted === true
            // A local drop never reached the server, so the server cannot have
            // refused it — name the drop alone.
            ? ledgerRefusalCopy("outbox_evicted")
            : `The family server refused that change. ${ledgerRefusalCopy(acknowledged.reason)}`.trim(),
        "error",
      );
    }
    // A non-terminal ack can still carry the server's own sentence (an
    // approval that has not reached the kitchen display yet): say it, never
    // bank it as a silent success.
    const notice = typeof acknowledged.error === "string" ? acknowledged.error.trim() : "";
    if (!terminal && notice) showToast(notice, "error");
    // The double-tap guard releases per task: an unrelated command's ack must
    // not free a task whose own tap is still in flight. Only an ack that names
    // no task at all (a config or redeem leg legitimately has none) falls back
    // to clearing the set.
    const ackedTaskId = Number(acknowledged.taskId);
    if (pinFreeInFlightRef.current.size > 0) {
      if (Number.isSafeInteger(ackedTaskId) && ackedTaskId > 0) {
        pinFreeInFlightRef.current.delete(ackedTaskId);
      } else {
        for (const taskId of [...pinFreeInFlightRef.current]) pinFreeInFlightRef.current.delete(taskId);
      }
    }
    setOptimisticRows((prev) => {
      if (!(operationId in prev)) return prev;
      const next = { ...prev };
      delete next[operationId];
      return next;
    });
  }, [showToast]);
  const {
    queue: queueCommand,
    counts: outboxCounts,
    entries: outboxEntries,
    cancel: cancelQueuedOperation,
    onAcknowledged: onOutboxAcknowledged,
  } = useTaskCommandQueue({ onAdopted: adoptStores });
  useEffect(() => {
    if (typeof onOutboxAcknowledged !== "function") return;
    // The unsubscribe matters: `onTaskOutboxAcknowledged` returns one and the
    // listener set is MODULE-level, so five visits to /tasks used to leave five
    // listeners calling setState on unmounted components.
    return onOutboxAcknowledged(onAcknowledged);
  }, [onOutboxAcknowledged, onAcknowledged]);
  // A refusal can carry the server's authoritative catalog and still
  // acknowledge nothing (`stale_config`, `acknowledged: 0`), which meant the
  // rendered reward/penalty list stayed stale until the next 60s pull. The
  // sibling surfaces (RewardSection, WeeklyPrizesCard) already listen here.
  useEffect(() => onTaskOutboxAdopted(adoptStores), [adoptStores]);

  // Restore tasks state from PocketBase snapshot on mount (bridges container restarts)
  const restoreAttempted = useRef(false);
  // Readable twin of that ref. `syncRead` cannot say whether a read has been
  // ISSUED (it returns to "unknown" on success), so only this state lets a
  // render know its loading window. The ref stays the synchronous guard.
  const [snapshotRequested, setSnapshotRequested] = useState(false);
  // The snapshot read is a TRI-STATE, never a boolean: a signed-out browser is
  // 401'd ("hidden, not done"), but /api/tasks/sync also answers 503 when the
  // rollover/projection is unavailable, and a network failure rejects outright.
  // Both of those used to leave `guestSyncBlocked` false, so the family was told
  // "All caught up. No pending tasks right now." about a board nobody read.
  const [syncRead, setSyncRead] = useState<"unknown" | "blocked" | "failed">("unknown");
  // The highest snapshot revision this page has adopted. A response that is not
  // strictly newer is ignored, so the 60s refresh can never race the mount fetch
  // into overwriting a fresher ledger with a staler snapshot.
  const adoptedRevisionRef = useRef<string | null>(null);
  // Restore tasks state from a PocketBase snapshot (bridges container restarts
  // and merges another device's changes) via the SHARED pure merge — the same
  // guards the 60s refresh loop applies to the stores: adopt new tasks, and
  // adopt field changes on known rows only with proof (a pending tap, a
  // send-back stamp, or an earn that paid the row), never clobber a fresh
  // local tap. The old inline version was ADD-ONLY on known rows, so a kid's
  // tap on another device never reached this page's Needs-approval queue (and
  // an approval elsewhere never cleared the stale "On the way" row here).
  // The rewards / penalties / weekly-prizes legs are NOT merged here: that
  // last-write-wins merge lives in exactly one place,
  // applyTaskConfigSnapshotToStores, which the outbox's snapshot proof and the
  // 60s refresh share. This page only re-reads what that seam adopted.
  const restoreFromSnapshot = useCallback((data: any) => {
    if (!data?.snapshot) return;
    const snap = data.snapshot;
    // Monotonic guard: the mount fetch and the 60s refresher both land here, and
    // the server leg wins outright within one `weekStart` — so without this a
    // STALE snapshot could overwrite a newer ledger. `revision` is a decimal
    // string on the snapshot, which compares correctly as a string only when the
    // length is equal, so compare as a number.
    const revision = typeof snap.revision === "string" && /^\d+$/.test(snap.revision)
      ? snap.revision
      : null;
    if (revision !== null) {
      const last = adoptedRevisionRef.current;
      if (last !== null && Number(revision) <= Number(last)) return;
      adoptedRevisionRef.current = revision;
    }
    if (snap.archivedTasks && typeof snap.archivedTasks === "object") setArchivedTasks(snap.archivedTasks);
    applyTaskConfigSnapshotToStores(snap);
    adoptStores();
    const { tasks: nextTasks, weekData: nextWeek, tasksChanged, weekChanged, deletedTaskIds } = mergeTasksSnapshot(
      tasksRef.current,
      weekDataRef.current,
      snap
    );
    if (deletedTaskIds?.length) saveDeletedTaskIds(deletedTaskIds);
    if (tasksChanged) {
      tasksRef.current = nextTasks;
      setTasks(nextTasks);
    }
    if (weekChanged) {
      weekDataRef.current = nextWeek;
      setWeekData(nextWeek);
    }
  }, [adoptStores]);

  // ONE read seam for both callers, so the tri-state, the abort and the
  // monotonic guard cannot drift between the mount fetch and the 60s loop.
  const pullSnapshot = useCallback((signal?: AbortSignal) => {
    // The cross-device READ is not retired (contract:
    // tests/unit/task-normal-writes-disabled.test.ts) — and it is a GET, so it
    // carries no write body. The signal is optional so the abortable path and
    // the plain one are the same call, not two seams.
    const request = signal ? fetch("/api/tasks/sync", { signal }) : fetch("/api/tasks/sync");
    return request
    .then((r) => {
      if (r.status === 401) {
        setSyncRead("blocked");
        return null;
      }
      if (!r.ok) {
        // 503 = the rollover/projection could not be read. That is NOT an empty
        // board, so it must not render one.
        setSyncRead("failed");
        return null;
      }
      setSyncRead("unknown");
      return r.json();
    })
    .then((data) => restoreFromSnapshot(data))
    .catch(() => {
      // An ABORT is this component's own teardown, not a failed read.
      if (signal?.aborted) return;
      setSyncRead("failed");
    });
  }, [restoreFromSnapshot]);

  useEffect(() => {
    if (!mounted || restoreAttempted.current) return;
    restoreAttempted.current = true;
    setSnapshotRequested(true);
    const controller = new AbortController();
    void pullSnapshot(controller.signal).finally(() => {
      // An abort is this component's own teardown, not a settled read.
      if (!controller.signal.aborted) setSnapshotRequested(false);
    });
    return () => controller.abort();
  }, [mounted, pullSnapshot]);

  // Cross-device sync: re-pull the snapshot when the global refresher
  // finishes a cycle (60s tick, tab-wake, post-login) so a task added on
  // another device appears without a manual reload. The listener used to remove
  // itself without aborting or guarding the in-flight fetch, so a response could
  // land after unmount and race the mount fetch into the stores.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const onRefreshed = () => {
      if (!active) return;
      void pullSnapshot(controller.signal);
    };
    window.addEventListener("consuela-data-refreshed", onRefreshed);
    return () => {
      active = false;
      controller.abort();
      window.removeEventListener("consuela-data-refreshed", onRefreshed);
    };
  }, [pullSnapshot]);

  const triggerConfetti = useCallback(() => {
    // ConfettiBurst also gates itself, so this is belt and braces: the burst
    // never mounts under reduced motion, from either input.
    if (typeof window !== "undefined" && readReducedMotionPreference()) return;
    setConfettiActive(true);
    setTimeout(() => setConfettiActive(false), 2500);
  }, []);

  // Escape / scrim-dismiss must not throw away a half-typed chore without
  // saying so — Delete, far less destructive, gets a whole confirmation dialog.
  // A pristine sheet closes straight away; a dirty one asks first.
  const editFormPristineRef = useRef("");
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const closeEdit = () => {
    setEditingId(null);
    setIsAdding(false);
    setConfirmDiscardOpen(false);
  };
  const formIsDirty = () => JSON.stringify(editForm) !== editFormPristineRef.current;
  const cancelEdit = () => {
    if (formIsDirty()) {
      setConfirmDiscardOpen(true);
      return;
    }
    closeEdit();
  };

  const startEdit = (task: Task) => {
    if (!isParent) return; // P0 gate — kids/guests can never edit family chores
    if (!tasks.some((row) => row.id === task.id)) {
      showToast("That chore is still being saved — try again in a moment.", "neutral");
      return;
    }
    setEditingId(task.id);
    setEditForm({ ...task });
    setIsAdding(false);
    editFormPristineRef.current = JSON.stringify({ ...task });
  };

  const startAdd = () => {
    if (!isParent) return; // P0 gate
    setEditingId(null);
    setSaveAsFavorite(false);
    setTemplateId(null);
    const firstNonPet = membersData.find((m: any) => m.role !== "pet");
    const defaultMember = isLoggedIn && currentUser
      ? { name: currentUser.name, emoji: currentUser.emoji }
      : { name: firstNonPet?.fullName || membersData[0]?.fullName || "", emoji: firstNonPet?.emoji || membersData[0]?.emoji || "👤" };
    const fresh = emptyTask(defaultMember);
    editFormPristineRef.current = JSON.stringify(fresh);
    setEditForm(fresh);
    setIsAdding(true);
  };

  // Escape / scrim-dismiss must not throw away a half-typed chore without
  // saying so — Delete, far less destructive, gets a whole confirmation dialog.
  // A pristine sheet closes straight away; a dirty one asks first.

  const saveTask = () => {
    if (!editForm.title.trim()) return;
    // Normalize mode fields so a stale value from a previous mode can't leak
    // (e.g. switching Crew -> Assigned must drop crewSize/crew).
    // `crewCloseMode` mirrors the crewSize treatment: it is a crew-only field,
    // so a crew→solo switch must NULL it explicitly — the server refuses a
    // non-crew patch that still names a crew mode, and a stale stored value
    // would otherwise ride the spread into the assigned-task patch.
    const modeNormalized: Task = isCrewTask(editForm)
      ? { ...editForm, universal: false, speedBonus: undefined, crewCloseMode: editForm.crewCloseMode ?? "strict", crew: { members: crewMembers(editForm) } }
      : editForm.universal
        ? { ...editForm, crewSize: null, crew: null, crewCloseMode: null, speedBonus: normalizeSpeedBonus(editForm.speedBonus) }
        : { ...editForm, crewSize: null, crew: null, crewCloseMode: null, speedBonus: undefined, universal: false };
    // A recurring chore never expires (the server refuses recurring + a
    // non-null expiresAfterDays): the hidden Advanced control must not leak a
    // stale value even if the row was toggled to Recurring after it was set.
    const normalized: Task = {
      ...modeNormalized,
      expiresAfterDays: editForm.recurring
        ? null
        : editForm.expiresAfterDays
          ? editForm.expiresAfterDays
          : null,
    };
    if (isAdding) {
      const temporaryId = uid();
      const added = queueCommand({
        route: "/api/tasks/manage",
        action: "add",
        payload: { task: { ...normalized } },
        displayTarget: { kind: "task", temporaryId, title: normalized.title },
      });
      addOptimisticRow(added.operationId, { kind: "add", task: { ...normalized, id: temporaryId } });
      if (saveAsFavorite) {
        const item: TaskTemplateConfigItem = {
          id: templateId ?? `tpl-${added.operationId}`,
          title: normalized.title,
          points: normalized.points,
          category: normalized.category,
          priority: normalized.priority,
          mode: normalized.crewSize ? "crew" : normalized.universal ? "open" : "assigned",
          ...(normalized.crewSize ? { crewSize: normalized.crewSize } : {}),
          ...(!normalized.crewSize && !normalized.universal ? { assigneeName: normalized.assignee } : {}),
          ...(normalized.universal && normalized.speedBonus ? { speedBonus: normalized.speedBonus } : {}),
          ...(normalized.expiresAfterDays ? { expiresAfterDays: normalized.expiresAfterDays } : {}),
        };
        // The leg does not exist until first written, and the config seam
        // refuses non-`replace` actions on an absent leg (422
        // invalid_current_config). Save is therefore the full next list,
        // mirroring WeeklyPrizesCard.
        // Compose from the PAGE state and adopt it optimistically: two
        // back-to-back saves sit in the outbox window together, and reading
        // the ack-only store would drop the first favorite from the second
        // replace. The ack's strictly-newer adoption remains the reconciler.
        const next = [...templates.filter((t) => t.id !== item.id), item];
        saveTaskTemplates(next);
        setTemplates(next);
        // The outbox is keyed by operationId, so the config write deliberately
        // owns its own key: sharing the manage add's operationId would make
        // this enqueue replace that entry and one of the two commands would
        // silently never send or retry. The two legs' server receipt maps are
        // separate, so replay-safety does not depend on the shared key (the
        // template id still names the manage operation that created it).
        void writeTaskConfig({
          operationId: "",
          kind: "task-templates",
          action: "replace",
          updatedAt: new Date().toISOString(),
          items: next,
        }).catch(() => {});
      }
    } else {
      const updated = queueCommand({
        route: "/api/tasks/manage",
        action: "update",
        payload: { taskId: editingId, patch: { ...normalized } },
        displayTarget: { kind: "task", taskId: editingId ?? undefined, title: normalized.title },
      });
      addOptimisticRow(updated.operationId, { kind: "update", task: { ...normalized, id: editingId as number } });
    }
    closeEdit();
  };

  // A delete is only ever queued for a row the SERVER already has. A
  // temporary (not-yet-acknowledged) add row is inert: it renders as text, and
  // delete/edit/complete on it can never send an id the server has never seen.
  const deleteTask = (id: number) => {
    const row = tasks.find((t) => t.id === id);
    if (!row) {
      showToast("That chore is still being saved — try again in a moment.", "neutral");
      return;
    }
    const removed = queueCommand({
      route: "/api/tasks/manage",
      action: "delete",
      payload: { taskId: id },
      displayTarget: { kind: "task", taskId: id, title: row.title },
    });
    addOptimisticRow(removed.operationId, { kind: "remove", taskId: id });
    closeEdit();
  };

  const updateForm = (field: keyof Task, value: any) => {
    setEditForm(prev => {
      const updated: Task = { ...prev, [field]: value };
      if (field === "assignee") {
        const member = membersData.find((m: any) => m.fullName === value);
        if (member) updated.assigneeEmoji = member.emoji;
      }
      return updated;
    });
  };

  // Assignee / Open / Crew mode is derived from the form fields (no parallel
  // state): crewSize => crew, universal => open, otherwise assigned.
  const formType: "assigned" | "open" | "crew" =
    isCrewTask(editForm) ? "crew" : editForm.universal ? "open" : "assigned";
  const setTaskType = (type: "assigned" | "open" | "crew") => {
    setEditForm(prev => {
      if (type === "open") {
        return { ...prev, universal: true, crewSize: null, crew: null, stealable: false, speedBonus: prev.speedBonus ?? 2, assignee: OPEN_ASSIGNEE, assigneeEmoji: "🤝" };
      }
      if (type === "crew") {
        const minSize = Math.max(2, crewMemberCount(prev));
        const size = typeof prev.crewSize === "number" && prev.crewSize >= minSize ? prev.crewSize : minSize;
        return { ...prev, universal: false, crewSize: size, crew: prev.crew ?? { members: [] }, stealable: false, speedBonus: undefined, assignee: "Crew", assigneeEmoji: "🤝" };
      }
      return { ...prev, universal: false, crewSize: null, crew: null, speedBonus: undefined, assignee: prev.assignee === OPEN_ASSIGNEE || prev.assignee === "Crew" ? "" : prev.assignee };
    });
  };

  // Prefill-only: copy the template onto the form (mode included), resolve a
  // named assignee against the LIVE roster — a pet (or a name that no longer
  // resolves) is skipped so the form keeps the current assignee.
  const prefillFromTemplate = (template: TaskTemplateConfigItem) => {
    setEditForm((prev) => {
      const next: Task = {
        ...prev,
        title: template.title,
        points: template.points,
        category: template.category,
        priority: template.priority,
        expiresAfterDays: template.expiresAfterDays ?? null,
      };
      if (template.mode === "crew") {
        next.universal = false;
        next.crewSize = template.crewSize ?? 2;
        next.crew = null;
        next.stealable = false;
        next.speedBonus = undefined;
        next.assignee = "Crew";
        next.assigneeEmoji = "🤝";
      } else if (template.mode === "open") {
        next.universal = true;
        next.crewSize = null;
        next.crew = null;
        next.stealable = false;
        next.speedBonus = template.speedBonus ?? 2;
        next.assignee = OPEN_ASSIGNEE;
        next.assigneeEmoji = "🤝";
      } else {
        next.universal = false;
        next.crewSize = null;
        next.crew = null;
        next.speedBonus = undefined;
        const member = template.assigneeName
          ? membersData.find((m: any) =>
              m.role !== "pet" &&
              (m.fullName === template.assigneeName || m.name === template.assigneeName)
            )
          : undefined;
        if (member) {
          next.assignee = member.fullName || member.name;
          next.assigneeEmoji = member.emoji || "👤";
        }
      }
      return next;
    });
    setTemplateId(template.id);
    setFocusTitleToken((token) => token + 1);
  };

  // The leg refuses non-`replace` actions while it is absent (422), so a
  // delete is the full remaining list, exactly like a save. Composed from the
  // page state and adopted optimistically — a second delete must not read the
  // ack-only store and resurrect the first deleted row in its replace.
  const deleteTemplate = (template: TaskTemplateConfigItem) => {
    const next = templates.filter((t) => t.id !== template.id);
    saveTaskTemplates(next);
    setTemplates(next);
    void writeTaskConfig({
      operationId: "",
      kind: "task-templates",
      action: "replace",
      updatedAt: new Date().toISOString(),
      items: next,
    }).catch(() => {});
    setManageTemplate(null);
  };

  // The sheet opens as a DRAFT: state is copied from the feed so per-row
  // removals are local to this confirmation and nothing is written yet.
  const openRepeatLastWeek = () => {
    setRepeatRows(lastWeekDefs);
    setRepeatOpen(true);
  };

  // One durable manage `add` per remaining def, each with its own operationId
  // (queueCommand mints one when none is passed) — partial failures surface
  // per-row through the existing outbox, never a new mechanism.
  const confirmRepeatLastWeek = () => {
    repeatRows.forEach((def) => {
      const mode = def.crewSize && def.crewSize >= 2 ? "crew" : def.universal ? "open" : "assigned";
      const roster = membersData.find((m: any) => m.fullName === def.assigneeName);
      const task = {
        title: def.title, points: def.points, category: def.category, priority: def.priority,
        due: getISO.today, recurring: null,
        universal: mode === "open",
        ...(mode === "open" ? { assignee: OPEN_ASSIGNEE, assigneeEmoji: "🤝", speedBonus: 0 } : {}),
        ...(mode === "assigned" ? { assignee: def.assigneeName ?? "", assigneeEmoji: roster?.emoji ?? "👤" } : {}),
        ...(mode === "crew" ? { crewSize: def.crewSize, crew: { members: [] }, ...(def.crewCloseMode ? { crewCloseMode: def.crewCloseMode } : {}) } : {}),
      };
      queueCommand({ route: "/api/tasks/manage", action: "add", payload: { task }, displayTarget: { kind: "task", title: def.title } });
    });
    setRepeatOpen(false);
  };

  const generateAiTasks = async () => {
    setAiSuggesting(true);
    try {
      const res = await fetch('/api/hermes/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: "planner", intent: "task_ideas" }),
      });
      const data = await res.json();
      // Validated planner rows only; an assignee that isn't on the live
      // roster drops the suggestion (never defaulted onto a named family member).
      const suggestions = data.ok
        ? mapTaskIdeas(data.result?.actions, membersData, { nextId: uid, today: getISO.today })
        : [];
      if (suggestions.length > 0) {
        setAiSuggestions(suggestions);
      } else {
        showToast("Consuela couldn't come up with ideas right now — try again in a bit.", "error");
      }
    } catch {
      showToast("Consuela couldn't come up with ideas right now — try again in a bit.", "error");
    }
    setAiSuggesting(false);
  };

  const adoptSuggestion = (suggestion: Task) => {
    const temporaryId = uid();
    const adopted = queueCommand({
      route: "/api/tasks/manage",
      action: "add",
      payload: { task: { ...suggestion } },
      displayTarget: { kind: "task", temporaryId, title: suggestion.title },
    });
    addOptimisticRow(adopted.operationId, { kind: "add", task: { ...suggestion, id: temporaryId } });
    setAiSuggestions(prev => prev.filter(s => s.title !== suggestion.title));
  };

  const dismissSuggestion = (title: string) => {
    setAiSuggestions(prev => prev.filter(s => s.title !== title));
  };

  const openPinEntry = (taskId: number) => {
    // Every attempt starts from a clean slate: no leftover PIN/error/success, no
    // leftover claim-for selection, no leftover success timer. A timer armed by
    // the PREVIOUS attempt can no longer close this one.
    clearDialogTimers();
    // A temporary row is not a task yet: there is nothing on the server to
    // complete, so this can only be a stale click on a queued add.
    const task = tasks.find((x) => x.id === taskId);
    if (!task) {
      showToast("That chore is still being saved — try again in a moment.", "neutral");
      return;
    }
    if (task.completed) {
      if (isPendingApproval(task) && isLoggedIn && currentUser?.role === "child" && resolveMemberName(membersData, task.pendingApproval?.byName) === resolveMemberName(membersData, currentUser.name)) {
        // The kid who tapped can take it back PIN-free: nothing was verified,
        // so there is nothing to un-verify. No points ever moved. The reopen is
        // a durable server undo queued FIRST — the pending row itself is never
        // cleared locally, so a lost command can never silently erase a tap.
        // Names are compared in the resolved-ledger space — a session first
        // name and a fullName byName are the same kid.
        const me = resolveMemberName(membersData, currentUser.name);
        const undo = queueCommand({
          route: "/api/tasks/claim",
          action: "undo",
          payload: { taskId, memberName: me, assigneeEmoji: task.assigneeEmoji },
          displayTarget: { kind: "undo", taskId, title: task.title },
        });
        addOptimisticRow(undo.operationId, { kind: "cancelling", taskId });
        showToast("Taking it back — asking the family server to reopen it.", "neutral");
        return;
      }
      setUndoTaskId(taskId);
      setUndoPin("");
      setUndoError("");
      return;
    }
    // Crew tasks are joined + checked in, never single-completed. Decide the
    // member's next step from live membership and open the PIN step (self-join).
    if (isCrewTask(task)) {
      const me = myRosterName || "";
      const joined = me ? crewHasMember(task, me) : false;
      const checkedIn = me ? crewMemberCheckedIn(task, me) : false;
      const action: "crew-join" | "crew-checkin" | null =
        joined && !checkedIn ? "crew-checkin" : !joined && !crewFull(task) ? "crew-join" : null;
      if (!action) {
        showToast(joined ? "You've already checked in — waiting on the rest of the crew." : "This crew is full.", "neutral");
        return;
      }
      setUndoTaskId(null);
      setPinIntent({ kind: "crew", taskId, action });
      setPinInput("");
      setPinError("");
      setPinSuccess("");
      setSnatchForMember(pickDefaultClaimMember(membersData, currentUser?.name) || task.assignee);
      return;
    }
    if (completesWithoutPin(currentUser?.role, currentUser?.age, task)) {
      // Trust-but-verify, junior edition: an under-10 kid's tap on their OWN
      // assigned chore is a durable PIN-free completion command — queued FIRST,
      // with no credential at all, because the session IS the identity. Points
      // move only when a parent approves, and only through the outbox.
      if (task.completedInWeek === localWeekStartISO()) {
        showToast("That chore was already completed on another device.", "neutral");
        return;
      }
      // This branch has no `pinBusy` to guard it — a double-tap queued the same
      // command twice, and its only dedupe read a row the just-queued command
      // has not stamped yet. The guard is synchronous with the tap.
      if (pinFreeInFlightRef.current.has(taskId)) {
        showToast("That tap is already on its way.", "neutral");
        return;
      }
      const me = resolveMemberName(membersData, currentUser!.name);
      const complete = queueCommand({
        route: "/api/tasks/claim",
        action: "complete",
        payload: { taskId, memberName: me, assigneeEmoji: task.assigneeEmoji },
        displayTarget: { kind: "claim", taskId, title: task.title },
      });
      pinFreeInFlightRef.current.add(taskId);
      addOptimisticRow(complete.operationId, { kind: "pending", taskId });
      triggerConfetti();
      showToast(`Done! +${task.points}pts on the way — a parent approves.`, "success");
      return;
    }
    // 10+ kids and anyone else hit a PIN step; child rows then wait for
    // approval (decided in submitPin from the VERIFIED member record, not
    // the session).
    setUndoTaskId(null);
    setPinIntent({ kind: "task", taskId });
    setPinInput("");
    setPinError("");
    setPinSuccess("");
    if (task.universal || isSnatchable(task)) {
      // Default the claim to the signed-in member — a kid typing their own
      // PIN against a select stuck on "Rebecca (Mom)" reads as "wrong PIN".
      const defaultSnatcher = pickDefaultClaimMember(membersData, currentUser?.name) || task.assignee;
      setSnatchForMember(defaultSnatcher);
    } else {
      setSnatchForMember("");
    }
  };

  const openRewardPin = (reward: Reward, memberName?: string) => {
    clearDialogTimers();
    // Default to the SIGNED-IN member, not the first roster entry: a kid
    // redeeming was told "Caspian needs 850 more pts" — a number computed
    // against a parent's balance. Same trap the claim select documents.
    const member = memberName || pickDefaultClaimMember(membersData, currentUser?.name);
    const balance = weekData.points[member] || 0;
    if (balance < reward.cost) {
      showToast(`${member.split(" ")[0]} needs ${reward.cost - balance} more pts for ${reward.emoji} ${reward.name}`, "neutral");
      return;
    }
    if (reward.cost > 100) {
      setParentApprovalReward(reward);
      setParentApprovalPin("");
      setParentApprovalError("");
      setRedeemForMember(member);
      return;
    }
    setPinIntent({ kind: "reward", reward });
    setPinInput("");
    setPinError("");
    setPinSuccess("");
    setRedeemForMember(member);
  };

  const approveParentReward = async () => {
    if (!parentApprovalReward || !parentApprovalPin || pinBusy) return;
    setPinBusy(true);
    try {
      let parent: any = null;
      let unreachable = false;
      for (const m of membersData.filter((m: any) => m.role === "parent")) {
        const result = await verifyPinRemote(m.fullName, parentApprovalPin);
        if (result.status === "ok") { parent = m; break; }
        if (result.status === "unreachable") { unreachable = true; break; }
      }
      if (unreachable) {
        setParentApprovalError(unreachableCopy());
        setParentApprovalPin("");
        armDialogTimer(() => setParentApprovalError(""), 2500);
        return;
      }
      if (!parent) {
        setParentApprovalError("Parent PIN required to approve large rewards.");
        setParentApprovalPin("");
        armDialogTimer(() => setParentApprovalError(""), 2500);
        return;
      }
      parentApprovalPinRef.current = parentApprovalPin;
      parentApprovalNameRef.current = parent.fullName;
      setPinIntent({ kind: "reward", reward: parentApprovalReward });
      setParentApprovalReward(null);
      setParentApprovalPin("");
      setParentApprovalError("");
      setPinInput("");
      setPinError("");
      setPinSuccess("");
    } finally {
      setPinBusy(false);
    }
  };

  // ONE opener for all three review dialogs, funnelling through the same timer
  // registry the PIN dialogs use: a stale 2500 ms error-clear from the previous
  // attempt can never erase the next dialog's error.
  const openApprovalDialog = useCallback(
    (taskId: number | null, mode: "approve" | "sendback" | "approve-all") => {
      clearDialogTimers();
      setApprovalTaskId(taskId);
      setApprovalMode(mode);
      setApprovalPin("");
      setApprovalError("");
    },
    [clearDialogTimers],
  );

  const submitApproval = async () => {
    if ((approvalTaskId === null && approvalMode !== "approve-all") || !approvalPin || pinBusy) return;
    setPinBusy(true);
    try {
      let parent: any = null;
      let unreachable = false;
      let sawWrongPin = false;
      for (const m of membersData.filter((m: any) => m.role === "parent")) {
        const result = await verifyPinRemote(m.fullName, approvalPin);
        if (result.status === "ok") { parent = m; break; }
        if (result.status === "unreachable") { unreachable = true; break; }
        sawWrongPin = true;
      }
      if (unreachable) {
        setApprovalError(unreachableCopy());
        setApprovalPin("");
        armDialogTimer(() => setApprovalError(""), 2500);
        return;
      }
      if (!parent) {
        // A typo is not a permission problem: say which one it was.
        setApprovalError(
          sawWrongPin
            ? "That PIN wasn't right — try again."
            : "Parent PIN required to review tapped tasks.",
        );
        setApprovalPin("");
        armDialogTimer(() => setApprovalError(""), 2500);
        return;
      }
      const parentName: string = parent.fullName;

      // Every review action is ONE durable command. The PIN rides the ephemeral
      // credential registry keyed by the operation id — it is never written to
      // the outbox entry or to localStorage, and the outbox releases it only
      // after the acknowledgment (or the user's cancel).
      if (approvalMode === "approve-all") {
        // a row with a queued delete is about to be gone server-side; sending
        // it in the batch earns a 404 whose stranded-id self-heal would make
        // the queued removal permanent (D8). F2 owns `pendingApprovals`' SOURCE
        // (raw → substituted rows); B1a filters only the ids it selects here.
        const taskIds = pendingApprovals
          .filter((p) => !optimisticRemoved.includes(p.id))
          .map((p) => p.id);
        if (taskIds.length === 0) {
          showToast("Those tapped chores are already on their way out.", "neutral");
          setApprovalTaskId(null);
          setApprovalMode("approve");
          setApprovalPin("");
          setApprovalError("");
          return;
        }
        queueCommand({
          route: "/api/tasks/approve",
          action: "approve-all",
          payload: { taskIds, memberName: parentName },
          displayTarget: { kind: "approval", title: `${taskIds.length} tapped tasks` },
          credential: { pin: approvalPin },
        });
        showToast(
          `Approving ${taskIds.length} tapped task${taskIds.length !== 1 ? "s" : ""} — points land when the family server confirms.`,
        );
      } else if (approvalMode === "approve" && approvalTaskId !== null) {
        // `pendingApprovals` IS the substituted queue (interactiveRows filtered
        // to pending taps); this closure is declared above the `interactiveRows`
        // memo, and capturing that memo here makes the React Compiler unable to
        // preserve it — so the queue itself is the source, not the raw `tasks`.
        const target = pendingApprovals.find((x) => x.id === approvalTaskId);
        const crew = target?.pendingApproval?.crew;
        const amt = target?.pendingApproval?.points ?? target?.points ?? 0;
        queueCommand({
          route: "/api/tasks/approve",
          action: "approve",
          payload: { taskId: approvalTaskId, memberName: parentName },
          displayTarget: { kind: "approval", taskId: approvalTaskId, title: target?.title },
          credential: { pin: approvalPin },
        });
        showToast(
          crew && crew.length > 0
            ? `Approving — +${amt}pts each for ${crew.map((n) => n.split(" ")[0]).join(", ")}.`
            : `Approving — +${amt}pts for ${(target?.pendingApproval?.byName ?? "").split(" ")[0]}.`,
        );
      } else if (approvalTaskId !== null) {
        const target = pendingApprovals.find((x) => x.id === approvalTaskId);
        const sendBack = queueCommand({
          route: "/api/tasks/approve",
          action: "send-back",
          payload: { taskId: approvalTaskId, memberName: parentName },
          displayTarget: { kind: "approval", taskId: approvalTaskId, title: target?.title },
          credential: { pin: approvalPin },
        });
        addOptimisticRow(sendBack.operationId, { kind: "cancelling", taskId: approvalTaskId });
        showToast(
          target && isCrewTask(target)
            ? "Sending back — the whole crew reopens, no points given."
            : "Sending back — no points were given.",
        );
      }
      setApprovalTaskId(null);
      setApprovalMode("approve");
      setApprovalPin("");
      setApprovalError("");
    } finally {
      setPinBusy(false);
    }
  };

  // Parent removes a crew member (before approval). Parent-PIN gated.
  const submitCrewRemove = async () => {
    if (!crewRemoveTarget || !crewRemovePin || pinBusy) return;
    setPinBusy(true);
    try {
      let parent: any = null;
      let unreachable = false;
      for (const m of membersData.filter((m: any) => m.role === "parent")) {
        const result = await verifyPinRemote(m.fullName, crewRemovePin);
        if (result.status === "ok") { parent = m; break; }
        if (result.status === "unreachable") { unreachable = true; break; }
      }
      if (unreachable) {
        setCrewRemoveError(unreachableCopy());
        setCrewRemovePin("");
        armDialogTimer(() => setCrewRemoveError(""), 2500);
        return;
      }
      if (!parent) {
        setCrewRemoveError("Parent PIN required.");
        setCrewRemovePin("");
        armDialogTimer(() => setCrewRemoveError(""), 2500);
        return;
      }
      queueCommand({
        route: "/api/tasks/claim",
        action: "crew-remove",
        payload: {
          taskId: crewRemoveTarget.taskId,
          memberName: parent.fullName,
          targetName: crewRemoveTarget.memberName,
        },
        displayTarget: { kind: "crew", taskId: crewRemoveTarget.taskId, title: crewRemoveTarget.memberName },
        credential: { pin: crewRemovePin },
      });
      showToast(
        `Removing ${crewRemoveTarget.memberName.split(" ")[0]} from the crew — the family server confirms.`,
      );
      setCrewRemoveTarget(null);
      setCrewRemovePin("");
      setCrewRemoveError("");
    } finally {
      setPinBusy(false);
    }
  };

  // Parent closes a parent-mode crew with whatever check-ins exist. Same
  // parent-PIN verification loop as every other review action, ONE durable
  // claim command, and no optimistic row (decision §3): the toast and the
  // outbox status carry the wait, and only the server stages the pending.
  const submitCrewClose = async () => {
    if (!crewCloseTarget || !crewClosePin || pinBusy) return;
    setPinBusy(true);
    try {
      let parent: any = null;
      let unreachable = false;
      for (const m of membersData.filter((m: any) => m.role === "parent")) {
        const result = await verifyPinRemote(m.fullName, crewClosePin);
        if (result.status === "ok") { parent = m; break; }
        if (result.status === "unreachable") { unreachable = true; break; }
      }
      if (unreachable) {
        setCrewCloseError(unreachableCopy());
        setCrewClosePin("");
        armDialogTimer(() => setCrewCloseError(""), 2500);
        return;
      }
      if (!parent) {
        setCrewCloseError("Parent PIN required to close the crew.");
        setCrewClosePin("");
        armDialogTimer(() => setCrewCloseError(""), 2500);
        return;
      }
      const target = tasks.find((x) => x.id === crewCloseTarget.taskId);
      const awards = target ? crewMembers(target).filter((m) => m.checkedInAt) : [];
      queueCommand({
        route: "/api/tasks/claim",
        action: "crew-close",
        payload: { taskId: crewCloseTarget.taskId, memberName: parent.fullName },
        displayTarget: { kind: "task", taskId: crewCloseTarget.taskId, title: target?.title },
        credential: { pin: crewClosePin },
      });
      showToast(
        `Closing the crew — the ${awards.length} helper${awards.length !== 1 ? "s" : ""} who checked in land${awards.length === 1 ? "s" : ""} in approval for +${target?.points ?? 0} pts each.`,
      );
      setCrewCloseTarget(null);
      setCrewClosePin("");
      setCrewCloseError("");
    } finally {
      setPinBusy(false);
    }
  };

  const openPenaltyPin = (penalty: Penalty) => {
    clearDialogTimers();
    setPinIntent({ kind: "penalty", penalty });
    setPinInput("");
    setPinError("");
    setPinSuccess("");
    // The signed-in member is the default, not the first roster entry.
    setPenaltyForMember(pickDefaultClaimMember(membersData, currentUser?.name));
  };

  // The ONE close. Every exit (Escape, scrim, Cancel, a success timer) funnels
  // through here, which is what makes a half-open dialog impossible: no arm of
  // the intent, no per-attempt input, no claim-for selection and no verified
  // parent-approval credential can survive a dismissal.
  const closePinDialog = useCallback(() => {
    clearDialogTimers();
    setPinIntent(null);
    setPinInput("");
    setPinError("");
    setPinSuccess("");
    setSnatchForMember("");
    setRedeemForMember("");
    setPenaltyForMember("");
    setParentApprovalReward(null);
    setParentApprovalPin("");
    setParentApprovalError("");
    // A verified parent PIN is a live credential: it must not survive a
    // cancelled redemption and ride the NEXT unrelated one's wire body.
    parentApprovalPinRef.current = "";
    parentApprovalNameRef.current = "";
  }, [clearDialogTimers]);

  // The SHARED resolver, so the wire body names the member the page means.
  // The hand-rolled version here did `rawName.startsWith(m.name)`, which
  // resolved "Alexandra Garcia" to "Alex Garcia" (Alex is a prefix of
  // Alexandra) — the same identity bug as the tile lookups, one layer down,
  // where it silently moved a child's points to their parent.
  const normalizeName = (rawName: string): string => resolveMemberName(membersData, rawName);

  const submitUndo = async () => {
    if (!undoTaskId || !undoPin || pinBusy) return;
    setPinBusy(true);
    try {
      const task = tasks.find(t => t.id === undoTaskId);
      if (!task || !task.completed) {
        // A dead Submit button: the footer's only state is `loading`, cleared by
        // the `finally`, so it re-enabled with no message and no change.
        setUndoError("That chore isn't completed any more — nothing to undo.");
        setUndoPin("");
        armDialogTimer(() => setUndoError(""), 4000);
        return;
      }
      const memberName = task.completedBy || task.assignee;
      const result = await verifyPinRemote(memberName, undoPin);
      if (result.status === "unreachable") {
        setUndoError(unreachableCopy());
        setUndoPin("");
        armDialogTimer(() => setUndoError(""), 2000);
        return;
      }
      if (result.status === "wrongPin") {
        setUndoError("Wrong PIN. Try again.");
        setUndoPin("");
        armDialogTimer(() => setUndoError(""), 2000);
        return;
      }
      const verified = result.member;
      const normalizedName = normalizeName(memberName);
      // BOTH a paid undo and a pending reopen are the same durable server undo.
      // No local point reversal, no local reopen, no legacy POST: the outbox
      // command is queued first and the family's ledger moves only when it is
      // acknowledged.
      const undo = queueCommand({
        route: "/api/tasks/claim",
        action: "undo",
        payload: { taskId: task.id, memberName: normalizedName, assigneeEmoji: task.assigneeEmoji },
        displayTarget: { kind: "undo", taskId: task.id, title: task.title },
        credential: { pin: undoPin },
      });
      addOptimisticRow(undo.operationId, { kind: "cancelling", taskId: task.id });
      showToast(
        isPendingApproval(task)
          ? "Reopening — no points were given."
          : `Undoing ${task.title} — points come back when the family server confirms.`,
      );
      setUndoTaskId(null);
      setUndoPin("");
    } finally {
      setPinBusy(false);
    }
  };

  const submitPin = async () => {
    if (!pinInput || pinBusy) return;
    setPinBusy(true);
    try {
    if (pinReward) {
      const memberName = redeemForMember;
      if (!memberName) {
        setPinError("Select who is redeeming the reward.");
        setPinInput("");
        armDialogTimer(() => setPinError(""), 2000);
        return;
      }
      const result = await verifyPinRemote(memberName, pinInput);
      if (result.status === "ok") {
        const verified = result.member;
        const normalizedName = normalizeName((verified as any).name);
        const cost = pinReward.cost;
        const balance = weekData.points[normalizedName] || 0;
        if (balance < cost) {
          setPinError(`Not enough points — ${pinReward.name} costs ${cost}pts, ${normalizedName.split(" ")[0]} has ${balance}pts.`);
          setPinInput("");
          armDialogTimer(() => setPinError(""), 2500);
          return;
        }
        // The redemption is a durable command against the server-authoritative
        // route: the stored reward row decides the cost, the ledger entry is
        // written under the week lock, and a reward over 100pts carries the
        // parent's PIN so the server can gate it. Nothing is deducted locally.
        const queued = queueCommand({
          route: "/api/rewards/redeem",
          action: "redeem",
          payload: {
            rewardId: pinReward.id,
            memberName: normalizedName,
            ...(parentApprovalNameRef.current ? { parentName: parentApprovalNameRef.current } : {}),
          },
          displayTarget: { kind: "config", title: pinReward.name },
          credential: {
            pin: pinInput,
            ...(parentApprovalPinRef.current ? { parentPin: parentApprovalPinRef.current } : {}),
          },
        });
        // Nothing has been confirmed yet — `queueCommand` only persists the
        // command — so the dialog says SENDING and the acknowledgment says done
        // (or names the refusal).
        trackLedgerOp(
          queued.operationId,
          `${pinReward.emoji} ${normalizedName.split(" ")[0]} redeemed ${pinReward.name} — ${cost}pts.`,
          `${pinReward.name} wasn't redeemed.`,
        );
        parentApprovalPinRef.current = "";
        parentApprovalNameRef.current = "";
        setPinInput("");
        setPinSuccess(`${pinReward.emoji} Sending ${pinReward.name} to the family server…`);
        armDialogTimer(closePinDialog, 1800);
      } else {
        setPinError(result.status === "unreachable" ? unreachableCopy() : "Wrong code for selected member. Try again.");
        setPinInput("");
        armDialogTimer(() => setPinError(""), 2000);
      }
      return;
    }

    if (pinPenalty) {
      // The TARGET is whose points move; the ACTOR is whoever's PIN this
      // verifies. They are not the same person: a grown-up applying a penalty
      // to a child used to build a body whose `memberName` was the CHILD, so the
      // route's live-role gate read the child's PIN and answered 403 adult_only
      // — the whole penalty catalog was unreachable for a kid.
      const targetName = normalizeName(penaltyForMember);
      if (!targetName) {
        setPinError("Select a member.");
        setPinInput("");
        armDialogTimer(() => setPinError(""), 2000);
        return;
      }
      // Capture the identity that verified from the loop itself rather than
      // re-deriving it afterwards.
      let actorName = "";
      let result = await verifyPinRemote(targetName, pinInput);
      if (result.status === "ok") actorName = targetName;
      if (result.status === "wrongPin") {
        for (const m of membersData.filter((m: any) => m.role === "parent")) {
          const parentResult = await verifyPinRemote(m.fullName, pinInput);
          if (parentResult.status === "ok") { actorName = m.fullName; result = parentResult; break; }
          if (parentResult.status === "unreachable") { result = parentResult; break; }
        }
      }
      if (result.status === "ok" && actorName) {
        const penaltyPoints = pinPenalty.points ?? 0;
        // The catalog penalty id travels, never a client-chosen point value:
        // the server reads the canonical penalty and refuses a body that tries
        // to set its own amount.
        const queued = queueCommand({
          route: "/api/tasks/ledger",
          action: "penalty",
          payload: {
            memberName: actorName,
            ...(actorName !== targetName ? { targetMemberName: targetName } : {}),
            itemId: pinPenalty.id,
          },
          displayTarget: { kind: "config", title: pinPenalty.name },
          credential: { pin: pinInput },
        });
        trackLedgerOp(
          queued.operationId,
          `-${penaltyPoints}pts from ${targetName.split(" ")[0]}.`,
          `${pinPenalty.name} wasn't applied.`,
        );
        setPinInput("");
        setPinSuccess(`Sending ${pinPenalty.name} (−${penaltyPoints}pts) to the family server…`);
        armDialogTimer(closePinDialog, 1800);
      } else {
        setPinError(result.status === "unreachable" ? unreachableCopy() : "Wrong PIN. Try again.");
        setPinInput("");
        armDialogTimer(() => setPinError(""), 2000);
      }
      return;
    }

    if (pinCrewAction) {
      const crewAction = pinCrewAction;
      const memberName = snatchForMember;
      if (!memberName) {
        setPinError("Select who is joining.");
        setPinInput("");
        armDialogTimer(() => setPinError(""), 2000);
        return;
      }
      const result = await verifyPinRemote(memberName, pinInput);
      if (result.status === "ok") {
        const normalizedName = normalizeName(result.member.name);
        const claimantEmoji = membersData.find((m: any) => m.fullName === normalizedName)?.emoji;
        queueCommand({
          route: "/api/tasks/claim",
          action: crewAction.action,
          payload: { taskId: crewAction.taskId, memberName: normalizedName, assigneeEmoji: claimantEmoji },
          displayTarget: { kind: "crew", taskId: crewAction.taskId, title: tasks.find((t) => t.id === crewAction.taskId)?.title },
          credential: { pin: pinInput },
        });
        const first = normalizedName.split(" ")[0];
        setPinInput("");
        setPinSuccess(
          crewAction.action === "crew-join"
            ? `🤝 ${first} joining the crew — the family server confirms.`
            : `✓ ${first} checking in.`,
        );
        armDialogTimer(closePinDialog, 1800);
      } else {
        setPinError(result.status === "unreachable" ? unreachableCopy() : "Wrong code for selected member. Try again.");
        setPinInput("");
        armDialogTimer(() => setPinError(""), 2000);
      }
      return;
    }

    if (pinTaskId === null) return;
    const task = tasks.find(t => t.id === pinTaskId);
    // Neither of these may be silent: the footer's only state is `loading`,
    // cleared by the `finally`, so a bare `return` re-enabled Submit with no
    // message and no state change — a button that flashes and reports nothing.
    if (!task || task.completed) {
      setPinError("That chore was already completed on another device.");
      setPinInput("");
      armDialogTimer(() => setPinError(""), 4000);
      return;
    }
    if (task.completedInWeek === localWeekStartISO()) {
      setPinError("That chore was already completed on another device.");
      setPinInput("");
      armDialogTimer(() => setPinError(""), 4000);
      return;
    }

    if (task.universal || isSnatchable(task)) {
      const claimant = snatchForMember;
      if (!claimant) {
        setPinError("Select who is claiming this task.");
        setPinInput("");
        armDialogTimer(() => setPinError(""), 2000);
        return;
      }
      const result = await verifyPinRemote(claimant, pinInput);
      if (result.status === "ok") {
        const verified = result.member;
        const wasSnatch = !task.universal && isSnatchable(task);
        const normalizedName = normalizeName((verified as any).name);
        const claimantEmoji = (membersData.find((m: any) => m.fullName === normalizedName)?.emoji) || task.assigneeEmoji;
        // The kid branch is keyed on the CLAIMANT's role from the verified
        // record — the same record the server routes on — never on age
        // (claims are always PIN-gated) and never on the session user (a
        // parent claiming for a kid must mirror the server's pending answer).
        const kidClaim = (verified as any).role === "child";
        const speedBonus = !wasSnatch ? normalizeSpeedBonus(task.speedBonus) : 0;
        const earnAmount = task.points + speedBonus;
        // Exactly one family member wins the race and the points land on the
        // server — the browser queues the claim and adopts the winning
        // weekData. No local earn, no local rollback snapshot.
        const claim = queueCommand({
          route: "/api/tasks/claim",
          action: "claim",
          payload: { taskId: task.id, memberName: normalizedName, assigneeEmoji: claimantEmoji },
          displayTarget: { kind: "claim", taskId: task.id, title: task.title },
          credential: { pin: pinInput },
        });
        addOptimisticRow(claim.operationId, { kind: "pending", taskId: task.id });
        const pointsMsg = earnAmount > 0 ? `+${earnAmount}pts` : "";
        setPinInput("");
        setPinSuccess(kidClaim
          ? `🎯 ${normalizedName.split(" ")[0]} — grabbed! +${earnAmount}pts on the way (parent approves).`
          : `🎯 ${normalizedName.split(" ")[0]} ${wasSnatch ? "snatched" : "completed"} ${task.title}! ${pointsMsg}`);
        triggerConfetti();
        armDialogTimer(closePinDialog, 1500);
      } else {
        setPinError(result.status === "unreachable" ? unreachableCopy() : "Wrong code for selected member. Try again.");
        setPinInput("");
        armDialogTimer(() => setPinError(""), 2000);
      }
      return;
    }

    const result = await verifyPinRemote(task.assignee, pinInput);
    if (result.status === "ok") {
      const verified = result.member;
      const normalizedName = normalizeName((verified as any).name);
      // One durable completion command for BOTH shapes — the server owns the
      // ledger and the pending/completed decision. The browser keeps only
      // display-only optimism; the points line appears only on acknowledgment.
      const complete = queueCommand({
        route: "/api/tasks/claim",
        action: "complete",
        payload: { taskId: task.id, memberName: normalizedName, assigneeEmoji: task.assigneeEmoji },
        displayTarget: { kind: "claim", taskId: task.id, title: task.title },
        credential: { pin: pinInput },
      });
      if (completesWithPendingApproval((verified as any).role, task)) {
        // Identity verified by PIN; the parent verifies the work. Points wait.
        addOptimisticRow(complete.operationId, { kind: "pending", taskId: task.id });
        triggerConfetti();
        setPinInput("");
        setPinSuccess(`⏳ ${normalizedName.split(" ")[0]} — done! +${task.points}pts on the way.`);
        armDialogTimer(closePinDialog, 1500);
        return;
      }
      const pointsMsg = task.points > 0 ? `+${task.points}pts` : "";
      setPinInput("");
      setPinSuccess(`${normalizedName.split(" ")[0]} completed ${task.title}! ${pointsMsg}`);
      triggerConfetti();
      armDialogTimer(closePinDialog, 1500);
    } else {
      setPinError(result.status === "unreachable" ? unreachableCopy() : "Wrong PIN. Try again.");
      setPinInput("");
      armDialogTimer(() => setPinError(""), 2000);
    }
    } finally {
      setPinBusy(false);
    }
  };

  const startAddReward = () => { setEditingRewardId(null); setAddingReward(true); setRewardForm({ id: Date.now(), name: "", emoji: "\u{1F381}", cost: 50 }); };
  const startEditReward = (r: Reward) => { setEditingRewardId(r.id); setAddingReward(false); setRewardForm({ ...r }); };
  // Reward + penalty catalog writes are durable config commands: queued BEFORE
  // the local list changes, adopted from the acknowledgment, and never written
  // to localStorage as a "success" first.
  const queueConfig = (kind: "rewards" | "penalties", action: "upsert" | "delete", rest: Record<string, unknown>) => {
    void writeTaskConfig({
      operationId: "",
      kind,
      action,
      updatedAt: new Date().toISOString(),
      ...(rest.item !== undefined ? { item: rest.item as TaskConfigCommand["item"] } : {}),
      ...(rest.itemId !== undefined ? { itemId: rest.itemId as TaskConfigCommand["itemId"] } : {}),
    }).catch(() => {});
  };
  const saveReward = () => {
    if (!rewardForm.name.trim()) return;
    queueConfig("rewards", "upsert", { item: { ...rewardForm, name: rewardForm.name.trim() } });
    setEditingRewardId(null);
    setAddingReward(false);
    showToast(`\u2705 "${rewardForm.name.trim()}" \u2014 saving to the family server\u2026`);
  };
  const deleteReward = (id: number) => {
    queueConfig("rewards", "delete", { itemId: id });
    setEditingRewardId(null);
    showToast("\u{1F5D1}\uFE0F Removing that reward \u2014 saving to the family server\u2026");
  };

  const startAddPenalty = () => { setEditingPenaltyId(null); setAddingPenalty(true); setPenaltyForm({ id: Date.now(), name: "", emoji: "\u26A0\uFE0F", points: 10 }); };
  const startEditPenalty = (p: Penalty) => { setEditingPenaltyId(p.id); setAddingPenalty(false); setPenaltyForm({ ...p }); };
  const savePenalty = () => {
    if (!penaltyForm.name.trim()) return;
    queueConfig("penalties", "upsert", { item: { ...penaltyForm, name: penaltyForm.name.trim() } });
    setEditingPenaltyId(null);
    setAddingPenalty(false);
    showToast(`\u2705 "${penaltyForm.name.trim()}" \u2014 saving to the family server\u2026`);
  };
  const deletePenalty = (id: number) => {
    queueConfig("penalties", "delete", { itemId: id });
    setEditingPenaltyId(null);
    showToast("\u{1F5D1}\uFE0F Removing that penalty \u2014 saving to the family server\u2026");
  };

  const generateAiRewards = async () => {
    setAiRewardSuggesting(true);
    try {
      const res = await fetch('/api/hermes/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: "planner", intent: "reward_ideas" }),
      });
      const data = await res.json();
      // Priced from validated points \u2014 the old "Cost pts" detail regex is gone.
      const ideas = data.ok ? mapRewardIdeas(data.result?.actions) : [];
      if (ideas.length > 0) {
        setAiRewards(ideas);
      } else {
        showToast("Consuela couldn't come up with reward ideas right now \u2014 try again in a bit.");
      }
    } catch {
      showToast("Consuela couldn't come up with reward ideas right now \u2014 try again in a bit.");
    }
    setAiRewardSuggesting(false);
  };

  const adoptReward = (r: Reward) => {
    queueConfig("rewards", "upsert", { item: { ...r, id: Date.now() } });
    setAiRewards(prev => prev.filter(rr => rr.name !== r.name));
    showToast(`\u2705 "${r.name}" \u2014 saving to the family server\u2026`);
  };

  // The ONE close for the adjust sheet. A VERIFIED parent PIN is a live
  // credential: leaving it in React state after the sheet closes contradicts
  // the stated contract in `src/modes/kid/kid-store.ts` and would ride the next
  // adjust's wire body.
  const closeAdjust = useCallback(() => {
    clearDialogTimers();
    setAdjustMember(null);
    setAdjustPin("");
    setAdjustError("");
    setAdjustSuccess("");
  }, [clearDialogTimers]);
  const adjustAmountValue = Math.abs(parseInt(adjustAmount, 10) || 0);
  const openAdjust = (name: string) => {
    clearDialogTimers();
    setAdjustMember(name);
    setAdjustAmount("10");
    setAdjustDir("-");
    setAdjustReason("");
    setAdjustPin("");
    setAdjustError("");
    setAdjustSuccess("");
  };

  const submitAdjust = async () => {
    if (!adjustMember || !adjustPin || pinBusy) return;
    setPinBusy(true);
    try {
      let parent: any = null;
      let unreachable = false;
      for (const m of membersData.filter((m: any) => m.role === "parent")) {
        const result = await verifyPinRemote(m.fullName, adjustPin);
        if (result.status === "ok") { parent = m; break; }
        if (result.status === "unreachable") { unreachable = true; break; }
      }
      if (unreachable) {
        setAdjustError(unreachableCopy());
        setAdjustPin("");
        armDialogTimer(() => setAdjustError(""), 2500);
        return;
      }
      if (!parent) {
        setAdjustError("Parent PIN required. Try again.");
        setAdjustPin("");
        armDialogTimer(() => setAdjustError(""), 2500);
        return;
      }
      // The DIRECTION is chosen by the Add/Remove toggle, so the amount is
      // always a magnitude: `Math.abs` stops a typed "-50" from INVERTING a
      // deduction into a credit, and zero is refused rather than reported as a
      // confirmed no-op.
      const delta = Math.abs(parseInt(adjustAmount, 10) || 0);
      if (delta <= 0) {
        setAdjustError("Enter how many points to move.");
        setAdjustPin("");
        armDialogTimer(() => setAdjustError(""), 2500);
        return;
      }
      const change = adjustDir === "+" ? delta : -delta;
      // A manual adjust is a parent-PIN ledger command like any other: the
      // amount and reason travel, the balance never does, and the server writes
      // the entry under the week lock with a non-negative floor.
      // `memberName` is the VERIFIED PARENT (the PIN subject and the live-role
      // gate); the CHILD whose balance moves rides as `targetMemberName`.
      // Sending the child's name under the parent's PIN was 403 adult_only.
      const queued = queueCommand({
        route: "/api/tasks/ledger",
        action: "adjust",
        payload: {
          memberName: parent.fullName,
          ...(parent.fullName !== adjustMember ? { targetMemberName: adjustMember } : {}),
          amount: change,
          reason: adjustReason,
        },
        displayTarget: { kind: "config", title: adjustMember },
        credential: { pin: adjustPin },
      });
      const label = adjustDir === "+" ? `+${delta}` : `-${delta}`;
      trackLedgerOp(
        queued.operationId,
        `${label} pts for ${adjustMember.split(" ")[0]}.`,
        `The ${label} pts adjust for ${adjustMember.split(" ")[0]} didn't go through.`,
      );
      setAdjustSuccess(`Sending ${label} pts for ${adjustMember.split(" ")[0]}…`);
      armDialogTimer(closeAdjust, 1800);
    } finally {
      setPinBusy(false);
    }
  };

  // Display-only optimism, derived from the per-operation mark map: a queued ADD
  // contributes a temporary row, a queued DELETE hides its row, a queued UPDATE
  // substitutes its row's copy, and a queued completion / reopen contributes an
  // honest note. None of this is written to the store.
  const optimisticCancelling = useMemo(
    () => optimisticRowsList
      .filter((row): row is Extract<OptimisticRow, { kind: "cancelling" }> => row.kind === "cancelling")
      .map((row) => row.taskId),
    [optimisticRowsList],
  );
  const optimisticPending = useMemo(
    () => optimisticRowsList
      .filter((row): row is Extract<OptimisticRow, { kind: "pending" }> => row.kind === "pending")
      .map((row) => row.taskId)
      // A CANCELLING mark suppresses that task's own pending note (H4): the
      // reopen is already shown, so both must not render at once.
      .filter((taskId) => !optimisticCancelling.includes(taskId)),
    [optimisticRowsList, optimisticCancelling],
  );
  const optimisticPendingSet = useMemo(
    () => new Set([...optimisticPending, ...optimisticCancelling]),
    [optimisticPending, optimisticCancelling],
  );
  // LAST WINS: two queued updates to the same chore (a double-tap on Save, or an
  // edit the parent retried) collapse to ONE substituted row carrying the newest
  // copy, so a chore can never render twice.
  const optimisticUpdates = useMemo(() => {
    const byId = new Map<number, Task>();
    for (const row of optimisticRowsList) {
      if (row.kind !== "update") continue;
      byId.set(row.task.id, row.task);
    }
    return [...byId.values()];
  }, [optimisticRowsList]);
  // Memoised: an unmemoised array here sat in the dependency chain of
  // `interactiveRows` -> `dynamicLeaderboard` (streaks, ranks, badges, all-time
  // levels for EVERY member) -> five downstream memos -> the level-up effect, so
  // all of it recomputed on every render and defeated the memo eight lines up.
  const optimisticUpdatedIds = useMemo(() => optimisticUpdates.map((task) => task.id), [optimisticUpdates]);
  // A queued ADD is a TEMPORARY row: it never reaches an interactive list (so
  // complete/edit/delete cannot send an id the server has never assigned) and
  // renders inert below instead.
  const optimisticTasks = useMemo(
    () => optimisticRowsList
      .filter((row): row is Extract<OptimisticRow, { kind: "add" }> => row.kind === "add")
      .map((row) => row.task)
      .filter((task) => !optimisticRemoved.includes(task.id) && !optimisticUpdatedIds.includes(task.id)),
    [optimisticRowsList, optimisticRemoved, optimisticUpdatedIds],
  );
  // `serverTasks` is the server's rows only: a queued remove hides its row.
  const serverTasks = useMemo(
    () => tasks.filter((t) => !optimisticRemoved.includes(t.id)),
    [tasks, optimisticRemoved],
  );
  // What every interactive surface renders until the acknowledgment replaces a
  // row: the server's rows, with a queued UPDATE's copy substituted in place (the
  // id is a real server id, so the row stays actionable).
  const interactiveRows = useMemo(
    () => [
      ...serverTasks.filter((t) => !optimisticUpdatedIds.includes(t.id)),
      ...optimisticUpdates,
    ],
    [serverTasks, optimisticUpdatedIds, optimisticUpdates],
  );
  // The inert lookup table: the same rows PLUS the temporary ones, used only to
  // resolve a queued command's display target to a title.
  const optimisticVisible = [...interactiveRows, ...optimisticTasks];
  // The pending list never shows a row whose completion is already queued, and
  // never shows a row a queued delete is about to remove.
  const hiddenByQueuedCommand = useMemo(
    () => new Set([...optimisticPending, ...optimisticRemoved]),
    [optimisticPending, optimisticRemoved],
  );

  // The MEMBER predicate only. `showCompleted` is the Completed card's OWN
  // toggle, so it used to sit in this filter: the expanded list was empty until
  // you expanded it, which meant the card could not be gated on the array it
  // maps over and a Friday completion vanished on Monday morning.
  const memberScoped = interactiveRows.filter((t) => {
    if (filterMember === "Open") {
      // Open + late-stealable rows and crew tasks with space.
      return (t.universal || isSnatchable(t)) || (isCrewTask(t) && !crewFull(t));
    }
    if (filterMember === "My Tasks" && currentUser) {
      // Ownership in the resolved-ledger space: assignees are migrated to
      // roster fullNames at mount, while the session may carry a first name.
      const mine = myIdentity.isMe(t.assignee);
      const claimable = ((t.universal || isSnatchable(t)) || (isCrewTask(t) && !crewFull(t))) && !t.completed;
      return mine || claimable;
    }
    return filterMember === "All" || t.assignee === filterMember;
  });
  const filtered = showCompleted ? memberScoped : memberScoped.filter((t) => !t.completed);

  const pending = filtered.filter((t) => !t.completed && !hiddenByQueuedCommand.has(t.id));
  // The SAME substituted source every other surface reads (contract at
  // `visibleTasks` below): a queued edit's copy is what the parent is shown,
  // and a queued delete's row is already gone. `interactiveRows` is built from
  // `serverTasks` (which filters `optimisticRemoved`) and from
  // `optimisticUpdates` (de-duplicated LAST-WINS by id), so this array carries
  // no queued-deleted id and no duplicate id. Approve-all's `taskIds` selection
  // is B1a's line, which already filters `optimisticRemoved` at the selection
  // site; F2 changes the queue's SOURCE, not that contract.
  const pendingApprovals = interactiveRows.filter(isPendingApproval);
  // Newest tap first: the queue is a parent's "what landed since I looked"
  // scan, and source order gives no anchor. `pendingApproval.at` is the
  // server's normalized UTC instant (task-operation-contract.ts:134 returns
  // `toISOString()`), so a string sort would also work — `Date.parse` is used
  // because it does not depend on the string's format surviving.
  // owner: U1 (order). Source of the rows: F2. Do not merge the two.
  const approvalQueue = [...pendingApprovals].sort(
    (a, b) => (Date.parse(b.pendingApproval!.at) - Date.parse(a.pendingApproval!.at)) || (b.id - a.id),
  );
  // The first read is outstanding and nothing is on screen yet: the card's
  // honest loading window, skipped when localStorage already holds rows.
  const approvalQueueLoading =
    isLoggedIn && currentUser?.role === "parent" && snapshotRequested && syncRead === "unknown" && tasks.length === 0;
  // A row with a live approval command is not re-tappable; task-id precedence
  // is the store's own (task-command-store.ts:229-239), and `failed` is terminal.
  const approvalInFlightTaskIds = new Set<number>();
  let approveAllInFlight = false;
  for (const entry of outboxEntries) {
    if (entry.route !== "/api/tasks/approve" || entry.status === "failed") continue;
    if (entry.action === "approve-all") approveAllInFlight = true;
    const single = Number(entry.payload?.taskId);
    if (Number.isSafeInteger(single) && single > 0) approvalInFlightTaskIds.add(single);
    const many = entry.payload?.taskIds;
    if (Array.isArray(many)) {
      for (const id of many) {
        const taskId = Number(id);
        if (Number.isSafeInteger(taskId) && taskId > 0) approvalInFlightTaskIds.add(taskId);
      }
    }
    const target = Number(entry.displayTarget?.taskId);
    if (Number.isSafeInteger(target) && target > 0) approvalInFlightTaskIds.add(target);
  }
  // Per-row kid label, only when 2+ kids are in the queue: a section header
  // would reorder the very queue the ordering contract pins.
  const approvalQueueHasMultipleKids =
    new Set(approvalQueue.map((t) => t.pendingApproval!.byName.split(" ")[0]).filter(Boolean)).size >= 2;
  // The Open board: unclaimed "up for grabs" tasks (universal or late-stealable)
  // PLUS crew tasks with space — shown only when the viewer isn't on a
  // specific-member filter, sorted by points (biggest race first). Plain
  // computation (no useMemo): a filter+sort over the family's small task list
  // is cheaper than the manual memo the compiler couldn't preserve.
  const openBoard = (() => {
    if (filterMember !== "All" && filterMember !== "My Tasks" && filterMember !== "Open") return [] as Task[];
    const me = isLoggedIn && currentUser ? resolveMemberName(membersData, currentUser.name) : "";
    return interactiveRows
      .filter((t) => {
        if (t.completed) return false;
        if ((t.universal || isSnatchable(t)) && !isCrewTask(t)) return true;
        if (isCrewTask(t)) {
          if (crewFull(t)) return false;
          if (me && crewHasMember(t, me)) return false;
          return true;
        }
        return false;
      })
      .sort((a, b) => b.points - a.points);
  })();
  // Every completion the filter can show, regardless of whether the card is
  // expanded — this is the array the card gates on AND maps over, so nothing on
  // screen reconciles against anything else.
  const completed = memberScoped.filter((t) => t.completed);
  // DISPLAY-ONLY: regroup + relabel, never recompute a total. Plain
  // computation, no useMemo — the same call the Open board above makes on
  // purpose: a filter+sort+group over the family's small task list is cheaper
  // than the manual memo the compiler could not preserve.
  const completedGroups = groupCompletedTasksByWeek(completed);
  // Everything that reads "the family's chores" reads the SUBSTITUTED copy, so
  // a queued edit is reflected on the completed list, the streaks, the leaderboard
  // and the member sheet until the acknowledgment replaces it with the real row.
  const visibleTasks = interactiveRows;
  const thisWeeksCompleted = getThisWeeksCompletedTasks(visibleTasks);
  const thisWeeksCompletedCount = thisWeeksCompleted.length;

  const dynamicLeaderboard: LeaderboardEntry[] = useMemo(() => {
    const entries = membersData
      .filter((m: any) => m.role !== "pet")
      .map((m: any) => {
        const name = m.fullName;
        const weeklyPoints = weekData.points[name] || 0;
        const allTimeTotal = allTime.totals[name];
        const allTimePoints = allTimeTotal?.points ?? null;
        const allTimeComps = allTimeTotal?.completions ?? null;
        // Streaks are per-member: filter this week's completion dates to this
        // member before walking back consecutive days.
        const streak = calculateRealStreak(name, weekData, getThisWeeksCompletedDates(visibleTasks, name));
        const { known, level, title, emoji, progress } = resolveAllTimeLevel(allTimePoints);
        const earnedBadges = earnedBadgeEmojis(allTimePoints, streak, allTimeComps);
        // Weekly Champ history is out-of-band (BADGES.week_champ condition
        // stays false): a rank-1 Hall of Fame entry earns the 🥇 career badge.
        if (hallOfFame.some(h => h.member === name && h.rank === 1) && !earnedBadges.includes("🥇")) {
          earnedBadges.push("🥇");
        }
        const currentMonday = weekData.weekStart;
        const completedInWeek = visibleTasks.filter(
          t => t.completed && t.completedBy === name && isCompletedInWeek(t, currentMonday)
        ).length;
        return {
          name,
          emoji: m.emoji,
          color: m.color,
          points: weeklyPoints,
          streak,
          rank: 0,
          level,
          levelTitle: title,
          levelEmoji: emoji,
          levelKnown: known,
          progressToNext: progress,
          badges: earnedBadges,
          allTimePoints,
          allTimeCompletions: allTimeComps,
          completedInWeek,
        };
      })
      .sort((a, b) => b.points - a.points);

    // Standard competition ranking — the SAME convention the Home/wall/KidHome
    // hook documents (src/components/leaderboard/hooks/useLeaderboardData.ts):
    // a tie SHARES the previous rank and the next rank is SKIPPED, so
    // 100/100/60/60/10 ranks 1, 1, 3, 3, 5.
    //
    // The repeated rank is carried in a LOCAL, never read back off
    // `entries[i - 1]`: `entries` is the array being mapped, so that element
    // still carries the `rank: 0` placeholder the roster mapping wrote ten lines
    // above. Every tied row therefore printed `#0` — 100/100/60/60/10 rendered
    // 1, #0, 3, #0, 5 while Home, the wall and KidHome read the same week as
    // 1, 1, 3, 3, 5.
    // The carry is a single object rather than two `let` bindings: the React
    // Compiler's `react-hooks/immutability` rule rejects reassigning a captured
    // variable inside a component's memo, and the semantics are identical.
    const carried: { points: number | null; rank: number } = { points: null, rank: 0 };
    return entries.map((e, i) => {
      const rank = carried.points !== null && e.points === carried.points ? carried.rank : i + 1;
      carried.points = e.points;
      carried.rank = rank;
      return { ...e, rank };
    });
  }, [weekData, membersData, visibleTasks, hallOfFame, allTime.totals]);

  const topScorer = dynamicLeaderboard[0];
  const familyTotal = dynamicLeaderboard.reduce((sum, entry) => sum + entry.points, 0);
  const championShare = familyTotal > 0 ? topScorer.points / familyTotal : 0;
  const weeklyEarned = Object.values(weekData.points).reduce((a, b) => a + b, 0);
  const daysUntilReset = getDaysUntilWeekReset();
  // Everything the user can still take back: a `reconciling` entry has already
  // been applied server-side, so cancelling it would be a lie.
  const cancellableEntries = outboxEntries.filter((entry) => entry.status !== "reconciling");
  // The long waits, counted apart from the imminent sends. `queued` folds them in
  // by design; this is what lets the banner say which is which.
  const retryingCount = outboxEntries.filter((entry) => entry.status === "retrying").length;

  // The three StatTiles all follow the member filter: a parent tapping a kid's
  // tile reads that kid's open chores / this-week completions / this week's
  // points. "All" and "Open" stay family-wide.
  const scopedMember = useMemo(() => {
    if (filterMember === "All" || filterMember === "Open") return null;
    const target = filterMember === "My Tasks" ? myRosterName : filterMember;
    if (!target) return null;
    // EXACT, in the resolved-ledger space. `e.name.startsWith(target)` matched
    // "Alex Garcia" onto "Alexandra Garcia", so the tile could show the wrong
    // person's points.
    return dynamicLeaderboard.find((e) => e.name === target) ?? null;
  }, [filterMember, myRosterName, dynamicLeaderboard]);

  const scopedCompletedCount = useMemo(() => {
    // Only universal tasks survive the Up-for-grabs filter once completed
    // (isSnatchable turns false) — count what the list can actually show.
    if (filterMember === "Open") return thisWeeksCompleted.filter((t) => t.universal).length;
    if (!scopedMember) return thisWeeksCompletedCount;
    return thisWeeksCompleted.filter((t) => myIdentity.isMe(t.completedBy) || myIdentity.isMe(t.assignee)).length;
  }, [filterMember, scopedMember, thisWeeksCompleted, thisWeeksCompletedCount, myIdentity]);

  const scopedEarned = scopedMember ? scopedMember.points : weeklyEarned;
  // Earned tile detail: all-time context next to the weekly number — the
  // member filter scopes it (a member's own total, family sum under "All").
  // The family sum is knowable only when EVERY member total is known.
  const scopedAllTimeEarned = scopedMember
    ? scopedMember.allTimePoints
    : familyAllTimePoints(dynamicLeaderboard.map((e) => e.allTimePoints));
  const allTimeRead = { state: allTime.state, updatedAt: allTime.updatedAt };
  const sheetEntry = sheetMember ? dynamicLeaderboard.find(e => e.name === sheetMember) : null;

  useEffect(() => {
    if (!mounted || !isLoggedIn || !currentUser) return;
    const myEntry = dynamicLeaderboard.find(e => e.name === myIdentity.name);
    if (!myEntry) return;
    // An unknown level is not level 0: recording it would make the real level
    // look like a promotion the moment the read lands, so nothing is compared
    // and nothing is recorded until the level is actually known.
    if (!myEntry.levelKnown) return;
    // Recorded under the RESOLVED name, so "Alex" could never file Alexandra's
    // level under Alex's key.
    if (!myIdentity.name) return;
    const prev = prevLevelsRef.current[myIdentity.name];
    if (prev !== undefined && myEntry.level > prev) {
      setLevelUpInfo({ name: myIdentity.name, emoji: myEntry.emoji, oldLevel: prev, newLevel: myEntry.level });
    }
    prevLevelsRef.current[myIdentity.name] = myEntry.level;
  }, [dynamicLeaderboard, mounted, isLoggedIn, currentUser, myIdentity]);

  const myPendingQuests = useMemo(() => {
    if (!isLoggedIn || !currentUser) return [];
    return visibleTasks
      .filter(t => !t.completed && (myIdentity.isMe(t.assignee) || t.universal))
      .sort((a, b) => a.points - b.points)
      .slice(0, 3);
  }, [visibleTasks, isLoggedIn, currentUser, myIdentity]);

  const streakSaveNeeded = useMemo(() => {
    if (!isLoggedIn || !currentUser) return false;
    // Delegates to the exported helper (one Local-day rule for the nag, shared
    // with the wall and any future surface) — the page no longer re-derives it.
    return needsStreakSave(myIdentity.name ?? "", weekData, visibleTasks);
  }, [weekData, visibleTasks, isLoggedIn, currentUser, myIdentity]);

  // The neighbour is a POSITION in the sorted board, never `rank ± 1`. Under
  // competition ranking `rank` skips: 100/100/60/60/10 makes the fourth row
  // rank 3, so `dynamicLeaderboard[myEntry.rank - 2]` read the row TWO places
  // above and `dynamicLeaderboard[myEntry.rank]` read the row TWO places below —
  // or, on a tied row carrying the old `#0` placeholder, the champion. Both
  // edges fall off the array and resolve to `undefined` on their own.
  const myIndex = myIdentity.name ? dynamicLeaderboard.findIndex((e) => e.name === myIdentity.name) : -1;
  const myEntry = myIndex >= 0 ? dynamicLeaderboard[myIndex] : null;
  const aheadEntry = myIndex > 0 ? dynamicLeaderboard[myIndex - 1] : undefined;
  const behindEntry = myIndex >= 0 && myIndex < dynamicLeaderboard.length - 1 ? dynamicLeaderboard[myIndex + 1] : undefined;
  // Roster-resolved FULL name for the prize-race personal line — raceGap
  // matches exact weekData keys and currentUser.name can be a first name.
  const raceName = isLoggedIn && currentUser ? resolveMemberName(membersData, currentUser.name) : null;

  if (!mounted) {
    return (
      <PageShell>
        <PageHeader title="Tasks" subtitle="Loading..." />
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent border-[var(--color-accent-selected)]" />
        </div>
      </PageShell>
    );
  }

  return (
    // Board measure: the tab panel is a list of chore cards that goes two-up, and
    // the leaderboard is a ranking table. Neither is a reading column, so neither
    // should be held to one.
    <PageShell measure="board">
      <ConfettiBurst active={confettiActive} />
      {/* Weekly prize ceremony — raceName is the roster-resolved FULL name
          (hall entries are keyed by full name); null for guests = no render. */}
      <WeeklyWinModal memberName={raceName} />
      <Toast open={Boolean(toast)} tone={toastTone}>{toast}</Toast>

      <div className="mx-auto w-full">
      <PageHeader
        title="Tasks"
        subtitle={`${pending.length} pending`}
        action={
          // P0 safety gate: creating and editing family chores is a parent
          // action — kids get their quest surface on KidHome, guests get the
          // honest signed-out view. Repeat last week rides beside Add and is
          // hidden when last week archived nothing (honest-empty contract).
          isParent ? (
            <div className="flex items-center gap-2">
              {lastWeekDefs.length > 0 && (
                <SoftButton size="sm" variant="secondary" onClick={openRepeatLastWeek}>
                  ↻ Repeat last week ({lastWeekDefs.length})
                </SoftButton>
              )}
              <IconButton aria-label="Add task" onClick={startAdd}>
                <span>＋</span>
              </IconButton>
            </div>
          ) : undefined
        }
        icon="✅"
      />

{/* Phone keeps the stacked column (space-y). md+ uses Home's two-column
          grid idiom, and BOTH the rail and the active panel span the full two
          columns below 1536px: the rail is one `md:col-span-2` cell (stats,
          switch, roster) and the panel is another. Without that span the panel
          auto-placed into column 1 alone, so at 768 and 1280 the chore board
          was 360px wide beside an entirely empty column — half the tablet and
          the whole right side of the laptop wasted, and every chore row
          truncating for it. At 1536px+ the left column stops being an even half
          and becomes a real 26rem rail, because a panel of chore rows wants the
          width and the filters want the height. */}
      <div className="px-4 pb-8 2xl:pb-28 [html[data-wall='true']_&]:pb-28 space-y-6 md:grid md:grid-cols-2 md:items-start md:gap-6 md:space-y-0 2xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] 2xl:grid-rows-[auto_1fr]">
        {/* ── The rail ────────────────────────────────────────────────────
            Stats, view switch and the roster filter are ONE grid cell, not
            three. Auto-placement is row-major, so as separate cells the view
            switch landed in row 2 column 1 and the filter was pushed into the
            panel's column — and as a separate row the filter fell below the
            panel's 390px row, opening a 300px hole between the switch and the
            filter it belongs with. One cell is the only arrangement where they
            cannot drift apart.
            Below 1536px this div is `md:col-span-2`, so the stat band still
            spans the page and the switch + filter still sit side by side under
            it — the phone and tablet composition is unchanged. */}
        <div className="wall-board-rail space-y-4 md:col-span-2 2xl:col-span-1">
          <TasksStats
            pendingCount={pending.length}
            completedCount={scopedCompletedCount}
            earnedThisWeek={scopedEarned}
            allTimePoints={scopedAllTimeEarned}
            allTimeRead={allTimeRead}
            activeTab={activeTab}
            onChange={setActiveTab}
          />

          {/* The roster filter, reflowed from a sideways snap-scroller into a
              two-column rail grid by `.wall-board-member-strip`. */}
          {activeTab === "tasks" && (
            <div
              role="group"
              aria-label="Filter chores by family member"
              className="member-strip member-strip-tiles wall-board-member-strip snap-x snap-mandatory overscroll-contain pb-2"
            >
              {allMembers.map((member) => (
                <button
                  key={member}
                  type="button"
                  aria-pressed={filterMember === member}
                  aria-label={`Show ${member}'s chores`}
                  onClick={() => setFilterMember(member)}
                  className={`member-tile shrink-0 snap-start tap-sm ${filterMember === member ? "is-active" : ""}`}
                  style={{ "--chip-color": memberChipColor(memberColors[member]) } as CSSProperties}
                >
                  <Avatar name={member} color={memberColors[member] || "green"} emoji={memberEmojis[member]} size="sm" variant="emoji" />
                  {/* The visible tile is still first-name-only (that is the scan
                      affordance); the accessible name above is the FULL name, so
                      two members sharing a first name are no longer two
                      identically-named tiles. */}
                  <span className="member-tile-name">{["All", "My Tasks", "Open"].includes(member) ? member : member.split(" ")[0]}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {outboxCounts.pending > 0 && (
          <div
            data-testid="task-command-queue"
            role="status"
            aria-live="polite"
            className="rounded-xl px-3 py-2 md:col-span-2 2xl:col-span-1 2xl:col-start-2"
            style={{
              background: "color-mix(in srgb, var(--color-accent-amber) 10%, transparent)",
              border: "1px solid color-mix(in srgb, var(--color-accent-amber) 25%, transparent)",
            }}
          >
            {/* `--color-accent-ink-amber` walks toward body ink: the bare
                accent is ~2.7:1 on this tint in light mode, against a 4.5:1
                floor for 12px semibold. */}
            <p className="text-xs font-semibold text-[var(--color-accent-ink-amber)]">
              {outboxCounts.queued > 0
                ? `⏳ Sending ${outboxCounts.queued} change${outboxCounts.queued !== 1 ? "s" : ""} to the family server…`
                : ""}
              {/* `queued` deliberately folds the backoff in, so "Sending" alone
                  promises an imminent attempt. The hook exposes the split, so
                  the long waits are named rather than smuggled in under it. */}
              {retryingCount > 0
                ? `${outboxCounts.queued > 0 ? " " : ""}↻ ${retryingCount} ${retryingCount === 1 ? "is" : "are"} waiting to retry (up to 5 min).`
                : ""}
              {outboxCounts.authRequired > 0
                ? `${outboxCounts.queued > 0 || retryingCount > 0 ? " " : ""}🔒 ${outboxCounts.authRequired} waiting on a PIN.`
                : ""}
              {outboxCounts.reconciling > 0
                ? `${outboxCounts.queued > 0 || retryingCount > 0 || outboxCounts.authRequired > 0 ? " " : ""}⏳ ${outboxCounts.reconciling} finishing up.`
                : ""}
            </p>
            {/* The failure is its OWN element and its own ink: painted in the same
                amber as "Sending", it read as still-sending. */}
            {outboxCounts.failed > 0 && (
              <p className="mt-1 text-xs font-semibold text-[var(--color-accent-ink-rose)]">
                {`⚠️ ${outboxCounts.failed} couldn't be sent.`}
              </p>
            )}
            {cancellableEntries.length > 0 && (
              <ul className="mt-1 space-y-1">
                {cancellableEntries.map((entry) => (
                  <li key={entry.operationId} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 text-xs text-text-secondary">
                      {entry.displayTarget.title || entry.action}
                      {entry.status === "failed" && entry.lastErrorReason && (
                        <span className="block text-[var(--color-accent-ink-rose)]">
                          {ledgerRefusalCopy(entry.lastErrorReason) || entry.lastErrorReason}
                        </span>
                      )}
                      {/* A still-sending (retrying) or PIN-parked entry carries
                          the server's own sentence — an unreconciled approval
                          said so and the family must be able to read it, not
                          find it buried in a field no surface renders. */}
                      {entry.status !== "failed" && entry.lastErrorMessage && (
                        <span className="block">{entry.lastErrorMessage}</span>
                      )}
                    </span>
                    <button
                      type="button"
                      aria-label={`Cancel queued ${entry.displayTarget.title || entry.action}`}
                      onClick={() => cancelQueuedOperation(entry.operationId)}
                      className="tap-sm hit-44 inline-flex items-center px-2 text-xs font-semibold text-[var(--color-accent-ink-rose)]"
                    >
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {activeTab === "tasks" && (
          <div
            key="tasks"
            id={TASKS_PANEL_IDS.tasks}
            role="tabpanel"
            aria-label="Chore board"
            aria-labelledby={TASKS_VIEW_SWITCH_ID}
            className="panel-swap space-y-6 md:col-span-2 2xl:col-span-1 2xl:col-start-2"
          >
          <>

            {(isAdding || editingId !== null) && (
              <Modal
                open
                onClose={cancelEdit}
                title={isAdding ? "Add Task" : "Edit Task"}
                description="Create or update a family task."
                footer={
                  <>
                    <SoftButton onClick={saveTask} disabled={!editForm.title.trim()} className="flex-1">Save</SoftButton>
                    {!isAdding && <SoftButton variant="danger" onClick={() => setConfirmDeleteOpen(true)} className="flex-1">Delete</SoftButton>}
                    <SoftButton variant="secondary" onClick={cancelEdit} className="flex-1">Cancel</SoftButton>
                  </>
                }
              >
                <div className="space-y-4">
                  {isAdding && templates.length > 0 && (
                    <div>
                      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Favorites</span>
                      <div className="flex flex-wrap gap-2">
                        {templates.map((template) => (
                          <span key={template.id} className="inline-flex items-center gap-1">
                            <Chip size="sm" tone="accent" onClick={() => prefillFromTemplate(template)}>{template.title}</Chip>
                            <button type="button" aria-label={`Manage ${template.title}`} onClick={() => setManageTemplate(template)} className="hit-44 tap-sm text-xs text-text-muted">✎</button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Title</span>
                    <input ref={titleInputRef} value={editForm.title} onChange={(e) => updateForm("title", e.target.value)} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none placeholder:text-text-muted" placeholder="Task title" autoFocus />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {formType === "assigned" && (
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Assignee</span>
                        <select value={editForm.assignee} onChange={(e) => updateForm("assignee", e.target.value)} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none">
                          {membersData.filter((m: any) => m.role !== "pet").map((m: any) => <option key={m.fullName} value={m.fullName}>{memberOptionLabel(m)}</option>)}
                        </select>
                      </label>
                    )}
                    <div className="block">
                      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Due</span>
                      <DueDatePicker value={editForm.due} onChange={(iso) => updateForm("due", iso)} />
                    </div>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Priority</span>
                      <select value={editForm.priority} onChange={(e) => updateForm("priority", e.target.value)} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none">
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Category</span>
                      <select value={editForm.category} onChange={(e) => updateForm("category", e.target.value)} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none">
                        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </label>
                  </div>
                   <div className="grid gap-3 sm:grid-cols-2">
                     {/* Points stepper — kids' rewards live at 5/8/10/15, a
                         stepper beats typing and can't produce NaN. */}
                     <div>
                       <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Points</span>
                       <Stepper value={editForm.points} min={0} max={50} onChange={(v) => updateForm("points", v)} label="Points" />
                     </div>
                     <label className="block">
                       <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Recurring</span>
                       <select value={editForm.recurring || "None"} onChange={(e) => {
                         const recurring = e.target.value === "None" ? null : e.target.value;
                         updateForm("recurring", recurring);
                         // A recurring chore never expires — clear the hidden control's value.
                         if (recurring) updateForm("expiresAfterDays", null);
                       }} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none">
                         <option value="None">None</option>
                         <option value="Daily">Daily</option>
                         <option value="Weekdays">Weekdays</option>
                         <option value="Weekly">Weekly</option>
                       </select>
                     </label>
                   </div>
                  {isAdding && (
                    <Toggle
                      checked={saveAsFavorite}
                      onCheckedChange={setSaveAsFavorite}
                      label="⭐ Save as favorite"
                      description="Reuse this chore from the Favorites row next time."
                    />
                  )}
                  <div>
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Task type</span>
                    <SegmentedControl
                      aria-label="Task type"
                      value={formType}
                      onChange={(value) => setTaskType(value as "assigned" | "open" | "crew")}
                      options={[
                        { id: "assigned", label: "Assigned" },
                        { id: "open", label: "Open" },
                        { id: "crew", label: "Crew" },
                      ]}
                    />
                    <p className="mt-2 text-xs text-text-secondary">
                      {formType === "assigned"
                        ? "One person is responsible for it."
                        : formType === "open"
                          ? "Nobody owns it yet — the family races to claim it."
                          : `Needs ${editForm.crewSize || 2} helpers — everyone earns the full points.`}
                    </p>
                  </div>
                  {formType === "open" && (
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">⚡ Speed bonus (first grab)</span>
                      <input type="number" min={0} max={5} value={editForm.speedBonus ?? 2} onChange={(e) => updateForm("speedBonus", Math.max(0, Math.min(5, parseInt(e.target.value) || 0)))} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none" />
                      <span className="mt-1 block text-xs text-text-muted">The first person to claim it earns this many extra points (0–5).</span>
                    </label>
                  )}
                  {formType === "crew" && (() => {
                    const minSize = Math.max(2, crewMemberCount(editForm));
                    const size = editForm.crewSize ?? minSize;
                    const closeMode = editForm.crewCloseMode ?? "strict";
                    return (
                      <>
                      <div>
                        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Crew size</span>
                        <div className="flex items-center gap-3">
                          <button type="button" aria-label="Fewer helpers" disabled={size <= minSize} onClick={() => updateForm("crewSize", Math.max(minSize, size - 1))} className="tap-sm h-11 w-11 rounded-full glass-subtle text-lg text-text-primary disabled:opacity-40">−</button>
                          <span className="text-lg font-bold tabular-nums text-text-primary">{size}</span>
                          <button type="button" aria-label="More helpers" disabled={size >= 5} onClick={() => updateForm("crewSize", Math.min(5, size + 1))} className="tap-sm h-11 w-11 rounded-full glass-subtle text-lg text-text-primary disabled:opacity-40">+</button>
                          <span className="text-xs text-text-secondary">helpers · +{editForm.points} pts each</span>
                        </div>
                        {crewMemberCount(editForm) > 0 && (
                          <span className="mt-1 block text-xs text-text-muted">Can&apos;t go below {minSize} — {crewMemberCount(editForm)} already joined.</span>
                        )}
                      </div>
                      <div>
                        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Close when</span>
                        <SegmentedControl
                          aria-label="Close when"
                          value={closeMode}
                          onChange={(value) => updateForm("crewCloseMode", value as "strict" | "parent" | "deadline")}
                          options={[
                            { id: "strict", label: "Everyone" },
                            { id: "parent", label: "Parent closes" },
                            { id: "deadline", label: "At due date" },
                          ]}
                        />
                        <p className="mt-2 text-xs text-text-secondary">
                          {closeMode === "parent"
                            ? "A parent can close it once at least one helper checked in — only the helpers who checked in land in approval."
                            : closeMode === "deadline"
                              ? "The morning after the due date, helpers who checked in go to approval. If nobody checked in it just turns overdue."
                              : "It completes when the crew is full and everyone checked in — all-or-nothing."}
                        </p>
                      </div>
                      </>
                    );
                  })()}
                  {(formType === "assigned" || !editForm.recurring) && (
                    <details className="rounded-2xl border border-white/10 px-3 py-2">
                      <summary className="cursor-pointer text-xs font-semibold text-text-secondary">Advanced</summary>
                      <div className="mt-2 space-y-3">
                        {formType === "assigned" && (
                          <Toggle checked={!!editForm.stealable} onCheckedChange={(checked) => updateForm("stealable", checked)} label="⏰ Up for grabs when late" description="If it's not done after the due date, anyone can grab it for the points." />
                        )}
                        {!editForm.recurring && (
                          <div>
                            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Auto-remove if unfinished</span>
                            <Stepper value={editForm.expiresAfterDays ?? 0} min={0} max={30} onChange={(v) => updateForm("expiresAfterDays", v === 0 ? null : v)} label="Auto-remove if unfinished" />
                            <span className="mt-1 block text-xs text-text-muted">Removes it N days after the due date if nobody did it.</span>
                          </div>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              </Modal>
             )}

            {manageTemplate && (
              <Modal
                open
                onClose={() => setManageTemplate(null)}
                title={manageTemplate.title}
                description={`${manageTemplate.points} points · ${manageTemplate.category}`}
                footer={
                  <>
                    <SoftButton
                      onClick={() => { prefillFromTemplate(manageTemplate); setManageTemplate(null); }}
                      className="flex-1"
                    >
                      Use
                    </SoftButton>
                    <SoftButton variant="danger" onClick={() => deleteTemplate(manageTemplate)} className="flex-1">
                      Delete favorite
                    </SoftButton>
                    <SoftButton variant="secondary" onClick={() => setManageTemplate(null)} className="flex-1">
                      Cancel
                    </SoftButton>
                  </>
                }
              >
                <p className="text-sm text-text-secondary">
                  Favorites only prefill the Add sheet — they never create a chore on their own.
                </p>
              </Modal>
            )}

            <TaskLedgerQuarantineNotice localWeekData={weekData} isParent={isParent} />

            <SectionCard headingLevel="h2" title="🫳 Open" description="Nobody's claimed these — fastest fingers earn the bonus." icon="⚡">
              {/* The card used to cease to exist when nothing was claimable,
                  which reads as "this section is broken", not "nothing is up for
                  grabs". */}
              {openBoard.length === 0 ? (
                <EmptyState title="Nothing up for grabs" description="Nothing is open right now — chores show up here once they're late." icon="🤝" />
              ) : (
                <div className="space-y-2">
                  {openBoard.map((task) => {
                    const speed = normalizeSpeedBonus(task.speedBonus);
                    const crew = isCrewTask(task);
                    const joined = crewMemberCount(task);
                    const full = crewFull(task);
                    return (
                      <div
                        key={task.id}
                        className="schedule-row liquid-glass flex items-center gap-3 px-3 py-2.5"
                        style={{
                          backgroundImage: rowTint("var(--color-accent-cyan)"),
                        }}
                      >
                        <Avatar name={task.assignee} color={memberColors[task.assignee] || "green"} emoji={crew ? "🤝" : "🫳"} size="sm" variant="emoji" />
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 text-sm leading-snug text-text-primary" title={task.title}>{task.title}</div>
                          <div className="line-clamp-2 text-xs leading-snug text-text-secondary">
                            {crew
                              ? `🤝 Crew ${joined}/${task.crewSize} joined${full ? " — full" : ""} · +${task.points} pts each`
                              /* "Open — nobody's yet" was not a sentence, and the
                                 board's own heading already says "Open". Say who
                                 the row is waiting for instead. */
                              : `Unclaimed${speed > 0 ? ` · first grab earns +${speed}` : ""}`}
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label={crew ? `Join crew for ${task.title}` : `Claim ${task.title}`}
                          disabled={crew && full}
                          onClick={() => openPinEntry(task.id)}
                          className="tap-sm min-h-[44px] shrink-0 rounded-full px-3 text-xs font-bold text-text-primary glass-subtle disabled:opacity-40"
                        >
                          {crew ? (full ? "Full" : "Join crew") : `🫳 Claim +${task.points + speed}`}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>

            <CrewTasksCard
              tasks={visibleTasks}
              visible={isLoggedIn && currentUser?.role === "parent"}
              onRemoveMember={(taskId, memberName) => {
                setCrewRemoveTarget({ taskId, memberName });
                setCrewRemovePin("");
                setCrewRemoveError("");
              }}
              onCloseCrew={(taskId) => {
                setCrewCloseTarget({ taskId });
                setCrewClosePin("");
                setCrewCloseError("");
              }}
            />

            <SectionCard headingLevel="h2" title="Pending" description={`${pending.length} open tasks`} icon="📋">
              {optimisticTasks.length > 0 && (
                <div className="mb-2 space-y-2">
                  {optimisticTasks.map((row) => (
                    <div
                      key={`optimistic-add-${row.id}`}
                      data-testid="optimistic-add-row"
                      className="flex items-center gap-2.5 px-3 py-2 rounded-2xl"
                      style={{
                        background: "color-mix(in srgb, var(--color-accent-amber) 8%, transparent)",
                        border: "1px solid color-mix(in srgb, var(--color-accent-amber) 22%, transparent)",
                      }}
                    >
                      <span className="text-sm">⏳</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-text-primary" title={row.title}>{row.title}</div>
                        <div className="truncate text-xs text-text-secondary">
                          adding — {row.assignee}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-[var(--color-accent-ink-amber)]">
                        Saving
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {optimisticPendingSet.size > 0 && (
                <div className="mb-2 space-y-2">
                  {[...optimisticPendingSet].map((taskId) => {
                    const row = optimisticVisible.find((t) => t.id === taskId);
                    // D9: the strip is the TOTAL fallback. A queued delete (or a
                    // mark seeded before the first snapshot lands) can hide the
                    // row from every board, so an unresolvable id still renders
                    // the command's own displayTarget title instead of a blank —
                    // never a second copy, the Set dedupes by task.
                    const fallback = row
                      ? null
                      : outboxEntries.find((entry) => {
                          const id = Number(entry.displayTarget?.taskId ?? entry.payload?.taskId);
                          return Number.isSafeInteger(id) && id === taskId;
                        });
                    const title = row?.title ?? fallback?.displayTarget?.title ?? "";
                    if (!title) return null;
                    const cancelling = optimisticCancelling.includes(taskId);
                    return (
                      <div
                        key={`optimistic-${taskId}`}
                        data-testid="optimistic-task-row"
                        className="flex items-center gap-2.5 px-3 py-2 rounded-2xl"
                        style={{
                          background: "color-mix(in srgb, var(--color-accent-amber) 8%, transparent)",
                          border: "1px solid color-mix(in srgb, var(--color-accent-amber) 22%, transparent)",
                        }}
                      >
                        <span className="text-sm">⏳</span>
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 text-sm leading-snug text-text-primary" title={title}>{title}</div>
                          <div className="truncate text-xs text-text-secondary">
                            {cancelling
                              ? "asking the family server to reopen it"
                              : typeof row?.points === "number"
                                ? `${row.points}pts on the way`
                                : "on the way"}
                          </div>
                        </div>
                        <span className="shrink-0 text-xs font-semibold text-[var(--color-accent-ink-amber)]">
                          {cancelling ? "Taking it back" : "On the way"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {pending.length === 0 ? (
                // The read's own state decides what an empty board MEANS. A 401
                // means "hidden"; a 503 or a dead network is an UNKNOWN, never a
                // zero — and an unknown must never render as "All caught up".
                syncRead === "failed" && tasks.length === 0 ? (
                  <EmptyState title="Couldn't reach the family server" description="We couldn't read the chore list, so this board may be out of date — it refreshes on its own, or check the NAS is awake." icon="📡" />
                ) : !isLoggedIn && syncRead === "blocked" && tasks.length === 0 ? (
                  <EmptyState title="Tasks are synced to the family account" description="Sign in with your PIN to see everyone's tasks. Your chores aren't gone — they're waiting on the family server." icon="🔐" />
                ) : filterMember === "Open" ? (
                  <EmptyState title="All quiet" description="Nothing is up for grabs right now." icon="🤝" />
                ) : filterMember === "My Tasks" ? (
                  <EmptyState title="All caught up" description="Nothing on your plate right now." icon="🎉" />
                ) : filterMember !== "All" ? (
                  <EmptyState title="All caught up" description={`Nothing pending for ${filterMember.split(" ")[0]} right now.`} icon="🎉" />
                ) : (
                  <EmptyState title="All caught up" description="No pending tasks right now." icon="🎉" />
                )
              ) : (
                <div className="space-y-2">
                  {pending.map((task, idx) => {
                    const rowColor = priorityColor(task.priority);
                    return (
                    <SwipeableRow key={task.id} leftAction={<span className="text-sm font-bold">✓</span>} rightAction={<span className="text-sm font-bold">×</span>} onSwipeRight={() => wallConfirm(task.id, () => openPinEntry(task.id))} onSwipeLeft={isParent ? () => startEdit(task) : undefined}>
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={`Complete ${task.title}`}
                        onClick={() => wallConfirm(task.id, () => openPinEntry(task.id))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            wallConfirm(task.id, () => openPinEntry(task.id));
                          }
                        }}
                        className="schedule-row liquid-glass flex cursor-pointer items-center gap-3 px-3 py-2.5 animate-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-selected)]"
                        style={{
                          animationDelay: `${Math.min(idx, 8) * 0.05}s`,
                          backgroundImage: rowTint(rowColor),
                        }}
                      >
                        <div
                          className="h-8 w-0.5 shrink-0 rounded-full"
                          style={{ backgroundColor: rowColor, boxShadow: `0 0 8px ${rowColor}` }}
                        />
                        <Avatar name={task.assignee} color={memberColors[task.assignee] || "green"} emoji={assigneeEmojis[task.assignee] || task.assigneeEmoji} size="sm" variant="emoji" />
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 text-sm leading-snug text-text-primary" title={task.title}>{task.title}</div>
                          <div className="line-clamp-2 text-xs leading-snug text-text-secondary">
                            {isCrewTask(task)
                              ? `🤝 Crew ${crewCheckinProgress(task).checkedIn}/${task.crewSize} checked in · ${crewMemberCount(task)} joined · +${task.points} pts each`
                              /* `formatDueLabel` is "" for an unset due, and an
                                 unconditional separator rendered "Alex ·  · Chores"
                                 — the double dot read as a rendering bug. */
                              : [
                                task.assignee.split(" ")[0],
                                isSnatchable(task) ? `was due ${formatDueLabel(task.due)}` : formatDueLabel(task.due),
                                task.category,
                              ].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        <span
                          className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold text-text-primary glass-subtle"
                          style={{
                            background: chipFill(rowColor),
                          }}
                        >
                          +{task.points}pts
                        </span>
                        {/* Swipe-left was pointer-only, so a keyboard parent could
                            complete a chore but never edit one. A visible,
                            row-named control for the same action. */}
                        {isParent && (
                          <button
                            type="button"
                            aria-label={`Edit ${task.title}`}
                            onClick={(e) => { e.stopPropagation(); startEdit(task); }}
                            className="tap-sm hit-44 shrink-0 rounded-full px-2 py-1 text-xs font-semibold text-text-secondary glass-subtle"
                          >
                            ✎
                          </button>
                        )}
                      </div>
                      {wall && wallConfirmId === task.id && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); wallConfirm(task.id, () => openPinEntry(task.id)); }}
                          className="tap mt-2 h-12 w-full rounded-full bg-[var(--color-accent-mint)] px-5 text-base font-bold text-white"
                        >
                          ✓ Complete — tap to confirm
                        </button>
                      )}
                    </SwipeableRow>
                    );
                  })}
                </div>
              )}
            </SectionCard>

            {isLoggedIn && currentUser?.role === "parent" && (pendingApprovals.length > 0 || approvalQueueLoading) && (
              <SectionCard
                headingLevel="h2"
                title="Needs approval"
                description={approvalQueueLoading ? "checking the queue…" : `${pendingApprovals.length} tapped — review to award points`}
                icon="⏳"
              >
                {!approvalQueueLoading && (
                  /* A COUNT, never a points total: the same number the
                     description and `Approve all (N)` carry, with "chores" as
                     the unit so it cannot be mistaken for points. */
                  <p className="tasks-approval-summary mb-2 text-xs text-text-secondary">
                    <span aria-hidden="true">⏳</span>
                    <span className="font-semibold text-[var(--color-accent-ink-amber)]">{pendingApprovals.length}</span>
                    {` chore${pendingApprovals.length === 1 ? "" : "s"} on the way`}
                  </p>
                )}
                {/* One PIN pays the whole queue — the per-row grind was the
                    biggest parent complaint in the evaluation. Disabled while
                    the queue is unread or an approve-all is already in flight:
                    the button must never offer to pay a queue it cannot see. */}
                <div className="mb-3">
                  <SoftButton
                    onClick={() => openApprovalDialog(null, "approve-all")}
                    className="tasks-approval-approve-all w-full"
                    disabled={approveAllInFlight || approvalQueueLoading}
                    aria-disabled={approveAllInFlight || approvalQueueLoading || undefined}
                  >
                    {approvalQueueLoading ? "✓ Approve all" : `✓ Approve all (${pendingApprovals.length})`}
                  </SoftButton>
                </div>
                {approvalQueueLoading ? (
                  /* The first snapshot read is outstanding: two placeholder
                     rows stand in for the queue so a cold load never reads as
                     "0 chores on the way". They mirror the settled row's
                     anatomy — avatar, two text lines, the action line below
                     `sm` — so the card keeps its shape when the rows land. */
                  <div className="space-y-2" aria-hidden="true">
                    {[0, 1].map((i) => (
                      <div
                        key={i}
                        className="schedule-row liquid-glass flex flex-wrap items-center gap-2 px-3 py-3"
                        style={{ backgroundImage: rowTint("var(--color-accent-amber)") }}
                      >
                        <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-[var(--color-surface-3)]" />
                        <div className="min-w-0 flex-1 basis-56 space-y-1">
                          <Skeleton variant="text" className="w-3/4" />
                          <Skeleton variant="text" className="w-1/2" />
                        </div>
                        <div className="flex w-full shrink-0 gap-2 sm:ml-auto sm:w-auto">
                          <Skeleton variant="text" className="h-11 flex-1 rounded-full sm:w-24 sm:flex-none" />
                          <Skeleton variant="text" className="h-11 flex-1 rounded-full sm:w-24 sm:flex-none" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                <div className="space-y-2">
                  {approvalQueue.map((task) => {
                    const owner = task.pendingApproval!;
                    const crew = owner.crew ?? [];
                    const isCrew = crew.length > 0;
                    // The award that WILL be paid: the amount approval persisted,
                    // else the pending record's promise, else the pre-bonus base
                    // (B1a's three-term read). Never recomputed, never summed.
                    const award = task.awardedPoints ?? owner.points ?? task.points;
                    const kid = owner.byName.split(" ")[0];
                    const checkin = isCrew ? crewCheckinProgress(task) : { checkedIn: 0, total: 0 };
                    const rowInFlight = approvalInFlightTaskIds.has(task.id);
                    const ageHint = approvalAgeHint(owner.at);
                    return (
                    <div
                      key={task.id}
                      className="schedule-row liquid-glass flex flex-wrap items-center gap-2 px-3 py-3"
                      style={{
                        backgroundImage: rowTint("var(--color-accent-amber)"),
                      }}
                    >
                      {/* Avatar and text are ONE flex item so the `w-full` action
                          row is the only thing that ever wraps. With the avatar
                          as a sibling of a `basis-56` text column, the 320px row
                          wrapped the whole text column under the avatar — ~40px
                          of empty first line on every row. The action row keeps
                          `w-full` below `sm`, so the title never competes with
                          the ~170px of buttons. */}
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Avatar name={task.assignee} color={memberColors[task.assignee] || "green"} emoji={isCrew ? "🤝" : assigneeEmojis[task.assignee] || task.assigneeEmoji} size="sm" variant="emoji" />
                      <div className="min-w-0 flex-1">
                        {approvalQueueHasMultipleKids && (
                          /* A label, not a control. With two or more kids in the
                             queue the parent scans by kid, and a per-row label is
                             the only form that keeps the queue's newest-first
                             global order (a section header would reorder it). */
                          <span data-testid="approval-kid-badge" className="mb-1 inline-flex rounded-full border border-border px-2 py-1 text-xs font-semibold text-text-secondary">
                            {kid}
                          </span>
                        )}
                        <div className="line-clamp-5 text-sm leading-snug text-text-primary lg:line-clamp-2" title={task.title}>{task.title}</div>
                        <div className="line-clamp-2 text-xs leading-snug text-text-secondary">
                          {isCrew
                            ? `🤝 ${crew.map((n) => n.split(" ")[0]).join(", ")} · `
                            : `${approvalQueueHasMultipleKids ? "" : `${kid} · `}`}
                          {/* The tap time and the age hint are ONE unbreakable
                              group, so the hint never wraps onto its own lone
                              second line. The raw `at` is an ISO instant;
                              `split("T")[0]` printed "2026-10-05" where every
                              other date reads "Oct 5" — same formatDueLabel
                              contract. */}
                          <span className="whitespace-nowrap">
                            {`tapped ${formatDueLabel(owner.at.split("T")[0])}`}
                            {ageHint && ` · ${ageHint}`}
                          </span>
                        </div>
                        {/* The payout is its own line and its own ink: 12px
                            semibold on the amber ink token, per head and crew
                            size for a crew, and never the pre-bonus base while
                            a pending record exists. */}
                        <div className="mt-0.5 text-xs font-semibold text-[var(--color-accent-ink-amber)]">
                          +{award}pts {isCrew ? `each · ${task.crewSize ?? crew.length} people` : `for ${kid}`}
                          {isCrew && checkin.total > 0 && checkin.checkedIn < checkin.total && (
                            <span className="font-normal text-text-secondary"> · {checkin.checkedIn} of {checkin.total} checked in</span>
                          )}
                        </div>
                        {rowInFlight && (
                          <div className="mt-0.5 text-xs font-semibold text-[var(--color-accent-ink-amber)]">⏳ Sending…</div>
                        )}
                      </div>
                      </div>
                      <div className="flex w-full shrink-0 gap-2 sm:ml-auto sm:w-auto">
                        <button type="button" aria-label={`Approve ${task.title}`} onClick={() => openApprovalDialog(task.id, "approve")} disabled={rowInFlight} className="tasks-approval-action tap-sm min-h-[44px] flex-1 shrink-0 rounded-full px-3 text-xs font-bold text-[var(--color-accent-ink-mint)] glass-subtle disabled:opacity-40 sm:flex-none">Approve</button>
                        <button type="button" aria-label={`Send back ${task.title}`} onClick={() => openApprovalDialog(task.id, "sendback")} disabled={rowInFlight} className="tasks-approval-action tap-sm min-h-[44px] flex-1 shrink-0 rounded-full px-3 text-xs font-semibold text-[var(--color-accent-ink-rose)] glass-subtle disabled:opacity-40 sm:flex-none">Send back</button>
                      </div>
                    </div>
                    );
                  })}
                </div>
                )}
              </SectionCard>
            )}

            {/* Gated on the array the expanded list actually maps over, not on a
                this-week count: `openPinEntry` is the only setter of `undoTaskId`
                and is reachable only from a rendered row, so gating on the week
                count made the whole undo path dead on a Monday morning. */}
            {completed.length > 0 && (
              <div data-completed-card="">
              <SectionCard headingLevel="h2" title="Completed" description={`${completed.length} done`} icon="✅">
                <button type="button" onClick={() => setShowCompleted(!showCompleted)} aria-expanded={showCompleted} className="mb-3 flex min-h-[44px] w-full items-center justify-between rounded-xl px-1 text-sm font-semibold text-text-secondary">
                  <span>{showCompleted ? "Hide completed" : "Show completed"}</span>
                  <span>{showCompleted ? "↑" : "↓"}</span>
                </button>
                {showCompleted && (
                  <div className="space-y-4">
                    {/* ── PINNED: awaiting a decision, not history ─────────── */}
                    {completedGroups.pending.length > 0 && (
                      <section className="space-y-2" aria-labelledby="completed-pending">
                        <h3 id="completed-pending" className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                          Waiting on approval
                          {/* A COUNT, never a points total: summing this group's
                              rows would be client-side points arithmetic, and
                              `task.points` is exactly the field the approval
                              pipeline rewrites (task-claim.ts:1366 vs
                              task-approval.ts:1270). */}
                          <span className="ml-2 font-normal text-text-muted">
                            {completedGroups.pending.length} chore{completedGroups.pending.length === 1 ? "" : "s"}
                          </span>
                        </h3>
                        <div className="space-y-2">
                          {completedGroups.pending.map((task) => {
                            const owner = task.pendingApproval!;
                            // Same-kid check in the resolved-ledger space (a
                            // session first name and a fullName byName agree).
                            const mine = isLoggedIn && currentUser?.role === "child" && resolveMemberName(membersData, owner.byName) === resolveMemberName(membersData, currentUser.name);
                            return (
                            <div
                              key={task.id}
                              role={mine ? "button" : undefined}
                              tabIndex={mine ? 0 : undefined}
                              aria-label={mine ? `Cancel completion of ${task.title}` : `${task.title} waiting for parent approval`}
                              onClick={mine ? () => openPinEntry(task.id) : undefined}
                              onKeyDown={mine ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPinEntry(task.id); } } : undefined}
                              className="schedule-row liquid-glass flex items-center gap-3 px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-selected)]"
                              style={{
                                backgroundImage: rowTint("var(--color-accent-amber)"),
                              }}
                            >
                              <div
                                className="h-8 w-0.5 shrink-0 rounded-full"
                                style={{ backgroundColor: "var(--color-accent-amber)", boxShadow: `0 0 8px var(--color-accent-amber)` }}
                              />
                              <Avatar name={task.assignee} color={memberColors[task.assignee] || "green"} emoji={assigneeEmojis[task.assignee] || task.assigneeEmoji} size="sm" variant="emoji" />
                              <div className="min-w-0 flex-1">
                                <div className="line-clamp-2 text-sm leading-snug text-text-primary" title={task.title}>{task.title}</div>
                                <div className="line-clamp-2 text-xs leading-snug text-text-secondary">{owner.byName.split(" ")[0]} · tapped {formatDueLabel(owner.at.split("T")[0])} · {task.awardedPoints ?? task.pendingApproval!.points ?? baseTaskPoints(task)}pts on the way</div>
                              </div>
                              <span
                                className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold text-text-primary glass-subtle"
                                style={{
                                  background: chipFill("var(--color-accent-amber)"),
                                }}
                              >
                                ⏳ On the way
                              </span>
                            </div>
                            );
                          })}
                        </div>
                      </section>
                    )}

                    {/* ── Week groups: this week, then newest-first ────────── */}
                    {completedGroups.weeks.map((group) => (
                      <section key={group.key} className="space-y-2" aria-labelledby={`completed-week-${group.key}`}>
                        {/* A HEADING, not a control: the 44px tap rule covers
                            buttons and role="button" only. The `id` derives
                            from the stable week key, never from an index. */}
                        <h3 id={`completed-week-${group.key}`} className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                          {group.label}
                          <span className="ml-2 font-normal text-text-muted">
                            {group.tasks.length} chore{group.tasks.length === 1 ? "" : "s"}
                          </span>
                        </h3>
                        <div className="space-y-2">
                          {group.tasks.map((task) => {
                            const rowColor = "var(--color-accent-mint)";
                            return (
                            // INERT row: the undo `<button>` below is the single
                            // affordance. A `role="button"` row with a button inside
                            // it is two controls with two names doing one action, and
                            // a nested-interactive ARIA violation.
                            <div
                              key={task.id}
                              className="schedule-row liquid-glass flex items-center gap-3 px-3 py-2.5"
                              style={{
                                backgroundImage: rowTint(rowColor),
                              }}
                            >
                              <div
                                className="h-8 w-0.5 shrink-0 rounded-full"
                                style={{ backgroundColor: rowColor, boxShadow: `0 0 8px ${rowColor}` }}
                              />
                              <Avatar name={task.assignee} color={memberColors[task.assignee] || "green"} emoji={assigneeEmojis[task.assignee] || task.assigneeEmoji} size="sm" variant="emoji" />
                              <div className="min-w-0 flex-1">
                                <div className="line-clamp-2 text-sm leading-snug text-text-primary" title={task.title}>{task.title}</div>
                                {/* The week is the header directly above; the
                                    old per-row week token mislabelled every
                                    unstamped this-week row as last week's. */}
                                <div className="truncate text-xs text-text-secondary">{task.assignee.split(" ")[0]} · {task.completedBy?.split(" ")[0] || task.assignee.split(" ")[0]}</div>
                              </div>
                              <span
                                className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold text-text-primary glass-subtle"
                                style={{
                                  background: chipFill(rowColor),
                                }}
                              >
                                Done
                              </span>
                              <IconButton size="sm" variant="ghost" aria-label={`Undo completion of ${task.title}`} className="hit-44" onClick={() => openPinEntry(task.id)}>↩</IconButton>
                            </div>
                            );
                          })}
                        </div>
                      </section>
                    ))}

                    {/* ── Honest null: never dated, never guessed ──────────── */}
                    {completedGroups.unattributed.length > 0 && (
                      <section className="space-y-2" aria-labelledby="completed-undated">
                        <h3 id="completed-undated" className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                          Earlier
                          <span className="ml-2 font-normal text-text-muted">
                            {completedGroups.unattributed.length} chore{completedGroups.unattributed.length === 1 ? "" : "s"}
                          </span>
                        </h3>
                        {/* Names the missing data instead of inventing a date. */}
                        <p className="text-xs text-text-muted">
                          Finished, but the family server never recorded a day for these.
                        </p>
                        <div className="space-y-2">
                          {completedGroups.unattributed.map((task) => {
                            const rowColor = "var(--color-accent-mint)";
                            return (
                            <div
                              key={task.id}
                              className="schedule-row liquid-glass flex items-center gap-3 px-3 py-2.5"
                              style={{
                                backgroundImage: rowTint(rowColor),
                              }}
                            >
                              <div
                                className="h-8 w-0.5 shrink-0 rounded-full"
                                style={{ backgroundColor: rowColor, boxShadow: `0 0 8px ${rowColor}` }}
                              />
                              <Avatar name={task.assignee} color={memberColors[task.assignee] || "green"} emoji={assigneeEmojis[task.assignee] || task.assigneeEmoji} size="sm" variant="emoji" />
                              <div className="min-w-0 flex-1">
                                <div className="line-clamp-2 text-sm leading-snug text-text-primary" title={task.title}>{task.title}</div>
                                <div className="truncate text-xs text-text-secondary">{task.assignee.split(" ")[0]} · {task.completedBy?.split(" ")[0] || task.assignee.split(" ")[0]}</div>
                              </div>
                              <span
                                className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold text-text-primary glass-subtle"
                                style={{
                                  background: chipFill(rowColor),
                                }}
                              >
                                Done
                              </span>
                              <IconButton size="sm" variant="ghost" aria-label={`Undo completion of ${task.title}`} className="hit-44" onClick={() => openPinEntry(task.id)}>↩</IconButton>
                            </div>
                            );
                          })}
                        </div>
                      </section>
                    )}

                    {/* Defensive empty branch, reachable only if the helper
                        returns nothing while `completed` is non-empty. The card
                        is gated on `completed.length > 0`, so this is a named
                        state, not the normal path. */}
                    {completedGroups.pending.length === 0 &&
                     completedGroups.weeks.length === 0 &&
                     completedGroups.unattributed.length === 0 && (
                      <EmptyState icon="✅" title="Nothing finished yet"
                                  description="Chores you complete show up here, newest week first." />
                    )}
                  </div>
                )}
              </SectionCard>
              </div>
            )}

            {/* AI chore ideas — parents-only and BELOW the chore lists. The
                empty generator used to sit above Pending as a full card,
                pushing the real list ~2 viewports down the phone. */}
            {isParent && (aiSuggestions.length > 0 ? (
              <SectionCard headingLevel="h2" title="Consuela suggests" description="Fresh ideas for the family." icon="✨">
                <div className="grid gap-3 sm:grid-cols-2">
                  {aiSuggestions.map((suggestion) => (
                    <Surface key={suggestion.title} variant="glass-subtle" radius="xl" padding="sm">
                      <div className="flex items-start gap-3">
                        <Avatar name={suggestion.assignee} color={memberColors[suggestion.assignee] || "green"} emoji={assigneeEmojis[suggestion.assignee] || suggestion.assigneeEmoji} size="sm" variant="emoji" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-text-primary">{suggestion.title}</div>
                          <div className="mt-1 text-xs text-text-muted">
                            {isCrewTask(suggestion)
                              ? `🤝 Crew of ${suggestion.crewSize} · +${suggestion.points} pts each`
                              : suggestion.universal
                                ? `🫳 Open · +${suggestion.points} pts · first grab +${normalizeSpeedBonus(suggestion.speedBonus)}`
                                : `${suggestion.assignee} · +${suggestion.points}pts`}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <SoftButton size="sm" onClick={() => adoptSuggestion(suggestion)}>Add</SoftButton>
                          <IconButton size="sm" variant="ghost" aria-label={`Dismiss ${suggestion.title}`} className="hit-44" onClick={() => dismissSuggestion(suggestion.title)}>×</IconButton>
                        </div>
                      </div>
                    </Surface>
                  ))}
                </div>
                <div className="mt-3">
                  <SoftButton variant="ghost" size="sm" onClick={generateAiTasks} disabled={aiSuggesting} className="w-full">{aiSuggesting ? "Thinking..." : "✨ More ideas"}</SoftButton>
                </div>
              </SectionCard>
            ) : (
              <button
                type="button"
                onClick={generateAiTasks}
                disabled={aiSuggesting}
                className="tap-sm flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full border border-white/10 text-xs font-semibold text-text-secondary hover:text-text-primary disabled:opacity-50"
              >
                {aiSuggesting ? "✨ Thinking…" : "✨ Get chore ideas from Consuela"}
              </button>
            ))}
          </>
          </div>
        )}

        {activeTab === "leaderboard" && (
          dynamicLeaderboard.length === 0 ? (
            <EmptyState title="No champions yet" description="Add family members in Settings, then complete tasks to fill the board." icon="🏆" />
          ) : (
          <div
            key="leaderboard"
            id={TASKS_PANEL_IDS.leaderboard}
            role="tabpanel"
            aria-label="Leaderboard"
            aria-labelledby={TASKS_VIEW_SWITCH_ID}
            className="panel-swap space-y-6 md:col-span-2 2xl:col-span-1 2xl:col-start-2"
          >
          <>
            <Surface variant="warm" radius="2xl" padding="lg" glow>
              {familyTotal === 0 ? (
                <div className="py-2 text-center">
                  <span className="text-2xl animate-crown-glow">👑</span>
                  <h2 className="mt-1 text-xl font-bold text-text-primary">The crown is up for grabs</h2>
                  <p className="mt-1 text-sm text-text-secondary">Everyone starts at zero — the first completed task takes the crown.</p>
                </div>
              ) : (
              <div className="relative overflow-hidden">
                <div className="absolute right-0 top-0">
                  <SoftButton
                    size="sm"
                    variant="ghost"
                    className="hit-44"
                    aria-label={`Share ${topScorer.name.split(" ")[0]}'s week`}
                    onClick={() => topScorer && setShareCard({ memberName: topScorer.name, memberEmoji: topScorer.emoji, rank: 1, points: topScorer.points })}
                  >
                    ↗ Share
                  </SoftButton>
                </div>
                {/* pr-24 keeps the avatar clear of the absolutely-positioned
                    Share button that occupies this card's top-right corner
                    (96px = Share 76px + hit-area + gap). */}
                <div className="flex items-center justify-between gap-4 pr-24">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">This week&apos;s champion</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-2xl animate-crown-glow">👑</span>
                      <h2 className="text-xl font-bold text-text-primary">{topScorer.name.split(" ")[0]}</h2>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <p className="text-sm text-text-secondary">
                        <span className="font-semibold text-[var(--color-accent-ink-nori)]">{topScorer.points}</span> pts
                      </p>
                      {topScorer.streak > 0 && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-[var(--color-accent-ink-amber)]"
                          style={{ background: "color-mix(in srgb, var(--color-accent-amber) 12%, transparent)" }}
                        >
                          🔥 {topScorer.streak}d
                        </span>
                      )}
                      <span className="text-xs text-text-muted">{topScorer.levelEmoji} {topScorer.levelTitle}</span>
                    </div>
                  </div>
                  <div className="relative">
                    <span className="absolute -inset-1 animate-crown-glow rounded-full bg-[var(--color-accent-amber)]/20 blur-md" />
                    <Avatar name={topScorer.name} color={memberColors[topScorer.name] || "green"} emoji={topScorer.emoji} size="lg" variant="emoji" glow />
                  </div>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <ProgressRing value={championShare} max={1} label="Champion share" detail={`${topScorer.name.split(" ")[0]} leads`} size={96} stroke={8} />
                  <StatTile label="Rewards" value={rewards.length} detail="Available" icon="🎁" tone="accent" />
                  <StatTile label="Penalties" value={penalties.length} detail="Configured" tone="accent" />
                </div>
                {topScorer.badges.length > 0 && (
                  <div className="mt-3">
                    <TrophyCase badges={topScorer.badges} />
                  </div>
                )}
              </div>
              )}
            </Surface>

            {/* The tab leads with the live race — podium + prizes — so the
                first screen IS the competition, not a wall of cards. */}
            <SectionCard headingLevel="h2" title="Leaderboard" description="This week's race — resets Monday" icon="🏆">
              <Podium
                entries={dynamicLeaderboard.slice(0, 3)}
                prizes={weeklyPrizes}
                previousRanks={previousRanks}
                isYou={(name: string) => name === myIdentity.name}
                getMemberColor={(name: string) => memberColors[name] || "green"}
                onOpenSheet={setSheetMember}
                onAdjust={openAdjust}
                isAdmin={isLoggedIn && currentUser?.role === "parent"}
                allTimeRead={allTimeRead}
              />
              <div className="mt-3 space-y-3">
                {dynamicLeaderboard.slice(3).map((entry) => (
                  <LeaderboardRow
                    key={entry.name}
                    entry={entry}
                    previousRank={previousRanks[entry.name]}
                    isYou={entry.name === myIdentity.name}
                    getMemberColor={(name: string) => memberColors[name] || "green"}
                    onAdjust={openAdjust}
                    onOpenSheet={setSheetMember}
                    isAdmin={isLoggedIn && currentUser?.role === "parent"}
                  />
                ))}
              </div>
            </SectionCard>

            <PrizeRaceCard
              prizes={weeklyPrizes}
              entries={dynamicLeaderboard}
              daysUntilReset={daysUntilReset}
              myName={raceName}
            />

            {isLoggedIn && currentUser && (() => {
              // Same POSITION rule as the CatchUpNudge pair above: the row
              // directly above, found by index, so a tied rank cannot point the
              // card at the wrong member.
              const myIndex = dynamicLeaderboard.findIndex((e) => e.name === myIdentity.name);
              const myEntry = myIndex >= 0 ? dynamicLeaderboard[myIndex] : null;
              const aheadEntry = myIndex > 0 ? dynamicLeaderboard[myIndex - 1] : undefined;
              return myEntry ? <YourCard entry={myEntry} aheadEntry={aheadEntry} getMemberColor={(n: string) => memberColors[n] || "green"} allTimeRead={allTimeRead} /> : null;
            })()}

            {streakSaveNeeded && (
              <StreakSaverBanner
                streak={myEntry?.streak ?? 0}
                quickTask={myPendingQuests[0] || null}
                onGoToTasks={() => setActiveTab("tasks")}
              />
            )}

            <CatchUpNudge myEntry={myEntry ?? undefined} aheadEntry={aheadEntry} behindEntry={behindEntry} />

            {myPendingQuests.length > 0 && activeTab === "leaderboard" && (
              <DailyQuestCard
                quests={myPendingQuests}
                onAccept={(quest) => openPinEntry(quest.id)}
                onGoToTasks={() => setActiveTab("tasks")}
                rosterEmoji={assigneeEmojis}
              />
            )}

            {sheetEntry && (
              <MemberSheet
                open={!!sheetMember}
                entry={sheetEntry}
                hasWeeklyChamp={hallOfFame.some(h => h.member === sheetEntry.name && h.rank === 1)}
                allTimePoints={sheetEntry.allTimePoints}
                allTimeComps={sheetEntry.allTimeCompletions}
                weeklyPoints={sheetEntry.points}
                pendingTasks={visibleTasks.filter(t => !t.completed && (t.assignee === sheetEntry.name || t.universal))}
                affordableRewards={rewards.filter(r => r.cost <= sheetEntry.points)}
                weekGraph={["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(day => ({
                  day,
                  points: weekData.history
                    .filter(tx => tx.member === sheetEntry.name && tx.type === "earn" && new Date(tx.timestamp).toLocaleDateString("en-US", { weekday: "short" }) === day)
                    .reduce((sum, tx) => sum + tx.amount, 0),
                }))}
                onClose={() => setSheetMember(null)}
                getMemberColor={(name: string) => memberColors[name] || "green"}
                allTimeRead={allTimeRead}
              />
            )}

            <TasksArchive
              weekData={weekData}
              tasks={tasks}
              currentUser={currentUser}
              isLoggedIn={isLoggedIn}
              leaderboard={dynamicLeaderboard}
              memberColors={memberColors}
              // The VIEWER's role, not "a parent exists": that is what offered a
              // signed-out guest "Set a Family Goal".
              isParent={isParent}
              allTimePoints={raceName ? allTime.totals[raceName]?.points : undefined}
              allTimeCompletions={raceName ? allTime.totals[raceName]?.completions : undefined}
            />

            {/* The admin affordances (Suggest/Add/Edit reward, Add/Apply/Edit
                penalty) are parent-only, and every one of them is already
                server-gated — the client was throwing the rejection away and
                showing a success toast first, so a signed-out guest saw controls
                that could never work. Redemption stays open to every member: it
                is the one action here that legitimately belongs to them. */}
            <TasksRewardsPanel
              canManage={isParent}
              rewards={rewards}
              aiRewards={aiRewards}
              aiRewardSuggesting={aiRewardSuggesting}
              onGenerateAi={generateAiRewards}
              onAdd={startAddReward}
              onAdopt={adoptReward}
              onRedeem={openRewardPin}
              onEdit={startEditReward}
              penalties={penalties}
              onAddPenalty={startAddPenalty}
              onApplyPenalty={openPenaltyPin}
              onEditPenalty={startEditPenalty}
            />
          </>
          </div>
          )
        )}
      </div>
      </div>

      {(addingReward || editingRewardId !== null) && (
        <Modal
          open
          onClose={() => { setAddingReward(false); setEditingRewardId(null); }}
          title={addingReward ? "Add Reward" : "Edit Reward"}
          description="Create or update a family reward."
          footer={
            <>
              <SoftButton onClick={saveReward} disabled={!rewardForm.name.trim()} className="flex-1">Save</SoftButton>
              {!addingReward && <SoftButton variant="danger" onClick={() => deleteReward(editingRewardId ?? 0)} className="flex-1">Delete</SoftButton>}
              <SoftButton variant="secondary" onClick={() => { setAddingReward(false); setEditingRewardId(null); }} className="flex-1">Cancel</SoftButton>
            </>
          }
        >
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Reward</span>
              <input value={rewardForm.name} onChange={(e) => setRewardForm((prev) => ({ ...prev, name: e.target.value }))} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none" placeholder="Extra screen time" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Emoji</span>
                <input value={rewardForm.emoji} onChange={(e) => setRewardForm((prev) => ({ ...prev, emoji: e.target.value || "🎁" }))} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Cost</span>
                <input type="number" min={0} value={rewardForm.cost} onChange={(e) => setRewardForm((prev) => ({ ...prev, cost: parseInt(e.target.value) || 0 }))} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none" />
              </label>
            </div>
          </div>
        </Modal>
      )}

      {(addingPenalty || editingPenaltyId !== null) && (
        <Modal
          open
          onClose={() => { setAddingPenalty(false); setEditingPenaltyId(null); }}
          title={addingPenalty ? "Add Penalty" : "Edit Penalty"}
          description="Create or update a missed-chore point deduction."
          footer={
            <>
              <SoftButton onClick={savePenalty} disabled={!penaltyForm.name.trim()} className="flex-1">Save</SoftButton>
              {!addingPenalty && <SoftButton variant="danger" onClick={() => deletePenalty(editingPenaltyId ?? 0)} className="flex-1">Delete</SoftButton>}
              <SoftButton variant="secondary" onClick={() => { setAddingPenalty(false); setEditingPenaltyId(null); }} className="flex-1">Cancel</SoftButton>
            </>
          }
        >
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Penalty</span>
              <input value={penaltyForm.name} onChange={(e) => setPenaltyForm((prev) => ({ ...prev, name: e.target.value }))} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none" placeholder="Forgot homework" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Emoji</span>
                <input value={penaltyForm.emoji} onChange={(e) => setPenaltyForm((prev) => ({ ...prev, emoji: e.target.value || "⚠️" }))} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Points</span>
                <input type="number" min={0} value={penaltyForm.points} onChange={(e) => setPenaltyForm((prev) => ({ ...prev, points: parseInt(e.target.value) || 0 }))} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none" />
              </label>
            </div>
          </div>
        </Modal>
      )}

      {pinIntent !== null && (
        <Modal
          open
          onClose={closePinDialog}
          title="Enter your PIN"
          description={
            pinReward
              ? `Redeem "${pinReward.name}" for ${pinReward.cost}pts`
              : pinPenalty
              ? `Apply "${pinPenalty.name}" penalty (-${pinPenalty.points}pts)`
              : pinCrewAction
              ? (pinCrewAction.action === "crew-join"
                  ? `Join the crew for "${tasks.find(t => t.id === pinCrewAction.taskId)?.title ?? "this task"}"`
                  : `Check in — done your part of "${tasks.find(t => t.id === pinCrewAction.taskId)?.title ?? "this task"}"`)
              : `Complete "${tasks.find(t => t.id === pinTaskId)?.title ?? "this task"}"`
          }
          footer={
            <>
              <SoftButton onClick={submitPin} loading={pinBusy} disabled={pinInput.length < 4 || pinBusy} className="flex-1">{pinPenalty ? "Deduct" : "Submit"}</SoftButton>
              <SoftButton variant="secondary" onClick={closePinDialog} className="flex-1">Cancel</SoftButton>
            </>
          }
        >
          <div className="space-y-4">
            {!pinReward && !pinPenalty && pinCrewAction && (
              <div className="rounded-2xl glass-subtle px-4 py-3 text-sm text-text-secondary">
                {pinCrewAction.action === "crew-join"
                  ? "You're joining this crew — everyone earns the full points when a parent approves."
                  : "Marking your part done. The task goes to a parent once the whole crew checks in."}
              </div>
            )}
            {!pinReward && (() => { const t = pinTaskId !== null ? tasks.find((x) => x.id === pinTaskId) : undefined; return !!t && (t.universal || isSnatchable(t) || isCrewTask(t)); })() && (
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Claim for</span>
                <select value={snatchForMember} onChange={(e) => setSnatchForMember(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none">
                  {membersData.filter((m: any) => m.role !== "pet").map((m: any) => <option key={m.fullName} value={m.fullName}>{memberOptionLabel(m)}</option>)}
                </select>
              </label>
            )}
            {pinReward && (
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Redeem for</span>
                <select value={redeemForMember} onChange={(e) => setRedeemForMember(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none">
                  {membersData.filter((m: any) => m.role !== "pet").map((m: any) => <option key={m.fullName} value={m.fullName}>{memberOptionLabel(m)}</option>)}
                </select>
              </label>
            )}
            {pinPenalty && (
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Apply to</span>
                <select value={penaltyForMember} onChange={(e) => setPenaltyForMember(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none">
                  {membersData.filter((m: any) => m.role !== "pet").map((m: any) => <option key={m.fullName} value={m.fullName}>{memberOptionLabel(m)}</option>)}
                </select>
              </label>
            )}
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pinInput}
aria-describedby="pin-dialog-error pin-dialog-status"               onChange={(e) => { setPinInput(e.target.value.replace(/[^0-9]/g, "")); setPinError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") submitPin(); }}
              placeholder="4-digit PIN"

              aria-label="Your 4-digit PIN"
              autoFocus
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-4 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-muted"
            />
            {pinError && (
              <p id="pin-dialog-error" role="alert" className="text-center text-sm text-[var(--color-accent-ink-rose)]">{pinError}</p>
            )}
            {pinSuccess && (
              <p id="pin-dialog-status" role="status" className="text-center text-sm text-[var(--color-text-primary)]">{pinSuccess}</p>
            )}
          </div>
        </Modal>
      )}

      {undoTaskId !== null && (
        <Modal
          open
          onClose={() => { setUndoTaskId(null); setUndoPin(""); setUndoError(""); }}
          title="Undo Completion"
          description={`Reverse "${tasks.find(t => t.id === undoTaskId)?.title}"`}
          footer={
            <>
              <SoftButton onClick={submitUndo} loading={pinBusy} disabled={undoPin.length < 4 || pinBusy} variant="danger" className="flex-1">Undo</SoftButton>
              <SoftButton variant="secondary" onClick={() => { setUndoTaskId(null); setUndoPin(""); }} className="flex-1">Cancel</SoftButton>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">Enter your PIN to undo this completed task. Points will be deducted.</p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={undoPin}
aria-describedby="undo-dialog-error"               onChange={(e) => { setUndoPin(e.target.value.replace(/[^0-9]/g, "")); setUndoError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") submitUndo(); }}
              placeholder="4-digit PIN"

              aria-label="Your 4-digit PIN"
              autoFocus
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-4 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-muted"
            />
            {undoError && (
              <p id="undo-dialog-error" role="alert" className="text-center text-sm text-[var(--color-accent-ink-rose)]">{undoError}</p>
            )}
          </div>
        </Modal>
      )}

      {adjustMember && (
        <Modal
          open
          onClose={closeAdjust}
          title="Manual point adjust"
          description={`Adjust points for ${adjustMember.split(" ")[0]}`}
          footer={
            <>
              <SoftButton onClick={submitAdjust} loading={pinBusy} disabled={!adjustPin || pinBusy || adjustAmountValue <= 0} className="flex-1">Apply</SoftButton>
              <SoftButton variant="secondary" onClick={closeAdjust} className="flex-1">Cancel</SoftButton>
            </>
          }
        >
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Amount</span>
              {/* `min` matters as much as the coercion: the direction is chosen by the
                  Add/Remove toggle, so a typed "-50" would otherwise INVERT a
                  deduction into a credit (`delta = -50` -> `change = +50`) and
                  confirm `--50 pts`. */}
              <input type="number" inputMode="numeric" min={1} aria-label="Adjustment amount" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none" />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <SoftButton aria-label="Add points" variant={adjustDir === "+" ? "success" : "secondary"} onClick={() => setAdjustDir("+")}>Add points</SoftButton>
              <SoftButton variant={adjustDir === "-" ? "danger" : "secondary"} onClick={() => setAdjustDir("-")}>Remove points</SoftButton>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Reason</span>
              <input aria-label="Adjustment reason" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none" placeholder="Why?" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Parent PIN</span>
              <input type="password" aria-label="Parent PIN" inputMode="numeric" maxLength={4} value={adjustPin} aria-describedby="adjust-dialog-error adjust-dialog-status" onChange={(e) => { setAdjustPin(e.target.value.replace(/[^0-9]/g, "")); setAdjustError(""); }} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-muted" placeholder="0000" />
            </label>
            {adjustError && (
              <p id="adjust-dialog-error" role="alert" className="text-center text-sm text-[var(--color-accent-ink-rose)]">{adjustError}</p>
            )}
            {adjustSuccess && (
              <p id="adjust-dialog-status" role="status" className="text-center text-sm text-[var(--color-text-primary)]">{adjustSuccess}</p>
            )}
          </div>
        </Modal>
      )}

      {parentApprovalReward && (
        <Modal
          open
          onClose={() => { setParentApprovalReward(null); setParentApprovalPin(""); }}
          title="Parent Approval Required"
          description={`"${parentApprovalReward.name}" costs ${parentApprovalReward.cost}pts — needs a parent PIN to unlock.`}
          footer={
            <>
              <SoftButton onClick={approveParentReward} loading={pinBusy} disabled={!parentApprovalPin || pinBusy} className="flex-1">Approve</SoftButton>
              <SoftButton variant="secondary" onClick={() => { setParentApprovalReward(null); setParentApprovalPin(""); }} className="flex-1">Cancel</SoftButton>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">Large rewards (&gt;100pts) require a parent to approve. Enter a parent PIN to continue.</p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={parentApprovalPin}
aria-describedby="parent-approval-dialog-error"               onChange={(e) => { setParentApprovalPin(e.target.value.replace(/[^0-9]/g, "")); setParentApprovalError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") approveParentReward(); }}
              placeholder="Parent PIN"

              aria-label="Parent PIN"
              autoFocus
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-4 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-muted"
            />
            {parentApprovalError && (
              <p id="parent-approval-dialog-error" role="alert" className="text-center text-sm text-[var(--color-accent-ink-rose)]">{parentApprovalError}</p>
            )}
          </div>
        </Modal>
      )}

      {(approvalTaskId !== null || approvalMode === "approve-all") && (
        <Modal
          open
          onClose={() => { setApprovalTaskId(null); setApprovalMode("approve"); setApprovalPin(""); }}
          title={approvalMode === "approve-all" ? "Approve all" : approvalMode === "approve" ? "Approve points" : "Send back"}
          description={(() => {
            if (approvalMode === "approve-all") {
              return `Pay all ${pendingApprovals.length} tapped task${pendingApprovals.length !== 1 ? "s" : ""} now? Rows already paid elsewhere just clear.`;
            }
            const target = interactiveRows.find((x) => x.id === approvalTaskId);
            return approvalMode === "approve"
              ? `"${target?.title}" tapped by ${target?.pendingApproval?.byName} — award +${target?.points ?? 0}pts?`
              : `"${target?.title}" goes back on the list with no points.`;
          })()}
          footer={
            <>
              <SoftButton onClick={submitApproval} loading={pinBusy} disabled={!approvalPin || pinBusy} className="flex-1">{approvalMode === "approve-all" ? "Approve all" : approvalMode === "approve" ? "Approve" : "Send back"}</SoftButton>
              <SoftButton variant="secondary" onClick={() => { setApprovalTaskId(null); setApprovalMode("approve"); setApprovalPin(""); }} className="flex-1">Cancel</SoftButton>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">Tapped completions need a parent PIN. Enter a parent PIN to continue.</p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={approvalPin}
aria-describedby="approval-dialog-error"               onChange={(e) => { setApprovalPin(e.target.value.replace(/[^0-9]/g, "")); setApprovalError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") submitApproval(); }}
              placeholder="Parent PIN"

              aria-label="Parent PIN"
              autoFocus
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-4 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-muted"
            />
            {approvalError && (
              <p id="approval-dialog-error" role="alert" className="text-center text-sm text-[var(--color-accent-ink-rose)]">{approvalError}</p>
            )}
          </div>
        </Modal>
      )}

      {crewRemoveTarget !== null && (
        <Modal
          open
          onClose={() => { setCrewRemoveTarget(null); setCrewRemovePin(""); setCrewRemoveError(""); }}
          title="Remove from crew"
          description={`Remove ${crewRemoveTarget.memberName.split(" ")[0]} from the crew? Their spot frees up for someone else.`}
          footer={
            <>
              <SoftButton variant="danger" onClick={submitCrewRemove} loading={pinBusy} disabled={!crewRemovePin || pinBusy} className="flex-1">Remove</SoftButton>
              <SoftButton variant="secondary" onClick={() => { setCrewRemoveTarget(null); setCrewRemovePin(""); }} className="flex-1">Cancel</SoftButton>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">Enter a parent PIN to remove this member.</p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={crewRemovePin}
aria-describedby="crew-remove-dialog-error"               onChange={(e) => { setCrewRemovePin(e.target.value.replace(/[^0-9]/g, "")); setCrewRemoveError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") submitCrewRemove(); }}
              placeholder="Parent PIN"

              aria-label="Parent PIN"
              autoFocus
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-4 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-muted"
            />
            {crewRemoveError && (
              <p id="crew-remove-dialog-error" role="alert" className="text-center text-sm text-[var(--color-accent-ink-rose)]">{crewRemoveError}</p>
            )}
          </div>
        </Modal>
      )}

      {crewCloseTarget !== null && (
        <Modal
          open
          onClose={() => { setCrewCloseTarget(null); setCrewClosePin(""); setCrewCloseError(""); }}
          title="Close the crew?"
          description={(() => {
            const target = tasks.find((x) => x.id === crewCloseTarget.taskId);
            const names = target
              ? crewMembers(target).filter((m) => m.checkedInAt).map((m) => m.name.split(" ")[0])
              : [];
            return names.length > 0
              ? `Award ${target?.points ?? 0} pts to ${names.join(", ")} — the others aren't counted.`
              : "Nobody has checked in yet.";
          })()}
          footer={
            <>
              <SoftButton onClick={submitCrewClose} loading={pinBusy} disabled={!crewClosePin || pinBusy} className="flex-1">Close crew</SoftButton>
              <SoftButton variant="secondary" onClick={() => { setCrewCloseTarget(null); setCrewClosePin(""); setCrewCloseError(""); }} className="flex-1">Cancel</SoftButton>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">Enter a parent PIN to close this crew. Only the helpers who checked in go to approval.</p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={crewClosePin}
aria-describedby="crew-close-dialog-error"               onChange={(e) => { setCrewClosePin(e.target.value.replace(/[^0-9]/g, "")); setCrewCloseError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") submitCrewClose(); }}
              placeholder="Parent PIN"

              aria-label="Parent PIN"
              autoFocus
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-4 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-muted"
            />
            {crewCloseError && (
              <p id="crew-close-dialog-error" role="alert" className="text-center text-sm text-[var(--color-accent-ink-rose)]">{crewCloseError}</p>
            )}
          </div>
        </Modal>
      )}

      {confirmDiscardOpen && (
        <Modal
          open
          onClose={() => setConfirmDiscardOpen(false)}
          title="Discard these changes?"
          description={isAdding ? "This chore hasn't been added yet." : "Your edits to this chore haven't been saved."}
          footer={
            <>
              <SoftButton variant="danger" onClick={closeEdit} className="flex-1">Discard</SoftButton>
              <SoftButton variant="secondary" onClick={() => setConfirmDiscardOpen(false)} className="flex-1">Keep editing</SoftButton>
            </>
          }
        >
          <p className="text-sm text-text-secondary">Nothing was written — the chore is exactly as it was.</p>
        </Modal>
      )}

      {confirmDeleteOpen && (
        <Modal
          open
          onClose={() => setConfirmDeleteOpen(false)}
          title="Delete this task?"
          description={`"${editForm.title}" goes away for the whole family. This can't be undone.`}
          footer={
            <>
              <SoftButton variant="danger" onClick={() => { deleteTask(editForm.id); setConfirmDeleteOpen(false); closeEdit(); }} className="flex-1">Delete</SoftButton>
              <SoftButton variant="secondary" onClick={() => setConfirmDeleteOpen(false)} className="flex-1">Cancel</SoftButton>
            </>
          }
        >
          <p className="text-sm text-text-secondary">The chore disappears from every device. Points already earned for it stay earned.</p>
        </Modal>
      )}

      {repeatOpen && (
        <Modal
          open
          onClose={() => setRepeatOpen(false)}
          title="Repeat last week"
          description={`${repeatRows.length} chore${repeatRows.length !== 1 ? "s" : ""} from last week — added due today and uncompleted.`}
          footer={
            <>
              <SoftButton onClick={confirmRepeatLastWeek} disabled={repeatRows.length === 0} className="flex-1">Confirm</SoftButton>
              <SoftButton variant="secondary" onClick={() => setRepeatOpen(false)} className="flex-1">Cancel</SoftButton>
            </>
          }
        >
          {repeatRows.length === 0 ? (
            <EmptyState title="Nothing left to repeat" description="You removed every chore from last week. Nothing was added." icon="↻" />
          ) : (
          <div className="space-y-2">
            {repeatRows.map((def, idx) => {
              const modeLabel =
                def.crewSize && def.crewSize >= 2
                  ? `🤝 Crew of ${def.crewSize}`
                  : def.universal
                    ? "🫳 Open"
                    : def.assigneeName ?? "Unassigned";
              return (
                <div
                  key={`${def.title}-${idx}`}
                  className="schedule-row liquid-glass flex items-center gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-text-primary" title={def.title}>{def.title}</div>
                    <div className="truncate text-xs text-text-secondary">+{def.points} pts · {modeLabel}</div>
                  </div>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${def.title}`}
                    className="hit-44"
                    onClick={() => setRepeatRows((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    ✕
                  </IconButton>
                </div>
              );
            })}
          </div>
          )}
        </Modal>
      )}

      <LevelUpModal
        open={!!levelUpInfo}
        memberName={levelUpInfo?.name ?? ""}
        memberEmoji={levelUpInfo?.emoji ?? "🌱"}
        oldLevel={levelUpInfo?.oldLevel ?? 1}
        newLevel={levelUpInfo?.newLevel ?? 1}
        onClose={() => setLevelUpInfo(null)}
      />

      <ShareCard
        open={!!shareCard}
        memberName={shareCard?.memberName ?? ""}
        memberEmoji={shareCard?.memberEmoji ?? "🌱"}
        rank={shareCard?.rank ?? 1}
        points={shareCard?.points ?? 0}
        onClose={() => setShareCard(null)}
      />
    </PageShell>
  );
}
