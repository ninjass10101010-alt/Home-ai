"use client";

import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ShoppingBasket, 
  Plus, 
  Check, 
  ChevronRight, 
  Search, 
  Filter, 
  ShoppingCart,
  List,
  Sparkles,
  MapPin,
  Clock,
  Trash2,
  X,
  Edit2,
  Calendar,
  Package
} from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import MealEditor from "@/components/meals/MealEditor";
import PantryEditor from "@/components/meals/PantryEditor";
import { addGroceryItem, updateGroceryItem, deleteGroceryItem, updatePantryItem } from "@/actions/grocery";

interface MealsUnifiedProps {
  initialMeals: any[];
  initialGrocery: any[];
  initialPantry: any[];
}

const groceryCategories = [
  { id: "produce", name: "Produce", emoji: "🥬", color: "from-green-500/20 to-emerald-500/10", iconColor: "text-green-400" },
  { id: "dairy", name: "Dairy", emoji: "🥛", color: "from-blue-500/20 to-cyan-500/10", iconColor: "text-blue-300" },
  { id: "meat", name: "Meat", emoji: "🥩", color: "from-rose-500/20 to-red-500/10", iconColor: "text-rose-400" },
  { id: "pantry", name: "Pantry", emoji: "🍝", color: "from-amber-500/20 to-orange-500/10", iconColor: "text-amber-400" },
  { id: "frozen", name: "Frozen", emoji: "🧊", color: "from-indigo-500/20 to-blue-500/10", iconColor: "text-indigo-400" },
  { id: "snacks", name: "Snacks", emoji: "🍿", color: "from-purple-500/20 to-pink-500/10", iconColor: "text-purple-400" },
  { id: "beverages", name: "Beverages", emoji: "🥤", color: "from-sky-500/20 to-blue-500/10", iconColor: "text-sky-400" },
  { id: "household", name: "Household", emoji: "🧽", color: "from-slate-500/20 to-gray-500/10", iconColor: "text-slate-400" },
];

const categoryEmojis: Record<string, string[]> = {
  produce: ["🥬", "🍎", "🍌", "🥑", "🥦", "🥕", "🍓", "🫐", "🍇", "🍒", "🥭", "🍍", "🍉", "🍊", "🍋", "🍋‍🟩", "🫑", "🌽", "🍄", "🥒", "🧅", "🥔", "🧄"],
  dairy: ["🥛", "🥚", "🧀", "🧈", "🍦", "🥣", "🥡", "🍶"],
  meat: ["🥩", "🍗", "🥓", "🍖", "🐟", "🍤", "🍔", "🌭", "🦃"],
  pantry: ["🍝", "🍚", "🥫", "🧂", "🍯", "🍞", "🥨", "🥜", "🥣", "🫒", "🍪", "🥐"],
  frozen: ["🧊", "🍕", "🍦", "🍔", "🥡", "🍗", "🍟"],
  snacks: ["🍿", "🍫", "🍪", "🍩", "🥨", "🍬", "🍭", "🥔"],
  beverages: ["🥤", "☕", "🍵", "🧃", "🍺", "🍷", "💧", "🫧"],
  household: ["🧽", "🧼", "🧴", "🧻", "🧹", "🧺", "👶", "🗑️", "🔋", "🕯️"],
};

