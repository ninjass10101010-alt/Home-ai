# Kitchen UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Grocery tab's Plan/Shop duplication and add a checked-items → pantry handoff, plus the approved Quick Add hierarchy redesign.

**Architecture:** Rewrite `GroceryTab.tsx` as a single-list view (no mode toggle) where adding, checking off, and sending items to pantry all happen in one place. `usePantry.addPantryItem` returns the created item (for undo), `useGrocery.addGroceryItem` gains a `silent` flag (for undo restores without toast spam). All state orchestration lives in GroceryTab; no data-model/PB changes.

**Tech Stack:** Next.js 16 + React 19 + Tailwind CSS 4, existing Warm Glass tokens (`--color-accent-*`, `--color-surface-*`, `--color-text-*`), `.tap`/`.tap-sm` interaction utilities, `.no-scrollbar` utility (exists in `src/app/globals.css:1006`).

## Global Constraints

- Verification command for every task: `npm run typecheck && npm run lint && npm run build` — must pass with 0 errors (lint may have pre-existing warnings).
- Design tokens only — no new hex colors, no new dependencies, no motion on planner tabs (AGENTS.md §1.3: planner tabs are calm, stable input surfaces; color transitions + focus rings only).
- Mobile-first: verify no page-level horizontal scroll at 375px (`document.documentElement.scrollWidth === innerWidth`).
- All new buttons use `.tap` / `.tap-sm`; no ad-hoc `active:scale-*` / `hover:scale-*` (AGENTS.md 2026-07-17 Stream C rule).
- Every task commits separately with a message prefixed `feat(ui):` / `fix(ui):` per repo convention.
- Spec: `docs/superpowers/specs/2026-08-05-kitchen-ui-redesign-design.md` — read it first.
- AGENTS.md §1 "UI Change Record" + "Current Dashboard Snapshot" + Change Log MUST be updated in Task 3 (repo rule).

---

### Task 1: Hook changes — pantry item returns, silent grocery add

**Files:**
- Modify: `src/hooks/usePantry.ts:57-68` (`addPantryItem`)
- Modify: `src/hooks/useGrocery.ts:110-140` (`addGroceryItem`)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `usePantry.addPantryItem(name: string, status: "plenty" | "low" | "out") => Promise<{ id: number; item: string; status: string } | false>` — returns the created item object instead of `true`; still returns `false` for duplicates/failures. (Existing callers in `PantryTab.tsx:77,82,409` treat truthy as success, so behavior is unchanged for them.)
  - `useGrocery.addGroceryItem(name, category, priority, emojiOverride?, quantity?, notes?, silent?) => Promise<boolean>` — new trailing `silent: boolean = false` param; when `true`, skips the success toast.

- [ ] **Step 1: Modify `usePantry.addPantryItem` to return the created item**

In `src/hooks/usePantry.ts`, replace the body of `addPantryItem` (lines 57-68) with:

```ts
  const addPantryItem = async (name: string, status: "plenty" | "low" | "out") => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const exists = pantryItems.some(p => normalizeName(p.item) === normalizeName(trimmed));
    if (exists) { showToast("Item already in pantry"); return false; }
    const alreadyOnGrocery = groceryItems.some(g => normalizeName(g.name) === normalizeName(trimmed) && g.needed);
    const saved = await db.upsertPantryItem({ userId: "demo", name: trimmed, status });
    if (!saved) { showToast("❌ Failed to save item to pantry"); return false; }
    const newItem = { id: saved.id ?? Date.now(), item: saved.name || saved.item, status: saved.status };
    setPantryItems(prev => [...prev, newItem]);
    showToast(alreadyOnGrocery ? `🥫 Added ${trimmed} to pantry and grocery` : `🥫 Added ${trimmed} to pantry`);
    return newItem;
  };
```

- [ ] **Step 2: Modify `useGrocery.addGroceryItem` to accept `silent`**

In `src/hooks/useGrocery.ts`, change the signature (line 110-117) and the final toast line (line 138):

```ts
  const addGroceryItem = async (
    name: string,
    category: string,
    priority: "low" | "medium" | "high",
    emojiOverride?: string,
    quantity = "",
    notes = "",
    silent = false
  ) => {
```

and replace `showToast(existing ? ... : ...);` with:

```ts
    if (!silent) showToast(existing ? `🛒 ${trimmed} is already on your list` : `🛒 Added ${trimmed}`);
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: clean typecheck, 0 lint errors, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/usePantry.ts src/hooks/useGrocery.ts
git commit -m "feat(ui): pantry add returns created item; grocery add supports silent mode"
```

