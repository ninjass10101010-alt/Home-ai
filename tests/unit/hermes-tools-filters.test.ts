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
      update: async (_id: string, d: any) => {
        updates.push({ collection: name, data: d });
        if (name === "consuela_data_snapshots") {
          const row = (rows[name] || []).find((x: any) => x.id === _id);
          if (row) row.data = d.data;
        }
        return { id: _id, ...d };
      },
      create: async (d: any) => {
        creates.push({ collection: name, data: d });
        if (name === "consuela_data_snapshots") {
          rows[name] = [{ id: "snap-new", key: "tasks-snapshot", data: d.data }];
          return { id: "snap-new", ...d };
        }
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

// Every real route hands the tool the live session caller. The tools fail
// CLOSED on a missing one, so each call states its adult caller explicitly
// and never leans on a default.
const parentCaller = {
  source: "hermes" as const,
  caller: { memberId: "mem-dad", name: "Dad", role: "parent" },
};

describe("hermes-tools — PB-side filters + batching", () => {
  it("complete_task never touches week_data — completions queue for parent approval", async () => {
    // The roster the completion is attributed to, and `universal: false` (what
    // the manage command writes for an assigned chore) — the canonical reader
    // treats a row without it as open.
    rows.members = [{ id: "mem-emily", name: "Emily", role: "child", emoji: "🎻" }];
    rows.consuela_data_snapshots = snap([{ id: 7, title: "Walk Rocco", completed: false, points: 10, assignee: "Emily", universal: false }]);
    const tool = getTool("complete_task")!;
    const out = JSON.parse(await tool.handler({ taskId: 7 }, parentCaller));
    expect(out.ok).toBe(true);
    expect(out.queuedForApproval).toBe(true);
    expect(calls.some((c) => c.collection === "week_data")).toBe(false);
    const write = updates.find((u) => u.collection === "consuela_data_snapshots")!;
    expect(write.data.data.tasks[0].pendingApproval).toBeTruthy();
  });

  it("a context-free tool call is never an adult actor", async () => {
    rows.members = [{ id: "mem-emily", name: "Emily", role: "child", emoji: "🎻" }];
    rows.consuela_data_snapshots = snap([]);
    const out = JSON.parse(await getTool("add_task")!.handler({ title: "Test chore", assigned_to: "Emily" }));
    expect(out).toMatchObject({ ok: false, reason: "adult_only" });
    expect(updates.find((u) => u.collection === "consuela_data_snapshots")).toBeUndefined();
  });

  it("add_grocery_item reads the grocery list ONCE for multiple items", async () => {
    rows.grocery_list_items = [];
    const tool = getTool("add_grocery_item")!;
    await tool.handler({ items: "milk, eggs, bread" }, parentCaller);
    const groceryReads = calls.filter((c) => c.collection === "grocery_list_items" && c.filter === undefined);
    expect(groceryReads.length).toBeLessThanOrEqual(1);
  });

  it("add_grocery_item dedupes repeated names within one call (second hit updates, not creates)", async () => {
    rows.grocery_list_items = [];
    const tool = getTool("add_grocery_item")!;
    await tool.handler({ items: "milk, milk" }, parentCaller);
    const groceryCreates = creates.filter((c) => c.collection === "grocery_list_items");
    expect(groceryCreates.length).toBe(1);
  });

  it("remove_event filters events by title (and date when given)", async () => {
    rows.events = [{ id: "e1", title: "Soccer practice", date: "2026-09-05" }];
    const tool = getTool("remove_event")!;
    await tool.handler({ title: "Soccer practice", date: "2026-09-05" }, parentCaller);
    const eventCall = calls.find((c) => c.collection === "events");
    expect(eventCall?.filter).toContain("title ~");
    expect(eventCall?.filter).toContain('date="2026-09-05"');
  });

  it("remove_event drops a malformed date instead of interpolating it into the filter", async () => {
    rows.events = [{ id: "e1", title: "Soccer practice", date: "2026-09-05" }];
    const tool = getTool("remove_event")!;
    await expect(tool.handler({ title: "Soccer practice", date: 'x"y' }, parentCaller)).resolves.toBeDefined();
    const eventCall = calls.find((c) => c.collection === "events");
    expect(eventCall?.filter).not.toContain("date=");
  });

  it("add_task writes the new chore to the snapshot the dashboard renders", async () => {
    rows.members = [{ id: "mem-emily", name: "Emily", fullName: "Emily", role: "child" }];
    rows.consuela_data_snapshots = snap([]);
    const tool = getTool("add_task")!;
    const out = JSON.parse(await tool.handler({ title: "Test chore", assigned_to: "Emily", points: 5 }, parentCaller));
    expect(out.ok).toBe(true);
    const write = updates.find((u) => u.collection === "consuela_data_snapshots")!;
    expect(write.data.data.tasks.map((t: any) => t.title)).toContain("Test chore");
  });
});
