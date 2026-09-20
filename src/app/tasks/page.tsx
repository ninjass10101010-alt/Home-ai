/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity */
"use client";

import { useState, useEffect, useMemo, useCallback, useRef, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { mapTaskIdeas, mapRewardIdeas } from "@/lib/ai-suggestions";
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
import type { Task, LeaderboardEntry, Reward, Penalty, WeekData, CrewMember } from "@/types/tasks";
import { getLevel, BADGES } from "@/types/tasks";
import {
  TASKS_STORAGE_KEY, REWARDS_KEY, PENALTIES_KEY,
  todayMondayISO, weekKey, todayISO, emptyWeekData,
  loadWeekData, saveWeekData, addTransaction,
  calculateRealStreak, regenerateRecurringTasks,
  getThisWeeksCompletedDates, getThisWeeksCompletedTasks,
  loadTasks, saveTasks, loadRewards, saveRewards,
  loadPenalties, savePenalties,
  getArchivedWeeks, getMemberAllTimePoints, getMemberAllTimeCompletions,
  getPreviousWeekRanks, loadHallOfFame,
  syncAllTasksToPB, syncWeekDataToPB,
  archiveAndResetWeek, archiveWeekWinner, saveCurrentWeekRanksForNextWeek,
  archiveWeekIfMissing, loadWeeklyPrizes, saveWeeklyPrizes,
  readWeeklyPrizesStamp, writeWeeklyPrizesStamp,
  pickDefaultClaimMember, isSnatchable, isPendingApproval,
  completesWithoutPin, completesWithPendingApproval,
  tapCompletePending, sendBackPendingCompletion, approvePendingCompletion, resolveMemberName,
  mergeTasksSnapshot, getDaysUntilWeekReset,
  isCrewTask, crewMembers, crewMemberCount, crewFull, crewHasMember,
  crewMemberCheckedIn, crewCheckinProgress, crewAllCheckedIn, canJoinCrew,
  normalizeSpeedBonus,
} from "@/lib/task-utils";
import {
  readRewardsStamp, touchRewardsStamp, writeRewardsStamp,
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
  get today() { return todayISO(); },
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
    due: todayISO(),
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

// Competition-ranked point entries for a week (ties share a rank) — feeds the
// Hall of Fame winner record and the previous-week rank arrows.
function rankedEntriesFromWeek(week: WeekData, emojis: Record<string, string>): { name: string; emoji: string; points: number; rank: number }[] {
  const entries = Object.entries(week.points || {})
    .map(([name, points]) => ({ name, emoji: emojis[name] || "👤", points: points || 0, rank: 0 }))
    .filter((e) => e.points > 0)
    .sort((a, b) => b.points - a.points);
  let lastPoints = Number.NaN;
  let lastRank = 0;
  entries.forEach((e, i) => {
    if (e.points !== lastPoints) { lastRank = i + 1; lastPoints = e.points; }
    e.rank = lastRank;
  });
  return entries;
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

  useEffect(() => { saveTasks(tasks); }, [tasks]);
  useEffect(() => { saveWeekData(weekData); }, [weekData]);

  const [ranksVersion, setRanksVersion] = useState(0);

  useEffect(() => {
    if (!mounted) return;
    const interval = setInterval(() => {
      const current = weekKey();
      if (current !== weekData.weekStart) {
        // Record the finished week BEFORE resetting: archive it, enshrine the
        // top 3 with their weekly prizes in the Hall of Fame, and keep the
        // ranks for next week's movement arrows. (archiveAndResetWeek also
        // persists the archive + the fresh empty week, so the saveWeekData
        // effect can't clobber it.)
        const entries = rankedEntriesFromWeek(weekData, memberEmojis);
        if (entries.length) {
          archiveWeekWinner(entries, weekData.weekStart, loadWeeklyPrizes());
          saveCurrentWeekRanksForNextWeek(entries);
        }
        archiveAndResetWeek(weekData, current);
        setWeekData(emptyWeekData(current));
        setRanksVersion((v) => v + 1);
        setTasks(prev => {
          const regenerated = regenerateRecurringTasks(prev);
          saveTasks(regenerated);
          return regenerated;
        });
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [mounted, weekData, memberEmojis]);

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

  // Persist tasks + week data to PocketBase in the background (snapshot + structured)
  const syncPendingRef = useRef(false);
  const pbSyncPendingRef = useRef(false);
  const claimSnapshotRef = useRef<{ tasks: Task[]; weekData: WeekData } | null>(null);
  useEffect(() => {
    if (!mounted) return;
    if (syncPendingRef.current) return;
    syncPendingRef.current = true;
    const t = setTimeout(() => {
      fetch("/api/tasks/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The rewards catalog rides the snapshot WITH its last-write-wins
        // stamp (kid-store) so a Settings delete (newer stamp) is never
        // overwritten by a stale snapshot on the next restore. The weekly
        // prizes ride the same contract (task-utils stamp key).
        body: JSON.stringify({
          tasks, weekData, rewards, rewardsUpdatedAt: readRewardsStamp(),
          weeklyPrizes: loadWeeklyPrizes(), weeklyPrizesStamp: readWeeklyPrizesStamp(),
        }),
      })
        .then((res) => {
          if (!res.ok) console.warn(`Tasks snapshot sync failed (${res.status}) — will retry on next change`);
        })
        .catch(() => {});
      syncPendingRef.current = false;
    }, 2000);
    return () => { clearTimeout(t); syncPendingRef.current = false; };
  }, [tasks, weekData, rewards, mounted]);

  // Structured PB sync (individual collections)
  useEffect(() => {
    if (!mounted) return;
    if (pbSyncPendingRef.current) return;
    pbSyncPendingRef.current = true;
    const t = setTimeout(() => {
      syncAllTasksToPB(tasks, weekData, getArchivedWeeks(), rewards, penalties, loadHallOfFame(), loadWeeklyPrizes());
      pbSyncPendingRef.current = false;
    }, 5000);
    return () => { clearTimeout(t); pbSyncPendingRef.current = false; };
  }, [tasks, weekData, rewards, penalties, mounted]);

  // Restore tasks state from PocketBase snapshot on mount (bridges container restarts)
  const restoreAttempted = useRef(false);
  // True when the snapshot read 401'd — a signed-out browser can't read the
  // sessioned gateway, so an empty list here means "hidden", not "done".
  const [guestSyncBlocked, setGuestSyncBlocked] = useState(false);
  // Restore tasks state from a PocketBase snapshot (bridges container restarts
  // and merges another device's changes) via the SHARED pure merge — the same
  // guards the 60s refresh loop applies to the stores: adopt new tasks,
  // adopt field changes on known rows only with proof (pending tap / send-back
  // / richer week history), never clobber a fresh local tap. The old inline
  // version was ADD-ONLY on known rows, so a kid's tap on another device
  // never reached this page's Needs-approval queue (and an approval elsewhere
  // never cleared the stale "On the way" row here). The REWARDS leg is the
  // exception: "longer wins" is delete-blind (a parent's Settings delete is a
  // SHORTER, NEWER list), so rewards merge by last-write-wins on the
  // kid-store stamp — a stale snapshot can never resurrect a deleted reward.
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
    if (Array.isArray(snap.rewards)) {
      const snapStamp = typeof snap.rewardsUpdatedAt === "string" ? snap.rewardsUpdatedAt : "";
      if (snapStamp && snapStamp > readRewardsStamp()) {
        writeRewardsStamp(snapStamp);
        setRewards(snap.rewards);
      }
    }
    // Weekly prizes: same last-write-wins stamp contract as rewards — adopt a
    // strictly-NEWER snapshot's prizes and carry ITS stamp through verbatim
    // (writeWeeklyPrizesStamp, not a touch: re-stamping "now" would make a
    // no-op refresh block the next real server edit). Missing stamps or a
    // non-array prizes leg never win.
    if (
      typeof snap.weeklyPrizesStamp === "string" &&
      snap.weeklyPrizesStamp > readWeeklyPrizesStamp() &&
      Array.isArray(snap.weeklyPrizes)
    ) {
      saveWeeklyPrizes(snap.weeklyPrizes);
      writeWeeklyPrizesStamp(snap.weeklyPrizesStamp);
    }
    if (snap.penalties?.length) setPenalties((prev: any) => snap.penalties.length > prev.length ? snap.penalties : prev);
    const { tasks: nextTasks, weekData: nextWeek, tasksChanged, weekChanged } = mergeTasksSnapshot(
      tasksRef.current,
      weekDataRef.current,
      snap
    );
    if (tasksChanged) {
      tasksRef.current = nextTasks;
      setTasks(nextTasks);
    }
    if (weekChanged) {
      weekDataRef.current = nextWeek;
      setWeekData(nextWeek);
    }
  }, []);

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

  // Backfill the Hall of Fame + previous-week ranks for weeks that rolled over
  // while the page was closed (loadWeekData archives them on load, but the
  // winner/ranks were never recorded on that path). Idempotent: skips weeks
  // already enshrined.
  useEffect(() => {
    if (!mounted) return;
    const archive = getArchivedWeeks();
    const weeks = Object.keys(archive).sort();
    if (!weeks.length) return;
    const latest = weeks[weeks.length - 1];
    // Make sure the finished week lands in PB's week_archive (idempotent).
    // The reload path archives to localStorage only, so without this the
    // assistant's get_past_weeks never sees weeks that rolled over while the
    // page was closed. Fire-and-forget: a PB failure must not block the rest.
    void archiveWeekIfMissing(archive[latest]);
    if (loadHallOfFame().some((h) => h.weekStart === latest)) return;
    const entries = rankedEntriesFromWeek(archive[latest], memberEmojis);
    if (!entries.length) return;
    archiveWeekWinner(entries, latest, loadWeeklyPrizes());
    saveCurrentWeekRanksForNextWeek(entries);
    setRanksVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

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
      setTasks(prev => [...prev, { ...normalized, id: uid() }]);
    } else {
      setTasks(prev => prev.map(t => t.id === editingId ? { ...normalized } : t));
    }
    setEditingId(null);
    setIsAdding(false);
  };

  const deleteTask = (id: number) => {
    setTasks(prev => prev.filter(t => t.id !== id));
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
    setTasks(prev => [...prev, { ...suggestion, id: uid() }]);
    setAiSuggestions(prev => prev.filter(s => s.title !== suggestion.title));
  };

  const dismissSuggestion = (title: string) => {
    setAiSuggestions(prev => prev.filter(s => s.title !== title));
  };

  const openPinEntry = (taskId: number) => {
    const task = tasks.find((x) => x.id === taskId);
    if (!task) return;
    if (task.completed) {
      if (isPendingApproval(task) && isLoggedIn && currentUser?.role === "child" && resolveMemberName(membersData, task.pendingApproval?.byName) === resolveMemberName(membersData, currentUser.name)) {
        // The kid who tapped can take it back PIN-free: nothing was verified,
        // so there is nothing to un-verify. No points ever moved. Names are
        // compared in the resolved-ledger space — a session first name and a
        // fullName byName are the same kid.
        setTasks((prev) => sendBackPendingCompletion(prev, taskId));
        showToast("Back on the list — no points were given.");
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
      // assigned chore lands immediately as done-but-unpaid — no PIN round
      // trip. Points move only on parent approval. The pending record's
      // byName is the roster-resolved FULL name (the same ledger key the
      // classic PIN path credits) so approve posts the earn to the right
      // ledger entry instead of stranding points on a first-name key.
      if (task.completedInWeek === weekKey()) return;
      const now = new Date().toISOString();
      const me = resolveMemberName(membersData, currentUser!.name);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? tapCompletePending(t, me, now, weekKey()) : t)));
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
      if (approvalMode === "approve-all") {
        // One parent-PIN confirmation pays the WHOLE queue. Each row still
        // runs the same idempotent, reversal-aware approvePendingCompletion —
        // the per-member guards (taskId+member) make a double-tap safe, and a
        // row paid on another device simply clears without re-paying.
        const result = pendingApprovals.reduce(
          (acc, pending) => {
            const before = acc.weekData.history.length;
            const next = approvePendingCompletion(acc.tasks, acc.weekData, pending.id);
            return {
              tasks: next.tasks,
              weekData: next.weekData,
              paid: acc.paid + (next.weekData.history.length > before ? 1 : 0),
            };
          },
          { tasks, weekData, paid: 0 }
        );
        setTasks(result.tasks);
        setWeekData(result.weekData);
        showToast(result.paid > 0 ? `Approved! ${result.paid} tapped task${result.paid !== 1 ? "s" : ""} paid.` : "All tapped tasks were already paid.");
      } else if (approvalMode === "approve" && approvalTaskId !== null) {
        const target = tasks.find((x) => x.id === approvalTaskId);
        const { tasks: nt, weekData: nw } = approvePendingCompletion(tasks, weekData, approvalTaskId);
        setTasks(nt);
        setWeekData(nw);
        const crew = target?.pendingApproval?.crew;
        showToast(
          crew && crew.length > 0
            ? `Approved! +${target?.points ?? 0}pts each for ${crew.map((n) => n.split(" ")[0]).join(", ")}.`
            : `Approved! +${target?.points ?? 0}pts for ${(target?.pendingApproval?.byName ?? "").split(" ")[0]}.`
        );
      } else if (approvalTaskId !== null) {
        setTasks((prev) => sendBackPendingCompletion(prev, approvalTaskId));
        const target = tasks.find((x) => x.id === approvalTaskId);
        showToast(target && isCrewTask(target) ? "Sent back — the whole crew reopens, no points given." : "Sent back — no points were given.");
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
      const res = await fetch("/api/tasks/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "crew-remove",
          taskId: crewRemoveTarget.taskId,
          memberName: parent.fullName,
          pin: crewRemovePin,
          targetName: crewRemoveTarget.memberName,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data?.task) {
        const updated = data.task;
        setTasks(prev => prev.map(t => t.id === crewRemoveTarget.taskId ? { ...t, crew: updated.crew ?? t.crew } : t));
        showToast(`${crewRemoveTarget.memberName.split(" ")[0]} removed from the crew.`);
      } else if (res.status === 409) {
        setCrewRemoveError("They already checked in — can't remove.");
      } else {
        setCrewRemoveError("Couldn't remove them — try again.");
      }
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
      if (isPendingApproval(task)) {
        // PIN verified above, but pending taps hold no points — reopen with no
        // ledger entry instead of the standard points-reversing undo.
        setTasks((prev) => sendBackPendingCompletion(prev, task.id));
        setUndoTaskId(null);
        setUndoPin("");
        showToast("Sent back — no points were given.");
        // Server-authoritative reopen so other devices see it (guest-safe).
        fetch("/api/tasks/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "undo", taskId: task.id, memberName: normalizedName, pin: undoPin }),
        }).catch(() => {});
        return;
      }
      claimSnapshotRef.current = { tasks, weekData };
      setTasks(prev => prev.map(t => t.id === undoTaskId ? { ...t, completed: false, completedBy: undefined, completedAt: undefined, completedInWeek: undefined } : t));
      const current = (weekData.points[normalizedName] || 0) - task.points;
      const updated = { ...weekData, points: { ...weekData.points, [normalizedName]: Math.max(0, current) } };
      const nextWeek = addTransaction(updated, "adjust", -task.points, `Undo: ${task.title} (-${task.points}pts)`, normalizedName, task.id);
      setWeekData(nextWeek);
      // Push the reversal now (not on the 5s debounce) so the server-side claim
      // guard releases the task for re-claiming immediately.
      syncWeekDataToPB(nextWeek);
      // Server-authoritative undo too (week_data + snapshot + task row) — a
      // guest device's local undo must reach every device. Server refusals
      // (nothing_to_undo / already_undone) mean the local-only earn is already
      // reconciled; the local undo always stands.
      fetch("/api/tasks/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undo", taskId: task.id, memberName: normalizedName, pin: undoPin }),
      }).then(async (res) => {
        const data = await res.json().catch(() => null);
        claimSnapshotRef.current = null;
        if ((res.ok || res.status === 409) && data?.weekData?.weekStart === weekKey()) {
          setWeekData((prev) =>
            (data.weekData.history?.length || 0) >= (prev.history?.length || 0) ? data.weekData : prev
          );
        }
      }).catch(() => {
        // Offline: keep the local undo (sync reconciles later).
        claimSnapshotRef.current = null;
      });
      setUndoTaskId(null);
      setUndoPin("");
      showToast(`Undone: ${task.title}`);
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
        setWeekData(prev => {
          const current = prev.points[normalizedName] || 0;
          if (current < cost) return prev;
          const updated = { ...prev, points: { ...prev.points, [normalizedName]: current - cost } };
          return addTransaction(updated, "redeem", -cost, `Redeemed: ${pinReward.name} (-${cost}pts)`, normalizedName);
        });
        setPinInput("");
        setPinSuccess(`${pinReward.emoji} ${normalizedName.split(" ")[0]} redeemed ${pinReward.name}! -${cost}pts`);
        setTimeout(() => { setPinReward(null); setPinSuccess(""); }, 1500);
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
        setWeekData(prev => {
          const updated = { ...prev, points: { ...prev.points, [normalizedName]: Math.max(0, (prev.points[normalizedName] || 0) - penaltyPoints) } };
          return addTransaction(updated, "penalty", -penaltyPoints, `Penalty: ${pinPenalty.name} (-${penaltyPoints}pts)`, normalizedName);
        });
        setPinInput("");
        setPinSuccess(`-${penaltyPoints}pts from ${normalizedName.split(" ")[0]}`);
        setTimeout(() => { setPinPenalty(null); setPinSuccess(""); }, 1500);
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
        const verified = result.member;
        const normalizedName = normalizeName((verified as any).name);
        const claimantEmoji = membersData.find((m: any) => m.fullName === normalizedName)?.emoji;
        const res = await fetch("/api/tasks/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: crewAction.action,
            taskId: crewAction.taskId,
            memberName: normalizedName,
            pin: pinInput,
            assigneeEmoji: claimantEmoji,
          }),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.success && data?.task) {
          const updated = data.task;
          setTasks(prev => prev.map(x => x.id === crewAction.taskId ? {
            ...x,
            crew: updated.crew ?? null,
            completed: !!updated.completed,
            completedBy: updated.completedBy ?? x.completedBy,
            completedAt: updated.completedAt ?? x.completedAt,
            completedInWeek: updated.completedInWeek ?? x.completedInWeek,
            pendingApproval: updated.pendingApproval ?? x.pendingApproval,
          } : x));
          const joinedCount = Array.isArray(updated.crew?.members) ? updated.crew.members.length : 0;
          const first = normalizedName.split(" ")[0];
          setPinInput("");
          setPinSuccess(
            crewAction.action === "crew-join"
              ? `🤝 ${first} joined — ${joinedCount}/${updated.crewSize} on the crew.`
              : updated.pendingApproval
                ? `🎉 Crew all done! ${first} checked in — a parent approves next.`
                : `✓ ${first} checked in.`
          );
          if (updated.pendingApproval) triggerConfetti();
          setTimeout(() => { setPinTaskId(null); setPinCrewAction(null); setPinSuccess(""); setSnatchForMember(""); }, 1800);
        } else if (res.status === 409 && data?.reason === "crew_full") {
          setPinError("That crew just filled up — try another task.");
          setPinInput("");
          setTimeout(() => setPinError(""), 2500);
        } else if (res.status === 403 && data?.reason === "not_in_crew") {
          setPinError("You're not on this crew — join first.");
          setPinInput("");
          setTimeout(() => setPinError(""), 2500);
        } else if (res.status === 400 && data?.reason === "not_crew_task") {
          setPinError("This task isn't a crew task.");
          setPinInput("");
          setTimeout(() => setPinError(""), 2500);
        } else if (res.status === 401) {
          setPinError("PIN rejected by the server — try again.");
          setPinInput("");
          setTimeout(() => setPinError(""), 2000);
        } else {
          setPinError("Couldn't reach Consuela — try again.");
          setPinInput("");
          setTimeout(() => setPinError(""), 2500);
        }
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
    const now = new Date().toISOString();
    const currentWeek = weekKey();

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
        claimSnapshotRef.current = { tasks, weekData };
        // The kid branch is keyed on the CLAIMANT's role from the verified
        // record — the same record the server routes on — never on age
        // (claims are always PIN-gated) and never on the session user (a
        // parent claiming for a kid must mirror the server's pending answer).
        const kidClaim = (verified as any).role === "child";
        // Open ("up for grabs") first claims carry a speed bonus; the server
        // re-derives it authoritatively, but the optimistic UI must match.
        const speedBonus = !wasSnatch ? normalizeSpeedBonus(task.speedBonus) : 0;
        const earnAmount = task.points + speedBonus;
        const claimLabel = wasSnatch ? "Snatched" : speedBonus > 0 ? "Fast grab" : "Completed";
        setTasks(prev => prev.map(t => t.id === pinTaskId
          ? (kidClaim
            ? (() => {
                const pending = tapCompletePending({ ...t, assignee: normalizedName, assigneeEmoji: claimantEmoji }, normalizedName, now, currentWeek);
                return { ...pending, completedBy: normalizedName, pendingApproval: { ...pending.pendingApproval!, points: earnAmount } };
              })()
            : { ...t, completed: true, completedBy: normalizedName, completedAt: now, completedInWeek: currentWeek, assignee: normalizedName, assigneeEmoji: claimantEmoji })
          : t));
        const pointsMsg = earnAmount > 0 ? `+${earnAmount}pts` : "";
        if (!kidClaim) {
          setWeekData(prev => {
            const updated = { ...prev, points: { ...prev.points, [normalizedName]: (prev.points[normalizedName] || 0) + earnAmount } };
            return addTransaction(updated, "earn", earnAmount, `${claimLabel}: ${task.title}${pointsMsg ? ` (${pointsMsg})` : ""}`, normalizedName, task.id);
          });
        }
        setPinInput("");
        setPinSuccess(kidClaim
          ? `🎯 ${normalizedName.split(" ")[0]} — grabbed! +${earnAmount}pts on the way (parent approves).`
          : `🎯 ${normalizedName.split(" ")[0]} ${wasSnatch ? "snatched" : "completed"} ${task.title}! ${pointsMsg}`);
        triggerConfetti();
        setTimeout(() => { setPinTaskId(null); setPinSuccess(""); setSnatchForMember(""); }, 1500);

        // Server-authoritative claim: exactly one family member wins the race
        fetch("/api/tasks/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "claim",
            taskId: task.id,
            claimantName: normalizedName,
            claimantPin: pinInput,
            completedAt: now,
            title: task.title,
            points: task.points,
            assigneeEmoji: claimantEmoji,
          }),
        }).then(async (res) => {
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.success) {
            const snap = claimSnapshotRef.current;
            if (snap) {
              setTasks(snap.tasks);
              setWeekData(snap.weekData);
              claimSnapshotRef.current = null;
            }
            if (res.status === 409 && data?.claimedBy) {
              showToast(`🤝 ${data.claimedBy.split(" ")[0]} already grabbed that one!`);
            } else if (res.status === 409) {
              showToast("That task was already claimed.");
            } else if (res.status === 404) {
              showToast("Task isn't synced yet — try again in a few seconds.");
            } else if (res.status === 400) {
              showToast("That task isn't up for grabs.");
            } else if (res.status === 401) {
              showToast("PIN rejected by the server — try again.");
            } else {
              showToast("Claim failed — try again.");
            }
          } else if (data?.weekData?.weekStart === weekKey()) {
            // Server is authoritative for the week ledger: adopt its weekData
            // when it's at least as fresh as ours (picks up other devices).
            setWeekData((prev) =>
              (data.weekData.history?.length || 0) >= (prev.history?.length || 0) ? data.weekData : prev
            );
            claimSnapshotRef.current = null;
          } else if (data?.pending) {
            // Kid claim confirmed pending server-side (no weekData exists to
            // adopt — none was written) — the optimistic pending row stands.
            claimSnapshotRef.current = null;
          }
        }).catch(() => {
          // Offline: keep the optimistic claim (local sync will reconcile)
        });
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
      // Pre-state for rollback if the server definitively refuses (409/400).
      claimSnapshotRef.current = { tasks, weekData };
      // Shared server-persist response handling for the optimistic completion:
      // 409/400 = definitive refusal (another device completed it / wrong
      // shape) → roll back; anything else (401/5xx/network) is transient → keep
      // the optimistic row and let the normal syncs reconcile.
      const handleCompleteResponse = async (res: Response) => {
        const data = await res.json().catch(() => null);
        const snap = claimSnapshotRef.current;
        claimSnapshotRef.current = null;
        if (!res.ok || !data?.success) {
          if ((res.status === 409 || res.status === 400) && snap) {
            setTasks(snap.tasks);
            setWeekData(snap.weekData);
            showToast(res.status === 409 ? "That task was already completed." : "That task couldn't be completed.");
          }
          return;
        }
        // The server ledger is authoritative — adopt it when at least as
        // fresh (it may carry other devices' earns).
        if (data?.weekData?.weekStart === weekKey()) {
          setWeekData((prev) =>
            (data.weekData.history?.length || 0) >= (prev.history?.length || 0) ? data.weekData : prev
          );
        }
      };
      const persistServerComplete = () => {
        // A GUEST device (the kitchen display auto-logs-out after 30 min)
        // cannot push the snapshot — without this server call the completion
        // lives only in this browser's localStorage.
        fetch("/api/tasks/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "complete", taskId: task.id, memberName: normalizedName, pin: pinInput, assigneeEmoji: task.assigneeEmoji }),
        }).then(handleCompleteResponse).catch(() => { claimSnapshotRef.current = null; });
      };
      if (completesWithPendingApproval((verified as any).role, task)) {
        // Identity verified by PIN; the parent verifies the work. Points wait.
        setTasks((prev) => prev.map((t) => (t.id === pinTaskId ? tapCompletePending(t, normalizedName, now, currentWeek) : t)));
        triggerConfetti();
        setPinInput("");
        setPinSuccess(`⏳ ${normalizedName.split(" ")[0]} — done! +${task.points}pts on the way.`);
        setTimeout(() => { setPinTaskId(null); setPinSuccess(""); setSnatchForMember(""); }, 1500);
        persistServerComplete();
        return;
      }
      setTasks(prev => prev.map(t => t.id === pinTaskId ? { ...t, completed: true, completedBy: normalizedName, completedAt: now, completedInWeek: currentWeek } : t));
      const pointsMsg = task.points > 0 ? `+${task.points}pts` : "";
      setWeekData(prev => {
        const updated = { ...prev, points: { ...prev.points, [normalizedName]: (prev.points[normalizedName] || 0) + task.points } };
        return addTransaction(updated, "earn", task.points, `Completed: ${task.title}${pointsMsg ? ` (${pointsMsg})` : ""}`, normalizedName, task.id);
      });
      setPinInput("");
      setPinSuccess(`${normalizedName.split(" ")[0]} completed ${task.title}! ${pointsMsg}`);
      triggerConfetti();
      setTimeout(() => { setPinTaskId(null); setPinSuccess(""); setSnatchForMember(""); }, 1500);
      persistServerComplete();
    } else {
      setPinError(result.status === "unreachable" ? unreachableCopy() : "Wrong PIN. Try again.");
      setPinInput("");
      setTimeout(() => setPinError(""), 2000);
    }
    } finally {
      setPinBusy(false);
    }
  };

  const startAddReward = () => { setEditingRewardId(null); setAddingReward(true); setRewardForm({ id: Date.now(), name: "", emoji: "🎁", cost: 50 }); };
  const startEditReward = (r: Reward) => { setEditingRewardId(r.id); setAddingReward(false); setRewardForm({ ...r }); };
  const saveReward = () => {
    if (!rewardForm.name.trim()) return;
    if (addingReward) setRewards(prev => [...prev, { ...rewardForm, id: Date.now() }]);
    else setRewards(prev => prev.map(r => r.id === editingRewardId ? { ...rewardForm } : r));
    touchRewardsStamp();
    setEditingRewardId(null);
    setAddingReward(false);
  };
  const deleteReward = (id: number) => { setRewards(prev => prev.filter(r => r.id !== id)); touchRewardsStamp(); setEditingRewardId(null); };

  const startAddPenalty = () => { setEditingPenaltyId(null); setAddingPenalty(true); setPenaltyForm({ id: Date.now(), name: "", emoji: "⚠️", points: 10 }); };
  const startEditPenalty = (p: Penalty) => { setEditingPenaltyId(p.id); setAddingPenalty(false); setPenaltyForm({ ...p }); };
  const savePenalty = () => {
    if (!penaltyForm.name.trim()) return;
    if (addingPenalty) setPenalties(prev => [...prev, { ...penaltyForm, id: Date.now() }]);
    else setPenalties(prev => prev.map(p => p.id === editingPenaltyId ? { ...penaltyForm } : p));
    setEditingPenaltyId(null);
    setAddingPenalty(false);
  };
  const deletePenalty = (id: number) => { setPenalties(prev => prev.filter(p => p.id !== id)); setEditingPenaltyId(null); };

  const generateAiRewards = async () => {
    setAiRewardSuggesting(true);
    try {
      const res = await fetch('/api/hermes/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: "planner", intent: "reward_ideas" }),
      });
      const data = await res.json();
      // Priced from validated points — the old "Cost pts" detail regex is gone.
      const ideas = data.ok ? mapRewardIdeas(data.result?.actions) : [];
      if (ideas.length > 0) {
        setAiRewards(ideas);
      } else {
        showToast("Consuela couldn't come up with reward ideas right now — try again in a bit.");
      }
    } catch {
      showToast("Consuela couldn't come up with reward ideas right now — try again in a bit.");
    }
    setAiRewardSuggesting(false);
  };

  const adoptReward = (r: Reward) => {
    setRewards(prev => [...prev, { ...r, id: Date.now() }]);
    touchRewardsStamp();
    setAiRewards(prev => prev.filter(rr => rr.name !== r.name));
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
      setWeekData(prev => {
        const updated = { ...prev, points: { ...prev.points, [adjustMember]: Math.max(0, (prev.points[adjustMember] || 0) + change) } };
        const reason = adjustReason ? ` (${adjustReason})` : "";
        return addTransaction(updated, "adjust", change, `Manual adjust: ${change > 0 ? "+" : ""}${change}pts${reason}`, adjustMember, undefined, parent.fullName);
      });
      const label = adjustDir === "+" ? `+${delta}` : `-${delta}`;
      setAdjustSuccess(`${label} pts applied to ${adjustMember.split(" ")[0]}!`);
      setTimeout(() => { setAdjustMember(null); setAdjustSuccess(""); }, 1500);
    } finally {
      setPinBusy(false);
    }
  };

  const filtered = tasks.filter((t) => {
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

  const pending = filtered.filter((t) => !t.completed);
  const pendingApprovals = tasks.filter(isPendingApproval);
  // The Open board: unclaimed "up for grabs" tasks (universal or late-stealable)
  // PLUS crew tasks with space — shown only when the viewer isn't on a
  // specific-member filter, sorted by points (biggest race first). Plain
  // computation (no useMemo): a filter+sort over the family's small task list
  // is cheaper than the manual memo the compiler couldn't preserve.
  const openBoard = (() => {
    if (filterMember !== "All" && filterMember !== "My Tasks" && filterMember !== "Open") return [] as Task[];
    const me = isLoggedIn && currentUser ? resolveMemberName(membersData, currentUser.name) : "";
    return tasks
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
  const thisWeeksCompleted = getThisWeeksCompletedTasks(tasks);
  const thisWeeksCompletedCount = thisWeeksCompleted.length;

  // Hall of Fame drives the out-of-band 🥇 Weekly Champ badge on the entries.
  // Re-read when the week or the enshrinement version bumps (rollover path),
  // mirroring the previousRanks memo below.
  const hallOfFame = useMemo(() => loadHallOfFame(), [weekData, ranksVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const dynamicLeaderboard: LeaderboardEntry[] = useMemo(() => {
    const entries = membersData
      .filter((m: any) => m.role !== "pet")
      .map((m: any) => {
        const name = m.fullName;
        const weeklyPoints = weekData.points[name] || 0;
        const allTimePoints = getMemberAllTimePoints(name, weekData);
        const allTimeComps = getMemberAllTimeCompletions(name, tasks, weekData);
        // Streaks are per-member: filter this week's completion dates to this
        // member before walking back consecutive days.
        const streak = calculateRealStreak(name, weekData, getThisWeeksCompletedDates(tasks, name));
        const { level, title, emoji, progress } = getLevel(allTimePoints);
        const earnedBadges = BADGES.filter(b => b.condition(allTimePoints, streak, allTimeComps)).map(b => b.emoji);
        // Weekly Champ history is out-of-band (BADGES.week_champ condition
        // stays false): a rank-1 Hall of Fame entry earns the 🥇 career badge.
        if (hallOfFame.some(h => h.member === name && h.rank === 1) && !earnedBadges.includes("🥇")) {
          earnedBadges.push("🥇");
        }
        const currentMonday = weekData.weekStart;
        const completedInWeek = tasks.filter(
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
  }, [weekData, membersData, tasks, hallOfFame]);

  const topScorer = dynamicLeaderboard[0];
  const familyTotal = dynamicLeaderboard.reduce((sum, entry) => sum + entry.points, 0);
  const championShare = familyTotal > 0 ? topScorer.points / familyTotal : 0;
  const weeklyEarned = Object.values(weekData.points).reduce((a, b) => a + b, 0);
  const daysUntilReset = getDaysUntilWeekReset();

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
  const previousRanks = useMemo(() => getPreviousWeekRanks(), [weekData, ranksVersion]); // eslint-disable-line react-hooks/exhaustive-deps
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
    return tasks
      .filter(t => !t.completed && (t.assignee === currentUser.name || t.assignee.startsWith(currentUser.name) || t.universal))
      .sort((a, b) => a.points - b.points)
      .slice(0, 3);
  }, [tasks, isLoggedIn, currentUser]);

  const needsStreakSave = useMemo(() => {
    if (!isLoggedIn || !currentUser) return false;
    const myEntry = dynamicLeaderboard.find(e => e.name === currentUser.name || e.name.startsWith(currentUser.name));
    if (!myEntry || myEntry.streak < 2) return false;
    const today = todayISO();
    return !tasks.some(t => t.completed && t.completedBy === currentUser.name && t.completedAt && t.completedAt.split("T")[0] === today);
  }, [dynamicLeaderboard, tasks, isLoggedIn, currentUser]);

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
              const crews = tasks.filter((t) => isCrewTask(t) && !t.completed && !t.pendingApproval);
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
                        <Avatar name={task.assignee} color={memberColors[task.assignee] || "green"} emoji={task.assigneeEmoji} size="sm" variant="emoji" />
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
                      <Avatar name={task.assignee} color={memberColors[task.assignee] || "green"} emoji={isCrew ? "🤝" : task.assigneeEmoji} size="sm" variant="emoji" />
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
                            <Avatar name={task.assignee} color={memberColors[task.assignee] || "green"} emoji={task.assigneeEmoji} size="sm" variant="emoji" />
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
                          <Avatar name={task.assignee} color={memberColors[task.assignee] || "green"} emoji={task.assigneeEmoji} size="sm" variant="emoji" />
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
                        <Avatar name={suggestion.assignee} color={memberColors[suggestion.assignee] || "green"} emoji={suggestion.assigneeEmoji} size="sm" variant="emoji" />
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
              />
            )}

            {sheetEntry && (
              <MemberSheet
                open={!!sheetMember}
                entry={sheetEntry}
                hasWeeklyChamp={hallOfFame.some(h => h.member === sheetEntry.name && h.rank === 1)}
                allTimePoints={getMemberAllTimePoints(sheetEntry.name, weekData)}
                allTimeComps={getMemberAllTimeCompletions(sheetEntry.name, tasks, weekData)}
                weeklyPoints={sheetEntry.points}
                pendingTasks={tasks.filter(t => !t.completed && (t.assignee === sheetEntry.name || t.universal))}
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
                          completions={getMemberAllTimeCompletions(currentUser.name, tasks, weekData)}
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
                      <SoftButton size="sm" variant="secondary" onClick={() => openRewardPin(reward)}>Redeem</SoftButton>
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
              <input type="number" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none" />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <SoftButton variant={adjustDir === "+" ? "success" : "secondary"} onClick={() => setAdjustDir("+")}>Add points</SoftButton>
              <SoftButton variant={adjustDir === "-" ? "danger" : "secondary"} onClick={() => setAdjustDir("-")}>Remove points</SoftButton>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Reason</span>
              <input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none" placeholder="Why?" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Parent PIN</span>
              <input type="password" inputMode="numeric" maxLength={4} value={adjustPin} onChange={(e) => { setAdjustPin(e.target.value.replace(/[^0-9]/g, "")); setAdjustError(""); }} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-muted" placeholder="0000" />
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
