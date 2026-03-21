"use client";

import { useState } from "react";
import PageShell from "@/components/ui/PageShell";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Link from "next/link";

interface GroceryItem {
  id: number;
  name: string;
  quantity: string;
  category: string;
  urgent: boolean;
  checked: boolean;
  addedBy: string;
  emoji: string;
}

const initialItems: GroceryItem[] = [
  { id: 1, name: "Chicken breast", quantity: "2 lbs", category: "Meat & Seafood", urgent: true, checked: false, addedBy: "Nori", emoji: "🍗" },
  { id: 2, name: "Shrimp", quantity: "1 lb", category: "Meat & Seafood", urgent: true, checked: false, addedBy: "Nori", emoji: "🦐" },
  { id: 3, name: "Ground beef", quantity: "1.5 lbs", category: "Meat & Seafood", urgent: false, checked: false, addedBy: "Mom", emoji: "🥩" },
  { id: 4, name: "Broccoli", quantity: "1 head", category: "Produce", urgent: true, checked: false, addedBy: "Nori", emoji: "🥦" },
  { id: 5, name: "Bell peppers", quantity: "3", category: "Produce", urgent: false, checked: false, addedBy: "Nori", emoji: "🫑" },
  { id: 6, name: "Zucchini", quantity: "2", category: "Produce", urgent: false, checked: true, addedBy: "Mom", emoji: "🥒" },
  { id: 7, name: "Mozzarella", quantity: "8 oz", category: "Dairy", urgent: false, checked: false, addedBy: "Nori", emoji: "🧀" },
  { id: 8, name: "Parmesan", quantity: "4 oz", category: "Dairy", urgent: false, checked: false, addedBy: "Nori", emoji: "🧀" },
  { id: 9, name: "Penne pasta", quantity: "1 box", category: "Pantry", urgent: false, checked: false, addedBy: "Nori", emoji: "🍝" },
  { id: 10, name: "Tomato sauce", quantity: "2 cans", category: "Pantry", urgent: true, checked: false, addedBy: "Nori", emoji: "🥫" },
  { id: 11, name: "Taco shells", quantity: "1 box", category: "Pantry", urgent: false, checked: false, addedBy: "Nori", emoji: "🌮" },
  { id: 12, name: "Salsa", quantity: "1 jar", category: "Pantry", urgent: false, checked: false, addedBy: "Dad", emoji: "🫙" },
];

const categories = ["All", "Meat & Seafood", "Produce", "Dairy", "Pantry", "Frozen", "Other"];

const categoryEmojis: Record<string, string> = {
  "All": "🛒",
  "Meat & Seafood": "🥩",
  "Produce": "🥦",
  "Dairy": "🥛",
  "Pantry": "🫙",
  "Frozen": "🧊",
  "Other": "📦",
};

