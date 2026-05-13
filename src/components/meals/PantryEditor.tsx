"use client";

import { useState, useEffect } from "react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { updatePantryItem, addPantryItem } from "@/actions/grocery";

interface PantryEditorProps {
  isOpen: boolean;
  onClose: () => void;
  pantryItem?: any;
}

const PANTRY_EMOJI_CATEGORIES: Record<string, string[]> = {
  produce: ["🥬", "🍎", "🍌", "🥑", "🥦", "🥕", "🍓", "🫐", "🍇", "🍒", "🥭", "🍍", "🍉", "🍊", "🍋", "🍋‍🟩", "🫑", "🌽", "🍄", "🥒", "🧅", "🥔", "🧄"],
  dairy: ["🥛", "🥚", "🧀", "🧈", "🍦", "🥣"],
  meat: ["🥩", "🍗", "🥓", "🍖", "🐟", "🍤"],
  pantry: ["🍝", "🍚", "🥫", "🧂", "🍯", "🍞", "🥨", "🥜", "🫒", "🍪", "🥐", "📦"],
};

export default function PantryEditor({ isOpen, onClose, pantryItem }: PantryEditorProps) {
  const [loading, setLoading] = useState(false);
  const [activeEmojiCategory, setActiveEmojiCategory] = useState<string>("pantry");
  const [formData, setFormData] = useState({
    name: "",
    emoji: "📦",
    status: "enough",
    category: "pantry",
  });

  useEffect(() => {
    if (isOpen) {
      setFormData({
        name: pantryItem?.name || "",
        emoji: pantryItem?.emoji || "📦",
        status: pantryItem?.status || "enough",
        category: pantryItem?.category || "pantry",
      });
    }
  }, [isOpen, pantryItem]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (pantryItem) {
        await updatePantryItem(pantryItem.id, formData);
      } else {
        await addPantryItem(formData);
      }
      onClose();
    } catch (error) {
      console.error("Failed to save pantry item:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={pantryItem ? "Edit Pantry Item" : "Add to Pantry"}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-4">
          <div className="flex justify-center">
            <div className="w-24 h-24 rounded-3xl bg-surface-2 border border-surface-3 flex items-center justify-center text-5xl shadow-inner group">
              {formData.emoji}
            </div>
          </div>
          
          <div className="bg-surface-2 border border-surface-3 rounded-2xl overflow-hidden">
            <div className="flex p-2 gap-2 overflow-x-auto border-b border-surface-3 bg-surface-1/50 scrollbar-hide">
              {Object.keys(PANTRY_EMOJI_CATEGORIES).map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveEmojiCategory(cat)}
                  className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                    activeEmojiCategory === cat ? "bg-nori-500 text-white" : "text-text-muted hover:bg-surface-3"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 p-3 overflow-y-auto max-h-32 bg-surface-2 scrollbar-hide">
              {PANTRY_EMOJI_CATEGORIES[activeEmojiCategory].map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setFormData({ ...formData, emoji: e })}
                  className={`w-10 h-10 flex items-center justify-center rounded-xl text-2xl transition-all ${
                    formData.emoji === e ? "bg-nori-500/20 border border-nori-500 scale-110" : "bg-surface-2 border border-surface-3 hover:border-surface-4"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-text-muted uppercase">Item Name</label>
          <input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full bg-surface-2 border border-surface-3 rounded-2xl p-4 text-text-primary"
            placeholder="e.g. Olive Oil"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-text-muted uppercase">Stock Level</label>
          <div className="grid grid-cols-4 gap-2">
            {(["plenty", "enough", "low", "out"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFormData({ ...formData, status: s })}
                className={`py-2 rounded-xl border text-[10px] font-bold uppercase transition-all ${
                  formData.status === s 
                    ? "bg-nori-500/10 border-nori-500 text-nori-400" 
                    : "bg-surface-2 border-surface-3 text-text-muted"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <Button type="submit" loading={loading} className="w-full py-4">
          Save Changes
        </Button>
      </form>
    </Modal>
  );
}
