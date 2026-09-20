import { describe, it, expect } from "vitest";
import { parseInstructionsToSteps } from "@/lib/recipe-steps";

describe("parseInstructionsToSteps", () => {
  it("splits newline-separated instructions", () => {
    expect(parseInstructionsToSteps("Chop the vegetables.\nSimmer for 20 minutes.\nServe warm."))
      .toEqual(["Chop the vegetables.", "Simmer for 20 minutes.", "Serve warm."]);
  });

  it("strips enumeration and bullet markers", () => {
    expect(parseInstructionsToSteps("1. Mix the flour\n2. Add the eggs\n- Bake at 350"))
      .toEqual(["Mix the flour", "Add the eggs", "Bake at 350"]);
  });

  it("keeps a single short instruction as one step", () => {
    expect(parseInstructionsToSteps("Combine everything and serve.")).toEqual(["Combine everything and serve."]);
  });

  it("splits a single long paragraph on sentence boundaries", () => {
    const long =
      "Preheat the oven to 375 degrees Fahrenheit. In a large bowl, whisk the dry ingredients together. Fold in the wet ingredients until just combined, then pour the batter into a greased pan.";
    expect(parseInstructionsToSteps(long)).toHaveLength(3);
  });

  it("does not split after common abbreviations followed by lowercase text", () => {
    const text = "Add 2 tbsp. olive oil and stir. Cook until golden.";
    const steps = parseInstructionsToSteps(text);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toBe("Add 2 tbsp. olive oil and stir.");
  });

  it("drops blank lines and trims whitespace", () => {
    expect(parseInstructionsToSteps("  Step one.  \n\n   Step two.  ")).toEqual(["Step one.", "Step two."]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseInstructionsToSteps("")).toEqual([]);
    expect(parseInstructionsToSteps("   \n  ")).toEqual([]);
  });
});