---

### Task 2: GroceryTab rewrite — single list + Quick Add redesign + pantry handoff

**Files:**
- Rewrite: `src/components/meals/GroceryTab.tsx` (full file replace — current file is 644 lines, mostly the two mode branches; the new file is one view)
- Modify: `src/app/meals/page.tsx:365-383` (GroceryTab props)

**Interfaces:**
- Consumes:
  - From `usePantry` (already destructured in `meals/page.tsx:98-99`): `pantryItems`, `addPantryItem` (now returns item object), `removePantryItem(id: number)`
  - From `useGrocery`: `addGroceryItem` (now with `silent`), `deleteGroceryItem(id)`, `toggleGroceryNeeded(id)`, all existing props unchanged
  - `showToast` (already exists in `meals/page.tsx`, passed to MealsTab — now also passed to GroceryTab)
- Produces: nothing new for other tasks; GroceryTab consumes new props listed below.

- [ ] **Step 1: Write the new `GroceryTab.tsx`**

Replace the entire contents of `src/components/meals/GroceryTab.tsx` with:

```tsx
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

const PRESETS_PER_PAGE = 6;
const UNDO_MS = 8000;

const normalizeName = (name: string) => name.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

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
  const [editingGroceryId, setEditingGroceryId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editQuantity, setEditQuantity] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [presetCategory, setPresetCategory] = useState<string>("produce");
  const [showAllPresets, setShowAllPresets] = useState(false);
  const [undo, setUndo] = useState<{ pantryIds: number[]; items: GroceryItem[] } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  const pushUndo = (snapshot: { pantryIds: number[]; items: GroceryItem[] }) => {
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

  const saveEdit = (id: number) => {
    updateGroceryItem(id, { name: editName.trim(), quantity: editQuantity.trim(), notes: editNotes.trim() });
    setEditingGroceryId(null);
  };

  const sendSingleToPantry = async (item: GroceryItem) => {
    const inPantry = (pantryItems || []).some((p: any) => normalizeName(p.item || p.name) === normalizeName(item.name));
    if (inPantry) { showToast(`🥫 ${item.name} is already in your pantry`); return; }
    const saved: any = await addPantryItem(item.name, "plenty");
    if (saved && typeof saved === "object") {
      await deleteGroceryItem(item.id);
      pushUndo({ pantryIds: [saved.id], items: [item] });
      showToast(`🥫 Sent ${item.name} to pantry`);
    }
  };

  const sendCheckedToPantry = async () => {
    const checked = groceryItems.filter((i: any) => !i.needed);
    if (!checked.length) return;
    const pantryIds: number[] = [];
    let added = 0;
    for (const item of checked) {
      const inPantry = (pantryItems || []).some((p: any) => normalizeName(p.item || p.name) === normalizeName(item.name));
      if (inPantry) continue;
      const saved: any = await addPantryItem(item.name, "plenty");
      if (saved && typeof saved === "object") { added++; pantryIds.push(saved.id); }
    }
    for (const item of checked) await deleteGroceryItem(item.id);
    pushUndo({ pantryIds, items: checked });
    showToast(added === checked.length
      ? `🥫 Sent ${added} item${added === 1 ? "" : "s"} to pantry`
      : `🥫 Sent ${added} of ${checked.length} to pantry (${checked.length - added} already there)`);
  };

  const handleUndo = async () => {
    if (!undo) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    for (const id of undo.pantryIds) await removePantryItem(id);
    for (const item of undo.items) {
      await addGroceryItem(item.name, item.category, item.priority, item.emoji, item.quantity || "", "", true);
    }
    setUndo(null);
    showToast(`↩️ Restored ${undo.items.length} item${undo.items.length === 1 ? "" : "s"} to grocery`);
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
      <SoftButton variant="primary" size="sm" onClick={sendCheckedToPantry} className="flex-1 whitespace-nowrap">
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
                          className={`group flex items-center gap-2.5 rounded-2xl border border-white/10 px-3 py-2.5 text-left transition-all duration-150 active:scale-[0.97] ${
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
                🥫 Sent {undo.items.length} item{undo.items.length === 1 ? "" : "s"} to pantry
              </span>
              <button
                onClick={handleUndo}
                className="rounded-xl bg-[var(--color-accent-mint)] px-3 py-1.5 text-xs font-bold text-white tap-sm"
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
                                className="flex items-center gap-1 rounded-xl bg-[var(--color-accent-mint)]/15 px-2 py-1.5 text-[11px] font-bold text-[var(--color-accent-mint)] hover:bg-[var(--color-accent-mint)]/25 tap-sm"
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
```

- [ ] **Step 2: Wire new props in `meals/page.tsx`**

In `src/app/meals/page.tsx`, replace the GroceryTab invocation (lines 365-383) with:

```tsx
        {activeTab === "grocery" && (
          <GroceryTab
            groceryItems={groceryItems}
            setGroceryItems={setGroceryItems}
            activeCategory={activeCategory}
            setActiveCategory={setActiveCategory}
            isSyncing={isSyncing}
            recentlyBought={recentlyBought}
            clearRecentlyBought={clearRecentlyBought}
            addGroceryItem={addGroceryItem}
            toggleGroceryNeeded={toggleGroceryNeeded}
            deleteGroceryItem={deleteGroceryItem}
            updateGroceryItem={updateGroceryItem}
            syncMealToGrocery={syncMealToGrocery}
            syncPantryToGrocery={syncPantryToGrocery}
            parseManualGroceryInput={parseManualGroceryInput}
            guessCategory={guessGroceryCategoryHook}
            showToast={showToast}
            pantryItems={pantryItems}
            addPantryItem={addPantryItem}
            removePantryItem={removePantryItem}
          />
        )}
```

Note: `showToast`, `pantryItems`, `addPantryItem`, `removePantryItem` are already in scope in `meals/page.tsx` (lines 91-99 destructure `usePantry(showToast, groceryItems)`).

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: clean typecheck, 0 lint errors, build succeeds.

- [ ] **Step 4: Manual QA checklist** (dev server on localhost:3000, browser at 375px and 1280px)

1. Grocery tab has NO Plan/Shop toggle; one list.
2. Quick Add: category pills scroll horizontally (no page scroll); selected pill accent-filled; item grid below labeled "🥬 Produce · 12 items"; already-added presets show mint ✓, dimmed, disabled.
3. Add "milk" via form → appears under Dairy section, unchecked.
4. Tap checkbox on "Milk" → strikes through, mint "🥫 Pantry" button appears on the row; tapping it moves it to pantry (Pantry tab shows Milk as Plenty), row disappears; undo banner appears; Undo restores row and removes from pantry.
5. Check 2 items → mobile sticky bar "🥫 Send 2 to pantry / Clear / Re-check all" appears; Send moves both; desktop shows "Checked items" SectionCard instead.
6. Progress bar, "Sync from Meals", "Sync from Pantry", category filter, edit (✏), delete (🗑) all work; edit/delete no longer accidentally toggle the checkbox.
7. At 375px: `document.documentElement.scrollWidth === innerWidth` (no horizontal scroll).

- [ ] **Step 5: Commit**

```bash
git add src/components/meals/GroceryTab.tsx src/app/meals/page.tsx
git commit -m "feat(ui): single-list grocery tab with quick-add pills and pantry handoff"
```

---

### Task 3: AGENTS.md operational manual update

**Files:**
- Modify: `Home-ai/AGENTS.md`

**Interfaces:** Consumes nothing new. Follows the repo's mandatory documentation rule (AGENTS.md §1.1: "Update this file in the same session" after UI changes).

- [ ] **Step 1: Update "Current Dashboard Snapshot"**

In the "Current Dashboard Snapshot" section of `AGENTS.md`, append to the **Kitchen overhaul** sentence block a new clause describing the single-list grocery tab (match the existing style; keep it one line):

```markdown
**Grocery tab single-list (kitchen-ui branch):** the Plan/Shop toggle is gone — one grocery list for adding, checking off, and syncing; checked items have a per-row 🥫 Pantry action and a bulk "Send N to pantry" bar (sticky on mobile, section card on desktop) that moves bought items into the pantry as Plenty with an 8s Undo banner; Quick Add is its own card with category pills + already-added ✓ state.
```

- [ ] **Step 2: Add a UI Change Record entry**

Insert a new UI Change Record block directly above the existing `### UI Change Record — 2026-08-05 — Consuela integration` heading, using the repo's delta format:

```markdown
### UI Change Record — 2026-08-05 — Grocery single list + checked→pantry handoff + Quick Add pills
- Added / Changed: `src/components/meals/GroceryTab.tsx` (full rewrite — Plan/Shop toggle removed, one canonical list), `src/hooks/usePantry.ts` (`addPantryItem` returns the created item), `src/hooks/useGrocery.ts` (`addGroceryItem` gained `silent`), `src/app/meals/page.tsx` (GroceryTab now receives `showToast`/`pantryItems`/`addPantryItem`/`removePantryItem`)
- Visual / Motion: The Grocery tab is now a single list — the Plan/Shop segmented toggle and the duplicate Shop-mode view are gone. Top to bottom: a **Quick Add** card (manual form + Recently Bought, then a horizontal scroll of rounded category pills with preset-count badges — selected pill is accent-filled; the item grid below is labeled "🥬 Produce · 12 items" so selectors and items can't be confused; items already on the list show a mint ✓, are dimmed and disabled), the category filter, then the categorized shopping list. Checked-off rows get a mint "🥫 Pantry" button; checking items reveals a bulk bar — sticky above the bottom nav on mobile, a "Checked items" SectionCard on desktop — with "Send N to pantry", "Clear", and "Re-check all". Sending moves items to the pantry as Plenty and shows an 8-second "Undo" banner that restores rows and removes the just-added pantry items. Row edit/delete buttons no longer accidentally toggle the checkbox (`stopPropagation`). Mobile keeps progress + sync buttons above the list; desktop keeps the right rail (progress, Sync from Meals/Pantry, Auto-added summary).
- Color sources: Existing Warm Glass tokens only — mint (`--color-accent-mint`) for checked/pantry states, accent for selected pills and filters. No motion on the planner surface (per AGENTS.md §1.3).
- Agent action required: Update this section + "Current Dashboard Snapshot" + Change Log.
- User-facing description (copy-paste ready for responses):
  > "The Grocery page is now one clean shopping list — the Plan/Shop toggle is gone. Add items with the form or the Quick Add card (category pills, then tap any item to add; items already on the list show a checkmark). As you check things off, each row gains a 'Pantry' button, and a bar appears letting you send all checked items to the pantry at once — with an Undo in case you tap it by mistake. Bought items become pantry stock instead of vanishing."
```

- [ ] **Step 3: Add a Change Log entry**

Append at the TOP of the Change Log section (above the 2026-08-05 fix entries), in the repo's style:

```markdown
- 2026-08-05 — feat(ui): Grocery single list + checked→pantry handoff + Quick Add redesign (kitchen-ui branch, 2 commits). `GroceryTab.tsx` rewritten: removed the Plan/Shop toggle and the duplicate shop view — one categorized shopping list is now the only place to add, check off, and sync items. Quick Add moved to its own SectionCard with a horizontal pill category selector (accent-filled when selected) + "🥬 Produce · 12 items" label above the item grid; presets already on the list render dimmed with a mint ✓ and are disabled (PantryTab pattern). Checked rows show a 🥫 Pantry button; a bulk bar (sticky bottom on mobile, "Checked items" SectionCard on xl) offers "Send N to pantry" / "Clear" / "Re-check all"; bulk send moves items to pantry as Plenty, deletes the rows, and shows an 8s Undo banner (restores rows via silent re-add, removes the added pantry items by id). `usePantry.addPantryItem` now returns the created item (existing callers unaffected); `useGrocery.addGroceryItem` gained a `silent` param. Row edit/delete buttons `stopPropagation` so they no longer double-toggle the checkbox. AGENTS.md snapshot + UI Change Record updated. TS / lint / build clean.
```

- [ ] **Step 4: Verify + commit**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: clean (docs-only change; guards against accidental regressions from the earlier steps).

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md — grocery single-list + pantry handoff UI change record"
```

---

## Self-Review Notes

- **Spec coverage:** Quick Add pills (Task 2), already-added ✓ (Task 2), single list no toggle (Task 2), per-row pantry action (Task 2), bulk bar mobile+desktop (Task 2), undo banner 8s (Task 2), rail collapse on mobile (Task 2), Pantry/Meals/Recipes tabs unchanged (no task touches them), AGENTS.md (Task 3). Spec's `useGrocery.sendCheckedToPantry` is implemented as component-level orchestration per the spec's "or component-level logic" allowance.
- **Type consistency:** `addPantryItem` returns `Promise<{id,item,status} | false>` — Task 1 produces, Task 2 consumes with `saved && typeof saved === "object"`. `addGroceryItem(..., silent)` 7th param — Task 1 signature matches Task 2's `handleUndo` call. `showToast` prop name matches `meals/page.tsx` scope.
