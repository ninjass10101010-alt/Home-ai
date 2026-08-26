import { describe, it, expect } from "vitest";
import { mapKitchenTabParam, isRecipesDeepLink } from "@/lib/kitchen-tabs";

describe("mapKitchenTabParam", () => {
  it("maps legacy params to the new tabs", () => {
    expect(mapKitchenTabParam("meals")).toBe("plan");
    expect(mapKitchenTabParam("recipes")).toBe("plan");
    expect(mapKitchenTabParam("grocery")).toBe("shop");
    expect(mapKitchenTabParam("pantry")).toBe("stock");
  });
  it("accepts the new params unchanged", () => {
    expect(mapKitchenTabParam("plan")).toBe("plan");
    expect(mapKitchenTabParam("shop")).toBe("shop");
    expect(mapKitchenTabParam("stock")).toBe("stock");
  });
  it("defaults to plan for null/unknown", () => {
    expect(mapKitchenTabParam(null)).toBe("plan");
    expect(mapKitchenTabParam("bogus")).toBe("plan");
  });
});

describe("isRecipesDeepLink", () => {
  it("is true only for ?tab=recipes", () => {
    expect(isRecipesDeepLink("recipes")).toBe(true);
    expect(isRecipesDeepLink("meals")).toBe(false);
    expect(isRecipesDeepLink(null)).toBe(false);
  });
});
