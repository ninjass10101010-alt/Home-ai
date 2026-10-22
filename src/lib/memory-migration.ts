/**
 * The one-time migration of the memory bank (2026-10-21).
 *
 * Today's bank holds four rows for one emoji rule — the symptom of a key
 * derived from the content. The migration re-keys every row to a SUBJECT,
 * collapses the emoji rows into ONE playbook, and turns the two prompt-style
 * rows into playbooks. It is idempotent and dry-run by default.
 */

export interface MigrationFact {
  id: string;
  key: string;
  category: string;
  content: string;
  person: string;
  scope: string;
}

export interface MigrationPlaybook {
  slug: string;
  title: string;
  domain: string;
  trigger: string;
  body: string;
  fromIds: string[];
}

export interface MigrationPlan {
  facts: MigrationFact[];
  playbooks: MigrationPlaybook[];
  archived: Array<{ id: string; reason: string }>;
}

const EMOJI_ROWS = [
  "when_adding_meals_include_an_emoji_default_unless_",
  "when_creating_a_meal_select_the_best_emoji_for_the",
  "user_user_prefers_soup_emojis_for_dinner_meals",
  "user_prefers_that_when_adding_meals_we_use_a_relev",
];

export function planMigration(rows: Array<{ id: string; key: string; category: string; content: string; tags: string }>): MigrationPlan {
  const facts: MigrationFact[] = [];
  const playbooks: MigrationPlaybook[] = [];
  const archived: Array<{ id: string; reason: string }> = [];

  const emojiRows = rows.filter((r) => EMOJI_ROWS.includes(r.key));
  const newestEmoji = emojiRows[emojiRows.length - 1];
  if (newestEmoji) {
    playbooks.push({
      slug: "meals.add_meal",
      title: "Attach a relevant meal emoji",
      domain: "meals",
      trigger: "add_meal",
      body: newestEmoji.content,
      fromIds: emojiRows.map((r) => r.id),
    });
    for (const row of emojiRows) {
      if (row.id === newestEmoji.id) continue;
      archived.push({ id: row.id, reason: "folded into meals.add_meal" });
    }
  }

  for (const row of rows) {
    if (emojiRows.some((e) => e.id === row.id)) continue;

    // The grocery rule is a procedure, not a fact.
    if (/grocery shopping list/i.test(row.content)) {
      playbooks.push({
        slug: "grocery.add_item",
        title: "Do not add grocery items unless asked",
        domain: "grocery",
        trigger: "add_grocery_item",
        body: row.content,
        fromIds: [row.id],
      });
      archived.push({ id: row.id, reason: "became the grocery.add_item playbook" });
      continue;
    }

    // The meal-plan verification rule is a procedure too.
    if (/meal plan/i.test(row.content) && /weekOf|stale/i.test(row.content)) {
      playbooks.push({
        slug: "meals.report_plan",
        title: "Verify the week before reporting the meal plan",
        domain: "meals",
        trigger: "report_meal_plan",
        body: row.content,
        fromIds: [row.id],
      });
      archived.push({ id: row.id, reason: "became the meals.report_plan playbook" });
      continue;
    }

    const person = (() => {
      try {
        const parsed = JSON.parse(row.tags || "[]");
        return Array.isArray(parsed) && parsed.length ? String(parsed[0]) : "";
      } catch {
        return "";
      }
    })();

    const isAge = /(\d+)\s+years old/i.test(row.content);
    const key = isAge && person
      ? `note_${person.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_age`
      : `${row.category}_${row.key}`.slice(0, 50);

    facts.push({
      id: row.id,
      key,
      category: row.category,
      content: row.content,
      person,
      scope: person ? "person" : "family",
    });
  }

  return { facts, playbooks, archived };
}
