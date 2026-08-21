"use client";
import { useState, useEffect, useRef } from "react";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import Chip from "@/components/ui/Chip";
import TextField from "@/components/ui/TextField";
import ListRow from "@/components/ui/ListRow";
import SectionCard from "@/components/patterns/SectionCard";
import { groceryCategories, groceryPresets } from "@/data/meals";
import { GroceryItem } from "@/types/meals";
import { parseQuantityString } from "@/lib/grocery-service";

const PRESETS_PER_PAGE = 6;
const UNDO_MS = 8000;

const normalizeName = (name: string) => name.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

export default function GroceryTab({
  groceryItems,
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
  parseManualGroceryInput,
  guessCategory,
  showToast,
  pantryItems,
  addPantryItem,
  removePantryItem,
}: any) {
  const [newGroceryItem, setNewGroceryItem] = useState("");
  const [newGroceryQuantity, setNewGroceryQuantity] = useState("");
  const [newGroceryCategory, setNewGroceryCategory] = useState("auto");
  const [newGroceryPriority, setNewGroceryPriority] = useState<"low" | "medium" | "high">("medium");
  const [editingGroceryId, setEditingGroceryId] = useState<number | string | null>(null);
  const [editName, setEditName] = useState("");
  const [editQuantity, setEditQuantity] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [presetCategory, setPresetCategory] = useState<string>("produce");
  const [showAllPresets, setShowAllPresets] = useState(false);
  const [undo, setUndo] = useState<{ pantryIds: (number | string)[]; items: GroceryItem[]; added: number } | null>(null);
  const [sending, setSending] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  const pushUndo = (snapshot: { pantryIds: (number | string)[]; items: GroceryItem[]; added: number }) => {
    setUndo(snapshot);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
  };

  const handleAdd = async () => {
    if (!newGroceryItem.trim()) return;
    const parsed = parseManualGroceryInput(newGroceryItem);
    const category = newGroceryCategory === "auto" ? guessCategory(parsed.name) : newGroceryCategory;
    await addGroceryItem(parsed.name, category, newGroceryPriority, undefined, parsed.quantity || newGroceryQuantity, "");
    setNewGroceryItem("");
    setNewGroceryQuantity("");
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

  const saveEdit = (id: number | string) => {
    updateGroceryItem(id, { name: editName.trim(), quantity: editQuantity.trim(), notes: editNotes.trim() });
    setEditingGroceryId(null);
  };

  const sendSingleToPantry = async (item: GroceryItem) => {
    if (sending) return;
    setSending(true);
    try {
      const inPantry = (pantryItems || []).some((p: any) => normalizeName(p.item || p.name) === normalizeName(item.name));
      const { quantityValue, unit } = parseQuantityString(item.quantity || "");
      if (!inPantry) {
        const saved: any = await addPantryItem(item.name, "plenty", { quantity: quantityValue, unit, silent: true });
        if (!saved) {
          showToast(`❌ Couldn't add ${item.name} to pantry — it stays on your list`);
          return;
        }
        pushUndo({ pantryIds: [saved.id], items: [item], added: 1 });
      }
      await deleteGroceryItem(item.id);
      showToast(inPantry ? `🥫 ${item.name} was already stocked — removed from your list` : `🥫 Sent ${item.name} to pantry`);
    } finally {
      setSending(false);
    }
  };

  const sendCheckedToPantry = async () => {
    if (sending) return;
    const checked = groceryItems.filter((i: any) => !i.needed);
    if (!checked.length) return;
    setSending(true);
    try {
      const pantryIds: (number | string)[] = [];
      const sentItems: GroceryItem[] = [];
      let added = 0;
      let already = 0;
      let failed = 0;
      for (const item of checked) {
        const inPantry = (pantryItems || []).some((p: any) => normalizeName(p.item || p.name) === normalizeName(item.name));
        if (inPantry) { already++; continue; }
        const { quantityValue, unit } = parseQuantityString(item.quantity || "");
        const saved: any = await addPantryItem(item.name, "plenty", { quantity: quantityValue, unit, silent: true });
        if (saved && typeof saved === "object") {
          added++;
          pantryIds.push(saved.id);
          sentItems.push(item);
        } else {
          failed++;
        }
      }
      const removable = checked.filter((i: any) =>
        failed === 0 || (pantryItems || []).some((p: any) => normalizeName(p.item || p.name) === normalizeName(i.name)) || sentItems.some(s => s.id === i.id)
      );
      for (const item of removable) await deleteGroceryItem(item.id);
      if (added > 0) pushUndo({ pantryIds, items: sentItems, added });
      if (failed === 0) {
        showToast(already === 0
          ? `🥫 Sent ${added} item${added === 1 ? "" : "s"} to pantry`
          : `🥫 Sent ${added} of ${added + already} to pantry (${already} already stocked)`);
      } else {
        showToast(`🥫 Sent ${added} to pantry (${already} already stocked, ${failed} failed — kept on list)`);
      }
    } finally {
      setSending(false);
    }
  };

  const handleUndo = async () => {
    if (!undo || undoing) return;
    const snap = undo;
    setUndoing(true);
    try {
      if (undoTimer.current) clearTimeout(undoTimer.current);
      for (const id of snap.pantryIds) await removePantryItem(id);
      for (const item of snap.items) {
        await addGroceryItem(item.name, item.category, item.priority, item.emoji, item.quantity || "", item.notes || "", true, true);
      }
      setUndo(prev => prev === snap ? null : prev);
      showToast(`↩️ Restored ${undo.items.length} item${undo.items.length === 1 ? "" : "s"} to grocery`);
    } finally {
      setUndoing(false);
    }
  };

  const clearCompleted = () => {
    groceryItems
      .filter((i: any) => !i.needed)
      .forEach((i: any) => deleteGroceryItem(i.id));
  };

  const markAllNeeded = () => {
    groceryItems
      .filter((i: any) => i.needed === false)
      .forEach((i: any) => toggleGroceryNeeded(i.id));
  };

  const filteredGrocery = activeCategory === "all" ? groceryItems : groceryItems.filter((i: any) => i.category === activeCategory);
  const categoryPresets = groceryPresets.filter(p => p.category === presetCategory);
  const visiblePresets = showAllPresets ? categoryPresets : categoryPresets.slice(0, PRESETS_PER_PAGE);
  const selectedCat = groceryCategories.find(c => c.id === presetCategory);

  const pickedUp = groceryItems.filter((i: any) => !i.needed).length;
  const totalItems = groceryItems.length;
  const checkedCount = pickedUp;
  const pct = totalItems ? Math.round((pickedUp / totalItems) * 100) : 0;
  const autoAdded = groceryItems.filter((i: any) => i.autoGenerated || i.source === "recipe").length;

  const bulkActions = (
    <div className="flex gap-2">
      <SoftButton variant="primary" size="sm" onClick={sendCheckedToPantry} disabled={sending} className="flex-1 whitespace-nowrap">
        🥫 Send {checkedCount} to pantry
      </SoftButton>
      <SoftButton variant="ghost" size="sm" onClick={clearCompleted}>Clear</SoftButton>
      <SoftButton variant="ghost" size="sm" onClick={markAllNeeded}>Re-check all</SoftButton>
    </div>
  );

  return (
    <div className="space-y-5 pb-6">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_280px]">
        <div className="space-y-5 min-w-0">
          {/* ── Quick Add ── */}
          <SectionCard title="Quick Add" icon="⚡" description="Tap a category, then tap items to add">
            <div className="space-y-3">
              <div className="flex gap-2">
                <TextField
                  value={newGroceryItem}
                  onChange={e => setNewGroceryItem(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleAdd()}
                  placeholder='e.g. "2 bananas" or just "milk"'
                  className="flex-1 min-w-0"
                />
                <SoftButton variant="primary" size="md" onClick={handleAdd} disabled={!newGroceryItem.trim()}>
                  Add
                </SoftButton>
              </div>
              <div className="flex gap-2">
                <TextField
                  value={newGroceryQuantity}
                  onChange={e => setNewGroceryQuantity(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleAdd()}
                  placeholder="Qty"
                  className="w-20 shrink-0"
                />
                <div className="relative flex-1 min-w-0">
                  <select
                    value={newGroceryCategory}
                    onChange={e => setNewGroceryCategory(e.target.value)}
                    className="w-full h-11 rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-3 py-2.5 text-sm text-text-primary outline-none transition focus:border-[var(--color-accent-selected)]/50 focus:shadow-[0_0_0_4px_rgba(59,130,246,0.12)]"
                  >
                    <option value="auto">✨ Auto</option>
                    {groceryCategories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.emoji} {cat.name}</option>
                    ))}
                  </select>
                </div>
                <div className="relative w-20 shrink-0">
                  <select
                    value={newGroceryPriority}
                    onChange={e => setNewGroceryPriority(e.target.value as "low" | "medium" | "high")}
                    className="w-full h-11 rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-3 py-2.5 text-sm text-text-primary outline-none transition focus:border-[var(--color-accent-selected)]/50 focus:shadow-[0_0_0_4px_rgba(59,130,246,0.12)]"
                  >
                    <option value="low">🟢 Low</option>
                    <option value="medium">🟡 Med</option>
                    <option value="high">🔴 High</option>
                  </select>
                </div>
              </div>
            </div>

            {recentlyBought && recentlyBought.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <div className="flex items-center justify-between mb-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                    🕐 Recently Bought
                  </p>
                  <button
                    onClick={clearRecentlyBought}
                    className="text-[11px] text-text-muted hover:text-[var(--color-accent-rose)] transition-colors"
                  >
                    Clear
                  </button>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {recentlyBought.map((item: { name: string; emoji: string; category: string }) => (
                    <Chip
                      key={item.name}
                      tone="neutral"
                      size="sm"
                      onClick={() => handleRecentTap(item)}
                      className="cursor-pointer"
                    >
                      {item.emoji} {item.name} +
                    </Chip>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-white/10">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-3">
                Categories
              </p>

              <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5">
                {groceryCategories.map(cat => {
                  const presetCount = groceryPresets.filter(p => p.category === cat.id).length;
                  const isSelected = presetCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => { setPresetCategory(cat.id); setShowAllPresets(false); }}
                      className={`shrink-0 inline-flex items-center gap-1.5 rounded-full h-9 px-3 text-xs font-semibold tap-sm border transition-colors ${
                        isSelected
                          ? "bg-[var(--color-accent-selected)] text-white border-transparent shadow-lg shadow-[var(--color-accent-selected)]/25"
                          : "border-white/10 bg-[var(--color-surface-0)]/30 text-text-secondary hover:text-text-primary hover:border-[var(--color-accent-selected)]/30"
                      }`}
                    >
                      <span aria-hidden>{cat.emoji}</span>
                      <span className="truncate">{cat.name}</span>
                      {presetCount > 0 && (
                        <span className={`shrink-0 text-[10px] font-bold rounded-full px-1.5 py-0.5 ${
                          isSelected ? "bg-white/20 text-white" : "bg-[var(--color-surface-2)] text-text-muted"
                        }`}>
                          {presetCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 mb-3 flex items-baseline gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  {selectedCat?.emoji} {selectedCat?.name}
                </p>
                <span className="text-[11px] text-text-muted">{categoryPresets.length} items</span>
              </div>

              {categoryPresets.length > 0 ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {visiblePresets.map(preset => {
                      const alreadyIn = groceryItems.some((i: any) => normalizeName(i.name) === normalizeName(preset.name));
                      return (
                        <button
                          key={preset.name}
                          onClick={() => !alreadyIn && handlePresetTap(preset)}
                          disabled={alreadyIn}
                          className={`group flex items-center gap-2.5 rounded-2xl border border-white/10 px-3 py-2.5 text-left transition-all duration-150 tap-sm ${
                            alreadyIn
                              ? "bg-[var(--color-accent-mint)]/10 border-[var(--color-accent-mint)]/20 opacity-60 cursor-default"
                              : "bg-[var(--color-surface-0)]/30 hover:border-[var(--color-accent-selected)]/40 hover:bg-[var(--color-surface-0)]/50"
                          }`}
                        >
                          <span className="text-lg shrink-0" aria-hidden>{preset.emoji}</span>
                          <span className={`flex-1 min-w-0 text-sm font-medium truncate ${alreadyIn ? "text-[var(--color-accent-mint)]" : "text-text-primary"}`}>
                            {preset.name}
                          </span>
                          {alreadyIn ? (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="shrink-0 w-3.5 h-3.5 text-[var(--color-accent-mint)] opacity-60"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          ) : (
                            <span className="shrink-0 text-base font-bold text-[var(--color-accent-selected)] opacity-40 group-hover:opacity-100 transition-opacity">+</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {categoryPresets.length > PRESETS_PER_PAGE && (
                    <button
                      onClick={() => setShowAllPresets(v => !v)}
                      className="mt-3 text-xs font-semibold text-[var(--color-accent-selected)] hover:opacity-80 transition-opacity"
                    >
                      {showAllPresets ? "Show less ↑" : `Show ${categoryPresets.length - PRESETS_PER_PAGE} more ↓`}
                    </button>
                  )}
                </>
              ) : (
                <p className="text-sm text-text-muted text-center py-3 rounded-2xl border border-dashed border-white/10">
                  No quick-add presets for this category yet — use the form above to add items.
                </p>
              )}
            </div>
          </SectionCard>

          {/* ── Undo banner ── */}
          {undo && (
            <div className="flex items-center gap-3 rounded-2xl border border-[var(--color-accent-mint)]/25 bg-[var(--color-accent-mint)]/10 px-4 py-3">
              <span className="flex-1 text-sm font-semibold text-text-primary">
                🥫 Sent {undo.added} item{undo.added === 1 ? "" : "s"} to pantry
              </span>
              <button
                onClick={handleUndo}
                disabled={undoing}
                className="rounded-xl bg-[var(--color-accent-mint)] px-3 py-1.5 text-xs font-bold text-white tap-sm disabled:opacity-50"
              >
                Undo
              </button>
            </div>
          )}

          {/* ── Category filter ── */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={() => setActiveCategory("all")}
              className={`group flex items-center gap-3 rounded-2xl p-3 text-left tap-sm ${
                activeCategory === "all"
                  ? "border-2 border-[var(--color-accent-selected)]/40 bg-[var(--color-accent-selected)]/15 shadow-[0_0_20px_var(--color-accent-selected)]/10]"
                  : "border border-white/10 bg-[var(--color-surface-0)]/30 backdrop-blur-xl hover:bg-[var(--color-surface-0)]/50 hover:border-[var(--color-accent-selected)]/20"
              }`}
            >
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-base ${
                activeCategory === "all"
                  ? "bg-[var(--color-accent-selected)] text-white"
                  : "bg-[var(--color-surface-2)]"
              }`}>
                🛒
              </span>
              <span className="flex-1 min-w-0">
                <span className={`block text-sm font-semibold truncate ${activeCategory === "all" ? "text-text-primary" : "text-text-secondary"}`}>
                  All
                </span>
                {groceryItems.length > 0 && (
                  <span className="block text-[11px] text-text-muted">
                    {groceryItems.filter((i: any) => !i.needed).length} of {groceryItems.length} picked up
                  </span>
                )}
              </span>
            </button>
            {groceryCategories.map(cat => {
              const catItems = groceryItems.filter((i: any) => i.category === cat.id);
              const catPicked = catItems.filter((i: any) => !i.needed).length;
              const isSelected = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`group flex items-center gap-3 rounded-2xl p-3 text-left tap-sm ${
                    isSelected
                      ? "border-2 border-[var(--color-accent-selected)]/40 bg-[var(--color-accent-selected)]/15 shadow-[0_0_20px_var(--color-accent-selected)]/10]"
                      : "border border-white/10 bg-[var(--color-surface-0)]/30 backdrop-blur-xl hover:bg-[var(--color-surface-0)]/50 hover:border-[var(--color-accent-selected)]/20"
                  }`}
                >
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-base ${
                    isSelected
                      ? "bg-[var(--color-accent-selected)] text-white"
                      : "bg-[var(--color-surface-2)]"
                  }`}>
                    {cat.emoji}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`block text-sm font-semibold truncate ${isSelected ? "text-text-primary" : "text-text-secondary"}`}>
                      {cat.name}
                    </span>
                    {catItems.length > 0 && (
                      <span className="block text-[11px] text-text-muted">
                        {catPicked}/{catItems.length} picked up
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ── Shopping list ── */}
          {totalItems === 0 && (
            <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center">
              <p className="text-3xl">🛒</p>
              <p className="mt-2 text-sm font-bold text-text-primary">Nothing on your list</p>
              <p className="mt-1 text-xs text-text-muted">Add items above, or sync from your meals and pantry.</p>
            </div>
          )}

          {groceryCategories.map(cat => {
            const catItems = filteredGrocery.filter((i: any) => i.category === cat.id);
            if (catItems.length === 0) return null;
            const catPicked = catItems.filter((i: any) => !i.needed).length;
            return (
              <SectionCard
                key={cat.id}
                title={cat.name}
                icon={cat.emoji}
                action={
                  <span className="text-xs font-semibold text-text-muted">
                    {catPicked}/{catItems.length}
                  </span>
                }
              >
                <div className="space-y-2">
                  {catItems.map((item: any, idx: number) => (
                    editingGroceryId === item.id ? (
                      <Surface key={`edit-${item.id}`} variant="warm" radius="2xl" padding="md">
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <TextField
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                              placeholder="Name"
                              onKeyDown={e => e.key === "Enter" && saveEdit(item.id)}
                              className="flex-1 min-w-0"
                            />
                            <TextField
                              value={editQuantity}
                              onChange={e => setEditQuantity(e.target.value)}
                              placeholder="Qty"
                              className="w-20 shrink-0"
                            />
                          </div>
                          <TextField
                            value={editNotes}
                            onChange={e => setEditNotes(e.target.value)}
                            placeholder="Notes (optional)"
                          />
                          <div className="flex gap-2">
                            <SoftButton variant="primary" size="sm" onClick={() => saveEdit(item.id)}>Save</SoftButton>
                            <SoftButton variant="ghost" size="sm" onClick={() => setEditingGroceryId(null)}>Cancel</SoftButton>
                          </div>
                        </div>
                      </Surface>
                    ) : (
                      <ListRow
                        key={`${cat.id}-${item.id}-${idx}`}
                        leading={
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleGroceryNeeded(item.id); }}
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border-2 tap-sm ${
                              !item.needed
                                ? "border-[var(--color-accent-mint)] bg-[var(--color-accent-mint)] text-white"
                                : "border-[var(--color-surface-4)] bg-[var(--color-surface-0)]/50 hover:border-[var(--color-accent-mint)]/50"
                            }`}
                          >
                            {!item.needed && (
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                        }
                        title={
                          <span className={!item.needed ? "line-through text-text-muted" : ""}>
                            {item.emoji} {item.name}
                          </span>
                        }
                        subtitle={item.quantity || undefined}
                        trailing={
                          <div className="flex items-center gap-2">
                            {!item.needed && (
                              <button
                                onClick={(e) => { e.stopPropagation(); sendSingleToPantry(item); }}
                                disabled={sending}
                                className="flex items-center gap-1 rounded-xl bg-[var(--color-accent-mint)]/15 px-2 py-1.5 text-[11px] font-bold text-[var(--color-accent-mint)] hover:bg-[var(--color-accent-mint)]/25 tap-sm disabled:opacity-50"
                              >
                                🥫 <span className="hidden sm:inline">Pantry</span>
                              </button>
                            )}
                            <Chip
                              tone={item.priority === "high" ? "danger" : item.priority === "medium" ? "warning" : "success"}
                              size="sm"
                            >
                              {item.priority}
                            </Chip>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={(e) => { e.stopPropagation(); startEditing(item); }}
                                className="rounded-xl p-1.5 text-text-muted hover:bg-[var(--color-surface-2)] hover:text-text-primary tap-sm"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" />
                                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); deleteGroceryItem(item.id); }}
                                className="rounded-xl p-1.5 text-text-muted hover:bg-[var(--color-accent-rose)]/10 hover:text-[var(--color-accent-rose)] tap-sm"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                                  <path d="M3 6h18M19 6l-1 14H6L5 6M8 6V4h8v2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        }
                        onClick={() => toggleGroceryNeeded(item.id)}
                      />
                    )
                  ))}
                </div>
              </SectionCard>
            );
          })}

          {/* ── Desktop bulk bar ── */}
          {checkedCount > 0 && (
            <div className="hidden xl:block">
              <SectionCard
                title="Checked items"
                icon="✅"
                action={<span className="text-xs font-semibold text-text-muted">{checkedCount} ready for pantry</span>}
              >
                {bulkActions}
              </SectionCard>
            </div>
          )}
        </div>

        {/* ── Right rail (desktop) ── */}
        <div className="space-y-5 min-w-0 xl:order-2 order-first xl:order-none">
          <SectionCard title="Shopping progress" icon="🛒">
            <div className="space-y-4">
              <div className="flex items-end justify-between">
                <span className="text-3xl font-black text-text-primary display-numeral">{pct}%</span>
                <span className="text-xs font-bold text-text-muted">
                  {pickedUp} of {totalItems} picked up
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, var(--color-accent-mint, #34d399), var(--color-accent-amber, #fbbf24))`,
                  }}
                />
              </div>
              {pickedUp > 0 && (
                <SoftButton variant="ghost" size="md" onClick={clearCompleted} className="w-full text-emerald-400">
                  ✨ Clear {pickedUp} checked item{pickedUp > 1 ? "s" : ""}
                </SoftButton>
              )}
            </div>
          </SectionCard>

          <Surface variant="warm" radius="2xl" padding="none">
            <div className="space-y-2 p-5">
              <SoftButton variant="primary" size="md" onClick={syncMealToGrocery} disabled={isSyncing} className="w-full">
                🍽️ {isSyncing ? "Syncing..." : "Sync from Meals"}
              </SoftButton>
              <SoftButton variant="secondary" size="md" onClick={syncPantryToGrocery} disabled={isSyncing} className="w-full">
                🥫 Sync from Pantry
              </SoftButton>
            </div>
          </Surface>

          {autoAdded > 0 && (
            <SectionCard title="Auto-added from meals" icon="💚" description={`${autoAdded} item${autoAdded > 1 ? "s" : ""} were automatically added from this week's meal plan.`}>
              <p className="text-sm text-text-secondary">{autoAdded} item{autoAdded > 1 ? "s" : ""} from your meal plan added automatically.</p>
            </SectionCard>
          )}
        </div>
      </div>

      {/* ── Mobile sticky bulk bar ── */}
      {checkedCount > 0 && (
        <div className="xl:hidden sticky bottom-28 z-30">
          <div className="rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/85 p-2 shadow-2xl backdrop-blur-xl">
            {bulkActions}
          </div>
        </div>
      )}
    </div>
  );
}
