import { describe, it, expect, vi, beforeEach } from "vitest";
const rows: Record<string, any[]> = {};
const writes: Array<{ op: string; collection: string; id?: string; data?: any }> = [];
vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) => fn({
    collection: (name: string) => ({
      getFullList: async () => rows[name] ?? [],
      getFirstListItem: async () => { throw new Error("404"); },
      update: async (id: string, d: any) => { writes.push({ op: "update", collection: name, id, data: d }); return { id, ...d }; },
      create: async (d: any) => { writes.push({ op: "create", collection: name, data: d }); return { id: "n1", ...d }; },
      delete: async (id: string) => { writes.push({ op: "delete", collection: name, id }); return true; },
    }),
  })),
}));
vi.mock("@/db", () => ({ db: new Proxy({}, { get: () => async () => [] }) }));
import { getTool } from "@/lib/hermes-tools";

beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k];
  writes.length = 0;
  rows.members = [{ name: "Emily", fullName: "Emily G", role: "child", emoji: "🎻" }];
});

it("compare_grocery_prices reports the REAL store split, invents no prices", async () => {
  rows.grocery_list_items = [
    { name: "Milk", needed: true, store: "aldi" }, { name: "Bread", needed: true, store: "meijer" }, { name: "Chips", needed: true },
  ];
  const out = JSON.parse(await getTool("compare_grocery_prices")!.handler({}));
  expect(JSON.stringify(out).toLowerCase()).toContain("aldi");
  expect(String(out.message || "") + JSON.stringify(out)).not.toMatch(/estimat|price/i);
});
it("add_pantry_item upserts by name", async () => {
  rows.pantry_items = [{ id: "p1", name: "Rice", status: "low" }];
  const out = JSON.parse(await getTool("add_pantry_item")!.handler({ name: "rice", status: "plenty" }));
  expect(out.ok).toBe(true);
  expect(writes.some((w) => w.op === "update" && w.collection === "pantry_items" && w.data.status === "plenty")).toBe(true);
});
it("add_pantry_item creates when absent", async () => {
  rows.pantry_items = [];
  await getTool("add_pantry_item")!.handler({ name: "Soy sauce", status: "out", category: "condiments" });
  expect(writes.some((w) => w.op === "create" && w.collection === "pantry_items" && w.data.name === "Soy sauce")).toBe(true);
});
it("get_family_routines returns weekly view with day scope", async () => {
  rows.schedules = [{ id: "s1", title: "Bedtime", time: "8:00 PM", days: "weekdays", type: "routine" }];
  const out = JSON.parse(await getTool("get_family_routines")!.handler({}));
  expect(out.routines[0].title).toBe("Bedtime");
});
it("add_schedule_item writes the post-2026-09-08 row shape", async () => {
  await getTool("add_schedule_item")!.handler({ title: "Homework", time: "5:30 PM", days: "weekdays" });
  const w = writes.find((x) => x.op === "create" && x.collection === "schedules");
  expect(w!.data).toMatchObject({ title: "Homework", time: "5:30 PM", days: "weekdays" });
});
it("get_past_weeks reads week_archive", async () => {
  rows.week_archive = [{ weekStart: "2026-08-31", points: JSON.stringify({ "Emily G": 42 }), archivedAt: "2026-09-07" }];
  const out = JSON.parse(await getTool("get_past_weeks")!.handler({}));
  expect(out.weeks[0].champion).toBe("Emily G");
});
it("get_rewards lists the shop", async () => {
  rows.rewards = [{ id: "r1", title: "Movie Night", cost: 60, emoji: "🎬" }];
  const out = JSON.parse(await getTool("get_rewards")!.handler({}));
  expect(JSON.stringify(out)).toContain("Movie Night");
});
it("add_pantry_item carries quantity+unit (decrement-on-use = set the new quantity)", async () => {
  rows.pantry_items = [{ id: "p1", name: "Milk", status: "plenty", quantity: 2, unit: "gal" }];
  await getTool("add_pantry_item")!.handler({ name: "Milk", status: "low", quantity: 1, unit: "gal" });
  const w = writes.find((x) => x.op === "update" && x.collection === "pantry_items")!;
  expect(w.data).toMatchObject({ quantity: 1, unit: "gal", status: "low" });
});
it("remove_pantry_item deletes by name", async () => {
  rows.pantry_items = [{ id: "p1", name: "Old Junk" }];
  const out = JSON.parse(await getTool("remove_pantry_item")!.handler({ name: "Old Junk" }));
  expect(out.ok).toBe(true);
  expect(writes.some((w) => w.op === "delete" && w.collection === "pantry_items" && w.id === "p1")).toBe(true);
});
it("update_schedule_item patches time/days and echoes before/after", async () => {
  rows.schedules = [{ id: "s1", title: "Bedtime", time: "8:00 PM", days: "weekdays" }];
  const out = JSON.parse(await getTool("update_schedule_item")!.handler({ title: "Bedtime", time: "8:30 PM" }));
  expect(out.ok).toBe(true);
  expect(out.before.time).toBe("8:00 PM");
  expect(out.after.time).toBe("8:30 PM");
});
it("delete_schedule_item removes by title", async () => {
  rows.schedules = [{ id: "s1", title: "Old Routine", time: "7:00 AM", days: "daily" }];
  const out = JSON.parse(await getTool("delete_schedule_item")!.handler({ title: "Old Routine" }));
  expect(out.ok).toBe(true);
  expect(writes.some((w) => w.op === "delete" && w.collection === "schedules" && w.id === "s1")).toBe(true);
});
