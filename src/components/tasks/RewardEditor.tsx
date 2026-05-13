"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { addReward, updateReward } from "@/actions/rewards";

interface RewardEditorProps {
  isOpen: boolean;
  onClose: () => void;
  reward?: any;
}

const EMOJI_PRESETS = ["🎁", "🎬", "🎟️", "📱", "🎡", "🍕", "🎮", "🍦", "💤", "🚲"];

export default function RewardEditor({ isOpen, onClose, reward }: RewardEditorProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: reward?.title || "",
    description: reward?.description || "",
    emoji: reward?.emoji || "🎁",
    cost: reward?.cost || 50,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (reward) {
        await updateReward(reward.id, formData);
      } else {
        await addReward(formData);
      }
      onClose();
    } catch (error) {
      console.error("Failed to save reward:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={reward ? "Edit Reward" : "New Reward"}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="flex justify-center">
          <div className="relative group">
            <div className="w-24 h-24 rounded-3xl bg-surface-2 border border-surface-3 flex items-center justify-center text-5xl group-hover:bg-surface-3 transition-colors cursor-default">
              {formData.emoji}
            </div>
            <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-nori-500 text-white flex items-center justify-center shadow-lg">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {EMOJI_PRESETS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setFormData({ ...formData, emoji: e })}
              className={`w-10 h-10 flex items-center justify-center rounded-xl text-xl transition-all ${
                formData.emoji === e
                  ? "bg-nori-500/20 border border-nori-500 scale-110"
                  : "bg-surface-2 border border-surface-3 hover:border-surface-4"
              }`}
            >
              {e}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Reward Title</label>
          <input
            type="text"
            required
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="e.g. Pizza Night"
            className="w-full bg-surface-2 border border-surface-3 rounded-2xl px-4 py-3 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-nori-500/50 transition-all"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Point Cost</label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="10"
              max="500"
              step="10"
              value={formData.cost}
              onChange={(e) => setFormData({ ...formData, cost: parseInt(e.target.value) })}
              className="flex-1 accent-nori-500"
            />
            <div className="w-20 text-center font-bold text-nori-400 bg-nori-500/10 py-2 rounded-xl border border-nori-500/20">
              {formData.cost}
            </div>
          </div>
          <div className="flex justify-between text-[10px] text-text-muted font-medium px-1">
            <span>Small (10)</span>
            <span>Epic (500)</span>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Description (Optional)</label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="What makes this reward special?"
            rows={2}
            className="w-full bg-surface-2 border border-surface-3 rounded-2xl px-4 py-3 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-nori-500/50 transition-all resize-none"
          />
        </div>

        <div className="pt-2 flex gap-3">
          <Button type="button" variant="ghost" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" loading={loading} className="flex-1">
            {reward ? "Update Reward" : "Create Reward"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
