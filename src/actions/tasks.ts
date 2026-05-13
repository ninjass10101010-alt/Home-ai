"use server";

import { db } from "@/db";
import { tasks, members } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function getTasks() {
  const allTasks = await db.select().from(tasks).orderBy(desc(tasks.createdAt));
  return allTasks;
}

export async function addTask(data: {
  title: string;
  description?: string;
  dueDate?: string;
  priority: "low" | "medium" | "high";
  assignedTo?: number;
  status: "pending" | "completed";
  points: number;
  category: string;
  recurring: boolean;
  frequency?: string;
}) {
  const result = await db.insert(tasks).values(data).returning();
  revalidatePath("/tasks");
  return result[0];
}

export async function updateTask(id: number, data: Partial<typeof tasks.$inferInsert>) {
  const result = await db.update(tasks).set(data).where(eq(tasks.id, id)).returning();
  revalidatePath("/tasks");
  return result[0];
}

export async function deleteTask(id: number) {
  await db.delete(tasks).where(eq(tasks.id, id));
  revalidatePath("/tasks");
}

export async function toggleTaskStatus(id: number, currentStatus: "pending" | "completed") {
  const newStatus = currentStatus === "pending" ? "completed" : "pending";
  const result = await db.update(tasks).set({ status: newStatus }).where(eq(tasks.id, id)).returning();
  revalidatePath("/tasks");
  return result[0];
}

export async function completeTask(id: number, memberId: number) {
  const result = await db.update(tasks)
    .set({ status: "completed", assignedTo: memberId })
    .where(eq(tasks.id, id))
    .returning();
  revalidatePath("/tasks");
  revalidatePath("/");
  return result[0];
}

