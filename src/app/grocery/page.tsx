"use client";

import { useState } from "react";
import PageShell from "@/components/ui/PageShell";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

interface GroceryItem {
  id: number;
  name: string;
  emoji: string;
  category: string;
  aisle: string;
  quantity?: string;
  notes?: string;
  priority: "low" | "medium" | "high";
  needed: boolean; // true = need to buy, false = already have
}

const groceryCategories = [
  { id: "produce", name: "Produce", emoji: "🥬", aisles: ["1-3"] },
  { id: "dairy", name: "Dairy", emoji: "🥛", aisles: ["4-5"] },
  { id: "meat", name: "Meat & Seafood", emoji: "🥩", aisles: ["6-7"] },
  { id: "pantry", name: "Pantry", emoji: "🍝", aisles: ["8-10"] },
  { id: "frozen", name: "Frozen", emoji: "🧊", aisles: ["11"] },
  { id: "snacks", name: "Snacks", emoji: "🍿", aisles: ["12"] },
  { id: "beverages", name: "Beverages", emoji: "🥤", aisles: ["13"] },
  { id: "household", name: "Household", emoji: "🧽", aisles: ["14-15"] },
];

const initialGroceryItems: GroceryItem[] = [
  { id: 1, name: "Bananas", emoji: "🍌", category: "produce", aisle: "1", priority: "medium", needed: true },
  { id: 2, name: "Baby spinach", emoji: "🥬", category: "produce", aisle: "2", priority: "high", needed: true },
  { id: 3, name: "Avocados", emoji: "🥑", category: "produce", aisle: "2", priority: "medium", needed: false },
  { id: 4, name: "Milk", emoji: "🥛", category: "dairy", aisle: "4", priority: "high", needed: true },
  { id: 5, name: "Eggs", emoji: "🥚", category: "dairy", aisle: "4", priority: "high", needed: true },
  { id: 6, name: "Cheddar cheese", emoji: "🧀", category: "dairy", aisle: "5", priority: "medium", needed: false },
  { id: 7, name: "Chicken breast", emoji: "🍗", category: "meat", aisle: "6", priority: "high", needed: true },
  { id: 8, name: "Ground beef", emoji: "🥩", category: "meat", aisle: "6", priority: "medium", needed: true },
  { id: 9, name: "Salmon fillets", emoji: "🐟", category: "meat", aisle: "7", priority: "low", needed: false },
  { id: 10, name: "Pasta", emoji: "🍝", category: "pantry", aisle: "8", priority: "medium", needed: true },
  { id: 11, name: "Olive oil", emoji: "🫒", category: "pantry", aisle: "8", priority: "low", needed: false },
  { id: 12, name: "Rice", emoji: "🍚", category: "pantry", aisle: "9", priority: "medium", needed: true },
  { id: 13, name: "Cereal", emoji: "🥣", category: "pantry", aisle: "9", priority: "low", needed: true },
  { id: 14, name: "Frozen peas", emoji: "🧊", category: "frozen", aisle: "11", priority: "medium", needed: true },
  { id: 15, name: "Ice cream", emoji: "🍨", category: "frozen", aisle: "11", priority: "low", needed: false },
  { id: 16, name: "Chips", emoji: "🥔", category: "snacks", aisle: "12", priority: "low", needed: true },
  { id: 17, name: "Coffee", emoji: "☕", category: "beverages", aisle: "13", priority: "high", needed: true },
];

