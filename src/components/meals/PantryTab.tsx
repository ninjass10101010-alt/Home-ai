"use client";
import { useState, useMemo } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import { pantryPresets } from "@/data/meals";
import { PantryItem } from "@/types/meals";

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
  const [section, setSection] = useState("all");
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
  const visiblePresets = showAllPresets ? currentGroup?.items ?? [] : (currentGroup?.items ?? []).slice(0, PRESETS_PER_PAGE);

  // Stats
  const plenty = pantryItems.filter((p: any) => p.status === "plenty").length;
  const low = pantryItems.filter((p: any) => p.status === "low").length;
  const out = pantryItems.filter((p: any) => p.status === "out").length;

  const visible = useMemo(() => {
    if (section === "all") return pantryItems;
    return pantryItems.filter((p: any) => p.status === section);
  }, [pantryItems, section]);

  const expiring = pantryItems.filter((p: any) => p.status === "low");

  return (
    <div className="space-y-6 pb-6">
      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Stocked", count: plenty, emoji: "✅", color: "text-[var(--color-accent-mint)]", bg: "bg-[var(--color-accent-mint)]/10" },
          { label: "Running Low", count: low, emoji: "⚠️", color: "text-[var(--color-accent-amber)]", bg: "bg-[var(--color-accent-amber)]/10" },
          { label: "Out of Stock", count: out, emoji: "❌", color: "text-[var(--color-accent-rose)]", bg: "bg-[var(--color-accent-rose)]/10" },
        ].map(stat => (
          <div key={stat.label} className="glass rounded-2xl p-4 sm:p-5 text-center">
            <div className="flex items-center justify-between">
              <span className="text-2xl" style={{ animation: "float 3s ease-in-out infinite" }}>{stat.emoji}</span>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${stat.bg} ${stat.color}`}>
                {stat.label === "Stocked" ? "stocked" : stat.label === "Running Low" ? "use soon" : "out"}
              </span>
            </div>
            <p className={`mt-2 text-2xl font-black sm:text-3xl ${stat.color}`}>{stat.count}</p>
            <p className="text-[11px] font-bold text-text-muted">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* ── Use It Up Banner ── */}
      {low > 0 && (
        <div className="liquid-glass flex flex-col gap-3 rounded-2xl p-5 sm:flex-row sm:items-center" style={{ borderLeft: "4px solid var(--color-accent-amber, #fbbf24)" }}>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl shadow" style={{ backgroundColor: "var(--color-accent-amber, #fbbf24)20" }}>
            🍳
          </div>
          <div className="flex-1">
            <h4 className="font-bold text-text-primary">Use it up before it&apos;s gone!</h4>
            <p className="text-xs font-medium leading-relaxed text-text-secondary mt-1">
              {expiring.map((e: any) => e.item).join(", ")} {low > 1 ? "are" : "is"} running low.
              Try a <span className="text-[var(--color-accent-selected)] font-semibold">recipe with what you have</span>.
            </p>
          </div>
          <Link
            href="/chat?q=What+can+I+make+with+my+pantry+items"
            className="shrink-0 cursor-pointer rounded-2xl bg-[var(--color-accent-selected)] px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-[var(--color-accent-selected)]/25 transition hover:opacity-90 active:scale-95"
          >
            Find recipes →
          </Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* ── Left Column ── */}
        <div className="space-y-5">
          {/* ── Add Item ── */}
          <div className="glass rounded-2xl p-4 sm:p-5">
            <p className="text-text-secondary text-xs font-semibold mb-3 flex items-center gap-1.5">
              <span>➕</span> Add to Pantry
            </p>
            <div className="flex gap-2">
              <input
                value={newPantryItem}
                onChange={e => setNewPantryItem(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="Item name..."
                className="flex-1 min-w-0 rounded-2xl border border-[var(--color-surface-3)] bg-[var(--color-surface-0)]/50 px-4 py-2.5 text-sm font-semibold text-text-primary placeholder:text-text-muted/50 outline-none transition focus:border-[var(--color-accent-selected)]/50 focus:bg-[var(--color-surface-0)]/80 focus:ring-2 focus:ring-[var(--color-accent-selected)]/20"
              />
              <select
                value={newPantryStatus}
                onChange={e => setNewPantryStatus(e.target.value as "plenty" | "low" | "out")}
                className="rounded-xl bg-[var(--color-surface-2)] text-text-secondary text-xs px-3 py-2 outline-none"
              >
                <option value="plenty">✅ Plenty</option>
                <option value="low">⚠️ Low</option>
                <option value="out">❌ Out</option>
              </select>
              <button
                onClick={() => handleAdd()}
                disabled={!newPantryItem.trim()}
                className="cursor-pointer rounded-2xl bg-[var(--color-accent-button)] px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-[var(--color-accent-selected)]/25 transition hover:opacity-90 active:scale-95 disabled:opacity-40"
              >
                Add
              </button>
            </div>

            {/* Preset Staples */}
            <div className="mt-4">
              <p className="text-[11px] font-semibold text-text-muted mb-2 flex items-center gap-1">
                <span>⚡</span> Pantry Staples
              </p>
              <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 mb-2 no-scrollbar">
                {pantryPresets.map(g => (
                  <button
                    key={g.group}
                    onClick={() => { setActivePresetGroup(g.group); setShowAllPresets(false); }}
                    className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all ${
                      activePresetGroup === g.group
                        ? "bg-[var(--color-accent-button)] text-white"
                        : "bg-[var(--color-surface-3)] text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {g.emoji} {g.group}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 flex-wrap">
                {visiblePresets.map((item: { name: string; emoji: string }) => {
                  const alreadyIn = pantryItems.some((p: any) => p.item?.toLowerCase() === item.name.toLowerCase());
                  return (
                    <button
                      key={item.name}
                      onClick={() => !alreadyIn && handlePresetTap(item.name)}
                      disabled={alreadyIn}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all active:scale-95 ${
                        alreadyIn
                          ? "bg-[var(--color-accent-mint)]/10 border border-[var(--color-accent-mint)]/20 text-[var(--color-accent-mint)] opacity-60 cursor-default"
                          : "glass-subtle border border-[var(--color-surface-7)]/20 text-text-secondary hover:text-text-primary hover:border-[var(--color-accent-selected)]/30 hover:bg-[var(--color-accent-selected)]/5"
                      }`}
                    >
                      <span>{item.emoji}</span>
                      <span>{item.name}</span>
                      {alreadyIn ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3 opacity-60"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
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
          </div>

          {/* ── Section Filter ── */}
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 no-scrollbar">
            {SECTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`shrink-0 cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-bold transition-all ${
                  section === s.id
                    ? "bg-[var(--color-accent-selected)] text-white shadow-lg shadow-[var(--color-accent-selected)]/25"
                    : "glass-subtle text-text-secondary hover:text-text-primary"
                }`}
              >
                {s.emoji} {s.label}
              </button>
            ))}
          </div>

          {/* ── Pantry Grid ── */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((p: any) => {
              const f = freshness(p.status);
              return (
                <div
                  key={p.id}
                  className={`liquid-glass rounded-2xl p-4 transition-transform duration-200 hover:-translate-y-0.5 ${p.status === "out" ? "opacity-55" : ""}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-surface-0)]/50 text-2xl shadow-sm border border-[var(--color-surface-3)]">
                      {guessEmoji(p.item)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-text-primary">{p.item}</p>
                      <p className="flex items-center gap-1.5 text-[11px] font-bold">
                        <span className={`h-1.5 w-1.5 rounded-full ${f.dot}`} />
                        <span className={f.text}>{f.label}</span>
                        <span className="text-text-muted">· {guessCategory(p.item)}</span>
                      </p>
                    </div>
                  </div>

                  {/* Freshness bar */}
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                    <div className={`${f.bar} h-full rounded-full transition-all duration-500`} style={{ width: `${f.pct}%` }} />
                  </div>

                  {/* Status toggles + delete */}
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      {(["plenty", "low", "out"] as const).map(s => (
                        <button
                          key={s}
                          onClick={() => updatePantryStatus(p.id, s)}
                          className={`cursor-pointer rounded-lg px-2 py-1 text-[10px] font-bold transition-all active:scale-95 ${
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
                      onClick={() => removePantryItem(p.id)}
                      className="cursor-pointer rounded-full p-1.5 text-text-muted opacity-0 transition group-hover:opacity-100 hover:bg-[var(--color-accent-rose)]/10 hover:text-[var(--color-accent-rose)]"
                      title="Remove item"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
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
        <div className="space-y-5 lg:order-2 order-first lg:order-none">
          {/* ── Sync ── */}
          <button
            onClick={syncPantryToGrocery}
            disabled={isSyncing}
            className="w-full cursor-pointer rounded-2xl bg-[var(--color-accent-selected)]/10 text-[var(--color-accent-selected)] text-sm font-bold border border-[var(--color-accent-selected)]/20 hover:bg-[var(--color-accent-selected)]/20 transition-all disabled:opacity-60 flex items-center justify-center gap-2 py-2.5"
          >
            🔄 {isSyncing ? "Syncing..." : "Sync Low/Out → Grocery"}
          </button>

          {/* ── Tip / Ask Consuela ── */}
          <div className="glass-subtle rounded-2xl p-5" style={{ animation: "float 6s ease-in-out infinite" }}>
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-2xl shadow" style={{ backgroundColor: "var(--color-accent-cyan, #22d3ee)20" }}>
                🧊
              </div>
              <div>
                <h4 className="font-bold text-text-primary">Pantry tracker tips</h4>
                <p className="mt-1 text-xs font-medium leading-relaxed text-text-secondary">
                  Tap Plenty ✅, Low ⚠️, or Out ❌ to track what you have. Running low items sync to your grocery list automatically.
                </p>
              </div>
            </div>
          </div>

          {/* ── Quick Stats ── */}
          <div className="glass rounded-2xl p-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">
              Pantry overview
            </h3>
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-text-primary">Total items</span>
                <span className="text-lg font-black text-text-primary">{pantryItems.length}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div className="flex h-full">
                  <div className="bg-[var(--color-accent-mint)] h-full transition-all duration-500" style={{ width: `${pantryItems.length ? (plenty / pantryItems.length) * 100 : 0}%` }} />
                  <div className="bg-[var(--color-accent-amber)] h-full transition-all duration-500" style={{ width: `${pantryItems.length ? (low / pantryItems.length) * 100 : 0}%` }} />
                  <div className="bg-[var(--color-accent-rose)] h-full transition-all duration-500" style={{ width: `${pantryItems.length ? (out / pantryItems.length) * 100 : 0}%` }} />
                </div>
              </div>
              <div className="flex gap-4 text-[11px] font-bold">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--color-accent-mint)]" /> {plenty} stocked</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--color-accent-amber)]" /> {low} low</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--color-accent-rose)]" /> {out} out</span>
              </div>
            </div>
          </div>

          {/* ── Ask Consuela ── */}
          <Link
            href="/chat?q=What+can+I+make+with+my+pantry+items"
            className="flex items-center justify-center gap-2 py-3 rounded-2xl glass text-text-secondary text-sm font-medium hover:bg-[var(--color-accent-selected)]/10 hover:text-[var(--color-accent-selected)] transition-all border border-[var(--color-surface-3)]"
          >
            ✨ Ask Consuela what to cook
          </Link>
        </div>
      </div>
    </div>
  );
}