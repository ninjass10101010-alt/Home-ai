"use client";
import { useState, useEffect, useRef } from "react";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import Chip from "@/components/ui/Chip";
import EmptyState from "@/components/ui/EmptyState";
import TextField from "@/components/ui/TextField";
import ListRow from "@/components/ui/ListRow";
import SectionCard from "@/components/patterns/SectionCard";
import WidgetCard from "@/components/patterns/WidgetCard";
import GroceryItemActionsSheet from "@/components/meals/GroceryItemActionsSheet";
import KitchenFlowCard from "@/components/meals/KitchenFlowCard";
import SyncPreviewSheet from "@/components/meals/SyncPreviewSheet";
import StorePill from "@/components/meals/StorePill";
import StorePicker from "@/components/meals/StorePicker";
import PriceCompareSheet from "@/components/meals/PriceCompareSheet";
import StoreOrderSheet from "@/components/meals/StoreOrderSheet";
import ShopGuide from "@/components/meals/ShopGuide";
import ClemAssistant from "@/components/meals/ClemAssistant";
import { mealSyncService, type SyncPreview } from "@/services/mealSync";
import { groceryCategories } from "@/data/meals";
import { GroceryItem, Meal } from "@/types/meals";
import { parseQuantityString } from "@/lib/grocery-service";
import { StoreId, getDefaultStore, PriceCompareItem, getStoreLabel, ALL_STORES, groupByStore } from "@/lib/stores";

const UNDO_MS = 8000;

const normalizeName = (name: string) => name.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

