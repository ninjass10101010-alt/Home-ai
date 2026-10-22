import { describe, it, expect } from "vitest";
import { detectCaptures, playbookSlugFor } from "@/lib/memory-capture";

const roster = ["Jeff", "Rebecca", "Emily", "Bailey", "Jasmine", "Aurora", "Caspian"];

describe("detectCaptures — high confidence facts", () => {
  it("catches an explicit allergy about a roster member", () => {
    const found = detectCaptures("Bailey is allergic to peanuts", roster);
    expect(found).toHaveLength(1);
    expect(found[0].confidence).toBe("high");
    expect(found[0].category).toBe("allergy");
    expect(found[0].person).toBe("Bailey");
    expect(found[0].topic).toBe("peanuts");
    expect(found[0].subject).toBe("allergy_peanuts_bailey");
  });

  it("catches an explicit 'remember that'", () => {
    const found = detectCaptures("Remember that the wifi code is in the kitchen drawer", roster);
    expect(found[0].confidence).toBe("high");
    expect(found[0].content).toContain("wifi code");
  });

  it("catches a stated preference", () => {
    const found = detectCaptures("Caspian loves sushi", roster);
    expect(found[0].category).toBe("preference");
    expect(found[0].person).toBe("Caspian");
  });

  it("ignores a person who is not on the roster", () => {
    expect(detectCaptures("Some stranger is allergic to peanuts", roster)).toHaveLength(0);
  });
});

describe("detectCaptures — low confidence proposals", () => {
  it("flags a first-person preference as a proposal, not a store", () => {
    const found = detectCaptures("I love pizza", roster);
    expect(found[0].confidence).toBe("low");
  });

  it("flags a rule with no task domain as a proposal", () => {
    const found = detectCaptures("always be nicer about the weather", roster);
    expect(found[0].kind).toBe("rule");
    expect(found[0].confidence).toBe("low");
  });
});

describe("detectCaptures — task rules become playbooks", () => {
  it("maps a meal rule to the meals domain", () => {
    const found = detectCaptures("when adding meals always include a relevant emoji", roster);
    expect(found[0].kind).toBe("rule");
    expect(found[0].domain).toBe("meals");
    expect(found[0].slug).toBe("meals.add_meal");
  });

  it("maps a grocery rule to the grocery domain", () => {
    const found = detectCaptures("never add grocery items unless I ask", roster);
    expect(found[0].domain).toBe("grocery");
  });
});

describe("playbookSlugFor", () => {
  it("returns null when the content names no task domain", () => {
    expect(playbookSlugFor("be nicer about the weather")).toBeNull();
  });
});
