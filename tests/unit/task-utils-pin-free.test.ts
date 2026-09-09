import { describe, it, expect } from "vitest";
import { completesWithoutPin, completesWithPendingApproval, PIN_FREE_MAX_AGE } from "@/lib/task-utils";

const assigned = { id: 1, title: "T", assignee: "Caspian", completed: false, points: 5, due: "2099-01-01" } as any;
const universal = { ...assigned, universal: true };
const overdue = { ...assigned, stealable: true, due: "2020-01-01" };
const done = { ...assigned, completed: true };

describe("PIN_FREE_MAX_AGE", () => {
  it("is 10 (strictly less-than; age 10 is NOT pin-free)", () => {
    expect(PIN_FREE_MAX_AGE).toBe(10);
  });
});

describe("completesWithoutPin (under-10 assigned taps)", () => {
  it("7yo child on an assigned task → true", () => {
    expect(completesWithoutPin("child", 7, assigned)).toBe(true);
  });
  it("age 9 true, age 10 false (boundary)", () => {
    expect(completesWithoutPin("child", 9, assigned)).toBe(true);
    expect(completesWithoutPin("child", 10, assigned)).toBe(false);
  });
  it("missing/non-numeric age fails closed", () => {
    expect(completesWithoutPin("child", undefined, assigned)).toBe(false);
    expect(completesWithoutPin("child", 0, assigned)).toBe(false);
    expect(completesWithoutPin("child", Number.NaN, assigned)).toBe(false);
  });
  it("never universal/snatchable/completed — and parents", () => {
    expect(completesWithoutPin("child", 5, universal)).toBe(false);
    expect(completesWithoutPin("child", 5, overdue)).toBe(false);
    expect(completesWithoutPin("child", 5, done)).toBe(false);
    expect(completesWithoutPin("parent", 5, assigned)).toBe(false);
    expect(completesWithoutPin(undefined, 5, assigned)).toBe(false);
  });
});

describe("completesWithPendingApproval (every child completion waits)", () => {
  it("child open task → true (universal handled at the claim site)", () => {
    expect(completesWithPendingApproval("child", assigned)).toBe(true);
  });
  it("adults and completed rows → false", () => {
    expect(completesWithPendingApproval("parent", assigned)).toBe(false);
    expect(completesWithPendingApproval("child", done)).toBe(false);
  });
});
