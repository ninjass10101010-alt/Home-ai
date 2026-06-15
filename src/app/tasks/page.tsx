/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity */
"use client";

import { useState, useEffect, useMemo } from "react";
import PageShell from "@/components/ui/PageShell";
import PageHeader from "@/components/patterns/PageHeader";
import SectionCard from "@/components/patterns/SectionCard";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import Chip from "@/components/ui/Chip";
import ListRow from "@/components/ui/ListRow";
import SwipeableRow from "@/components/ui/SwipeableRow";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Modal from "@/components/ui/Modal";
import Toast from "@/components/ui/Toast";
import SegmentedControl from "@/components/ui/SegmentedControl";
import Toggle from "@/components/ui/Toggle";
import StatTile from "@/components/patterns/StatTile";
import ProgressRing from "@/components/ui/ProgressRing";
import Avatar from "@/components/ui/Avatar";
import { db } from "@/db";
import { useAuth } from "@/hooks/useAuth";

interface Task {
  id: number;
  title: string;
  assignee: string;
  assigneeEmoji: string;
  due: string;
  points: number;
  recurring: string | null;
  category: string;
  completed: boolean;
  priority: "high" | "medium" | "low";
  completedBy?: string;
  universal?: boolean;
}

interface LeaderboardEntry {
  name: string;
  emoji: string;
  points: number;
  streak: number;
  rank: number;
}

interface Reward {
  id: number;
  name: string;
  emoji: string;
  cost: number;
}

