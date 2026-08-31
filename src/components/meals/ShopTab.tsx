"use client";
import { useState, useEffect, useRef } from "react";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import Chip from "@/components/ui/Chip";
import TextField from "@/components/ui/TextField";
import ListRow from "@/components/ui/ListRow";
import SectionCard from "@/components/patterns/SectionCard";
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
        ? `Nothing to add — ${p.alreadyOnList} item${p.alreadyOnList === 1 ? "" : "s"} already on your list ✓`
        : "Nothing to add — your plan is fully stocked ✓");
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
      flashNote("Couldn't reach the database — items not added");
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
      showToast("❌ Couldn't create Instacart list — check connection");
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
      showToast("❌ Couldn't create Instacart lists — check connection");
    } finally {
      setOrdering(false);
      setOrderingStore(null);
    }
  };

  const filteredGrocery = activeCategory === "all" ? groceryItems : groceryItems.filter((i: any) => i.category === activeCategory);

  const priceCompareItems: PriceCompareItem[] = groceryItems
    .filter((i: any) => i.needed !== false)
    .map((i: any) => ({ name: i.name, prices: {} }));

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

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_280px]">
        <div className="space-y-5 min-w-0">
          <div className="space-y-3">
            <div className="flex gap-2">
              <TextField
                value={newGroceryItem}
                onChange={e => setNewGroceryItem(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder='Add an item — e.g. "2 bananas" or "milk"'
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

          <div className="glass rounded-2xl p-4">
            <SoftButton variant="primary" size="md" onClick={openMealSync} disabled={syncBusy} className="w-full">
              🍽️ {syncBusy ? "Adding…" : "Add missing from meal plan"}
            </SoftButton>
            <SoftButton variant="ghost" size="md" onClick={() => setOrderSheetOpen(true)} className="mt-2 w-full">
              📤 Order from Instacart
            </SoftButton>
            <SoftButton variant="ghost" size="md" onClick={() => setCompareOpen(true)} className="mt-2 w-full">
              💰 Compare Prices
            </SoftButton>
            {syncNote && <p role="status" className="mt-2 text-center text-xs font-semibold text-text-secondary">{syncNote}</p>}
          </div>

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
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setActiveCategory("all")}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold tap-sm ${
                activeCategory === "all" ? "bg-[var(--color-accent-selected)] text-white" : "glass-subtle text-text-secondary hover:text-text-primary"
              }`}
            >
              🛒 All
            </button>
            {groceryCategories.map(cat => {
              const count = groceryItems.filter((i: any) => i.category === cat.id).length;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold tap-sm ${
                    activeCategory === cat.id ? "bg-[var(--color-accent-selected)] text-white" : "glass-subtle text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {cat.emoji} {cat.name}{count > 0 ? ` · ${count}` : ""}
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
                            aria-label={!item.needed ? `Uncheck ${item.name}` : `Check off ${item.name}`}
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl tap-sm"
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
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleManualOverride?.(item.id); }}
                              aria-label={item.manualOverride ? `unlock ${item.name} for auto-sync` : `lock ${item.name} from auto-sync`}
                              title={item.manualOverride ? "Locked from auto-sync — tap to unlock" : "Lock from auto-sync"}
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
                              className="flex h-11 w-11 items-center justify-center rounded-xl text-text-muted hover:bg-[var(--color-surface-2)] hover:text-text-primary tap-sm"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteGroceryItem(item.id); }}
                              className="flex h-11 w-11 items-center justify-center rounded-xl text-text-muted hover:bg-[var(--color-accent-rose)]/10 hover:text-[var(--color-accent-rose)] tap-sm"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                                <path d="M3 6h18M19 6l-1 14H6L5 6M8 6V4h8v2" strokeLinecap="round" strokeLinejoin="round" />
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
