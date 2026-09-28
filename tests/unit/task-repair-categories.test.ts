import { describe, expect, it } from "vitest";
import { repairCategories } from "@/lib/task-repair-categories";

describe("repair category vocabulary", () => {
  it("keeps the exact categories the reconciler emits", () => {
    expect(repairCategories([
      "tasks:read",
      "tasks:changed",
      "week:changed",
      "week:ledger",
      "week_archive:invalid",
      "week_mismatch",
      "rollover:pending",
      "snapshot:read",
      "approval:metadata",
      "projection:read",
      "task:42:ambiguous",
    ])).toEqual([
      "tasks:read",
      "tasks:changed",
      "week:changed",
      "week:ledger",
      "week_archive:invalid",
      "week_mismatch",
      "rollover:pending",
      "snapshot:read",
      "approval:metadata",
      "projection:read",
      "task:42:ambiguous",
    ]);
  });

  it("drops untrusted values and duplicates", () => {
    expect(repairCategories([
      "secret:raw-row",
      "http://internal/pb",
      "../../etc/passwd",
      "tasks:read",
      "tasks:read",
      42,
      null,
    ])).toEqual(["tasks:read"]);
  });

  it("tolerates a missing or non-array field", () => {
    expect(repairCategories(undefined)).toEqual([]);
    expect(repairCategories("tasks:read")).toEqual([]);
  });
});
