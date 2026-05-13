"use server";

import { db } from "@/db";
import { members, events, tasks, schedules } from "@/db/schema";
import { eq, and, gte, lte } from "drizzle-orm";

export async function getHomeData() {
  const allMembers = await db.select().from(members);
  
  const today = new Date().toISOString().split('T')[0];
  
  const todayEvents = await db.select().from(events).where(eq(events.date, today));
  const pendingTasks = await db.select().from(tasks).where(eq(tasks.status, "pending"));
  const allSchedules = await db.select().from(schedules);

  // Map data to the format expected by the UI
  const mappedMembers = allMembers.map(m => ({
    name: m.name,
    color: m.name === "Mom" ? "green" : m.name === "Dad" ? "cyan" : m.name === "Jake" ? "violet" : "amber",
    emoji: m.emoji || "👤"
  }));

  const mappedEvents = todayEvents.map(e => {
    const member = allMembers.find(m => m.id === e.memberId);
    return {
      id: e.id,
      title: e.title,
      time: e.time || "",
      member: member?.name || "Family",
      emoji: member?.emoji || "📅",
      color: member?.name === "Mom" ? "green" : member?.name === "Dad" ? "cyan" : member?.name === "Jake" ? "violet" : "amber",
      icon: e.title.toLowerCase().includes("soccer") ? "⚽" : e.title.toLowerCase().includes("dentist") ? "🦷" : "🍽️"
    };
  });

  const mappedTasks = pendingTasks.map(t => {
    const member = allMembers.find(m => m.id === t.assignedTo);
    return {
      id: t.id,
      title: t.title,
      assigned: member?.name || "Anyone",
      assigneeEmoji: member?.emoji || "👤",
      assigneeColor: member?.name === "Mom" ? "green" : member?.name === "Dad" ? "cyan" : member?.name === "Jake" ? "violet" : "amber",
      due: t.dueDate || "Today",
      points: t.points,
      emoji: t.emoji || "📝",
      done: t.status === "completed"
    };
  });

  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();

  return {
    members: mappedMembers,
    events: mappedEvents,
    tasks: mappedTasks,
    schedules: allSchedules
      .filter(s => {
        try {
          const days = JSON.parse(s.days);
          return days.includes("all") || days.includes(dayOfWeek);
        } catch (e) {
          return true;
        }
      })
      .map(s => {
        const member = allMembers.find(m => m.id === s.memberId);
        return {
          id: s.id,
          title: s.title,
          time: s.time,
          member: member?.name,
          memberColor: member?.name === "Mom" ? "green" : member?.name === "Dad" ? "cyan" : member?.name === "Jake" ? "violet" : "amber",
          emoji: s.icon || "⏰",
          type: s.type,
          color: s.color || "nori"
        };
      })
  };
}
