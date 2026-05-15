"use client";

import { useState, useMemo, useEffect } from "react";
import PageShell from "@/components/ui/PageShell";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Avatar from "@/components/ui/Avatar";
import Button from "@/components/ui/Button";
import TaskEditor from "@/components/tasks/TaskEditor";
import RewardEditor from "@/components/tasks/RewardEditor";
import Modal from "@/components/ui/Modal";
import pb from "@/lib/pocketbase";

interface TasksContentProps {
  initialTasks: any[];
  members: any[];
  rewards: any[];
}

const memberColors: Record<string, string> = { 
  mom: "green", 
  dad: "cyan", 
  son: "violet", 
  daughter: "amber",
  other: "blue"
};

const priorityColors: Record<string, string> = { 
  high: "bg-rose-500", 
  medium: "bg-amber-500", 
  low: "bg-surface-4" 
};

export default function TasksContent({ initialTasks, members, rewards }: TasksContentProps) {
  const [activeTasks, setActiveTasks] = useState(initialTasks);
  const [activeMembers, setActiveMembers] = useState(members);
  const [activeRewards, setActiveRewards] = useState(rewards);
  
  const [activeTab, setActiveTab] = useState<"tasks" | "leaderboard">("tasks");
  const [filterMemberId, setFilterMemberId] = useState<string | "all">("all");
  const [showCompleted, setShowCompleted] = useState(false);
  const [isTaskEditorOpen, setIsTaskEditorOpen] = useState(false);
  const [isRewardEditorOpen, setIsRewardEditorOpen] = useState(false);
  const [isMemberSelectOpen, setIsMemberSelectOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);
  const [completingTask, setCompletingTask] = useState<any>(null);
  const [editingReward, setEditingReward] = useState<any>(null);

  useEffect(() => {
    const refreshData = async () => {
      const [t, m, r] = await Promise.all([
        pb.collection("tasks").getFullList(),
        pb.collection("members").getFullList(),
        pb.collection("rewards").getFullList()
      ]);
      setActiveTasks(t);
      setActiveMembers(m);
      setActiveRewards(r);
    };

    const collections = ['tasks', 'members', 'rewards'];
    collections.forEach(col => {
      pb.collection(col).subscribe('*', refreshData);
    });

    return () => {
      collections.forEach(col => pb.collection(col).unsubscribe('*'));
    };
  }, []);

  const memberMap = useMemo(() => {
    const map: Record<string, any> = {};
    activeMembers.forEach(m => map[m.id] = m);
    return map;
  }, [activeMembers]);

  const leaderboard = useMemo(() => {
    const scores: Record<string, number> = {};
    activeMembers.forEach(m => scores[m.id] = 0);
    
    activeTasks.forEach(task => {
      if (task.status === "completed" && task.assignedTo) {
        scores[task.assignedTo] = (scores[task.assignedTo] || 0) + (task.points || 0);
      }
    });

    return activeMembers
      .map(m => ({
        ...m,
        points: scores[m.id] || 0,
        streak: Math.floor(Math.random() * 5), // Mock streak for now
      }))
      .sort((a, b) => b.points - a.points)
      .map((m, i) => ({ ...m, rank: i + 1 }));
  }, [activeTasks, activeMembers]);

  const filteredTasks = activeTasks.filter((t) => {
    const memberMatch = filterMemberId === "all" || t.assignedTo === filterMemberId;
    const completedMatch = showCompleted ? true : t.status === "pending";
    return memberMatch && completedMatch;
  });

  const pendingTasks = filteredTasks.filter((t) => t.status === "pending");
  const completedTasks = filteredTasks.filter((t) => t.status === "completed");
  const completedTotal = activeTasks.filter((t) => t.status === "completed").length;

  const handleToggleTask = async (task: any) => {
    if (task.status === "pending" && !task.assignedTo) {
      setCompletingTask(task);
      setIsMemberSelectOpen(true);
      return;
    }
    const newStatus = task.status === "pending" ? "completed" : "pending";
    await pb.collection("tasks").update(task.id, { status: newStatus });
  };

  const handleMemberComplete = async (memberId: string) => {
    if (completingTask) {
      await pb.collection("tasks").update(completingTask.id, { 
        status: "completed", 
        assignedTo: memberId 
      });
      setIsMemberSelectOpen(false);
      setCompletingTask(null);
    }
  };

  const openEditTask = (task: any) => {
    setEditingTask(task);
    setIsTaskEditorOpen(true);
  };

  const openEditReward = (reward: any) => {
    setEditingReward(reward);
    setIsRewardEditorOpen(true);
  };

  return (
    <PageShell>
      <TopBar
        title="Tasks & Chores"
        subtitle={`${pendingTasks.length} pending`}
        right={
          <button
            onClick={() => {
              setEditingTask(null);
              setIsTaskEditorOpen(true);
            }}
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
              <button
                onClick={() => setFilterMemberId("all")}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  filterMemberId === "all"
                    ? "bg-nori-500/20 text-nori-400 border border-nori-500/30"
                    : "glass text-text-secondary border border-surface-3 hover:text-text-primary"
                }`}
              >
                <span>👨‍👩‍👧‍👦</span>
                <span>All</span>
              </button>
              {members.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setFilterMemberId(m.id)}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    filterMemberId === m.id
                      ? "bg-nori-500/20 text-nori-400 border border-nori-500/30"
                      : "glass text-text-secondary border border-surface-3 hover:text-text-primary"
                  }`}
                >
                  <span>{m.emoji}</span>
                  <span>{m.name}</span>
                </button>
              ))}
            </div>

            {/* Pending tasks */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-text-primary font-semibold text-sm">Pending ({pendingTasks.length})</h3>
              </div>

              {pendingTasks.length === 0 ? (
                <Card className="!p-6 flex flex-col items-center gap-2">
                  <span className="text-3xl">✅</span>
                  <p className="text-text-secondary text-sm">All caught up!</p>
                </Card>
              ) : (
                <div className="space-y-2">
                  {pendingTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      assignee={memberMap[task.assignedTo]}
                      onToggle={() => handleToggleTask(task)}
                      onEdit={() => openEditTask(task)}
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
                    {completedTasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        assignee={memberMap[task.assignedTo]}
                        onToggle={() => handleToggleTask(task)}
                        onEdit={() => openEditTask(task)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Recurring tasks section removed for now or integrated into tasks */}
          </>
        )}

        {activeTab === "leaderboard" && (
          <div className="space-y-4 pb-2">
            {/* Champion banner */}
            {leaderboard.length > 0 && (
              <div
                className="rounded-2xl p-4 text-center relative overflow-hidden"
                style={{
                  background: "linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(124,111,247,0.12) 100%)",
                  border: "1px solid rgba(59,130,246,0.15)",
                }}
              >
                <div className="absolute top-0 right-0 p-2">
                  <div className="animate-bounce">👑</div>
                </div>
                <p className="text-text-secondary text-xs mb-1">This week&apos;s champion</p>
                <p className="text-4xl mb-2">{leaderboard[0].emoji}</p>
                <p className="text-text-primary font-bold text-lg">{leaderboard[0].name}</p>
                <div className="flex items-center justify-center gap-3 mt-1">
                  <Badge variant="amber">{leaderboard[0].points} pts</Badge>
                  <span className="text-nori-400 font-semibold text-sm">🔥 {leaderboard[0].streak} day streak</span>
                </div>
              </div>
            )}

            {/* Leaderboard list */}
            <div className="space-y-2">
              {leaderboard.map((entry, i) => (
                <Card key={entry.id} className="!p-3 relative group">
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
                      className="h-full rounded-full bg-nori-500 transition-all duration-1000"
                      style={{ width: `${Math.min((entry.points / Math.max(leaderboard[0].points, 1)) * 100, 100)}%` }}
                    />
                  </div>
                </Card>
              ))}
            </div>

            {/* Rewards */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-text-primary font-semibold text-sm">Rewards Shop</h3>
                <button 
                  onClick={() => {
                    setEditingReward(null);
                    setIsRewardEditorOpen(true);
                  }}
                  className="text-nori-400 text-xs font-medium hover:text-nori-300 transition-colors"
                >
                  + Add Reward
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {rewards.map((reward) => (
                  <Card 
                    key={reward.id} 
                    onClick={() => openEditReward(reward)}
                    className={`!p-4 cursor-pointer hover:border-nori-500/30 transition-all active:scale-95 group ${reward.isUnlocked ? "" : "opacity-75"}`}
                  >
                    <div className="flex flex-col items-center gap-2 text-center">
                      <span className="text-3xl group-hover:scale-110 transition-transform">{reward.emoji}</span>
                      <p className="text-text-primary text-sm font-bold leading-tight">{reward.title}</p>
                      <div className="mt-1 flex items-center gap-1.5 bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/20">
                        <span className="text-amber-500 text-[10px] font-black uppercase">Cost</span>
                        <span className="text-amber-400 text-xs font-bold">{reward.cost}</span>
                      </div>
                    </div>
                  </Card>
                ))}
                {rewards.length === 0 && (
                  <div className="col-span-2 py-8 text-center glass rounded-2xl border border-dashed border-surface-3">
                    <p className="text-text-muted text-sm italic">No rewards added yet.</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>

      <Modal isOpen={isMemberSelectOpen} onClose={() => setIsMemberSelectOpen(false)} title="Who completed this?">
        <div className="grid grid-cols-2 gap-3">
          {members.map((member) => (
            <button
              key={member.id}
              onClick={() => handleMemberComplete(member.id)}
              className="flex flex-col items-center gap-3 p-4 rounded-3xl bg-surface-2 border border-surface-3 hover:border-nori-500/50 hover:bg-nori-500/5 transition-all group"
            >
              <div className="w-16 h-16 rounded-2xl bg-surface-3 flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">
                {member.emoji}
              </div>
              <span className="font-bold text-text-primary">{member.name}</span>
            </button>
          ))}
        </div>
      </Modal>

      <TaskEditor 
        isOpen={isTaskEditorOpen} 
        onClose={() => setIsTaskEditorOpen(false)} 
        members={members} 
        task={editingTask}
      />
      
      <RewardEditor 
        isOpen={isRewardEditorOpen} 
        onClose={() => setIsRewardEditorOpen(false)} 
        reward={editingReward}
      />
    </PageShell>
  );
}

function TaskRow({ task, assignee, onToggle, onEdit }: any) {
  const isCompleted = task.status === "completed";
  
  return (
    <Card className={`!p-3 ${isCompleted ? "opacity-50" : ""} group`}>
      <div className="flex items-center gap-3">
        <button
          onClick={onToggle}
          className={`w-6 h-6 rounded-lg border-2 shrink-0 flex items-center justify-center transition-all ${
            isCompleted ? "border-nori-500 bg-nori-500 shadow-lg shadow-nori-500/20" : "border-surface-4 hover:border-nori-500/50"
          }`}
        >
          {isCompleted && (
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} className="w-3.5 h-3.5">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>

        <div className="flex-1 min-w-0 text-left cursor-pointer" onClick={onEdit}>
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${priorityColors[task.priority]}`} />
            <span className="text-base leading-none">{task.emoji || "📝"}</span>
            <p className={`text-sm font-semibold truncate ${isCompleted ? "line-through text-text-muted" : "text-text-primary"}`}>
              {task.title}
            </p>
          </div>
          <p className="text-[10px] text-text-muted mt-0.5 flex items-center gap-1.5">
            <span>📅 {task.dueDate || "No date"}</span>
            {task.recurring && <span className="bg-surface-3 px-1.5 rounded text-[8px] uppercase tracking-tighter">🔄 Recurring</span>}
            <span className="ml-auto text-nori-400 font-bold">{task.category}</span>
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex flex-col items-end">
            <span className="text-xs font-black text-amber-400">+{task.points}</span>
            <span className="text-[8px] text-text-muted uppercase font-bold tracking-tighter">pts</span>
          </div>
          <Avatar
            name={assignee?.name || "Unassigned"}
            color={memberColors[assignee?.role] || "slate"}
            emoji={assignee?.emoji || "👤"}
            size="sm"
            variant="emoji"
          />
        </div>
      </div>
    </Card>
  );
}
