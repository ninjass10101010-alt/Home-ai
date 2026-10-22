import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  listActiveFacts: vi.fn(async (): Promise<any[]> => []),
  listActivePlaybooks: vi.fn(async (): Promise<any[]> => []),
  queryMemories: vi.fn(async (): Promise<any[]> => []),
}));

vi.mock("@/lib/family-memory", () => ({
  listActiveFacts: mocks.listActiveFacts,
  queryMemories: mocks.queryMemories,
}));
vi.mock("@/lib/memory-playbooks", () => ({
  listActivePlaybooks: mocks.listActivePlaybooks,
}));

import { composeMemoryPrompt, factsForSpeaker, buildMemoryContextBlock } from "@/lib/memory-context";

beforeEach(() => vi.clearAllMocks());

const facts = [
  { id: "a", category: "allergy", content: "Emily is allergic to peanuts", person: "Emily", key: "allergy_peanuts_emily" },
  { id: "b", category: "preference", content: "Bailey loves sushi", person: "Bailey", key: "pref_sushi_bailey" },
  { id: "c", category: "note", content: "The wifi code is in the drawer", person: "", key: "wifi_code" },
];

describe("factsForSpeaker", () => {
  it("keeps only the facts about that person", () => {
    const kept = factsForSpeaker(facts, "Emily");
    expect(kept.map((f) => f.id)).toEqual(["a"]);
  });

  it("matches a first name against a full name", () => {
    const kept = factsForSpeaker([{ id: "x", category: "note", content: "c", person: "Emily Garcia" }], "Emily");
    expect(kept).toHaveLength(1);
  });

  it("never returns a household fact to a kid", () => {
    const kept = factsForSpeaker(facts, "Caspian");
    expect(kept).toHaveLength(0);
  });
});

describe("composeMemoryPrompt", () => {
  it("renders the three zones in a fixed order", () => {
    const text = composeMemoryPrompt({
      coreFacts: [{ id: "a", category: "allergy", content: "Emily is allergic to peanuts", person: "Emily" }],
      playbooks: [{ slug: "meals.add_emoji", title: "Attach a relevant meal emoji", trigger: "add_meal" }],
      relevant: [{ id: "b", category: "preference", content: "Bailey loves sushi", person: "Bailey" }],
    });
    expect(text.indexOf("Family facts")).toBeLessThan(text.indexOf("Playbooks"));
    expect(text.indexOf("Playbooks")).toBeLessThan(text.indexOf("Relevant to this message"));
    expect(text).toContain("Emily is allergic to peanuts");
    expect(text).toContain("meals.add_emoji");
    expect(text).toContain("Bailey loves sushi");
  });

  it("returns an empty string when there is nothing at all", () => {
    expect(composeMemoryPrompt({ coreFacts: [], playbooks: [], relevant: [] })).toBe("");
  });
});

describe("buildMemoryContextBlock", () => {
  it("gives a parent the core facts, the playbook index and the relevant hits", async () => {
    mocks.listActiveFacts.mockResolvedValue(facts);
    mocks.listActivePlaybooks.mockResolvedValue([{ slug: "meals.add_emoji", title: "Attach a relevant meal emoji", trigger: "add_meal" }]);
    mocks.queryMemories.mockResolvedValue([facts[1]]);
    const text = await buildMemoryContextBlock({ role: "parent", speakerName: "Rebecca", message: "what does bailey like" });
    expect(text).toContain("Family facts");
    expect(text).toContain("meals.add_emoji");
    expect(text).toContain("Bailey loves sushi");
  });

  it("gives a kid ONLY their own facts and no playbook index", async () => {
    mocks.listActiveFacts.mockResolvedValue(facts);
    mocks.listActivePlaybooks.mockResolvedValue([{ slug: "meals.add_emoji", title: "Attach a relevant meal emoji" }]);
    mocks.queryMemories.mockResolvedValue([]);
    const text = await buildMemoryContextBlock({ role: "child", speakerName: "Emily", message: "what am i allergic to" });
    expect(text).toContain("Emily is allergic to peanuts");
    expect(text).not.toContain("Bailey loves sushi");
    expect(text).not.toContain("wifi code");
    expect(text).not.toContain("meals.add_emoji");
  });

  it("gives a guest nothing", async () => {
    mocks.listActiveFacts.mockResolvedValue(facts);
    const text = await buildMemoryContextBlock({ role: "guest", speakerName: "", message: "hello" });
    expect(text).toBe("");
  });

  it("never throws when the store is down", async () => {
    mocks.listActiveFacts.mockRejectedValue(new Error("pb down"));
    const text = await buildMemoryContextBlock({ role: "parent", speakerName: "Rebecca", message: "hi" });
    expect(text).toBe("");
  });
});
