import { describe, it, expect } from "vitest";
import {
  slugify,
  subjectKey,
  findReplacementSubject,
  topicTokens,
  sameTopic,
  assertsSafety,
  isLessInformative,
  personMatches,
  checkMerge,
} from "@/lib/memory-subject";

/**
 * The subject key is the identity of a fact. Task 6 of the plan will verify
 * and extend this module; this suite pins the contract the store and the
 * `remember_fact` tool already rely on.
 */

describe("slugify", () => {
  it("lowercases, replaces non-alphanumerics with underscores and trims", () => {
    expect(slugify("Peanut Butter!")).toBe("peanut_butter");
  });

  it("caps the length", () => {
    expect(slugify("a".repeat(80)).length).toBe(50);
  });

  it("folds an accented name instead of cutting it in half", () => {
    // The key is a machine identity, so it must be ASCII — but "bego_a" is
    // not the family's name, and the store folds the key with the SAME
    // helper, so the two agree on one spelling.
    expect(slugify("Begoña")).toBe("begona");
  });
});

describe("subjectKey", () => {
  it("builds a stable key from category, topic and person", () => {
    expect(subjectKey({ category: "allergy", topic: "peanuts", person: "Emily" })).toBe("allergy_peanuts_emily");
  });

  it("falls back to the TOPIC of the content, not a slug of its wording", () => {
    // The key is the topic ("wifi code drawer"), not the sentence's words
    // ("the_wifi_code_is_in_the"): a slug of the wording would be a NEW
    // subject for every rewording, which is the fork this module exists to
    // end.
    expect(subjectKey({ category: "note", content: "The wifi code is in the drawer" })).toBe("note_wifi_code_drawer");
  });

  it("a rewording of the same fact gets the SAME key", () => {
    const a = subjectKey({ category: "allergy", person: "Bailey", content: "Bailey is allergic to peanuts" });
    const b = subjectKey({ category: "allergy", person: "Bailey", content: "Bailey cannot eat peanuts" });
    expect(a).toBe(b);
  });

  it("two DIFFERENT facts get different keys", () => {
    const peanuts = subjectKey({ category: "allergy", person: "Bailey", content: "Bailey is allergic to peanuts" });
    const shellfish = subjectKey({ category: "allergy", person: "Bailey", content: "Bailey is allergic to shellfish" });
    expect(peanuts).not.toBe(shellfish);
  });

  it("never exceeds 50 characters", () => {
    expect(subjectKey({ category: "note", content: "x".repeat(200) }).length).toBeLessThanOrEqual(50);
  });

  it("does not repeat the person's name inside the content fallback", () => {
    const key = subjectKey({ category: "allergy", person: "Bailey", content: "Bailey is allergic to peanuts" });
    expect(key.endsWith("_bailey")).toBe(true);
    expect(key.match(/bailey/g)).toHaveLength(1);
  });
});

describe("findReplacementSubject", () => {
  const existing = [
    { key: "meal_emoji", content: "When adding meals, include an emoji (default 🍽️)" },
    { key: "grocery_rule", content: "The parents maintain the grocery shopping list themselves" },
  ];

  it("matches a reworded restatement to the existing subject", () => {
    // "default" and "relevant" MODIFY the emoji; they do not name a
    // different thing, so both sentences are about the same subject.
    expect(findReplacementSubject(existing, "When adding meals, include a relevant emoji")).toBe("meal_emoji");
  });

  it("returns null when nothing is close enough", () => {
    expect(findReplacementSubject(existing, "Aurora plays the piano on Tuesdays")).toBeNull();
  });
});

/**
 * The generic-word list is LOAD-BEARING: a day is when something happens,
 * not what it is about. The plural forms were missing once, which made
 * "Tuesdays" a topic word and let "has practice on Tuesdays" and "has soccer
 * on Tuesdays" collapse into one fact.
 */
describe("the generic words are not topics", () => {
  it("drops the day, in the singular and the plural", () => {
    expect(topicTokens("Caspian has practice on Tuesday", { person: "Caspian" })).not.toContain("tuesday");
    expect(topicTokens("Caspian has practice on Tuesdays", { person: "Caspian" })).not.toContain("tuesdays");
  });

  it("keeps what the fact is about", () => {
    expect(topicTokens("Caspian has practice on Tuesdays", { person: "Caspian" })).toContain("practice");
  });

  it("two facts that share only a day are DIFFERENT subjects", () => {
    expect(
      sameTopic("Caspian has practice on Tuesdays", "Caspian has soccer on Tuesdays", {
        person: "Caspian",
        category: "routine",
      }),
    ).toBe(false);
  });

  it("the same fact about the same thing IS the same subject", () => {
    expect(
      sameTopic("Bailey is allergic to peanuts", "Bailey cannot eat peanuts", {
        person: "Bailey",
        category: "allergy",
      }),
    ).toBe(true);
  });

  it("two DIFFERENT facts are different subjects", () => {
    expect(
      sameTopic("Bailey is allergic to peanuts", "Bailey is allergic to shellfish", {
        person: "Bailey",
        category: "allergy",
      }),
    ).toBe(false);
  });
});

/**
 * The merge rules are LOAD-BEARING and must be pinned: with the safety
 * recogniser emptied, "Bailey should not eat peanuts" was overwritten by a
 * preference; with the kinship list emptied, "Bailey's sister" was merged
 * into "Bailey"; with the "says less" rule disabled, the richer stored
 * wording was destroyed.
 */
describe("the merge rules are pinned", () => {
  it("reads an ordinary prohibition as a safety claim", () => {
    expect(assertsSafety("Bailey should not eat peanuts")).toBe(true);
    expect(assertsSafety("Bailey must not eat peanuts")).toBe(true);
    expect(assertsSafety("Bailey cannot eat peanuts")).toBe(true);
    expect(assertsSafety("Bailey reacts badly to peanuts")).toBe(true);
    expect(assertsSafety("Peanuts are banned at home")).toBe(true);
    expect(assertsSafety("Bailey loves peanuts")).toBe(false);
    expect(assertsSafety("Bailey prefers sushi")).toBe(false);
  });

  it("a kinship word makes a name a different person", () => {
    expect(personMatches("Bailey", "Bailey Garcia")).toBe(true);
    expect(personMatches("Bailey", "Bailey")).toBe(true);
    expect(personMatches("Bailey", "Bailey's sister")).toBe(false);
    expect(personMatches("Bailey", "Caspian")).toBe(false);
  });

  it("a write that says less may not replace the richer wording", () => {
    expect(isLessInformative("blue", "Bailey prefers the blue plate")).toBe(true);
    expect(isLessInformative("Bailey prefers the blue plate", "blue")).toBe(false);
    expect(isLessInformative("Bailey prefers the green plate", "Bailey prefers the blue plate")).toBe(false);
  });

  it("a safety fact is refused a correction that is not a safety claim", () => {
    const verdict = checkMerge(
      { content: "Bailey should not eat peanuts", category: "note" },
      { content: "Bailey loves peanuts" },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("memory_safety_fact_protected");
  });

  it("a safety fact accepts a correction that is a safety claim", () => {
    const verdict = checkMerge(
      { content: "Bailey is allergic to peanuts", category: "allergy" },
      { content: "Bailey reacts badly to peanuts" },
    );
    expect(verdict.ok).toBe(true);
  });
});
