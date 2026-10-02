// The three parent-gated writes added in Task 12: remove_grocery_item,
// remove_meal and create_time_capsule. Two contracts are load-bearing here —
// (1) a removal must REFUSE honestly when nothing matches instead of reporting
// a success it did not achieve, and (2) a child must not be able to reach any
// of them, both because the kid surface never lists them and because the
// handler re-checks the caller's live role and fails closed without one.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const GROCERY = "grocery_list_items";
const MEALS = "meal_plan_entries";
const CAPSULES = "time_capsules";
const CONTENTS = "capsule_contents";

const rows: Record<string, any[]> = {};
const writes: Array<{ op: string; collection: string; id?: string }> = [];
const failReads = new Set<string>();

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) =>
    fn({
      collection: (name: string) => ({
        getFullList: async () => {
          if (failReads.has(name)) throw new Error("pocketbase unreachable");
          return rows[name] ?? [];
        },
        getFirstListItem: async () => {
          throw new Error("404");
        },
        create: async (d: any) => {
          writes.push({ op: "create", collection: name });
          const row = { id: `${name}-new-${(rows[name] ?? []).length + 1}`, ...d };
          (rows[name] ??= []).push(row);
          return row;
        },
        update: async (id: string, d: any) => {
          writes.push({ op: "update", collection: name, id });
          const found = (rows[name] ?? []).find((r) => r.id === id);
          if (found) Object.assign(found, d);
          return found ?? { id, ...d };
        },
        delete: async (id: string) => {
          writes.push({ op: "delete", collection: name, id });
          rows[name] = (rows[name] ?? []).filter((r) => r.id !== id);
          return true;
        },
      }),
    }),
  ),
  getAuthedPB: vi.fn(async () => {
    throw new Error("unauthenticated read");
  }),
}));
vi.mock("@/lib/ha/websocket-client", () => ({ getHAWebSocketClient: vi.fn() }));
vi.mock("@/db", () => ({ db: new Proxy({}, { get: () => async () => [] }) }));

import { getTool, buildToolsForOpenAI } from "@/lib/hermes-tools";
import { localTodayISO } from "@/lib/local-date";
import { isoDateForWeekday, weekStartForDate } from "@/lib/meals-week-utils";

const PARENT = { source: "hermes" as const, caller: { memberId: "mem-dad", name: "Dad", role: "parent" } };
const KID = { source: "hermes" as const, caller: { memberId: "mem-emily", name: "Emily", role: "child" } };

/** Names the missing tool in the failure message instead of a bare TypeError,
 *  so a red baseline says which tool does not exist yet. */
async function runTool(name: string, args: Record<string, any> = {}, context?: any) {
  const tool = getTool(name);
  if (!tool) throw new Error(`TOOL DOES NOT EXIST: ${name}`);
  return JSON.parse(await tool.handler(args, context));
}

const grocery = () => rows[GROCERY] ?? [];
const meals = () => rows[MEALS] ?? [];
const capsules = () => rows[CAPSULES] ?? [];
const contentsFor = (id: string) => (rows[CONTENTS] ?? []).filter((c) => c.capsuleId === id);

beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k];
  writes.length = 0;
  failReads.clear();
  process.env.TZ = "America/Detroit";
});

const REAL_TZ = process.env.TZ;
afterEach(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

describe("remove_grocery_item", () => {
  it("removes by normalized name and refuses honestly on a miss", async () => {
    rows[GROCERY] = [{ id: "g1", name: "Whole Milk", needed: true }];
    const hit = await runTool("remove_grocery_item", { name: "whole milk" }, PARENT);
    expect(hit).toMatchObject({ ok: true, name: "Whole Milk", deleted: true });
    expect(grocery()).toHaveLength(0);

    const deletesBefore = writes.filter((w) => w.op === "delete").length;
    const miss = await runTool("remove_grocery_item", { name: "unicorn" }, PARENT);
    expect(miss.ok).toBe(false);
    expect(miss.deleted).toBeUndefined();
    expect(miss.error).toMatch(/get_grocery_list/);
    expect(writes.filter((w) => w.op === "delete")).toHaveLength(deletesBefore);
  });

  it("requires a name before touching the list", async () => {
    rows[GROCERY] = [{ id: "g1", name: "Whole Milk" }];
    const res = await runTool("remove_grocery_item", { name: "   " }, PARENT);
    expect(res.ok).toBe(false);
    expect(grocery()).toHaveLength(1);
  });

  it("refuses instead of guessing when the live list cannot be read", async () => {
    failReads.add(GROCERY);
    const res = await runTool("remove_grocery_item", { name: "Whole Milk" }, PARENT);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/do not guess inventory/i);
    expect(writes.some((w) => w.op === "delete")).toBe(false);
  });
});

