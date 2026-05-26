"use client";
import { useState } from "react";
import Card from "@/components/ui/Card";
import Link from "next/link";
import { pantryPresets } from "@/data/meals";
import { PantryItem } from "@/types/meals";

export default function PantryTab({
  pantryItems,
  addPantryItem,
  updatePantryStatus,
  removePantryItem,
  syncPantryToGrocery,
  isSyncing,
}: any) {
  const [newPantryItem, setNewPantryItem] = useState("");
  const [newPantryStatus, setNewPantryStatus] = useState<"plenty" | "low" | "out">("plenty");
  const [activePresetGroup, setActivePresetGroup] = useState(pantryPresets[0]?.group ?? "Baking");
  const [showAllPresets, setShowAllPresets] = useState(false);

  const PRESETS_PER_PAGE = 10;

  const handleAdd = (name?: string) => {
    const itemName = (name ?? newPantryItem).trim();
    if (!itemName) return;
    const success = addPantryItem(itemName, newPantryStatus);
    if (success !== false) setNewPantryItem("");
  };

  const handlePresetTap = (name: string) => {
    addPantryItem(name, "plenty");
  };

  const currentGroup = pantryPresets.find(g => g.group === activePresetGroup);
  const visibleItems = showAllPresets
    ? currentGroup?.items ?? []
    : (currentGroup?.items ?? []).slice(0, PRESETS_PER_PAGE);

  return (
    <div className="px-4 space-y-4 pb-4">
      {/* ── Stats ──────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Plenty", count: pantryItems.filter((p: any) => p.status === "plenty").length, emoji: "✅", color: "text-[var(--color-accent-mint)]" },
          { label: "Running Low", count: pantryItems.filter((p: any) => p.status === "low").length, emoji: "⚠️", color: "text-[var(--color-accent-amber)]" },
          { label: "Out of Stock", count: pantryItems.filter((p: any) => p.status === "out").length, emoji: "❌", color: "text-[var(--color-accent-rose)]" },
        ].map(stat => (
          <Card key={stat.label} className="!p-3 text-center">
            <span className="text-2xl block mb-1" style={{ animation: "float 3s ease-in-out infinite" }}>{stat.emoji}</span>
            <p className={`text-xl font-bold ${stat.color}`}>{stat.count}</p>
            <p className="text-[10px] text-text-muted">{stat.label}</p>
          </Card>
        ))}
      </div>

      {/* ── Add Item ────────────────────────────────────── */}
      <Card className="!p-4">
        <p className="text-text-secondary text-xs font-semibold mb-3 flex items-center gap-1.5">
          <span>➕</span> Add to Pantry
        </p>
        <div className="flex gap-2">
          <input
            value={newPantryItem}
            onChange={e => setNewPantryItem(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAdd()}
            placeholder="Item name..."
            className="flex-1 bg-transparent text-text-primary text-sm outline-none placeholder:text-text-muted"
          />
          <select
            value={newPantryStatus}
            onChange={e => setNewPantryStatus(e.target.value as "plenty" | "low" | "out")}
            className="bg-[var(--color-surface-2)] text-text-secondary text-xs rounded-lg px-2 outline-none"
          >
            <option value="plenty">✅ Plenty</option>
            <option value="low">⚠️ Low</option>
            <option value="out">❌ Out</option>
          </select>
          <button
            onClick={() => handleAdd()}
            disabled={!newPantryItem.trim()}
            className="px-4 py-2 rounded-xl bg-[var(--color-accent-nori)] text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-all"
          >
            Add
          </button>
        </div>

        {/* ── Pantry Presets ────────────────────────────── */}
        <div className="mt-4">
          <p className="text-[11px] font-semibold text-text-muted mb-2 flex items-center gap-1">
            <span>⚡</span> Pantry Staples
          </p>
          {/* Group tabs */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 mb-2 no-scrollbar">
            {pantryPresets.map(g => (
              <button
                key={g.group}
                onClick={() => { setActivePresetGroup(g.group); setShowAllPresets(false); }}
                className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all ${
                  activePresetGroup === g.group
                    ? "bg-[var(--color-accent-selected)] text-white"
                    : "bg-[var(--color-surface-3)] text-text-secondary hover:text-text-primary"
                }`}
              >
                {g.emoji} {g.group}
              </button>
            ))}
          </div>
          {/* Preset chips */}
          <div className="flex gap-2 flex-wrap">
            {visibleItems.map((item: { name: string; emoji: string }) => {
              const alreadyIn = pantryItems.some((p: any) => p.item?.toLowerCase() === item.name.toLowerCase());
              return (
                <button
                  key={item.name}
                  onClick={() => !alreadyIn && handlePresetTap(item.name)}
                  disabled={alreadyIn}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all active:scale-95 animate-in ${
                    alreadyIn
                      ? "bg-[var(--color-accent-mint)]/10 border border-[var(--color-accent-mint)]/20 text-[var(--color-accent-mint)] opacity-60 cursor-default"
                      : "glass border border-[var(--color-surface-7)]/20 text-text-secondary hover:text-text-primary hover:border-[var(--color-accent-selected)]/30 hover:bg-[var(--color-accent-selected)]/5"
                  }`}
                >
                  <span>{item.emoji}</span>
                  <span>{item.name}</span>
                  {alreadyIn ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3 opacity-60">
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <span className="text-[var(--color-accent-selected)] opacity-70">+</span>
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
      </Card>

      {/* ── Sync ────────────────────────────────────────── */}
      <button
        onClick={syncPantryToGrocery}
        disabled={isSyncing}
        className="w-full py-2.5 rounded-xl bg-[var(--color-accent-nori)]/10 text-[var(--color-accent-nori)] text-sm font-medium border border-[var(--color-accent-nori)]/20 hover:bg-[var(--color-accent-nori)]/20 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
      >
        🔄 {isSyncing ? "Syncing..." : "Sync Low/Out items → Grocery"}
      </button>

      {/* ── Pantry List ─────────────────────────────────── */}
      {pantryItems.length > 0 ? (
        <Card className="!p-0 overflow-hidden">
          <div className="divide-y divide-[var(--color-surface-3)]">
            {pantryItems.map((p: any) => (
              <div key={p.id} className="flex items-center gap-3 p-3">
                <span className="text-xl">
                  {p.status === "plenty" ? "✅" : p.status === "low" ? "⚠️" : "❌"}
                </span>
                <span className="flex-1 text-text-primary text-sm font-medium">{p.item}</span>
                <div className="flex items-center gap-1">
                  {(["plenty", "low", "out"] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => updatePantryStatus(p.id, s)}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-medium transition-all ${
                        p.status === s
                          ? s === "plenty" ? "bg-[var(--color-accent-mint)]/20 text-[var(--color-accent-mint)]"
                            : s === "low" ? "bg-[var(--color-accent-amber)]/20 text-[var(--color-accent-amber)]"
                            : "bg-[var(--color-accent-rose)]/20 text-[var(--color-accent-rose)]"
                          : "bg-[var(--color-surface-2)] text-text-muted hover:text-text-primary"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                  <button
                    onClick={() => removePantryItem(p.id)}
                    className="ml-1 p-1 rounded-lg text-text-muted hover:text-[var(--color-accent-rose)] hover:bg-[var(--color-accent-rose)]/10 transition-colors"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <div className="text-center py-10">
          <span className="text-4xl block mb-3" style={{ animation: "float 3s ease-in-out infinite" }}>🥫</span>
          <p className="text-text-secondary text-sm">Your pantry is empty</p>
          <p className="text-text-muted text-xs mt-1">Tap a staple above to get started</p>
        </div>
      )}

      {/* ── Ask Consuela ─────────────────────────────────── */}
      <Link
        href="/chat?q=What+can+I+make+with+my+pantry+items"
        className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-[var(--color-surface-2)] text-text-secondary text-sm font-medium hover:bg-[var(--color-accent-nori)]/10 hover:text-[var(--color-accent-nori)] transition-all border border-[var(--color-surface-3)] hover:border-[var(--color-accent-nori)]/20"
      >
        ✨ Ask Consuela what to cook with my pantry
      </Link>
    </div>
  );
}
