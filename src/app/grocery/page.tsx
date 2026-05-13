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
  price?: string;
  checked: boolean;
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
  { id: 1, name: "Bananas", emoji: "🍌", category: "produce", aisle: "1", checked: false },
  { id: 2, name: "Baby spinach", emoji: "🥬", category: "produce", aisle: "2", checked: false },
  { id: 3, name: "Avocados", emoji: "🥑", category: "produce", aisle: "2", checked: false },
  { id: 4, name: "Milk", emoji: "🥛", category: "dairy", aisle: "4", checked: true },
  { id: 5, name: "Eggs", emoji: "🥚", category: "dairy", aisle: "4", checked: false },
  { id: 6, name: "Cheddar cheese", emoji: "🧀", category: "dairy", aisle: "5", checked: false },
  { id: 7, name: "Chicken breast", emoji: "🍗", category: "meat", aisle: "6", checked: false },
  { id: 8, name: "Ground beef", emoji: "🥩", category: "meat", aisle: "6", checked: false },
  { id: 9, name: "Salmon fillets", emoji: "🐟", category: "meat", aisle: "7", checked: false },
  { id: 10, name: "Pasta", emoji: "🍝", category: "pantry", aisle: "8", checked: false },
  { id: 11, name: "Olive oil", emoji: "🫒", category: "pantry", aisle: "8", checked: false },
  { id: 12, name: "Rice", emoji: "🍚", category: "pantry", aisle: "9", checked: false },
  { id: 13, name: "Cereal", emoji: "🥣", category: "pantry", aisle: "9", checked: false },
  { id: 14, name: "Frozen peas", emoji: "🧊", category: "frozen", aisle: "11", checked: false },
  { id: 15, name: "Ice cream", emoji: "🍨", category: "frozen", aisle: "11", checked: false },
  { id: 16, name: "Chips", emoji: "🥔", category: "snacks", aisle: "12", checked: false },
  { id: 17, name: "Coffee", emoji: "☕", category: "beverages", aisle: "13", checked: false },
];

