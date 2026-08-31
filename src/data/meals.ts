import { Meal, Recipe, GroceryItem } from "@/types/meals";

export const defaultMeals: Meal[] = [];

export const mealIdeas: Array<{ name: string; emoji: string; tags: string[] }> = [];

export const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const foodEmojis = [
  "🍕","🍝","🌮","🍗","🍖","🫕","🥢","🍛","🥩","🍳",
  "🥗","🥘","🍲","🍜","🍱","🥙","🫔","🌯","🥪","🧆",
  "🐟","🦞","🍣","🥐","🍞","🧁","🎂","🍰","🍩","🥞",
  "🫐","🍓","🍇","🍎","🥑","🥦","🥕","🌽","🍠","🧅",
];

export const groceryCategories = [
  { id: "produce", name: "Produce", emoji: "🥬", aisles: ["1-3"] },
  { id: "dairy", name: "Dairy", emoji: "🥛", aisles: ["4-5"] },
  { id: "meat", name: "Meat & Seafood", emoji: "🥩", aisles: ["6-7"] },
  { id: "pantry", name: "Pantry", emoji: "🍝", aisles: ["8-10"] },
  { id: "frozen", name: "Frozen", emoji: "🧊", aisles: ["11"] },
  { id: "snacks", name: "Snacks", emoji: "🍿", aisles: ["12"] },
  { id: "beverages", name: "Beverages", emoji: "☕", aisles: ["13"] },
  { id: "household", name: "Household", emoji: "🧽", aisles: ["14-15"] },
];

export const initialGroceryItems: GroceryItem[] = [];

export const defaultRecipes: Recipe[] = [];

export const emptyRecipe: Recipe & { time?: string; mealType?: string } = {
  id: 0,
  name: "",
  emoji: "🍽️",
  prepTime: "30 min",
  tags: [],
  ingredients: [],
  instructions: "",
  servings: 4,
  calories: 400,
  createdAt: "",
  time: "",
  mealType: "dinner",
};

export const RECIPE_TAGS = ["Vegetarian", "Vegan", "Quick", "Family Fave", "Healthy", "High Protein", "Seafood", "Weekend", "Comfort Food", "Meal Prep", "Gluten-Free", "Dairy-Free", "Indulgent", "Fun", "Kids Love"];

// ─── Preset quick-add items ───────────────────────────────────────────────────

export const groceryPresets: { name: string; emoji: string; category: string }[] = [
  // Produce
  { name: "Bananas", emoji: "🍌", category: "produce" },
  { name: "Apples", emoji: "🍎", category: "produce" },
  { name: "Avocados", emoji: "🥑", category: "produce" },
  { name: "Baby Spinach", emoji: "🥬", category: "produce" },
  { name: "Broccoli", emoji: "🥦", category: "produce" },
  { name: "Strawberries", emoji: "🍓", category: "produce" },
  { name: "Tomatoes", emoji: "🍅", category: "produce" },
  { name: "Lemons", emoji: "🍋", category: "produce" },
  { name: "Onions", emoji: "🧅", category: "produce" },
  { name: "Garlic", emoji: "🧄", category: "produce" },
  { name: "Carrots", emoji: "🥕", category: "produce" },
  { name: "Bell Peppers", emoji: "🫑", category: "produce" },
  // Dairy
  { name: "Milk", emoji: "🥛", category: "dairy" },
  { name: "Eggs", emoji: "🥚", category: "dairy" },
  { name: "Butter", emoji: "🧈", category: "dairy" },
  { name: "Greek Yogurt", emoji: "🫙", category: "dairy" },
  { name: "Cheddar Cheese", emoji: "🧀", category: "dairy" },
  { name: "Cream Cheese", emoji: "🧀", category: "dairy" },
  { name: "Heavy Cream", emoji: "🥛", category: "dairy" },
  // Meat
  { name: "Chicken Breast", emoji: "🍗", category: "meat" },
  { name: "Ground Beef", emoji: "🥩", category: "meat" },
  { name: "Salmon", emoji: "🐟", category: "meat" },
  { name: "Bacon", emoji: "🥓", category: "meat" },
  { name: "Shrimp", emoji: "🦐", category: "meat" },
  { name: "Pork Chops", emoji: "🍖", category: "meat" },
  // Pantry
  { name: "Pasta", emoji: "🍝", category: "pantry" },
  { name: "Rice", emoji: "🍚", category: "pantry" },
  { name: "Olive Oil", emoji: "🫒", category: "pantry" },
  { name: "Canned Tomatoes", emoji: "🥫", category: "pantry" },
  { name: "Bread", emoji: "🍞", category: "pantry" },
  { name: "Tortillas", emoji: "🫔", category: "pantry" },
  { name: "Peanut Butter", emoji: "🥜", category: "pantry" },
  { name: "Honey", emoji: "🍯", category: "pantry" },
  // Snacks
  { name: "Chips", emoji: "🥔", category: "snacks" },
  { name: "Granola Bars", emoji: "🍫", category: "snacks" },
  { name: "Popcorn", emoji: "🍿", category: "snacks" },
  { name: "Crackers", emoji: "🍘", category: "snacks" },
  // Beverages
  { name: "Coffee", emoji: "☕", category: "beverages" },
  { name: "Orange Juice", emoji: "🍊", category: "beverages" },
  { name: "Sparkling Water", emoji: "💧", category: "beverages" },
  { name: "Almond Milk", emoji: "🥛", category: "beverages" },
];

