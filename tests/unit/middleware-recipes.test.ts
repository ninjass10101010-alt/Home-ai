import { describe, it, expect } from "vitest";
import { isExempt } from "@/middleware";

describe("recipes API exempt from auth", () => {
  it("exempts /api/recipes/search", () => {
    expect(isExempt("/api/recipes/search")).toBe(true);
  });
  it("exempts /api/recipes/ingest", () => {
    expect(isExempt("/api/recipes/ingest")).toBe(true);
  });
  it("does NOT exempt /api/tasks", () => {
    expect(isExempt("/api/tasks")).toBe(false);
  });
  it("does NOT exempt /api/db", () => {
    expect(isExempt("/api/db")).toBe(false);
  });
});
