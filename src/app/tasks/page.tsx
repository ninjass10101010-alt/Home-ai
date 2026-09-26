/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity */
"use client";

import { useState, useEffect, useMemo, useCallback, useRef, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { mapTaskIdeas, mapRewardIdeas } from "@/lib/ai-suggestions";
import { localTodayISO } from "@/lib/local-date";
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
import StatTile from "@/components/patterns/StatTile";
import ProgressRing from "@/components/ui/ProgressRing";
import Avatar from "@/components/ui/Avatar";
import { textEmojiOrFallback } from "@/components/ui/EmojiText";
import { db } from "@/db";
import { useAuth } from "@/hooks/useAuth";
import { useWallMode } from "@/hooks/useWallMode";
import { useWallConfirm } from "@/hooks/useWallConfirm";
import type { Task, LeaderboardEntry, Reward, Penalty, WeekData, HallOfFameEntry } from "@/types/tasks";
import { getLevel, BADGES } from "@/types/tasks";
import {
  TASKS_STORAGE_KEY, REWARDS_KEY, PENALTIES_KEY,
  weekKey, emptyWeekData,
  loadWeekData, saveWeekData,
  calculateRealStreak,
  getThisWeeksCompletedDates, getThisWeeksCompletedTasks,
  loadTasks, saveTasks,
  saveRewards, savePenalties,
  getMemberAllTimePoints, getMemberAllTimeCompletions,
  getPreviousWeekRanks, loadHallOfFame, loadHallOfFameMerged,
  loadPreviousWeekRanksMerged,
  loadWeeklyPrizes,
  applyTaskConfigSnapshotToStores,
  pickDefaultClaimMember, isSnatchable, isPendingApproval,
  completesWithoutPin, completesWithPendingApproval,
  resolveMemberName,
  mergeTasksSnapshot, getDaysUntilWeekReset,
  saveDeletedTaskIds,
  isCrewTask, crewMembers, crewMemberCount, crewFull, crewHasMember,
  crewMemberCheckedIn, crewCheckinProgress,
  normalizeSpeedBonus,
} from "@/lib/task-utils";
import { useTaskCommandQueue } from "@/hooks/useTaskCommandQueue";
import { writeTaskConfig } from "@/lib/task-config-client";
import type { TaskConfigCommand } from "@/lib/task-config";
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
import TaskLedgerQuarantineNotice from "@/components/tasks/TaskLedgerQuarantineNotice";

function isoOffset(days: number): string {
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString().split("T")[0];
}

function nextWeekdayISO(targetDay: number): string {
  const today = new Date();
  const currentDay = today.getDay();
  let diff = targetDay - currentDay;
  if (diff < 0) diff += 7;
  return isoOffset(diff);
}

const getISO = {
  // Local calendar day for "Today" due options — the UTC date was tomorrow
  // every evening 8pm–midnight Detroit.
  get today() { return localTodayISO(); },
  get tomorrow() { return isoOffset(1); },
  get thisWeek() { return isoOffset(6); },
  get fri() { return nextWeekdayISO(5); },
  get sat() { return nextWeekdayISO(6); },
  get sun() { return nextWeekdayISO(0); },
  get mon() { return nextWeekdayISO(1); },
  get tue() { return nextWeekdayISO(2); },
  get wed() { return nextWeekdayISO(3); },
  get thu() { return nextWeekdayISO(4); },
};

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

function getDueOptions(): { label: string; value: string }[] {
  const today = new Date();
  const opts: { label: string; value: string }[] = [];

  for (let i = 0; i < 31; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    const iso = d.toISOString().split("T")[0];
    let label: string;
    if (i === 0) label = "Today";
    else if (i === 1) label = "Tomorrow";
    else if (i <= 6) label = d.toLocaleDateString("en-US", { weekday: "short" });
    else label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    opts.push({ label, value: iso });
  }

  return opts;
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

const initialTasks: Task[] = [];

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
  };
}

