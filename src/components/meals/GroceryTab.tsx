import { useState } from "react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { groceryCategories } from "@/data/meals";
import { GroceryItem } from "@/types/meals";

export default function GroceryTab({
  groceryItems,
  setGroceryItems,
  activeCategory,
  setActiveCategory,
  isSyncing,
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

  const handleAdd = () => {
    addGroceryItem(newGroceryItem, newGroceryCategory, newGroceryPriority);
    setNewGroceryItem("");
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

  const neededCount = groceryItems.filter((i: any) => i.needed).length;
  const filteredGrocery = activeCategory === "all" ? groceryItems : groceryItems.filter((i: any) => i.category === activeCategory);

  return (
    <div className="px-4 space-y-4 pb-4">
      {/* Quick Add */}
      <Card className="!p-4">
        <p className="text-text-secondary text-xs font-medium mb-3">➕ Add Item</p>
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
              className="bg-surface-2 text-text-secondary text-xs rounded-lg px-2 outline-none"
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
              className="bg-surface-2 text-text-secondary text-xs rounded-lg px-2 outline-none"
            >
              <option value="low">🟢 Low</option>
              <option value="medium">🟡 Medium</option>
              <option value="high">🔴 High</option>
            </select>
            <button
              onClick={handleAdd}
              disabled={!newGroceryItem.trim()}
              className="flex-1 px-4 py-2 rounded-xl bg-nori-500 text-surface-0 text-xs font-semibold hover:bg-nori-400 disabled:opacity-50 transition-colors"
            >
              Add to List
            </button>
          </div>
        </div>
      </Card>

      {/* Sync Buttons */}
      <div className="flex gap-2">
        <button
          onClick={syncMealToGrocery}
          disabled={isSyncing}
          className="flex-1 py-2 rounded-xl bg-nori-500/10 text-nori-400 text-xs font-medium border border-nori-500/20 hover:bg-nori-500/20 transition-colors disabled:opacity-60"
        >
          🍽️ Sync from Meals
        </button>
        <button
          onClick={syncPantryToGrocery}
          disabled={isSyncing}
          className="flex-1 py-2 rounded-xl glass text-text-secondary text-xs font-medium border border-surface-3 hover:text-text-primary transition-colors disabled:opacity-60"
        >
          🥫 Sync from Pantry
        </button>
      </div>

      {/* Category Filter */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
        <button
          onClick={() => setActiveCategory("all")}
          className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${activeCategory === "all" ? "bg-nori-500 text-surface-0" : "glass text-text-secondary hover:text-text-primary"}`}
        >
          All
        </button>
        {groceryCategories.map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${activeCategory === cat.id ? "bg-nori-500 text-surface-0" : "glass text-text-secondary hover:text-text-primary"}`}
          >
            {cat.emoji} {cat.name}
          </button>
        ))}
      </div>

      {/* Grocery Items by Category */}
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
              <span className="text-xs text-nori-400">{neededCnt} needed</span>
            </div>
            <Card className="!p-0 overflow-hidden">
              <div className="divide-y divide-surface-3">
                {catItems.map((item: any) => (
                  <div key={item.id} className="p-3">
                    {editingGroceryId === item.id ? (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Name" className="flex-1 bg-transparent text-text-primary text-sm outline-none" />
                          <input value={editQuantity} onChange={e => setEditQuantity(e.target.value)} placeholder="Qty" className="w-16 bg-surface-2 text-text-secondary text-xs rounded px-2 outline-none" />
                        </div>
                        <input value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Notes (optional)" className="w-full bg-transparent text-text-secondary text-xs outline-none" />
                        <div className="flex gap-2">
                          <button onClick={() => saveEdit(item.id)} className="px-3 py-1 rounded-lg bg-nori-500 text-surface-0 text-xs font-medium">Save</button>
                          <button onClick={() => setEditingGroceryId(null)} className="px-3 py-1 rounded-lg text-text-secondary text-xs">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => toggleGroceryNeeded(item.id)}
                          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all ${item.needed ? "border-2 border-surface-4" : "bg-nori-500"}`}
                        >
                          {!item.needed && (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-3.5 h-3.5 text-surface-0">
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
                          <button onClick={() => startEditing(item)} className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                          <button onClick={() => deleteGroceryItem(item.id)} className="p-1.5 rounded-lg hover:bg-rose-500/10 text-text-muted hover:text-rose-400 transition-colors">
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

      {/* Bulk Actions */}
      <div className="flex gap-2 pb-4">
        <button
          onClick={() => {
            // Need a way to mark all needed, simplified for now
          }}
          className="flex-1 py-2 rounded-xl bg-surface-2 text-text-secondary text-xs font-medium hover:bg-nori-500/15 hover:text-nori-400 transition-colors"
        >
          Mark All Needed
        </button>
        <button
          onClick={() => {
            // Need a way to clear completed
          }}
          className="flex-1 py-2 rounded-xl bg-surface-2 text-text-secondary text-xs font-medium hover:bg-rose-500/15 hover:text-rose-400 transition-colors"
        >
          Clear Completed
        </button>
      </div>
    </div>
  );
}