export default function GroceryPage() {
  const [items, setItems] = useState<GroceryItem[]>(initialGroceryItems);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [newItem, setNewItem] = useState("");
  const [newItemCategory, setNewItemCategory] = useState("pantry");
  const [newItemPriority, setNewItemPriority] = useState<"low" | "medium" | "high">("medium");
  const [showItemDetail, setShowItemDetail] = useState<number | null>(null);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editQuantity, setEditQuantity] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const toggleNeeded = (id: number) => {
    setItems(items.map(item => 
      item.id === id ? { ...item, needed: !item.needed } : item
    ));
  };

  const setPriority = (id: number, priority: "low" | "medium" | "high") => {
    setItems(items.map(item => 
      item.id === id ? { ...item, priority } : item
    ));
  };

  const addItem = () => {
    if (newItem.trim()) {
      const category = groceryCategories.find(c => c.id === newItemCategory);
      setItems([...items, {
        id: Date.now(),
        name: newItem.trim(),
        emoji: category?.emoji || "📦",
        category: newItemCategory,
        aisle: "1",
        quantity: "",
        notes: "",
        priority: newItemPriority,
        needed: true
      }]);
      setNewItem("");
      setNewItemPriority("medium");
    }
  };

  const updateItem = (id: number) => {
    if (editName.trim()) {
      setItems(items.map(item => 
        item.id === id 
          ? { 
              ...item, 
              name: editName.trim(),
              quantity: editQuantity,
              notes: editNotes
            } 
          : item
      ));
      setEditingItemId(null);
      setEditName("");
      setEditQuantity("");
      setEditNotes("");
    }
  };

  const deleteItem = (id: number) => {
    setItems(items.filter(item => item.id !== id));
  };

  const startEditing = (item: GroceryItem) => {
    setEditingItemId(item.id);
    setEditName(item.name);
    setEditQuantity(item.quantity || "");
    setEditNotes(item.notes || "");
    setShowItemDetail(item.id);
  };

  const itemsByCategory = activeCategory === "all" 
    ? items 
    : items.filter(item => item.category === activeCategory);

  const neededItems = items.filter(item => item.needed);
  const haveItems = items.filter(item => !item.needed);

  return (
    <PageShell>
      <TopBar 
        title="Grocery List" 
        subtitle={`${neededItems.length} items needed`}
        right={
          <button
            onClick={() => setShowItemDetail(null)}
            className="relative flex items-center justify-center w-10 h-10 rounded-xl glass border border-surface-3"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.35 2.7a1 1 0 001.35 1.3h12M7 13h10M10 21a2 2 0 100-4 2 2 0 000 4zm8 0a2 2 0 100-4 2 2 0 000 4z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {neededItems.length > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-nori-500 rounded-full text-[10px] font-bold flex items-center justify-center">
                {neededItems.length}
              </span>
            )}
          </button>
        }
      />

      {/* Quick Add Section */}
      <div className="px-4 mt-4">
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-text-primary font-semibold text-sm">Add Item</h3>
            <button
              onClick={() => setShowItemDetail(null)}
              className="text-nori-400 text-xs hover:text-nori-300"
            >
              Cancel
            </button>
          </div>
          
          <Card className="!p-4">
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addItem()}
                  placeholder="What do you need?"
                  className="flex-1 bg-transparent text-text-primary text-sm outline-none placeholder:text-text-muted"
                />
                <select
                  value={newItemCategory}
                  onChange={(e) => setNewItemCategory(e.target.value)}
                  className="bg-surface-2 text-text-secondary text-xs rounded px-2 outline-none"
                >
                  {groceryCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.emoji} {cat.name}</option>
                  ))}
                </select>
              </div>
              
              <div className="flex gap-2">
                <select
                  value={newItemPriority}
                  onChange={(e) => setNewItemPriority(e.target.value as "low" | "medium" | "high")}
                  className="bg-surface-2 text-text-secondary text-sm rounded px-2 outline-none"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                <button
                  onClick={addItem}
                  disabled={!newItem.trim()}
                  className="flex-1 px-4 py-2 rounded-lg bg-nori-500 text-surface-0 text-xs font-medium hover:bg-nori-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Add Item
                </button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Category Filter */}
      <div className="px-4 mt-3">
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4">
          <button
            onClick={() => setActiveCategory("all")}
            className={`shrink-0 px-4 py-2 rounded-xl text-xs font-medium transition-all ${
              activeCategory === "all"
                ? "bg-nori-500 text-surface-0"
                : "glass text-text-secondary hover:text-text-primary"
            }`}
          >
            All Categories
          </button>
          {groceryCategories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                activeCategory === cat.id
                  ? "bg-nori-500 text-surface-0"
                  : "glass text-text-secondary hover:text-text-primary"
              }`}
            >
              <span>{cat.emoji}</span>
              <span>{cat.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Shopping List by Category */}
      <div className="px-4 mt-4 space-y-4">
        {activeCategory === "all" ? (
          // Group by category
          groceryCategories.map((cat) => {
            const catItems = items.filter(item => item.category === cat.id);
            if (catItems.length === 0) return null;
            
            const catNeeded = catItems.filter(item => item.needed).length;
            const catHave = catItems.filter(item => !item.needed).length;
            
            return (
              <section key={cat.id} className="space-y-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{cat.emoji}</span>
                    <h3 className="text-text-primary font-semibold text-sm">{cat.name}</h3>
                  </div>
                  <div className="flex gap-2 text-text-sm">
                    <span className="text-text-muted">{catHave} have</span>
                    <span className="text-nori-400">{catNeeded} need</span>
                  </div>
                </div>
                <Card className="!p-0 overflow-hidden">
                  <div className="divide-y divide-surface-3">
                    {catItems.map((item) => (
                      <div
                        key={item.id}
                        className={`border-b border-surface-3 last:border-0 p-4 hover:bg-surface-2/50 transition-colors cursor-pointer ${editingItemId === item.id ? "bg-nori-500/10" : ""}`}
                        onClick={() => editingItemId === item.id ? null : startEditing(item)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                              item.needed
                                ? "bg-nori-500 border-nori-500"
                                : "border-surface-4"
                            }`}>
                              {!item.needed && (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-4 h-4 text-surface-0">
                                  <path d="M5 12l5 5 9-9" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </div>
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-start gap-2">
                                <span className="text-xl">{item.emoji}</span>
                                <div className="flex-1">
                                  <p className={`text-text-primary font-medium text-sm ${
                                    editingItemId === item.id ? "opacity-0" : ""
                                  }`}>
                                    {item.name}
                                  </p>
                                  {item.quantity && (
                                    <p className="text-text-muted text-xs">
                                      Qty: {item.quantity}
                                    </p>
                                  )}
                                  {item.notes && (
                                    <p className="text-text-muted text-xs">
                                      {item.notes}
                                    </p>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 text-xs">
                                <Badge 
                                  variant={item.priority === "high" ? "rose" : item.priority === "medium" ? "amber" : "green"}
                                >
                                  {item.priority}
                                </Badge>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleNeeded(item.id);
                                  }}
                                  className="p-1 rounded-full hover:bg-surface-2/50 transition-colors"
                                >
                                  {item.needed ? "✓" : "○"}
                                </button>
                              </div>
                            </div>
                          </div>
                          {editingItemId === item.id ? (
                            <div className="flex items-end gap-2">
                              <button
                                onClick={() => updateItem(item.id)}
                                className="px-3 py-1 rounded-lg bg-nori-500 text-surface-0 text-xs font-medium hover:bg-nori-400"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => {
                                  setEditingItemId(null);
                                  setEditName("");
                                  setEditQuantity("");
                                  setEditNotes("");
                                }}
                                className="px-3 py-1 rounded-lg text-text-secondary text-xs hover:text-text-primary"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : null}
                        </div>
                        
                        {/* Editing form */}
                        {editingItemId === item.id && (
                          <div className="mt-4 pt-3 border-t border-surface-3">
                            <div className="space-y-3">
                              <div className="flex gap-2">
                                <input
                                  value={editName}
                                  onChange={(e) => setEditName(e.target.value)}
                                  placeholder="Item name"
                                  className="flex-1 bg-transparent text-text-primary text-sm outline-none placeholder:text-text-muted"
                                />
                                <input
                                  value={editQuantity}
                                  onChange={(e) => setEditQuantity(e.target.value)}
                                  placeholder="Quantity (optional)"
                                  className="bg-surface-2 text-text-secondary text-sm rounded px-2 outline-none"
                                />
                              </div>
                              <input
                                value={editNotes}
                                onChange={(e) => setEditNotes(e.target.value)}
                                placeholder="Notes (optional)"
                                className="w-full bg-transparent text-text-primary text-sm outline-none placeholder:text-text-muted"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              </section>
            );
          })
        ) : (
          // Single category view
          <section className="space-y-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">
                  {groceryCategories.find(c => c.id === activeCategory)?.emoji}
                </span>
                <h3 className="text-text-primary font-semibold text-sm">
                  {groceryCategories.find(c => c.id === activeCategory)?.name}
                </h3>
              </div>
              <div className="flex gap-2 text-text-sm">
                <span className="text-text-muted">{haveItems.filter(i => i.category === activeCategory).length} have</span>
                <span className="text-nori-400">{neededItems.filter(i => i.category === activeCategory).length} need</span>
              </div>
            </div>
            <Card className="!p-0 overflow-hidden">
              <div className="divide-y divide-surface-3">
                {itemsByCategory.map((item) => (
                  <div
                    key={item.id}
                    className={`border-b border-surface-3 last:border-0 p-4 hover:bg-surface-2/50 transition-colors cursor-pointer ${editingItemId === item.id ? "bg-nori-500/10" : ""}`}
                    onClick={() => editingItemId === item.id ? null : startEditing(item)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          item.needed
                            ? "bg-nori-500 border-nori-500"
                            : "border-surface-4"
                        }`}>
                          {!item.needed && (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-4 h-4 text-surface-0">
                              <path d="M5 12l5 5 9-9" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-start gap-2">
                            <span className="text-xl">{item.emoji}</span>
                            <div className="flex-1">
                              <p className={`text-text-primary font-medium text-sm ${
                                editingItemId === item.id ? "opacity-0" : ""
                              }`}>
                                {item.name}
                              </p>
                              {item.quantity && (
                                <p className="text-text-muted text-xs">
                                  Qty: {item.quantity}
                                </p>
                              )}
                              {item.notes && (
                                <p className="text-text-muted text-xs">
                                  {item.notes}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <Badge 
                              variant={item.priority === "high" ? "rose" : item.priority === "medium" ? "amber" : "green"}
                            >
                              {item.priority}
                            </Badge>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleNeeded(item.id);
                              }}
                              className="p-1 rounded-full hover:bg-surface-2/50 transition-colors"
                            >
                              {item.needed ? "✓" : "○"}
                            </button>
                          </div>
                        </div>
                      </div>
                      {editingItemId === item.id ? (
                        <div className="flex items-end gap-2">
                          <button
                            onClick={() => updateItem(item.id)}
                            className="px-3 py-1 rounded-lg bg-nori-500 text-surface-0 text-xs font-medium hover:bg-nori-400"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditingItemId(null);
                              setEditName("");
                              setEditQuantity("");
                              setEditNotes("");
                            }}
                            className="px-3 py-1 rounded-lg text-text-secondary text-xs hover:text-text-primary"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : null}
                    </div>
                    
                    {/* Editing form */}
                    {editingItemId === item.id && (
                      <div className="mt-4 pt-3 border-t border-surface-3">
                        <div className="space-y-3">
                          <div className="flex gap-2">
                            <input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              placeholder="Item name"
                              className="flex-1 bg-transparent text-text-primary text-sm outline-none placeholder:text-text-muted"
                            />
                            <input
                              value={editQuantity}
                              onChange={(e) => setEditQuantity(e.target.value)}
                              placeholder="Quantity (optional)"
                              className="bg-surface-2 text-text-secondary text-sm rounded px-2 outline-none"
                            />
                          </div>
                          <input
                            value={editNotes}
                            onChange={(e) => setEditNotes(e.target.value)}
                            placeholder="Notes (optional)"
                            className="w-full bg-transparent text-text-primary text-sm outline-none placeholder:text-text-muted"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </section>
        )}
      </div>

      {/* List Actions */}
      <div className="px-4 mt-4">
        <div className="flex gap-2">
          <button
            onClick={() => {
              // Mark all as needed
              setItems(items.map(item => ({ ...item, needed: true })));
            }}
            className="flex-1 py-2 rounded-lg bg-surface-2 text-text-secondary text-sm font-medium hover:bg-nori-500/15 hover:text-nori-400 transition-colors"
          >
            Mark All as Needed
          </button>
          <button
            onClick={() => {
              // Clear completed items
              setItems(items.filter(item => item.needed));
            }}
            className="flex-1 py-2 rounded-lg bg-surface-2 text-text-secondary text-sm font-medium hover:bg-nori-500/15 hover:text-nori-400 transition-colors"
          >
            Clear Completed
          </button>
        </div>
      </div>

      {/* Cart Sidebar */}
      {showItemDetail && (
        <div className="fixed inset-0 z-50 flex">
          <div 
            className="absolute inset-0 bg-black/50" 
            onClick={() => setShowItemDetail(null)}
          />
          <div className="relative ml-auto w-4/5 max-w-sm h-full glass border-l border-surface-3 flex flex-col">
            <div className="p-4 border-b border-surface-3">
              <h3 className="text-text-primary font-semibold">Item Details</h3>
              <p className="text-text-muted text-xs">{editingItemId !== null ? "Editing" : "Viewing"} item</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {editingItemId !== null ? (
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Item name"
                      className="flex-1 bg-transparent text-text-primary text-sm outline-none placeholder:text-text-muted"
                    />
                    <input
                      value={editQuantity}
                      onChange={(e) => setEditQuantity(e.target.value)}
                      placeholder="Quantity (optional)"
                      className="bg-surface-2 text-text-secondary text-sm rounded px-2 outline-none"
                    />
                  </div>
                  <input
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Notes (optional)"
                    className="w-full bg-transparent text-text-primary text-sm outline-none placeholder:text-text-muted"
                  />
                  <div className="flex gap-2 mt-4">
                  <select
                      value={newItemPriority}
                      onChange={(e) => setNewItemPriority(e.target.value as "low" | "medium" | "high")}
                      className="bg-surface-2 text-text-secondary text-sm rounded px-2 outline-none"
                    >
                      <option value="low">Low Priority</option>
                      <option value="medium">Medium Priority</option>
                      <option value="high">High Priority</option>
                    </select>
                    <div className="flex-1">
                      <button
                        onClick={() => {
                          if (editingItemId !== null) {
                            updateItem(editingItemId);
                          } else {
                            addItem();
                          }
                        }}
                        disabled={!editName.trim()}
                        className="w-full py-2 rounded-lg bg-nori-500 text-surface-0 text-xs font-medium hover:bg-nori-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {editingItemId !== null ? "Save Item" : "Add Item"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-text-muted text-sm text-center py-8">Select an item to view details</p>
              )}
            </div>
            <div className="p-4 border-t border-surface-3">
              <button
                onClick={() => setShowItemDetail(null)}
                className="w-full py-3 rounded-xl bg-nori-500 text-surface-0 font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}