// Task 13: adult recipe WRITE tools. add_recipe must honor the storage
// contract from the 2026-08-31 audit — ingredients/tags are JSON.stringify'd
// arrays before the PB write (direct curl without stringify LOOKS like data
// loss but isn't; the UI path stringifies, so we do the same).
// recipe_ingredients_to_grocery matches the catalog by exact-lowercase name,
// skips what the live pantry or live grocery already has (normalizeGroceryName),
// and creates grocery rows in the same shape add_grocery_item uses.
// Fix wave: an unreadable pantry/grocery read ABORTS (no degraded skip-set),
// repeated ingredients dedupe before the write loop (never an update against
// the synthetic in-call row), and pantry rows with status "out" are NOT stocked.
import { describe, it, expect, vi, beforeEach } from "vitest";
const rows: Record<string, any[]> = {};
const failCollections = new Set<string>();
const writes: Array<{ op: string; collection: string; id?: string; data?: any }> = [];
vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) => fn({
    collection: (name: string) => ({
      getFullList: async () => {
        if (failCollections.has(name)) throw new Error("PB down");
        return rows[name] ?? [];
      },
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
  failCollections.clear();
  writes.length = 0;
});

describe("add_recipe", () => {
  it("add_recipe creates in the recipes collection", async () => {
    const out = JSON.parse(await getTool("add_recipe")!.handler({
      name: "Baked Ziti", ingredients: "ziti, marinara, mozzarella", tags: "Kid-friendly", prepTime: "45 min", servings: 8,
    }));
    expect(out.ok).toBe(true);
    const w = writes.find((x) => x.op === "create" && x.collection === "recipes")!;
    expect(w.data.name).toBe("Baked Ziti");
    expect(JSON.parse(w.data.ingredients).length).toBe(3);
    expect(JSON.parse(w.data.tags)).toEqual(["Kid-friendly"]);
  });
  it("add_recipe refuses a nameless/ingredientless recipe with zero writes", async () => {
    const noName = JSON.parse(await getTool("add_recipe")!.handler({ name: "  ", ingredients: "a" }));
    expect(noName.ok).toBe(false);
    const noIngs = JSON.parse(await getTool("add_recipe")!.handler({ name: "Mystery", ingredients: " , " }));
    expect(noIngs.ok).toBe(false);
    expect(writes).toHaveLength(0);
  });
  it("add_recipe omits null/blank/zero/negative servings and calories instead of coercing to 0", async () => {
    for (const bad of [null, "", 0, -5, "abc"]) {
      writes.length = 0;
      const out = JSON.parse(await getTool("add_recipe")!.handler({
        name: "Soup", ingredients: "broth", servings: bad, calories: bad,
      }));
      expect(out.ok).toBe(true);
      const w = writes.find((x) => x.op === "create" && x.collection === "recipes")!;
      expect("servings" in w.data, `servings=${JSON.stringify(bad)}`).toBe(false);
      expect("calories" in w.data, `calories=${JSON.stringify(bad)}`).toBe(false);
    }
  });
  it("add_recipe keeps positive servings and calories as numbers", async () => {
    const out = JSON.parse(await getTool("add_recipe")!.handler({
      name: "Soup", ingredients: "broth", servings: 6, calories: 240,
    }));
    expect(out.ok).toBe(true);
    const w = writes.find((x) => x.op === "create" && x.collection === "recipes")!;
    expect(w.data.servings).toBe(6);
    expect(w.data.calories).toBe(240);
  });
});

describe("recipe_ingredients_to_grocery", () => {
  it("recipe_ingredients_to_grocery adds only the missing items", async () => {
    rows.recipes = [{ id: "r1", name: "Tacos", ingredients: JSON.stringify(["tortillas", "beef", "cheese"]), tags: "[]" }];
    rows.pantry_items = [{ name: "Cheese", status: "plenty" }, { name: "Tortillas", status: "plenty" }];
    rows.grocery_list_items = [];
    const out = JSON.parse(await getTool("recipe_ingredients_to_grocery")!.handler({ recipe: "Tacos" }));
    expect(out.inserted).toBe(1);
    expect(JSON.stringify(out.items)).toContain("beef");
    expect(JSON.stringify(out.items)).not.toContain("tortillas");
    const w = writes.find((x) => x.op === "create" && x.collection === "grocery_list_items")!;
    expect(w.data.name).toBe("beef");
    expect(w.data.source).toBe("chat");
    expect(w.data.userId).toBe("demo");
  });
  it("matches exact-lowercase name and skips items already on the grocery list", async () => {
    rows.recipes = [{ id: "r1", name: "Tacos", ingredients: JSON.stringify(["Tortillas", "Ground Beef"]), tags: "[]" }];
    rows.pantry_items = [];
    rows.grocery_list_items = [{ name: "ground beef", needed: true }];
    const out = JSON.parse(await getTool("recipe_ingredients_to_grocery")!.handler({ recipe: "tacos" }));
    expect(out.ok).toBe(true);
    expect(out.inserted).toBe(1);
    expect(out.skipped_in_pantry_or_list).toBe(1);
    expect(writes.filter((x) => x.op === "create" && x.collection === "grocery_list_items")).toHaveLength(1);
  });
  it("unknown recipe → honest not-found, no writes", async () => {
    rows.recipes = []; rows.pantry_items = []; rows.grocery_list_items = [];
    const out = JSON.parse(await getTool("recipe_ingredients_to_grocery")!.handler({ recipe: "Squid Ink Risotto" }));
    expect(out.ok).toBe(false);
    expect(out.error).toContain("not found");
    expect(writes).toHaveLength(0);
  });
  it("aborts with ok:false and zero writes when the pantry read fails (no degraded skip-set)", async () => {
    rows.recipes = [{ id: "r1", name: "Tacos", ingredients: JSON.stringify(["tortillas", "beef"]), tags: "[]" }];
    rows.grocery_list_items = [];
    failCollections.add("pantry_items");
    const out = JSON.parse(await getTool("recipe_ingredients_to_grocery")!.handler({ recipe: "Tacos" }));
    expect(out.ok).toBe(false);
    expect(out.error).toContain("unavailable");
    expect(out.error).toContain("do not guess");
    expect(writes.filter((x) => x.op === "create")).toHaveLength(0);
  });
  it("aborts the same way when the grocery read fails", async () => {
    rows.recipes = [{ id: "r1", name: "Tacos", ingredients: JSON.stringify(["tortillas", "beef"]), tags: "[]" }];
    rows.pantry_items = [];
    failCollections.add("grocery_list_items");
    const out = JSON.parse(await getTool("recipe_ingredients_to_grocery")!.handler({ recipe: "Tacos" }));
    expect(out.ok).toBe(false);
    expect(out.error).toContain("unavailable");
    expect(writes.filter((x) => x.op === "create")).toHaveLength(0);
  });
  it("dedupes ingredients sharing a normalized name — ONE create, no update against the synthetic in-call row", async () => {
    rows.recipes = [{ id: "r1", name: "Pancakes", ingredients: JSON.stringify(["Milk", "milk!"]), tags: "[]" }];
    rows.pantry_items = [];
    rows.grocery_list_items = [];
    const out = JSON.parse(await getTool("recipe_ingredients_to_grocery")!.handler({ recipe: "Pancakes" }));
    expect(out.ok).toBe(true);
    expect(out.inserted).toBe(1);
    expect(writes.filter((x) => x.op === "create" && x.collection === "grocery_list_items")).toHaveLength(1);
    expect(writes.filter((x) => x.op === "update")).toHaveLength(0);
  });
  it("out-of-stock pantry rows are NOT stocked — the ingredient still lands on the list", async () => {
    rows.recipes = [{ id: "r1", name: "Omelette", ingredients: JSON.stringify(["eggs"]), tags: "[]" }];
    rows.pantry_items = [{ name: "Eggs", status: "out" }];
    rows.grocery_list_items = [];
    const out = JSON.parse(await getTool("recipe_ingredients_to_grocery")!.handler({ recipe: "Omelette" }));
    expect(out.ok).toBe(true);
    expect(out.inserted).toBe(1);
    expect(out.items).toEqual(["eggs"]);
    expect(out.skipped_in_pantry_or_list).toBe(0);
    expect(out.note).toContain("1 missing ingredient");
    const w = writes.find((x) => x.op === "create" && x.collection === "grocery_list_items")!;
    expect(w.data.name).toBe("eggs");
  });
  it("plenty and low pantry rows still count as stocked (skipped)", async () => {
    rows.recipes = [{ id: "r1", name: "Quesadilla", ingredients: JSON.stringify(["cheese", "tortillas"]), tags: "[]" }];
    rows.pantry_items = [{ name: "Cheese", status: "low" }, { name: "Tortillas", status: "plenty" }];
    rows.grocery_list_items = [];
    const out = JSON.parse(await getTool("recipe_ingredients_to_grocery")!.handler({ recipe: "Quesadilla" }));
    expect(out.ok).toBe(true);
    expect(out.inserted).toBe(0);
    expect(out.skipped_in_pantry_or_list).toBe(2);
    expect(writes).toHaveLength(0);
  });
});
