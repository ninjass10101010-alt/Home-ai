"use client";

import { useState, useRef, useEffect } from "react";
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
  memberEmoji?: string;
}

interface FamilyMember {
  name: string;
  emoji: string;
  color: string;
}

const familyMembers: FamilyMember[] = [
  { name: "Sarah (Mom)", emoji: "👩", color: "green" },
  { name: "Mike (Dad)", emoji: "👨", color: "cyan" },
  { name: "Jake", emoji: "🧒", color: "violet" },
  { name: "Lily", emoji: "👧", color: "amber" },
];

const initialItems: GroceryItem[] = [
  { id: 1, name: "Chicken breast", quantity: "2 lbs", category: "Meat & Seafood", urgent: true, checked: false, addedBy: "Mom", emoji: "🍗", memberEmoji: "👩" },
  { id: 2, name: "Shrimp", quantity: "1 lb", category: "Meat & Seafood", urgent: true, checked: false, addedBy: "Consuela", emoji: "🍤", memberEmoji: "🤖" },
  { id: 3, name: "Ground beef", quantity: "1.5 lbs", category: "Meat & Seafood", urgent: false, checked: false, addedBy: "Dad", emoji: "🥩", memberEmoji: "👨" },
  { id: 4, name: "Broccoli", quantity: "2 heads", category: "Produce", urgent: true, checked: false, addedBy: "Mom", emoji: "🥦", memberEmoji: "👩" },
  { id: 5, name: "Bell peppers", quantity: "3", category: "Produce", urgent: false, checked: false, addedBy: "Consuela", emoji: "🫑", memberEmoji: "🤖" },
  { id: 6, name: "Zucchini", quantity: "2", category: "Produce", urgent: false, checked: true, addedBy: "Mom", emoji: "🥒", memberEmoji: "👩" },
  { id: 7, name: "Mozzarella", quantity: "8 oz", category: "Dairy", urgent: false, checked: false, addedBy: "Dad", emoji: "🧀", memberEmoji: "👨" },
  { id: 8, name: "Parmesan", quantity: "4 oz", category: "Dairy", urgent: false, checked: false, addedBy: "Consuela", emoji: "🧀", memberEmoji: "🤖" },
  { id: 9, name: "Penne pasta", quantity: "1 box", category: "Pantry", urgent: false, checked: false, addedBy: "Jake", emoji: "🍝", memberEmoji: "🧒" },
  { id: 10, name: "Tomato sauce", quantity: "2 cans", category: "Pantry", urgent: true, checked: false, addedBy: "Consuela", emoji: "🍅", memberEmoji: "🤖" },
  { id: 11, name: "Taco shells", quantity: "1 box", category: "Pantry", urgent: false, checked: false, addedBy: "Dad", emoji: "🌮", memberEmoji: "👨" },
  { id: 12, name: "Salsa", quantity: "1 jar", category: "Pantry", urgent: false, checked: false, addedBy: "Lily", emoji: "🫕", memberEmoji: "👧" },
];

const categories = ["All", "Meat & Seafood", "Produce", "Dairy", "Pantry", "Frozen", "Beverages", "Snacks", "Bakery", "Household", "Other"];

const categoryEmojis: Record<string, string> = {
  "All": "🛒",
  "Meat & Seafood": "🥩",
  "Produce": "🥦",
  "Dairy": "🥛",
  "Pantry": "🫙",
  "Frozen": "❄️",
  "Beverages": "🧃",
  "Snacks": "🍿",
  "Bakery": "🥖",
  "Household": "🏠",
  "Other": "📦",
};

