"use client";

import { useState, useEffect, useMemo } from "react";
import PageShell from "@/components/ui/PageShell";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Avatar from "@/components/ui/Avatar";
import AnimatedEmoji from "@/components/ui/AnimatedEmoji";
import { db } from "@/db";

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
  universal?: boolean; // if true: anyone can claim; points go to the claimant
}

interface LeaderboardEntry {
  name: string;
  emoji: string;
  points: number;
  streak: number;
  rank: number;
}

const initialTasks: Task[] = [
  { id: 1, title: "Take out trash", assignee: "Caspian", assigneeEmoji: "🧒", due: "Today", points: 10, recurring: "Weekly · Thu", category: "Chores", completed: false, priority: "high" },
  { id: 2, title: "Grocery run", assignee: "Rebecca (Mom)", assigneeEmoji: "👩", due: "Today", points: 20, recurring: null, category: "Errands", completed: false, priority: "high" },
  { id: 3, title: "Load dishwasher", assignee: "Jasmine", assigneeEmoji: "👧", due: "Today", points: 8, recurring: "Daily", category: "Chores", completed: false, priority: "medium" },
  { id: 4, title: "Vacuum living room", assignee: "Caspian", assigneeEmoji: "🧒", due: "Tomorrow", points: 15, recurring: "Weekly", category: "Chores", completed: false, priority: "medium" },
  { id: 5, title: "Pay electric bill", assignee: "Jeffery (Dad)", assigneeEmoji: "👨", due: "Fri", points: 0, recurring: "Monthly", category: "Admin", completed: false, priority: "high" },
  { id: 6, title: "Clean bathroom", assignee: "Jasmine", assigneeEmoji: "👧", due: "Tomorrow", points: 15, recurring: "Weekly", category: "Chores", completed: false, priority: "medium" },
  { id: 7, title: "Walk Rocco", assignee: "Caspian", assigneeEmoji: "🧒", due: "Today", points: 12, recurring: "Daily", category: "Pets", completed: false, priority: "low" },
  { id: 8, title: "Book dentist appt", assignee: "Rebecca (Mom)", assigneeEmoji: "👩", due: "This week", points: 0, recurring: null, category: "Health", completed: false, priority: "medium" },
  { id: 9, title: "Car oil change", assignee: "Jeffery (Dad)", assigneeEmoji: "👨", due: "Sat", points: 0, recurring: null, category: "Errands", completed: false, priority: "low" },
  { id: 10, title: "Chew the bone", assignee: "Rocco", assigneeEmoji: "🐶", due: "Today", points: 5, recurring: "Daily", category: "Pets", completed: false, priority: "low" },
  { id: 11, title: "Grooming appointment", assignee: "Rico", assigneeEmoji: "🐩", due: "Tomorrow", points: 0, recurring: "Monthly", category: "Pets", completed: false, priority: "medium" },
];

const staticLeaderboard: LeaderboardEntry[] = [
  { name: "Caspian", emoji: "🧒", points: 145, streak: 5, rank: 1 },
  { name: "Emily", emoji: "👧", points: 120, streak: 3, rank: 2 },
  { name: "Rebecca (Mom)", emoji: "👩", points: 95, streak: 7, rank: 3 },
  { name: "Jeffery (Dad)", emoji: "👨", points: 60, streak: 2, rank: 4 },
];

const priorityColors: Record<string, string> = { high: "bg-rose-500", medium: "bg-amber-500", low: "bg-surface-4" };
const categories = ["Chores", "Errands", "Admin", "Health", "Pets", "School"];
const dueOptions = ["Today", "Tomorrow", "This week", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed", "Thu"];

function emptyTask(firstMember?: { name?: string; emoji?: string }): Task {
  return {
    id: Date.now(),
    title: "",
    assignee: firstMember?.name || "Caspian",
    assigneeEmoji: firstMember?.emoji || "🧒",
    due: "Today",
    points: 5,
    recurring: null,
    category: "Chores",
    completed: false,
    priority: "medium" as const,
    universal: false,
  };
}

const TASKS_STORAGE_KEY = "consuela-tasks";
const POINTS_STORAGE_KEY = "consuela-points";

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { const stored = localStorage.getItem(key); return stored ? JSON.parse(stored) : fallback; } catch { return fallback; }
}

