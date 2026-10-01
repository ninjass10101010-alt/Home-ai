import { describe, expect, it } from "vitest";
import { applyTaskConfigCommand, parseTaskConfigCommand } from "@/lib/task-config";

const TEMPLATE = {
  id: "tpl-1", title: "Trash", points: 5, category: "chores", priority: "medium",
  mode: "assigned", assigneeName: "Alex", expiresAfterDays: 3,
};

describe("task-templates config leg", () => {
  it("parses an upsert command and round-trips the item", () => {
    const parsed = parseTaskConfigCommand({
      operationId: "op-tpl-1", kind: "task-templates", action: "upsert",
      updatedAt: "2026-10-01T12:00:00.000Z", item: TEMPLATE,
    }, (value) => value);
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(applyTaskConfigCommand([], parsed)).toEqual([TEMPLATE]);
  });

  it("refuses mode-mismatched fields", () => {
    const parsed = parseTaskConfigCommand({
      operationId: "op-tpl-2", kind: "task-templates", action: "upsert",
      updatedAt: "2026-10-01T12:00:00.000Z",
      item: { ...TEMPLATE, mode: "open", assigneeName: "Alex" },
    }, (value) => value);
    expect("error" in parsed).toBe(true);
  });

  it("deletes by id", () => {
    const parsed = parseTaskConfigCommand({
      operationId: "op-tpl-3", kind: "task-templates", action: "delete",
      updatedAt: "2026-10-01T12:00:00.000Z", itemId: "tpl-1",
    }, (value) => value);
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(applyTaskConfigCommand([TEMPLATE as never], parsed)).toEqual([]);
  });
});
