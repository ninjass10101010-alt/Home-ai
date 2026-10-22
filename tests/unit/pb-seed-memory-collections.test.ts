import { describe, expect, it } from "vitest";
import { COLLECTIONS } from "@/lib/pb-seed";

describe("pb-seed — the memory collections", () => {
  it("gives consuela_family_memories the subject-key fields the store writes", () => {
    const collection = COLLECTIONS.find((entry: any) => entry.name === "consuela_family_memories");
    expect(collection).toBeTruthy();
    const fields = Object.fromEntries((collection as any).schema.map((f: any) => [f.name, f.type]));
    expect(fields).toMatchObject({
      person: "text",
      scope: "text",
      status: "text",
      version: "number",
      history: "json",
      source: "text",
    });
    expect((collection as any).indexes).toContain(
      "CREATE UNIQUE INDEX idx_family_memories_user_key ON consuela_family_memories (userId, key)",
    );
  });

  it("declares consuela_playbooks with a unique slug", () => {
    const collection = COLLECTIONS.find((entry: any) => entry.name === "consuela_playbooks");
    expect(collection).toBeTruthy();
    const fields = Object.fromEntries((collection as any).schema.map((f: any) => [f.name, f.type]));
    expect(fields).toMatchObject({
      slug: "text",
      title: "text",
      domain: "text",
      trigger: "text",
      body: "text",
      version: "number",
      status: "text",
      history: "json",
      useCount: "number",
      lastUsed: "text",
      createdBy: "text",
    });
    expect((collection as any).indexes).toContain(
      "CREATE UNIQUE INDEX idx_consuela_playbooks_slug ON consuela_playbooks (slug)",
    );
  });

  it("declares consuela_memory_runs as the curator ledger", () => {
    const collection = COLLECTIONS.find((entry: any) => entry.name === "consuela_memory_runs");
    expect(collection).toBeTruthy();
    const fields = Object.fromEntries((collection as any).schema.map((f: any) => [f.name, f.type]));
    expect(fields).toMatchObject({
      runId: "text",
      trigger: "text",
      summary: "text",
      changes: "json",
      snapshot: "json",
      report: "text",
      undoneAt: "text",
    });
  });
});
