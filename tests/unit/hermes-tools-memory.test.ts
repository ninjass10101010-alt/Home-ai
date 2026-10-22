import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  storeMemory: vi.fn(),
  queryMemories: vi.fn(async (): Promise<any[]> => []),
  deleteMemory: vi.fn(async () => true),
  incrementMemoryUsage: vi.fn(async () => undefined),
  listActiveFacts: vi.fn(async (): Promise<any[]> => []),
  replaceMemoryContent: vi.fn(async (): Promise<any> => null),
}));

vi.mock("@/lib/family-memory", () => ({
  storeMemory: mocks.storeMemory,
  queryMemories: mocks.queryMemories,
  deleteMemory: mocks.deleteMemory,
  incrementMemoryUsage: mocks.incrementMemoryUsage,
  listActiveFacts: mocks.listActiveFacts,
  replaceMemoryContent: mocks.replaceMemoryContent,
}));

// hermes-tools pulls in the db + HA clients — stub the heavy seams.
vi.mock("@/db", () => ({ db: new Proxy({}, { get: () => vi.fn(async () => []) }) }));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: vi.fn(), getAuthedPB: vi.fn() }));
vi.mock("@/lib/ha/websocket-client", () => ({ getHAWebSocketClient: vi.fn(async () => ({ callService: vi.fn(async () => ({})) })) }));

import { getTool, buildToolsForOpenAI } from "@/lib/hermes-tools";

// `vi.resetAllMocks()` — not `clearAllMocks` — because a leaked
// `mockImplementation` survives a clear and wedges every later test in this
// file (the store-failure case sets one). The defaults are re-armed below.
beforeEach(() => {
  vi.resetAllMocks();
  mocks.queryMemories.mockResolvedValue([]);
  mocks.deleteMemory.mockResolvedValue(true);
  mocks.incrementMemoryUsage.mockResolvedValue(undefined);
  mocks.listActiveFacts.mockResolvedValue([]);
  mocks.replaceMemoryContent.mockResolvedValue(null);
});

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
  it("stores against a subject key, not a slug of the content", async () => {
    mocks.storeMemory.mockResolvedValue({ id: "m1", key: "allergy_peanuts_bailey", content: "Bailey is allergic to peanuts" });
    const tool = getTool("remember_fact")!;
    const out = await tool.handler({ content: "Bailey is allergic to peanuts", category: "allergy", person: "Bailey" });
    expect(mocks.storeMemory).toHaveBeenCalledWith({
      userId: "consuela",
      familyId: "demo-family",
      category: "allergy",
      // The TOPIC, not the wording: "allergy_peanuts_bailey". A key built
      // from the sentence's own words would be a new subject for every
      // rewording, and a rewording must REPLACE the row, not fork it.
      key: "allergy_peanuts_bailey",
      content: "Bailey is allergic to peanuts",
      tags: ["Bailey"],
      confidence: 0.9,
      person: "Bailey",
      scope: "person",
      source: "agent",
    });
    expect(JSON.parse(out).ok).toBe(true);
  });

  it("a named topic becomes the subject key", async () => {
    mocks.storeMemory.mockResolvedValue({ id: "m1", key: "allergy_peanuts_bailey", content: "Bailey is allergic to peanuts" });
    await getTool("remember_fact")!.handler({ content: "Bailey is allergic to peanuts", category: "allergy", person: "Bailey", topic: "peanuts" });
    expect(mocks.storeMemory.mock.calls[0][0].key).toBe("allergy_peanuts_bailey");
  });

  it("a rewording of a stored fact REPLACES that subject instead of forking a row", async () => {
    mocks.listActiveFacts.mockResolvedValue([
      { key: "allergy_peanuts_bailey", category: "allergy", person: "Bailey", content: "Bailey is allergic to peanuts" },
    ]);
    mocks.replaceMemoryContent.mockResolvedValue({ id: "m1", key: "allergy_peanuts_bailey", content: "Bailey cannot eat peanuts" });
    const out = JSON.parse(await getTool("remember_fact")!.handler({
      content: "Bailey cannot eat peanuts", category: "allergy", person: "Bailey",
    }));
    expect(mocks.storeMemory).not.toHaveBeenCalled();
    expect(mocks.replaceMemoryContent).toHaveBeenCalledWith(expect.objectContaining({
      key: "allergy_peanuts_bailey",
      content: "Bailey cannot eat peanuts",
    }));
    expect(out.replaced).toBe(true);
  });

  it("a DIFFERENT fact is not treated as a rewording", async () => {
    mocks.listActiveFacts.mockResolvedValue([
      { key: "allergy_peanuts_bailey", category: "allergy", person: "Bailey", content: "Bailey is allergic to peanuts" },
    ]);
    mocks.storeMemory.mockResolvedValue({ id: "m2", key: "preference_sushi_bailey", content: "Bailey loves sushi" });
    await getTool("remember_fact")!.handler({ content: "Bailey loves sushi", category: "preference", person: "Bailey" });
    expect(mocks.replaceMemoryContent).not.toHaveBeenCalled();
    expect(mocks.storeMemory).toHaveBeenCalled();
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
      expect.objectContaining({ category: "note", content: "Practice moved to Tuesdays", tags: [] })
    );
    expect(JSON.parse(out).error).toBeTruthy();
  });

  it("reports the store being down instead of pretending it saved the fact", async () => {
    mocks.listActiveFacts.mockRejectedValue(new Error("PB down"));
    const out = JSON.parse(await getTool("remember_fact")!.handler({ content: "Bailey loves sushi", category: "preference", person: "Bailey" }));
    expect(out.ok).toBeUndefined();
    expect(out.error).toBeTruthy();
    expect(mocks.storeMemory).not.toHaveBeenCalled();
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
    expect(mocks.queryMemories).toHaveBeenCalledWith(expect.objectContaining({ familyId: "demo-family", person: "Bailey", limit: 10 }));
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
