// Pure helper that decides the honest toast copy for meal-creation paths.
// Before this, addRecipeToPlan / addRecipeToMealSlot / copyDayMeals /
// duplicateMeal discarded saveOrQueue's boolean and always showed "✅ Added…"
// even when the write was 401-swallowed and only landed on this device.
import { describe, it, expect } from "vitest";
import { mealSaveToast } from "@/lib/meal-save-toast";

describe("mealSaveToast", () => {
  it("confirms saved when the server accepted the write", () => {
    const msg = mealSaveToast(true, "Tacos", "added");
    expect(msg).toContain("✅");
    expect(msg).toContain("Tacos");
    expect(msg).toContain("added");
    expect(msg).not.toContain("⚠️");
    expect(msg).not.toContain("this device");
  });

  it("warns about device-only saves when the write failed", () => {
    const msg = mealSaveToast(false, "Tacos", "added");
    expect(msg).toContain("⚠️");
    expect(msg).toContain("Tacos");
    expect(msg).toContain("saved on this device — will sync automatically");
    expect(msg).not.toContain("✅");
  });

  it("carries the verb through both branches", () => {
    expect(mealSaveToast(true, "Stew", "copied")).toContain("copied");
    expect(mealSaveToast(false, "Stew", "copied")).toContain("copied");
    expect(mealSaveToast(true, "Soup", "duplicated")).toContain("duplicated");
    expect(mealSaveToast(false, "Soup", "duplicated")).toContain("duplicated");
  });

  it("supports the added-to-plan verb", () => {
    expect(mealSaveToast(true, "Casserole", "added to Mon dinner")).toContain("added to Mon dinner");
    expect(mealSaveToast(false, "Casserole", "added to Mon dinner")).toContain("added to Mon dinner");
  });

  it("keeps both branches truthful about the same name", () => {
    const saved = mealSaveToast(true, "Pizza", "added");
    const queued = mealSaveToast(false, "Pizza", "added");
    expect(saved).toContain("Pizza");
    expect(queued).toContain("Pizza");
  });
});
