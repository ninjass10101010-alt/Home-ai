import { describe, it, expect, vi, beforeEach } from "vitest";

const facts: any[] = [];
const playbooks: any[] = [];
const runs: any[] = [];
const mocks = vi.hoisted(() => ({ pb: null as any }));

vi.mock("@/lib/pb-auth", () => ({ getAuthedPB: async () => mocks.pb }));
vi.mock("@/lib/family-memory", () => ({
  listActiveFacts: async () => facts.filter((f) => f.status !== "archived"),
  queryMemories: async () => facts,
}));
vi.mock("@/lib/memory-playbooks", () => ({
  listActivePlaybooks: async () => playbooks.filter((p) => p.status !== "archived"),
  archivePlaybook: async (slug: string) => { const p = playbooks.find((x) => x.slug === slug); if (p) p.status = "archived"; return true; },
  writePlaybook: async (input: any) => {
    const existing = playbooks.find((p) => p.slug === input.slug);
    if (existing) { existing.body = input.body; existing.version = (existing.version ?? 1) + 1; return existing; }
    const row = { id: `p${playbooks.length + 1}`, version: 1, status: "active", useCount: 0, history: [], ...input };
    playbooks.push(row);
    return row;
  },
}));

import { runCurator, undoRun, listRuns, planConsolidation } from "@/lib/memory-curator";

function fakePb() {
  return {
    collection: (name: string) => ({
      getFullList: async ({ filter }: any) => {
        if (name === "consuela_memory_runs") return runs.slice();
        return [];
      },
      create: async (data: any) => {
        if (name === "consuela_memory_runs") {
          const row = { id: `run${runs.length + 1}`, ...data };
          runs.push(row);
          return row;
        }
        return { id: `r${Math.random()}`, ...data };
      },
      update: async (id: string, data: any) => {
        const row = (name === "consuela_memory_runs" ? runs : facts).find((r) => r.id === id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return row;
      },
      getOne: async (id: string) => (name === "consuela_memory_runs" ? runs : facts).find((r) => r.id === id)!,
      getFirstListItem: async (filter: string) => {
        const runId = /runId = "([^"]+)"/.exec(filter)?.[1];
        const found = runs.find((r) => r.runId === runId);
        if (!found) throw new Error("not found");
        return found;
      },
    }),
  };
}

beforeEach(() => {
  facts.length = 0; playbooks.length = 0; runs.length = 0;
  mocks.pb = fakePb();
});

describe("planConsolidation", () => {
  it("merges a reworded duplicate into the newest row", () => {
    const plan = planConsolidation([
      { id: "old", key: "k1", category: "preference", content: "When adding meals, include an emoji", updatedAt: "2026-01-01T00:00:00Z" },
      { id: "new", key: "k2", category: "preference", content: "When adding meals, include a relevant emoji", updatedAt: "2026-10-01T00:00:00Z" },
    ], Date.parse("2026-10-21T00:00:00Z"));
    expect(plan.merges).toEqual([{ keepId: "new", dropId: "old" }]);
  });

  it("never merges a safety fact away", () => {
    const plan = planConsolidation([
      { id: "a", key: "k1", category: "allergy", content: "Emily is allergic to peanuts", updatedAt: "2026-01-01T00:00:00Z" },
      { id: "b", key: "k2", category: "allergy", content: "Emily is allergic to peanuts and shellfish", updatedAt: "2026-10-01T00:00:00Z" },
    ], Date.parse("2026-10-21T00:00:00Z"));
    expect(plan.merges).toHaveLength(0);
  });

  it("archives a fact unused for 90 days but never a safety one", () => {
    const stale = new Date(Date.parse("2026-10-21T00:00:00Z") - 120 * 86_400_000).toISOString();
    const plan = planConsolidation([
      { id: "old", key: "k1", category: "note", content: "an old note", updatedAt: stale, lastUsed: stale, usageCount: 0 },
      { id: "safe", key: "k2", category: "allergy", content: "Emily is allergic to peanuts", updatedAt: stale, lastUsed: stale, usageCount: 0 },
    ], Date.parse("2026-10-21T00:00:00Z"));
    expect(plan.archives).toEqual(["old"]);
  });
});

describe("runCurator", () => {
  it("writes a run row with the changes it made", async () => {
    const stale = new Date(Date.parse("2026-10-21T00:00:00Z") - 120 * 86_400_000).toISOString();
    facts.push({ id: "old", key: "k1", category: "note", content: "an old note", status: "active", updatedAt: stale, lastUsed: stale, usageCount: 0, history: [] });
    const run = await runCurator({ trigger: "manual", now: Date.parse("2026-10-21T00:00:00Z") });
    expect(run.changes.length).toBeGreaterThan(0);
    expect(runs).toHaveLength(1);
    expect(runs[0].snapshot).toBeTruthy();
  });

  it("a dry run changes nothing", async () => {
    facts.push({ id: "old", key: "k1", category: "note", content: "an old note", status: "active", updatedAt: "2020-01-01T00:00:00Z", usageCount: 0, history: [] });
    const run = await runCurator({ trigger: "manual", dryRun: true, now: Date.parse("2026-10-21T00:00:00Z") });
    expect(run.changes.length).toBeGreaterThan(0);
    expect(facts[0].status).toBe("active");
  });
});

describe("undoRun", () => {
  it("restores a row the run archived", async () => {
    const stale = new Date(Date.parse("2026-10-21T00:00:00Z") - 120 * 86_400_000).toISOString();
    facts.push({ id: "old", key: "k1", category: "note", content: "an old note", status: "active", updatedAt: stale, lastUsed: stale, usageCount: 0, history: [] });
    const run = await runCurator({ trigger: "manual", now: Date.parse("2026-10-21T00:00:00Z") });
    expect(facts[0].status).toBe("archived");
    const ok = await undoRun(run.runId);
    expect(ok).toBe(true);
    expect(facts[0].status).toBe("active");
  });
});

describe("listRuns", () => {
  it("returns the newest runs first", async () => {
    await runCurator({ trigger: "manual" });
    await runCurator({ trigger: "manual" });
    const list = await listRuns();
    expect(list.length).toBe(2);
  });
});
