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
  { id: 6, title: "Clean bathroom", assignee: "Jasmine", assigneeEmoji: "👧", due: "Tomorrow", points: 15, recurring: "Weekly", category: "Chores", completed: true, priority: "medium" },
  { id: 7, title: "Walk Rocco", assignee: "Caspian", assigneeEmoji: "🧒", due: "Today", points: 12, recurring: "Daily", category: "Pets", completed: true, priority: "low" },
  { id: 8, title: "Book dentist appt", assignee: "Rebecca (Mom)", assigneeEmoji: "👩", due: "This week", points: 0, recurring: null, category: "Health", completed: false, priority: "medium" },
  { id: 9, title: "Car oil change", assignee: "Jeffery (Dad)", assigneeEmoji: "👨", due: "Sat", points: 0, recurring: null, category: "Errands", completed: false, priority: "low" },
  { id: 10, title: "Chew the bone", assignee: "Rocco", assigneeEmoji: "🐶", due: "Today", points: 5, recurring: "Daily", category: "Pets", completed: false, priority: "low" },
  { id: 11, title: "Grooming appointment", assignee: "Rico", assigneeEmoji: "🐩", due: "Tomorrow", points: 0, recurring: "Monthly", category: "Pets", completed: false, priority: "medium" },
];

const priorityColors: Record<string, string> = { high: "bg-rose-500", medium: "bg-amber-500", low: "bg-surface-4" };
const categories = ["Chores", "Errands", "Admin", "Health", "Pets", "School"];
const dueOptions = ["Today", "Tomorrow", "This week", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed", "Thu"];

const leaderboard: LeaderboardEntry[] = [
  { name: "Caspian", emoji: "🧒", points: 145, streak: 5, rank: 1 },
  { name: "Emily", emoji: "👧", points: 120, streak: 3, rank: 2 },
  { name: "Rebecca (Mom)", emoji: "👩", points: 95, streak: 7, rank: 3 },
  { name: "Jeffery (Dad)", emoji: "👨", points: 60, streak: 2, rank: 4 },
];

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
  };
}

const TASKS_STORAGE_KEY = "consuela-tasks";

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