export const pantryPresets: { group: string; emoji: string; items: { name: string; emoji: string }[] }[] = [
  {
    group: "Baking",
    emoji: "🧁",
    items: [
      { name: "All-Purpose Flour", emoji: "🌾" },
      { name: "Sugar", emoji: "🍚" },
      { name: "Brown Sugar", emoji: "🍯" },
      { name: "Baking Powder", emoji: "🫙" },
      { name: "Baking Soda", emoji: "🫙" },
      { name: "Vanilla Extract", emoji: "🫙" },
      { name: "Cocoa Powder", emoji: "🍫" },
    ],
  },
  {
    group: "Grains & Pasta",
    emoji: "🍝",
    items: [
      { name: "White Rice", emoji: "🍚" },
      { name: "Brown Rice", emoji: "🍚" },
      { name: "Pasta", emoji: "🍝" },
      { name: "Oats", emoji: "🌾" },
      { name: "Quinoa", emoji: "🌾" },
      { name: "Bread Crumbs", emoji: "🍞" },
      { name: "Couscous", emoji: "🍚" },
    ],
  },
  {
    group: "Canned Goods",
    emoji: "🥫",
    items: [
      { name: "Diced Tomatoes", emoji: "🥫" },
      { name: "Tomato Paste", emoji: "🥫" },
      { name: "Coconut Milk", emoji: "🥫" },
      { name: "Chicken Broth", emoji: "🍲" },
      { name: "Black Beans", emoji: "🫘" },
      { name: "Chickpeas", emoji: "🫘" },
      { name: "Tuna", emoji: "🐟" },
    ],
  },
  {
    group: "Condiments",
    emoji: "🧴",
    items: [
      { name: "Olive Oil", emoji: "🫒" },
      { name: "Soy Sauce", emoji: "🍶" },
      { name: "Hot Sauce", emoji: "🌶️" },
      { name: "Mustard", emoji: "🟡" },
      { name: "Ketchup", emoji: "🍅" },
      { name: "Mayonnaise", emoji: "🫙" },
      { name: "Worcestershire", emoji: "🫙" },
    ],
  },
  {
    group: "Spices",
    emoji: "🧂",
    items: [
      { name: "Salt", emoji: "🧂" },
      { name: "Black Pepper", emoji: "🧂" },
      { name: "Garlic Powder", emoji: "🧄" },
      { name: "Cumin", emoji: "🌿" },
      { name: "Paprika", emoji: "🌶️" },
      { name: "Italian Seasoning", emoji: "🌿" },
      { name: "Chili Powder", emoji: "🌶️" },
    ],
  },
];

