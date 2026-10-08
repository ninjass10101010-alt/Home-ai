import { describe, expect, it } from "vitest";
import { COLLECTIONS } from "@/lib/pb-seed";

describe("pb-seed — the server command queue collection", () => {
  it("declares every field the queue server reads/writes, with the unique operation index", () => {
    const collection = COLLECTIONS.find((entry: any) => entry.name === "task_command_queue");
    expect(collection).toBeTruthy();
    const fields = Object.fromEntries((collection as any).schema.map((f: any) => [f.name, f.type]));
    expect(fields).toMatchObject({
      operationId: "text",
      route: "text",
      action: "text",
      payload: "json",
      actorMemberId: "text",
      actorName: "text",
      actorRole: "text",
      actorAuthentication: "text",
      status: "text",
      attemptCount: "number",
      nextAttemptAt: "date",
      lastErrorReason: "text",
      lastErrorMessage: "text",
      result: "json",
      displayTarget: "json",
      resolvedAt: "date",
    });
    expect((collection as any).indexes).toContain(
      "CREATE UNIQUE INDEX idx_task_command_queue_operation ON task_command_queue (operationId)",
    );
  });
});
