import { describe, it, expect } from "vitest";
import { extractActions } from "@/lib/ai-response";

describe("extractActions", () => {
  it("extracts a wrapped actions array", () => {
    const content = JSON.stringify({ actions: [{ type: "meal", title: "Tacos" }] });
    expect(extractActions(content)).toEqual([{ type: "meal", title: "Tacos" }]);
  });

  it("extracts an actions array when content has surrounding prose", () => {
    const content = `Here you go!\n${JSON.stringify({ actions: [{ type: "meal", title: "Tacos" }, { type: "meal", title: "Soup" }] })}\nHope that helps.`;
    const actions = extractActions(content);
    expect(actions).toHaveLength(2);
    expect(actions[0].type).toBe("meal");
  });

  it("extracts a meal_plan shape", () => {
    const content = JSON.stringify({ meal_plan: [{ day: "Mon", mealType: "dinner", name: "Stew" }] });
    expect(extractActions(content)).toHaveLength(1);
  });

  it("extracts a meals shape", () => {
    const content = JSON.stringify({ meals: [{ name: "Oats" }] });
    expect(extractActions(content)).toHaveLength(1);
  });

  it("returns [] for empty content", () => {
    expect(extractActions("")).toEqual([]);
    expect(extractActions("   ")).toEqual([]);
  });

  it("returns [] for invalid/unparseable content", () => {
    expect(extractActions("just some text with no json")).toEqual([]);
    expect(extractActions("not json { broke")).toEqual([]);
  });

  it("returns the array directly when given a bare array", () => {
    const content = JSON.stringify([{ type: "recipe", title: "Cake" }]);
    const actions = extractActions(content);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("recipe");
  });

  it("handles a meal_plan array embedded in prose", () => {
    const content = `Sure! ${JSON.stringify({ meal_plan: [{ name: "Eggs" }] })}`;
    expect(extractActions(content)).toHaveLength(1);
  });
});
