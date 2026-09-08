import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  storeMemory: vi.fn(),
  queryMemories: vi.fn(async (): Promise<any[]> => []),
  deleteMemory: vi.fn(async () => true),
  incrementMemoryUsage: vi.fn(async () => undefined),
}));

vi.mock("@/lib/family-memory", () => ({
  storeMemory: mocks.storeMemory,
  queryMemories: mocks.queryMemories,
  deleteMemory: mocks.deleteMemory,
  incrementMemoryUsage: mocks.incrementMemoryUsage,
}));

// hermes-tools pulls in the db + HA clients — stub the heavy seams.
vi.mock("@/db", () => ({ db: new Proxy({}, { get: () => vi.fn(async () => []) }) }));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: vi.fn(), getAuthedPB: vi.fn() }));
vi.mock("@/lib/ha/websocket-client", () => ({ getHAWebSocketClient: vi.fn(async () => ({ callService: vi.fn(async () => ({})) })) }));

import { getTool, buildToolsForOpenAI } from "@/lib/hermes-tools";

beforeEach(() => vi.clearAllMocks());

describe("memory tool gating", () => {
  it("adult sessions get the three memory tools; child sessions never do", () => {
    const adult = buildToolsForOpenAI({ houseControl: true, role: "parent" }).map((t) => t.function.name);
    for (const name of ["remember_fact", "recall_memories", "forget_memory"]) {
      expect(adult).toContain(name);
    }
    const kid = buildToolsForOpenAI({ houseControl: false, role: "child" }).map((t) => t.function.name);
    for (const name of ["remember_fact", "recall_memories", "forget_memory"]) {
      expect(kid).not.toContain(name);
    }
  });
});

describe("remember_fact", () => {
  it("stores with the consuela userId, demo-family familyId, and a derived key", async () => {
    mocks.storeMemory.mockResolvedValue({ id: "m1", content: "Bailey is allergic to peanuts" });
    const tool = getTool("remember_fact")!;
    const out = await tool.handler({ content: "Bailey is allergic to peanuts", category: "allergy", person: "Bailey" });
    expect(mocks.storeMemory).toHaveBeenCalledWith(
      "consuela",
      "demo-family",
      "allergy",
      "bailey_bailey_is_allergic_to_peanuts",
      "Bailey is allergic to peanuts",
      ["Bailey"],
      0.9
    );
    expect(JSON.parse(out).ok).toBe(true);
  });

  it("rejects empty content", async () => {
    const out = await getTool("remember_fact")!.handler({ content: "  " });
    expect(JSON.parse(out).error).toBeTruthy();
    expect(mocks.storeMemory).not.toHaveBeenCalled();
  });

  it("falls back to category=note and reports store failures honestly", async () => {
    mocks.storeMemory.mockResolvedValue(null);
    const out = await getTool("remember_fact")!.handler({ content: "Practice moved to Tuesdays" });
    expect(mocks.storeMemory).toHaveBeenCalledWith(
      "consuela", "demo-family", "note", expect.any(String), "Practice moved to Tuesdays", [], 0.9
    );
    expect(JSON.parse(out).error).toBeTruthy();
  });
});

describe("recall_memories", () => {
  it("queries and increments usage for each hit", async () => {
    mocks.queryMemories.mockResolvedValue([
      { id: "m1", category: "allergy", key: "k1", content: "Bailey is allergic to peanuts", tags: '["Bailey"]', usageCount: 2 },
      { id: "m2", category: "note", key: "k2", content: "Practice moved to Tuesdays", tags: "[]", usageCount: 0 },
    ]);
    const out = await getTool("recall_memories")!.handler({ person: "Bailey" });
    const body = JSON.parse(out);
    expect(body.memories).toHaveLength(2);
    expect(mocks.queryMemories).toHaveBeenCalledWith(expect.objectContaining({ familyId: "demo-family", search: "Bailey", limit: 10 }));
    expect(mocks.incrementMemoryUsage).toHaveBeenCalledTimes(2);
  });

  it("reports unavailability instead of inventing", async () => {
    mocks.queryMemories.mockRejectedValue(new Error("PB down"));
    const out = await getTool("recall_memories")!.handler({});
    expect(JSON.parse(out).error).toBeTruthy();
  });
});

describe("forget_memory", () => {
  it("deletes by id and reports honestly", async () => {
    const ok = await getTool("forget_memory")!.handler({ memoryId: "m1" });
    expect(JSON.parse(ok).ok).toBe(true);
    mocks.deleteMemory.mockResolvedValue(false);
    const bad = await getTool("forget_memory")!.handler({ memoryId: "zz" });
    expect(JSON.parse(bad).error).toBeTruthy();
  });
});
