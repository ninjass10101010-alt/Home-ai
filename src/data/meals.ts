import { Meal, Recipe, GroceryItem } from "@/types/meals";

export const defaultMeals: Meal[] = [
  { id: 1, name: "Cereal & Fruit", emoji: "🥣", time: "Mon", mealType: "breakfast", prepTime: "5 min", tags: ["Quick", "Kids"], ingredients: ["Cereal", "Milk", "Bananas"], servings: 4, calories: 320 },
  { id: 2, name: "Pasta Primavera", emoji: "🍝", time: "Mon", mealType: "dinner", prepTime: "25 min", tags: ["Vegetarian", "Quick"], ingredients: ["Penne pasta", "Zucchini", "Bell peppers", "Parmesan", "Olive oil"], servings: 4, calories: 420, protein: 14, carbs: 62, fat: 12 },
  { id: 3, name: "Taco Night", emoji: "🌮", time: "Tue", mealType: "dinner", prepTime: "20 min", tags: ["Family Fave", "Quick"], ingredients: ["Ground beef", "Taco shells", "Salsa", "Sour cream", "Lettuce", "Cheese"], servings: 4, calories: 550, protein: 28, carbs: 45, fat: 22 },
  { id: 4, name: "Grilled Chicken", emoji: "🍗", time: "Wed", mealType: "dinner", prepTime: "35 min", tags: ["High Protein", "Healthy"], ingredients: ["Chicken breast", "Broccoli", "Lemon", "Garlic", "Olive oil"], servings: 4, calories: 380, protein: 42, carbs: 18, fat: 14 },
  { id: 5, name: "Shrimp Stir Fry", emoji: "🥢", time: "Thu", mealType: "dinner", prepTime: "20 min", tags: ["Seafood", "Quick"], ingredients: ["Shrimp", "Snap peas", "Carrots", "Soy sauce", "Ginger", "Rice"], servings: 4, calories: 410, protein: 32, carbs: 48, fat: 8 },
  { id: 6, name: "Homemade Pizza", emoji: "🍕", time: "Fri", mealType: "dinner", prepTime: "45 min", tags: ["Family Fave", "Fun"], ingredients: ["Pizza dough", "Mozzarella", "Tomato sauce", "Bell peppers", "Mushrooms"], servings: 4, calories: 620, protein: 24, carbs: 78, fat: 22 },
  { id: 7, name: "BBQ Ribs", emoji: "🍖", time: "Sat", mealType: "dinner", prepTime: "2 hr", tags: ["Weekend", "Indulgent"], ingredients: ["Pork ribs", "BBQ sauce", "Corn on cob", "Coleslaw"], servings: 4, calories: 780, protein: 48, carbs: 42, fat: 38 },
  { id: 8, name: "Slow Cooker Chili", emoji: "🫕", time: "Sun", mealType: "dinner", prepTime: "6 hr", tags: ["Comfort Food", "Meal Prep"], ingredients: ["Ground beef", "Kidney beans", "Tomatoes", "Chili powder", "Onion"], servings: 6, calories: 490, protein: 34, carbs: 52, fat: 16 },
];

export const mealIdeas = [
  { name: "Salmon & Asparagus", emoji: "🐟", tags: ["Healthy"] },
  { name: "Veggie Curry", emoji: "🍛", tags: ["Vegetarian"] },
  { name: "BLT Sandwiches", emoji: "🥪", tags: ["Quick"] },
  { name: "Mac & Cheese", emoji: "🧀", tags: ["Kids Love"] },
];

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

export const initialGroceryItems: GroceryItem[] = [
  { id: 1, name: "Bananas", emoji: "🍌", category: "produce", aisle: "1", priority: "medium", needed: true },
  { id: 2, name: "Baby spinach", emoji: "🥬", category: "produce", aisle: "2", priority: "high", needed: true },
  { id: 3, name: "Avocados", emoji: "🥑", category: "produce", aisle: "2", priority: "medium", needed: false },
  { id: 4, name: "Milk", emoji: "🥛", category: "dairy", aisle: "4", priority: "high", needed: true },
  { id: 5, name: "Eggs", emoji: "🥚", category: "dairy", aisle: "4", priority: "high", needed: true },
  { id: 6, name: "Cheddar cheese", emoji: "🧀", category: "dairy", aisle: "5", priority: "medium", needed: false },
  { id: 7, name: "Chicken breast", emoji: "🍗", category: "meat", aisle: "6", priority: "high", needed: true },
  { id: 8, name: "Ground beef", emoji: "🥩", category: "meat", aisle: "6", priority: "medium", needed: true },
  { id: 9, name: "Pasta", emoji: "🍝", category: "pantry", aisle: "8", priority: "medium", needed: true },
  { id: 10, name: "Olive oil", emoji: "🫒", category: "pantry", aisle: "8", priority: "low", needed: false },
  { id: 11, name: "Coffee", emoji: "☕", category: "beverages", aisle: "13", priority: "high", needed: true },
];

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

export const emptyRecipe = {
  name: "",
  emoji: "🍳",
  time: "Mon",
  prepTime: "",
  servings: 4,
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  tags: [] as string[],
  ingredients: [""],
  instructions: "",
};

export const defaultRecipes: Recipe[] = [
  { id: 1, name: "Grandma's Meatballs", emoji: "🧆", prepTime: "45 min", cookTime: "30 min", tags: ["Family", "Italian"], ingredients: ["Ground beef", "Breadcrumbs", "Eggs", "Parmesan", "Garlic", "Marinara sauce"], instructions: "1. Mix beef, breadcrumbs, eggs, parmesan, garlic.\n2. Roll into balls.\n3. Brown in pan, then simmer in marinara 30 min.", servings: 6, calories: 380, protein: 28, carbs: 18, fat: 22, createdAt: new Date().toISOString() },
  { id: 2, name: "Chicken Quesadillas", emoji: "🫔", prepTime: "15 min", cookTime: "10 min", tags: ["Quick", "Mexican"], ingredients: ["Chicken breast", "Tortillas", "Cheese", "Salsa", "Sour cream"], instructions: "1. Cook and shred chicken.\n2. Fill tortillas with chicken and cheese.\n3. Pan-fry until golden.", servings: 4, calories: 450, protein: 32, carbs: 35, fat: 18, createdAt: new Date().toISOString() },
];
