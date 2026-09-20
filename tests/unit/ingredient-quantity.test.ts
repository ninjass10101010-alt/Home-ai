import { describe, it, expect } from "vitest";
import { parseIngredientLine } from "@/lib/ingredient-quantity";

describe("parseIngredientLine", () => {
  it("parses a simple number + unit + name", () => {
    expect(parseIngredientLine("2 cups flour")).toEqual({ quantity: "2", unit: "cups", rest: "flour" });
  });

  it("parses unicode fractions", () => {
    expect(parseIngredientLine("½ cup sugar")).toEqual({ quantity: "½", unit: "cup", rest: "sugar" });
    expect(parseIngredientLine("1 ½ cups milk")).toEqual({ quantity: "1 ½", unit: "cups", rest: "milk" });
  });

  it("parses ranges and slashed fractions", () => {
    expect(parseIngredientLine("1-2 tbsp olive oil")).toEqual({ quantity: "1-2", unit: "tbsp", rest: "olive oil" });
    expect(parseIngredientLine("1/2 tsp salt")).toEqual({ quantity: "1/2", unit: "tsp", rest: "salt" });
  });

  it("parses decimals", () => {
    expect(parseIngredientLine("0.5 kg potatoes")).toEqual({ quantity: "0.5", unit: "kg", rest: "potatoes" });
  });

  it("treats size words like 'large' as units", () => {
    expect(parseIngredientLine("2 large eggs")).toEqual({ quantity: "2", unit: "large", rest: "eggs" });
  });

  it("keeps non-unit words in the rest", () => {
    expect(parseIngredientLine("3 garlic cloves")).toEqual({ quantity: "3", unit: "", rest: "garlic cloves" });
  });

  it("returns null when there is no leading quantity", () => {
    expect(parseIngredientLine("Salt to taste")).toBeNull();
    expect(parseIngredientLine("all-purpose flour")).toBeNull();
  });

  it("returns null for empty/whitespace and quantity-only lines", () => {
    expect(parseIngredientLine("")).toBeNull();
    expect(parseIngredientLine("   ")).toBeNull();
    expect(parseIngredientLine("2")).toBeNull();
  });
});