function migrateAssigneeNames(tasks: Task[], members: any[]): Task[] {
  return tasks.map((t) => {
    const match = members.find((m: any) =>
      m.fullName === t.assignee || m.name === t.assignee || m.fullName.startsWith(t.assignee) || t.assignee.startsWith(m.name)
    );
    if (match && t.assignee !== match.fullName) {
      return { ...t, assignee: match.fullName, assigneeEmoji: match.emoji };
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
  const [pinTaskId, setPinTaskId] = useState<number | null>(null);
  // Crew join / check-in is a PIN-gated action like a claim (self-join only).
  const [pinCrewAction, setPinCrewAction] = useState<{ taskId: number; action: "crew-join" | "crew-checkin" } | null>(null);
  const [pinReward, setPinReward] = useState<Reward | null>(null);
  const [pinPenalty, setPinPenalty] = useState<Penalty | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinSuccess, setPinSuccess] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [snatchForMember, setSnatchForMember] = useState("");
  const [redeemForMember, setRedeemForMember] = useState("");
  const [penaltyForMember, setPenaltyForMember] = useState("");
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<Task[]>([]);
  const [toast, setToast] = useState<string | null>(null);
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
  const adoptStores = useCallback(() => {
    setTasks(loadTasks());
    setWeekData(loadWeekData());
    setRewards(loadFromStorage(REWARDS_KEY, []));
    setPenalties(loadFromStorage(PENALTIES_KEY, []));
  }, []);
  // Display-only optimism, keyed by OPERATION ID. A mark is created when a
  // command is queued and released when THAT command leaves the outbox (an
  // acknowledgment, a cancel, or a terminal failure) — never by a global queue
  // count, so one operation's landing can never clear another's optimism and a
  // retrying command keeps its honest "still sending" row.
  const addOptimisticRow = useCallback((operationId: string, row: OptimisticRow) => {
    setOptimisticRows((prev) => ({ ...prev, [operationId]: row }));
  }, []);
  const onAcknowledged = useCallback((acknowledged: { operationId?: string }) => {
    const operationId = acknowledged?.operationId;
    if (!operationId) return;
    setOptimisticRows((prev) => {
      if (!(operationId in prev)) return prev;
      const next = { ...prev };
      delete next[operationId];
      return next;
    });
  }, []);
  const {
    queue: queueCommand,
    counts: outboxCounts,
    entries: outboxEntries,
    cancel: cancelQueuedOperation,
    onAcknowledged: onOutboxAcknowledged,
  } = useTaskCommandQueue({ onAdopted: adoptStores });
  useEffect(() => {
    if (typeof onOutboxAcknowledged !== "function") return;
    onOutboxAcknowledged(onAcknowledged);
  }, [onOutboxAcknowledged, onAcknowledged]);

  // Restore tasks state from PocketBase snapshot on mount (bridges container restarts)
  const restoreAttempted = useRef(false);
  // True when the snapshot read 401'd — a signed-out browser can't read the
  // sessioned gateway, so an empty list here means "hidden", not "done".
  const [guestSyncBlocked, setGuestSyncBlocked] = useState(false);
  // Restore tasks state from a PocketBase snapshot (bridges container restarts
  // and merges another device's changes) via the SHARED pure merge — the same
  // guards the 60s refresh loop applies to the stores: adopt new tasks, and
  // adopt field changes on known rows only with proof (a pending tap, a
  // send-back stamp, or an earn that paid the row), never clobber a fresh
  // local tap. The old inline version was ADD-ONLY on known rows, so a kid's
  // tap on another device never reached this page's Needs-approval queue (and
  // an approval elsewhere never cleared the stale "On the way" row here).
  // Latest-state mirrors for the async snapshot restore: the fetch resolves
  // long after commit, and these effects re-sync before any merge runs, so
  // mergeTasksSnapshot always sees the CURRENT state (never a stale closure).
  const tasksRef = useRef<Task[]>(tasks);
  const weekDataRef = useRef<WeekData>(weekData);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { weekDataRef.current = weekData; }, [weekData]);
  const restoreFromSnapshot = useCallback((data: any) => {
    if (!data?.snapshot) return;
    const snap = data.snapshot;
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

  useEffect(() => {
    if (!mounted || restoreAttempted.current) return;
    restoreAttempted.current = true;
    fetch("/api/tasks/sync")
      .then((r) => {
        setGuestSyncBlocked(r.status === 401);
        return r.ok ? r.json() : null;
      })
      .then((data) => restoreFromSnapshot(data))
      .catch(() => {});
  }, [mounted, restoreFromSnapshot]);

  // Cross-device sync: re-pull the snapshot when the global refresher
  // finishes a cycle (60s tick, tab-wake, post-login) so a task added on
  // another device appears without a manual reload.
  useEffect(() => {
    const onRefreshed = () => {
      fetch("/api/tasks/sync")
        .then((r) => {
          setGuestSyncBlocked(r.status === 401);
          return r.ok ? r.json() : null;
        })
        .then((data) => restoreFromSnapshot(data))
        .catch(() => {});
    };
    window.addEventListener("consuela-data-refreshed", onRefreshed);
    return () => window.removeEventListener("consuela-data-refreshed", onRefreshed);
  }, [restoreFromSnapshot]);

  const triggerConfetti = useCallback(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setConfettiActive(true);
    setTimeout(() => setConfettiActive(false), 2500);
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const startEdit = (task: Task) => {
    if (!isParent) return; // P0 gate — kids/guests can never edit family chores
    if (!tasks.some((row) => row.id === task.id)) {
      showToast("That chore is still being saved — try again in a moment.");
      return;
    }
    setEditingId(task.id);
    setEditForm({ ...task });
    setIsAdding(false);
  };

  const startAdd = () => {
    if (!isParent) return; // P0 gate
    setEditingId(null);
    const firstNonPet = membersData.find((m: any) => m.role !== "pet");
    const defaultMember = isLoggedIn && currentUser
      ? { name: currentUser.name, emoji: currentUser.emoji }
      : { name: firstNonPet?.fullName || membersData[0]?.fullName || "", emoji: firstNonPet?.emoji || membersData[0]?.emoji || "👤" };
    setEditForm(emptyTask(defaultMember));
    setIsAdding(true);
  };

  const cancelEdit = () => { setEditingId(null); setIsAdding(false); };

  let _idCounter = 0;
  const uid = () => Date.now() + ++_idCounter;

  const saveTask = () => {
    if (!editForm.title.trim()) return;
    // Normalize mode fields so a stale value from a previous mode can't leak
    // (e.g. switching Crew -> Assigned must drop crewSize/crew).
    const normalized: Task = isCrewTask(editForm)
      ? { ...editForm, universal: false, speedBonus: undefined, crew: { members: crewMembers(editForm) } }
      : editForm.universal
        ? { ...editForm, crewSize: null, crew: null, speedBonus: normalizeSpeedBonus(editForm.speedBonus) }
        : { ...editForm, crewSize: null, crew: null, speedBonus: undefined, universal: false };
    if (isAdding) {
      const temporaryId = uid();
      const added = queueCommand({
        route: "/api/tasks/manage",
        action: "add",
        payload: { task: { ...normalized } },
        displayTarget: { kind: "task", temporaryId, title: normalized.title },
      });
      addOptimisticRow(added.operationId, { kind: "add", task: { ...normalized, id: temporaryId } });
    } else {
      const updated = queueCommand({
        route: "/api/tasks/manage",
        action: "update",
        payload: { taskId: editingId, patch: { ...normalized } },
        displayTarget: { kind: "task", taskId: editingId ?? undefined, title: normalized.title },
      });
      addOptimisticRow(updated.operationId, { kind: "update", task: { ...normalized, id: editingId as number } });
    }
    setEditingId(null);
    setIsAdding(false);
  };

  // A delete is only ever queued for a row the SERVER already has. A
  // temporary (not-yet-acknowledged) add row is inert: it renders as text, and
  // delete/edit/complete on it can never send an id the server has never seen.
  const deleteTask = (id: number) => {
    const row = tasks.find((t) => t.id === id);
    if (!row) {
      showToast("That chore is still being saved — try again in a moment.");
      return;
    }
    const removed = queueCommand({
      route: "/api/tasks/manage",
      action: "delete",
      payload: { taskId: id },
      displayTarget: { kind: "task", taskId: id, title: row.title },
    });
    addOptimisticRow(removed.operationId, { kind: "remove", taskId: id });
    setEditingId(null);
    setIsAdding(false);
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
        return { ...prev, universal: true, crewSize: null, crew: null, stealable: false, speedBonus: prev.speedBonus ?? 2, assignee: "Open", assigneeEmoji: "🤝" };
      }
      if (type === "crew") {
        const minSize = Math.max(2, crewMemberCount(prev));
        const size = typeof prev.crewSize === "number" && prev.crewSize >= minSize ? prev.crewSize : minSize;
        return { ...prev, universal: false, crewSize: size, crew: prev.crew ?? { members: [] }, stealable: false, speedBonus: undefined, assignee: "Crew", assigneeEmoji: "🤝" };
      }
      return { ...prev, universal: false, crewSize: null, crew: null, speedBonus: undefined, assignee: prev.assignee === "Open" || prev.assignee === "Crew" ? "" : prev.assignee };
    });
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
        showToast("Consuela couldn't come up with ideas right now — try again in a bit.");
      }
    } catch {
      showToast("Consuela couldn't come up with ideas right now — try again in a bit.");
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
    // A temporary row is not a task yet: there is nothing on the server to
    // complete, so this can only be a stale click on a queued add.
    const task = tasks.find((x) => x.id === taskId);
    if (!task) {
      showToast("That chore is still being saved — try again in a moment.");
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
        showToast("Taking it back — asking the family server to reopen it.");
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
      const me = isLoggedIn && currentUser ? resolveMemberName(membersData, currentUser.name) : "";
      const joined = me ? crewHasMember(task, me) : false;
      const checkedIn = me ? crewMemberCheckedIn(task, me) : false;
      const action: "crew-join" | "crew-checkin" | null =
        joined && !checkedIn ? "crew-checkin" : !joined && !crewFull(task) ? "crew-join" : null;
      if (!action) {
        showToast(joined ? "You've already checked in — waiting on the rest of the crew." : "This crew is full.");
        return;
      }
      setPinTaskId(taskId);
      setPinCrewAction({ taskId, action });
      setPinReward(null);
      setPinPenalty(null);
      setUndoTaskId(null);
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
      if (task.completedInWeek === weekKey()) return;
      const me = resolveMemberName(membersData, currentUser!.name);
      const complete = queueCommand({
        route: "/api/tasks/claim",
        action: "complete",
        payload: { taskId, memberName: me, assigneeEmoji: task.assigneeEmoji },
        displayTarget: { kind: "claim", taskId, title: task.title },
      });
      addOptimisticRow(complete.operationId, { kind: "pending", taskId });
      triggerConfetti();
      showToast(`Done! +${task.points}pts on the way — a parent approves.`);
      return;
    }
    // 10+ kids and anyone else hit a PIN step; child rows then wait for
    // approval (decided in submitPin from the VERIFIED member record, not
    // the session).
    setPinTaskId(taskId);
    setPinReward(null);
    setPinPenalty(null);
    setUndoTaskId(null);
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
    const member = memberName || (membersData.find((m: any) => m.role !== "pet")?.fullName ?? "");
    const balance = weekData.points[member] || 0;
    if (balance < reward.cost) {
      showToast(`${member.split(" ")[0]} needs ${reward.cost - balance} more pts for ${reward.emoji} ${reward.name}`);
      return;
    }
    if (reward.cost > 100) {
      setParentApprovalReward(reward);
      setParentApprovalPin("");
      setParentApprovalError("");
      setRedeemForMember(member);
      return;
    }
    setPinReward(reward);
    setPinTaskId(null);
    setPinPenalty(null);
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
        setTimeout(() => setParentApprovalError(""), 2500);
        return;
      }
      if (!parent) {
        setParentApprovalError("Parent PIN required to approve large rewards.");
        setParentApprovalPin("");
        setTimeout(() => setParentApprovalError(""), 2500);
        return;
      }
      parentApprovalPinRef.current = parentApprovalPin;
      setPinReward(parentApprovalReward);
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

  const submitApproval = async () => {
    if ((approvalTaskId === null && approvalMode !== "approve-all") || !approvalPin || pinBusy) return;
    setPinBusy(true);
    try {
      let parent: any = null;
      let unreachable = false;
      for (const m of membersData.filter((m: any) => m.role === "parent")) {
        const result = await verifyPinRemote(m.fullName, approvalPin);
        if (result.status === "ok") { parent = m; break; }
        if (result.status === "unreachable") { unreachable = true; break; }
      }
      if (unreachable) {
        setApprovalError(unreachableCopy());
        setApprovalPin("");
        setTimeout(() => setApprovalError(""), 2500);
        return;
      }
      if (!parent) {
        setApprovalError("Parent PIN required to review tapped tasks.");
        setApprovalPin("");
        setTimeout(() => setApprovalError(""), 2500);
        return;
      }
      const parentName: string = parent.fullName;

      // Every review action is ONE durable command. The PIN rides the ephemeral
      // credential registry keyed by the operation id — it is never written to
      // the outbox entry or to localStorage, and the outbox releases it only
      // after the acknowledgment (or the user's cancel).
      if (approvalMode === "approve-all") {
        const taskIds = pendingApprovals.map((p) => p.id);
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
        const target = tasks.find((x) => x.id === approvalTaskId);
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
        const target = tasks.find((x) => x.id === approvalTaskId);
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
        setTimeout(() => setCrewRemoveError(""), 2500);
        return;
      }
      if (!parent) {
        setCrewRemoveError("Parent PIN required.");
        setCrewRemovePin("");
        setTimeout(() => setCrewRemoveError(""), 2500);
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

  const openPenaltyPin = (penalty: Penalty) => {
    setPinPenalty(penalty);
    setPinTaskId(null);
    setPinReward(null);
    setPinInput("");
    setPinError("");
    setPinSuccess("");
    const defaultMember = membersData.find((m: any) => m.role !== "pet")?.fullName ?? "";
    setPenaltyForMember(defaultMember);
  };

  const normalizeName = (rawName: string): string => {
    const member = membersData.find((m: any) => m.fullName === rawName || m.name === rawName || rawName.startsWith(m.name) || m.fullName.startsWith(rawName));
    return member ? member.fullName : rawName;
  };

  const submitUndo = async () => {
    if (!undoTaskId || !undoPin || pinBusy) return;
    setPinBusy(true);
    try {
      const task = tasks.find(t => t.id === undoTaskId);
      if (!task || !task.completed) return;
      const memberName = task.completedBy || task.assignee;
      const result = await verifyPinRemote(memberName, undoPin);
      if (result.status === "unreachable") {
        setUndoError(unreachableCopy());
        setUndoPin("");
        setTimeout(() => setUndoError(""), 2000);
        return;
      }
      if (result.status === "wrongPin") {
        setUndoError("Wrong PIN. Try again.");
        setUndoPin("");
        setTimeout(() => setUndoError(""), 2000);
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
        setTimeout(() => setPinError(""), 2000);
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
          setTimeout(() => setPinError(""), 2500);
          return;
        }
        // The redemption is a durable command against the server-authoritative
        // route: the stored reward row decides the cost, the ledger entry is
        // written under the week lock, and a reward over 100pts carries the
        // parent's PIN so the server can gate it. Nothing is deducted locally.
        queueCommand({
          route: "/api/rewards/redeem",
          action: "redeem",
          payload: { rewardId: pinReward.id, memberName: normalizedName },
          displayTarget: { kind: "config", title: pinReward.name },
          credential: {
            pin: pinInput,
            ...(parentApprovalPinRef.current ? { parentPin: parentApprovalPinRef.current } : {}),
          },
        });
        parentApprovalPinRef.current = "";
        setPinInput("");
        setPinSuccess(
          `${pinReward.emoji} ${normalizedName.split(" ")[0]} redeeming ${pinReward.name} — the family server confirms the ${cost}pts.`,
        );
        setTimeout(() => { setPinReward(null); setPinSuccess(""); }, 1800);
      } else {
        setPinError(result.status === "unreachable" ? unreachableCopy() : "Wrong code for selected member. Try again.");
        setPinInput("");
        setTimeout(() => setPinError(""), 2000);
      }
      return;
    }

    if (pinPenalty) {
      const memberName = penaltyForMember;
      if (!memberName) {
        setPinError("Select a member.");
        setPinInput("");
        setTimeout(() => setPinError(""), 2000);
        return;
      }
      let result = await verifyPinRemote(memberName, pinInput);
      if (result.status === "wrongPin") {
        for (const m of membersData.filter((m: any) => m.role === "parent")) {
          result = await verifyPinRemote(m.fullName, pinInput);
          if (result.status !== "wrongPin") break;
        }
      }
      if (result.status === "ok") {
        const normalizedName = membersData.find((m: any) => m.fullName === penaltyForMember)?.fullName || penaltyForMember;
        const penaltyPoints = pinPenalty?.points ?? 0;
        // The catalog penalty id travels, never a client-chosen point value:
        // the server reads the canonical penalty and refuses a body that tries
        // to set its own amount.
        queueCommand({
          route: "/api/tasks/ledger",
          action: "penalty",
          payload: { memberName: normalizedName, itemId: pinPenalty.id },
          displayTarget: { kind: "config", title: pinPenalty.name },
          credential: { pin: pinInput },
        });
        setPinInput("");
        setPinSuccess(`-${penaltyPoints}pts from ${normalizedName.split(" ")[0]} — the family server confirms.`);
        setTimeout(() => { setPinPenalty(null); setPinSuccess(""); }, 1800);
      } else {
        setPinError(result.status === "unreachable" ? unreachableCopy() : "Wrong PIN. Try again.");
        setPinInput("");
        setTimeout(() => setPinError(""), 2000);
      }
      return;
    }

    if (pinCrewAction) {
      const crewAction = pinCrewAction;
      const memberName = snatchForMember;
      if (!memberName) {
        setPinError("Select who is joining.");
        setPinInput("");
        setTimeout(() => setPinError(""), 2000);
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
        setTimeout(() => { setPinTaskId(null); setPinCrewAction(null); setPinSuccess(""); setSnatchForMember(""); }, 1800);
      } else {
        setPinError(result.status === "unreachable" ? unreachableCopy() : "Wrong code for selected member. Try again.");
        setPinInput("");
        setTimeout(() => setPinError(""), 2000);
      }
      return;
    }

    if (pinTaskId === null) return;
    const task = tasks.find(t => t.id === pinTaskId);
    if (!task || task.completed) return;
    if (task.completedInWeek === weekKey()) return;

    if (task.universal || isSnatchable(task)) {
      const claimant = snatchForMember;
      if (!claimant) {
        setPinError("Select who is claiming this task.");
        setPinInput("");
        setTimeout(() => setPinError(""), 2000);
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
        setTimeout(() => { setPinTaskId(null); setPinSuccess(""); setSnatchForMember(""); }, 1500);
      } else {
        setPinError(result.status === "unreachable" ? unreachableCopy() : "Wrong code for selected member. Try again.");
        setPinInput("");
        setTimeout(() => setPinError(""), 2000);
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
        setTimeout(() => { setPinTaskId(null); setPinSuccess(""); setSnatchForMember(""); }, 1500);
        return;
      }
      const pointsMsg = task.points > 0 ? `+${task.points}pts` : "";
      setPinInput("");
      setPinSuccess(`${normalizedName.split(" ")[0]} completed ${task.title}! ${pointsMsg}`);
      triggerConfetti();
      setTimeout(() => { setPinTaskId(null); setPinSuccess(""); setSnatchForMember(""); }, 1500);
    } else {
      setPinError(result.status === "unreachable" ? unreachableCopy() : "Wrong PIN. Try again.");
      setPinInput("");
      setTimeout(() => setPinError(""), 2000);
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

  const openAdjust = (name: string) => {
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
        setTimeout(() => setAdjustError(""), 2500);
        return;
      }
      if (!parent) {
        setAdjustError("Parent PIN required. Try again.");
        setAdjustPin("");
        setTimeout(() => setAdjustError(""), 2500);
        return;
      }
      const delta = parseInt(adjustAmount) || 0;
      const change = adjustDir === "+" ? delta : -delta;
      // A manual adjust is a parent-PIN ledger command like any other: the
      // amount and reason travel, the balance never does, and the server writes
      // the entry under the week lock with a non-negative floor.
      queueCommand({
        route: "/api/tasks/ledger",
        action: "adjust",
        payload: { memberName: adjustMember, amount: change, reason: adjustReason },
        displayTarget: { kind: "config", title: adjustMember },
        credential: { pin: adjustPin },
      });
      const label = adjustDir === "+" ? `+${delta}` : `-${delta}`;
      setAdjustSuccess(`${label} pts for ${adjustMember.split(" ")[0]} — the family server confirms.`);
      setTimeout(() => { setAdjustMember(null); setAdjustSuccess(""); }, 1800);
    } finally {
      setPinBusy(false);
    }
  };

  // Display-only optimism, derived from the per-operation mark map: a queued ADD
  // contributes a temporary row, a queued DELETE hides its row, a queued UPDATE
  // substitutes its row's copy, and a queued completion / reopen contributes an
  // honest note. None of this is written to the store.
  //
  // The mark list is memoised so the memos below have a STABLE input: deriving
  // it inline would hand every one of them a fresh array each render and make
  // the memoisation decorative.
  const optimisticRowsList = useMemo(() => Object.values(optimisticRows), [optimisticRows]);
  const optimisticRemoved = useMemo(
    () => optimisticRowsList
      .filter((row): row is Extract<OptimisticRow, { kind: "remove" }> => row.kind === "remove")
      .map((row) => row.taskId),
    [optimisticRowsList],
  );
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
  const optimisticUpdatedIds = optimisticUpdates.map((task) => task.id);
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

  const filtered = interactiveRows.filter((t) => {
    if (filterMember === "Open") {
      // Open + late-stealable rows and crew tasks with space.
      return ((t.universal || isSnatchable(t)) || (isCrewTask(t) && !crewFull(t))) && (showCompleted ? true : !t.completed);
    }
    if (filterMember === "My Tasks" && currentUser) {
      // Ownership in the resolved-ledger space: assignees are migrated to
      // roster fullNames at mount, while the session may carry a first name.
      const mine = resolveMemberName(membersData, t.assignee) === resolveMemberName(membersData, currentUser.name);
      const claimable = ((t.universal || isSnatchable(t)) || (isCrewTask(t) && !crewFull(t))) && !t.completed;
      return (mine || claimable) && (showCompleted ? true : !t.completed);
    }
    const memberMatch = filterMember === "All" || t.assignee === filterMember;
    const completedMatch = showCompleted ? true : !t.completed;
    return memberMatch && completedMatch;
  });

  const pending = filtered.filter((t) => !t.completed && !hiddenByQueuedCommand.has(t.id));
  const pendingApprovals = tasks.filter(isPendingApproval);
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
  const completed = filtered.filter((t) => t.completed);
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
        const allTimePoints = getMemberAllTimePoints(name, weekData);
        const allTimeComps = getMemberAllTimeCompletions(name, visibleTasks, weekData);
        // Streaks are per-member: filter this week's completion dates to this
        // member before walking back consecutive days.
        const streak = calculateRealStreak(name, weekData, getThisWeeksCompletedDates(visibleTasks, name));
        const { level, title, emoji, progress } = getLevel(allTimePoints);
        const earnedBadges = BADGES.filter(b => b.condition(allTimePoints, streak, allTimeComps)).map(b => b.emoji);
        // Weekly Champ history is out-of-band (BADGES.week_champ condition
        // stays false): a rank-1 Hall of Fame entry earns the 🥇 career badge.
        if (hallOfFame.some(h => h.member === name && h.rank === 1) && !earnedBadges.includes("🥇")) {
          earnedBadges.push("🥇");
        }
        const currentMonday = weekData.weekStart;
        const completedInWeek = visibleTasks.filter(
          t => t.completed && t.completedBy === name && (
            t.completedInWeek === currentMonday ||
            (!t.completedInWeek && t.completedAt && t.completedAt >= currentMonday)
          )
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
          progressToNext: progress,
          badges: earnedBadges,
          allTimePoints,
          allTimeCompletions: allTimeComps,
          completedInWeek,
        };
      })
      .sort((a, b) => b.points - a.points);

    // Tied points share a rank (standard competition ranking) so equal scores
    // don't read as 1st vs 2nd or flicker between the two on every recompute.
    return entries.map((e, i) => ({
      ...e,
      rank: i > 0 && e.points === entries[i - 1].points ? entries[i - 1].rank : i + 1,
    }));
  }, [weekData, membersData, visibleTasks, hallOfFame]);

  const topScorer = dynamicLeaderboard[0];
  const familyTotal = dynamicLeaderboard.reduce((sum, entry) => sum + entry.points, 0);
  const championShare = familyTotal > 0 ? topScorer.points / familyTotal : 0;
  const weeklyEarned = Object.values(weekData.points).reduce((a, b) => a + b, 0);
  const daysUntilReset = getDaysUntilWeekReset();
  // Everything the user can still take back: a `reconciling` entry has already
  // been applied server-side, so cancelling it would be a lie.
  const cancellableEntries = outboxEntries.filter((entry) => entry.status !== "reconciling");

  // The three StatTiles all follow the member filter: a parent tapping a kid's
  // tile reads that kid's open chores / this-week completions / this week's
  // points. "All" and "Open" stay family-wide.
  const scopedMember = useMemo(() => {
    if (filterMember === "All" || filterMember === "Open") return null;
    const target = filterMember === "My Tasks" ? currentUser?.name : filterMember;
    if (!target) return null;
    return dynamicLeaderboard.find((e) => e.name === target || e.name.startsWith(target)) ?? null;
  }, [filterMember, currentUser, dynamicLeaderboard]);

  const scopedCompletedCount = useMemo(() => {
    // Only universal tasks survive the Up-for-grabs filter once completed
    // (isSnatchable turns false) — count what the list can actually show.
    if (filterMember === "Open") return thisWeeksCompleted.filter((t) => t.universal).length;
    if (!scopedMember) return thisWeeksCompletedCount;
    return thisWeeksCompleted.filter((t) =>
      t.completedBy === scopedMember.name || t.completedBy?.startsWith(scopedMember.name) ||
      t.assignee === scopedMember.name || t.assignee.startsWith(scopedMember.name)
    ).length;
  }, [filterMember, scopedMember, thisWeeksCompleted, thisWeeksCompletedCount]);

  const scopedEarned = scopedMember ? scopedMember.points : weeklyEarned;
  // Earned tile detail: all-time context next to the weekly number — the
  // member filter scopes it (a member's own total, family sum under "All").
  const scopedAllTimeEarned = scopedMember
    ? scopedMember.allTimePoints
    : dynamicLeaderboard.reduce((sum, e) => sum + e.allTimePoints, 0);
  const sheetEntry = sheetMember ? dynamicLeaderboard.find(e => e.name === sheetMember) : null;

  useEffect(() => {
    if (!mounted || !isLoggedIn || !currentUser) return;
    const myEntry = dynamicLeaderboard.find(e => e.name === currentUser.name || e.name.startsWith(currentUser.name));
    if (!myEntry) return;
    const prev = prevLevelsRef.current[currentUser.name];
    if (prev !== undefined && myEntry.level > prev) {
      setLevelUpInfo({ name: currentUser.name, emoji: myEntry.emoji, oldLevel: prev, newLevel: myEntry.level });
    }
    prevLevelsRef.current[currentUser.name] = myEntry.level;
  }, [dynamicLeaderboard, mounted, isLoggedIn, currentUser]);

  const myPendingQuests = useMemo(() => {
    if (!isLoggedIn || !currentUser) return [];
    return visibleTasks
      .filter(t => !t.completed && (t.assignee === currentUser.name || t.assignee.startsWith(currentUser.name) || t.universal))
      .sort((a, b) => a.points - b.points)
      .slice(0, 3);
  }, [visibleTasks, isLoggedIn, currentUser]);

  const needsStreakSave = useMemo(() => {
    if (!isLoggedIn || !currentUser) return false;
    const myEntry = dynamicLeaderboard.find(e => e.name === currentUser.name || e.name.startsWith(currentUser.name));
    if (!myEntry || myEntry.streak < 2) return false;
    const today = localTodayISO();
    return !visibleTasks.some(t => t.completed && t.completedBy === currentUser.name && t.completedAt && t.completedAt.split("T")[0] === today);
  }, [dynamicLeaderboard, visibleTasks, isLoggedIn, currentUser]);

  const myEntry = isLoggedIn && currentUser ? dynamicLeaderboard.find(e => e.name === currentUser.name || e.name.startsWith(currentUser.name)) : null;
  const aheadEntry = myEntry && myEntry.rank > 1 ? dynamicLeaderboard[myEntry.rank - 2] : undefined;
  const behindEntry = myEntry && myEntry.rank < dynamicLeaderboard.length ? dynamicLeaderboard[myEntry.rank] : undefined;
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
    <PageShell>
      <ConfettiBurst active={confettiActive} />
      {/* Weekly prize ceremony — raceName is the roster-resolved FULL name
          (hall entries are keyed by full name); null for guests = no render. */}
      <WeeklyWinModal memberName={raceName} />
      <Toast open={Boolean(toast)} tone={toast?.includes("Failed") ? "error" : toast?.includes("grabbed") || toast?.includes("not connected") || toast?.includes("not granted") ? "neutral" : "success"}>{toast}</Toast>

      <div className="mx-auto w-full lg:max-w-3xl">
      <PageHeader
        title="Tasks"
        subtitle={`${pending.length} pending`}
        action={
          // P0 safety gate: creating and editing family chores is a parent
          // action — kids get their quest surface on KidHome, guests get the
          // honest signed-out view.
          isParent ? (
            <IconButton aria-label="Add task" onClick={startAdd}>
              <span>＋</span>
            </IconButton>
          ) : undefined
        }
        icon="✅"
      />

      <div className="px-4 space-y-6 pb-8">
        {/* One compact 3-up stat row at every width — on phones the stacked
            tiles used to eat 405px of prime screen before the first chore. */}
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Pending" value={pending.length} detail="Open tasks" icon="📋" tone="warning" compact />
          <StatTile label="Completed" value={scopedCompletedCount} detail="This week" icon="🎉" tone="success" compact />
          <StatTile label="Earned this week" value={scopedEarned} detail={`${scopedAllTimeEarned} pts all-time`} icon="🏆" tone="accent" compact />
        </div>

        <SegmentedControl
          aria-label="Tasks view"
          emphasize
          value={activeTab}
          onChange={(value) => setActiveTab(value as "tasks" | "leaderboard")}
          options={[
            { id: "tasks", label: "Tasks" },
            { id: "leaderboard", label: "Leaderboard" },
          ]}
        />

        {outboxCounts.pending > 0 && (
          <div
            data-testid="task-command-queue"
            className="rounded-xl px-3 py-2"
            style={{
              background: "color-mix(in srgb, var(--color-accent-amber) 10%, transparent)",
              border: "1px solid color-mix(in srgb, var(--color-accent-amber) 25%, transparent)",
            }}
          >
            <p className="text-[11px] font-semibold text-[var(--color-accent-amber)]">
              {outboxCounts.queued > 0
                ? `⏳ Sending ${outboxCounts.queued} change${outboxCounts.queued !== 1 ? "s" : ""} to the family server…`
                : ""}
              {outboxCounts.authRequired > 0
                ? `${outboxCounts.queued > 0 ? " " : ""}🔒 ${outboxCounts.authRequired} waiting on a PIN.`
                : ""}
              {outboxCounts.reconciling > 0
                ? `${outboxCounts.queued > 0 || outboxCounts.authRequired > 0 ? " " : ""}⏳ ${outboxCounts.reconciling} finishing up.`
                : ""}
              {outboxCounts.failed > 0
                ? `${outboxCounts.queued > 0 || outboxCounts.authRequired > 0 || outboxCounts.reconciling > 0 ? " " : ""}⚠️ ${outboxCounts.failed} couldn't be sent.`
                : ""}
            </p>
            {cancellableEntries.length > 0 && (
              <ul className="mt-1 space-y-1">
                {cancellableEntries.map((entry) => (
                  <li key={entry.operationId} className="flex items-center gap-2">
                    <span className="text-[11px] text-text-secondary">
                      {entry.displayTarget.title || entry.action}
                    </span>
                    <button
                      type="button"
                      aria-label={`Cancel queued ${entry.displayTarget.title || entry.action}`}
                      onClick={() => cancelQueuedOperation(entry.operationId)}
                      className="tap-sm text-[11px] font-semibold text-[var(--color-accent-rose)]"
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
          <div key="tasks" className="panel-swap space-y-6">
          <>
              <div className="member-strip member-strip-tiles snap-x snap-mandatory overscroll-contain pb-2">
                {allMembers.map((member) => (
                  <button
                    key={member}
                    type="button"
                    aria-pressed={filterMember === member}
                    onClick={() => setFilterMember(member)}
                    className={`member-tile shrink-0 snap-start tap-sm ${filterMember === member ? "is-active" : ""}`}
                    style={{ "--chip-color": memberChipColor(memberColors[member]) } as CSSProperties}
                  >
                    <Avatar name={member} color={memberColors[member] || "green"} emoji={memberEmojis[member]} size="sm" variant="emoji" />
                    <span className="member-tile-name">{["All", "My Tasks", "Open"].includes(member) ? member : member.split(" ")[0]}</span>
                  </button>
                ))}
              </div>

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
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Title</span>
                    <input value={editForm.title} onChange={(e) => updateForm("title", e.target.value)} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none placeholder:text-text-muted" placeholder="Task title" autoFocus />
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
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Due</span>
                      <select value={editForm.due} onChange={(e) => updateForm("due", e.target.value)} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none">
                        {getDueOptions().map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                      </select>
                    </label>
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
                       <select value={editForm.recurring || "None"} onChange={(e) => updateForm("recurring", e.target.value === "None" ? null : e.target.value)} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none">
                         <option value="None">None</option>
                         <option value="Daily">Daily</option>
                         <option value="Weekdays">Weekdays</option>
                         <option value="Weekly">Weekly</option>
                       </select>
                     </label>
                   </div>
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
                      <span className="mt-1 block text-[11px] text-text-muted">The first person to claim it earns this many extra points (0–5).</span>
                    </label>
                  )}
                  {formType === "crew" && (() => {
                    const minSize = Math.max(2, crewMemberCount(editForm));
                    const size = editForm.crewSize ?? minSize;
                    return (
                      <div>
                        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Crew size</span>
                        <div className="flex items-center gap-3">
                          <button type="button" aria-label="Fewer helpers" disabled={size <= minSize} onClick={() => updateForm("crewSize", Math.max(minSize, size - 1))} className="tap-sm h-11 w-11 rounded-full glass-subtle text-lg text-text-primary disabled:opacity-40">−</button>
                          <span className="text-lg font-bold tabular-nums text-text-primary">{size}</span>
                          <button type="button" aria-label="More helpers" disabled={size >= 5} onClick={() => updateForm("crewSize", Math.min(5, size + 1))} className="tap-sm h-11 w-11 rounded-full glass-subtle text-lg text-text-primary disabled:opacity-40">+</button>
                          <span className="text-xs text-text-secondary">helpers · +{editForm.points} pts each</span>
                        </div>
                        {crewMemberCount(editForm) > 0 && (
                          <span className="mt-1 block text-[11px] text-text-muted">Can&apos;t go below {minSize} — {crewMemberCount(editForm)} already joined.</span>
                        )}
                      </div>
                    );
                  })()}
                  {formType === "assigned" && (
                    <details className="rounded-2xl border border-white/10 px-3 py-2">
                      <summary className="cursor-pointer text-xs font-semibold text-text-secondary">Advanced</summary>
                      <div className="mt-2">
                        <Toggle checked={!!editForm.stealable} onCheckedChange={(checked) => updateForm("stealable", checked)} label="⏰ Up for grabs when late" description="If it's not done after the due date, anyone can grab it for the points." />
                      </div>
                    </details>
                  )}
                </div>
              </Modal>
             )}

            <TaskLedgerQuarantineNotice localWeekData={weekData} isParent={isParent} />

            {openBoard.length > 0 && (
              <SectionCard title="🫳 Open" description="Nobody's claimed these — fastest fingers earn the bonus." icon="⚡">
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
                          backgroundImage: `linear-gradient(135deg, color-mix(in srgb, var(--color-accent-cyan) 40%, transparent) 0%, color-mix(in srgb, var(--color-accent-cyan) 20%, transparent) 100%)`,
                        }}
                      >
                        <Avatar name={task.assignee} color={memberColors[task.assignee] || "green"} emoji={crew ? "🤝" : "🫳"} size="sm" variant="emoji" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-text-primary">{task.title}</div>
                          <div className="truncate text-xs text-text-secondary">
                            {crew
                              ? `🤝 Crew ${joined}/${task.crewSize} joined${full ? " — full" : ""} · +${task.points} pts each`
                              : `Open — nobody's yet${speed > 0 ? ` · first grab +${speed}` : ""}`}
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
              </SectionCard>
            )}

            {isLoggedIn && currentUser?.role === "parent" && (() => {
              const crews = visibleTasks.filter((t) => isCrewTask(t) && !t.completed && !t.pendingApproval);
              if (crews.length === 0) return null;
              return (
                <SectionCard title="🤝 Crew tasks" description="Manage who's on each crew." icon="🤝">
                  <div className="space-y-3">
                    {crews.map((task) => (
                      <div key={task.id} className="rounded-2xl glass-subtle p-3">
                        <div className="text-sm font-semibold text-text-primary">{task.title}</div>
                        <div className="mt-1 text-xs text-text-secondary">🤝 Crew of {task.crewSize} — {crewMemberCount(task)}/{task.crewSize} joined · +{task.points} pts each</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {crewMembers(task).map((m) => (
                            <span key={m.name} className="inline-flex items-center gap-1.5 rounded-full glass-subtle px-2 py-1 text-xs text-text-primary">
                              {m.emoji || "👤"} {m.name.split(" ")[0]}
                              {m.checkedInAt ? (
                                <span className="text-[var(--color-accent-mint)]">✓ done</span>
                              ) : (
                                <button
                                  type="button"
                                  aria-label={`Remove ${m.name.split(" ")[0]} from ${task.title}`}
                                  onClick={() => { setCrewRemoveTarget({ taskId: task.id, memberName: m.name }); setCrewRemovePin(""); setCrewRemoveError(""); }}
                                  className="text-text-muted hover:text-[var(--color-accent-rose)]"
                                >
                                  ✕
                                </button>
                              )}
                            </span>
                          ))}
                          {crewMemberCount(task) === 0 && <span className="text-xs text-text-muted">Nobody has joined yet.</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              );
            })()}

            <SectionCard title="Pending" description={`${pending.length} open tasks`} icon="📋">
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
                        <div className="truncate text-sm text-text-primary">{row.title}</div>
                        <div className="truncate text-xs text-text-secondary">
                          adding — {row.assignee}
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] font-semibold text-[var(--color-accent-amber)]">
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
                    if (!row) return null;
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
                          <div className="truncate text-sm text-text-primary">{row.title}</div>
                          <div className="truncate text-xs text-text-secondary">
                            {cancelling ? "asking the family server to reopen it" : `${row.points}pts on the way`}
                          </div>
                        </div>
                        <span className="shrink-0 text-[11px] font-semibold text-[var(--color-accent-amber)]">
                          {cancelling ? "Taking it back" : "On the way"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {pending.length === 0 ? (
                !isLoggedIn && guestSyncBlocked && tasks.length === 0 ? (
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
                          backgroundImage: `linear-gradient(135deg, color-mix(in srgb, ${rowColor} 40%, transparent) 0%, color-mix(in srgb, ${rowColor} 20%, transparent) 100%)`,
                        }}
                      >
                        <div
                          className="h-8 w-0.5 shrink-0 rounded-full"
                          style={{ backgroundColor: rowColor, boxShadow: `0 0 8px ${rowColor}` }}
                        />
                        <Avatar name={task.assignee} color={memberColors[task.assignee] || "green"} emoji={assigneeEmojis[task.assignee] || task.assigneeEmoji} size="sm" variant="emoji" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-text-primary">{task.title}</div>
                          <div className="truncate text-xs text-text-secondary">
                            {isCrewTask(task)
                              ? `🤝 Crew ${crewCheckinProgress(task).checkedIn}/${task.crewSize} checked in · ${crewMemberCount(task)} joined · +${task.points} pts each`
                              : `${task.assignee.split(" ")[0]} · ${isSnatchable(task) ? `was due ${formatDueLabel(task.due)}` : formatDueLabel(task.due)} · ${task.category}`}
                          </div>
                        </div>
                        <span
                          className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold text-text-primary glass-subtle"
                          style={{
                            background: `linear-gradient(135deg, color-mix(in srgb, ${rowColor} 55%, transparent), color-mix(in srgb, ${rowColor} 30%, transparent))`,
                          }}
                        >
                          +{task.points}pts
                        </span>
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

            {isLoggedIn && currentUser?.role === "parent" && pendingApprovals.length > 0 && (
              <SectionCard title="Needs approval" description={`${pendingApprovals.length} tapped — review to award points`} icon="⏳">
                {/* One PIN pays the whole queue — the per-row grind was the
                    biggest parent complaint in the evaluation. */}
                <div className="mb-3">
                  <SoftButton onClick={() => { setApprovalTaskId(null); setApprovalMode("approve-all"); setApprovalPin(""); setApprovalError(""); }} className="w-full">
                    ✓ Approve all ({pendingApprovals.length})
                  </SoftButton>
                </div>
                <div className="space-y-2">
                  {pendingApprovals.map((task) => {
                    const crew = task.pendingApproval!.crew ?? [];
                    const isCrew = crew.length > 0;
                    return (
                    <div
                      key={task.id}
                      className="schedule-row liquid-glass flex items-center gap-3 px-3 py-2.5"
                      style={{
                        backgroundImage: `linear-gradient(135deg, color-mix(in srgb, var(--color-accent-amber) 40%, transparent) 0%, color-mix(in srgb, var(--color-accent-amber) 20%, transparent) 100%)`,
                      }}
                    >
                      <Avatar name={task.assignee} color={memberColors[task.assignee] || "green"} emoji={isCrew ? "🤝" : assigneeEmojis[task.assignee] || task.assigneeEmoji} size="sm" variant="emoji" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-text-primary">{task.title}</div>
                        <div className="truncate text-xs text-text-secondary">
                          {isCrew
                            ? `🤝 Crew ${crew.length}/${task.crewSize ?? crew.length} · ${task.points}pts each · ${crew.map((n) => n.split(" ")[0]).join(", ")}`
                            : `${task.pendingApproval!.byName.split(" ")[0]} · tapped ${task.pendingApproval!.at.split("T")[0]} · ${task.points}pts`}
                        </div>
                      </div>
                      <button type="button" aria-label={`Approve ${task.title}`} onClick={() => { setApprovalTaskId(task.id); setApprovalMode("approve"); setApprovalPin(""); setApprovalError(""); }} className="tap-sm min-h-[44px] shrink-0 rounded-full px-3 text-xs font-bold text-text-primary glass-subtle">Approve</button>
                      <button type="button" aria-label={`Send back ${task.title}`} onClick={() => { setApprovalTaskId(task.id); setApprovalMode("sendback"); setApprovalPin(""); setApprovalError(""); }} className="tap-sm min-h-[44px] shrink-0 rounded-full px-3 text-xs font-semibold text-text-secondary">Send back</button>
                    </div>
                    );
                  })}
                </div>
              </SectionCard>
            )}

            {thisWeeksCompletedCount > 0 && (
              <SectionCard title="Completed" description={`${thisWeeksCompletedCount} done this week`} icon="✅">
                <button type="button" onClick={() => setShowCompleted(!showCompleted)} aria-expanded={showCompleted} className="mb-3 flex min-h-[44px] w-full items-center justify-between rounded-xl px-1 text-sm font-semibold text-text-secondary">
                  <span>{showCompleted ? "Hide completed" : "Show completed"}</span>
                  <span>{showCompleted ? "↑" : "↓"}</span>
                </button>
                {showCompleted && (
                  <div className="space-y-2">
                    {completed.length === 0 ? (
                      <p className="py-2 text-center text-xs text-text-muted">No completed tasks for this filter yet.</p>
                    ) : (
                      completed.map((task) => {
                        if (isPendingApproval(task)) {
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
                              backgroundImage: `linear-gradient(135deg, color-mix(in srgb, var(--color-accent-amber) 40%, transparent) 0%, color-mix(in srgb, var(--color-accent-amber) 20%, transparent) 100%)`,
                            }}
                          >
                            <div
                              className="h-8 w-0.5 shrink-0 rounded-full"
                              style={{ backgroundColor: "var(--color-accent-amber)", boxShadow: `0 0 8px var(--color-accent-amber)` }}
                            />
                            <Avatar name={task.assignee} color={memberColors[task.assignee] || "green"} emoji={assigneeEmojis[task.assignee] || task.assigneeEmoji} size="sm" variant="emoji" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm text-text-primary">{task.title}</div>
                              <div className="truncate text-xs text-text-secondary">{owner.byName.split(" ")[0]} · tapped {owner.at.split("T")[0]} · {task.points}pts on the way</div>
                            </div>
                            <span
                              className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold text-text-primary glass-subtle"
                              style={{
                                background: `linear-gradient(135deg, color-mix(in srgb, var(--color-accent-amber) 55%, transparent), color-mix(in srgb, var(--color-accent-amber) 30%, transparent))`,
                              }}
                            >
                              ⏳ On the way
                            </span>
                          </div>
                          );
                        }
                        const rowColor = "var(--color-accent-mint)";
                        return (
                        <div
                          key={task.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`Undo completion of ${task.title}`}
                          onClick={() => openPinEntry(task.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openPinEntry(task.id);
                            }
                          }}
                          className="schedule-row liquid-glass flex cursor-pointer items-center gap-3 px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-selected)]"
                          style={{
                            backgroundImage: `linear-gradient(135deg, color-mix(in srgb, ${rowColor} 40%, transparent) 0%, color-mix(in srgb, ${rowColor} 20%, transparent) 100%)`,
                          }}
                        >
                          <div
                            className="h-8 w-0.5 shrink-0 rounded-full"
                            style={{ backgroundColor: rowColor, boxShadow: `0 0 8px ${rowColor}` }}
                          />
                          <Avatar name={task.assignee} color={memberColors[task.assignee] || "green"} emoji={assigneeEmojis[task.assignee] || task.assigneeEmoji} size="sm" variant="emoji" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm text-text-primary">{task.title}</div>
                            <div className="truncate text-xs text-text-secondary">{task.assignee.split(" ")[0]} · {task.completedBy?.split(" ")[0] || task.assignee.split(" ")[0]} · {task.completedInWeek === weekData.weekStart ? "This week" : "Past"}</div>
                          </div>
                          <span
                            className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold text-text-primary glass-subtle"
                            style={{
                              background: `linear-gradient(135deg, color-mix(in srgb, ${rowColor} 55%, transparent), color-mix(in srgb, ${rowColor} 30%, transparent))`,
                            }}
                          >
                            Done
                          </span>
                          <IconButton size="sm" variant="ghost" aria-label="Undo complete" className="hit-44" onClick={() => openPinEntry(task.id)}>↩</IconButton>
                        </div>
                        );
                      })
                    )}
                  </div>
                )}
              </SectionCard>
            )}

            {/* AI chore ideas — parents-only and BELOW the chore lists. The
                empty generator used to sit above Pending as a full card,
                pushing the real list ~2 viewports down the phone. */}
            {isParent && (aiSuggestions.length > 0 ? (
              <SectionCard title="Consuela suggests" description="Fresh ideas for the family." icon="✨">
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
                          <IconButton size="sm" variant="ghost" aria-label="Dismiss" className="hit-44" onClick={() => dismissSuggestion(suggestion.title)}>×</IconButton>
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
          <div key="leaderboard" className="panel-swap space-y-6">
          <>
            <Surface variant="warm" radius="2xl" padding="lg" glow>
              {familyTotal === 0 ? (
                <div className="py-2 text-center">
                  <span className="text-2xl animate-crown-glow">👑</span>
                  <h3 className="mt-1 text-xl font-bold text-text-primary">The crown is up for grabs</h3>
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
                      <h3 className="text-xl font-bold text-text-primary">{topScorer.name.split(" ")[0]}</h3>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <p className="text-sm text-text-secondary">
                        <span className="font-semibold text-[var(--color-accent-selected)]">{topScorer.points}</span> pts
                      </p>
                      {topScorer.streak > 0 && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
                          style={{ background: "color-mix(in srgb, var(--color-accent-amber) 12%, transparent)", color: "var(--color-accent-amber)" }}
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
                  <StatTile label="Penalties" value={penalties.length} detail="Configured" icon="⚠️" tone="warning" />
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
            <SectionCard title="Leaderboard" description="This week's race — resets Monday" icon="🏆">
              <Podium
                entries={dynamicLeaderboard.slice(0, 3)}
                prizes={weeklyPrizes}
                previousRanks={previousRanks}
                isYou={(name: string) => !!(isLoggedIn && currentUser && (name === currentUser.name || name.startsWith(currentUser.name)))}
                getMemberColor={(name: string) => memberColors[name] || "green"}
                onOpenSheet={setSheetMember}
                onAdjust={openAdjust}
                isAdmin={isLoggedIn && currentUser?.role === "parent"}
              />
              <div className="mt-3 space-y-3">
                {dynamicLeaderboard.slice(3).map((entry, index) => (
                  <LeaderboardRow
                    key={entry.name}
                    entry={entry}
                    index={index + 3}
                    previousRank={previousRanks[entry.name]}
                    isYou={!!(isLoggedIn && currentUser && (entry.name === currentUser.name || entry.name.startsWith(currentUser.name)))}
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
              const myEntry = dynamicLeaderboard.find(e => e.name === currentUser.name || e.name.startsWith(currentUser.name));
              const myRank = myEntry?.rank ?? 0;
              const aheadEntry = myRank > 1 ? dynamicLeaderboard[myRank - 2] : undefined;
              return myEntry ? <YourCard entry={myEntry} aheadEntry={aheadEntry} getMemberColor={(n: string) => memberColors[n] || "green"} /> : null;
            })()}

            {needsStreakSave && (
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
                allTimePoints={getMemberAllTimePoints(sheetEntry.name, weekData)}
                allTimeComps={getMemberAllTimeCompletions(sheetEntry.name, visibleTasks, weekData)}
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
              />
            )}

            {/* The deep archive folds behind one expander: journey, family
                goal, and hall are history — the tab leads with the live race,
                not its museum. */}
            <details className="rounded-2xl border border-white/10 px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold text-text-secondary">🏅 Trophies, journey & history</summary>
              <div className="mt-4 space-y-6">
                {isLoggedIn && currentUser && (() => {
                  const myAllTime = getMemberAllTimePoints(currentUser.name, weekData);
                  return (
                    <SectionCard title="Your Journey" description={`${textEmojiOrFallback(currentUser.emoji)} Level progress & badges`}>
                      <TreasurePath
                        allTimePoints={myAllTime}
                        memberEmoji={currentUser.emoji || "🌱"}
                        memberColor={memberColors[currentUser.name] || "green"}
                      />
                      <div className="mt-4">
                        <AchievementWall
                          allTimePoints={myAllTime}
                          streak={dynamicLeaderboard.find(e => e.name === currentUser.name || e.name.startsWith(currentUser.name))?.streak ?? 0}
                          completions={getMemberAllTimeCompletions(currentUser.name, visibleTasks, weekData)}
                        />
                      </div>
                    </SectionCard>
                  );
                })()}

                <FamilyGoal weekData={weekData} isParent={!!membersData.find((m: any) => m.role === "parent")} />

                <HallOfFame />
              </div>
            </details>

            {weekData.history.length > 0 && (
              <SectionCard title="Recent Activity" description="Latest point transactions" icon="📜">
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {weekData.history.slice().reverse().slice(0, 15).map((tx) => (
                    <div key={tx.id} className="flex items-center gap-2 rounded-xl px-2 py-1 text-xs">
                      <span className="shrink-0 text-base">
                        {tx.type === "earn" ? "✅" : tx.type === "redeem" ? "🎁" : tx.type === "penalty" ? "⚠️" : "⚙️"}
                      </span>
                      <span className="flex-1 truncate text-text-secondary">
                        <span className="font-medium text-text-primary">{tx.member.split(" ")[0]}</span>{" "}
                        {tx.description}
                      </span>
                      <span
                        className="shrink-0 font-semibold"
                        style={{ color: tx.amount > 0 ? "var(--color-accent-mint)" : "var(--color-accent-rose)" }}
                      >
                        {tx.amount > 0 ? "+" : ""}{tx.amount}
                      </span>
                      <span className="text-text-muted shrink-0">
                        {new Date(tx.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            <SectionCard title="Rewards" description="Spend points on family perks." icon="🎁">
              <div className="flex gap-2">
                <SoftButton variant="secondary" onClick={generateAiRewards} disabled={aiRewardSuggesting} className="flex-1">{aiRewardSuggesting ? "Thinking..." : "Suggest"}</SoftButton>
                <SoftButton variant="ghost" onClick={startAddReward} className="flex-1">Add</SoftButton>
              </div>
              {aiRewards.length > 0 && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {aiRewards.map((reward) => (
                    <Surface key={reward.name} variant="glass-subtle" radius="xl" padding="sm">
                      <div className="flex items-start gap-3">
                        <span className="text-xl">{reward.emoji}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-text-primary">{reward.name}</div>
                          <div className="mt-1 text-xs text-text-muted">{reward.cost} pts</div>
                        </div>
                        <SoftButton size="sm" onClick={() => adoptReward(reward)}>Add</SoftButton>
                      </div>
                    </Surface>
                  ))}
                </div>
              )}
              <div className="mt-4 space-y-3">
                {rewards.map((reward) => (
                  <Surface key={reward.id} variant="glass-subtle" radius="xl" padding="sm">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{reward.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-text-primary">{reward.name}</div>
                        <div className="text-xs text-text-muted">{reward.cost} pts {reward.cost > 100 && <span className="ml-1" style={{ color: "var(--color-accent-amber)" }}>· needs parent</span>}</div>
                      </div>
                      <SoftButton size="sm" variant="secondary" aria-label={`Redeem ${reward.name}`} onClick={() => openRewardPin(reward)}>Redeem</SoftButton>
                      <IconButton size="sm" variant="ghost" aria-label="Edit reward" className="hit-44" onClick={() => startEditReward(reward)}>✎</IconButton>
                    </div>
                  </Surface>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Penalties" description="Point deductions for missed chores." icon="⚠️">
              <div className="flex gap-2 mb-4">
                <SoftButton variant="secondary" onClick={startAddPenalty} className="flex-1">Add</SoftButton>
              </div>
              <div className="space-y-3">
                {penalties.map((penalty) => (
                  <Surface key={penalty.id} variant="glass-subtle" radius="xl" padding="sm">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{penalty.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-text-primary">{penalty.name}</div>
                        <div className="text-xs text-text-muted">-{penalty.points} pts</div>
                      </div>
                      <IconButton size="sm" variant="ghost" aria-label="Apply penalty" className="hit-44" onClick={() => openPenaltyPin(penalty)}>⚠️</IconButton>
                      <IconButton size="sm" variant="ghost" aria-label="Edit penalty" className="hit-44" onClick={() => startEditPenalty(penalty)}>✎</IconButton>
                    </div>
                  </Surface>
                ))}
              </div>
            </SectionCard>
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

      {(pinTaskId !== null || pinReward !== null || pinPenalty !== null) && (
        <Modal
          open
          onClose={() => { setPinTaskId(null); setPinReward(null); setPinPenalty(null); }}
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
              <SoftButton variant="secondary" onClick={() => { setPinTaskId(null); setPinCrewAction(null); setPinReward(null); setPinPenalty(null); }} className="flex-1">Cancel</SoftButton>
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
              onChange={(e) => { setPinInput(e.target.value.replace(/[^0-9]/g, "")); setPinError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") submitPin(); }}
              placeholder="4-digit PIN"

              aria-label="Your 4-digit PIN"
              autoFocus
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-4 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-muted"
            />
            {pinError && <p className="text-center text-sm text-[var(--color-accent-rose)]">{pinError}</p>}
            {pinSuccess && <p className="text-center text-sm text-[var(--color-accent-selected)]">{pinSuccess}</p>}
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
              onChange={(e) => { setUndoPin(e.target.value.replace(/[^0-9]/g, "")); setUndoError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") submitUndo(); }}
              placeholder="4-digit PIN"

              aria-label="Your 4-digit PIN"
              autoFocus
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-4 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-muted"
            />
            {undoError && <p className="text-center text-sm text-[var(--color-accent-rose)]">{undoError}</p>}
          </div>
        </Modal>
      )}

      {adjustMember && (
        <Modal
          open
          onClose={() => setAdjustMember(null)}
          title="Manual point adjust"
          description={`Adjust points for ${adjustMember.split(" ")[0]}`}
          footer={
            <>
              <SoftButton onClick={submitAdjust} loading={pinBusy} disabled={!adjustPin || pinBusy} className="flex-1">Apply</SoftButton>
              <SoftButton variant="secondary" onClick={() => setAdjustMember(null)} className="flex-1">Cancel</SoftButton>
            </>
          }
        >
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Amount</span>
              <input type="number" aria-label="Adjustment amount" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none" />
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
              <input type="password" aria-label="Parent PIN" inputMode="numeric" maxLength={4} value={adjustPin} onChange={(e) => { setAdjustPin(e.target.value.replace(/[^0-9]/g, "")); setAdjustError(""); }} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-muted" placeholder="0000" />
            </label>
            {adjustError && <p className="text-center text-sm text-[var(--color-accent-rose)]">{adjustError}</p>}
            {adjustSuccess && <p className="text-center text-sm text-[var(--color-accent-selected)]">{adjustSuccess}</p>}
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
              onChange={(e) => { setParentApprovalPin(e.target.value.replace(/[^0-9]/g, "")); setParentApprovalError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") approveParentReward(); }}
              placeholder="Parent PIN"

              aria-label="Parent PIN"
              autoFocus
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-4 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-muted"
            />
            {parentApprovalError && <p className="text-center text-sm text-[var(--color-accent-rose)]">{parentApprovalError}</p>}
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
            const target = tasks.find((x) => x.id === approvalTaskId);
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
              onChange={(e) => { setApprovalPin(e.target.value.replace(/[^0-9]/g, "")); setApprovalError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") submitApproval(); }}
              placeholder="Parent PIN"

              aria-label="Parent PIN"
              autoFocus
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-4 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-muted"
            />
            {approvalError && <p className="text-center text-sm text-[var(--color-accent-rose)]">{approvalError}</p>}
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
              onChange={(e) => { setCrewRemovePin(e.target.value.replace(/[^0-9]/g, "")); setCrewRemoveError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") submitCrewRemove(); }}
              placeholder="Parent PIN"

              aria-label="Parent PIN"
              autoFocus
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-4 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-muted"
            />
            {crewRemoveError && <p className="text-center text-sm text-[var(--color-accent-rose)]">{crewRemoveError}</p>}
          </div>
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
              <SoftButton variant="danger" onClick={() => { deleteTask(editForm.id); setConfirmDeleteOpen(false); cancelEdit(); }} className="flex-1">Delete</SoftButton>
              <SoftButton variant="secondary" onClick={() => setConfirmDeleteOpen(false)} className="flex-1">Cancel</SoftButton>
            </>
          }
        >
          <p className="text-sm text-text-secondary">The chore disappears from every device. Points already earned for it stay earned.</p>
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