export default function TasksPage() {
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

  useEffect(() => {
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks]);
  const [filterMember, setFilterMember] = useState("All");
  const [activeTab, setActiveTab] = useState<"tasks" | "leaderboard">("tasks");
  const [showCompleted, setShowCompleted] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Task>(emptyTask(membersData[0]));
  const [isAdding, setIsAdding] = useState(false);

  const toggleTask = (id: number) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
  };

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

  const cancelEdit = () => {
    setEditingId(null);
    setIsAdding(false);
  };

  const saveTask = () => {
    if (!editForm.title.trim()) return;
    if (isAdding) {
      setTasks(prev => [...prev, { ...editForm, id: Date.now() }]);
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
      const updated = { ...prev, [field]: value };
      if (field === "assignee") {
        const member = membersData.find(m => m.name === value);
        if (member) updated.assigneeEmoji = member.emoji;
      }
      return updated;
    });
  };

  const filtered = tasks.filter((t) => {
    const memberMatch = filterMember === "All" || t.assignee === filterMember;
    const completedMatch = showCompleted ? true : !t.completed;
    return memberMatch && completedMatch;
  });

  const pending = filtered.filter((t) => !t.completed);
  const completed = filtered.filter((t) => t.completed);
  const completedTotal = tasks.filter((t) => t.completed).length;

  return (
    <PageShell>
      <TopBar
        title="Tasks & Chores"
        subtitle={`${pending.length} pending`}
        right={
          <button
            onClick={startAdd}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-nori-500/15 text-nori-400 hover:bg-nori-500/25 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </button>
        }
      />

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
                <input
                  type="text"
                  placeholder="Task title"
                  value={editForm.title}
                  onChange={e => updateForm("title", e.target.value)}
                  className="w-full bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3 focus:border-nori-500/50 placeholder:text-text-muted"
                  autoFocus
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={editForm.assignee}
                    onChange={e => updateForm("assignee", e.target.value)}
                    className="bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3"
                  >
                    {membersData.map(m => (
                      <option key={m.name} value={m.name}>{m.emoji} {m.name}</option>
                    ))}
                  </select>
                  <select
                    value={editForm.due}
                    onChange={e => updateForm("due", e.target.value)}
                    className="bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3"
                  >
                    {dueOptions.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select
                    value={editForm.priority}
                    onChange={e => updateForm("priority", e.target.value)}
                    className="bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3"
                  >
                    <option value="high">🔴 High</option>
                    <option value="medium">🟡 Medium</option>
                    <option value="low">⚪ Low</option>
                  </select>
                  <select
                    value={editForm.category}
                    onChange={e => updateForm("category", e.target.value)}
                    className="bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3"
                  >
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    placeholder="Points"
                    value={editForm.points}
                    onChange={e => updateForm("points", parseInt(e.target.value) || 0)}
                    className="w-20 bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3"
                  />
                  <input
                    type="text"
                    placeholder="Recurring (e.g. Daily)"
                    value={editForm.recurring || ""}
                    onChange={e => updateForm("recurring", e.target.value || null)}
                    className="flex-1 bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3 placeholder:text-text-muted"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={saveTask}
                    disabled={!editForm.title.trim()}
                    className="flex-1 py-2 rounded-lg bg-nori-500 text-white text-sm font-medium disabled:opacity-40 hover:bg-nori-400 transition-colors"
                  >
                    {isAdding ? "Add Task" : "Save"}
                  </button>
                  <button onClick={cancelEdit} className="flex-1 py-2 rounded-lg bg-surface-2 text-text-secondary text-sm font-medium hover:text-text-primary transition-colors">
                    Cancel
                  </button>
                  {!isAdding && (
                    <button
                      onClick={() => deleteTask(editForm.id)}
                      className="px-3 py-2 rounded-lg bg-rose-500/15 text-rose-400 text-sm font-medium hover:bg-rose-500/25 transition-colors"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </Card>
            )}

            {/* Pending tasks */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-text-primary font-semibold text-sm">Pending ({pending.length})</h3>
                <button onClick={startAdd} className="text-nori-400 text-xs hover:text-nori-300">
                  + Assign task
                </button>
              </div>

              {pending.length === 0 ? (
                <Card className="!p-6 flex flex-col items-center gap-2">
                  <span className="text-3xl">✅</span>
                  <p className="text-text-secondary text-sm">All caught up!</p>
                </Card>
              ) : (
                <div className="space-y-2">
                  {pending.map((task) => (
                    <div key={task.id} className="flex items-center gap-1">
                      <div className="flex-1">
                        <TaskRow
                          task={task}
                          onToggle={toggleTask}
                          onEdit={startEdit}
                          memberColors={memberColors}
                          priorityColors={priorityColors}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Completed */}
            {completedTotal > 0 && (
              <section>
                <button
                  onClick={() => setShowCompleted(!showCompleted)}
                  className="w-full flex items-center justify-between mb-3 group"
                >
                  <h3 className="text-text-secondary font-semibold text-sm group-hover:text-text-primary transition-colors">
                    Completed ({completedTotal})
                  </h3>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    className={`w-4 h-4 text-text-muted transition-transform ${showCompleted ? "rotate-180" : ""}`}
                  >
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {showCompleted && (
                  <div className="space-y-2">
                    {completed.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        onToggle={toggleTask}
                        onEdit={startEdit}
                        memberColors={memberColors}
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
            <div
              className="rounded-2xl p-4 text-center"
              style={{
                background: "linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(124,111,247,0.12) 100%)",
                border: "1px solid rgba(59,130,246,0.15)",
              }}
            >
              <p className="text-text-secondary text-xs mb-1">This week&apos;s champion</p>
              <div className="mb-2"><AnimatedEmoji emoji={leaderboard[0].emoji} size="lg" /></div>
              <p className="text-text-primary font-bold text-lg">{leaderboard[0].name}</p>
              <p className="text-nori-400 font-semibold text-sm mt-1">
                {leaderboard[0].points} pts · {leaderboard[0].streak} day streak 🔥
              </p>
            </div>
            <div className="space-y-2">
              {leaderboard.map((entry, i) => (
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
                    <div className="text-right">
                      <p className="text-nori-400 font-bold text-base">{entry.points}</p>
                      <p className="text-text-muted text-[10px]">pts</p>
                    </div>
                  </div>
                  <div className="mt-2.5 w-full h-1.5 rounded-full bg-surface-3 overflow-hidden">
                    <div className="h-full rounded-full bg-nori-500 transition-all" style={{ width: `${(entry.points / 200) * 100}%` }} />
                  </div>
                </Card>
              ))}
            </div>
            <section>
              <h3 className="text-text-primary font-semibold text-sm mb-3">Rewards</h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { name: "Movie pick", emoji: "🎬", cost: 50, unlocked: true },
                  { name: "Skip 1 chore", emoji: "🎟️", cost: 75, unlocked: true },
                  { name: "Extra screen time", emoji: "📱", cost: 100, unlocked: false },
                  { name: "Family outing", emoji: "🎡", cost: 200, unlocked: false },
                ].map((reward) => (
                  <Card key={reward.name} className={`!p-3 ${!reward.unlocked ? "opacity-50" : ""}`}>
                    <div className="flex flex-col items-center gap-1.5 text-center">
                      <AnimatedEmoji emoji={reward.emoji} size="sm" />
                      <p className="text-text-primary text-xs font-medium leading-tight">{reward.name}</p>
                      <Badge variant={reward.unlocked ? "amber" : "gray"}>{reward.cost} pts</Badge>
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
  onToggle: (id: number) => void;
  onEdit: (task: Task) => void;
  memberColors: Record<string, string>;
  priorityColors: Record<string, string>;
}

function TaskRow({ task, onToggle, onEdit, memberColors, priorityColors }: TaskRowProps) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onToggle(task.id)}
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
          <p className="text-xs text-text-muted mt-0.5">
            {task.due}
            {task.recurring && ` · 🔄 ${task.recurring}`}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {task.points > 0 && (
            <span className="text-xs font-semibold text-amber-400">+{task.points}pts</span>
          )}
          <Avatar name={task.assignee} color={memberColors[task.assignee] ?? "green"} emoji={task.assigneeEmoji} size="sm" variant="emoji" />
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
