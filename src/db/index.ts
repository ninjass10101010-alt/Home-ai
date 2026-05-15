// Use a simple in-memory approach for now until Bun SQLite types are available
// const sqlite = new Database("sqlite.db");

// Seed data for demonstration - in production this would be user-managed
const membersData = [
  { id: 1, name: "Sarah (Mom)", role: "parent", emoji: "👩", fullName: "Sarah Johnson", age: 38, joined: "Feb 2024" },
  { id: 2, name: "Mike (Dad)", role: "parent", emoji: "👨", fullName: "Mike Johnson", age: 40, joined: "Feb 2024" },
  { id: 3, name: "Jake", role: "child", emoji: "🧒", fullName: "Jake Johnson", age: 12, joined: "Mar 2024" },
  { id: 4, name: "Lily", role: "child", emoji: "👧", fullName: "Lily Johnson", age: 9, joined: "Mar 2024" },
];

const eventsData = [
  {
    id: 1,
    title: "Soccer Practice",
    date: new Date().toISOString().split('T')[0], // Today
    time: "16:00",
    memberId: 3,
    type: "event",
    description: "Jake's soccer practice at the field",
  },
  {
    id: 2,
    title: "Dentist — Lily",
    date: new Date().toISOString().split('T')[0], // Today
    time: "17:30",
    memberId: 4,
    type: "event",
    description: "Lily's regular checkup",
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
    assignedTo: 3, // Jake
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
    assignedTo: 4, // Lily
    status: "completed",
    recurring: true,
    frequency: "weekly",
  },
];

const schedulesData = [
  {
    id: 1,
    title: "Lunch",
    time: "12:00",
    days: "all",
    type: "routine",
    icon: "🍽️",
    color: "amber",
  },
  {
    id: 2,
    title: "Emily bedtime",
    time: "21:00",
    days: "all",
    memberId: 4, // Lily
    type: "routine",
    icon: "🧒",
    color: "violet",
  },
  {
    id: 3,
    title: "Family movie night",
    time: "19:30",
    days: "friday",
    type: "routine",
    icon: "🎬",
    color: "nori",
  },
  {
    id: 4,
    title: "Take medication",
    time: "08:00",
    days: "all",
    memberId: 1, // Mom
    type: "reminder",
    icon: "💊",
    color: "rose",
  },
];

const emergencyContactsData = [
  {
    id: 1,
    name: "Emergency Contact 1",
    phone: "+15551234567", // Replace with real phone number (E.164 format: +1XXXXXXXXXX)
    email: "emergency1@example.com", // Replace with real email
    relationship: "parent" as const,
    isPrimary: true,
  },
  {
    id: 2,
    name: "Emergency Contact 2",
    phone: "+15552345678", // Replace with real phone number (E.164 format: +1XXXXXXXXXX)
    email: "emergency2@example.com", // Replace with real email
    relationship: "parent" as const,
    isPrimary: true,
  },
];

// Mock database interface - replace with real Drizzle queries later
// In-memory storage for demo purposes
let membersStore = [...membersData];

export const db = {
  // Members - basic view for dashboard
  selectMembers: () => membersStore.map(m => ({
    id: m.id,
    name: m.name.split(' ')[0], // Just first name for dashboard
    color: m.id === 1 ? "green" : m.id === 2 ? "cyan" : m.id === 3 ? "violet" : "amber",
    emoji: m.emoji,
  })),

  // Members - detailed view for settings
  selectMembersDetailed: () => membersStore.map(m => ({
    name: m.name,
    role: m.role === 'parent' ? 'Parent' : 'Child',
    emoji: m.emoji,
    color: m.id === 1 ? "green" : m.id === 2 ? "cyan" : m.id === 3 ? "violet" : "amber",
    age: m.age.toString(),
    joined: m.joined,
  })),

  // Members - calendar filter view (includes "All" option)
  selectMembersForCalendar: () => [
    { name: "All", color: "green", emoji: "👨‍👩‍👧‍👦" },
    ...membersStore.map(m => ({
      name: m.name.split(' ')[0], // Just first name
      color: m.id === 1 ? "green" : m.id === 2 ? "cyan" : m.id === 3 ? "violet" : "amber",
      emoji: m.emoji,
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
    membersStore.push(newMember);
    return newMember;
  },

  // Update existing member
  updateMember: (name: string, updates: Partial<typeof membersData[0]>) => {
    const index = membersStore.findIndex(m => m.name === name);
    if (index !== -1) {
      membersStore[index] = { ...membersStore[index], ...updates };
      return membersStore[index];
    }
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
      .map(event => {
        const member = membersData.find(m => m.id === event.memberId);
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
        const member = membersData.find(m => m.id === task.assignedTo);
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

  // Today's schedules
  selectTodaysSchedules: () => {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase(); // 'mon', 'tue', etc.
    return schedulesData
      .filter(schedule => schedule.days === 'all' || schedule.days.includes(today))
      .map(schedule => {
        const member = schedule.memberId ? membersData.find(m => m.id === schedule.memberId) : null;
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
      })
      .sort((a, b) => a.time.localeCompare(b.time)); // Sort by time
  },

  // Emergency contacts (existing)
  select: () => ({
    from: () => ({
      where: () => ({
        execute: () => emergencyContactsData
      })
    })
  })
};