export const mealPresets: { mealType: string; ideas: { name: string; emoji: string; tags: string[]; prepTime: string; ingredients: string[] }[] }[] = [
  {
    mealType: "breakfast",
    ideas: [
      { name: "Pancakes", emoji: "🥞", tags: ["Kids Love", "Weekend"], prepTime: "20 min", ingredients: ["Flour", "Eggs", "Milk", "Butter", "Syrup"] },
      { name: "Avocado Toast", emoji: "🥑", tags: ["Quick", "Healthy"], prepTime: "10 min", ingredients: ["Bread", "Avocado", "Eggs", "Lemon"] },
      { name: "Oatmeal", emoji: "🌾", tags: ["Healthy", "Quick"], prepTime: "10 min", ingredients: ["Oats", "Milk", "Banana", "Honey"] },
      { name: "Scrambled Eggs", emoji: "🍳", tags: ["Quick", "High Protein"], prepTime: "10 min", ingredients: ["Eggs", "Butter", "Salt", "Cheese"] },
      { name: "Smoothie Bowl", emoji: "🫐", tags: ["Healthy", "Quick"], prepTime: "5 min", ingredients: ["Frozen berries", "Banana", "Yogurt", "Granola"] },
      { name: "French Toast", emoji: "🍞", tags: ["Kids Love", "Weekend"], prepTime: "15 min", ingredients: ["Bread", "Eggs", "Milk", "Cinnamon", "Syrup"] },
    ],
  },
  {
    mealType: "lunch",
    ideas: [
      { name: "Grilled Cheese", emoji: "🧀", tags: ["Quick", "Kids Love"], prepTime: "10 min", ingredients: ["Bread", "Cheddar", "Butter"] },
      { name: "Caesar Salad", emoji: "🥗", tags: ["Healthy", "Quick"], prepTime: "15 min", ingredients: ["Romaine", "Parmesan", "Croutons", "Caesar dressing"] },
      { name: "Turkey Wrap", emoji: "🌯", tags: ["Quick", "Healthy"], prepTime: "10 min", ingredients: ["Tortilla", "Turkey", "Lettuce", "Tomato", "Mustard"] },
      { name: "Tomato Soup", emoji: "🍲", tags: ["Comfort Food", "Quick"], prepTime: "20 min", ingredients: ["Tomatoes", "Cream", "Onion", "Basil"] },
      { name: "BLT Sandwich", emoji: "🥪", tags: ["Quick", "Family Fave"], prepTime: "10 min", ingredients: ["Bread", "Bacon", "Lettuce", "Tomato", "Mayo"] },
      { name: "Chicken Quesadilla", emoji: "🫔", tags: ["Quick", "Family Fave"], prepTime: "15 min", ingredients: ["Tortilla", "Chicken", "Cheese", "Salsa"] },
    ],
  },
  {
    mealType: "snack",
    ideas: [
      { name: "Apple & Peanut Butter", emoji: "🍎", tags: ["Quick", "Healthy"], prepTime: "2 min", ingredients: ["Apple", "Peanut butter"] },
      { name: "Cheese & Crackers", emoji: "🧀", tags: ["Quick", "Savory"], prepTime: "2 min", ingredients: ["Cheese", "Crackers"] },
      { name: "Yogurt Parfait", emoji: "🍦", tags: ["Healthy", "Sweet"], prepTime: "5 min", ingredients: ["Greek yogurt", "Granola", "Berries"] },
      { name: "Trail Mix", emoji: "🥜", tags: ["Quick", "Portable"], prepTime: "1 min", ingredients: ["Nuts", "Dried fruit", "Chocolate chips"] },
      { name: "Hummus & Veggies", emoji: "🥕", tags: ["Healthy", "Snack"], prepTime: "3 min", ingredients: ["Hummus", "Carrots", "Celery"] },
      { name: "Banana Smoothie", emoji: "🍌", tags: ["Healthy", "Sweet"], prepTime: "5 min", ingredients: ["Banana", "Milk", "Honey"] },
    ],
  },
  {
    mealType: "dinner",
    ideas: [
      { name: "Pasta Primavera", emoji: "🍝", tags: ["Vegetarian", "Quick"], prepTime: "25 min", ingredients: ["Penne", "Zucchini", "Bell peppers", "Parmesan"] },
      { name: "Taco Night", emoji: "🌮", tags: ["Family Fave", "Quick"], prepTime: "20 min", ingredients: ["Ground beef", "Taco shells", "Salsa", "Cheese"] },
      { name: "Grilled Chicken", emoji: "🍗", tags: ["High Protein", "Healthy"], prepTime: "35 min", ingredients: ["Chicken breast", "Broccoli", "Lemon", "Garlic"] },
      { name: "Homemade Pizza", emoji: "🍕", tags: ["Family Fave", "Fun"], prepTime: "45 min", ingredients: ["Pizza dough", "Mozzarella", "Tomato sauce"] },
      { name: "Stir Fry", emoji: "🥢", tags: ["Quick", "Healthy"], prepTime: "20 min", ingredients: ["Shrimp", "Snap peas", "Soy sauce", "Rice"] },
      { name: "Slow Cooker Chili", emoji: "🫕", tags: ["Comfort Food", "Meal Prep"], prepTime: "6 hr", ingredients: ["Ground beef", "Kidney beans", "Tomatoes"] },
    ],
  },
];

export const slotMeta: Record<string, { color: string; label: string; time: string; icon: string }> = {
  breakfast: { color: "var(--color-accent-amber, #fbbf24)", label: "Breakfast", time: "7:30 AM", icon: "🌅" },
  lunch: { color: "var(--color-accent-mint, #34d399)", label: "Lunch", time: "12:30 PM", icon: "☀️" },
  snack: { color: "var(--color-accent-cyan, #22d3ee)", label: "Snack", time: "3:30 PM", icon: "🥨" },
  dinner: { color: "var(--color-accent-rose, #f43f5e)", label: "Dinner", time: "6:30 PM", icon: "🌙" },
};

export const smartTips = [
  { emoji: "💡", title: "Smart leftover tip", text: "Taco night makes extra filling — plan to reuse it for lunch bowls tomorrow. Zero waste!" },
  { emoji: "🧊", title: "Already at home", text: "Oats, rice and peanut butter are stocked in your pantry — we left them off the grocery list to save you money." },
  { emoji: "♻️", title: "Reduce food waste", text: "Check your pantry for expiring items and plan meals around them this week." },
  { emoji: "🥦", title: "Veggie boost", text: "Add an extra serving of veggies to dinner — it's an easy way to hit your daily nutrition goals." },
];

export const CALORIE_GOAL = 2000;
export const PROTEIN_GOAL = 150;
export const CARBS_GOAL = 300;
export const FAT_GOAL = 65;
