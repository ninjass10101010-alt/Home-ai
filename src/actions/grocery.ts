"use server";

import { db } from "@/db";
import { groceryItems, pantryItems } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function getGroceryItems() {
  return await db.select().from(groceryItems);
}

export async function addGroceryItem(data: Partial<typeof groceryItems.$inferInsert>) {
  const result = await db.insert(groceryItems).values(data as any).returning();
  revalidatePath("/grocery");
  return result[0];
}

export async function updateGroceryItem(id: number, data: Partial<typeof groceryItems.$inferInsert>) {
  const result = await db.update(groceryItems).set(data).where(eq(groceryItems.id, id)).returning();
  revalidatePath("/grocery");
  return result[0];
}

export async function deleteGroceryItem(id: number) {
  await db.delete(groceryItems).where(eq(groceryItems.id, id));
  revalidatePath("/grocery");
}

export async function getPantryItems() {
  return await db.select().from(pantryItems);
}

export async function addPantryItem(data: Partial<typeof pantryItems.$inferInsert>) {
  const result = await db.insert(pantryItems).values(data as any).returning();
  revalidatePath("/meals");
  revalidatePath("/grocery");
  return result[0];
}

export async function updatePantryItem(id: number, data: Partial<typeof pantryItems.$inferInsert>) {
  const result = await db.update(pantryItems).set(data).where(eq(pantryItems.id, id)).returning();
  revalidatePath("/meals");
  revalidatePath("/grocery");
  return result[0];
}
