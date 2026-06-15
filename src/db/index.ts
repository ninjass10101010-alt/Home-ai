// Use a simple in-memory approach for now until Bun SQLite types are available
// const sqlite = new Database("sqlite.db");

// Seed data for demonstration - in production this would be user-managed
const membersData = [
  { id: 1, name: "Rebecca (Mom)", role: "parent", emoji: "🐱", fullName: "Rebecca Garcia", age: 38, joined: "Feb 2024", skinColor: "#fdbcb4", hairColor: "#b45309", pin: "0202" },
  { id: 2, name: "Jeffery (Dad)", role: "parent", emoji: "👨", fullName: "Jeffery Garcia", age: 40, joined: "Feb 2024", skinColor: "#fdbcb4", hairColor: "#1e40af", pin: "0828" },
  { id: 3, name: "Emily", role: "child", emoji: "👧", fullName: "Emily Garcia", age: 14, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#5b21b6", pin: "1024" },
  { id: 4, name: "Bailey", role: "child", emoji: "👧", fullName: "Bailey Garcia", age: 12, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#166534", pin: "1005" },
  { id: 5, name: "Jasmine", role: "child", emoji: "👧", fullName: "Jasmine Garcia", age: 10, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#b45309", pin: "0402" },
  { id: 6, name: "Aurora", role: "child", emoji: "👧", fullName: "Aurora Garcia", age: 7, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#5b21b6", pin: "1025" },
  { id: 7, name: "Caspian", role: "child", emoji: "🧒", fullName: "Caspian Garcia", age: 5, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#166534", pin: "1010" },
  { id: 8, name: "Rocco", role: "pet", emoji: "🐶", fullName: "Rocco (Frenchie)", age: 3, joined: "Feb 2024", pin: "0000" },
  { id: 9, name: "Rico", role: "pet", emoji: "🐩", fullName: "Rico (Poodle)", age: 5, joined: "Feb 2024", pin: "0000" },
];

const eventsData = [
  {
    id: 1,
    title: "Soccer Practice",
    date: new Date().toISOString().split('T')[0], // Today
    time: "16:00",
    memberId: 3,
    type: "event",
    description: "Emily's soccer practice at the field",
  },
  {
    id: 2,
    title: "Dentist — Bailey",
    date: new Date().toISOString().split('T')[0], // Today
    time: "17:30",
    memberId: 4,
    type: "event",
    description: "Bailey's regular checkup",
  },
  {
    id: 3,
    title: "Team dinner",
    date: new Date().toISOString().split('T')[0], // Today
    time: "19:00",
    memberId: 2,
    type: "event",
    description: "Dad's work team dinner",
  },
];

const tasksData = [
  {
    id: 1,
    title: "Take out trash",
    description: "Empty kitchen and bathroom trash bins",
    dueDate: new Date().toISOString().split('T')[0], // Today
    priority: "medium",
    assignedTo: 3, // Emily
    status: "pending",
    recurring: false,
  },
  {
    id: 2,
    title: "Grocery run",
    description: "Pick up items from the grocery list",
    dueDate: new Date().toISOString().split('T')[0], // Today
    priority: "high",
    assignedTo: 1, // Mom
    status: "pending",
    recurring: false,
  },
  {
    id: 3,
    title: "Clean bathroom",
    description: "Clean upstairs bathroom thoroughly",
    dueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0], // Tomorrow
    priority: "medium",
    assignedTo: 5, // Jasmine
    status: "completed",
    recurring: true,
    frequency: "weekly",
  },
];

const schedulesData = [
  {
    id: 1,
    title: "Wake up / Morning routine",
    time: "07:00",
    days: "weekdays",
    type: "routine",
    icon: "⏰",
    color: "amber",
  },
  {
    id: 2,
    title: "Breakfast",
    time: "07:30",
    days: "all",
    type: "routine",
    icon: "🥞",
    color: "green",
  },
  {
    id: 3,
    title: "School / Learning time",
    time: "08:30",
    days: "weekdays",
    type: "routine",
    icon: "📚",
    color: "cyan",
  },
  {
    id: 4,
    title: "Lunch",
    time: "12:00",
    days: "all",
    type: "routine",
    icon: "🍽️",
    color: "amber",
  },
  {
    id: 5,
    title: "Screen time",
    time: "15:30",
    days: "weekdays",
    type: "routine",
    icon: "📱",
    color: "violet",
  },
  {
    id: 6,
    title: "Dinner",
    time: "18:00",
    days: "all",
    type: "routine",
    icon: "🍝",
    color: "green",
  },
  {
    id: 7,
    title: "Bedtime routine",
    time: "20:30",
    days: "all",
    type: "routine",
    icon: "🛁",
    color: "violet",
  },
  {
    id: 8,
    title: "Lights out",
    time: "21:00",
    days: "all",
    type: "routine",
    icon: "🌙",
    color: "rose",
  },
  {
    id: 9,
    title: "Family movie night",
    time: "19:00",
    days: "friday",
    type: "routine",
    icon: "🎬",
    color: "cyan",
  },
  {
    id: 10,
    title: "Take medication",
    time: "08:00",
    days: "all",
    memberId: 1, // Rebecca (Mom)
    type: "reminder",
    icon: "💊",
    color: "rose",
  },
];

// Emergency contacts — mutable store for CRUD
let emergencyContactsStore: Array<{
  id: number;
  name: string;
  phone: string;
  email: string;
  carrier?: string;
  relationship: "parent" | "guardian" | "grandparent" | "neighbor" | "other";
  isPrimary: boolean;
  emoji?: string;
}> = [
  {
    id: 1,
    name: "Rebecca",
    phone: "+16163448104",
    email: "Ninjass10101010@gmail.com",
    carrier: "verizon",
    relationship: "parent",
    isPrimary: true,
    emoji: "👩",
  },
  {
    id: 2,
    name: "Test Contact",
    phone: "+16167452736",
    email: "Ninjass10101010@gmail.com",
    carrier: "verizon",
    relationship: "parent",
    isPrimary: true,
    emoji: "👨",
  },
];

// Mock database interface - replace with real Drizzle queries later
// In-memory storage for demo purposes
let membersStore: any[] = [];
const __membersStoreInit = () => {
  const d = typeof window !== "undefined" ? window.localStorage.getItem("consuela-members") : null;
  if (d) {
    try {
      const parsed = JSON.parse(d);
      membersStore = parsed.map(function(m: any) {
        const seed = membersData.find(function(s: any) { return s.name === m.name; });
        return seed ? Object.assign({}, seed, {
          emoji: m.emoji || seed.emoji,
          age: parseInt(m.age) || seed.age,
          pin: m.pin || (seed.pin || ""),
          avatarSize: m.avatarSize || "md",
          glow: Boolean(m.glow),
        }) : (seed || membersData[0]);
      });
    } catch(e) { membersStore = [...membersData]; }
  } else { membersStore = [...membersData]; }
};
__membersStoreInit();

// === Meal/Pantry/Grocery in-memory stores (module-scoped lets for reliable mutation) ===
// This fixes the previous (this as any) binding issues in object literal methods.
let mealsStore: any[] = [];
let pantryStore: any[] = [];
let groceryStore: any[] = [];

// === Initial seeding for pantryStore and groceryStore (runs once, length===0 check at bottom of stores definition) ===
// Uses pantry examples + grocery pantry items from pages, variety of statuses 'plenty'/'low'/'out' and sources
if (pantryStore.length === 0) {
  pantryStore.push(
    { id: 101, userId: "demo", name: "Olive oil", status: "plenty", lastUpdated: new Date().toISOString(), createdAt: new Date().toISOString() },
    { id: 102, userId: "demo", name: "Rice", status: "plenty", lastUpdated: new Date().toISOString(), createdAt: new Date().toISOString() },
    { id: 103, userId: "demo", name: "Pasta", status: "low", lastUpdated: new Date().toISOString(), createdAt: new Date().toISOString() },
    { id: 104, userId: "demo", name: "Chicken breast", status: "out", lastUpdated: new Date().toISOString(), createdAt: new Date().toISOString() },
    { id: 105, userId: "demo", name: "Milk", status: "low", lastUpdated: new Date().toISOString(), createdAt: new Date().toISOString() },
    { id: 106, userId: "demo", name: "Zucchini", status: "plenty", lastUpdated: new Date().toISOString(), createdAt: new Date().toISOString() },
    { id: 107, userId: "demo", name: "Penne pasta", status: "plenty", lastUpdated: new Date().toISOString(), createdAt: new Date().toISOString() },
    { id: 108, userId: "demo", name: "Bell peppers", status: "low", lastUpdated: new Date().toISOString(), createdAt: new Date().toISOString() },
    { id: 109, userId: "demo", name: "Parmesan", status: "out", lastUpdated: new Date().toISOString(), createdAt: new Date().toISOString() },
  );
}

if (groceryStore.length === 0) {
  groceryStore.push(
    { id: 201, userId: "demo", name: "Ground beef", category: "meat", aisle: "6", quantity: "1 lb", priority: "high", needed: true, source: "meal-plan", autoGenerated: true, manualOverride: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 202, userId: "demo", name: "Taco shells", category: "pantry", aisle: "8", quantity: "1 pack", priority: "medium", needed: true, source: "meal-plan", autoGenerated: true, manualOverride: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 203, userId: "demo", name: "Pasta", category: "pantry", aisle: "8", quantity: "2 boxes", priority: "medium", needed: true, source: "pantry-check", autoGenerated: false, manualOverride: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 204, userId: "demo", name: "Milk", category: "dairy", aisle: "4", quantity: "1 gal", priority: "high", needed: true, source: "pantry-check", autoGenerated: false, manualOverride: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 205, userId: "demo", name: "Bananas", category: "produce", aisle: "1", quantity: "6", priority: "medium", needed: true, source: "manual", autoGenerated: false, manualOverride: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  );
}

export const db = {
  // Members - basic view for dashboard
  selectMembers: () => membersStore.map(m => ({
    id: m.id,
    name: m.name.split(' ')[0],
    fullName: m.name,
    role: m.role,
    color: ["green", "cyan", "violet", "amber", "rose", "blue", "cyan", "green", "cyan"][m.id - 1] || "green",
    emoji: m.emoji || "😊",
    skinColor: m.skinColor,
    hairColor: m.hairColor,
    pin: (m as any).pin,
  })),

  // Members - detailed view for settings
  selectMembersDetailed: () => membersStore.map(m => ({
    name: m.name,
    role: m.role === 'parent' ? 'Parent' : m.role === 'pet' ? 'Pet' : 'Child',
    emoji: m.emoji || "😊",
    color: ["green", "cyan", "violet", "amber", "rose", "blue", "cyan", "green", "cyan"][m.id - 1] || "green",
    age: m.age.toString(),
    joined: m.joined,
    skinColor: m.skinColor,
    hairColor: m.hairColor,
    pin: (m as any).pin || "",
    // Persist avatar sizing choice from Settings
    avatarSize: (m as any).avatarSize || "md",
    glow: (m as any).glow || false,
  })),

  // Members - calendar filter view (includes "All" option)
  selectMembersForCalendar: () => [
    { name: "All", color: "green", emoji: "👨‍👩‍👧‍👦" },
    ...membersStore.map(m => ({
      name: m.name.split(' ')[0], // Just first name
      color: ["green", "cyan", "violet", "amber", "rose", "blue", "cyan", "green", "cyan"][m.id - 1] || "green",
      emoji: m.emoji || "😊",
      skinColor: m.skinColor,
      hairColor: m.hairColor,
    }))
  ],

  // Add new member
  insertMember: (memberData: Omit<typeof membersData[0], 'id' | 'joined' | 'fullName'>) => {
    const newMember = {
      ...memberData,
      fullName: memberData.name, // Use name as fullName for now
      id: Math.max(...membersStore.map(m => m.id)) + 1,
      joined: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    };
    membersStore.push(newMember as any);
    return newMember;
  },

  // Update existing member
  updateMember: (name: string, updates: Partial<typeof membersData[0]> & Record<string, any>) => {
    const index = membersStore.findIndex(m => m.name === name);
    if (index !== -1) {
      membersStore[index] = { ...membersStore[index], ...updates } as any;
      return membersStore[index];
    }
    return null;
  },

  // Verify a member's PIN for task completion
  verifyMemberPin: (memberName: string, pin: string) => {
    const member = membersStore.find(m => m.name === memberName || m.name.startsWith(memberName));
    if (!member) return null;
    // Pet members don't have pins
    if ((member as any).pin && (member as any).pin === pin) return member;
    return null;
  },

  // Delete member
  deleteMember: (name: string) => {
    const index = membersStore.findIndex(m => m.name === name);
    if (index !== -1) {
      membersStore.splice(index, 1);
      return true;
    }
    return false;
  },

  // Today's events
  selectTodaysEvents: () => {
    const today = new Date().toISOString().split('T')[0];
    return eventsData
      .filter(event => event.date === today)
      .sort((a, b) => (a.time || '').localeCompare(b.time || '')) // sort by raw 24h time before formatting
      .map(event => {
        const member = membersStore.find(m => m.id === event.memberId);
        return {
          id: event.id,
          title: event.title,
          time: event.time ? new Date(`2000-01-01T${event.time}`).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          }) : undefined,
          member: member?.name || 'Unknown',
          emoji: member?.emoji || '👤',
          color: member?.id === 1 ? 'green' : member?.id === 2 ? 'cyan' : member?.id === 3 ? 'violet' : 'amber',
          icon: event.title.includes('Soccer') ? '⚽' : event.title.includes('Dentist') ? '🦷' : '🍽️',
        };
      });
  },

  // Pending tasks
  selectPendingTasks: () => {
    return tasksData
      .filter(task => task.status === 'pending')
      .slice(0, 3) // Show only first 3
      .map(task => {
        const member = membersStore.find(m => m.id === task.assignedTo);
        const isToday = task.dueDate === new Date().toISOString().split('T')[0];
        const isTomorrow = task.dueDate === new Date(Date.now() + 86400000).toISOString().split('T')[0];

        return {
          id: task.id,
          title: task.title,
          assigned: member?.name || 'Unassigned',
          due: isToday ? 'Today' : isTomorrow ? 'Tomorrow' : 'Later',
          points: task.priority === 'high' ? 20 : task.priority === 'medium' ? 15 : 10,
          done: false,
        };
      });
  },

  // Today's schedules (raw 24h time strings, no AM/PM formatting)
  selectTodaysSchedulesRaw: () => {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
    return schedulesData
      .filter(schedule => schedule.days === 'all' || schedule.days.includes(today))
      .sort((a, b) => a.time.localeCompare(b.time))
      .map(schedule => {
        const member = schedule.memberId ? membersStore.find(m => m.id === schedule.memberId) : null;
        return {
          id: schedule.id,
          title: schedule.title,
          time: schedule.time, // raw "HH:MM" format
          emoji: schedule.icon,
          type: schedule.type,
          color: schedule.color,
          member: member?.name,
          memberColor: member?.id === 1 ? 'green' : member?.id === 2 ? 'cyan' : member?.id === 3 ? 'violet' : 'amber',
        };
      });
  },

  // Today's schedules (formatted for display in ScheduleDisplay)
  selectTodaysSchedules: () => {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
    return schedulesData
      .filter(schedule => schedule.days === 'all' || schedule.days.includes(today))
      .sort((a, b) => a.time.localeCompare(b.time))
      .map(schedule => {
        const member = schedule.memberId ? membersStore.find(m => m.id === schedule.memberId) : null;
        return {
          id: schedule.id,
          title: schedule.title,
          time: new Date(`2000-01-01T${schedule.time}`).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          }),
          emoji: schedule.icon,
          type: schedule.type,
          color: schedule.color,
          member: member?.name,
          memberColor: member?.id === 1 ? 'green' : member?.id === 2 ? 'cyan' : member?.id === 3 ? 'violet' : 'amber',
        };
      });
  },

  // Emergency contacts — proper CRUD
  selectEmergencyContacts: () => emergencyContactsStore.map(c => ({ ...c })),
  
  insertEmergencyContact: (data: Omit<typeof emergencyContactsStore[0], "id">) => {
    const newContact = {
      ...data,
      id: emergencyContactsStore.length > 0 ? Math.max(...emergencyContactsStore.map(c => c.id)) + 1 : 1,
    };
    emergencyContactsStore.push(newContact);
    return newContact;
  },
  
  updateEmergencyContact: (id: number, updates: Partial<typeof emergencyContactsStore[0]>) => {
    const idx = emergencyContactsStore.findIndex(c => c.id === id);
    if (idx !== -1) {
      emergencyContactsStore[idx] = { ...emergencyContactsStore[idx], ...updates };
      return emergencyContactsStore[idx];
    }
    return null;
  },
  
  deleteEmergencyContact: (id: number) => {
    const idx = emergencyContactsStore.findIndex(c => c.id === id);
    if (idx !== -1) {
      emergencyContactsStore.splice(idx, 1);
      return true;
    }
    return false;
  },

  // === Meal Architecture (from plan) - now functional with module-scoped stores ===
  // Reference the module lets so direct db.xxxStore access still works (backward compat)
  mealsStore,
  pantryStore,
  groceryStore,

  selectMeals: (userId: string = "demo") => mealsStore.filter((m: any) => !m.userId || m.userId === userId),

  insertMeal: (meal: any) => {
    const newMeal = { ...meal, id: Date.now(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), userId: meal.userId || "demo" };
    mealsStore.push(newMeal);
    return newMeal;
  },

  selectPantry: (userId: string = "demo") => pantryStore.filter((p: any) => !p.userId || p.userId === userId),

  upsertPantryItem: (item: any) => {
    const idx = pantryStore.findIndex((p: any) => p.name.toLowerCase() === item.name.toLowerCase() && (!p.userId || p.userId === (item.userId || "demo")));
    if (idx !== -1) {
      pantryStore[idx] = { ...pantryStore[idx], ...item, lastUpdated: new Date().toISOString() };
      return pantryStore[idx];
    }
    const newItem = { ...item, id: Date.now(), createdAt: new Date().toISOString(), userId: item.userId || "demo" };
    pantryStore.push(newItem);
    return newItem;
  },

  selectGrocery: (userId: string = "demo") => groceryStore.filter((g: any) => !g.userId || g.userId === userId),

  upsertGroceryItem: (item: any) => {
    const idx = groceryStore.findIndex((g: any) => 
      g.name.toLowerCase() === item.name.toLowerCase() && 
      (!g.userId || g.userId === (item.userId || "demo")) &&
      !g.manualOverride
    );
    if (idx !== -1) {
      groceryStore[idx] = { ...groceryStore[idx], ...item, updatedAt: new Date().toISOString() };
      return groceryStore[idx];
    }
    const newItem = { 
      ...item, 
      id: Date.now(), 
      createdAt: new Date().toISOString(), 
      updatedAt: new Date().toISOString(),
      userId: item.userId || "demo",
      needed: item.needed !== false,
    };
    groceryStore.push(newItem);
    return newItem;
  },

  toggleGroceryOverride: (id: number, override: boolean) => {
    const item = groceryStore.find((g: any) => g.id === id);
    if (item) item.manualOverride = override;
    return item;
  },

  deleteGroceryItem: (id: number) => {
    const idx = groceryStore.findIndex((g: any) => g.id === id);
    if (idx !== -1) {
      groceryStore.splice(idx, 1);
      return true;
    }
    return false;
  }
};
