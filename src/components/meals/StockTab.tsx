"use client";
import { useState, useMemo, useEffect, useRef } from "react";
import SectionCard from "@/components/patterns/SectionCard";
import TextField from "@/components/ui/TextField";
import SoftButton from "@/components/ui/SoftButton";
import KitchenFlowCard from "@/components/meals/KitchenFlowCard";
import SyncPreviewSheet from "@/components/meals/SyncPreviewSheet";
import { mealSyncService, type SyncPreview } from "@/services/mealSync";
import { pantryPresets } from "@/data/meals";

const SECTIONS = [
  { id: "all", label: "All", emoji: "🥫" },
  { id: "plenty", label: "Plenty", emoji: "✅" },
  { id: "low", label: "Running Low", emoji: "⚠️" },
  { id: "out", label: "Out of Stock", emoji: "❌" },
];

function freshness(status: string) {
  if (status === "out")
    return { label: "Out of stock", dot: "bg-[var(--color-accent-rose)]", text: "text-[var(--color-accent-rose)]", bar: "bg-[var(--color-accent-rose)]", pct: 0 };
  if (status === "low")
    return { label: "Running low", dot: "bg-[var(--color-accent-amber)]", text: "text-[var(--color-accent-amber)]", bar: "bg-[var(--color-accent-amber)]", pct: 50 };
  return { label: "Stocked", dot: "bg-[var(--color-accent-mint)]", text: "text-[var(--color-accent-mint)]", bar: "bg-[var(--color-accent-mint)]", pct: 92 };
}

const PANTRY_CATEGORIES: Record<string, string> = {
  oil: "Staples", vinegar: "Staples", honey: "Staples", butter: "Staples", sugar: "Staples", salt: "Staples", pepper: "Staples", flour: "Baking", oats: "Grains", rice: "Grains", pasta: "Grains", bread: "Grains", cereal: "Grains", milk: "Dairy", eggs: "Dairy", cheese: "Dairy", yogurt: "Dairy", cream: "Dairy", chicken: "Protein", beef: "Protein", pork: "Protein", salmon: "Protein", shrimp: "Protein", fish: "Protein", garlic: "Produce", onion: "Produce", tomato: "Produce", bellpepper: "Produce", zucchini: "Produce", spinach: "Produce", banana: "Produce", apple: "Produce", lemon: "Produce",
};

function guessCategory(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, cat] of Object.entries(PANTRY_CATEGORIES)) {
    if (lower.includes(key)) return cat;
  }
  return "Staples";
}

function guessEmoji(name: string): string {
  const lower = name.toLowerCase();
  const emojiMap: Record<string, string> = {
    oil: "🫒", vinegar: "🍶", honey: "🍯", butter: "🧈", sugar: "🍚", salt: "🧂", pepper: "🌶️", flour: "🌾", oats: "🌾", rice: "🍚", pasta: "🍝", bread: "🍞", cereal: "🥣", milk: "🥛", eggs: "🥚", cheese: "🧀", yogurt: "🫙", cream: "🥛", chicken: "🍗", beef: "🥩", pork: "🍖", salmon: "🐟", shrimp: "🦐", fish: "🐟", garlic: "🧄", onion: "🧅", tomato: "🍅", bellpepper: "🫑", zucchini: "🥒", spinach: "🥬", banana: "🍌", apple: "🍎", lemon: "🍋",
  };
  for (const [key, emoji] of Object.entries(emojiMap)) {
    if (lower.includes(key)) return emoji;
  }
  return "🫙";
}

const normalizeName = (name: string) => name.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

