"use server";

import { db } from "@/db";
import { schedules } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function getSchedules() {
  return await db.select().from(schedules);
}

export async function addSchedule(data: {
  title: string;
  time: string;
  days: string;
  memberId?: number;
  type: "routine" | "reminder";
  icon?: string;
  color?: string;
}) {
  const result = await db.insert(schedules).values(data).returning();
  revalidatePath("/");
  return result[0];
}

export async function updateSchedule(id: number, data: any) {
  const result = await db.update(schedules)
    .set(data)
    .where(eq(schedules.id, id))
    .returning();
  revalidatePath("/");
  return result[0];
}

export async function deleteSchedule(id: number) {
  await db.delete(schedules).where(eq(schedules.id, id));
  revalidatePath("/");
}
