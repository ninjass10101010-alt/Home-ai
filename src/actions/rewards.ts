"use server";

import { db } from "@/db";
import { rewards } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function getRewards() {
  return await db.select().from(rewards).orderBy(desc(rewards.createdAt));
}

export async function addReward(data: {
  title: string;
  description?: string;
  emoji: string;
  cost: number;
}) {
  const result = await db.insert(rewards).values(data).returning();
  revalidatePath("/tasks");
  return result[0];
}

export async function updateReward(id: number, data: Partial<typeof rewards.$inferInsert>) {
  const result = await db.update(rewards).set(data).where(eq(rewards.id, id)).returning();
  revalidatePath("/tasks");
  return result[0];
}

export async function deleteReward(id: number) {
  await db.delete(rewards).where(eq(rewards.id, id));
  revalidatePath("/tasks");
}