export default function GroceryPage() {
  const [items, setItems] = useState<GroceryItem[]>(initialGroceryItems);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [newItem, setNewItem] = useState("");
  const [newItemCategory, setNewItemCategory] = useState("pantry");
  const [showCartSidebar, setShowCartSidebar] = useState(false);

  const toggleItem = (id: number) => {
    setItems(items.map(item => 
      item.id === id ? { ...item, checked: !item.checked } : item
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
        checked: false
      }]);
      setNewItem("");
    }
  };

  const itemsByCategory = activeCategory === "all" 
    ? items 
    : items.filter(item => item.category === activeCategory);

  const uncheckedItems = items.filter(item => !item.checked);
  const checkedItems = items.filter(item => item.checked);

  return (
    <PageShell>
      <TopBar 
        title="Supermarket Run" 
        subtitle={`${uncheckedItems.length} items to grab`}
        right={
          <button
            onClick={() => setShowCartSidebar(true)}
            className="relative flex items-center justify-center w-10 h-10 rounded-xl glass border border-surface-3"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.35 2.7a1 1 0 001.35 1.3h12M7 13h10M10 21a2 2 0 100-4 2 2 0 000 4zm8 0a2 2 0 100-4 2 2 0 000 4z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {checkedItems.length > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-nori-500 rounded-full text-[10px] font-bold flex items-center justify-center">
                {checkedItems.length}
              </span>
            )}
          </button>
        }
      />

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
            All Aisles
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

      {/* Shopping List by Aisle */}
      <div className="px-4 mt-4 space-y-4">
        {activeCategory === "all" ? (
          // Group by category
          groceryCategories.map((cat) => {
            const catItems = items.filter(item => item.category === cat.id);
            if (catItems.length === 0) return null;
            
            return (
              <section key={cat.id}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">{cat.emoji}</span>
                  <h3 className="text-text-primary font-semibold text-sm">{cat.name}</h3>
                  <span className="text-text-muted text-xs">Aisle {cat.aisles.join("-")}</span>
                </div>
                <Card className="!p-0 overflow-hidden">
                  <div className="divide-y divide-surface-3">
                    {catItems.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => toggleItem(item.id)}
                        className="w-full flex items-center gap-3 p-3 text-left hover:bg-surface-2/50 transition-colors"
                      >
                        <div className={`w-6 h-6 rounded-full border flex items-center justify-center ${
                          item.checked 
                            ? "bg-nori-500 border-nori-500" 
                            : "border-surface-4"
                        }`}>
                          {item.checked && (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-4 h-4 text-surface-0">
                              <path d="M5 12l5 5 9-9" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                        <span className="text-xl">{item.emoji}</span>
                        <span className={`flex-1 text-sm ${
                          item.checked ? "text-text-muted line-through" : "text-text-primary"
                        }`}>
                          {item.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </Card>
              </section>
            );
          })
        ) : (
          // Single category view
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">
                {groceryCategories.find(c => c.id === activeCategory)?.emoji}
              </span>
              <h3 className="text-text-primary font-semibold text-sm">
                {groceryCategories.find(c => c.id === activeCategory)?.name}
              </h3>
            </div>
            <Card className="!p-0 overflow-hidden">
              <div className="divide-y divide-surface-3">
                {itemsByCategory.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => toggleItem(item.id)}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-surface-2/50 transition-colors"
                  >
                    <div className={`w-6 h-6 rounded-full border flex items-center justify-center ${
                      item.checked 
                        ? "bg-nori-500 border-nori-500" 
                        : "border-surface-4"
                    }`}>
                      {item.checked && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-4 h-4 text-surface-0">
                          <path d="M5 12l5 5 9-9" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <span className="text-xl">{item.emoji}</span>
                    <span className={`flex-1 text-sm ${
                      item.checked ? "text-text-muted line-through" : "text-text-primary"
                    }`}>
                      {item.name}
                    </span>
                  </button>
                ))}
              </div>
            </Card>
          </section>
        )}
      </div>

      {/* Quick Add Bar */}
      <div className="fixed bottom-20 left-0 right-0 px-4">
        <Card className="!p-3">
          <div className="flex gap-2">
            <input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addItem()}
              placeholder="Quick add item..."
              className="flex-1 bg-transparent text-text-primary text-sm outline-none placeholder:text-text-muted"
            />
            <select
              value={newItemCategory}
              onChange={(e) => setNewItemCategory(e.target.value)}
              className="bg-surface-2 text-text-secondary text-xs rounded px-2 outline-none"
            >
              {groceryCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
            <button
              onClick={addItem}
              disabled={!newItem.trim()}
              className="px-4 py-1.5 rounded-lg bg-nori-500 text-surface-0 text-xs font-medium hover:bg-nori-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Add
            </button>
          </div>
        </Card>
      </div>

      {/* Cart Sidebar */}
      {showCartSidebar && (
        <div className="fixed inset-0 z-50 flex">
          <div 
            className="absolute inset-0 bg-black/50" 
            onClick={() => setShowCartSidebar(false)}
          />
          <div className="relative ml-auto w-4/5 max-w-sm h-full glass border-l border-surface-3 flex flex-col">
            <div className="p-4 border-b border-surface-3">
              <h3 className="text-text-primary font-semibold">Shopping Cart</h3>
              <p className="text-text-muted text-xs">{checkedItems.length} items grabbed</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {checkedItems.length === 0 ? (
                <p className="text-text-muted text-sm text-center py-8">Cart is empty</p>
              ) : (
                <div className="space-y-2">
                  {checkedItems.map((item) => (
                    <div key={item.id} className="flex items-center gap-2">
                      <span className="text-lg">{item.emoji}</span>
                      <span className="text-text-primary text-sm">{item.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-surface-3">
              <button
                onClick={() => setShowCartSidebar(false)}
                className="w-full py-3 rounded-xl bg-nori-500 text-surface-0 font-medium"
              >
                Continue Shopping
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}