interface Penalty {
  id: number;
  name: string;
  emoji: string;
  points: number;
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

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

function safeDisplayEmoji(emoji: any): string {
  return typeof emoji === "string" && emoji.startsWith("data:") ? "👤" : emoji || "👤";
}

function memberOptionLabel(member: any): string {
  return `${safeDisplayEmoji(member?.emoji)} ${member?.fullName || member?.name || "Member"}`;
}

const initialTasks: Task[] = [
  { id: 1, title: "Take out trash", assignee: "Caspian", assigneeEmoji: "🧒", due: getISO.today, points: 10, recurring: "Weekly · Thu", category: "Chores", completed: false, priority: "high" },
  { id: 2, title: "Grocery run", assignee: "Rebecca (Mom)", assigneeEmoji: "👩", due: getISO.today, points: 20, recurring: null, category: "Errands", completed: false, priority: "high" },
  { id: 3, title: "Load dishwasher", assignee: "Jasmine", assigneeEmoji: "👧", due: getISO.today, points: 8, recurring: "Daily", category: "Chores", completed: false, priority: "medium" },
  { id: 4, title: "Vacuum living room", assignee: "Caspian", assigneeEmoji: "🧒", due: getISO.tomorrow, points: 15, recurring: "Weekly", category: "Chores", completed: false, priority: "medium" },
  { id: 5, title: "Pay electric bill", assignee: "Jeffery (Dad)", assigneeEmoji: "👨", due: getISO.fri, points: 0, recurring: "Monthly", category: "Admin", completed: false, priority: "high" },
  { id: 6, title: "Clean bathroom", assignee: "Jasmine", assigneeEmoji: "👧", due: getISO.tomorrow, points: 15, recurring: "Weekly", category: "Chores", completed: false, priority: "medium" },
  { id: 7, title: "Walk Rocco", assignee: "Caspian", assigneeEmoji: "🧒", due: getISO.today, points: 12, recurring: "Daily", category: "Pets", completed: false, priority: "low" },
  { id: 8, title: "Book dentist appt", assignee: "Rebecca (Mom)", assigneeEmoji: "👩", due: getISO.thisWeek, points: 0, recurring: null, category: "Health", completed: false, priority: "medium" },
  { id: 9, title: "Car oil change", assignee: "Jeffery (Dad)", assigneeEmoji: "👨", due: getISO.sat, points: 0, recurring: null, category: "Errands", completed: false, priority: "low" },
  { id: 10, title: "Chew the bone", assignee: "Rocco", assigneeEmoji: "🐶", due: getISO.today, points: 5, recurring: "Daily", category: "Pets", completed: false, priority: "low" },
  { id: 11, title: "Grooming appointment", assignee: "Rico", assigneeEmoji: "🐩", due: getISO.tomorrow, points: 0, recurring: "Monthly", category: "Pets", completed: false, priority: "medium" },
];

const staticLeaderboard: LeaderboardEntry[] = [
  { name: "Caspian", emoji: "🧒", points: 145, streak: 5, rank: 1 },
  { name: "Emily", emoji: "👧", points: 120, streak: 3, rank: 2 },
  { name: "Rebecca (Mom)", emoji: "👩", points: 95, streak: 7, rank: 3 },
  { name: "Jeffery (Dad)", emoji: "👨", points: 60, streak: 2, rank: 4 },
];

const categories = ["Chores", "Errands", "Admin", "Health", "Pets", "School"];

function emptyTask(firstMember?: { name?: string; emoji?: string }): Task {
  return {
    id: Date.now(),
    title: "",
    assignee: firstMember?.name || "Caspian",
    assigneeEmoji: firstMember?.emoji || "🧒",
    due: todayISO(),
    points: 5,
    recurring: null,
    category: "Chores",
    completed: false,
    priority: "medium",
    universal: false,
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

function migratePointsKeys(points: Record<string, number>, members: any[]): Record<string, number> {
  const migrated: Record<string, number> = {};
  for (const [key, value] of Object.entries(points)) {
    const match = members.find((m: any) =>
      m.fullName === key || m.name === key || m.fullName.startsWith(key) || key.startsWith(m.name)
    );
    const canonicalKey = match ? match.fullName : key;
    migrated[canonicalKey] = (migrated[canonicalKey] || 0) + value;
  }
  return migrated;
}

const TASKS_STORAGE_KEY = "consuela-tasks";
const POINTS_STORAGE_KEY = "consuela-points";
const REWARDS_KEY = "consuela-rewards";
const PENALTIES_KEY = "consuela-penalties";

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

export default function TasksPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const membersData = useMemo(() => db.selectMembers(), []);
  const { currentUser, isLoggedIn } = useAuth();
  const allMembers = useMemo(() => {
    const names = membersData.map((m: any) => m.fullName);
    return isLoggedIn ? ["My Tasks", ...names] : ["All", ...names];
  }, [membersData, isLoggedIn]);

  const memberEmojis: Record<string, string> = useMemo(() => ({
    All: "👨‍👩‍👧‍👦",
    "My Tasks": currentUser?.emoji || "👤",
    ...Object.fromEntries(membersData.map((m: any) => [m.fullName, safeDisplayEmoji(m.emoji)]))
  }), [membersData, currentUser]);

  const memberColors: Record<string, string> = useMemo(() => {
    const colors = Object.fromEntries(membersData.map((m: any) => [m.fullName, m.color]));
    if (currentUser) colors["My Tasks"] = currentUser.color;
    return colors;
  }, [membersData, currentUser]);

  const [tasks, setTasks] = useState<Task[]>(() => {
    const loaded = loadFromStorage(TASKS_STORAGE_KEY, initialTasks);
    try {
      const members = db.selectMembers();
      return migrateAssigneeNames(loaded, members);
    } catch {
      return loaded;
    }
  });

  const [earnedPoints, setEarnedPoints] = useState<Record<string, number>>(() => {
    try {
      const members = db.selectMembers();
      const raw = loadFromStorage(POINTS_STORAGE_KEY, {});
      return migratePointsKeys(raw, members);
    } catch {
      return loadFromStorage(POINTS_STORAGE_KEY, {});
    }
  });

  useEffect(() => { localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks)); }, [tasks]);
  useEffect(() => { localStorage.setItem(POINTS_STORAGE_KEY, JSON.stringify(earnedPoints)); }, [earnedPoints]);

  const [filterMember, setFilterMember] = useState("All");
  useEffect(() => {
    if (isLoggedIn && filterMember === "All") setFilterMember("My Tasks");
  }, [isLoggedIn]);

