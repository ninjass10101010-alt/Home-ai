"use client";
import { useState } from "react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { groceryCategories, groceryPresets } from "@/data/meals";
import { GroceryItem } from "@/types/meals";

// Show only a subset of presets initially, user can expand
const PRESETS_PER_PAGE = 12;

export default function GroceryTab({
  groceryItems,
  setGroceryItems,
  activeCategory,
  setActiveCategory,
  isSyncing,
  recentlyBought,
  clearRecentlyBought,
  addGroceryItem,
  toggleGroceryNeeded,
  deleteGroceryItem,
  updateGroceryItem,
  syncMealToGrocery,
  syncPantryToGrocery,
}: any) {
  const [newGroceryItem, setNewGroceryItem] = useState("");
  const [newGroceryCategory, setNewGroceryCategory] = useState("pantry");
  const [newGroceryPriority, setNewGroceryPriority] = useState<"low" | "medium" | "high">("medium");
  const [editingGroceryId, setEditingGroceryId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editQuantity, setEditQuantity] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [presetCategory, setPresetCategory] = useState<string>("produce");
  const [showAllPresets, setShowAllPresets] = useState(false);

  const handleAdd = () => {
    if (!newGroceryItem.trim()) return;
    addGroceryItem(newGroceryItem, newGroceryCategory, newGroceryPriority);
    setNewGroceryItem("");
  };

  const handlePresetTap = (preset: { name: string; emoji: string; category: string }) => {
    addGroceryItem(preset.name, preset.category, "medium", preset.emoji);
  };

  const handleRecentTap = (item: { name: string; emoji: string; category: string }) => {
    addGroceryItem(item.name, item.category, "medium", item.emoji);
  };

  const startEditing = (item: GroceryItem) => {
    setEditingGroceryId(item.id);
    setEditName(item.name);
    setEditQuantity(item.quantity || "");
    setEditNotes(item.notes || "");
  };

  const saveEdit = (id: number) => {
    updateGroceryItem(id, { name: editName, quantity: editQuantity, notes: editNotes });
    setEditingGroceryId(null);
  };

  const filteredGrocery = activeCategory === "all" ? groceryItems : groceryItems.filter((i: any) => i.category === activeCategory);

  // Filtered presets by selected category tab
  const categoryPresets = groceryPresets.filter(p => p.category === presetCategory);
  const visiblePresets = showAllPresets ? categoryPresets : categoryPresets.slice(0, PRESETS_PER_PAGE);

  return (
    <div className="px-4 space-y-4 pb-4">

      {/* ── Quick Add Card ─────────────────────────────── */}
      <Card className="!p-4">
        <p className="text-text-secondary text-xs font-semibold mb-3 flex items-center gap-1.5">
          <span>➕</span> Add Item
        </p>
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              value={newGroceryItem}
              onChange={e => setNewGroceryItem(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAdd()}
              placeholder="What do you need?"
              className="flex-1 bg-transparent text-text-primary text-sm outline-none placeholder:text-text-muted"
            />
            <select
              value={newGroceryCategory}
              onChange={e => setNewGroceryCategory(e.target.value)}
              className="bg-[var(--color-surface-2)] text-text-secondary text-xs rounded-lg px-2 outline-none"
            >
              {groceryCategories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.emoji} {cat.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <select
              value={newGroceryPriority}
              onChange={e => setNewGroceryPriority(e.target.value as "low" | "medium" | "high")}
              className="bg-[var(--color-surface-2)] text-text-secondary text-xs rounded-lg px-2 outline-none"
            >
              <option value="low">🟢 Low</option>
              <option value="medium">🟡 Medium</option>
              <option value="high">🔴 High</option>
            </select>
            <button
              onClick={handleAdd}
              disabled={!newGroceryItem.trim()}
              className="flex-1 px-4 py-2 rounded-xl bg-[var(--color-accent-nori)] text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-all"
            >
              Add to List
            </button>
          </div>
        </div>

        {/* ── Recently Bought ──────────────────────────── */}
        {recentlyBought && recentlyBought.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-text-muted flex items-center gap-1">
                <span>🕐</span> Recently Bought
              </p>
              <button
                onClick={clearRecentlyBought}
                className="text-[10px] text-text-muted hover:text-[var(--color-accent-rose)] transition-colors"
              >
                clear
              </button>
            </div>
            <div className="flex gap-2 flex-wrap">
              {recentlyBought.map((item: { name: string; emoji: string; category: string }) => (
                <button
                  key={item.name}
                  onClick={() => handleRecentTap(item)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium
                    bg-[var(--color-accent-amber)]/10 border border-[var(--color-accent-amber)]/20
                    text-[var(--color-accent-amber)] hover:bg-[var(--color-accent-amber)]/20
                    transition-all active:scale-95 animate-in"
                >
                  <span>{item.emoji}</span>
                  <span>{item.name}</span>
                  <span className="opacity-60">+</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Preset Chips ─────────────────────────────── */}
        <div className="mt-4">
          <p className="text-[11px] font-semibold text-text-muted mb-2 flex items-center gap-1">
            <span>⚡</span> Quick Add
          </p>
          {/* Category tabs for presets */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 mb-2 no-scrollbar">
            {groceryCategories.map(cat => (
              <button
                key={cat.id}
                onClick={() => { setPresetCategory(cat.id); setShowAllPresets(false); }}
                className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all ${
                  presetCategory === cat.id
                    ? "bg-[var(--color-accent-selected)] text-white"
                    : "bg-[var(--color-surface-3)] text-text-secondary hover:text-text-primary"
                }`}
              >
                {cat.emoji} {cat.name}
              </button>
            ))}
          </div>
          {/* Preset pills */}
          <div className="flex gap-2 flex-wrap">
            {visiblePresets.map(preset => (
              <button
                key={preset.name}
                onClick={() => handlePresetTap(preset)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium
                  glass border border-[var(--color-surface-7)]/20
                  text-text-secondary hover:text-text-primary
                  hover:border-[var(--color-accent-selected)]/30 hover:bg-[var(--color-accent-selected)]/5
                  transition-all active:scale-95 animate-in"
              >
                <span>{preset.emoji}</span>
                <span>{preset.name}</span>
                <span className="text-[var(--color-accent-selected)] opacity-70">+</span>
              </button>
            ))}
          </div>
          {categoryPresets.length > PRESETS_PER_PAGE && (
            <button
              onClick={() => setShowAllPresets(v => !v)}
              className="mt-2 text-[11px] text-[var(--color-accent-selected)] hover:opacity-80 transition-opacity"
            >
              {showAllPresets ? "Show less ↑" : `Show ${categoryPresets.length - PRESETS_PER_PAGE} more ↓`}
            </button>
          )}
        </div>
      </Card>

      {/* ── Sync Buttons ──────────────────────────────── */}
      <div className="flex gap-2">
        <button
          onClick={syncMealToGrocery}
          disabled={isSyncing}
          className="flex-1 py-2 rounded-xl bg-[var(--color-accent-nori)]/10 text-[var(--color-accent-nori)] text-xs font-medium border border-[var(--color-accent-nori)]/20 hover:bg-[var(--color-accent-nori)]/20 transition-colors disabled:opacity-60"
        >
          🍽️ Sync from Meals
        </button>
        <button
          onClick={syncPantryToGrocery}
          disabled={isSyncing}
          className="flex-1 py-2 rounded-xl glass text-text-secondary text-xs font-medium border border-[var(--color-surface-3)] hover:text-text-primary transition-colors disabled:opacity-60"
        >
          🥫 Sync from Pantry
        </button>
      </div>

      {/* ── Category Filter ───────────────────────────── */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 no-scrollbar">
        <button
          onClick={() => setActiveCategory("all")}
          className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${activeCategory === "all" ? "bg-[var(--color-accent-nori)] text-white" : "glass text-text-secondary hover:text-text-primary"}`}
        >
          All
        </button>
        {groceryCategories.map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${activeCategory === cat.id ? "bg-[var(--color-accent-nori)] text-white" : "glass text-text-secondary hover:text-text-primary"}`}
          >
            {cat.emoji} {cat.name}
          </button>
        ))}
      </div>

      {/* ── Grocery Items by Category ─────────────────── */}
      {groceryCategories.map(cat => {
        const catItems = filteredGrocery.filter((i: any) => i.category === cat.id);
        if (catItems.length === 0) return null;
        const neededCnt = catItems.filter((i: any) => i.needed).length;
        return (
          <section key={cat.id}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">{cat.emoji}</span>
                <h3 className="text-text-primary font-semibold text-sm">{cat.name}</h3>
              </div>
              <span className="text-xs text-[var(--color-accent-nori)]">{neededCnt} needed</span>
            </div>
            <Card className="!p-0 overflow-hidden">
              <div className="divide-y divide-[var(--color-surface-3)]">
                {catItems.map((item: any) => (
                  <div key={item.id} className="p-3">
                    {editingGroceryId === item.id ? (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Name" className="flex-1 bg-transparent text-text-primary text-sm outline-none" />
                          <input value={editQuantity} onChange={e => setEditQuantity(e.target.value)} placeholder="Qty" className="w-16 bg-[var(--color-surface-2)] text-text-secondary text-xs rounded px-2 outline-none" />
                        </div>
                        <input value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Notes (optional)" className="w-full bg-transparent text-text-secondary text-xs outline-none" />
                        <div className="flex gap-2">
                          <button onClick={() => saveEdit(item.id)} className="px-3 py-1 rounded-lg bg-[var(--color-accent-nori)] text-white text-xs font-medium">Save</button>
                          <button onClick={() => setEditingGroceryId(null)} className="px-3 py-1 rounded-lg text-text-secondary text-xs">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => toggleGroceryNeeded(item.id)}
                          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all ${item.needed ? "border-2 border-[var(--color-surface-4)]" : "bg-[var(--color-accent-nori)]"}`}
                        >
                          {!item.needed && (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-3.5 h-3.5 text-white">
                              <path d="M5 12l5 5 9-9" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                        <span className="text-lg">{item.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${!item.needed ? "text-text-muted line-through" : "text-text-primary"}`}>{item.name}</p>
                          {item.quantity && <p className="text-xs text-text-muted">Qty: {item.quantity}</p>}
                        </div>
                        <Badge variant={item.priority === "high" ? "rose" : item.priority === "medium" ? "amber" : "green"}>
                          {item.priority}
                        </Badge>
                        <div className="flex gap-1">
                          <button onClick={() => startEditing(item)} className="p-1.5 rounded-lg hover:bg-[var(--color-surface-2)] text-text-muted hover:text-text-primary transition-colors">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                          <button onClick={() => deleteGroceryItem(item.id)} className="p-1.5 rounded-lg hover:bg-[var(--color-accent-rose)]/10 text-text-muted hover:text-[var(--color-accent-rose)] transition-colors">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                              <path d="M3 6h18M19 6l-1 14H6L5 6M8 6V4h8v2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </section>
        );
      })}

      {/* ── Bulk Actions ─────────────────────────────── */}
      <div className="flex gap-2 pb-4">
        <button
          className="flex-1 py-2 rounded-xl bg-[var(--color-surface-2)] text-text-secondary text-xs font-medium hover:bg-[var(--color-accent-nori)]/15 hover:text-[var(--color-accent-nori)] transition-colors"
        >
          Mark All Needed
        </button>
        <button
          onClick={() => {
            // Clear all grocery items that are not needed (completed)
            // Assumes `needed === false` means completed.
            groceryItems
              .filter((i: any) => !i.needed)
              .forEach((i: any) => deleteGroceryItem(i.id));
          }}
          className="flex-1 py-2 rounded-xl bg-[var(--color-surface-2)] text-text-secondary text-xs font-medium hover:bg-[var(--color-accent-rose)]/15 hover:text-[var(--color-accent-rose)] transition-colors"
        >
          Clear Completed
        </button>
      </div>
    </div>
  );
}
