import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: Array<{ collection: string; filter?: string }> = [];
const creates: Array<{ collection: string; data: any }> = [];
const updates: Array<{ collection: string; data: any }> = [];
const rows: Record<string, any[]> = {};

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) => fn({
    collection: (name: string) => ({
      getFullList: async (opts: any) => {
        calls.push({ collection: name, filter: opts?.filter });
        return rows[name] ?? [];
      },
      update: async (_id: string, d: any) => { updates.push({ collection: name, data: d }); return { id: _id, ...d }; },
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
  updates.length = 0;
  for (const k of Object.keys(rows)) delete rows[k];
});

const snap = (tasks: any[]) => ([{
  id: "snap1", key: "tasks-snapshot",
  data: { tasks, weekData: { weekStart: "2026-09-21", points: {}, history: [] }, deletedTaskIds: [] },
}]);

describe("hermes-tools — PB-side filters + batching", () => {
  it("complete_task never touches week_data — completions queue for parent approval", async () => {
    rows.consuela_data_snapshots = snap([{ id: 7, title: "Walk Rocco", completed: false, points: 10, assignee: "Emily" }]);
    const tool = getTool("complete_task")!;
    const out = JSON.parse(await tool.handler({ taskId: 7 }));
    expect(out.ok).toBe(true);
    expect(out.queuedForApproval).toBe(true);
    expect(calls.some((c) => c.collection === "week_data")).toBe(false);
    const write = updates.find((u) => u.collection === "consuela_data_snapshots")!;
    expect(write.data.data.tasks[0].pendingApproval).toBeTruthy();
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

  it("remove_event drops a malformed date instead of interpolating it into the filter", async () => {
    rows.events = [{ id: "e1", title: "Soccer practice", date: "2026-09-05" }];
    const tool = getTool("remove_event")!;
    await expect(tool.handler({ title: "Soccer practice", date: 'x"y' })).resolves.toBeDefined();
    const eventCall = calls.find((c) => c.collection === "events");
    expect(eventCall?.filter).not.toContain("date=");
  });

  it("add_task writes the new chore to the snapshot the dashboard renders", async () => {
    rows.members = [{ name: "Emily", fullName: "Emily" }];
    rows.consuela_data_snapshots = snap([]);
    const tool = getTool("add_task")!;
    const out = JSON.parse(await tool.handler({ title: "Test chore", assigned_to: "Emily", points: 5 }));
    expect(out.ok).toBe(true);
    const write = updates.find((u) => u.collection === "consuela_data_snapshots")!;
    expect(write.data.data.tasks.map((t: any) => t.title)).toContain("Test chore");
  });
});