export default function ShopTab({
  groceryItems,
  activeCategory,
  setActiveCategory,
  recentlyBought,
  addGroceryItem,
  toggleGroceryNeeded,
  deleteGroceryItem,
  updateGroceryItem,
  parseManualGroceryInput,
  guessCategory,
  showToast,
  pantryItems,
  addPantryItem,
  removePantryItem,
  toggleManualOverride,
  meals,
  flowSummary,
}: any) {
  const [newGroceryItem, setNewGroceryItem] = useState("");
  const [editingGroceryId, setEditingGroceryId] = useState<number | string | null>(null);
  const [editName, setEditName] = useState("");
  const [editQuantity, setEditQuantity] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [undo, setUndo] = useState<{ pantryIds: (number | string)[]; items: GroceryItem[]; added: number } | null>(null);
  const [sending, setSending] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [storePickerOpen, setStorePickerOpen] = useState(false);
  const [storePickerItemId, setStorePickerItemId] = useState<number | string | null>(null);
  const [actionsItemId, setActionsItemId] = useState<number | string | null>(null);
  const [actionsSheetItem, setActionsSheetItem] = useState<any>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [orderSheetOpen, setOrderSheetOpen] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [orderingStore, setOrderingStore] = useState<string | null>(null);

  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);
  useEffect(() => () => { if (noteTimer.current) clearTimeout(noteTimer.current); }, []);

  const pushUndo = (snapshot: { pantryIds: (number | string)[]; items: GroceryItem[]; added: number }) => {
    setUndo(snapshot);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
  };

  const flashNote = (msg: string) => {
    setSyncNote(msg);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setSyncNote(null), 4000);
  };

  const openMealSync = () => {
    const p = mealSyncService.previewMealPlanToGrocery((meals || []) as Meal[], pantryItems || [], groceryItems);
    if (p.items.length === 0) {
      flashNote(p.alreadyOnList > 0
        ? `Nothing to add, ${p.alreadyOnList} item${p.alreadyOnList === 1 ? "" : "s"} already on your list ✓`
        : "Nothing to add, your plan is fully stocked ✓");
      return;
    }
    setPreview(p);
  };

  const confirmMealSync = async () => {
    if (!preview || syncBusy) return;
    const toAdd = preview.items;
    const already = preview.alreadyOnList;
    setSyncBusy(true);
    try {
      let added = 0;
      for (const item of toAdd) {
        const ok = await addGroceryItem(item.name, item.category, item.priority, undefined, item.quantity, "", true, true);
        if (ok) added++;
      }
      setPreview(null);
      flashNote(`Added ${added} · ${already} were already on list`);
    } catch {
      setPreview(null);
      flashNote("Couldn't reach the database, items not added");
    } finally {
      setSyncBusy(false);
    }
  };

  const handleAdd = async () => {
    if (!newGroceryItem.trim()) return;
    const parsed = parseManualGroceryInput(newGroceryItem);
    await addGroceryItem(parsed.name, guessCategory(parsed.name), "medium", undefined, parsed.quantity, "");
    setNewGroceryItem("");
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
          showToast(`❌ Couldn't add ${item.name} to pantry, it stays on your list`);
          return;
        }
        pushUndo({ pantryIds: [saved.id], items: [item], added: 1 });
      }
      await deleteGroceryItem(item.id);
      showToast(inPantry ? `🥫 ${item.name} was already stocked, removed from your list` : `🥫 Sent ${item.name} to pantry`);
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
        showToast(`🥫 Sent ${added} to pantry (${already} already stocked, ${failed} failed, kept on list)`);
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

  const handleStoreChange = (item: GroceryItem) => {
    setStorePickerItemId(item.id);
    setStorePickerOpen(true);
  };

  const handleStoreSelect = (storeId: StoreId) => {
    if (storePickerItemId != null) {
      updateGroceryItem(storePickerItemId, { store: storeId });
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

  const orderStore = async (storeId: string, items: GroceryItem[]) => {
    if (ordering) return;
    setOrdering(true);
    setOrderingStore(storeId);
    try {
      const res = await fetch("/api/instacart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "shopping_list",
          title: `${getStoreLabel(storeId)} Grocery List`,
          items: items
            .filter((i) => i.needed !== false)
            .map((i) => ({ name: i.name, quantity: 1 })),
          store: storeId,
        }),
      });
      const data = await res.json();
      if (data.url) window.open(data.url, "_blank", "noopener,noreferrer");
      else if (data.error) showToast(`❌ ${data.error}`);
    } catch {
      showToast("❌ Couldn't create Instacart list, check connection");
    } finally {
      setOrdering(false);
      setOrderingStore(null);
    }
  };

  const orderAllStores = async () => {
    if (ordering) return;
    setOrdering(true);
    setOrderingStore("all");
    try {
      const groups = groupByStore(groceryItems.filter((i: any) => i.needed !== false));
      const storesPayload: Record<string, { name: string; quantity: number }[]> = {};
      for (const [storeId, items] of Object.entries(groups)) {
        if (storeId === "any") continue;
        storesPayload[storeId] = items.map((i: any) => ({ name: i.name, quantity: 1 }));
      }
      const res = await fetch("/api/instacart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "shopping_list",
          title: "Weekly Grocery Run",
          stores: storesPayload,
        }),
      });
      const data = await res.json();
      if (data.type === "multi_store" && data.stores) {
        data.stores.forEach((s: any) => {
          if (s.url) window.open(s.url, "_blank", "noopener,noreferrer");
        });
      } else if (data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      } else if (data.error) {
        showToast(`❌ ${data.error}`);
      }
    } catch {
      showToast("❌ Couldn't create Instacart lists, check connection");
    } finally {
      setOrdering(false);
      setOrderingStore(null);
    }
  };

  const filteredGrocery = activeCategory === "all" ? groceryItems : groceryItems.filter((i: any) => i.category === activeCategory);
  // Names the aisle an empty state is about, so the state can say which filter is
  // hiding everything instead of claiming the whole list is empty.
  const activeCategoryMeta = activeCategory === "all"
    ? null
    : groceryCategories.find((c) => c.id === activeCategory) ?? null;

  const priceCompareItems: PriceCompareItem[] = groceryItems
    .filter((i: any) => i.needed !== false)
    .map((i: any) => ({ name: i.name, prices: {} }));

  // Unchecked items grouped by store, excluding "any" (unassigned) and Walmart (not on Instacart in Holland)
  const instacartStoreIds = Object.keys(groupByStore(groceryItems.filter((i: any) => i.needed !== false)))
    .filter((storeId) => storeId !== "any" && storeId !== "walmart");

  const pickedUp = groceryItems.filter((i: any) => !i.needed).length;
  const totalItems = groceryItems.length;
  const checkedCount = pickedUp;
  const pct = totalItems ? Math.round((pickedUp / totalItems) * 100) : 0;

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
      <KitchenFlowCard step="shop" summary={flowSummary} />
      <ShopGuide />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="space-y-5 min-w-0">
          <div className="space-y-3">
            <div className="flex gap-2">
              <TextField
                value={newGroceryItem}
                onChange={e => setNewGroceryItem(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                aria-label="Add grocery item"
                placeholder='Add an item, e.g. "2 bananas" or "milk"'
                className="flex-1 min-w-0"
              />
              <SoftButton variant="primary" size="md" onClick={handleAdd} disabled={!newGroceryItem.trim()}>Add</SoftButton>
            </div>

            {recentlyBought && recentlyBought.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">🔁 Buy again</p>
                <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
                  {recentlyBought.map((item: { name: string; emoji: string; category: string }) => {
                    const onList = groceryItems.some((i: any) => normalizeName(i.name) === normalizeName(item.name));
                    return (
                      <button
                        key={item.name}
                        onClick={() => !onList && addGroceryItem(item.name, item.category, "medium", item.emoji)}
                        disabled={onList}
                        className={`shrink-0 flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold tap-sm ${
                          onList
                            ? "border-[var(--color-accent-mint)]/25 bg-[var(--color-accent-mint)]/10 text-[var(--color-accent-mint)]"
                            : "border-white/10 glass-subtle text-text-primary hover:border-[var(--color-accent-selected)]/30"
                        }`}
                      >
                        <span aria-hidden>{item.emoji}</span>
                        <span>{item.name}</span>
                        {onList && <span aria-hidden>✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <WidgetCard tone="#3b82f6" icon="🛒">
            <div className="border-b border-white/10 p-4 pl-[72px]">
              <h3 className="text-base font-bold text-text-primary">Sync and order</h3>
            </div>
            {/* The sync action was a `w-full` primary `SoftButton`: a solid accent
                bar ~600px wide on the 1920 wall, which made a *tertiary* "pull in
                ingredients" affordance the loudest object on /grocery — louder than
                the shopping list it serves. Same disease `ConsuelaWeekCard` had on
                /calendar. The card now leads in with the sentence that says what the
                button will do and every action is content-width, so the block reads as
                an invitation rather than a billboard: ~8x less accent ink, and the
                primary is still the primary because fill and order say so. */}
            <div className="space-y-3 p-4">
              <p className="max-w-xl text-sm text-text-secondary">
                Pull in what your meal plan is missing, then hand the run to Instacart.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <SoftButton size="md" onClick={openMealSync} disabled={syncBusy}>
                  🍽️ {syncBusy ? "Adding…" : "Add missing from meal plan"}
                </SoftButton>
                <SoftButton variant="ghost" size="md" onClick={() => setOrderSheetOpen(true)}>
                  📤 Order from Instacart
                </SoftButton>
                <SoftButton variant="ghost" size="md" onClick={() => setCompareOpen(true)}>
                  💰 Compare Prices
                </SoftButton>
              </div>
              {syncNote && <p role="status" className="text-xs font-semibold text-text-secondary">{syncNote}</p>}
            </div>
          </WidgetCard>

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

          {/* ── Category filter ──
              Wraps rather than scrolls. As a scroller it ran off the right
              edge of a 390px phone with "Meat & Se…" cut mid-word and no
              affordance that it moved at all; wrapping keeps every filter
              visible and tappable, which is what a shopping list needs.

              These were hand-rolled `<button>`s at `px-3.5 py-1.5` — 30px tall,
              so all nine aisle filters missed the 44px floor by 14px, and the
              harness reported every one of them on /grocery in every theme and
              viewport. `tap-target-contract.test.ts` cannot catch that class of
              defect: a control sized purely by padding carries no `h-*` class,
              so no sub-44 token ever appears for its scan to find. Converged on
              `Chip`, the documented primitive, which carries `tap-sm hit-44`
              itself — the visual size is unchanged, the hit box is now 44px,
              and the selected state comes from `chip-selected` instead of a
              hand-mixed fill. `aria-pressed` matches the house idiom for a
              single-select filter chip (`tasks/page.tsx`, `suggestions/page.tsx`). */}
          <div className="flex flex-wrap gap-2">
            <Chip
              size="md"
              selected={activeCategory === "all"}
              aria-pressed={activeCategory === "all"}
              onClick={() => setActiveCategory("all")}
            >
              <span aria-hidden>🛒</span> All
            </Chip>
            {groceryCategories.map(cat => {
              const count = groceryItems.filter((i: any) => i.category === cat.id).length;
              return (
                <Chip
                  key={cat.id}
                  size="md"
                  selected={activeCategory === cat.id}
                  aria-pressed={activeCategory === cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                >
                  <span aria-hidden>{cat.emoji}</span> {cat.name}{count > 0 ? ` · ${count}` : ""}
                </Chip>
              );
            })}
          </div>

          {/* ── Shopping list ──
              One state for every empty list, including the case that used to
              render NOTHING: a category filter that hid every row. `totalItems`
              was the only condition, so tapping an aisle you had nothing in left
              a blank region under the filters with no explanation and no way
              back. The shared `EmptyState` primitive carries the recovery
              action, so the state is both explainable and escapable. */}
          {filteredGrocery.length === 0 && (
            <EmptyState
              icon={activeCategoryMeta ? activeCategoryMeta.emoji : "🛒"}
              title={activeCategoryMeta ? `No ${activeCategoryMeta.name.toLowerCase()} on your list` : "Nothing on your list"}
              description={
                activeCategoryMeta && totalItems > 0
                  ? `${groceryItems.length} item${groceryItems.length === 1 ? "" : "s"} sit in the other aisles.`
                  : "Add items above, or sync from your meals and pantry."
              }
              actionLabel={activeCategoryMeta && totalItems > 0 ? "Show all items" : undefined}
              onAction={activeCategoryMeta && totalItems > 0 ? () => setActiveCategory("all") : undefined}
            />
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
                            aria-label={!item.needed ? `Uncheck ${item.name}` : `Check off ${item.name}`}
                            className="hit-44 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl tap-sm"
                          >
                            <span className={`flex h-7 w-7 items-center justify-center rounded-xl border-2 ${
                              !item.needed
                                ? "border-[var(--color-accent-mint)] bg-[var(--color-accent-mint)] text-white"
                                : "border-[var(--color-surface-4)] bg-[var(--color-surface-0)]/50"
                            }`}>
                              {!item.needed && (
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </span>
                          </button>
                        }
                        title={
                          <span className={!item.needed ? "line-through text-text-muted" : ""}>
                            {item.emoji} {item.name}
                          </span>
                        }
                        subtitle={item.quantity || undefined}
                        trailing={
                          <div className="flex items-center gap-1.5">
                            <StorePill
                              store={item.store || "any"}
                              onClick={() => handleStoreChange(item)}
                            />
                            <div className="hidden sm:flex items-center gap-1.5">
                            {!item.needed && (
                              <button
                                onClick={(e) => { e.stopPropagation(); sendSingleToPantry(item); }}
                                disabled={sending}
                                className="flex items-center gap-1 rounded-xl bg-[var(--color-accent-mint)]/15 px-2 py-1.5 text-xs font-bold text-[var(--color-accent-mint)] hover:bg-[var(--color-accent-mint)]/25 tap-sm disabled:opacity-50"
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
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleManualOverride?.(item.id); }}
                              aria-label={item.manualOverride ? `unlock ${item.name} for auto-sync` : `lock ${item.name} from auto-sync`}
                              title={item.manualOverride ? "Locked from auto-sync, tap to unlock" : "Lock from auto-sync"}
                              className={`flex h-11 w-11 items-center justify-center rounded-xl tap-sm ${
                                item.manualOverride
                                  ? "text-[var(--color-accent-amber)] bg-[var(--color-accent-amber)]/10"
                                  : "text-text-muted hover:bg-[var(--color-surface-2)] hover:text-text-primary"
                              }`}
                            >
                              <svg viewBox="0 0 24 24" fill={item.manualOverride ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                                <path d="M12 17v5" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); startEditing(item); }}
                              aria-label={`Edit ${item.name}`}
                              className="flex h-11 w-11 items-center justify-center rounded-xl text-text-muted hover:bg-[var(--color-surface-2)] hover:text-text-primary tap-sm"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteGroceryItem(item.id); }}
                              aria-label={`Delete ${item.name}`}
                              className="flex h-11 w-11 items-center justify-center rounded-xl text-text-muted hover:bg-[var(--color-accent-rose)]/10 hover:text-[var(--color-accent-rose)] tap-sm"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                                <path d="M3 6h18M19 6l-1 14H6L5 6M8 6V4h8v2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setActionsSheetItem(item); setActionsItemId(item.id); }}
                              aria-label={`More actions for ${item.name}`}
                              className="hit-44 sm:hidden flex h-9 w-9 items-center justify-center rounded-xl text-text-muted hover:bg-[var(--color-surface-2)] hover:text-text-primary tap-sm"
                            >
                              <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
                                <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
                              </svg>
                            </button>
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
            <div className="hidden md:block">
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
        <div className="space-y-5 min-w-0 order-first md:order-none">
          <SectionCard title="Shopping progress" icon="🛒" tone="#10b981">
            <div className="space-y-4">
              <div className="flex items-end justify-between">
                <span className="text-3xl font-black text-text-primary display-numeral">{pct}%</span>
                <span className="text-xs font-bold text-text-muted">
                  {pickedUp} of {totalItems} picked up
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div
                  className="h-full rounded-full bg-[var(--color-accent-mint)] transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {pickedUp > 0 && (
                <SoftButton variant="ghost" size="md" onClick={clearCompleted} className="w-full text-[var(--color-accent-mint)]">
                  ✨ Clear {pickedUp} checked item{pickedUp > 1 ? "s" : ""}
                </SoftButton>
              )}
              {instacartStoreIds.length > 0 && (
                <div className="space-y-1.5 border-t border-white/10 pt-3">
                  <p className="text-xs font-semibold text-text-muted">Shop with Ask Instacart</p>
                  {instacartStoreIds.slice(0, 4).map((storeId) => (
                    <SoftButton
                      key={storeId}
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={() => window.open(`https://www.instacart.com/store/${storeId}`, "_blank", "noopener,noreferrer")}
                    >
                      🤖 Ask Instacart at {getStoreLabel(storeId)}
                    </SoftButton>
                  ))}
                  {instacartStoreIds.length > 4 && (
                    <p className="text-xs text-text-muted">…and {instacartStoreIds.length - 4} more</p>
                  )}
                </div>
              )}
            </div>
          </SectionCard>
        </div>
      </div>

      {/* ── Mobile sticky bulk bar ──
              `bottom-40`, not `bottom-28`. `ClemAssistant`'s Ask-Clem FAB is a
              `fixed bottom-24` (`h-14`) trigger, so it occupies 96..152px up the
              right edge — and at `z-40` it paints OVER this bar's `z-30`, straight
              on top of "Re-check all". Same family as the dock-over-dialog defect:
              a control that looks present and cannot be pressed. 160px clears it. */}
      {checkedCount > 0 && (
        <div className="md:hidden sticky bottom-40 z-30">
          <div className="rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/85 p-2 shadow-2xl backdrop-blur-xl">
            {bulkActions}
          </div>
        </div>
      )}

      <SyncPreviewSheet
        open={!!preview}
        title="Add missing from meal plan"
        preview={preview || { items: [], alreadyOnList: 0 }}
        busy={syncBusy}
        onConfirm={confirmMealSync}
        onCancel={() => setPreview(null)}
      />

      <StorePicker
        open={storePickerOpen}
        onClose={() => { setStorePickerOpen(false); setStorePickerItemId(null); }}
        currentStore={
          storePickerItemId != null
            ? groceryItems.find((i: any) => i.id === storePickerItemId)?.store || "any"
            : "any"
        }
        onSelect={handleStoreSelect}
      />

      <GroceryItemActionsSheet
        open={actionsItemId !== null}
        item={groceryItems.find((i: any) => i.id === actionsItemId) ?? actionsSheetItem}
        onClose={() => setActionsItemId(null)}
        onToggleLock={(it) => toggleManualOverride?.(it.id)}
        onEdit={(it) => startEditing(it)}
        onDelete={(it) => deleteGroceryItem(it.id)}
        onSendToPantry={(it) => sendSingleToPantry(it)}
        pantryBusy={sending}
      />

      <PriceCompareSheet
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        items={priceCompareItems}
        onApply={(cheapestStore) => {
          groceryItems.forEach((item: any) => {
            if (item.needed !== false) {
              updateGroceryItem(item.id, { store: cheapestStore });
            }
          });
          showToast(`✅ Set all items to ${getStoreLabel(cheapestStore)}`);
        }}
      />

      <StoreOrderSheet
        open={orderSheetOpen}
        onClose={() => setOrderSheetOpen(false)}
        items={groceryItems}
        stores={groupByStore(groceryItems.filter((i: any) => i.needed !== false))}
        onOrderStore={orderStore}
        onOrderAll={orderAllStores}
        ordering={ordering}
        orderingStore={orderingStore}
      />

      <ClemAssistant
        groceryItems={groceryItems}
        pantryItems={pantryItems}
        storeContext={ALL_STORES.map((s) => s.id).join(", ")}
        addGroceryItem={addGroceryItem}
        showToast={showToast}
      />
    </div>
  );
}