describe("remove_meal", () => {
  const thisWeek = () => weekStartForDate(localTodayISO());
  const tueDate = () => isoDateForWeekday(thisWeek(), "Tue");

  it("deletes the planned row for a resolved day", async () => {
    rows[MEALS] = [
      { id: "m1", name: "Tacos", time: "Tue", mealType: "dinner", weekOf: thisWeek(), date: tueDate() },
      { id: "m2", name: "Leftovers", time: "Wed", mealType: "lunch", weekOf: thisWeek(), date: isoDateForWeekday(thisWeek(), "Wed") },
    ];
    const res = await runTool("remove_meal", { name: "Tacos", day: "Tue", mealType: "dinner" }, PARENT);
    expect(res.ok).toBe(true);
    expect(res.removed).toMatchObject({ name: "Tacos", day: "Tue", date: tueDate() });
    expect(meals().map((m) => m.id)).toEqual(["m2"]);
  });

  it("shares resolveMealDay with add_meal — the SAME row is the one that goes", async () => {
    const added = await runTool("add_meal", { name: "Pizza", day: "tue", mealType: "dinner" }, PARENT);
    expect(added.ok).toBe(true);
    const mealId = added.meal.id;
    expect(added.meal.date).toBe(tueDate());

    const removed = await runTool("remove_meal", { name: "Pizza", day: "tue", mealType: "dinner" }, PARENT);
    expect(removed.ok).toBe(true);
    expect(removed.removed.date).toBe(added.meal.date);
    expect(meals().some((m) => m.id === mealId)).toBe(false);
  });

  it("resolves an ISO day the same way add_meal does", async () => {
    rows[MEALS] = [{ id: "m1", name: "Pizza", time: "Sat", mealType: "dinner", weekOf: thisWeek(), date: isoDateForWeekday(thisWeek(), "Sat") }];
    const res = await runTool("remove_meal", { name: "Pizza", day: isoDateForWeekday(thisWeek(), "Sat") }, PARENT);
    expect(res.ok).toBe(true);
    expect(meals()).toHaveLength(0);
  });

  it("refuses an unresolvable day honestly", async () => {
    const res = await runTool("remove_meal", { name: "pizza", day: "Blursday" }, PARENT);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Mon\.\.Sun|YYYY-MM-DD/);
    expect(writes.some((w) => w.op === "delete")).toBe(false);
  });

  it("refuses an empty slot instead of claiming a deletion that did not happen", async () => {
    const res = await runTool("remove_meal", { name: "Pizza", day: "Tue" }, PARENT);
    expect(res.ok).toBe(false);
    expect(res.deleted).toBeUndefined();
    expect(res.error).toMatch(/get_weekly_meals/);
    expect(writes.some((w) => w.op === "delete")).toBe(false);
  });

  it("refuses when the slot holds a different meal", async () => {
    rows[MEALS] = [{ id: "m1", name: "Tacos", time: "Tue", mealType: "dinner", weekOf: thisWeek(), date: tueDate() }];
    const res = await runTool("remove_meal", { name: "Pizza", day: "Tue", mealType: "dinner" }, PARENT);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Tacos/);
    expect(res.error).toMatch(/Pizza/);
    expect(writes.some((w) => w.op === "delete")).toBe(false);
  });

  it("refuses instead of guessing when the meal read fails", async () => {
    failReads.add(MEALS);
    const res = await runTool("remove_meal", { name: "Pizza", day: "Tue" }, PARENT);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/do not guess meals/i);
  });
});