export default function StockTab({
  pantryItems,
  groceryItems,
  addPantryItem,
  updatePantryStatus,
  removePantryItem,
  addGroceryItem,
  flowSummary,
}: any) {
  const [newPantryItem, setNewPantryItem] = useState("");
  const [newPantryStatus, setNewPantryStatus] = useState<"plenty" | "low" | "out">("plenty");
  const [section, setSection] = useState("all");
  const [activePresetGroup, setActivePresetGroup] = useState(pantryPresets[0]?.group ?? "Baking");
  const [showAllPresets, setShowAllPresets] = useState(false);
  const [showStaples, setShowStaples] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | string | null>(null);
  const PRESETS_PER_PAGE = 6;

  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (pendingDeleteId === null) return;
    const timer = setTimeout(() => setPendingDeleteId(null), 3000);
    return () => clearTimeout(timer);
  }, [pendingDeleteId]);

  useEffect(() => () => { if (noteTimer.current) clearTimeout(noteTimer.current); }, []);

  const flashNote = (msg: string) => {
    setSyncNote(msg);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setSyncNote(null), 4000);
  };

  const openPantrySync = () => {
    const p = mealSyncService.previewPantryToGrocery(pantryItems || [], groceryItems || []);
    if (p.items.length === 0) {
      flashNote(p.alreadyOnList > 0
        ? `Nothing running low that isn't already on your list ✓`
        : "Nothing running low ✓");
      return;
    }
    setPreview(p);
  };

  const confirmPantrySync = async () => {
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

  const handleAdd = async (name?: string) => {
    const itemName = (name ?? newPantryItem).trim();
    if (!itemName) return;
    const saved = await addPantryItem(itemName, newPantryStatus);
    if (saved !== false) setNewPantryItem("");
  };

  const handlePresetTap = (name: string) => {
    addPantryItem(name, "plenty");
  };

  const currentGroup = pantryPresets.find(g => g.group === activePresetGroup);
  const visiblePresets = showAllPresets ? currentGroup?.items ?? [] : (currentGroup?.items ?? []).slice(0, PRESETS_PER_PAGE);

  const visible = useMemo(() => {
    if (section === "all") return pantryItems;
    return pantryItems.filter((p: any) => p.status === section);
  }, [pantryItems, section]);

  return (
    <div className="space-y-6 pb-6">
      <KitchenFlowCard step="stock" summary={flowSummary} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* ── Left Column ── */}
        <div className="space-y-5 min-w-0">
          {/* ── Add Item ── */}
          <SectionCard title="Add to Pantry" icon="➕" description="Track what you have on hand">
            <div className="space-y-3">
              <div className="flex gap-2">
                <TextField
                  value={newPantryItem}
                  onChange={e => setNewPantryItem(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleAdd()}
                  placeholder="Item name..."
                  className="flex-1 min-w-0"
                />
                <select
                  value={newPantryStatus}
                  onChange={e => setNewPantryStatus(e.target.value as "plenty" | "low" | "out")}
                  className="shrink-0 rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-3 py-2.5 text-sm text-text-primary outline-none transition focus:border-[var(--color-accent-selected)]/50"
                >
                  <option value="plenty">✅ Plenty</option>
                  <option value="low">⚠️ Low</option>
                  <option value="out">❌ Out</option>
                </select>
                <SoftButton variant="primary" size="md" onClick={() => handleAdd()} disabled={!newPantryItem.trim()}>
                  Add
                </SoftButton>
              </div>
            </div>

            {/* Add Staples (collapsible) */}
            <div className="mt-4">
              <button
                onClick={() => setShowStaples(v => !v)}
                className="flex items-center justify-between w-full cursor-pointer rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/30 px-4 py-3 transition hover:bg-[var(--color-surface-0)]/50 active:scale-[0.97]"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                  ✨ Add staples
                </span>
                <svg
                  className={`h-4 w-4 text-text-secondary transition-transform ${showStaples ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showStaples && (
                <div className="mt-3 space-y-3 animate-[fadeInUp_0.2s_ease-out]">
                  <div className="grid grid-cols-2 gap-2.5">
                    {pantryPresets.map(g => {
                      const isSelected = activePresetGroup === g.group;
                      return (
                        <button
                          key={g.group}
                          onClick={() => { setActivePresetGroup(g.group); setShowAllPresets(false); }}
                          className={`group flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left transition-all duration-150 active:scale-[0.97] ${
                            isSelected
                              ? "bg-[var(--color-accent-button)] text-white shadow-lg shadow-[var(--color-accent-selected)]/25"
                              : "border border-white/10 bg-[var(--color-surface-0)]/30 text-text-secondary hover:text-text-primary hover:border-[var(--color-accent-selected)]/30"
                          }`}
                        >
                          <span className="text-xl shrink-0" aria-hidden>{g.emoji}</span>
                          <span className="flex-1 min-w-0 text-sm font-semibold truncate">{g.group}</span>
                          <span
                            className={`shrink-0 text-[10px] font-bold rounded-full px-1.5 py-0.5 ${
                              isSelected ? "bg-white/20 text-white" : "bg-[var(--color-surface-2)] text-text-muted"
                            }`}
                          >
                            {g.items.length}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {visiblePresets.map((item: { name: string; emoji: string }) => {
                      const alreadyIn = pantryItems.some((p: any) => p.item?.toLowerCase() === item.name.toLowerCase());
                      return (
                        <button
                          key={item.name}
                          onClick={() => !alreadyIn && handlePresetTap(item.name)}
                          disabled={alreadyIn}
                          className={`group flex items-center gap-2.5 rounded-2xl border border-white/10 px-3 py-2.5 text-left transition-all duration-150 active:scale-[0.97] ${
                            alreadyIn
                              ? "bg-[var(--color-accent-mint)]/10 border-[var(--color-accent-mint)]/20 opacity-60 cursor-default"
                              : "bg-[var(--color-surface-0)]/30 hover:border-[var(--color-accent-selected)]/40 hover:bg-[var(--color-surface-0)]/50"
                          }`}
                        >
                          <span className="text-lg shrink-0" aria-hidden>{item.emoji}</span>
                          <span className={`flex-1 min-w-0 text-sm font-medium truncate ${alreadyIn ? "text-[var(--color-accent-mint)]" : "text-text-primary"}`}>
                            {item.name}
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
                  {(currentGroup?.items.length ?? 0) > PRESETS_PER_PAGE && (
                    <button
                      onClick={() => setShowAllPresets(v => !v)}
                      className="mt-2 text-[11px] text-[var(--color-accent-selected)] hover:opacity-80 transition-opacity"
                    >
                      {showAllPresets ? "Show less ↑" : `Show ${(currentGroup?.items.length ?? 0) - PRESETS_PER_PAGE} more ↓`}
                    </button>
                  )}
                </div>
              )}
            </div>
          </SectionCard>

          {/* ── Section Filter ── */}
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            {SECTIONS.map(s => {
              const count = s.id === "all"
                ? pantryItems.length
                : pantryItems.filter((p: any) => p.status === s.id).length;
              return (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold tap-sm ${
                    section === s.id ? "bg-[var(--color-accent-selected)] text-white" : "glass-subtle text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {s.emoji} {s.label}{count > 0 ? ` · ${count}` : ""}
                </button>
              );
            })}
          </div>

          {/* ── Pantry Grid ── */}
          <div className="grid gap-3 sm:grid-cols-2">
            {visible.map((p: any) => {
              const f = freshness(p.status);
              const onGrocery = (groceryItems || []).some((g: any) => normalizeName(g.name) === normalizeName(p.item) && g.needed);
              return (
                <div
                  key={p.id}
                  className={`liquid-glass rounded-2xl p-4 group ${p.status === "out" ? "opacity-55" : ""}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-surface-0)]/50 text-2xl shadow-sm border border-[var(--color-surface-3)]">
                      {guessEmoji(p.item)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold leading-tight text-text-primary break-words" title={p.item}>{p.item}</p>
                      <p className="flex items-center gap-1.5 text-[11px] font-bold">
                        <span className={`h-1.5 w-1.5 rounded-full ${f.dot}`} />
                        <span className={f.text}>{f.label}</span>
                        <span className="text-text-muted">· {guessCategory(p.item)}</span>
                        {onGrocery && (
                          <span className="rounded-full bg-[var(--color-accent-amber)]/10 px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-accent-amber)]">
                            on grocery
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Freshness bar */}
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                    <div className={`${f.bar} h-full rounded-full transition-all duration-500`} style={{ width: `${f.pct}%` }} />
                  </div>

                  {/* Status toggles + delete */}
                  <div className="mt-3 flex items-center justify-between group">
                    <div className="flex items-center gap-1">
                      {(["plenty", "low", "out"] as const).map(s => (
                        <button
                          key={s}
                          onClick={() => updatePantryStatus(p.id, s)}
                          className={`cursor-pointer rounded-lg px-2 py-1 text-[10px] font-bold tap-sm ${
                            p.status === s
                              ? s === "plenty" ? "bg-[var(--color-accent-mint)]/20 text-[var(--color-accent-mint)]"
                                : s === "low" ? "bg-[var(--color-accent-amber)]/20 text-[var(--color-accent-amber)]"
                                : "bg-[var(--color-accent-rose)]/20 text-[var(--color-accent-rose)]"
                              : "bg-[var(--color-surface-2)] text-text-muted hover:text-text-primary"
                          }`}
                        >
                          {s === "plenty" ? "✅" : s === "low" ? "⚠️" : "❌"} {s.charAt(0).toUpperCase() + s.slice(1)}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        if (pendingDeleteId === p.id) {
                          setPendingDeleteId(null);
                          removePantryItem(p.id);
                        } else {
                          setPendingDeleteId(p.id);
                        }
                      }}
                      className={`cursor-pointer rounded-full p-1.5 text-text-muted sm:opacity-0 sm:group-hover:opacity-100 hover:bg-[var(--color-accent-rose)]/10 hover:text-[var(--color-accent-rose)] tap-sm ${
                        pendingDeleteId === p.id ? "opacity-100 !bg-[var(--color-accent-rose)]/20 !text-[var(--color-accent-rose)] ring-2 ring-[var(--color-accent-rose)]/40" : ""
                      }`}
                      title={pendingDeleteId === p.id ? "Tap again to remove" : "Remove item"}
                    >
                      {pendingDeleteId === p.id ? (
                        <span className="text-[10px] font-bold whitespace-nowrap px-1">Remove?</span>
                      ) : (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {visible.length === 0 && (
            <div className="glass rounded-2xl p-10 text-center">
              <p className="text-4xl">🥫</p>
              <p className="mt-2 font-bold text-text-primary">No items here</p>
              <p className="text-xs font-medium text-text-muted mt-1">
                {section === "all" ? "Add items to your pantry to get started" : `No ${section === "low" ? "low" : section === "out" ? "out-of-stock" : ""} items — nice!`}
              </p>
            </div>
          )}
        </div>

        {/* ── Right Column ── */}
        <div className="space-y-5 min-w-0 lg:order-2 order-first lg:order-none">
          <div className="glass rounded-2xl p-4">
            <SoftButton variant="primary" size="md" onClick={openPantrySync} disabled={syncBusy} className="w-full">
              🛒 {syncBusy ? "Adding…" : "Add low & out to grocery list"}
            </SoftButton>
            {syncNote && <p role="status" className="mt-2 text-center text-xs font-semibold text-text-secondary">{syncNote}</p>}
          </div>
        </div>
      </div>

      <SyncPreviewSheet
        open={!!preview}
        title="Add low & out to grocery list"
        preview={preview || { items: [], alreadyOnList: 0 }}
        busy={syncBusy}
        onConfirm={confirmPantrySync}
        onCancel={() => setPreview(null)}
      />
    </div>
  );
}
