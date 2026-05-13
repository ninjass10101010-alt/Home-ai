"use server";

import { db } from "@/db";
import { members, events, tasks, groceryItems } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function addEvent(title: string, date: string, time: string, memberName?: string) {
  let memberId: number | undefined;
  if (memberName) {
    const member = await db.select().from(members).where(eq(members.name, memberName)).get();
    memberId = member?.id;
  }
  
  return await db.insert(events).values({
    title,
    date,
    time,
    memberId,
    type: "event",
  }).returning();
}

export async function addTask(title: string, memberName?: string, priority: "high" | "medium" | "low" = "medium") {
  let memberId: number | undefined;
  if (memberName) {
    const member = await db.select().from(members).where(eq(members.name, memberName)).get();
    memberId = member?.id;
  }

  return await db.insert(tasks).values({
    title,
    assignedTo: memberId,
    priority,
    status: "pending",
  }).returning();
}

export async function addGroceryItem(name: string, quantity?: string) {
  return await db.insert(groceryItems).values({
    name,
    quantity,
    priority: "medium",
    status: "needed",
  }).returning();
}