export default function TasksPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const membersData = useMemo(() => db.selectMembers(), []);
  const allMembers = useMemo(() => ["All", ...membersData.map((m: any) => m.name)], [membersData]);
  const memberEmojis: Record<string, string> = useMemo(() => ({
    All: "👨‍👩‍👧‍👦",
    ...Object.fromEntries(membersData.map((m: any) => [m.name, m.emoji]))
  }), [membersData]);
  const memberColors: Record<string, string> = useMemo(() => 
    Object.fromEntries(membersData.map((m: any) => [m.name, m.color]))
  , [membersData]);

  const [tasks, setTasks] = useState<Task[]>(() => loadFromStorage(TASKS_STORAGE_KEY, initialTasks));
  const [earnedPoints, setEarnedPoints] = useState<Record<string, number>>(() => loadFromStorage(POINTS_STORAGE_KEY, {}));

  useEffect(() => { localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks)); }, [tasks]);
  useEffect(() => { localStorage.setItem(POINTS_STORAGE_KEY, JSON.stringify(earnedPoints)); }, [earnedPoints]);

  const [filterMember, setFilterMember] = useState("All");
  const [activeTab, setActiveTab] = useState<"tasks" | "leaderboard">("tasks");
  const [showCompleted, setShowCompleted] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Task>(emptyTask(membersData[0]));
  const [isAdding, setIsAdding] = useState(false);

  // PIN completion state
  const [pinTaskId, setPinTaskId] = useState<number | null>(null);
  const [snatchForMember, setSnatchForMember] = useState<string>(""); // universal claim target
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinSuccess, setPinSuccess] = useState("");

  // AI suggestions state
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [googleSyncing, setGoogleSyncing] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<Task[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  // Rewards state
  interface Reward {
    id: number;
    name: string;
    emoji: string;
    cost: number;
  }
  const REWARDS_KEY = "consuela-rewards";
  const defaultRewards: Reward[] = [
    { id: 1, name: "Movie pick", emoji: "🎬", cost: 50 },
    { id: 2, name: "Skip 1 chore", emoji: "🎟️", cost: 75 },
    { id: 3, name: "Extra screen time", emoji: "📱", cost: 100 },
    { id: 4, name: "Family outing", emoji: "🎡", cost: 200 },
  ];
  const [rewards, setRewards] = useState<Reward[]>(() => loadFromStorage(REWARDS_KEY, defaultRewards));
  useEffect(() => { localStorage.setItem(REWARDS_KEY, JSON.stringify(rewards)); }, [rewards]);

  // Reward editing
  const [editingRewardId, setEditingRewardId] = useState<number | null>(null);
  const [rewardForm, setRewardForm] = useState<Reward>({ id: 0, name: "", emoji: "🎁", cost: 50 });
  const [addingReward, setAddingReward] = useState(false);
  const [aiRewardSuggesting, setAiRewardSuggesting] = useState(false);
  const [aiRewards, setAiRewards] = useState<Reward[]>([]);

  // ─── Penalties (point deductions) ───────────────────────
  interface Penalty {
    id: number;
    name: string;
    emoji: string;
    points: number; // positive number = how many pts to deduct
  }
  const PENALTIES_KEY = "consuela-penalties";
  const defaultPenalties: Penalty[] = [
    { id: 1, name: "Missed chore", emoji: "🧹", points: 10 },
    { id: 2, name: "Left mess", emoji: "🗑️", points: 8 },
    { id: 3, name: "Forgot homework", emoji: "📚", points: 15 },
    { id: 4, name: "Late bedtime", emoji: "🌙", points: 5 },
    { id: 5, name: "Rude behavior", emoji: "😤", points: 20 },
  ];
  const [penalties, setPenalties] = useState<Penalty[]>(() => loadFromStorage(PENALTIES_KEY, defaultPenalties));
  useEffect(() => { localStorage.setItem(PENALTIES_KEY, JSON.stringify(penalties)); }, [penalties]);

  const [editingPenaltyId, setEditingPenaltyId] = useState<number | null>(null);
  const [penaltyForm, setPenaltyForm] = useState<Penalty>({ id: 0, name: "", emoji: "⚠️", points: 10 });
  const [addingPenalty, setAddingPenalty] = useState(false);

  const startEditPenalty = (p: Penalty) => { setEditingPenaltyId(p.id); setAddingPenalty(false); setPenaltyForm({ ...p }); };
  const startAddPenalty = () => { setEditingPenaltyId(null); setAddingPenalty(true); setPenaltyForm({ id: Date.now(), name: "", emoji: "⚠️", points: 10 }); };
  const savePenalty = () => {
    if (!penaltyForm.name.trim()) return;
    if (addingPenalty) setPenalties(prev => [...prev, { ...penaltyForm, id: Date.now() }]);
    else setPenalties(prev => prev.map(p => p.id === editingPenaltyId ? { ...penaltyForm } : p));
    setEditingPenaltyId(null); setAddingPenalty(false);
  };
  const deletePenalty = (id: number) => { setPenalties(prev => prev.filter(p => p.id !== id)); setEditingPenaltyId(null); };

  // PIN state for applying a penalty
  const [pinPenalty, setPinPenalty] = useState<Penalty | null>(null);
  const [penaltyForMember, setPenaltyForMember] = useState<string>("");

  const openPenaltyPin = (penalty: Penalty) => {
    setPinPenalty(penalty);
    setPinTaskId(null); setPinReward(null);
    setPinInput(""); setPinError(""); setPinSuccess("");
    const defaultMember = membersData.find((m: any) => m.role !== "pet")?.name ?? "";
    setPenaltyForMember(defaultMember);
  };

  // ─── Manual Point Adjust ─────────────────────────────────
  const [adjustMember, setAdjustMember] = useState<string | null>(null);
  const [adjustAmount, setAdjustAmount] = useState<string>("10");
  const [adjustDir, setAdjustDir] = useState<"+" | "-">("-");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustPin, setAdjustPin] = useState("");
  const [adjustError, setAdjustError] = useState("");
  const [adjustSuccess, setAdjustSuccess] = useState("");

  const openAdjust = (name: string) => {
    setAdjustMember(name); setAdjustAmount("10"); setAdjustDir("-"); setAdjustReason("");
    setAdjustPin(""); setAdjustError(""); setAdjustSuccess("");
  };

  const submitAdjust = () => {
    if (!adjustMember || !adjustPin) return;
    // Any parent can authorize manual adjustments
    const parent = membersData.find((m: any) => m.role === "parent" && db.verifyMemberPin(m.name, adjustPin));
    if (!parent) {
      setAdjustError("Parent PIN required. Try again.");
      setAdjustPin("");
      setTimeout(() => setAdjustError(""), 2500);
      return;
    }
    const delta = parseInt(adjustAmount) || 0;
    const change = adjustDir === "+" ? delta : -delta;
    setEarnedPoints(prev => ({ ...prev, [adjustMember]: Math.max(0, (prev[adjustMember] || 0) + change) }));
    const label = adjustDir === "+" ? `+${delta}` : `-${delta}`;
    setAdjustSuccess(`${label} pts applied to ${adjustMember.split(" ")[0]}!`);
    setTimeout(() => { setAdjustMember(null); setAdjustSuccess(""); }, 1500);
  };

  const startEditReward = (r: Reward) => {
    setEditingRewardId(r.id); setAddingReward(false);
    setRewardForm({ ...r });
  };
  const startAddReward = () => {
    setEditingRewardId(null); setAddingReward(true);
    setRewardForm({ id: Date.now(), name: "", emoji: "🎁", cost: 50 });
  };
  const saveReward = () => {
    if (!rewardForm.name.trim()) return;
    if (addingReward) {
      setRewards(prev => [...prev, { ...rewardForm, id: Date.now() }]);
    } else {
      setRewards(prev => prev.map(r => r.id === editingRewardId ? { ...rewardForm } : r));
    }
    setEditingRewardId(null); setAddingReward(false);
  };
  const deleteReward = (id: number) => {
    setRewards(prev => prev.filter(r => r.id !== id));
    setEditingRewardId(null);
  };

  // AI Reward Suggestions
  const generateAiRewards = async () => {
    setAiRewardSuggesting(true);
    try {
      const familyList = membersData
        .filter((m: any) => m.role !== "pet")
        .map((m: any) => `${m.name} (${(m as any).age || "?"}yo)`)
        .join(", ");
      const res = await fetch('/api/hermes/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Suggest 4 fun rewards for the Garcia family: ${familyList}. Mix small (10-30pts), medium (40-75pts), and big (80-200pts) rewards. Return as JSON: {"actions":[{"type":"reward","title":"Reward Name","detail":"Cost pts","emoji":"🎁"}]}. Make them exciting for kids!`
        }),
      });
      const data = await res.json();
      const actions = data.actions || [];
      const ideas: Reward[] = actions
        .filter((a: any) => a.type === "reward" || a.type === "task")
        .map((a: any, i: number) => ({
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

  // ─── Reward redemption ──────────────────────────────────
  const [pinReward, setPinReward] = useState<Reward | null>(null);
  const [redeemForMember, setRedeemForMember] = useState<string>(""); // member name (must not be pet)

  // ─── PIN completion flow ────────────────────────────────
  const openPinEntry = (taskId: number) => {
    const t = tasks.find((x) => x.id === taskId);
    setPinTaskId(taskId);
    setPinReward(null);
    setPinInput("");
    setPinError("");
    setPinSuccess("");

    if (t?.universal) {
      const defaultSnatcher =
        membersData.find((m: any) => m.role !== "pet")?.name ??
        t.assignee;
      setSnatchForMember(defaultSnatcher);
    } else {
      setSnatchForMember("");
    }
  };

  const openRewardPin = (reward: Reward, memberName?: string) => {
    setPinReward(reward);
    setPinTaskId(null);
    setPinInput("");
    setPinError("");
    setPinSuccess("");
    const defaultMember =
      memberName ||
      (membersData.find((m: any) => m.role !== "pet")?.name ?? "");
    setRedeemForMember(defaultMember);
  };

  const submitPin = () => {
    if (!pinInput) return;

    // Reward redemption mode
    if (pinReward) {
      const memberName = redeemForMember;
      if (!memberName) {
        setPinError("Select who is redeeming the reward.");
        setPinInput("");
        setTimeout(() => setPinError(""), 2000);
        return;
      }

      // Verify PIN for the selected member
      const verified = db.verifyMemberPin(memberName, pinInput);
      if (verified) {
        const cost = pinReward.cost;
        setEarnedPoints(prev => {
          const current = prev[memberName] || 0;
          if (current < cost) return prev;
          return { ...prev, [memberName]: current - cost };
        });
        setPinSuccess(`🎁 ${memberName.split(" ")[0]} redeemed ${pinReward.name}! -${cost}pts`);
        setTimeout(() => { setPinReward(null); setPinSuccess(""); }, 1500);
      } else {
        setPinError("Wrong code for selected member. Try again.");
        setPinInput("");
        setTimeout(() => setPinError(""), 2000);
      }
      return;
    }

    // Task completion mode
    if (pinTaskId === null) return;
    const task = tasks.find(t => t.id === pinTaskId);
    if (!task) return;

    // Universal task: claim for selected member; points go to that claimant
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
        const claimantName = (verified as any).name;
        const claimantEmoji = (membersData.find((m: any) => m.name === claimantName)?.emoji) || task.assigneeEmoji;

        setTasks(prev =>
          prev.map(t =>
            t.id === pinTaskId
              ? {
                  ...t,
                  completed: true,
                  completedBy: claimantName,
                  assignee: claimantName,
                  assigneeEmoji: claimantEmoji,
                }
              : t
          )
        );

        setEarnedPoints(prev => {
          return { ...prev, [claimantName]: (prev[claimantName] || 0) + task.points };
        });

        setPinSuccess(`✅ +${task.points}pts to ${claimantName.split(" ")[0]}!`);
        setTimeout(() => { setPinTaskId(null); setPinSuccess(""); setSnatchForMember(""); }, 1500);
      } else {
        setPinError("Wrong code for selected member. Try again.");
        setPinInput("");
        setTimeout(() => setPinError(""), 2000);
      }
      return;
    }

    // Non-universal task: verify against fixed assignee
    const verified = db.verifyMemberPin(task.assignee, pinInput);
    if (verified) {
      setTasks(prev => prev.map(t => t.id === pinTaskId ? { ...t, completed: true, completedBy: (verified as any).name } : t));
      setEarnedPoints(prev => {
        const name = (verified as any).name;
        return { ...prev, [name]: (prev[name] || 0) + task.points };
      });
      setPinSuccess(`✅ +${task.points}pts to ${(verified as any).name}!`);
      setTimeout(() => { setPinTaskId(null); setPinSuccess(""); setSnatchForMember(""); }, 1500);
    } else {
      setPinError("Wrong PIN. Try again.");
      setPinInput("");
      setTimeout(() => setPinError(""), 2000);
    }
  };

  // ─── Task CRUD ──────────────────────────────────────────
  const startEdit = (task: Task) => {
    setEditingId(task.id);
    setEditForm({ ...task });
    setIsAdding(false);
  };

  const startAdd = () => {
    setEditingId(null);
    setEditForm(emptyTask(membersData[0]));
    setIsAdding(true);
  };

  const cancelEdit = () => { setEditingId(null); setIsAdding(false); };

  const saveTask = () => {
    if (!editForm.title.trim()) return;
    if (isAdding) {
      setTasks(prev => [...prev, { ...editForm, id: Date.now() }]);
    } else {
      setTasks(prev => prev.map(t => t.id === editingId ? { ...editForm } : t));
    }
    setEditingId(null); setIsAdding(false);
  };

  const deleteTask = (id: number) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    setEditingId(null); setIsAdding(false);
  };

  const updateForm = (field: keyof Task, value: any) => {
    setEditForm(prev => {
      const updated: Task = { ...prev, [field]: value };

      if (field === "assignee") {
        const member = membersData.find(m => m.name === value);
        if (member) updated.assigneeEmoji = member.emoji;
      }

      return updated;
    });
  };

  // ─── AI Task Suggestions ─────────────────────────────────
  const generateAiTasks = async () => {
    setAiSuggesting(true);
    // Build dynamic family member list with ages
    const familyList = membersData
      .filter((m: any) => m.role !== "pet")
      .map((m: any) => `${m.name} (${(m as any).age || "?"}yo)`)
      .join(", ");
    const adults = membersData.filter((m: any) => m.role === "parent").map((m: any) => m.name).join(", ");
    const kids = membersData.filter((m: any) => m.role === "child").map((m: any) => m.name).join(", ");
    try {
      const res = await fetch('/api/hermes/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Suggest 4 age-appropriate chores for the Garcia family: ${familyList}. Adults (${adults}) can handle harder tasks (15-25pts). Kids (${kids}) get easier tasks based on their age (5-15pts). Return as JSON: {"actions":[{"type":"task","title":"...","detail":"AssigneeName · Xpts","emoji":"..."}]}. Make them varied (chores, pets, school, helping, errands).`
        }),
      });
      const data = await res.json();
      const actions = data.actions || [];
      const suggestions: Task[] = actions
        .filter((a: any) => a.type === "task")
        .map((a: any) => {
          const assignee = a.detail?.split("·")?.[0]?.trim() || "Caspian";
          const points = parseInt(a.detail?.match(/(\d+)\s*pts?/)?.[1] || "8");
          const member = membersData.find((m: any) => m.name.startsWith(assignee) || m.name === assignee);
          return {
            id: Date.now() + Math.random(),
            title: a.title,
            assignee: member?.name || assignee,
            assigneeEmoji: member?.emoji || "🧒",
            due: "Today",
            points,
            recurring: null,
            category: "AI Suggested",
            completed: false,
            priority: points >= 15 ? "high" : points >= 10 ? "medium" : "low",
          } as Task;
        });
      setAiSuggestions(suggestions.length > 0 ? suggestions : [
        { id: Date.now()+1, title: "Make your bed", assignee: "Caspian", assigneeEmoji: "🧒", due: "Today", points: 5, recurring: "Daily", category: "AI Suggested", completed: false, priority: "low" },
        { id: Date.now()+2, title: "Help set the table", assignee: "Aurora", assigneeEmoji: "👧", due: "Today", points: 8, recurring: "Daily", category: "AI Suggested", completed: false, priority: "medium" },
        { id: Date.now()+3, title: "Sweep the kitchen", assignee: "Jasmine", assigneeEmoji: "👧", due: "Today", points: 12, recurring: null, category: "AI Suggested", completed: false, priority: "medium" },
        { id: Date.now()+4, title: "Organize the pantry", assignee: "Bailey", assigneeEmoji: "👧", due: "Today", points: 15, recurring: "Weekly", category: "AI Suggested", completed: false, priority: "high" },
      ]);
    } catch {
      // Fallback suggestions
      setAiSuggestions([
        { id: Date.now()+1, title: "Make your bed", assignee: "Caspian", assigneeEmoji: "🧒", due: "Today", points: 5, recurring: "Daily", category: "AI Suggested", completed: false, priority: "low" },
        { id: Date.now()+2, title: "Help set the table", assignee: "Aurora", assigneeEmoji: "👧", due: "Today", points: 8, recurring: "Daily", category: "AI Suggested", completed: false, priority: "medium" },
        { id: Date.now()+3, title: "Sweep the kitchen", assignee: "Jasmine", assigneeEmoji: "👧", due: "Today", points: 12, recurring: null, category: "AI Suggested", completed: false, priority: "medium" },
        { id: Date.now()+4, title: "Organize the pantry", assignee: "Bailey", assigneeEmoji: "👧", due: "Today", points: 15, recurring: "Weekly", category: "AI Suggested", completed: false, priority: "high" },
      ]);
    }
    setAiSuggesting(false);
  };

  // Google Tasks sync
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
              id: Date.now() + Math.random(),
              title: ge.title,
              assignee: "All",
              assigneeEmoji: "👨‍👩‍👧‍👧",
              due: "Today",
              points: 5,
              recurring: null,
              category: "Google Tasks",
              completed: false,
              priority: "medium" as const,
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
    setTasks(prev => [...prev, { ...suggestion, id: Date.now() }]);
    setAiSuggestions(prev => prev.filter(s => s.title !== suggestion.title));
  };

  const dismissSuggestion = (title: string) => {
    setAiSuggestions(prev => prev.filter(s => s.title !== title));
  };

  // ─── Computed ────────────────────────────────────────────
  const filtered = tasks.filter((t) => {
    const memberMatch = filterMember === "All" || t.assignee === filterMember;
    const completedMatch = showCompleted ? true : !t.completed;
    return memberMatch && completedMatch;
  });

  const pending = filtered.filter((t) => !t.completed);
  const completed = filtered.filter((t) => t.completed);
  const completedTotal = tasks.filter((t) => t.completed).length;

  // Dynamic leaderboard from earned points
  const dynamicLeaderboard: LeaderboardEntry[] = useMemo(() => {
    const entries = membersData
      .filter((m: any) => m.role !== "pet")
      .map((m: any) => ({
        name: m.name,
        emoji: m.emoji,
        points: earnedPoints[m.name] || 0,
        streak: 0,
        rank: 0,
      }))
      .sort((a: any, b: any) => b.points - a.points);
    // Fall back to static if no points earned yet
    if (entries.every((e: any) => e.points === 0)) return staticLeaderboard;
    return entries.map((e: any, i: number) => ({ ...e, rank: i + 1, streak: Math.floor(e.points / 10) }));
  }, [earnedPoints, membersData]);

  const topScorer = dynamicLeaderboard[0];

  if (!mounted) {
    return (
      <PageShell>
        <TopBar title="Tasks & Chores" subtitle="Loading..." />
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-t-transparent border-[var(--color-accent-selected)]"></div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <TopBar
        title="Tasks & Chores"
        subtitle={`${pending.length} pending`}
        right={
          <button
            onClick={() => activeTab === "tasks" ? startAdd() : startAddReward()}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-nori-500/15 text-nori-400 hover:bg-nori-500/25 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </button>
        }
      />

      {/* Toast */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium bg-nori-500/20 border border-nori-500/30 text-nori-300 shadow-lg backdrop-blur-sm animate-in fade-in slide-in-from-top-2">
          {toast}
        </div>
      )}

      {/* Manual Adjust Modal */}
      {adjustMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setAdjustMember(null)}>
          <div className="bg-surface-0 rounded-2xl p-6 mx-4 w-full max-w-sm border border-surface-3 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-4">
              <span className="text-4xl">⚙️</span>
              <h3 className="text-text-primary font-semibold mt-2">Manual Point Adjust</h3>
              <p className="text-text-secondary text-sm mt-1">Adjust points for <span className="font-semibold text-text-primary">{adjustMember.split(" ")[0]}</span></p>
              <p className="text-text-muted text-xs mt-0.5">Current: <span className="text-nori-400 font-bold">{earnedPoints[adjustMember] || 0} pts</span></p>
            </div>
            {/* Member selector */}
            <div className="mb-3">
              <p className="text-text-muted text-xs font-semibold mb-1">Member</p>
              <select value={adjustMember} onChange={e => setAdjustMember(e.target.value)}
                className="w-full bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3">
                {membersData.filter((m: any) => m.role !== "pet").map((m: any) => (
                  <option key={m.name} value={m.name}>{m.emoji} {m.name}</option>
                ))}
              </select>
            </div>
            {/* +/- toggle + amount */}
            <div className="flex gap-2 mb-3">
              <div className="flex rounded-lg overflow-hidden border border-surface-3">
                <button onClick={() => setAdjustDir("+")}
                  className={`px-4 py-2 text-sm font-bold transition-colors ${adjustDir === "+" ? "bg-nori-500 text-white" : "bg-surface-2 text-text-muted"}`}>+</button>
                <button onClick={() => setAdjustDir("-")}
                  className={`px-4 py-2 text-sm font-bold transition-colors ${adjustDir === "-" ? "bg-rose-500 text-white" : "bg-surface-2 text-text-muted"}`}>−</button>
              </div>
              <input type="number" min="1" max="999" value={adjustAmount}
                onChange={e => setAdjustAmount(e.target.value)}
                className="flex-1 bg-surface-2 text-text-primary text-center text-lg font-bold rounded-lg px-3 py-2 outline-none border border-surface-3 focus:border-nori-500/50" />
              <span className="flex items-center text-text-muted text-sm font-medium">pts</span>
            </div>
            {/* Reason */}
            <input type="text" placeholder="Reason (optional)" value={adjustReason}
              onChange={e => setAdjustReason(e.target.value)}
              className="w-full mb-3 bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3 focus:border-nori-500/50 placeholder:text-text-muted" />
            {/* Parent PIN */}
            <input type="password" inputMode="numeric" maxLength={4} value={adjustPin}
              onChange={e => { setAdjustPin(e.target.value.replace(/[^0-9]/g, "")); setAdjustError(""); }}
              onKeyDown={e => { if (e.key === "Enter") submitAdjust(); }}
              placeholder="Parent PIN" autoFocus
              className="w-full bg-surface-2 text-text-primary text-center text-2xl tracking-[0.5em] rounded-xl px-4 py-3 outline-none border-2 border-surface-3 focus:border-nori-500/50 placeholder:text-text-muted placeholder:text-sm placeholder:tracking-normal" />
            {adjustError && <p className="text-rose-400 text-xs text-center mt-2">{adjustError}</p>}
            {adjustSuccess && <p className="text-nori-400 text-xs text-center mt-2 font-semibold">{adjustSuccess}</p>}
            <div className="flex gap-2 mt-4">
              <button onClick={submitAdjust} disabled={adjustPin.length < 4 || !adjustAmount}
                className={`flex-1 py-2.5 rounded-xl font-semibold text-sm disabled:opacity-40 transition-colors text-white ${
                  adjustDir === "+" ? "bg-nori-500 hover:bg-nori-400" : "bg-rose-500 hover:bg-rose-400"
                }`}>
                {adjustDir === "+" ? `+${adjustAmount} pts` : `−${adjustAmount} pts`}
              </button>
              <button onClick={() => setAdjustMember(null)}
                className="flex-1 py-2.5 rounded-xl bg-surface-2 text-text-secondary text-sm font-medium hover:text-text-primary transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PIN Entry Modal */}
      {(pinTaskId !== null || pinReward !== null || pinPenalty !== null) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => { setPinTaskId(null); setPinReward(null); setPinPenalty(null); }}>
          <div className="bg-surface-0 rounded-2xl p-6 mx-4 w-full max-w-sm border border-surface-3 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-4">
              <span className="text-4xl">{pinReward ? pinReward.emoji : pinPenalty ? pinPenalty.emoji : "🔐"}</span>
              <h3 className="text-text-primary font-semibold mt-2">Enter Your PIN</h3>
              <p className="text-text-secondary text-sm mt-1">
                {pinReward
                  ? `Redeem "${pinReward.name}" for ${pinReward.cost}pts`
                  : pinPenalty
                  ? `Apply "${pinPenalty.name}" penalty (−${pinPenalty.points}pts)`
                  : `Complete "${tasks.find(t => t.id === pinTaskId)?.title}"`
                }
              </p>

              {!pinReward && tasks.find((t) => t.id === pinTaskId)?.universal && (
                <div className="mt-3">
                  <p className="text-text-muted text-xs font-semibold mb-1">Snatch for</p>
                  <select
                    value={snatchForMember}
                    onChange={(e) => setSnatchForMember(e.target.value)}
                    className="w-full bg-surface-2 text-text-primary text-xs rounded-lg px-3 py-2 outline-none border border-surface-3"
                  >
                    {membersData
                      .filter((m: any) => m.role !== "pet")
                      .map((m: any) => (
                        <option key={m.name} value={m.name}>
                          {m.emoji} {m.name}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              {pinReward && (
                <div className="mt-3">
                  <p className="text-text-muted text-xs font-semibold mb-1">Redeem for</p>
                  <select
                    value={redeemForMember}
                    onChange={(e) => setRedeemForMember(e.target.value)}
                    className="w-full bg-surface-2 text-text-primary text-xs rounded-lg px-3 py-2 outline-none border border-surface-3"
                  >
                    {membersData
                      .filter((m: any) => m.role !== "pet")
                      .map((m: any) => (
                        <option key={m.name} value={m.name}>
                          {m.emoji} {m.name}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              {pinPenalty && (
                <div className="mt-3">
                  <p className="text-text-muted text-xs font-semibold mb-1">Apply penalty to</p>
                  <select
                    value={penaltyForMember}
                    onChange={(e) => setPenaltyForMember(e.target.value)}
                    className="w-full bg-surface-2 text-text-primary text-xs rounded-lg px-3 py-2 outline-none border border-surface-3"
                  >
                    {membersData
                      .filter((m: any) => m.role !== "pet")
                      .map((m: any) => (
                        <option key={m.name} value={m.name}>
                          {m.emoji} {m.name}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pinInput}
              onChange={e => { setPinInput(e.target.value.replace(/[^0-9]/g, "")); setPinError(""); }}
              onKeyDown={e => { if (e.key === "Enter") submitPin(); }}
              placeholder="4-digit PIN"
              className="w-full bg-surface-2 text-text-primary text-center text-2xl tracking-[0.5em] rounded-xl px-4 py-3 outline-none border-2 border-surface-3 focus:border-nori-500/50 placeholder:text-text-muted"
              autoFocus
            />
            {pinError && <p className="text-rose-400 text-xs text-center mt-2">{pinError}</p>}
            {pinSuccess && <p className="text-nori-400 text-xs text-center mt-2">{pinSuccess}</p>}
            <div className="flex gap-2 mt-4">
              <button onClick={pinPenalty ? () => {
                if (!penaltyForMember) { setPinError("Select a member."); return; }
                const verified = db.verifyMemberPin(penaltyForMember, pinInput) ||
                  membersData.find((m: any) => m.role === "parent" && db.verifyMemberPin(m.name, pinInput));
                if (verified) {
                  setEarnedPoints(prev => ({ ...prev, [penaltyForMember]: Math.max(0, (prev[penaltyForMember] || 0) - (pinPenalty?.points ?? 0)) }));
                  setPinSuccess(`⚠️ −${pinPenalty?.points}pts from ${penaltyForMember.split(" ")[0]}`);
                  setTimeout(() => { setPinPenalty(null); setPinSuccess(""); }, 1500);
                } else {
                  setPinError("Wrong PIN. Try again.");
                  setPinInput("");
                  setTimeout(() => setPinError(""), 2000);
                }
              } : submitPin} disabled={pinInput.length < 4}
                className={`flex-1 py-2.5 rounded-xl font-semibold text-sm disabled:opacity-40 transition-colors text-white ${
                  pinPenalty ? "bg-rose-500 hover:bg-rose-400" : "bg-nori-500 hover:bg-nori-400"
                }`}>
                {pinPenalty ? `Deduct ${pinPenalty?.points} pts` : "Submit"}
              </button>
              <button onClick={() => { setPinTaskId(null); setPinReward(null); setPinPenalty(null); }}
                className="flex-1 py-2.5 rounded-xl bg-surface-2 text-text-secondary text-sm font-medium hover:text-text-primary transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="px-4 space-y-4">
        {/* Tabs */}
        <div className="flex bg-surface-2 rounded-xl p-1 gap-1">
          {(["tasks", "leaderboard"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all capitalize ${
                activeTab === tab
                  ? "bg-surface-0 text-text-primary shadow"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {tab === "tasks" ? "📋 Tasks" : "🏆 Leaderboard"}
            </button>
          ))}
        </div>

        {activeTab === "tasks" && (
          <>
            {/* Member filter */}
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
              {allMembers.map((m) => (
                <button
                  key={m}
                  onClick={() => setFilterMember(m)}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    filterMember === m
                      ? "bg-nori-500/20 text-nori-400 border border-nori-500/30"
                      : "glass text-text-secondary border border-surface-3 hover:text-text-primary"
                  }`}
                >
                  <AnimatedEmoji emoji={memberEmojis[m]} name={m} size="sm" />
                  <span>{m}</span>
                </button>
              ))}
            </div>

            {/* Add/Edit Form */}
            {(isAdding || editingId !== null) && (
              <Card className="!p-4 space-y-3">
                <h4 className="text-text-primary font-semibold text-sm">
                  {isAdding ? "Add Task" : "Edit Task"}
                </h4>
                <input type="text" placeholder="Task title" value={editForm.title}
                  onChange={e => updateForm("title", e.target.value)}
                  className="w-full bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3 focus:border-nori-500/50 placeholder:text-text-muted" autoFocus />
                <div className="grid grid-cols-2 gap-2">
                  <select value={editForm.assignee} onChange={e => updateForm("assignee", e.target.value)}
                    className="bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3">
                    {membersData.map(m => <option key={m.name} value={m.name}>{m.emoji} {m.name}</option>)}
                  </select>
                  <select value={editForm.due} onChange={e => updateForm("due", e.target.value)}
                    className="bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3">
                    {dueOptions.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select value={editForm.priority} onChange={e => updateForm("priority", e.target.value)}
                    className="bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3">
                    <option value="high">🔴 High</option>
                    <option value="medium">🟡 Medium</option>
                    <option value="low">⚪ Low</option>
                  </select>
                  <select value={editForm.category} onChange={e => updateForm("category", e.target.value)}
                    className="bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3">
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    id="universal-task"
                    type="checkbox"
                    checked={!!editForm.universal}
                    onChange={(e) => updateForm("universal", e.target.checked)}
                    className="w-4 h-4 rounded border-surface-3 text-nori-500 focus:ring-nori-500/30"
                  />
                  <label htmlFor="universal-task" className="text-xs text-text-muted font-medium select-none">
                    Universal (any member can snatch)
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <input type="number" placeholder="Points" value={editForm.points}
                    onChange={e => updateForm("points", parseInt(e.target.value) || 0)}
                    className="w-20 bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3" />
                  <input type="text" placeholder="Recurring (e.g. Daily)" value={editForm.recurring || ""}
                    onChange={e => updateForm("recurring", e.target.value || null)}
                    className="flex-1 bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3 placeholder:text-text-muted" />
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={saveTask} disabled={!editForm.title.trim()}
                    className="flex-1 py-2 rounded-lg bg-nori-500 text-white text-sm font-medium disabled:opacity-40 hover:bg-nori-400 transition-colors">
                    {isAdding ? "Add Task" : "Save"}
                  </button>
                  <button onClick={cancelEdit} className="flex-1 py-2 rounded-lg bg-surface-2 text-text-secondary text-sm font-medium hover:text-text-primary transition-colors">Cancel</button>
                  {!isAdding && (
                    <button onClick={() => deleteTask(editForm.id)} className="px-3 py-2 rounded-lg bg-rose-500/15 text-rose-400 text-sm font-medium hover:bg-rose-500/25 transition-colors">🗑️</button>
                  )}
                </div>
              </Card>
            )}

            {/* AI Task Suggestions */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-text-primary font-semibold text-sm">✨ Consuela Suggests</h3>
                <button
                  onClick={generateAiTasks}
                  disabled={aiSuggesting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-violet-500/15 text-violet-400 border border-violet-500/25 hover:bg-violet-500/25 transition-all disabled:opacity-50"
                >
                  {aiSuggesting ? "⏳ Thinking..." : "🤖 Generate Tasks"}
                </button>
                <button
                  onClick={syncGoogleTasks}
                  disabled={googleSyncing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-cyan-500/15 text-cyan-400 border border-cyan-500/25 hover:bg-cyan-500/25 transition-all disabled:opacity-50"
                >
                  {googleSyncing ? "⏳ Syncing..." : "📅 Google Tasks"}
                </button>
              </div>
              {aiSuggestions.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {aiSuggestions.map(s => (
                    <Card key={s.title} className="!p-3">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-start gap-2">
                          <span className="text-lg shrink-0">{s.assigneeEmoji}</span>
                          <div className="min-w-0">
                            <p className="text-text-primary text-xs font-medium leading-tight">{s.title}</p>
                            <p className="text-text-muted text-[10px] mt-0.5">{s.assignee} · +{s.points}pts</p>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => adoptSuggestion(s)}
                            className="flex-1 py-1.5 rounded-lg bg-nori-500/15 text-nori-400 text-[10px] font-semibold hover:bg-nori-500/25 transition-colors">
                            + Add
                          </button>
                          <button onClick={() => dismissSuggestion(s.title)}
                            className="px-2 py-1.5 rounded-lg bg-surface-2 text-text-muted text-[10px] hover:text-text-secondary transition-colors">
                            ✕
                          </button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </section>

            {/* Pending tasks */}
            <section>
              <div className="flex items-center justify-between mb-3">
          <h3 className="text-text-primary font-semibold text-sm">
                  Pending <span suppressHydrationWarning>({pending.length})</span>
                </h3>
                <button onClick={startAdd} className="text-nori-400 text-xs hover:text-nori-300">+ Assign task</button>

              </div>
              {pending.length === 0 ? (
                <Card className="!p-6 flex flex-col items-center gap-2">
                  <span className="text-3xl">✅</span>
                  <p className="text-text-secondary text-sm">All caught up!</p>
                </Card>
              ) : (
                <div className="space-y-2">
                  {pending.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onComplete={openPinEntry}
                      onEdit={startEdit}
                      memberColors={memberColors}
                      memberEmojis={memberEmojis}
                      priorityColors={priorityColors}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Completed */}
            {completedTotal > 0 && (
              <section>
                <button onClick={() => setShowCompleted(!showCompleted)}
                  className="w-full flex items-center justify-between mb-3 group">
                  <h3 className="text-text-secondary font-semibold text-sm group-hover:text-text-primary transition-colors">
                    Completed ({completedTotal})
                  </h3>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                    className={`w-4 h-4 text-text-muted transition-transform ${showCompleted ? "rotate-180" : ""}`}>
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {showCompleted && (
                  <div className="space-y-2">
                    {completed.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        onComplete={openPinEntry}
                        onEdit={startEdit}
                        memberColors={memberColors}
                        memberEmojis={memberEmojis}
                        priorityColors={priorityColors}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {activeTab === "leaderboard" && (
          <div className="space-y-4 pb-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 rounded-2xl p-4 text-center"
                style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(124,111,247,0.12) 100%)", border: "1px solid rgba(59,130,246,0.15)" }}>
                <p className="text-text-secondary text-xs mb-1">This week&apos;s champion</p>
                <div className="mb-2"><AnimatedEmoji emoji={topScorer.emoji} size="lg" /></div>
                <p className="text-text-primary font-bold text-lg">{topScorer.name}</p>
                <p className="text-nori-400 font-semibold text-sm mt-1">
                  {topScorer.points} pts · {topScorer.streak} day streak 🔥
                </p>
              </div>

              <div className="shrink-0">
                <button
                  onClick={() => {
                    if (typeof window === "undefined") return;
                    localStorage.removeItem(POINTS_STORAGE_KEY);
                    setEarnedPoints({});
                    showToast("Leaderboard reset ✅");
                  }}
                  className="px-3 py-2 rounded-xl bg-surface-2 text-text-secondary text-xs font-semibold hover:text-text-primary hover:bg-surface-3 transition-colors"
                >
                  Reset
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {dynamicLeaderboard.map((entry, i) => (
                <Card key={entry.name} className="!p-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${
                      i === 0 ? "bg-amber-500/20 text-amber-400" :
                      i === 1 ? "bg-surface-3 text-text-secondary" :
                      i === 2 ? "bg-amber-900/20 text-amber-700" :
                      "bg-surface-2 text-text-muted"
                    }`}>
                      {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                    </div>
                    <AnimatedEmoji emoji={entry.emoji} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-text-primary font-semibold text-sm">{entry.name}</p>
                      <p className="text-text-muted text-xs">🔥 {entry.streak} day streak</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <p className="text-nori-400 font-bold text-base">{entry.points}</p>
                        <p className="text-text-muted text-[10px]">pts</p>
                      </div>
                      <button
                        onClick={() => openAdjust(entry.name)}
                        title="Manually adjust points"
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-amber-400 hover:bg-amber-500/10 transition-colors shrink-0"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                          <circle cx="12" cy="12" r="3" />
                          <path d="M19.07 4.93A10 10 0 1 0 4.93 19.07M19.07 4.93L21 3M19.07 4.93l-2 2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="mt-2.5 w-full h-1.5 rounded-full bg-surface-3 overflow-hidden">
                    <div className="h-full rounded-full bg-nori-500 transition-all"
                      style={{ width: `${Math.min((entry.points / (topScorer.points || 1)) * 100, 100)}%` }} />
                  </div>
                </Card>
              ))}
            </div>
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-text-primary font-semibold text-sm">Rewards</h3>
                <div className="flex gap-1">
                  <button
                    onClick={generateAiRewards}
                    disabled={aiRewardSuggesting}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium bg-violet-500/15 text-violet-400 border border-violet-500/25 hover:bg-violet-500/25 transition-all disabled:opacity-50"
                  >
                    {aiRewardSuggesting ? "⏳" : "🤖"} Suggest
                  </button>
                  <button onClick={startAddReward}
                    className="w-6 h-6 flex items-center justify-center rounded-lg text-text-muted hover:text-nori-400 hover:bg-nori-500/10 transition-colors text-xs">
                    +
                  </button>
                </div>
              </div>

              {/* Reward edit form */}
              {(addingReward || editingRewardId !== null) && (
                <Card className="!p-3 mb-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input value={rewardForm.emoji} onChange={e => setRewardForm(p => ({...p, emoji: e.target.value}))}
                      className="w-12 h-10 text-center text-lg bg-surface-2 rounded-lg outline-none border border-surface-3" />
                    <input value={rewardForm.name} onChange={e => setRewardForm(p => ({...p, name: e.target.value}))}
                      placeholder="Reward name" autoFocus
                      className="flex-1 bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3 focus:border-nori-500/50" />
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="number" value={rewardForm.cost}
                      onChange={e => setRewardForm(p => ({...p, cost: parseInt(e.target.value) || 0}))}
                      className="w-20 bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3" />
                    <span className="text-text-muted text-xs">pts</span>
                    <div className="flex-1" />
                    <button onClick={saveReward} disabled={!rewardForm.name.trim()}
                      className="px-3 py-1.5 rounded-lg bg-nori-500 text-white text-xs font-medium disabled:opacity-40">Save</button>
                    <button onClick={() => { setEditingRewardId(null); setAddingReward(false); }}
                      className="px-3 py-1.5 rounded-lg bg-surface-2 text-text-secondary text-xs">Cancel</button>
                    {!addingReward && (
                      <button onClick={() => deleteReward(rewardForm.id)}
                        className="px-2 py-1.5 rounded-lg bg-rose-500/15 text-rose-400 text-xs">🗑️</button>
                    )}
                  </div>
                </Card>
              )}

              {/* AI reward suggestions */}
              {aiRewards.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {aiRewards.map(r => (
                    <Card key={r.id} className="!p-3 border-dashed border-violet-500/25">
                      <div className="flex flex-col items-center gap-1.5 text-center">
                        <span className="text-xl">{r.emoji}</span>
                        <p className="text-text-primary text-xs font-medium">{r.name}</p>
                        <Badge variant="violet">{r.cost} pts</Badge>
                        <button onClick={() => adoptReward(r)}
                          className="w-full py-1 rounded-lg bg-nori-500/15 text-nori-400 text-[10px] font-semibold hover:bg-nori-500/25">+ Add</button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                {rewards.map((reward) => {
                  const unlocked = (earnedPoints[topScorer.name] || 0) >= reward.cost;
                  return (
                    <Card key={reward.id} className={`!p-3 ${!unlocked ? "opacity-50" : "cursor-pointer hover:border-nori-500/30 transition-colors"}`}
                      onClick={() => {
                        if (!unlocked) return;
                        // default redeem-for member: current top scorer if eligible, else first non-pet member
                        const defaultRedeem =
                          membersData.find((m: any) => m.role !== "pet" && m.name === topScorer.name)?.name ||
                          membersData.find((m: any) => m.role !== "pet")?.name;
                        openRewardPin(reward, defaultRedeem);
                      }}>
                      <div className="flex flex-col items-center gap-1.5 text-center">
                        <AnimatedEmoji emoji={reward.emoji} size="sm" />
                        <p className="text-text-primary text-xs font-medium leading-tight">{reward.name}</p>
                        <Badge variant={unlocked ? "amber" : "gray"}>{reward.cost} pts</Badge>
                        <div className="flex gap-1 mt-0.5">
                          <button onClick={(e) => { e.stopPropagation(); startEditReward(reward); }}
                            className="px-1.5 py-0.5 rounded-md text-[10px] text-text-muted hover:text-text-secondary">✏️</button>
                          <button onClick={(e) => { e.stopPropagation(); deleteReward(reward.id); }}
                            className="px-1.5 py-0.5 rounded-md text-[10px] text-text-muted hover:text-rose-400">🗑️</button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>

            {/* ─── Penalties Section ───────────────────────────── */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-text-primary font-semibold text-sm">⚠️ Penalties</h3>
                  <p className="text-text-muted text-[10px] mt-0.5">Deduct points for missed tasks or bad behavior</p>
                </div>
                <button onClick={startAddPenalty}
                  className="w-6 h-6 flex items-center justify-center rounded-lg text-text-muted hover:text-rose-400 hover:bg-rose-500/10 transition-colors text-xs">+</button>
              </div>

              {/* Penalty edit form */}
              {(addingPenalty || editingPenaltyId !== null) && (
                <Card className="!p-3 mb-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input value={penaltyForm.emoji} onChange={e => setPenaltyForm(p => ({...p, emoji: e.target.value}))}
                      className="w-12 h-10 text-center text-lg bg-surface-2 rounded-lg outline-none border border-surface-3" />
                    <input value={penaltyForm.name} onChange={e => setPenaltyForm(p => ({...p, name: e.target.value}))}
                      placeholder="Penalty name" autoFocus
                      className="flex-1 bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3 focus:border-rose-500/50" />
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="number" value={penaltyForm.points}
                      onChange={e => setPenaltyForm(p => ({...p, points: parseInt(e.target.value) || 0}))}
                      className="w-20 bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3" />
                    <span className="text-rose-400 text-xs font-semibold">pts deducted</span>
                    <div className="flex-1" />
                    <button onClick={savePenalty} disabled={!penaltyForm.name.trim()}
                      className="px-3 py-1.5 rounded-lg bg-rose-500 text-white text-xs font-medium disabled:opacity-40">Save</button>
                    <button onClick={() => { setEditingPenaltyId(null); setAddingPenalty(false); }}
                      className="px-3 py-1.5 rounded-lg bg-surface-2 text-text-secondary text-xs">Cancel</button>
                    {!addingPenalty && (
                      <button onClick={() => deletePenalty(penaltyForm.id)}
                        className="px-2 py-1.5 rounded-lg bg-rose-500/15 text-rose-400 text-xs">🗑️</button>
                    )}
                  </div>
                </Card>
              )}

              <div className="grid grid-cols-2 gap-2">
                {penalties.map((penalty) => (
                  <Card key={penalty.id} className="!p-3 border-rose-500/10">
                    <div className="flex flex-col items-center gap-1.5 text-center">
                      <span className="text-xl">{penalty.emoji}</span>
                      <p className="text-text-primary text-xs font-medium leading-tight">{penalty.name}</p>
                      <span className="text-[10px] font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full">−{penalty.points} pts</span>
                      <div className="flex gap-1 w-full mt-0.5">
                        <button
                          onClick={() => openPenaltyPin(penalty)}
                          className="flex-1 py-1.5 rounded-lg bg-rose-500/15 text-rose-400 text-[10px] font-semibold hover:bg-rose-500/25 transition-colors"
                        >
                          Apply
                        </button>
                        <button onClick={() => startEditPenalty(penalty)}
                          className="px-2 py-1.5 rounded-lg bg-surface-2 text-text-muted text-[10px] hover:text-text-secondary">✏️</button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </PageShell>
  );
}

interface TaskRowProps {
  task: Task;
  onComplete: (id: number) => void;
  onEdit: (task: Task) => void;
  memberColors: Record<string, string>;
  memberEmojis: Record<string, string>;
  priorityColors: Record<string, string>;
}

function TaskRow({ task, onComplete, onEdit, memberColors, memberEmojis, priorityColors }: TaskRowProps) {
  return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => onComplete(task.id)}
        className={`flex-1 flex items-center gap-3 px-3 py-3 rounded-xl transition-all active:scale-[0.98] text-left ${
          task.completed ? "opacity-50" : "glass hover:border-surface-4"
        }`}
      >
        <div
          className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${
            task.completed ? "border-nori-500 bg-nori-500" : "border-surface-4"
          }`}
        >

          {task.completed && (
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} className="w-3 h-3">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${priorityColors[task.priority]}`} />
            <p className={`text-sm font-medium truncate ${task.completed ? "line-through text-text-muted" : "text-text-primary"}`}>
              {task.title}
            </p>
          </div>
          <p className="text-xs text-text-muted mt-0.5 truncate">
            <span className="font-medium text-text-secondary/80">{task.assignee.split(" ")[0]}</span>
            {" · "}{task.due}
            {task.recurring && ` · 🔄 ${task.recurring}`}
            {task.completedBy && ` · ✅ ${task.completedBy}`}
          </p>
        </div>

        <div className="flex flex-col items-center justify-center shrink-0 gap-1">
          {task.points > 0 && (
            <span className="text-[10px] font-bold text-amber-400 leading-none">+{task.points}pts</span>
          )}
          <Avatar
            name={task.assignee}
            color={memberColors[task.assignee] ?? "green"}
            emoji={memberEmojis[task.assignee] || task.assigneeEmoji}
            size="sm"
            variant="emoji"
          />
        </div>


      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onEdit(task); }}
        className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-nori-400 hover:bg-nori-500/10 transition-colors shrink-0"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
