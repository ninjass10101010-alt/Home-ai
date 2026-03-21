"use client";

import { useState } from "react";
import PageShell from "@/components/ui/PageShell";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Avatar from "@/components/ui/Avatar";
import Link from "next/link";

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
  { id: 1, title: "Take out trash", assignee: "Jake", assigneeEmoji: "🧒", due: "Today", points: 10, recurring: "Weekly · Thu", category: "Chores", completed: false, priority: "high" },
  { id: 2, title: "Grocery run", assignee: "Mom", assigneeEmoji: "👩", due: "Today", points: 20, recurring: null, category: "Errands", completed: false, priority: "high" },
  { id: 3, title: "Load dishwasher", assignee: "Lily", assigneeEmoji: "👧", due: "Today", points: 8, recurring: "Daily", category: "Chores", completed: false, priority: "medium" },
  { id: 4, title: "Vacuum living room", assignee: "Jake", assigneeEmoji: "🧒", due: "Tomorrow", points: 15, recurring: "Weekly", category: "Chores", completed: false, priority: "medium" },
  { id: 5, title: "Pay electric bill", assignee: "Dad", assigneeEmoji: "👨", due: "Fri", points: 0, recurring: "Monthly", category: "Admin", completed: false, priority: "high" },
  { id: 6, title: "Clean bathroom", assignee: "Lily", assigneeEmoji: "👧", due: "Tomorrow", points: 15, recurring: "Weekly", category: "Chores", completed: true, priority: "medium" },
  { id: 7, title: "Walk the dog", assignee: "Jake", assigneeEmoji: "🧒", due: "Today", points: 12, recurring: "Daily", category: "Pets", completed: true, priority: "low" },
  { id: 8, title: "Book dentist appt", assignee: "Mom", assigneeEmoji: "👩", due: "This week", points: 0, recurring: null, category: "Health", completed: false, priority: "medium" },
  { id: 9, title: "Car oil change", assignee: "Dad", assigneeEmoji: "👨", due: "Sat", points: 0, recurring: null, category: "Errands", completed: false, priority: "low" },
];

const leaderboard: LeaderboardEntry[] = [
  { name: "Jake", emoji: "🧒", points: 145, streak: 5, rank: 1 },
  { name: "Lily", emoji: "👧", points: 120, streak: 3, rank: 2 },
  { name: "Mom", emoji: "👩", points: 95, streak: 7, rank: 3 },
  { name: "Dad", emoji: "👨", points: 60, streak: 2, rank: 4 },
];

const allMembers = ["All", "Mom", "Dad", "Jake", "Lily"];
const memberEmojis: Record<string, string> = { All: "👨‍👩‍👧‍👦", Mom: "👩", Dad: "👨", Jake: "🧒", Lily: "👧" };
const memberColors: Record<string, string> = { Mom: "green", Dad: "cyan", Jake: "violet", Lily: "amber" };
const priorityColors: Record<string, string> = { high: "bg-rose-500", medium: "bg-amber-500", low: "bg-surface-4" };

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [filterMember, setFilterMember] = useState("All");
  const [activeTab, setActiveTab] = useState<"tasks" | "leaderboard">("tasks");
  const [showCompleted, setShowCompleted] = useState(false);

  const toggleTask = (id: number) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
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
          <Link
            href="/chat?q=Add+new+chore"
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-nori-500/15 text-nori-400 hover:bg-nori-500/25 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </Link>
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
                  <span>{memberEmojis[m]}</span>
                  <span>{m}</span>
                </button>
              ))}
            </div>

            {/* Pending tasks */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-text-primary font-semibold text-sm">Pending ({pending.length})</h3>
                <Link href="/chat?q=Assign+new+task" className="text-nori-400 text-xs hover:text-nori-300">
                  + Assign task
                </Link>
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
                      onToggle={toggleTask}
                      memberColors={memberColors}
                      priorityColors={priorityColors}
                    />
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
                        memberColors={memberColors}
                        priorityColors={priorityColors}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Recurring tasks */}
            <section className="pb-2">
              <h3 className="text-text-primary font-semibold text-sm mb-3">Recurring Chores</h3>
              <div className="space-y-2">
                {[
                  { title: "Take out trash", assignee: "Jake", schedule: "Every Thursday", emoji: "🗑️", color: "violet" },
                  { title: "Load dishwasher", assignee: "Lily", schedule: "Daily after dinner", emoji: "🍽️", color: "amber" },
                  { title: "Walk the dog", assignee: "Jake", schedule: "Daily morning", emoji: "🐕", color: "violet" },
                  { title: "Pay bills", assignee: "Dad", schedule: "1st of month", emoji: "💳", color: "cyan" },
                ].map((chore) => (
                  <Card key={chore.title} className="!p-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-surface-3 flex items-center justify-center text-base shrink-0">
                        {chore.emoji}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-text-primary text-sm font-medium truncate">{chore.title}</p>
                        <p className="text-text-muted text-xs">{chore.schedule}</p>
                      </div>
                      <Avatar name={chore.assignee} color={chore.color} size="sm" />
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          </>
        )}

        {activeTab === "leaderboard" && (
          <div className="space-y-4 pb-2">
            {/* Champion banner */}
            <div
              className="rounded-2xl p-4 text-center"
              style={{
                background: "linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(124,111,247,0.12) 100%)",
                border: "1px solid rgba(34,197,94,0.15)",
              }}
            >
              <p className="text-text-secondary text-xs mb-1">This week&apos;s champion</p>
              <p className="text-4xl mb-2">{leaderboard[0].emoji}</p>
              <p className="text-text-primary font-bold text-lg">{leaderboard[0].name}</p>
              <p className="text-nori-400 font-semibold text-sm mt-1">
                {leaderboard[0].points} pts · {leaderboard[0].streak} day streak 🔥
              </p>
            </div>

            {/* Leaderboard list */}
            <div className="space-y-2">
              {leaderboard.map((entry, i) => (
                <Card key={entry.name} className="!p-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${
                        i === 0
                          ? "bg-amber-500/20 text-amber-400"
                          : i === 1
                          ? "bg-surface-3 text-text-secondary"
                          : i === 2
                          ? "bg-amber-900/20 text-amber-700"
                          : "bg-surface-2 text-text-muted"
                      }`}
                    >
                      {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                    </div>
                    <span className="text-2xl">{entry.emoji}</span>
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
                    <div
                      className="h-full rounded-full bg-nori-500 transition-all"
                      style={{ width: `${(entry.points / 200) * 100}%` }}
                    />
                  </div>
                </Card>
              ))}
            </div>

            {/* Rewards */}
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
                      <span className="text-2xl">{reward.emoji}</span>
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
  memberColors: Record<string, string>;
  priorityColors: Record<string, string>;
}

function TaskRow({ task, onToggle, memberColors, priorityColors }: TaskRowProps) {
  return (
    <button
      onClick={() => onToggle(task.id)}
      className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all active:scale-[0.98] ${
        task.completed ? "opacity-50" : "glass hover:border-surface-4"
      }`}
      style={{ border: "1px solid rgba(255,255,255,0.05)" }}
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

      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${priorityColors[task.priority]}`} />
          <p
            className={`text-sm font-medium truncate ${
              task.completed ? "line-through text-text-muted" : "text-text-primary"
            }`}
          >
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
        <Avatar
          name={task.assignee}
          color={memberColors[task.assignee] ?? "green"}
          emoji={task.assigneeEmoji}
          size="sm"
        />
      </div>
    </button>
  );
}
