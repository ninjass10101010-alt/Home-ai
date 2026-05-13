import { db } from "./index";
import { members, events, tasks, schedules } from "./schema";

async function seed() {
  console.log("Seeding database...");

  // Clear existing data
  // Note: Depending on the implementation of createDatabase, 
  // you might need to use standard drizzle delete if supported.
  
  const familyMembers = [
    { name: "Mom", role: "mom" as const, emoji: "👩" },
    { name: "Dad", role: "dad" as const, emoji: "👨" },
    { name: "Jake", role: "son" as const, emoji: "🧒" },
    { name: "Lily", role: "daughter" as const, emoji: "👧" },
  ];

  for (const member of familyMembers) {
    await db.insert(members).values(member);
  }


  const allMembers = await db.select().from(members);
  const mom = allMembers.find(m => m.name === "Mom")!;
  const dad = allMembers.find(m => m.name === "Dad")!;
  const jake = allMembers.find(m => m.name === "Jake")!;
  const lily = allMembers.find(m => m.name === "Lily")!;

  const today = new Date().toISOString().split('T')[0];

  await db.insert(events).values([
    {
      title: "Soccer Practice",
      date: today,
      time: "16:00",
      memberId: jake.id,
      type: "event",
    },
    {
      title: "Dentist — Lily",
      date: today,
      time: "17:30",
      memberId: lily.id,
      type: "event",
    },
    {
      title: "Team dinner",
      date: today,
      time: "19:00",
      memberId: dad.id,
      type: "event",
    },
  ]);

  await db.insert(tasks).values([
    {
      title: "Take out trash",
      dueDate: today,
      priority: "high",
      assignedTo: jake.id,
      status: "pending",
      recurring: true,
      frequency: "weekly",
    },
    {
      title: "Grocery run",
      dueDate: today,
      priority: "high",
      assignedTo: mom.id,
      status: "pending",
    },
    {
      title: "Clean bathroom",
      dueDate: today,
      priority: "medium",
      assignedTo: lily.id,
      status: "completed",
    },
  ]);

  await db.insert(schedules).values([
    { title: "Lunch", time: "12:00", days: JSON.stringify(["all"]), type: "routine", icon: "🍽️", color: "amber" },
    { title: "Emily bedtime", time: "21:00", days: JSON.stringify(["all"]), memberId: lily.id, type: "routine", icon: "🧒", color: "violet" },
    { title: "Family movie night", time: "19:30", days: JSON.stringify(["wed"]), type: "routine", icon: "🎬", color: "nori" },
    { title: "Take medication", time: "08:00", days: JSON.stringify(["all"]), type: "reminder", icon: "💊", color: "rose" },
  ]);

  console.log("Seeding complete!");
}

seed().catch(console.error);