// Comprehensive emoji map for grocery items — family & food matched
const emojiMap: Record<string, string> = {
  // Fruits
  apple: "🍎",
  apples: "🍎",
  bananas: "🍌",
  banana: "🍌",
  "blue berries": "🫐",
  blueberries: "🫐",
  strawberries: "🍓",
  strawberry: "🍓",
  grapes: "🍇",
  grape: "🍇",
  orange: "🍊",
  oranges: "🍊",
  peach: "🍑",
  peaches: "🍑",
  pear: "🍐",
  pears: "🍐",
  pineapple: "🍍",
  watermelon: "🍉",
  lemon: "🍋",
  lemons: "🍋",
  lime: "🟢",
  limes: "🟢",
  mango: "🥭",
  mangoes: "🥭",
  avocado: "🥑",
  avocados: "🥑",
  kiwi: "🥝",
  kiwi: "🥝",
  coconut: "🥥",
  cherry: "🍒",
  cherries: "🍒",
  plum: "🟣",
  plums: "🟣",

  // Vegetables
  broccoli: "🥦",
  broccolini: "🥦",
  carrot: "🥕",
  carrots: "🥕",
  celery: "🥬",
  corn: "🌽",
  cucumber: "🥒",
  cucumbers: "🥒",
  garlic: "🧄",
  garlic: "🧄",
  lettuce: "🥬",
  kale: "🥬",
  spinach: "🥬",
  mushrooms: "🍄",
  mushroom: "🍄",
  onion: "🧅",
  onions: "🧅",
  pepper: "🫑",
  peppers: "🫑",
  bell pepper: "🫑",
  potato: "🥔",
  potatoes: "🥔",
  sweet potato: "🍠",
  yam: "🍠",
  tomato: "🍅",
  tomatoes: "🍅",
  zucchini: "🥒",
  courgette: "🥒",
  asparagus: "🫚",
  artichoke: "🫚",
  eggplant: "🍆",
  aubergine: "🍆",
  cauliflower: "🥦",
  beet: " beet",
  beets: "🫚",
  radish: "🫚",
  turnip: "🫚",
  parsnip: "🥕",
  leek: "🥬",
  shallot: "🧅",
  scallion: "🧅",
  spring onion: "🧅",
  fennel: "🫖",
  ginger: "🫚",
  turmeric: "🫚",

  // Proteins
  bacon: "🥓",
  beef: "🥩",
  steak: "🥩",
  chicken: "🍗",
  "chicken breast": "🍗",
  "chicken thighs": "🍗",
  "chicken wings": "🍗",
  fish: "🐟",
  salmon: "🐟",
  tuna: "🐟",
  cod: "🐟",
  tilapia: "🐟",
  shrimp: "🍤",
  prawns: "🍤",
  lobster: "🦞",
  crab: "🦀",
  hamburger: "🍔",
  burger: "🍔",
  pork: "🐷",
  pork chop: "🐷",
  sausage: "🌭",
  sausages: "🌭",
  turkey: "🍗",
  tofu: "🫘",
  tempeh: "🫘",
  eggs: "🥚",
  egg: "🥚",
  "egg whites": "🥚",

  // Dairy
  butter: "🧈",
  cheese: "🧀",
  cheddar: "🧀",
  milk: "🥛",
  "oat milk": "🥛",
  "almond milk": "🥛",
  "soy milk": "🥛",
  cream: "🥛",
  "heavy cream": "🥛",
  whipping cream: "🥛",
  sour cream: "🥛",
  yogurt: "🥄",
  greek yogurt: "🥄",
  ice cream: "🍦",
  gelato: "🍦",

  // Bakery
  bread: "🍞",
  baguette: "🥖",
  croissant: "🥐",
  muffin: "🧁",
  "blueberry muffin": "🧁",
  donut: "🍩",
  doughnut: "🍩",
  bagel: "🥯",
  tortilla: "🫓",
  pita: "🫓",
  naan: "🍞",
  bun: "🍔",
  rolls: "🍞",

  // Pantry
  beans: "🫘",
  "baked beans": "🫘",
  "black beans": "🫘",
  "kidney beans": "🫘",
  rice: "🍚",
  "white rice": "🍚",
  "brown rice": "🍚",
  quinoa: "🌾",
  oats: "🌾",
  oatmeal: "🌾",
  granola: "🌾",
  pasta: "🍝",
  spaghetti: "🍝",
  noodles: "🍜",
  ramen: "🍜",
  udon: "🍜",
  "chow mein": "🍜",
  "soba noodles": "🍜",
  cereal: "🥣",
  "rice krispies": "🥣",
  "corn flakes": "🥣",
  "granola": "🫙",
  chips: "🥨",
  pretzels: "🥨",
  popcorn: "🍿",
  crackers: "🍘",
  rice cakes: "🍘",
  "rice crackers": "🍘",
  coffee: "☕",
  "espresso": "☕",
  "cold brew": "☕",
  "coffee beans": "☕",
  tea: "🫖",
  "green tea": "🍵",
  matcha: "🍵",
  "chai tea": "🫖",
  juice: "🧃",
  "orange juice": "🧃",
  "apple juice": "🧃",
  "cranberry juice": "🧃",
  "lemonade": "🍋",
  water: "💧",
  "sparkling water": "💧",
  soda: "🥤",
  "diet soda": "🥤",
  "coca cola": "🥤",
  sprite: "🧊",
  "ginger ale": "🧊",
  "energy drink": "⚡",
  "red bull": "⚡",
  "hot sauce": "🌶️",
  "sriracha": "🌶️",
  ketchup: "🍅",
  mustard: "🟡",
  mayo: "🥄",
  vinegar: "🫙",
  "olive oil": "🫒",
  "coconut oil": "🥥",
  "vegetable oil": "🫒",
  sugar: "🧂",
  salt: "🧂",
  honey: "🍯",
  "maple syrup": "🍁",
  "corn syrup": "🍯",
  jam: "🫙",
  jelly: "🫙",
  peanut butter: "🥜",
  "almond butter": "🥜",
  "cashew butter": "🥜",
  nutella: "🥜",
  chocolate: "🍫",
  cocoa: "🍫",
  "cocoa powder": "🍫",
  "vanilla extract": "🍦",
  "baking powder": "🧁",
  "baking soda": "🧁",
  yeast: "🧁",
  flour: "🌾",
  "all-purpose flour": "🌾",
  "cornstarch": "🌾",

  // Snacks & Sweets
  candy: "🍬",
  lollipop: "🍭",
  gummy: "🐻",
  "gummy bears": "🐻",
  marshmallow: "🍡",
  cookie: "🍪",
  "chocolate chip cookie": "🍪",
  "oatmeal cookie": "🍪",
  cake: "🎂",
  "birthday cake": "🎂",
  "cup cake": "🧁",
  cupcake: "🧁",
  pie: "🥧",
  "apple pie": "🥧",
  "pumpkin pie": "🥧",
  "chocolate bar": "🍫",
  "protein bar": "🫐",

  // Snacks
  "potato chips": "🍟",
  fries: "🍟",
  "french fries": "🍟",
  "tater tots": "🍟",
  nuts: "🥜",
  "mixed nuts": "🥜",
  almonds: "🥜",
  "cashews": "🥜",
  walnuts: "🥜",
  pistachios: "🥜",
  "trail mix": "🥜",
  dried fruit: "🫐",
  "dried mango": "🥭",
  "dried apricot": "🟠",
  jerky: "🥩",
  "beef jerky": "🥩",

  // Condiments
  ketchup: "🍅",
  mustard: "🟡",
  mayo: "🥄",
  "BBQ sauce": "🍖",
  "soy sauce": "🟤",
  "worcestershire": "🟤",
  "hot sauce": "🌶️",
  "tabasco": "🌶️",
  pepper: "⚫",
  "black pepper": "⚫",
  "white pepper": "⚪",

  // Fresh herbs
  basil: "🌿",
  cilantro: "🌿",
  parsley: "🌿",
  mint: "🌿",
  rosemary: "🌿",
  thyme: "🌿",
  dill: "🌿",
  sage: "🍃",
  "bay leaf": "🍃",
  chives: "🌿",

  // Frozen
  "ice cream": "🍦",
  "frozen pizza": "🍕",
  "frozen veggies": "🥦",
  "frozen fruit": "🫐",
  "frozen chicken": "🍗",
  "frozen fish": "🐟",
  "frozen shrimp": "🍤",
  "frozen dumplings": "🥟",
  "frozen burrito": "🌯",
  "frozen waffles": "🧇",

  // Beverages more
  wine: "🍷",
  "red wine": "🍷",
  "white wine": "🍷",
  beer: "🍺",
  champagne: "🥂",
  cocktail: "🍸",
  smoothie: "🥤",
  "protein shake": "🥤",
  "coconut water": "🥥",
  sparkling: "🥂",
  seltzer: "🧊",

  // Household
  "paper towels": "🧻",
  "toilet paper": "🧻",
  "tissue": "🧻",
  detergent: "🧴",
  "laundry detergent": "🧴",
  "dish soap": "🧽",
  soap: "🧼",
  handsoap: "🧼",
  sponge: "🧽",
  "scrub brush": "🧹",
  broom: "🧹",
  "trash bags": "🗑️",
  "garbage bags": "🗑️",
  "ziploc bags": "📦",
  aluminum: "🥫",
  foil: "🫕",
  clingwrap: "🫙",
  "plastic wrap": "🫙",

  // Coffee/Tea extras
  "coffee beans": "☕",
  "espresso beans": "☕",
  "french press": "☕",
  "tea bags": "🫖",
  "loose leaf tea": "🫖",
  "chamomile": "🌼",

  // Breakfast
  "granola bar": "🧁",
  "protein powder": "🫘",
  "oat milk": "🥛",
  "butter": "🧈",
  "margarine": "🧈",
  "jam": "🫙",
  "preserves": "🫙",
  "nutella": "🥜",
  "hazelnut spread": "🥜",
  "whipped cream": "🥛",
  "powdered sugar": "🧁",

  // Misc
  "olive": "🫒",
  olives: "🫒",
  pickle: "🥒",
  pickles: "🥒",
  "pickled": "🥒",
  horseradish: "🫚",
  wasabi: "🌶️",
  "curry paste": "🍛",
  curry: "🍛",
  "coconut milk": "🥥",
  "coconut cream": "🥥",
  "tahini": "🫘",
  "hummus": "🫘",
  "falafel": "🫘",
  "tortilla chips": "🥨",
  nachos: "🥨",
  "salsa": "🫕",
  guacamole: "🥑",
  "pesto": "🌿",
  "tapenade": "🫒",
  "sun-dried tomato": "🍅",
  "canned tomato": "🍅",
  "crushed tomato": "🍅",
  "tomato paste": "🍅",
  "parmesan cheese": "🧀",
  "mozzarella cheese": "🧀",
  "swiss cheese": "🧀",
  "cheddar cheese": "🧀",
  "whipped": "🥛",
  "heavy whipping cream": "🥛",
  "half and half": "🥛",
  "condensed milk": "🥛",
  "evaporated milk": "🥛",
  "powdered milk": "🥛",
  "flax seeds": "🌾",
  "chia seeds": "🌾",
  "hemp seeds": "🌾",
  "sunflower seeds": "🌻",
  "pumpkin seeds": "🫛",
  "sesame seeds": "🌾",
  "cinnamon": "🫙",
  "nutmeg": "🫙",
  "clove": "🫙",
  "cardamom": "🫙",
  "cumin": "🫙",
  "coriander": "🫙",
  "paprika": "🌶️",
  "turmeric": "🫚",
  "saffron": "🌾",
  "cayenne": "🌶️",
  "chili flakes": "🌶️",
  "pepper flakes": "🌶️",
  "red pepper": "🌶️",
  "jalapeno": "🌶️",
  "habanero": "🌶️",
  "ghost pepper": "🌶️",
};

