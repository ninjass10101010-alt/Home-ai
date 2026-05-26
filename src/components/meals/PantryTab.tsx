import { useState } from "react";
import Card from "@/components/ui/Card";
import Link from "next/link";
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

  const handleAdd = () => {
    const success = addPantryItem(newPantryItem, newPantryStatus);
    if (success) setNewPantryItem("");
  };

  return (
    <div className="px-4 space-y-4 pb-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Plenty", count: pantryItems.filter((p: any) => p.status === "plenty").length, emoji: "✅", color: "text-nori-400" },
          { label: "Running Low", count: pantryItems.filter((p: any) => p.status === "low").length, emoji: "⚠️", color: "text-amber-400" },
          { label: "Out of Stock", count: pantryItems.filter((p: any) => p.status === "out").length, emoji: "❌", color: "text-rose-400" },
        ].map(stat => (
          <Card key={stat.label} className="!p-3 text-center">
            <span className="text-2xl block mb-1" style={{ animation: "float 3s ease-in-out infinite" }}>{stat.emoji}</span>
            <p className={`text-xl font-bold ${stat.color}`}>{stat.count}</p>
            <p className="text-[10px] text-text-muted">{stat.label}</p>
          </Card>
        ))}
      </div>

      {/* Add Item */}
      <Card className="!p-4">
        <p className="text-text-secondary text-xs font-medium mb-3">➕ Add to Pantry</p>
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
            className="bg-surface-2 text-text-secondary text-xs rounded-lg px-2 outline-none"
          >
            <option value="plenty">✅ Plenty</option>
            <option value="low">⚠️ Low</option>
            <option value="out">❌ Out</option>
          </select>
          <button
            onClick={handleAdd}
            disabled={!newPantryItem.trim()}
            className="px-4 py-2 rounded-xl bg-nori-500 text-surface-0 text-xs font-semibold hover:bg-nori-400 disabled:opacity-50 transition-colors"
          >
            Add
          </button>
        </div>
      </Card>

      {/* Sync */}
      <button
        onClick={syncPantryToGrocery}
        disabled={isSyncing}
        className="w-full py-2.5 rounded-xl bg-nori-500/10 text-nori-400 text-sm font-medium border border-nori-500/20 hover:bg-nori-500/20 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
      >
        🔄 {isSyncing ? "Syncing..." : "Sync Low/Out items → Grocery"}
      </button>

      {/* Pantry List */}
      {pantryItems.length > 0 ? (
        <Card className="!p-0 overflow-hidden">
          <div className="divide-y divide-surface-3">
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
                          ? s === "plenty" ? "bg-nori-500/20 text-nori-400" : s === "low" ? "bg-amber-500/20 text-amber-400" : "bg-rose-500/20 text-rose-400"
                          : "bg-surface-2 text-text-muted hover:text-text-primary"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                  <button
                    onClick={() => removePantryItem(p.id)}
                    className="ml-1 p-1 rounded-lg text-text-muted hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
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
          <p className="text-text-muted text-xs mt-1">Add items above to track your stock</p>
        </div>
      )}

      {/* Ask Consuela */}
      <Link
        href="/chat?q=What+can+I+make+with+my+pantry+items"
        className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-surface-2 text-text-secondary text-sm font-medium hover:bg-nori-500/10 hover:text-nori-400 transition-all border border-surface-3 hover:border-nori-500/20"
      >
        ✨ Ask Consuela what to cook with my pantry
      </Link>
    </div>
  );
}
