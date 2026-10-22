import { describe, it, expect } from "vitest";
import { slugify, subjectKey, containment, findReplacementSubject } from "@/lib/memory-subject";

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

describe("containment", () => {
  it("is 1 for the same text and 0 for unrelated text", () => {
    expect(containment("include an emoji", "include an emoji")).toBe(1);
    expect(containment("include an emoji", "the pool party was great")).toBe(0);
  });

  it("is high for a reworded restatement", () => {
    expect(containment("include an emoji", "include a relevant emoji")).toBeGreaterThan(0.5);
  });

  it("matches an allergy restatement across wordings", () => {
    // The probe's three wordings of ONE fact: the second must be recognised
    // as the same subject or the bank forks a row per rewording.
    expect(containment("Bailey is allergic to peanuts", "Bailey cannot eat peanuts")).toBeGreaterThanOrEqual(0.6);
    expect(containment("Bailey is allergic to peanuts", "Bailey is allergic to peanuts and tree nuts")).toBeGreaterThanOrEqual(0.6);
  });

  it("folds both sides, so an accent does not hide a restatement", () => {
    expect(containment("Begoña loves tacos", "Begona loves tacos")).toBe(1);
  });
});

describe("findReplacementSubject", () => {
  const existing = [
    { key: "meal_emoji", content: "When adding meals, include an emoji (default 🍽️)" },
    { key: "grocery_rule", content: "The parents maintain the grocery shopping list themselves" },
  ];

  it("matches a reworded restatement to the existing subject", () => {
    expect(findReplacementSubject(existing, "When adding meals, include a relevant emoji")).toBe("meal_emoji");
  });

  it("returns null when nothing is close enough", () => {
    expect(findReplacementSubject(existing, "Aurora plays the piano on Tuesdays")).toBeNull();
  });
});