export default function GroceryPage() {
  const [items, setItems] = useState<GroceryItem[]>(initialItems);
  const [activeCategory, setActiveCategory] = useState("All");
  const [newItem, setNewItem] = useState("");
  const [showChecked, setShowChecked] = useState(false);

  const toggleItem = (id: number) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item))
    );
  };

  const addItem = () => {
    if (!newItem.trim()) return;
    const newEntry: GroceryItem = {
      id: Date.now(),
      name: newItem.trim(),
      quantity: "1",
      category: "Other",
      urgent: false,
      checked: false,
      addedBy: "You",
      emoji: "🛒",
    };
    setItems((prev) => [newEntry, ...prev]);
    setNewItem("");
  };

  const filtered = items.filter((item) => {
    const catMatch = activeCategory === "All" || item.category === activeCategory;
    const checkedMatch = showChecked ? true : !item.checked;
    return catMatch && checkedMatch;
  });

  const grouped = categories.slice(1).reduce<Record<string, GroceryItem[]>>((acc, cat) => {
    const catItems = filtered.filter((i) => i.category === cat);
    if (catItems.length > 0) acc[cat] = catItems;
    return acc;
  }, {});

  const uncheckedCount = items.filter((i) => !i.checked).length;
  const checkedCount = items.filter((i) => i.checked).length;

  return (
    <PageShell>
      <TopBar
        title="Grocery List"
        subtitle={`${uncheckedCount} items left`}
        right={
          <Link
            href="/chat?q=Generate+grocery+list+from+meals"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-nori-500/15 text-nori-400 text-xs font-medium hover:bg-nori-500/25 transition-colors"
          >
            ✨ From meals
          </Link>
        }
      />

      <div className="px-4 space-y-4">
        {/* Progress bar */}
        <Card className="!p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-text-secondary text-xs">Shopping progress</p>
            <p className="text-text-primary text-xs font-semibold">
              {checkedCount} / {items.length} done
            </p>
          </div>
          <div className="w-full h-2 rounded-full bg-surface-3 overflow-hidden">
            <div
              className="h-full rounded-full bg-nori-500 transition-all duration-500"
              style={{ width: `${(checkedCount / items.length) * 100}%` }}
            />
          </div>
          <div className="flex gap-2 mt-2.5">
            <Badge variant="rose">{items.filter((i) => i.urgent && !i.checked).length} urgent</Badge>
            <Badge variant="gray">{uncheckedCount} remaining</Badge>
            {checkedCount > 0 && <Badge variant="green">{checkedCount} done ✓</Badge>}
          </div>
        </Card>

        {/* Add item */}
        <div
          className="flex items-center gap-2 rounded-2xl glass px-3 py-2"
          style={{ border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addItem()}
            placeholder="Add item…"
            className="flex-1 bg-transparent text-text-primary text-sm placeholder:text-text-muted outline-none py-1"
          />
          <button
            onClick={addItem}
            disabled={!newItem.trim()}
            className={`w-8 h-8 flex items-center justify-center rounded-xl transition-all ${
              newItem.trim()
                ? "bg-nori-500 text-white hover:bg-nori-400 active:scale-95"
                : "bg-surface-3 text-text-muted cursor-not-allowed"
            }`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </button>
          <Link
            href="/chat?q=Add+items+to+grocery+list"
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-surface-2 text-text-secondary hover:text-nori-400 transition-colors"
          >
            ✨
          </Link>
        </div>

        {/* Category tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
          {categories.map((cat) => {
            const count = cat === "All"
              ? items.filter((i) => !i.checked).length
              : items.filter((i) => i.category === cat && !i.checked).length;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  activeCategory === cat
                    ? "bg-nori-500/20 text-nori-400 border border-nori-500/30"
                    : "glass text-text-secondary border border-surface-3 hover:text-text-primary"
                }`}
              >
                <span>{categoryEmojis[cat]}</span>
                <span>{cat}</span>
                {count > 0 && (
                  <span
                    className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold ${
                      activeCategory === cat ? "bg-nori-500 text-white" : "bg-surface-3 text-text-muted"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Items list */}
        {activeCategory === "All" ? (
          <div className="space-y-4">
            {Object.entries(grouped).map(([cat, catItems]) => (
              <section key={cat}>
                <div className="flex items-center gap-2 mb-2">
                  <span>{categoryEmojis[cat]}</span>
                  <h3 className="text-text-secondary text-xs font-semibold uppercase tracking-wide">{cat}</h3>
                  <div className="flex-1 h-px bg-surface-3" />
                </div>
                <div className="space-y-1">
                  {catItems.map((item) => (
                    <GroceryItemRow key={item.id} item={item} onToggle={toggleItem} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map((item) => (
              <GroceryItemRow key={item.id} item={item} onToggle={toggleItem} />
            ))}
          </div>
        )}

        {/* Show checked toggle */}
        {checkedCount > 0 && (
          <button
            onClick={() => setShowChecked(!showChecked)}
            className="w-full text-center text-text-muted text-xs py-2 hover:text-text-secondary transition-colors"
          >
            {showChecked ? "Hide" : "Show"} {checkedCount} checked item{checkedCount !== 1 ? "s" : ""}
          </button>
        )}

        {/* Store integration */}
        <section className="pb-2">
          <h3 className="text-text-primary font-semibold text-sm mb-3">Order Online</h3>
          <div className="grid grid-cols-3 gap-2">
            {[
              { name: "Instacart", emoji: "🛍️", color: "bg-green-500/10 border-green-500/20 text-green-400" },
              { name: "Walmart", emoji: "🟡", color: "bg-blue-500/10 border-blue-500/20 text-blue-400" },
              { name: "Amazon Fresh", emoji: "📦", color: "bg-amber-500/10 border-amber-500/20 text-amber-400" },
            ].map((store) => (
              <button
                key={store.name}
                className={`rounded-xl p-3 flex flex-col items-center gap-1.5 border transition-all hover:opacity-80 active:scale-95 ${store.color}`}
              >
                <span className="text-xl">{store.emoji}</span>
                <span className="text-[11px] font-medium">{store.name}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </PageShell>
  );
}

function GroceryItemRow({ item, onToggle }: { item: GroceryItem; onToggle: (id: number) => void }) {
  return (
    <button
      onClick={() => onToggle(item.id)}
      className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all active:scale-[0.98] ${
        item.checked
          ? "opacity-50"
          : "glass hover:border-surface-4"
      }`}
      style={{ border: "1px solid rgba(255,255,255,0.05)" }}
    >
      <div
        className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${
          item.checked
            ? "border-nori-500 bg-nori-500"
            : "border-surface-4"
        }`}
      >
        {item.checked && (
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} className="w-3 h-3">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <span className="text-lg shrink-0">{item.emoji}</span>
      <div className="flex-1 min-w-0 text-left">
        <p className={`text-sm font-medium ${item.checked ? "line-through text-text-muted" : "text-text-primary"}`}>
          {item.name}
        </p>
        <p className="text-xs text-text-muted">{item.quantity} · {item.addedBy}</p>
      </div>
      {item.urgent && !item.checked && (
        <Badge variant="rose">urgent</Badge>
      )}
    </button>
  );
}
