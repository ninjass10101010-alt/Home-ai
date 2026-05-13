"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { addTask, updateTask } from "@/actions/tasks";
import { MemberRole } from "@/actions/members";

interface TaskEditorProps {
  isOpen: boolean;
  onClose: () => void;
  members: { id: number; name: string; emoji: string | null }[];
  task?: any; // If provided, we are editing
}

const TASK_EMOJI_PRESETS = ["📝", "🗑️", "🍽️", "🧹", "🐕", "🛒", "💊", "🚗", "🧺", "🌱"];

export default function TaskEditor({ isOpen, onClose, members, task }: TaskEditorProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: task?.title || "",
    description: task?.description || "",
    priority: task?.priority || "medium",
    assignedTo: task?.assignedTo || "",
    points: task?.points || 10,
    category: task?.category || "Chores",
    emoji: task?.emoji || "📝",
    recurring: task?.recurring || false,
    dueDate: task?.dueDate || new Date().toISOString().split("T")[0],
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = {
        ...formData,
        assignedTo: formData.assignedTo ? Number(formData.assignedTo) : undefined,
        status: task?.status || "pending",
      } as any;

      if (task) {
        await updateTask(task.id, data);
      } else {
        await addTask(data);
      }
      onClose();
    } catch (error) {
      console.error("Failed to save task:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={task ? "Edit Task" : "New Task"}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-4">
          <div className="flex justify-center">
            <div className="w-20 h-20 rounded-2xl bg-surface-2 border border-surface-3 flex items-center justify-center text-4xl shadow-inner">
              {formData.emoji}
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {TASK_EMOJI_PRESETS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setFormData({ ...formData, emoji: e })}
                className={`w-9 h-9 flex items-center justify-center rounded-xl text-lg transition-all ${
                  formData.emoji === e
                    ? "bg-nori-500/20 border border-nori-500 scale-110"
                    : "bg-surface-2 border border-surface-3 hover:border-surface-4"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Title</label>
          <input
            type="text"
            required
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="e.g. Clean the garage"
            className="w-full bg-surface-2 border border-surface-3 rounded-2xl px-4 py-3 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-nori-500/50 transition-all"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Points</label>
            <input
              type="number"
              required
              value={formData.points}
              onChange={(e) => setFormData({ ...formData, points: parseInt(e.target.value) })}
              className="w-full bg-surface-2 border border-surface-3 rounded-2xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-nori-500/50 transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Priority</label>
            <select
              value={formData.priority}
              onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
              className="w-full bg-surface-2 border border-surface-3 rounded-2xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-nori-500/50 transition-all appearance-none"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Assign To</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setFormData({ ...formData, assignedTo: "" })}
              className={`flex items-center gap-3 p-3 rounded-2xl border transition-all ${
                formData.assignedTo === ""
                  ? "bg-nori-500/10 border-nori-500 text-nori-400"
                  : "bg-surface-2 border-surface-3 text-text-secondary hover:border-surface-4"
              }`}
            >
              <span className="text-xl">👨‍👩‍👧‍👦</span>
              <span className="font-medium text-sm">Everyone</span>
            </button>
            {members.map((member) => (
              <button
                key={member.id}
                type="button"
                onClick={() => setFormData({ ...formData, assignedTo: member.id.toString() })}
                className={`flex items-center gap-3 p-3 rounded-2xl border transition-all ${
                  formData.assignedTo == member.id.toString()
                    ? "bg-nori-500/10 border-nori-500 text-nori-400"
                    : "bg-surface-2 border-surface-3 text-text-secondary hover:border-surface-4"
                }`}
              >
                <span className="text-xl">{member.emoji}</span>
                <span className="font-medium text-sm">{member.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Category</label>
          <input
            type="text"
            value={formData.category}
            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            placeholder="e.g. Chores, Errands, Pets"
            className="w-full bg-surface-2 border border-surface-3 rounded-2xl px-4 py-3 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-nori-500/50 transition-all"
          />
        </div>

        <div className="flex items-center gap-3 p-4 bg-surface-2 rounded-2xl border border-surface-3">
          <input
            type="checkbox"
            id="recurring"
            checked={formData.recurring}
            onChange={(e) => setFormData({ ...formData, recurring: e.target.checked })}
            className="w-5 h-5 rounded-lg border-2 border-surface-4 bg-surface-3 checked:bg-nori-500 checked:border-nori-500 transition-all cursor-pointer"
          />
          <label htmlFor="recurring" className="text-sm font-medium text-text-primary cursor-pointer select-none">
            Recurring Task
          </label>
        </div>

        <div className="pt-4 flex gap-3">
          <Button type="button" variant="ghost" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" loading={loading} className="flex-1">
            {task ? "Save Changes" : "Create Task"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
