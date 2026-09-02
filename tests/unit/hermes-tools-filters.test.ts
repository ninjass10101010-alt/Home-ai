import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: Array<{ collection: string; filter?: string }> = [];
const creates: Array<{ collection: string; data: any }> = [];
const rows: Record<string, any[]> = {};

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) => fn({
    collection: (name: string) => ({
      getFullList: async (opts: any) => {
        calls.push({ collection: name, filter: opts?.filter });
        return rows[name] ?? [];
      },
      update: async (_id: string, d: any) => ({ id: _id, ...d }),
      create: async (d: any) => {
        creates.push({ collection: name, data: d });
        return { id: `new-${creates.length}`, ...d };
      },
      delete: async () => true,
    }),
  })),
}));

vi.mock("@/db", () => ({
  db: {
    selectTodaysEvents: () => [], selectPendingTasks: () => [], selectPantry: () => [],
    selectGrocery: () => [], selectMeals: () => [], selectRecipes: () => [],
    selectMembers: () => [], selectTodaysSchedulesRaw: () => [],
  },
}));

import { getTool } from "@/lib/hermes-tools";

beforeEach(() => {
  calls.length = 0;
  creates.length = 0;
  for (const k of Object.keys(rows)) delete rows[k];
});

describe("hermes-tools — PB-side filters + batching", () => {
  it("complete_task reads week_data filtered to the current week", async () => {
    rows.tasks = [{ id: "t1", taskId: 7, title: "Walk Rocco", status: "pending", points: 10, assignee: "Emily" }];
    rows.week_data = [];
    const tool = getTool("complete_task")!;
    await tool.handler({ taskId: 7 });
    const weekCall = calls.find((c) => c.collection === "week_data");
    expect(weekCall?.filter).toContain("weekStart=");
  });

  it("add_grocery_item reads the grocery list ONCE for multiple items", async () => {
    rows.grocery_list_items = [];
    const tool = getTool("add_grocery_item")!;
    await tool.handler({ items: "milk, eggs, bread" });
    const groceryReads = calls.filter((c) => c.collection === "grocery_list_items" && c.filter === undefined);
    expect(groceryReads.length).toBeLessThanOrEqual(1);
  });

  it("add_grocery_item dedupes repeated names within one call (second hit updates, not creates)", async () => {
    rows.grocery_list_items = [];
    const tool = getTool("add_grocery_item")!;
    await tool.handler({ items: "milk, milk" });
    const groceryCreates = creates.filter((c) => c.collection === "grocery_list_items");
    expect(groceryCreates.length).toBe(1);
  });

  it("remove_event filters events by title (and date when given)", async () => {
    rows.events = [{ id: "e1", title: "Soccer practice", date: "2026-09-05" }];
    const tool = getTool("remove_event")!;
    await tool.handler({ title: "Soccer practice", date: "2026-09-05" });
    const eventCall = calls.find((c) => c.collection === "events");
    expect(eventCall?.filter).toContain("title ~");
    expect(eventCall?.filter).toContain('date="2026-09-05"');
  });

  it("add_task upserts with a taskId filter (no full tasks scan)", async () => {
    rows.tasks = [];
    const tool = getTool("add_task")!;
    await tool.handler({ title: "Test chore", assigned_to: "Emily", points: 5 });
    const taskReads = calls.filter((c) => c.collection === "tasks");
    expect(taskReads.length).toBeGreaterThan(0);
    for (const c of taskReads) {
      expect(c.filter).toContain("taskId=");
    }
  });
});
