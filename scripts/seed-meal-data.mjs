import PocketBase from 'pocketbase';

const pbUrl = process.env.NEXT_PUBLIC_PB_URL || 'http://192.168.0.27:8091';
const pb = new PocketBase(pbUrl);

async function seedSmartMealData() {
  console.log("Seeding smart meal planning data...");

  try {
    await pb.admins.authWithPassword('admin@garcia.family', '26649_alan');
    console.log("✅ Authenticated!");
  } catch (e) {
    console.error("❌ Authentication failed");
    return;
  }

  // Seed basic ingredients
  const ingredients = [
    {
      name: "all-purpose flour",
      category: "pantry",
      unit: "g",
      nutritionPerUnit: {
        calories: 361,
        protein: 10,
        carbs: 76,
        fat: 1,
        fiber: 3,
        sugar: 0.3,
        sodium: 2
      },
      commonSubstitutes: [],
      storageTips: "Store in airtight container in cool, dry place for up to 1 year",
      allergyTags: ["gluten"]
    },
    {
      name: "chicken breast",
      category: "meat",
      unit: "g",
      nutritionPerUnit: {
        calories: 165,
        protein: 31,
        carbs: 0,
        fat: 3.6,
        fiber: 0,
        sugar: 0,
        sodium: 74
      },
      commonSubstitutes: [],
      storageTips: "Refrigerate up to 2 days, freeze up to 9 months",
      allergyTags: []
    },
    {
      name: "brown rice",
      category: "pantry",
      unit: "g",
      nutritionPerUnit: {
        calories: 111,
        protein: 2.6,
        carbs: 23,
        fat: 0.9,
        fiber: 1.8,
        sugar: 0.4,
        sodium: 4
      },
      commonSubstitutes: [],
      storageTips: "Store in airtight container for up to 6 months",
      allergyTags: []
    },
    {
      name: "broccoli",
      category: "produce",
      unit: "g",
      nutritionPerUnit: {
        calories: 34,
        protein: 2.8,
        carbs: 7,
        fat: 0.4,
        fiber: 2.6,
        sugar: 1.7,
        sodium: 33
      },
      commonSubstitutes: [],
      storageTips: "Refrigerate in plastic bag for up to 1 week",
      allergyTags: []
    },
    {
      name: "olive oil",
      category: "pantry",
      unit: "ml",
      nutritionPerUnit: {
        calories: 884,
        protein: 0,
        carbs: 0,
        fat: 100,
        fiber: 0,
        sugar: 0,
        sodium: 2
      },
      commonSubstitutes: [],
      storageTips: "Store in dark, cool place for up to 2 years",
      allergyTags: []
    },
    {
      name: "garlic",
      category: "produce",
      unit: "count",
      nutritionPerUnit: {
        calories: 4,
        protein: 0.2,
        carbs: 1,
        fat: 0,
        fiber: 0.1,
        sugar: 0,
        sodium: 1
      },
      commonSubstitutes: [],
      storageTips: "Store in cool, dark place for up to 3 months",
      allergyTags: []
    },
    {
      name: "whole milk",
      category: "dairy",
      unit: "ml",
      nutritionPerUnit: {
        calories: 61,
        protein: 3.3,
        carbs: 4.8,
        fat: 3.3,
        fiber: 0,
        sugar: 4.8,
        sodium: 43
      },
      commonSubstitutes: [],
      storageTips: "Refrigerate up to 1 week after opening",
      allergyTags: ["dairy"]
    },
    {
      name: "eggs",
      category: "dairy",
      unit: "count",
      nutritionPerUnit: {
        calories: 78,
        protein: 6.3,
        carbs: 0.6,
        fat: 5.3,
        fiber: 0,
        sugar: 0.6,
        sodium: 62
      },
      commonSubstitutes: [],
      storageTips: "Refrigerate up to 5 weeks",
      allergyTags: ["eggs"]
    }
  ];

  console.log("Creating ingredients...");
  const createdIngredients = [];
  for (const ingredient of ingredients) {
    try {
      const created = await pb.collection("ingredients").create(ingredient);
      createdIngredients.push(created);
      console.log(`✅ Created ingredient: ${ingredient.name} (id: ${created.id})`);
    } catch (e) {
      console.log(`⚠️ Ingredient ${ingredient.name} may already exist`);
      // Try to find existing
      try {
        const existing = await pb.collection("ingredients").getFirstListItem(`name="${ingredient.name}"`);
        createdIngredients.push(existing);
        console.log(`Found existing ingredient: ${ingredient.name} (id: ${existing.id})`);
      } catch (findErr) {
        console.error(`Failed to find existing ingredient: ${ingredient.name}`);
      }
    }
  }

  console.log(`Total ingredients processed: ${createdIngredients.length}`);

  // Create a sample recipe
  const recipe = {
    name: "Chicken Stir Fry with Broccoli",
    instructions: [
      "Heat 1 tbsp olive oil in a large skillet over medium-high heat",
      "Add cubed chicken breast and cook for 5-7 minutes until browned",
      "Add minced garlic and cook for 1 minute until fragrant",
      "Add broccoli florets and stir fry for 3-4 minutes until tender-crisp",
      "Season with salt and pepper to taste",
      "Serve over brown rice"
    ],
    cuisineType: ["american", "asian"],
    dietaryTags: ["high-protein"],
    prepTimeMinutes: 10,
    cookTimeMinutes: 15,
    difficulty: "easy",
    flavorProfile: { savory: 0.8, umami: 0.6 },
    pairingSuggestions: [],
    imageUrl: null
  };

  console.log("Creating sample recipe...");
  let createdRecipe;
  try {
    createdRecipe = await pb.collection("recipes").create(recipe);
    console.log(`✅ Created recipe: ${recipe.name}`);
  } catch (e) {
    console.log("⚠️ Recipe may already exist");
    try {
      createdRecipe = await pb.collection("recipes").getFirstListItem(`name="${recipe.name}"`);
    } catch (findErr) {
      console.error("Failed to find existing recipe");
      return;
    }
  }

  // Create recipe ingredients - use first few ingredients for simplicity
  if (createdIngredients.length < 3) {
    console.error("Not enough ingredients created for recipe");
    return;
  }

  const recipeIngredients = [
    { recipeId: createdRecipe.id, ingredientId: createdIngredients[0].id, quantity: 400, unit: "g", notes: "main protein" },
    { recipeId: createdRecipe.id, ingredientId: createdIngredients[1].id, quantity: 300, unit: "g", notes: "vegetable" },
    { recipeId: createdRecipe.id, ingredientId: createdIngredients[2].id, quantity: 200, unit: "g", notes: "starch" }
  ];

  console.log("Creating recipe ingredients...");
  for (const ri of recipeIngredients) {
    try {
      await pb.collection("recipe_ingredients").create(ri);
      console.log(`✅ Added ingredient to recipe`);
    } catch (e) {
      console.log("⚠️ Recipe ingredient may already exist");
    }
  }

  console.log("🎉 Smart meal data seeding complete!");
}

seedSmartMealData();