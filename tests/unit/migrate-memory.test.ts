import { describe, it, expect } from "vitest";
import { planMigration } from "@/lib/memory-migration";

const rows = [
  { id: "1", key: "when_adding_meals_include_an_emoji_default_unless_", category: "preference", content: "When adding meals, include an emoji (default 🍽️) unless a different one is specified.", tags: "[]" },
  { id: "2", key: "when_creating_a_meal_select_the_best_emoji_for_the", category: "preference", content: "When creating a meal, select the best emoji for the meal (e.g. 🍗 for chicken) unless a different one is specified.", tags: "[]" },
  { id: "3", key: "user_user_prefers_soup_emojis_for_dinner_meals", category: "preference", content: "User prefers soup emojis (🍲) for dinner meals", tags: "[\"User\"]" },
  { id: "4", key: "user_prefers_that_when_adding_meals_we_use_a_relev", category: "preference", content: "User prefers that when adding meals, we use a relevant emoji that matches the meal (e.g. 🍗 for chicken) rather than default soup emoji.", tags: "[]" },
  { id: "5", key: "the_parents_maintain_the_grocery_shopping_list_the", category: "routine", content: "The parents maintain the grocery shopping list themselves and update it directly, so Consuela should not add grocery items unless explicitly asked.", tags: "[]" },
  { id: "6", key: "emily_garcia_emily_garcia_is_11_years_old_born_app", category: "note", content: "Emily Garcia is 11 years old (born approximately 2015)", tags: "[\"Emily Garcia\"]" },
];

describe("planMigration", () => {
  it("collapses the four emoji rows into ONE playbook", () => {
    const plan = planMigration(rows);
    const playbook = plan.playbooks.find((p) => p.slug === "meals.add_meal");
    expect(playbook).toBeTruthy();
    expect(playbook?.body).toContain("relevant emoji");
    expect(plan.facts.some((f) => f.id === "1")).toBe(false);
    expect(plan.facts.some((f) => f.id === "4")).toBe(false);
  });

  it("turns the grocery rule into a playbook", () => {
    const plan = planMigration(rows);
    expect(plan.playbooks.find((p) => p.domain === "grocery")).toBeTruthy();
  });

  it("keeps a family fact as a fact with its person", () => {
    const plan = planMigration(rows);
    const fact = plan.facts.find((f) => f.id === "6");
    expect(fact).toBeTruthy();
    expect(fact?.person).toBe("Emily Garcia");
    expect(fact?.key).toBe("note_emily_garcia_age");
  });

  it("is idempotent — planning twice gives the same result", () => {
    expect(planMigration(rows)).toEqual(planMigration(rows));
  });
});
