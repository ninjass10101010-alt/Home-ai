import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repairCategories } from "@/lib/task-repair-categories";

describe("reconcile operator script", () => {
  it("keeps usage guidance", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/consuela/reconcile-pending-approvals.mjs"),
      "utf8",
    );
    expect(source).toContain("npx tsx scripts/consuela/reconcile-pending-approvals.mjs");
  });

  it("shares the sanitized category filter with the sync route", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/consuela/reconcile-pending-approvals.mjs"),
      "utf8",
    );
    expect(source).toContain("task-repair-categories");
    expect(repairCategories(["tasks:read", "tasks:changed", "week_mismatch", "projection:read"]))
      .toEqual(["tasks:read", "tasks:changed", "week_mismatch", "projection:read"]);
  });
});
