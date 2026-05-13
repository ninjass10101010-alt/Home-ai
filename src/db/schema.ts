import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const members = sqliteTable("members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  role: text("role").$type<"parent" | "child" | "other">().notNull(),
  emoji: text("emoji"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  time: text("time"), // HH:MM
  description: text("description"),
  memberId: integer("member_id").references(() => members.id),
  type: text("type").$type<"event" | "reminder">().notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const meals = sqliteTable("meals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  description: text("description"),
  nutrition: text("nutrition"), // json string
  recipeUrl: text("recipe_url"),
  memberId: integer("member_id").references(() => members.id),
  ingredients: text("ingredients"), // json array
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: text("due_date"), // YYYY-MM-DD
  priority: text("priority").$type<"low" | "medium" | "high">().notNull(),
  assignedTo: integer("assigned_to").references(() => members.id),
  status: text("status").$type<"pending" | "completed">().notNull(),
  recurring: integer("recurring", { mode: "boolean" }).notNull().default(false),
  frequency: text("frequency"), // daily, weekly, etc.
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const groceryItems = sqliteTable("grocery_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  quantity: text("quantity"),
  category: text("category"),
  priority: text("priority").$type<"low" | "medium" | "high">().notNull(),
  notes: text("notes"),
  status: text("status").$type<"needed" | "in_cart" | "purchased">().notNull(),
  addedBy: integer("added_by").references(() => members.id),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const pantryItems = sqliteTable("pantry_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  quantity: real("quantity").notNull(),
  unit: text("unit"),
  expiryDate: text("expiry_date"), // YYYY-MM-DD
  status: text("status").$type<"available" | "low" | "expired">().notNull(),
  addedBy: integer("added_by").references(() => members.id),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const schedules = sqliteTable("schedules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  time: text("time").notNull(), // HH:MM format (24-hour)
  days: text("days").notNull(), // JSON array of day names: ["mon", "tue", "wed"] or ["all"]
  memberId: integer("member_id").references(() => members.id),
  type: text("type").$type<"routine" | "reminder">().notNull(),
  icon: text("icon"),
  color: text("color").default("nori"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const emergencyContacts = sqliteTable("emergency_contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  relationship: text("relationship").$type<"parent" | "grandparent" | "other">().notNull(),
  isPrimary: integer("is_primary", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});