const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function MealsUnified({ initialMeals, initialGrocery, initialPantry }: MealsUnifiedProps) {
  const [activeTab, setActiveTab] = useState<"planner" | "pantry" | "grocery">("planner");
  
  // Planner State
  const [activeDay, setActiveDay] = useState(() => {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'short' });
    return today;
  });
  const [isMealEditorOpen, setIsMealEditorOpen] = useState(false);
  const [editingMeal, setEditingMeal] = useState<any>(null);

  // Grocery State
  const [isShoppingMode, setIsShoppingMode] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Set<number>>(new Set());
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemCategory, setNewItemCategory] = useState("produce");
  const [newItemEmoji, setNewItemEmoji] = useState("🥬");

  // Pantry State
  const [isPantryModalOpen, setIsPantryModalOpen] = useState(false);
  const [editingPantryItem, setEditingPantryItem] = useState<any>(null);

  useEffect(() => {
    const defaultEmoji = categoryEmojis[newItemCategory]?.[0] || "📦";
    setNewItemEmoji(defaultEmoji);
  }, [newItemCategory]);

  // Derived Data
  const mealMap = useMemo(() => {
    const map: Record<string, any> = {};
    initialMeals.forEach(meal => {
      const date = new Date(meal.date + 'T12:00:00');
      const day = date.toLocaleDateString('en-US', { weekday: 'short' });
      map[day] = meal;
    });
    return map;
  }, [initialMeals]);

  const activeMeal = mealMap[activeDay];

  const neededGroceryItems = useMemo(() => initialGrocery.filter(item => item.status === "needed"), [initialGrocery]);
  const suggestedGroceryItems = useMemo(() => initialGrocery.filter(item => item.status === "suggested"), [initialGrocery]);
  
  const filteredGroceryItems = useMemo(() => {
    return initialGrocery.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = activeCategory === "all" || item.category === activeCategory;
      if (isShoppingMode) return matchesSearch && matchesCategory && item.status === "needed";
      return matchesSearch && matchesCategory && item.status === "needed";
    });
  }, [initialGrocery, searchQuery, activeCategory, isShoppingMode]);

  const lowPantryItems = useMemo(() => {
    return initialPantry.filter(p => p.status === "low" || p.status === "out");
  }, [initialPantry]);

  // Handlers
  const handleToggleGroceryStatus = async (item: any) => {
    if (isShoppingMode) {
      const newChecked = new Set(checkedItems);
      if (newChecked.has(item.id)) newChecked.delete(item.id);
      else newChecked.add(item.id);
      setCheckedItems(newChecked);
      return;
    }

    let newStatus = item.status;
    if (item.status === "suggested") newStatus = "needed";
    else if (item.status === "purchased") newStatus = "needed";
    else if (item.status === "needed") newStatus = "purchased";
    
    if (newStatus !== item.status) {
      await updateGroceryItem(item.id, { status: newStatus });
    }
  };

  const handleAddGroceryItem = async () => {
    if (!newItemName.trim()) return;
    await addGroceryItem({
      name: newItemName.trim(),
      emoji: newItemEmoji,
      category: newItemCategory,
      priority: "medium",
      status: "needed"
    });
    setNewItemName("");
    setShowAddModal(false);
  };

  const addPantryToGrocery = async (pantryItem: any) => {
    await addGroceryItem({
      name: pantryItem.name,
      emoji: pantryItem.emoji,
      category: pantryItem.category || "pantry",
      priority: "high",
      status: "needed"
    });
  };

  return (
    <PageShell>
      <div className="relative pb-24">
        {/* Unified Top Navigation */}
        <div className="sticky top-0 z-40 glass border-b border-surface-3 mb-6">
          <div className="px-4 py-4">
             <div className="flex items-center justify-between mb-4">
                <h1 className="text-2xl font-black text-text-primary tracking-tight">Meals</h1>
                <div className="flex gap-2">
                  {activeTab === "planner" && (
                    <button onClick={() => { setEditingMeal(null); setIsMealEditorOpen(true); }} className="p-2 rounded-xl bg-nori-500 text-white shadow-lg shadow-nori-500/20">
                      <Plus className="w-5 h-5" />
                    </button>
                  )}
                  {activeTab === "grocery" && !isShoppingMode && (
                    <button onClick={() => setShowAddModal(true)} className="p-2 rounded-xl bg-nori-500 text-white shadow-lg shadow-nori-500/20">
                      <Plus className="w-5 h-5" />
                    </button>
                  )}
                </div>
             </div>
             
             <div className="flex bg-surface-2/50 p-1 rounded-2xl border border-surface-3">
                {[
                  { id: "planner", label: "Planner", icon: Calendar },
                  { id: "pantry", label: "Pantry", icon: Package },
                  { id: "grocery", label: "Grocery", icon: ShoppingCart },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all ${
                      activeTab === tab.id 
                        ? "bg-white text-nori-500 shadow-sm" 
                        : "text-text-muted hover:text-text-primary"
                    }`}
                  >
                    <tab.icon className={`w-4 h-4 ${activeTab === tab.id ? "text-nori-500" : "text-text-muted"}`} />
                    {tab.label}
                  </button>
                ))}
             </div>
          </div>
        </div>

        <div className="px-4">
          <AnimatePresence mode="wait">
            {/* MEAL PLANNER VIEW */}
            {activeTab === "planner" && (
              <motion.div 
                key="planner"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-6"
              >
                {/* AI Inspiration */}
                <section>
                  <div className="flex items-center justify-between mb-4 mt-2">
                    <h3 className="text-text-primary font-bold text-sm flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-purple-400" /> Consuela Suggests
                    </h3>
                    <Badge variant="violet" glass>From Pantry</Badge>
                  </div>
                  <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
                    {[
                      { name: "Pantry Pasta", emoji: "🍝", tag: "Easy", ingredients: "🍝 Pasta\n🫒 Olive Oil\n🧄 Garlic" },
                      { name: "Rice Bowl", emoji: "🍛", tag: "Quick", ingredients: "🍚 Rice\n🥫 Beans\n🍅 Salsa" },
                      { name: "Peanut Butter Sandwich", emoji: "🥪", tag: "Kids", ingredients: "🍞 Bread\n🥜 Peanut Butter\n🍓 Jelly" },
                    ].map((idea) => (
                      <Card 
                        key={idea.name} 
                        className="shrink-0 w-32 !p-3 border-purple-500/10 hover:border-purple-500/30 hover:shadow-[0_0_15px_rgba(168,85,247,0.15)] transition-all cursor-pointer group"
                        onClick={() => {
                          setEditingMeal({ ...idea, date: activeDay, id: undefined });
                          setIsMealEditorOpen(true);
                        }}
                      >
                        <div className="flex flex-col items-center gap-2 text-center">
                          <span className="text-3xl group-hover:scale-110 transition-transform">{idea.emoji}</span>
                          <div>
                            <p className="text-text-primary text-xs font-bold leading-tight">{idea.name}</p>
                            <p className="text-purple-400 text-[8px] uppercase font-black mt-1 tracking-widest">{idea.tag}</p>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </section>
                {/* Weekly Strip */}
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
                  {weekDays.map((day) => {
                    const meal = mealMap[day];
                    const isActive = day === activeDay;
                    return (
                      <button
                        key={day}
                        onClick={() => setActiveDay(day)}
                        className={`shrink-0 flex flex-col items-center gap-2 rounded-2xl px-4 py-4 min-w-[80px] transition-all active:scale-95 border-2 ${
                          isActive
                            ? "bg-nori-500/10 border-nori-500 shadow-lg shadow-nori-500/10"
                            : "glass border-transparent hover:border-surface-4"
                        }`}
                      >
                        <span className={`text-[10px] font-black uppercase tracking-widest ${isActive ? "text-nori-400" : "text-text-muted"}`}>
                          {day}
                        </span>
                        <span className="text-3xl">{meal?.emoji ?? "➕"}</span>
                        <span className="text-[10px] text-text-primary text-center leading-tight truncate w-full font-bold">
                          {meal?.name ?? "Add"}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Active Meal Card */}
                {activeMeal ? (
                  <Card glow className="relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4">
                       <button onClick={() => { setEditingMeal(activeMeal); setIsMealEditorOpen(true); }} className="p-2 rounded-lg bg-surface-3 text-text-muted">
                         <Edit2 className="w-4 h-4" />
                       </button>
                    </div>
                    <div className="flex items-start gap-4 mb-6">
                      <div className="w-16 h-16 rounded-2xl bg-surface-3 flex items-center justify-center text-4xl shrink-0">
                        {activeMeal.emoji}
                      </div>
                      <div>
                        <h2 className="text-text-primary font-black text-xl leading-tight">{activeMeal.name}</h2>
                        <div className="flex gap-1.5 mt-3">
                          <Badge variant="green" glass>Homemade</Badge>
                          <Badge variant="violet" glass>Family Fav</Badge>
                        </div>
                      </div>
                    </div>
                    {activeMeal.ingredients && (
                      <div className="space-y-3">
                        <p className="text-xs font-bold text-text-muted uppercase tracking-widest">Ingredients</p>
                        <div className="grid grid-cols-2 gap-2">
                          {activeMeal.ingredients.split('\n').map((ing: string, i: number) => (
                            <div key={i} className="px-3 py-2 rounded-xl bg-surface-2 text-text-secondary text-xs border border-white/5">
                              {ing}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex gap-3 mt-6 pt-4 border-t border-surface-3">
                      <Button onClick={() => setActiveTab("grocery")} variant="primary" className="flex-1 text-sm">View Shopping List</Button>
                      <Button onClick={() => { setEditingMeal(activeMeal); setIsMealEditorOpen(true); }} variant="ghost" className="flex-1 text-sm">Edit Plan</Button>
                    </div>
                  </Card>
                ) : (
                  <div onClick={() => { setEditingMeal(null); setIsMealEditorOpen(true); }} className="py-12 flex flex-col items-center gap-4 rounded-3xl border-2 border-dashed border-surface-3 hover:border-nori-500/30 cursor-pointer transition-all">
                    <div className="w-16 h-16 rounded-full bg-surface-2 flex items-center justify-center text-3xl">🍽️</div>
                    <p className="text-text-primary font-bold text-center">No meal for {activeDay}<br/><span className="text-text-muted text-sm font-normal">Tap to plan dinner</span></p>
                  </div>
                )}
              </motion.div>
            )}

            {/* PANTRY VIEW */}
            {activeTab === "pantry" && (
              <motion.div 
                key="pantry"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex flex-col">
                    <h3 className="text-lg font-black text-text-primary">Inventory</h3>
                    <p className="text-xs text-amber-400 font-bold">{lowPantryItems.length} items low</p>
                  </div>
                  <button 
                    onClick={() => { setEditingPantryItem(null); setIsPantryModalOpen(true); }} 
                    className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-nori-500 text-white shadow-lg shadow-nori-500/20"
                  >
                    + Add Item
                  </button>
                </div>
                <div className="space-y-3">
                  {initialPantry.map((item) => (
                    <Card key={item.id} className="!p-4 flex items-center justify-between group">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-surface-2 flex items-center justify-center text-2xl">
                          {item.emoji}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-text-primary">{item.name}</p>
                          <p className="text-[10px] text-text-muted font-bold uppercase">{item.category || "Pantry"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                          (item.status === "plenty" || item.status === "available") ? "bg-green-500/10 text-green-400 border-green-500/20" :
                          item.status === "enough" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                          item.status === "low" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                          "bg-rose-500/10 text-rose-400 border-rose-500/20"
                        }`}>
                          {item.status}
                        </div>
                        <button onClick={() => { setEditingPantryItem(item); setIsPantryModalOpen(true); }} className="p-2 text-text-muted hover:text-text-primary">
                          <Edit2 className="w-4 h-4" />
                        </button>
                      </div>
                    </Card>
                  ))}
                </div>

                <section className="mt-8 pt-6 border-t border-surface-3">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-text-primary font-bold text-sm flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-purple-400" /> AI Restock Suggestions
                    </h3>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
                    {[
                      { name: "Flour", emoji: "🌾", category: "pantry", status: "enough" },
                      { name: "Canned Tomatoes", emoji: "🍅", category: "pantry", status: "enough" },
                      { name: "Sugar", emoji: "🍬", category: "pantry", status: "plenty" },
                    ].map((s) => (
                      <button
                        key={s.name}
                        onClick={() => {
                          setEditingPantryItem(s);
                          setIsPantryModalOpen(true);
                        }}
                        className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl glass border border-purple-500/20 text-text-secondary text-xs font-medium hover:border-purple-500/50 hover:text-text-primary transition-all active:scale-95"
                      >
                        <Plus className="w-3 h-3 text-purple-400" />
                        <span>{s.emoji}</span>
                        <span>{s.name}</span>
                      </button>
                    ))}
                  </div>
                </section>
              </motion.div>
            )}

            {/* GROCERY VIEW */}
            {activeTab === "grocery" && (
              <motion.div 
                key="grocery"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex flex-col">
                    <h3 className="text-lg font-black text-text-primary">{isShoppingMode ? "Shopping Mode" : "Shopping List"}</h3>
                    <p className="text-xs text-text-muted font-bold">{neededGroceryItems.length} items to buy</p>
                  </div>
                  <button 
                    onClick={async () => {
                      if (isShoppingMode && checkedItems.size > 0) {
                        // Exit and clear checked items
                        for (const id of Array.from(checkedItems)) {
                          await updateGroceryItem(id, { status: "purchased" });
                        }
                        setCheckedItems(new Set());
                      }
                      setIsShoppingMode(!isShoppingMode);
                    }} 
                    className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider border transition-all ${isShoppingMode ? "bg-nori-500 text-white border-nori-400" : "glass border-surface-3 text-text-primary"}`}
                  >
                    {isShoppingMode ? "Done Shopping" : "Shop"}
                  </button>
                </div>

                {!isShoppingMode && (
                  <>
                    <div className="grid grid-cols-4 gap-2">
                      {groceryCategories.map((cat) => (
                        <button
                          key={cat.id}
                          onClick={() => setActiveCategory(activeCategory === cat.id ? "all" : cat.id)}
                          className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all ${
                            activeCategory === cat.id ? "bg-nori-500 text-white border-nori-400" : "glass border-surface-3"
                          }`}
                        >
                          <span className="text-xl">{cat.emoji}</span>
                          <span className="text-[9px] font-bold uppercase truncate w-full text-center">{cat.name}</span>
                        </button>
                      ))}
                    </div>

                    {suggestedGroceryItems.length > 0 && activeCategory === "all" && (
                      <div className="space-y-3">
                        <p className="text-[10px] font-black text-purple-400 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                          <Sparkles className="w-3 h-3" /> Planner Suggestions
                        </p>
                        <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
                          {suggestedGroceryItems.map((item) => (
                            <button 
                              key={item.id} 
                              onClick={() => handleToggleGroceryStatus(item)} 
                              className="shrink-0 flex items-center gap-3 p-3 rounded-2xl glass border border-purple-500/20 hover:border-purple-500/50 group transition-all"
                            >
                              <span className="text-2xl">{item.emoji}</span>
                              <div className="text-left">
                                <p className="text-xs font-bold text-text-primary">{item.name}</p>
                                <p className="text-[8px] text-purple-400 font-black uppercase">From Meal Plan</p>
                              </div>
                              <Plus className="w-4 h-4 text-purple-400 group-hover:scale-110 transition-transform" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {lowPantryItems.length > 0 && activeCategory === "all" && (
                      <div className="space-y-3">
                        <p className="text-[10px] font-black text-amber-400 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                          <Sparkles className="w-3 h-3" /> Refill Needed
                        </p>
                        <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
                          {lowPantryItems.map((p) => (
                            <button key={p.id} onClick={() => addPantryToGrocery(p)} className="shrink-0 flex items-center gap-3 p-3 rounded-2xl glass border border-amber-500/20 group">
                              <span className="text-2xl">{p.emoji}</span>
                              <div className="text-left">
                                <p className="text-xs font-bold text-text-primary">{p.name}</p>
                                <p className="text-[8px] text-amber-400 font-black uppercase">Low</p>
                              </div>
                              <Plus className="w-4 h-4 text-nori-400" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {initialGrocery.filter(i => i.status === "purchased").length > 0 && activeCategory === "all" && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-[10px] font-black text-text-muted uppercase tracking-[0.2em] flex items-center gap-2">
                            <Clock className="w-3 h-3 text-nori-400" /> Your Regulars
                          </h3>
                        </div>
                        <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
                          {initialGrocery.filter(i => i.status === "purchased").slice(0, 10).map((staple) => (
                            <button
                              key={staple.id}
                              onClick={() => handleToggleGroceryStatus(staple)}
                              className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl glass border border-surface-3 text-text-secondary text-xs font-medium hover:border-nori-500/30 hover:text-text-primary transition-all active:scale-95"
                            >
                              <span>{staple.emoji}</span>
                              <span>{staple.name}</span>
                              <Plus className="w-3 h-3 text-nori-400" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                <div className="space-y-3">
                  {filteredGroceryItems.map((item) => {
                    const isChecked = isShoppingMode ? checkedItems.has(item.id) : item.status === "purchased";

                    return (
                      <Card 
                        key={item.id} 
                        className={`!p-3 flex items-center gap-4 transition-all ${
                          isChecked ? "opacity-50" : ""
                        }`}
                        onClick={() => handleToggleGroceryStatus(item)}
                      >
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleToggleGroceryStatus(item); }} 
                          className={`w-10 h-10 rounded-xl border-2 flex items-center justify-center text-xl transition-all ${
                            isChecked ? "border-nori-500 bg-nori-500 text-white" : "border-surface-3 bg-surface-2"
                          }`}
                        >
                          {isChecked ? <Check className="w-5 h-5 stroke-[3]" /> : item.emoji}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-bold text-text-primary truncate ${isChecked ? "line-through" : ""}`}>
                            {item.name}
                          </p>
                          <p className="text-[9px] text-text-muted font-bold uppercase tracking-widest">
                            {`${item.category} · Aisle ${item.aisle || "?"}`}
                          </p>
                        </div>
                        {!isShoppingMode && (
                          <button onClick={(e) => { e.stopPropagation(); deleteGroceryItem(item.id); }} className="p-2 text-text-muted hover:text-rose-400"><Trash2 className="w-4 h-4" /></button>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <MealEditor 
        isOpen={isMealEditorOpen} 
        onClose={() => setIsMealEditorOpen(false)} 
        meal={editingMeal}
        pantryItems={initialPantry}
      />
      <PantryEditor
        isOpen={isPantryModalOpen}
        onClose={() => setIsPantryModalOpen(false)}
        pantryItem={editingPantryItem}
      />

      {/* Add Item Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAddModal(false)} />
            <Card className="relative w-full max-w-sm !p-6">
              <h2 className="text-xl font-bold text-text-primary mb-6">Add Grocery Item</h2>
              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="flex flex-col items-center gap-2">
                    <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest block">Emoji</label>
                    <div className="w-14 h-14 rounded-2xl bg-surface-2 border border-surface-3 flex items-center justify-center text-3xl shadow-inner">
                      {newItemEmoji}
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest mb-2 block">Item Name</label>
                    <input 
                      autoFocus
                      type="text" 
                      placeholder="e.g. Greek Yogurt"
                      value={newItemName}
                      onChange={(e) => setNewItemName(e.target.value)}
                      className="w-full bg-surface-2 border border-surface-3 rounded-2xl px-4 py-3 text-text-primary focus:outline-none focus:border-nori-500/50 transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-text-muted uppercase tracking-widest mb-3 block">Category & Emoji</label>
                  <div className="grid grid-cols-4 gap-2 mb-4">
                    {groceryCategories.map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => setNewItemCategory(cat.id)}
                        className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all ${
                          newItemCategory === cat.id 
                            ? "bg-nori-500/10 border-nori-500 text-nori-400" 
                            : "bg-surface-2 border-surface-3 text-text-secondary"
                        }`}
                      >
                        <span className="text-xl">{cat.emoji}</span>
                        <span className="text-[10px] font-bold uppercase truncate w-full text-center">{cat.name}</span>
                      </button>
                    ))}
                  </div>
                  
                  <div className="p-3 bg-surface-2 rounded-2xl border border-surface-3">
                    <div className="flex flex-wrap justify-center gap-2 max-h-32 overflow-y-auto">
                      {categoryEmojis[newItemCategory]?.map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => setNewItemEmoji(emoji)}
                          className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all ${
                            newItemEmoji === emoji 
                              ? "bg-nori-500 text-white shadow-lg" 
                              : "hover:bg-surface-3 grayscale-[0.5] hover:grayscale-0"
                          }`}
                        >
                          <span className="text-2xl">{emoji}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <button 
                  onClick={handleAddGroceryItem}
                  disabled={!newItemName.trim()}
                  className="w-full py-4 bg-nori-500 text-white rounded-2xl font-bold text-lg shadow-lg shadow-nori-500/20 disabled:opacity-50 disabled:grayscale transition-all active:scale-[0.98]"
                >
                  Add to List
                </button>
              </div>
            </Card>
          </div>
        )}
      </AnimatePresence>
    </PageShell>
  );
}
