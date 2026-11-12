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

describe("completesWithoutPin (all signed-in members complete open tasks PIN-free)", () => {
  it("7yo and 10+ children, parents, pets, universal & overdue tasks all complete without a PIN", () => {
    expect(completesWithoutPin("child", 7, assigned)).toBe(true);
    expect(completesWithoutPin("child", 10, assigned)).toBe(true);
    expect(completesWithoutPin("child", undefined, assigned)).toBe(true);
    expect(completesWithoutPin("child", 5, universal)).toBe(true);
    expect(completesWithoutPin("child", 5, overdue)).toBe(true);
    expect(completesWithoutPin("parent", 35, assigned)).toBe(true);
    expect(completesWithoutPin("pet", 3, assigned)).toBe(true);
  });
  it("fails closed for unsigned callers and already-completed tasks", () => {
    expect(completesWithoutPin("child", 5, done)).toBe(false);
    expect(completesWithoutPin(undefined, 5, assigned)).toBe(false);
    expect(completesWithoutPin(null, 5, assigned)).toBe(false);
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
