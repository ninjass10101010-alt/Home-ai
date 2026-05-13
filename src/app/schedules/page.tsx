"use client";

import { useEffect, useState } from "react";
import PageShell from "@/components/ui/PageShell";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Avatar from "@/components/ui/Avatar";
import { getSchedules, addSchedule, updateSchedule, deleteSchedule } from "@/actions/schedules";
import { getMembers } from "@/actions/members";
import { motion, AnimatePresence } from "framer-motion";

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSchedule, setEditingSchedule] = useState<any>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  useEffect(() => {
    Promise.all([getSchedules(), getMembers()]).then(([sData, mData]) => {
      setSchedules(sData);
      setMembers(mData);
      setLoading(false);
    });
  }, []);

  const handleAdd = () => {
    setEditingSchedule({
      title: "",
      time: "08:00",
      days: JSON.stringify(["all"]),
      type: "routine",
      icon: "⏰",
      color: "nori",
      memberId: null
    });
    setIsFormOpen(true);
  };

  const handleEdit = (schedule: any) => {
    setEditingSchedule(schedule);
    setIsFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const selectedDays = formData.getAll("days");
    const data = {
      title: formData.get("title") as string,
      time: formData.get("time") as string,
      days: JSON.stringify(selectedDays.length > 0 ? selectedDays : ["all"]),
      type: (formData.get("type") as "routine" | "reminder") || "routine",
      icon: formData.get("icon") as string,
      color: formData.get("color") as string || "nori",
      memberId: formData.get("memberId") ? parseInt(formData.get("memberId") as string) : null,
    };

    if (editingSchedule.id) {
      await updateSchedule(editingSchedule.id, data);
    } else {
      await addSchedule(data as any);
    }

    const updatedSchedules = await getSchedules();
    setSchedules(updatedSchedules);
    setIsFormOpen(false);
    setEditingSchedule(null);
  };

  const handleDelete = async (id: number) => {
    if (confirm("Are you sure you want to delete this schedule?")) {
      await deleteSchedule(id);
      const updatedSchedules = await getSchedules();
      setSchedules(updatedSchedules);
    }
  };

  if (loading) return null;

  return (
    <PageShell>
      <TopBar 
        title="Schedules" 
        subtitle="Manage daily routines"
        right={
          <button 
            onClick={handleAdd}
            className="w-10 h-10 rounded-xl bg-nori-500 text-white flex items-center justify-center shadow-lg shadow-nori-500/20 active:scale-95 transition-all"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-5 h-5">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </button>
        }
      />

      <div className="px-4 space-y-3 pb-20">
        {schedules.length === 0 && (
          <div className="py-12 text-center">
            <div className="text-4xl mb-4">🗓️</div>
            <p className="text-text-secondary">No schedules set yet.</p>
            <button 
              onClick={handleAdd}
              className="mt-4 text-nori-400 font-medium"
            >
              Add your first routine
            </button>
          </div>
        )}

        {schedules.sort((a, b) => a.time.localeCompare(b.time)).map((s) => {
          const member = members.find(m => m.id === s.memberId);
          return (
            <Card key={s.id} className="!p-4 group">
              <div className="flex items-center gap-4">
                <div className="text-2xl w-10 h-10 flex items-center justify-center bg-surface-2 rounded-xl">
                  {s.icon || "⏰"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-text-primary font-semibold text-sm">{s.title}</h3>
                    <span className="text-[10px] uppercase font-bold text-nori-400 bg-nori-400/10 px-1.5 py-0.5 rounded">
                      {s.time}
                    </span>
                  </div>
                  <p className="text-text-muted text-xs mt-0.5">
                    {JSON.parse(s.days).includes("all") ? "Every day" : JSON.parse(s.days).join(", ")}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {member && (
                    <Avatar 
                      name={member.name} 
                      emoji={member.emoji} 
                      size="sm" 
                      variant="emoji" 
                    />
                  )}
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => handleEdit(s)}
                      className="p-2 text-text-muted hover:text-nori-400 transition-colors"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button 
                      onClick={() => handleDelete(s.id)}
                      className="p-2 text-text-muted hover:text-rose-400 transition-colors"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                        <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Edit Form Modal */}
      <AnimatePresence>
        {isFormOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsFormOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              className="relative w-full max-w-lg bg-surface-1 rounded-t-[2.5rem] sm:rounded-[2.5rem] p-8 shadow-2xl border border-white/10"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-text-primary">
                  {editingSchedule.id ? "Edit Schedule" : "New Schedule"}
                </h2>
                <button 
                  onClick={() => setIsFormOpen(false)}
                  className="p-2 text-text-muted hover:text-text-primary transition-colors"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6">
                    <path d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleSave} className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Title</label>
                  <input 
                    name="title"
                    defaultValue={editingSchedule.title}
                    required
                    className="w-full bg-surface-2 border border-white/5 rounded-2xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-nori-500/50 transition-all"
                    placeholder="e.g., Morning Wake up"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Time</label>
                    <input 
                      name="time"
                      type="time"
                      defaultValue={editingSchedule.time}
                      required
                      className="w-full bg-surface-2 border border-white/5 rounded-2xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-nori-500/50 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Icon</label>
                    <input 
                      name="icon"
                      defaultValue={editingSchedule.icon}
                      className="w-full bg-surface-2 border border-white/5 rounded-2xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-nori-500/50 transition-all text-center text-xl"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Type</label>
                    <select 
                      name="type"
                      defaultValue={editingSchedule.type}
                      className="w-full bg-surface-2 border border-white/5 rounded-2xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-nori-500/50 transition-all appearance-none"
                    >
                      <option value="routine">Routine</option>
                      <option value="reminder">Reminder</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Color</label>
                    <select 
                      name="color"
                      defaultValue={editingSchedule.color}
                      className="w-full bg-surface-2 border border-white/5 rounded-2xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-nori-500/50 transition-all appearance-none"
                    >
                      <option value="nori">Nori (Blue)</option>
                      <option value="green">Green</option>
                      <option value="amber">Amber</option>
                      <option value="violet">Violet</option>
                      <option value="cyan">Cyan</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Assigned To</label>
                  <select 
                    name="memberId"
                    defaultValue={editingSchedule.memberId || ""}
                    className="w-full bg-surface-2 border border-white/5 rounded-2xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-nori-500/50 transition-all appearance-none"
                  >
                    <option value="">Whole Family</option>
                    {members.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Days</label>
                  <div className="flex flex-wrap gap-2">
                    {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map(day => (
                      <label key={day} className="cursor-pointer">
                        <input 
                          type="checkbox" 
                          name="days" 
                          value={day} 
                          className="hidden peer"
                          defaultChecked={editingSchedule.days.includes(day) || editingSchedule.days.includes("all")}
                        />
                        <div className="px-3 py-1.5 rounded-full border border-white/5 bg-surface-2 text-xs font-medium text-text-muted peer-checked:bg-nori-500/20 peer-checked:text-nori-400 peer-checked:border-nori-500/30 transition-all">
                          {day.charAt(0).toUpperCase() + day.slice(1)}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="pt-4">
                  <button 
                    type="submit"
                    className="w-full bg-nori-500 text-white font-bold py-4 rounded-2xl shadow-xl shadow-nori-500/20 active:scale-[0.98] transition-all"
                  >
                    {editingSchedule.id ? "Save Changes" : "Create Schedule"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </PageShell>
  );
}