  const [activeTab, setActiveTab] = useState<"tasks" | "leaderboard">("tasks");
  const [showCompleted, setShowCompleted] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Task>(emptyTask(membersData[0]));
  const [isAdding, setIsAdding] = useState(false);
  const [pinTaskId, setPinTaskId] = useState<number | null>(null);
  const [pinReward, setPinReward] = useState<Reward | null>(null);
  const [pinPenalty, setPinPenalty] = useState<Penalty | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinSuccess, setPinSuccess] = useState("");
  const [snatchForMember, setSnatchForMember] = useState("");
  const [redeemForMember, setRedeemForMember] = useState("");
  const [penaltyForMember, setPenaltyForMember] = useState("");
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [googleSyncing, setGoogleSyncing] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<Task[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [rewards, setRewards] = useState<Reward[]>(() => loadFromStorage(REWARDS_KEY, [
    { id: 1, name: "Movie pick", emoji: "🎬", cost: 50 },
    { id: 2, name: "Skip 1 chore", emoji: "🎟️", cost: 75 },
    { id: 3, name: "Extra screen time", emoji: "📱", cost: 100 },
    { id: 4, name: "Family outing", emoji: "🎡", cost: 200 },
  ]));
  const [editingRewardId, setEditingRewardId] = useState<number | null>(null);
  const [rewardForm, setRewardForm] = useState<Reward>({ id: 0, name: "", emoji: "🎁", cost: 50 });
  const [addingReward, setAddingReward] = useState(false);
  const [aiRewardSuggesting, setAiRewardSuggesting] = useState(false);
  const [aiRewards, setAiRewards] = useState<Reward[]>([]);
  const [penalties, setPenalties] = useState<Penalty[]>(() => loadFromStorage(PENALTIES_KEY, [
    { id: 1, name: "Missed chore", emoji: "🧹", points: 10 },
    { id: 2, name: "Left mess", emoji: "🗑️", points: 8 },
    { id: 3, name: "Forgot homework", emoji: "📚", points: 15 },
    { id: 4, name: "Late bedtime", emoji: "🌙", points: 5 },
  ]));
  const [editingPenaltyId, setEditingPenaltyId] = useState<number | null>(null);
  const [penaltyForm, setPenaltyForm] = useState<Penalty>({ id: 0, name: "", emoji: "⚠️", points: 10 });
  const [addingPenalty, setAddingPenalty] = useState(false);
  const [adjustMember, setAdjustMember] = useState<string | null>(null);
  const [adjustAmount, setAdjustAmount] = useState<string>("10");
  const [adjustDir, setAdjustDir] = useState<"+" | "-">("-");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustPin, setAdjustPin] = useState("");
  const [adjustError, setAdjustError] = useState("");
  const [adjustSuccess, setAdjustSuccess] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const startEdit = (task: Task) => {
    setEditingId(task.id);
    setEditForm({ ...task });
    setIsAdding(false);
  };

  const startAdd = () => {
    setEditingId(null);
    const defaultMember = isLoggedIn && currentUser
      ? { name: currentUser.name, emoji: currentUser.emoji }
      : { name: membersData[0]?.fullName || "Caspian", emoji: membersData[0]?.emoji || "🧒" };
    setEditForm(emptyTask(defaultMember));
    setIsAdding(true);
  };

  const cancelEdit = () => { setEditingId(null); setIsAdding(false); };

  let _idCounter = 0;
  const uid = () => Date.now() + ++_idCounter;

  const saveTask = () => {
    if (!editForm.title.trim()) return;
    if (isAdding) {
      setTasks(prev => [...prev, { ...editForm, id: uid() }]);
    } else {
      setTasks(prev => prev.map(t => t.id === editingId ? { ...editForm } : t));
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

  const generateAiTasks = async () => {
    setAiSuggesting(true);
    const familyList = membersData.filter((m: any) => m.role !== "pet").map((m: any) => `${m.name} (${(m as any).age || "?"}yo)`).join(", ");
    try {
      const res = await fetch('/api/hermes/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Suggest 4 age-appropriate chores for the Garcia family: ${familyList}. Adults can handle harder tasks (15-25pts). Kids get easier tasks based on their age (5-15pts). Return as JSON: {"actions":[{"type":"task","title":"...","detail":"AssigneeName · Xpts","emoji":"..."}]}. Make them varied (chores, pets, school, helping, errands).`
        }),
      });
      const data = await res.json();
      const actions = data.actions || [];
      const suggestions: Task[] = actions.filter((a: any) => a.type === "task").map((a: any) => {
        const assignee = a.detail?.split("·")?.[0]?.trim() || "Caspian";
        const points = parseInt(a.detail?.match(/(\d+)\s*pts?/)?.[1] || "8");
        const member = membersData.find((m: any) => m.fullName.startsWith(assignee) || m.name.startsWith(assignee) || assignee.startsWith(m.name));
        return {
          id: uid(),
          title: a.title,
          assignee: member?.fullName || assignee,
          assigneeEmoji: member?.emoji || "🧒",
          due: getISO.today,
          points,
          recurring: null,
          category: "AI Suggested",
          completed: false,
          priority: points >= 15 ? "high" : points >= 10 ? "medium" : "low",
        } as Task;
      });
      setAiSuggestions(suggestions.length > 0 ? suggestions : [
        { id: uid(), title: "Make your bed", assignee: "Caspian", assigneeEmoji: "🧒", due: getISO.today, points: 5, recurring: "Daily", category: "AI Suggested", completed: false, priority: "low" },
        { id: uid(), title: "Help set the table", assignee: "Aurora", assigneeEmoji: "👧", due: getISO.today, points: 8, recurring: "Daily", category: "AI Suggested", completed: false, priority: "medium" },
        { id: uid(), title: "Sweep the kitchen", assignee: "Jasmine", assigneeEmoji: "👧", due: getISO.today, points: 12, recurring: null, category: "AI Suggested", completed: false, priority: "medium" },
        { id: uid(), title: "Organize the pantry", assignee: "Bailey", assigneeEmoji: "👧", due: getISO.today, points: 15, recurring: "Weekly", category: "AI Suggested", completed: false, priority: "high" },
      ]);
    } catch {
      setAiSuggestions([
        { id: uid(), title: "Make your bed", assignee: "Caspian", assigneeEmoji: "🧒", due: getISO.today, points: 5, recurring: "Daily", category: "AI Suggested", completed: false, priority: "low" },
        { id: uid(), title: "Help set the table", assignee: "Aurora", assigneeEmoji: "👧", due: getISO.today, points: 8, recurring: "Daily", category: "AI Suggested", completed: false, priority: "medium" },
        { id: uid(), title: "Sweep the kitchen", assignee: "Jasmine", assigneeEmoji: "👧", due: getISO.today, points: 12, recurring: null, category: "AI Suggested", completed: false, priority: "medium" },
        { id: uid(), title: "Organize the pantry", assignee: "Bailey", assigneeEmoji: "👧", due: getISO.today, points: 15, recurring: "Weekly", category: "AI Suggested", completed: false, priority: "high" },
      ]);
    }
    setAiSuggesting(false);
  };

  const syncGoogleTasks = async () => {
    setGoogleSyncing(true);
    try {
      const res = await fetch("/api/google-calendar?type=task");
      const data = await res.json();
      if (data.events?.length) {
        const existing = [...tasks];
        for (const ge of data.events) {
          if (!existing.find(t => t.title === ge.title)) {
            existing.push({
              id: uid(),
              title: ge.title,
              assignee: "All",
              assigneeEmoji: "👨‍👩‍👧‍👧",
              due: getISO.today,
              points: 5,
              recurring: null,
              category: "Google Tasks",
              completed: false,
              priority: "medium",
            });
          }
        }
        setTasks(existing);
        showToast(`✅ Synced ${data.events.length} Google tasks`);
      } else {
        showToast("No Google tasks found");
      }
    } catch {
      showToast("Failed to sync Google tasks");
    }
    setGoogleSyncing(false);
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
    setPinTaskId(taskId);
    setPinReward(null);
    setPinPenalty(null);
    setPinInput("");
    setPinError("");
    setPinSuccess("");
    if (task?.universal) {
      const defaultSnatcher = membersData.find((m: any) => m.role !== "pet")?.fullName ?? task.assignee;
      setSnatchForMember(defaultSnatcher);
    } else {
      setSnatchForMember("");
    }
  };

  const openRewardPin = (reward: Reward, memberName?: string) => {
    setPinReward(reward);
    setPinTaskId(null);
    setPinPenalty(null);
    setPinInput("");
    setPinError("");
    setPinSuccess("");
    const defaultMember = memberName || (membersData.find((m: any) => m.role !== "pet")?.fullName ?? "");
    setRedeemForMember(defaultMember);
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

  const submitPin = () => {
    if (!pinInput) return;
    if (pinReward) {
      const memberName = redeemForMember;
      if (!memberName) {
        setPinError("Select who is redeeming the reward.");
        setPinInput("");
        setTimeout(() => setPinError(""), 2000);
        return;
      }
      const verified = db.verifyMemberPin(memberName, pinInput);
      if (verified) {
        const normalizedName = normalizeName((verified as any).name);
        const cost = pinReward.cost;
        setEarnedPoints(prev => {
          const current = prev[normalizedName] || 0;
          if (current < cost) return prev;
          return { ...prev, [normalizedName]: current - cost };
        });
        setPinSuccess(`🎁 ${normalizedName.split(" ")[0]} redeemed ${pinReward.name}! -${cost}pts`);
        setTimeout(() => { setPinReward(null); setPinSuccess(""); }, 1500);
      } else {
        setPinError("Wrong code for selected member. Try again.");
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
      const verified = db.verifyMemberPin(memberName, pinInput) || membersData.find((m: any) => m.role === "parent" && db.verifyMemberPin(m.fullName, pinInput));
      if (verified) {
        const normalizedName = membersData.find((m: any) => m.fullName === penaltyForMember)?.fullName || penaltyForMember;
        setEarnedPoints(prev => ({ ...prev, [normalizedName]: Math.max(0, (prev[normalizedName] || 0) - (pinPenalty?.points ?? 0)) }));
        setPinSuccess(`⚠️ −${pinPenalty?.points}pts from ${normalizedName.split(" ")[0]}`);
        setTimeout(() => { setPinPenalty(null); setPinSuccess(""); }, 1500);
      } else {
        setPinError("Wrong PIN. Try again.");
        setPinInput("");
        setTimeout(() => setPinError(""), 2000);
      }
      return;
    }

    if (pinTaskId === null) return;
    const task = tasks.find(t => t.id === pinTaskId);
    if (!task) return;
    if (task.universal) {
      const claimant = snatchForMember;
      if (!claimant) {
        setPinError("Select who is claiming this task.");
        setPinInput("");
        setTimeout(() => setPinError(""), 2000);
        return;
      }
      const verified = db.verifyMemberPin(claimant, pinInput);
      if (verified) {
        const normalizedName = normalizeName((verified as any).name);
        const claimantEmoji = (membersData.find((m: any) => m.fullName === normalizedName)?.emoji) || task.assigneeEmoji;
        setTasks(prev => prev.map(t => t.id === pinTaskId ? { ...t, completed: true, completedBy: normalizedName, assignee: normalizedName, assigneeEmoji: claimantEmoji } : t));
        setEarnedPoints(prev => ({ ...prev, [normalizedName]: (prev[normalizedName] || 0) + task.points }));
        setPinSuccess(`✅ +${task.points}pts to ${normalizedName.split(" ")[0]}!`);
        setTimeout(() => { setPinTaskId(null); setPinSuccess(""); setSnatchForMember(""); }, 1500);
      } else {
        setPinError("Wrong code for selected member. Try again.");
        setPinInput("");
        setTimeout(() => setPinError(""), 2000);
      }
      return;
    }

    const verified = db.verifyMemberPin(task.assignee, pinInput);
    if (verified) {
      const normalizedName = normalizeName((verified as any).name);
      setTasks(prev => prev.map(t => t.id === pinTaskId ? { ...t, completed: true, completedBy: normalizedName } : t));
      setEarnedPoints(prev => ({ ...prev, [normalizedName]: (prev[normalizedName] || 0) + task.points }));
      setPinSuccess(`✅ +${task.points}pts to ${normalizedName.split(" ")[0]}!`);
      setTimeout(() => { setPinTaskId(null); setPinSuccess(""); setSnatchForMember(""); }, 1500);
    } else {
      setPinError("Wrong PIN. Try again.");
      setPinInput("");
      setTimeout(() => setPinError(""), 2000);
    }
  };

  const startAddReward = () => { setEditingRewardId(null); setAddingReward(true); setRewardForm({ id: Date.now(), name: "", emoji: "🎁", cost: 50 }); };
  const startEditReward = (r: Reward) => { setEditingRewardId(r.id); setAddingReward(false); setRewardForm({ ...r }); };
  const saveReward = () => {
    if (!rewardForm.name.trim()) return;
    if (addingReward) setRewards(prev => [...prev, { ...rewardForm, id: Date.now() }]);
    else setRewards(prev => prev.map(r => r.id === editingRewardId ? { ...rewardForm } : r));
    setEditingRewardId(null);
    setAddingReward(false);
  };
  const deleteReward = (id: number) => { setRewards(prev => prev.filter(r => r.id !== id)); setEditingRewardId(null); };

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
        body: JSON.stringify({
          message: `Suggest 4 fun rewards for the Garcia family. Mix small (10-30pts), medium (40-75pts), and big (80-200pts) rewards. Return as JSON: {"actions":[{"type":"reward","title":"Reward Name","detail":"Cost pts","emoji":"🎁"}]}. Make them exciting for kids!`
        }),
      });
      const data = await res.json();
      const actions = data.actions || [];
      const ideas: Reward[] = actions.filter((a: any) => a.type === "reward" || a.type === "task").map((a: any, i: number) => ({
        id: Date.now() + i,
        name: a.title,
        emoji: a.emoji || "🎁",
        cost: parseInt(a.detail?.match(/(\d+)/)?.[1] || "50"),
      }));
      setAiRewards(ideas.length > 0 ? ideas : [
        { id: Date.now()+1, name: "Pick dessert", emoji: "🍰", cost: 25 },
        { id: Date.now()+2, name: "Stay up 30min late", emoji: "🌙", cost: 50 },
        { id: Date.now()+3, name: "Choose weekend activity", emoji: "🎯", cost: 100 },
        { id: Date.now()+4, name: "New video game", emoji: "🎮", cost: 200 },
      ]);
    } catch {
      setAiRewards([
        { id: Date.now()+1, name: "Pick dessert", emoji: "🍰", cost: 25 },
        { id: Date.now()+2, name: "Stay up 30min late", emoji: "🌙", cost: 50 },
        { id: Date.now()+3, name: "Choose weekend activity", emoji: "🎯", cost: 100 },
        { id: Date.now()+4, name: "New video game", emoji: "🎮", cost: 200 },
      ]);
    }
    setAiRewardSuggesting(false);
  };

  const adoptReward = (r: Reward) => {
    setRewards(prev => [...prev, { ...r, id: Date.now() }]);
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

  const submitAdjust = () => {
    if (!adjustMember || !adjustPin) return;
    const parent = membersData.find((m: any) => m.role === "parent" && db.verifyMemberPin(m.fullName, adjustPin));
    if (!parent) {
      setAdjustError("Parent PIN required. Try again.");
      setAdjustPin("");
      setTimeout(() => setAdjustError(""), 2500);
      return;
    }
    const delta = parseInt(adjustAmount) || 0;
    const change = adjustDir === "+" ? delta : -delta;
    setEarnedPoints(prev => ({ ...prev, [adjustMember]: Math.max(0, (prev[adjustMember] || 0) + change) }));
    const label = adjustDir === "+" ? `+${delta}` : `−${delta}`;
    setAdjustSuccess(`${label} pts applied to ${adjustMember.split(" ")[0]}!`);
    setTimeout(() => { setAdjustMember(null); setAdjustSuccess(""); }, 1500);
  };

  const filtered = tasks.filter((t) => {
    if (filterMember === "My Tasks" && currentUser) {
      return t.assignee === currentUser.name && (showCompleted ? true : !t.completed);
    }
    const memberMatch = filterMember === "All" || t.assignee === filterMember;
    const completedMatch = showCompleted ? true : !t.completed;
    return memberMatch && completedMatch;
  });

  const pending = filtered.filter((t) => !t.completed);
  const completed = filtered.filter((t) => t.completed);
  const completedTotal = tasks.filter((t) => t.completed).length;

  const dynamicLeaderboard: LeaderboardEntry[] = useMemo(() => {
    const entries = membersData
      .filter((m: any) => m.role !== "pet")
      .map((m: any) => ({
        name: m.fullName,
        emoji: m.emoji,
        points: earnedPoints[m.fullName] || 0,
        streak: 0,
        rank: 0,
      }))
      .sort((a: any, b: any) => b.points - a.points);
    if (entries.every((e: any) => e.points === 0)) return staticLeaderboard;
    return entries.map((e: any, i: number) => ({ ...e, rank: i + 1, streak: Math.floor(e.points / 10) }));
  }, [earnedPoints, membersData]);

  const topScorer = dynamicLeaderboard[0];
  const familyTotal = dynamicLeaderboard.reduce((sum, entry) => sum + entry.points, 0);
  const championShare = familyTotal > 0 ? topScorer.points / familyTotal : 0;

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
      <Toast open={Boolean(toast)} tone={toast?.includes("Failed") ? "error" : "success"}>{toast}</Toast>

      <PageHeader
        title="Tasks"
        subtitle={`${pending.length} pending`}
        action={
          <IconButton aria-label="Add task" onClick={startAdd}>
            <span>＋</span>
          </IconButton>
        }
        icon="✅"
      />

      <div className="px-4 space-y-5 pb-8">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Pending" value={pending.length} detail="Open tasks" icon="📋" tone="warning" />
          <StatTile label="Completed" value={completedTotal} detail="Done this week" icon="🎉" tone="success" />
          <StatTile label="Earned" value={Object.values(earnedPoints).reduce((a, b) => a + b, 0)} detail="Family points" icon="🏆" tone="accent" />
        </div>

        <SegmentedControl
          aria-label="Tasks view"
          value={activeTab}
          onChange={(value) => setActiveTab(value as "tasks" | "leaderboard")}
          options={[
            { id: "tasks", label: "Tasks" },
            { id: "leaderboard", label: "Leaderboard" },
          ]}
        />

        {activeTab === "tasks" && (
          <>
              <div className="snap-x snap-mandatory overscroll-contain overflow-x-auto pb-2">
                {allMembers.map((member) => (
                  <Chip
                    key={member}
                    tone="neutral"
                    selected={filterMember === member}
                    onClick={() => setFilterMember(member)}
                    className="shrink-0 snap-start"
                  >
                  <span>{memberEmojis[member]}</span>
                  <span>{member.split(" ")[0]}</span>
                </Chip>
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
                    {!isAdding && <SoftButton variant="danger" onClick={() => deleteTask(editForm.id)} className="flex-1">Delete</SoftButton>}
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
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Assignee</span>
                      <select value={editForm.assignee} onChange={(e) => updateForm("assignee", e.target.value)} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none">
                        {membersData.map((m: any) => <option key={m.fullName} value={m.fullName}>{memberOptionLabel(m)}</option>)}
                      </select>
                    </label>
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
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Points</span>
                      <input type="number" value={editForm.points} onChange={(e) => updateForm("points", parseInt(e.target.value) || 0)} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none" />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Recurring</span>
                      <input value={editForm.recurring || ""} onChange={(e) => updateForm("recurring", e.target.value || null)} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none" placeholder="Daily" />
                    </label>
                  </div>
                  <Toggle checked={!!editForm.universal} onCheckedChange={(checked) => updateForm("universal", checked)} label="Universal task" description="Any member can claim it." />
                </div>
              </Modal>
            )}

            <SectionCard title="Consuela suggests" description="Fresh ideas for the family." icon="✨">
              <div className="flex gap-2">
                <SoftButton variant="secondary" onClick={generateAiTasks} disabled={aiSuggesting} className="flex-1">{aiSuggesting ? "Thinking..." : "Generate"}</SoftButton>
                <SoftButton variant="ghost" onClick={syncGoogleTasks} disabled={googleSyncing} className="flex-1">{googleSyncing ? "Syncing..." : "Google"}</SoftButton>
              </div>
              {aiSuggestions.length > 0 ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {aiSuggestions.map((suggestion) => (
                    <Surface key={suggestion.title} variant="glass-subtle" radius="xl" padding="sm">
                      <div className="flex items-start gap-3">
                        <span className="text-xl">{suggestion.assigneeEmoji}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-text-primary">{suggestion.title}</div>
                          <div className="mt-1 text-xs text-text-muted">{suggestion.assignee} · +{suggestion.points}pts</div>
                        </div>
                        <div className="flex gap-1">
                          <SoftButton size="sm" onClick={() => adoptSuggestion(suggestion)}>Add</SoftButton>
                          <IconButton size="sm" variant="ghost" aria-label="Dismiss" onClick={() => dismissSuggestion(suggestion.title)}>×</IconButton>
                        </div>
                      </div>
                    </Surface>
                  ))}
                </div>
              ) : (
                <EmptyState title="No suggestions yet" description="Generate AI ideas or sync Google Tasks to fill this space." icon="🤖" />
              )}
            </SectionCard>

            <SectionCard title="Pending" description={`${pending.length} open tasks`} icon="📋">
              {pending.length === 0 ? (
                <EmptyState title="All caught up" description="No pending tasks right now." icon="🎉" />
              ) : (
                <div className="space-y-2">
                  {pending.map((task) => (
                    <SwipeableRow key={task.id} leftAction={<span className="text-sm font-bold">✓</span>} rightAction={<span className="text-sm font-bold">×</span>} onSwipeRight={() => openPinEntry(task.id)} onSwipeLeft={() => startEdit(task)}>
                      <ListRow
                        title={task.title}
                        subtitle={`${task.assignee.split(" ")[0]} · ${formatDueLabel(task.due)} · ${task.category}`}
                        leftRailColor={task.priority === "high" ? "var(--color-accent-rose)" : task.priority === "medium" ? "var(--color-accent-amber)" : "var(--color-accent-mint)"}
                        leading={<Avatar name={task.assignee} color={memberColors[task.assignee] || "green"} emoji={task.assigneeEmoji} size="sm" variant="emoji" />}
                        trailing={<Chip size="sm" tone={task.priority === "high" ? "danger" : task.priority === "medium" ? "warning" : "success"}>+{task.points}pts</Chip>}
                        onClick={() => openPinEntry(task.id)}
                      />
                    </SwipeableRow>
                  ))}
                </div>
              )}
            </SectionCard>

            {completedTotal > 0 && (
              <SectionCard title="Completed" description={`${completedTotal} done tasks`} icon="✅">
                <button type="button" onClick={() => setShowCompleted(!showCompleted)} className="mb-3 flex w-full items-center justify-between text-sm font-semibold text-text-secondary">
                  <span>{showCompleted ? "Hide completed" : "Show completed"}</span>
                  <span>{showCompleted ? "↑" : "↓"}</span>
                </button>
                {showCompleted && (
                  <div className="space-y-2">
                    {completed.map((task) => (
                      <ListRow
                        key={task.id}
                        title={task.title}
                        subtitle={`${task.assignee.split(" ")[0]} · ${formatDueLabel(task.due)}`}
                        leftRailColor="var(--color-accent-mint)"
                        leading={<Avatar name={task.assignee} color={memberColors[task.assignee] || "green"} emoji={task.assigneeEmoji} size="sm" variant="emoji" />}
                        trailing={<Chip size="sm" tone="success">Done</Chip>}
                      />
                    ))}
                  </div>
                )}
              </SectionCard>
            )}
          </>
        )}

        {activeTab === "leaderboard" && (
          <>
            <Surface variant="warm" radius="2xl" padding="lg" glow>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">This week&apos;s champion</p>
                  <h3 className="mt-1 text-xl font-bold text-text-primary">{topScorer.name.split(" ")[0]}</h3>
                  <p className="mt-1 text-sm text-text-secondary">{topScorer.points} pts · {topScorer.streak} day streak 🔥</p>
                </div>
                <Avatar name={topScorer.name} color="green" emoji={topScorer.emoji} size="lg" variant="emoji" glow />
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <ProgressRing value={championShare} max={1} label="Champion share" detail={`${topScorer.name.split(" ")[0]} leads`} />
                <StatTile label="Rewards" value={rewards.length} detail="Available" icon="🎁" tone="accent" />
                <StatTile label="Penalties" value={penalties.length} detail="Configured" icon="⚠️" tone="warning" />
              </div>
            </Surface>

            <SectionCard title="Leaderboard" description="Family points and streaks" icon="🏆">
              <div className="space-y-3">
                {dynamicLeaderboard.map((entry, index) => (
                  <Surface key={entry.name} variant="glass-subtle" radius="xl" padding="sm">
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--color-accent-selected)]/15 text-sm font-bold text-[var(--color-accent-selected)]">#{index + 1}</div>
                      <Avatar name={entry.name} color="green" emoji={entry.emoji} size="sm" variant="emoji" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-text-primary">{entry.name.split(" ")[0]}</div>
                        <div className="text-xs text-text-muted">{entry.streak} day streak</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold text-text-primary display-numeral">{entry.points}</div>
                        <div className="text-[11px] text-text-muted">pts</div>
                      </div>
                      <IconButton size="sm" variant="ghost" aria-label="Adjust points" onClick={() => openAdjust(entry.name)}>⚙️</IconButton>
                    </div>
                  </Surface>
                ))}
              </div>
            </SectionCard>

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
                        <div className="text-xs text-text-muted">{reward.cost} pts</div>
                      </div>
                      <SoftButton size="sm" variant="secondary" onClick={() => openRewardPin(reward)}>Redeem</SoftButton>
                      <IconButton size="sm" variant="ghost" aria-label="Edit reward" onClick={() => startEditReward(reward)}>✎</IconButton>
                    </div>
                  </Surface>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Penalties" description="Point deductions for missed chores." icon="⚠️">
              <div className="flex gap-2">
                <SoftButton variant="secondary" onClick={startAddPenalty} className="flex-1">Add</SoftButton>
                <SoftButton variant="ghost" onClick={() => {}} className="flex-1">Help</SoftButton>
              </div>
              <div className="mt-4 space-y-3">
                {penalties.map((penalty) => (
                  <Surface key={penalty.id} variant="glass-subtle" radius="xl" padding="sm">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{penalty.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-text-primary">{penalty.name}</div>
                        <div className="text-xs text-text-muted">−{penalty.points} pts</div>
                      </div>
                      <IconButton size="sm" variant="ghost" aria-label="Apply penalty" onClick={() => openPenaltyPin(penalty)}>⚠️</IconButton>
                      <IconButton size="sm" variant="ghost" aria-label="Edit penalty" onClick={() => startEditPenalty(penalty)}>✎</IconButton>
                    </div>
                  </Surface>
                ))}
              </div>
            </SectionCard>
          </>
        )}
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
              ? `Apply "${pinPenalty.name}" penalty (−${pinPenalty.points}pts)`
              : `Complete "${tasks.find(t => t.id === pinTaskId)?.title}"`
          }
          footer={
            <>
              <SoftButton onClick={submitPin} disabled={pinInput.length < 4} className="flex-1">{pinPenalty ? "Deduct" : "Submit"}</SoftButton>
              <SoftButton variant="secondary" onClick={() => { setPinTaskId(null); setPinReward(null); setPinPenalty(null); }} className="flex-1">Cancel</SoftButton>
            </>
          }
        >
          <div className="space-y-4">
            {!pinReward && tasks.find((t) => t.id === pinTaskId)?.universal && (
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
              autoFocus
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-4 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-muted"
            />
            {pinError && <p className="text-center text-sm text-rose-300">{pinError}</p>}
            {pinSuccess && <p className="text-center text-sm text-[var(--color-accent-selected)]">{pinSuccess}</p>}
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
              <SoftButton onClick={submitAdjust} disabled={!adjustPin} className="flex-1">Apply</SoftButton>
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
            {adjustError && <p className="text-center text-sm text-rose-300">{adjustError}</p>}
            {adjustSuccess && <p className="text-center text-sm text-[var(--color-accent-selected)]">{adjustSuccess}</p>}
          </div>
        </Modal>
      )}
    </PageShell>
  );
}