// Family member to emoji mapping
const familyEmojiMap: Record<string, string> = {
  "sarah": "👩",
  "mom": "👩",
  "mike": "👨",
  "dad": "👨",
  "jake": "🧒",
  "lily": "👧",
  "consuela": "🤖",
  "consul": "🤖",
};

function getEmojiForItem(itemName: string): string {
  const lowerName = itemName.toLowerCase().trim();

  // Direct match
  if (emojiMap[lowerName]) return emojiMap[lowerName];

  // Partial match for common words
  for (const [key, emoji] of Object.entries(emojiMap)) {
    if (lowerName.includes(key)) return emoji;
  }

  // Default emoji
  return "🛒";
}

function getFamilyEmoji(addedBy: string): string {
  const lower = addedBy.toLowerCase().trim();
  return familyEmojiMap[lower] || "👤";
}

export default function GroceryPage() {
  const [items, setItems] = useState<GroceryItem[]>(initialItems);
  const [activeCategory, setActiveCategory] = useState("All");
  const [newItem, setNewItem] = useState("");
  const [showChecked, setShowChecked] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const toggleItem = (id: number) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item))
    );
  };

  const addItem = () => {
    if (!newItem.trim()) return;
    const emoji = getEmojiForItem(newItem);
    const newEntry: GroceryItem = {
      id: Date.now(),
      name: newItem.trim(),
      quantity: "1",
      category: "Other",
      urgent: false,
      checked: false,
      addedBy: "You",
      emoji,
      memberEmoji: "👤",
    };
    setItems((prev) => [newEntry, ...prev]);
    setNewItem("");
    if (inputRef.current) inputRef.current.focus();
  };

  const deleteItem = (id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const toggleUrgent = (id: number) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, urgent: !item.urgent } : item))
    );
  };

  const clearChecked = () => {
    setItems((prev) => prev.filter((item) => !item.checked));
    setShowChecked(false);
  };

  const filtered = items.filter((item) => {
    const catMatch = activeCategory === "All" || item.category === activeCategory;
    const checkedMatch = showChecked ? true : !item.checked;
    const searchMatch = searchQuery === "" || item.name.toLowerCase().includes(searchQuery.toLowerCase());
    return catMatch && checkedMatch && searchMatch;
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
        subtitle={`${uncheckedCount} items`}
        right={
          <Link
            href="/chat?q=Generate+grocery+list+from+meals"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-nori-500/15 text-nori-400 text-xs font-medium hover:bg-nori-500/25 transition-colors"
          >
            ✨ From meals
          </Link>
        }
      />

      <div className="pb-24 px-4 space-y-4">
        {/* Progress bar — Apple-inspired */}
        <Card className="!p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-text-primary text-sm font-semibold">Shopping Progress</p>
              <p className="text-text-muted text-xs mt-0.5">
                <span className="text-nori-400 font-medium">{checkedCount}</span> of {items.length} checked
              </p>
            </div>
            <div className="flex gap-1.5">
              {items.filter((i) => i.urgent && !i.checked).length > 0 && (
                <Badge variant="rose" size="sm">
                  🚨 {items.filter((i) => i.urgent && !i.checked).length}
                </Badge>
              )}
              <Badge variant="gray" size="sm">
                {uncheckedCount} left
              </Badge>
            </div>
          </div>
          <div className="w-full h-2 rounded-full bg-surface-3 overflow-hidden">
            <div
              className="h-full rounded-full bg-nori-500 transition-all duration-700 ease-out"
              style={{ width: `${(checkedCount / Math.max(items.length, 1)) * 100}%` }}
            />
          </div>
        </Card>

        {/* Smart add — Apple/Tesla-style input */}
        <div className="space-y-3">
          <div
            className="flex items-center gap-2 rounded-2xl glass px-4 py-3"
            style={{ border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <span className="text-xl">🛒</span>
            <div className="flex-1 min-w-0">
              <input
                ref={inputRef}
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addItem();
                  if (e.key === "Escape") setNewItem("");
                }}
                placeholder="Add grocery item…"
                className="flex-1 bg-transparent text-text-primary text-sm placeholder:text-text-muted outline-none w-full"
                aria-label="Add grocery item"
              />
              {newItem.trim() && (
                <span className="text-xs text-nori-400 bg-nori-500/10 px-2 py-0.5 rounded-full">
                  {getEmojiForItem(newItem)}
                </span>
              )}
            </div>
            <button
              onClick={addItem}
              disabled={!newItem.trim()}
              className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all duration-200 ${
                newItem.trim()
                  ? "bg-nori-500 text-white hover:bg-nori-400 active:scale-90 shadow-lg shadow-nori-500/25"
                  : "bg-surface-3 text-text-muted cursor-not-allowed"
              }`}
              aria-label="Add item"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Quick-emoji shortcuts */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            {[
              { item: "Chicken", emoji: "🍗" },
              { item: "Rice", emoji: "🍚" },
              { item: "Broccoli", emoji: "🥦" },
              { item: "Cheese", emoji: "🧀" },
              { item: "Bread", emoji: "🍞" },
              { item: "Eggs", emoji: "🥚" },
              { item: "Milk", emoji: "🥛" },
              { item: "Tomato", emoji: "🍅" },
              { item: "Pasta", emoji: "🍝" },
              { item: "Salmon", emoji: "🐟" },
              { item: "Apples", emoji: "🍎" },
              { item: "Bananas", emoji: "🍌" },
            ].map((quick) => (
              <button
                key={quick.item}
                onClick={() => {
                  setNewItem(quick.item);
                  setTimeout(() => inputRef.current?.focus(), 0);
                }}
                className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl glass text-sm hover:bg-nori-500/15 transition-all active:scale-90"
                title={quick.item}
              >
                {quick.emoji}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <svg viewBox="0 0 24 24" fill="none" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none">
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth={1.8} />
            <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
          </svg>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search items…"
            className="w-full bg-surface-2/50 text-text-primary text-sm rounded-xl pl-10 pr-4 py-2.5 outline-none placeholder:text-text-muted border border-surface-3/50"
            aria-label="Search grocery items"
          />
        </div>

        {/* Category pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4">
          {categories.map((cat) => {
            const count = cat === "All"
              ? items.filter((i) => !i.checked).length
              : items.filter((i) => i.category === cat && !i.checked).length;
            const hasChecked = cat === "All"
              ? checkedCount > 0
              : items.some((i) => i.category === cat && i.checked);
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all duration-200 ${
                  activeCategory === cat
                    ? "bg-nori-500/20 text-nori-400 shadow-sm shadow-nori-500/10"
                    : count > 0
                    ? "glass text-text-secondary hover:text-text-primary hover:bg-surface-3"
                    : "text-text-muted"
                }`}
              >
                <span>{categoryEmojis[cat]}</span>
                <span>{hasChecked && count === 0 ? "✓" : count || "0"}</span>
              </button>
            );
          })}
        </div>

        {/* Items list */}
        <div className="space-y-1">
          {activeCategory === "All" ? (
            Object.keys(grouped).length > 0 ? (
              Object.entries(grouped).map(([cat, catItems]) => (
                <div key={cat}>
                  <div className="flex items-center gap-2 px-1 py-2">
                    <span className="text-xs">{categoryEmojis[cat]}</span>
                    <h3 className="text-text-secondary text-[10px] font-semibold uppercase tracking-widest">{cat}</h3>
                    <div className="flex-1 h-px bg-surface-3" />
                    <span className="text-[10px] text-text-muted">{catItems.length}</span>
                  </div>
                  <div className="space-y-0.5">
                    {catItems.map((item) => (
                      <GroceryItemRow
                        key={item.id}
                        item={item}
                        onToggle={toggleItem}
                        onDelete={deleteItem}
                        onToggleUrgent={toggleUrgent}
                      />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-16 glass rounded-2xl">
                <span className="text-4xl mb-3 opacity-50">🛒</span>
                <p className="text-text-muted text-sm font-medium">No items yet</p>
                <p className="text-text-muted text-xs mt-1">Start adding items above</p>
              </div>
            )
          ) : filtered.length > 0 ? (
            filtered.map((item) => (
              <GroceryItemRow
                key={item.id}
                item={item}
                onToggle={toggleItem}
                onDelete={deleteItem}
                onToggleUrgent={toggleUrgent}
              />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-16 glass rounded-2xl">
              <span className="text-4xl mb-3 opacity-50">{categoryEmojis[activeCategory]}</span>
              <p className="text-text-muted text-sm font-medium">No items in this category</p>
            </div>
          )}
        </div>

        {/* Show checked */}
        {checkedCount > 0 && (
          <button
            onClick={() => setShowChecked(!showChecked)}
            className="w-full text-center text-text-muted text-xs py-3 hover:text-text-secondary transition-colors"
          >
            {showChecked ? "▲ Hide" : "▼ Show"} {checkedCount} checked item{checkedCount !== 1 ? "s" : ""}
            {showChecked && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearChecked();
                }}
                className="ml-3 text-rose-400 hover:text-rose-300 text-xs font-medium transition-colors"
              >
                Clear all ✓
              </button>
            )}
          </button>
        )}

        {/* Store integration */}
        <section className="space-y-3 pb-2">
          <h3 className="text-text-primary font-semibold text-sm px-1">Order Online</h3>
          <div className="grid grid-cols-3 gap-2">
            {[
              { name: "Instacart", emoji: "🛍️", color: "bg-nori-500/10 border-nori-500/20 text-nori-400" },
              { name: "Walmart", emoji: "🟡", color: "bg-blue-500/10 border-blue-500/20 text-blue-400" },
              { name: "Amazon Fresh", emoji: "📦", color: "bg-amber-500/10 border-amber-500/20 text-amber-400" },
            ].map((store) => (
              <button
                key={store.name}
                className={`rounded-xl p-3 flex flex-col items-center gap-1.5 border transition-all hover:opacity-80 active:scale-95 ${store.color}`}
              >
                <span className="text-xl">{store.emoji}</span>
                <span className="text-[11px] font-semibold">{store.name}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </PageShell>
  );
}

function GroceryItemRow({
  item,
  onToggle,
  onDelete,
  onToggleUrgent,
}: {
  item: GroceryItem;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  onToggleUrgent: (id: number) => void;
}) {
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const [showActions, setShowActions] = useState(false);

  return (
    <div className="relative group">
      <button
        onClick={() => onToggle(item.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          setShowActions(true);
        }}
        onTouchStart={() => {
          longPressTimer.current = setTimeout(() => {
            setShowActions(true);
          }, 500);
        }}
        onTouchEnd={() => {
          if (longPressTimer.current) clearTimeout(longPressTimer.current);
        }}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 active:scale-[0.98] ${
          item.checked
            ? "opacity-40"
            : "glass hover:border-surface-4"
        }`}
        style={{ border: "1px solid rgba(255,255,255,0.05)" }}
      >
        {/* Checkbox */}
        <div
          className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-all duration-200 ${
            item.checked
              ? "border-nori-500 bg-nori-500"
              : "border-surface-4 group-active:border-nori-500/50"
          }`}
        >
          {item.checked && (
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} className="w-3.5 h-3.5">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>

        {/* Item emoji */}
        <span className="text-xl shrink-0">{item.emoji}</span>

        {/* Item details */}
        <div className="flex-1 min-w-0 text-left">
          <p className={`text-sm font-medium transition-all duration-200 ${
            item.checked ? "line-through text-text-muted" : "text-text-primary"
          }`}>
            {item.name}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-text-muted">{item.quantity}</p>
            {item.memberEmoji && (
              <>
                <span className="text-[10px] text-text-muted">·</span>
                <span className="text-xs">{item.memberEmoji}</span>
              </>
            )}
          </div>
        </div>

        {/* Urgent badge */}
        {item.urgent && !item.checked && (
          <Badge variant="rose" size="sm" className="animate-pulse-subtle">
            🚨
          </Badge>
        )}

        {/* Checked icon */}
        {item.checked && (
          <span className="text-nori-400 text-xs font-medium shrink-0">✓</span>
        )}
      </button>

      {/* Context actions menu */}
      {showActions && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowActions(false)}
            onContextMenu={(e) => e.preventDefault()}
          />
          <div className="absolute right-0 top-full mt-1 z-20 bg-surface-2 border border-surface-3 rounded-xl shadow-xl overflow-hidden min-w-[160px]">
            <button
              onClick={() => {
                onToggleUrgent(item.id);
                setShowActions(false);
              }}
              className="w-full flex items-center gap-2 px-4 py-3 text-sm text-text-primary hover:bg-surface-3 transition-colors"
            >
              {item.urgent ? "🚨" : "⚡"} {item.urgent ? "Unmark urgent" : "Mark urgent"}
            </button>
            <button
              onClick={() => {
                onDelete(item.id);
                setShowActions(false);
              }}
              className="w-full flex items-center gap-2 px-4 py-3 text-sm text-rose-400 hover:bg-surface-3 transition-colors"
            >
              🗑️ Delete item
            </button>
          </div>
        </>
      )}
    </div>
  );
}