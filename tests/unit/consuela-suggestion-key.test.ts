import { describe, it, expect } from "vitest";
import { conditionKey } from "@/lib/consuela/suggestion-key";
import { visibleSuggestionsForRole } from "@/lib/consuela/suggestion-visibility";

describe("conditionKey — volatile-count normalization is scoped", () => {
  it("collapses the same store-optimization condition across different counts", () => {
    expect(conditionKey("grocery_store_optimization", "2 items have no store assigned")).toBe(
      conditionKey("grocery_store_optimization", "3 items have no store assigned")
    );
  });
  it("collapses a per-child penalty streak across counts but keeps children distinct", () => {
    expect(conditionKey("task_penalty_streak", "3 penalties this week for Emily")).toBe(
      conditionKey("task_penalty_streak", "5 penalties this week for Emily")
    );
    expect(conditionKey("task_penalty_streak", "3 penalties for Emily")).not.toBe(
      conditionKey("task_penalty_streak", "3 penalties for Bailey")
    );
  });
  it("does NOT collapse distinct pantry items whose names differ only by a number", () => {
    expect(conditionKey("pantry_low", "Vitamin B12 is running low")).not.toBe(
      conditionKey("pantry_low", "Vitamin B6 is running low")
    );
  });
  it("does NOT collapse distinct calendar conflicts", () => {
    expect(conditionKey("calendar_conflict", "Chapter 1 review and Chapter 2 review overlap")).not.toBe(
      conditionKey("calendar_conflict", "Chapter 3 review and Chapter 4 review overlap")
    );
  });
  it("is kind-scoped so identical titles across kinds never collide", () => {
    expect(conditionKey("pantry_low", "5 items")).not.toBe(conditionKey("stale_data", "5 items"));
  });
});

describe("visibleSuggestionsForRole", () => {
  const items = [
    { kind: "grocery_store_optimization" },
    { kind: "pantry_low" },
    { kind: "task_penalty_streak" },
    { kind: "calendar_conflict" },
  ];
  it("hides parent-only grocery/pantry kinds from a child", () => {
    expect(visibleSuggestionsForRole(items, "child").map((i) => i.kind)).toEqual([
      "task_penalty_streak",
      "calendar_conflict",
    ]);
  });
  it("shows everything to a parent and to an unsigned-in viewer", () => {
    expect(visibleSuggestionsForRole(items, "parent")).toHaveLength(4);
    expect(visibleSuggestionsForRole(items, undefined)).toHaveLength(4);
  });
});