describe("create_time_capsule", () => {
  it("starts the capsule empty — contents are added on the page", async () => {
    const res = await runTool("create_time_capsule", { title: "Graduation", unlockDate: "2099-06-01" }, PARENT);
    expect(res.ok).toBe(true);
    expect(res.capsule.id).toBeTruthy();
    expect(res.capsule.status).toBe("locked");
    expect(contentsFor(res.capsule.id)).toEqual([]);
    expect(writes.some((w) => w.collection === CONTENTS)).toBe(false);
  });

  it("takes its creator from the verified caller, never from the model", async () => {
    const res = await runTool(
      "create_time_capsule",
      { title: "Graduation", unlockDate: "2099-06-01", createdBy: "Someone Else" },
      PARENT,
    );
    expect(res.ok).toBe(true);
    expect(capsules()[0].createdBy).toBe("Dad");
    expect(JSON.stringify(capsules()[0])).not.toContain("Someone Else");
  });

  it("is PRIVATE by default — the same default the Time Capsules form uses", async () => {
    // CreateCapsuleForm.tsx:24 is useState(false): the UI is private unless the
    // parent ticks "family wide", so a chat-created capsule matches what the
    // same action yields on the page. readUserCapsules lists `isFamilyWide = true`
    // to EVERY member, kids included, so the default is a visibility choice, not
    // a cosmetic one.
    const res = await runTool("create_time_capsule", { title: "Graduation", unlockDate: "2099-06-01" }, PARENT);
    expect(res.ok).toBe(true);
    expect(res.capsule.isFamilyWide).toBe(false);
    expect(capsules()[0].isFamilyWide).toBe(false);
  });

  it('a stringly-typed "false" stays private — the schema says boolean, models send strings', async () => {
    const res = await runTool(
      "create_time_capsule",
      { title: "For the twins", unlockDate: "2099-06-01", isFamilyWide: "false" },
      PARENT,
    );
    expect(res.ok).toBe(true);
    expect(res.capsule.isFamilyWide).toBe(false);
    expect(capsules()[0].isFamilyWide).toBe(false);
  });

  it("only a genuine yes widens — boolean true and the string \"true\"", async () => {
    for (const yes of [true, "true"]) {
      const res = await runTool(
        "create_time_capsule",
        { title: "Reunion", unlockDate: "2099-06-01", isFamilyWide: yes },
        PARENT,
      );
      expect(res.ok, String(yes)).toBe(true);
      expect(res.capsule.isFamilyWide, String(yes)).toBe(true);
    }
    expect(capsules().map((c) => c.isFamilyWide)).toEqual([true, true]);
  });

  it("a garbage value fails closed to private rather than widening", async () => {
    const res = await runTool(
      "create_time_capsule",
      { title: "Someday", unlockDate: "2099-06-01", isFamilyWide: "no thanks" },
      PARENT,
    );
    expect(res.ok).toBe(true);
    expect(res.capsule.isFamilyWide).toBe(false);
    expect(capsules()[0].isFamilyWide).toBe(false);
  });

  it("fails closed on a past unlock date", async () => {
    for (const unlockDate of ["2020-01-01", localTodayISO()]) {
      const res = await runTool("create_time_capsule", { title: "Old", unlockDate }, PARENT);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/future/i);
    }
    expect(capsules()).toHaveLength(0);
  });

  it("refuses an unlock date that is not an ISO calendar date", async () => {
    const res = await runTool("create_time_capsule", { title: "Someday", unlockDate: "next summer" }, PARENT);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/YYYY-MM-DD/);
    expect(capsules()).toHaveLength(0);
  });

  it("requires a title", async () => {
    const res = await runTool("create_time_capsule", { title: "  ", unlockDate: "2099-06-01" }, PARENT);
    expect(res.ok).toBe(false);
    expect(capsules()).toHaveLength(0);
  });

  it("refuses rather than filing the capsule under the legacy demo namespace", async () => {
    const res = await runTool(
      "create_time_capsule",
      { title: "Graduation", unlockDate: "2099-06-01" },
      { source: "hermes", caller: { memberId: "mem-dad", name: "   ", role: "parent" } },
    );
    expect(res.ok).toBe(false);
    expect(capsules()).toHaveLength(0);
  });
});

describe("the kid gate on all three writes", () => {
  const CASES: Array<[string, Record<string, any>]> = [
    ["remove_grocery_item", { name: "Whole Milk" }],
    ["remove_meal", { name: "Pizza", day: "Tue" }],
    ["create_time_capsule", { title: "Graduation", unlockDate: "2099-06-01" }],
  ];

  it("every one of them refuses a child caller", async () => {
    rows[GROCERY] = [{ id: "g1", name: "Whole Milk" }];
    rows[MEALS] = [{ id: "m1", name: "Pizza", time: "Tue", mealType: "dinner", weekOf: weekStartForDate(localTodayISO()) }];
    for (const [name, args] of CASES) {
      const res = await runTool(name, args, KID);
      expect(res.reason, name).toBe("adult_only");
      expect(res.ok, name).toBe(false);
    }
    expect(grocery()).toHaveLength(1);
    expect(meals()).toHaveLength(1);
    expect(capsules()).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it("a guest, a pet, a blank role and a missing caller are all refused (fail closed)", async () => {
    const nonAdults = [
      { source: "hermes", caller: { memberId: "m", name: "Guest", role: "guest" } },
      { source: "hermes", caller: { memberId: "m", name: "Rocco", role: "pet" } },
      { source: "hermes", caller: { memberId: "m", name: "Blank", role: "" } },
      { source: "hermes", caller: { memberId: "m", name: "Nobody", role: "admin" } },
      { source: "hermes" },
      undefined,
    ];
    for (const context of nonAdults) {
      for (const [name, args] of CASES) {
        const res = await runTool(name, args, context);
        expect(res.reason, `${name} / ${JSON.stringify(context?.caller ?? null)}`).toBe("adult_only");
      }
    }
    expect(writes).toHaveLength(0);
  });

  it("none of the three is offered to a child session", () => {
    const kidNames = buildToolsForOpenAI({ role: "child" }).map((t) => t.function.name);
    for (const [name] of CASES) expect(kidNames, name).not.toContain(name);
    const parentNames = buildToolsForOpenAI({ role: "parent" }).map((t) => t.function.name);
    for (const [name] of CASES) expect(parentNames, name).toContain(name);
  });
});
