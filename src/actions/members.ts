"use server";

import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export type MemberRole = "mom" | "dad" | "son" | "daughter" | "other";

export async function getMembers() {
  return await db.select().from(members);
}

export async function addMember(data: { name: string, role: MemberRole, emoji: string, profileImage?: string }) {
  const result = await db.insert(members).values({
    name: data.name,
    role: data.role,
    emoji: data.emoji,
    profileImage: data.profileImage,
  }).returning();
  
  revalidatePath("/settings");
  revalidatePath("/");
  return result[0];
}

export async function updateMember(id: number, data: { name?: string, role?: MemberRole, emoji?: string, profileImage?: string }) {
  const result = await db.update(members)
    .set(data)
    .where(eq(members.id, id))
    .returning();
    
  revalidatePath("/settings");
  revalidatePath("/");
  return result[0];
}

export async function deleteMember(id: number) {
  await db.delete(members).where(eq(members.id, id));
  revalidatePath("/settings");
  revalidatePath("/");
}
