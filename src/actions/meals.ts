"use server";

import { db } from "@/db";
import { meals, groceryItems, pantryItems } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function getMeals() {
  return await db.select().from(meals).orderBy(desc(meals.date));
}

export async function addMeal(data: {
  name: string;
  date: string;
  description?: string;
  emoji: string;
  recipeUrl?: string;
  ingredients?: string;
}) {
  const result = await db.insert(meals).values(data).returning();
  revalidatePath("/meals");
  revalidatePath("/");
  return result[0];
}

export async function updateMeal(id: number, data: Partial<typeof meals.$inferInsert>) {
  const result = await db.update(meals).set(data).where(eq(meals.id, id)).returning();
  revalidatePath("/meals");
  revalidatePath("/");
  return result[0];
}

export async function deleteMeal(id: number) {
  await db.delete(meals).where(eq(meals.id, id));
  revalidatePath("/meals");
  revalidatePath("/");
}

export async function syncMealToGrocery(mealId: number, ingredients: string[]) {
  const [existingItems, pantry] = await Promise.all([
    db.select().from(groceryItems),
    db.select().from(pantryItems)
  ]);
  
  const existingNames = new Set(existingItems.map(i => i.name.toLowerCase()));
  const pantryMap = new Map(pantry.map(p => [p.name.toLowerCase(), p.status]));

  for (const ing of ingredients) {
    const trimmed = ing.trim();
    if (!trimmed) continue;
    
    // Extract emoji if present at the start of the line
    const match = trimmed.match(/^([\u1000-\uFFFF]|\p{Emoji})\s*(.+)$/u);
    const emoji = match ? match[1] : "📦";
    const nameOnly = match ? match[2].trim() : trimmed;
    
    const lowerName = nameOnly.toLowerCase();
    const pantryStatus = pantryMap.get(lowerName);
    
    // Only add if not already in grocery and (not in pantry OR pantry is low/out)
    const needsRefill = !pantryStatus || pantryStatus === "low" || pantryStatus === "out";
    
    if (!existingNames.has(lowerName) && needsRefill) {
      await db.insert(groceryItems).values({
        name: nameOnly,
        emoji: emoji,
        category: "pantry",
        priority: "medium",
        status: "suggested",
      });
    }
  }
  revalidatePath("/grocery");
  revalidatePath("/meals");
}
