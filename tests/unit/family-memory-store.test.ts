import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The subject-keyed fact store.
 *
 * The fake PocketBase it runs against is FAITHFUL (see
 * ./helpers/fake-pocketbase.ts), because a permissive fake is how a whole
 * class of defect stays invisible: it rejects a filter on a column the
 * collection does not declare, it DROPS the fields a write carries that the
 * collection does not declare, it returns a FRESH object per read, and it
 * reads an unset field back as "" / 0 / null.
 */

const mocks = vi.hoisted(() => ({ state: null as any }));

vi.mock("@/lib/pb-auth", () => ({
  getAuthedPB: async () => mocks.state.pb,
}));

import {
  storeMemory,
  replaceMemoryContent,
  queryMemories,
  listActiveFacts,
  getMemoryStats,
  buildMemoryContext,
  updateMemory,
  MemoryStoreError,
} from "@/lib/family-memory";
import {
  OLD_SCHEMA,
  createFakePb,
  createFakePbState,
} from "./helpers/fake-pocketbase";
import type { FakePbCall } from "./helpers/fake-pocketbase";

function rows() {
  return mocks.state.rows;
}

beforeEach(() => {
  mocks.state = createFakePbState();
  mocks.state.pb = createFakePb(mocks.state);
});


const BASE = { userId: "consuela", familyId: "demo-family", category: "allergy" as const };

describe("storeMemory", () => {
  it("stores against the subject key it is given and records the new fields", async () => {
    const stored = await storeMemory({
      userId: "consuela",
      familyId: "demo-family",
      category: "allergy",
      key: "allergy_peanuts_emily",
      content: "Emily is allergic to peanuts",
      person: "Emily",
      scope: "person",
      source: "agent",
    });
    expect(stored?.key).toBe("allergy_peanuts_emily");
    expect(stored?.person).toBe("Emily");
    expect(stored?.status).toBe("active");
    expect(stored?.version).toBe(1);
    expect(stored?.history).toEqual([]);
    expect(rows()).toHaveLength(1);
  });

  it("replaces the existing subject in place instead of creating a second row", async () => {
    await storeMemory({ userId: "consuela", familyId: "demo-family", category: "preference", key: "meal_emoji", content: "include an emoji" });
    await storeMemory({ userId: "consuela", familyId: "demo-family", category: "preference", key: "meal_emoji", content: "include a relevant emoji" });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].content).toBe("include a relevant emoji");
  });

  it("keeps the subject per user — the same subject in another namespace is another row", async () => {
    await storeMemory({ userId: "consuela", familyId: "demo-family", category: "note", key: "shared", content: "mine" });
    await storeMemory({ userId: "someone-else", familyId: "demo-family", category: "note", key: "shared", content: "theirs" });
    expect(rows()).toHaveLength(2);
  });

  it("refuses a fact with no subject key — the key IS the identity", async () => {
    // An empty key would collide with every other empty-key fact under
    // UNIQUE(userId, key), so the bank would hold one row for all of them.
    const stored = await storeMemory({ userId: "consuela", familyId: "demo-family", category: "note", key: "   ", content: "x" });
    expect(stored).toBeNull();
    expect(rows()).toHaveLength(0);
  });
});

/**
 * F1 — the family's own words.
 *
 * The store used to fold the content, the tags, the person AND the key on
 * write, so "Begoña" was stored as "Begona" — in the console, in the prompt
 * the model reads, in the agent's answer and in the export, irreversibly
 * (the history was folded too, so the raw spelling was stored NOWHERE).
 * The stated reason was false: Task 1's token list carries the folded AND the
 * raw form of an accented word, so a row stored WITH its accent is reached
 * either way. Only the KEY is a machine identity, and only the KEY is folded.
 */
describe("the family's own words (F1)", () => {
  it("stores the content, the tags and the person exactly as they were written", async () => {
    const stored = await storeMemory({
      ...BASE,
      key: "person_begoña",
      content: "Begoña loves tacos at Café Sardegna",
      tags: ["Begoña"],
      person: "Begoña",
    });
    expect(stored?.content).toBe("Begoña loves tacos at Café Sardegna");
    expect(stored?.person).toBe("Begoña");
    expect(stored?.tags).toEqual(["Begoña"]);
    expect(rows()[0].content).toBe("Begoña loves tacos at Café Sardegna");
    expect(rows()[0].tags).toBe(JSON.stringify(["Begoña"]));
  });

  it("folds ONLY the subject key — a key is a machine identity", async () => {
    const stored = await storeMemory({ ...BASE, key: "person_begoña", content: "Begoña loves tacos" });
    expect(stored?.key).toBe("person_begona");
  });

  it("keeps the superseded wording exactly as it was written", async () => {
    await storeMemory({ ...BASE, key: "k", content: "Begoña loves tacos" });
    const second = await storeMemory({ ...BASE, key: "k", content: "Begoña loves tacos at Café Sardegna" });
    expect(second?.history[0].content).toBe("Begoña loves tacos");
    expect(JSON.parse(rows()[0].history)[0].content).toBe("Begoña loves tacos");
  });

  it("the prompt block shows the family's spelling", async () => {
    await storeMemory({ ...BASE, key: "k", content: "Begoña loves tacos", person: "Begoña" });
    const ctx = await buildMemoryContext("consuela", "demo-family", "what does Begoña like");
    expect(ctx).toContain("Begoña");
  });

  it("updateMemory keeps the spelling too", async () => {
    const stored = await storeMemory({ ...BASE, key: "k", content: "Begoña loves tacos" });
    const updated = await updateMemory(stored!.id, { content: "Begoña loves tacos at Café Sardegna", person: "Begoña" });
    expect(updated?.content).toBe("Begoña loves tacos at Café Sardegna");
    expect(updated?.person).toBe("Begoña");
  });
});

/**
 * F2 — the read side folds for the COMPARISON only.
 *
 * The write folds the key, so the read must fold it too, and the person and
 * the tags are compared the way the family means them: case-insensitively
 * and accent-insensitively.
 */
describe("the read side (F2)", () => {
  beforeEach(async () => {
    await storeMemory({ ...BASE, key: "person_begoña", content: "Begoña loves tacos", person: "Begoña", tags: ["Begoña"] });
  });

  it("finds the row by the accented key", async () => {
    const hits = await queryMemories({ userId: "consuela", familyId: "demo-family", key: "person_begoña" });
    expect(hits.map((h) => h.key)).toEqual(["person_begona"]);
  });

  it("finds the row by the folded key", async () => {
    const hits = await queryMemories({ userId: "consuela", familyId: "demo-family", key: "person_begona" });
    expect(hits.map((h) => h.key)).toEqual(["person_begona"]);
  });

  it("finds the row by the accented person", async () => {
    const hits = await queryMemories({ userId: "consuela", familyId: "demo-family", person: "Begoña" });
    expect(hits.map((h) => h.key)).toEqual(["person_begona"]);
  });

  it("finds the row by the accented tag", async () => {
    const hits = await queryMemories({ userId: "consuela", familyId: "demo-family", tags: ["Begoña"] });
    expect(hits.map((h) => h.key)).toEqual(["person_begona"]);
  });

  it("finds the row by a search that carries the accent", async () => {
    const hits = await queryMemories({ userId: "consuela", familyId: "demo-family", search: "Begoña tacos" });
    expect(hits.map((h) => h.key)).toEqual(["person_begona"]);
  });
});

/**
 * F4 — a failed READ is not "not found".
 *
 * The store used to catch every read error into `null`, so a failed read
 * looked like a missing row: the store took the CREATE path, the UNIQUE
 * index turned it into a 400, and the family's correction was lost on a
 * perfectly healthy store.
 */
describe("a read that fails (F4)", () => {
  it("does not create a second row and does not claim success", async () => {
    await storeMemory({ ...BASE, key: "k", content: "the original wording" });
    mocks.state.failRead = true;
    const out = await storeMemory({ ...BASE, key: "k", content: "the family's correction" });
    mocks.state.failRead = false;
    expect(out).toBeNull();
    expect(rows()).toHaveLength(1);
    expect(rows()[0].content).toBe("the original wording");
  });

  it("the failed read never reaches the create path", async () => {
    await storeMemory({ ...BASE, key: "k", content: "the original wording" });
    mocks.state.calls.length = 0;
    mocks.state.failRead = true;
    await storeMemory({ ...BASE, key: "k", content: "the family's correction" });
    mocks.state.failRead = false;
    expect(mocks.state.calls.some((c: FakePbCall) => c.method === "create")).toBe(false);
  });
});

/**
 * F5 — two writers, one subject.
 *
 * The read-modify-write was unserialised, so two concurrent replacements
 * both read version 1, both wrote version 2, and one superseded wording was
 * LOST. The repo already owns `withKeyedLock` for exactly this shape.
 */
describe("two writers on one subject (F5)", () => {
  it("keeps both wordings and the version reaches 3", async () => {
    await storeMemory({ ...BASE, key: "k", content: "v1" });
    await Promise.all([
      replaceMemoryContent({ userId: "consuela", familyId: "demo-family", key: "k", content: "v2" }),
      replaceMemoryContent({ userId: "consuela", familyId: "demo-family", key: "k", content: "v3" }),
    ]);
    const history = JSON.parse(rows()[0].history);
    expect(rows()[0].version).toBe(3);
    expect(history.map((h: any) => h.content).sort()).toEqual(["v1", "v2"]);
  });

  it("two concurrent stores of the SAME subject leave ONE row", async () => {
    const [a, b] = await Promise.all([
      storeMemory({ ...BASE, key: "k", content: "A" }),
      storeMemory({ ...BASE, key: "k", content: "B" }),
    ]);
    expect(rows()).toHaveLength(1);
    expect([a, b].filter((x) => x !== null)).toHaveLength(2);
  });
});

/**
 * F6 — a row written before the schema change.
 *
 * PocketBase returns "" for an unset text field and 0 for an unset number
 * field — not null, not undefined — so `??` does not catch them: every
 * legacy row read back with status "" and was dropped by `listActiveFacts`,
 * which is exactly the always-injected core block.
 */
describe("a row written before the schema change (F6)", () => {
  beforeEach(() => {
    rows().push({
      id: "legacy", userId: "consuela", familyId: "demo-family", category: "note",
      key: "legacy", content: "an old note", tags: "[]", confidence: 0, usageCount: 0,
      createdAt: "", updatedAt: "", lastUsed: "",
    });
  });

  it("is ACTIVE — an empty status means the column was never set", async () => {
    const list = await listActiveFacts("demo-family");
    expect(list.map((f) => f.key)).toEqual(["legacy"]);
  });

  it("its version reads back as 1, not 0", async () => {
    const hits = await queryMemories({ userId: "consuela", familyId: "demo-family" });
    expect(hits[0].version).toBe(1);
  });

  it("its first replacement records version 1 and writes version 2", async () => {
    const out = await replaceMemoryContent({ userId: "consuela", familyId: "demo-family", key: "legacy", content: "new" });
    expect(out?.version).toBe(2);
    expect(out?.history[0].version).toBe(1);
  });
});

/**
 * F8 — the schema is not live yet.
 *
 * Between Task 2 and Task 3 a write that carries the new columns SUCCEEDS
 * (200) and PocketBase DROPS the unknown fields — so a correction replaced
 * the row and DESTROYED the previous wording: the history write was dropped
 * with it. The store must notice and refuse.
 */
describe("the schema is not live yet (F8)", () => {
  beforeEach(() => {
    mocks.state.schema = { ...OLD_SCHEMA };
  });

  it("refuses the destructive write instead of destroying the old text", async () => {
    await storeMemory({ ...BASE, key: "k", content: "the original wording" });
    await expect(storeMemory({ ...BASE, key: "k", content: "the family's correction" })).rejects.toBeInstanceOf(MemoryStoreError);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].content).toBe("the original wording");
  });

  it("the refusal carries a machine code the caller can answer with", async () => {
    await storeMemory({ ...BASE, key: "k", content: "the original wording" });
    const error = await storeMemory({ ...BASE, key: "k", content: "x" }).catch((e) => e);
    expect(error?.code).toBe("memory_schema_not_ready");
  });

  it("a NEW fact is still allowed — nothing is destroyed by creating a row", async () => {
    const stored = await storeMemory({ ...BASE, key: "fresh", content: "a new fact" });
    expect(stored?.content).toBe("a new fact");
    expect(rows()).toHaveLength(1);
  });

  it("the store still WORKS on the old schema — it must not filter on a column that does not exist", async () => {
    // The fake rejects a filter naming an undeclared column with a 400, so
    // a `status != "archived"` clause would fail this test outright.
    await storeMemory({ ...BASE, key: "k", content: "a fact" });
    const hits = await queryMemories({ userId: "consuela", familyId: "demo-family" });
    expect(hits.map((h) => h.key)).toEqual(["k"]);
  });
});

/**
 * F9/F10 — the shape of what the caller hands over.
 */
describe("the shape of the input (F9, F10)", () => {
  it("a non-array tags is coerced, not a crash", async () => {
    const stored = await storeMemory({ ...BASE, key: "k", content: "x", tags: "oops" as any });
    expect(stored?.tags).toEqual([]);
    expect(rows()).toHaveLength(1);
  });

  it("refuses to store a fact with no content", async () => {
    const stored = await storeMemory({ ...BASE, key: "k", content: "" });
    expect(stored).toBeNull();
    expect(rows()).toHaveLength(0);
  });

  it("refuses to erase a fact's text with an empty correction", async () => {
    await storeMemory({ ...BASE, key: "k", content: "Bailey is allergic to peanuts" });
    const out = await replaceMemoryContent({ userId: "consuela", familyId: "demo-family", key: "k", content: "" });
    expect(out).toBeNull();
    expect(rows()[0].content).toBe("Bailey is allergic to peanuts");
  });
});

describe("replaceMemoryContent", () => {
  it("keeps the previous text in history and bumps the version", async () => {
    await storeMemory({ userId: "consuela", familyId: "demo-family", category: "preference", key: "meal_emoji", content: "include an emoji" });
    const replaced = await replaceMemoryContent({
      userId: "consuela", familyId: "demo-family", key: "meal_emoji",
      content: "include a relevant emoji", source: "parent", by: "Rebecca",
    });
    expect(replaced?.version).toBe(2);
    expect(replaced?.history).toHaveLength(1);
    expect(replaced?.history[0].content).toBe("include an emoji");
    expect(replaced?.history[0].by).toBe("Rebecca");
  });

  it("returns null when the subject does not exist", async () => {
    const out = await replaceMemoryContent({ userId: "consuela", familyId: "demo-family", key: "nope", content: "x" });
    expect(out).toBeNull();
  });

  it("keeps the history bounded — the oldest text is dropped first", async () => {
    await storeMemory({ userId: "consuela", familyId: "demo-family", category: "preference", key: "meal_emoji", content: "v0" });
    for (let i = 1; i <= 12; i += 1) {
      await replaceMemoryContent({ userId: "consuela", familyId: "demo-family", key: "meal_emoji", content: `v${i}` });
    }
    const out = await replaceMemoryContent({ userId: "consuela", familyId: "demo-family", key: "meal_emoji", content: "v13" });
    expect(out?.history).toHaveLength(10);
    expect(out?.history[0].content).toBe("v3");
  });
});

describe("queryMemories", () => {
  it("finds a row by a multi-word search", async () => {
    await storeMemory({ ...BASE, key: "allergy_peanuts_emily", content: "Emily is allergic to peanuts" });
    const hits = await queryMemories({ userId: "consuela", familyId: "demo-family", search: "allergic peanuts" });
    expect(hits.length).toBeGreaterThan(0);
  });

  it("reaches a fact whose ONLY hit is in its subject key", async () => {
    await storeMemory({ ...BASE, key: "allergy_peanuts_emily", content: "Emily must avoid them" });
    const hits = await queryMemories({ userId: "consuela", familyId: "demo-family", search: "peanuts" });
    expect(hits.map((h) => h.key)).toEqual(["allergy_peanuts_emily"]);
  });

  it("filters by person", async () => {
    await storeMemory({ ...BASE, key: "a", content: "x", person: "Emily" });
    await storeMemory({ ...BASE, key: "b", content: "y", person: "Bailey" });
    const hits = await queryMemories({ userId: "consuela", familyId: "demo-family", person: "Bailey" });
    expect(hits.map((h) => h.key)).toEqual(["b"]);
  });

  it("does not answer a person query with facts that have no person", async () => {
    await storeMemory({ ...BASE, category: "note", key: "family_note", content: "The wifi code is in the drawer" });
    await storeMemory({ ...BASE, key: "a", content: "Bailey reacts to nuts", person: "Bailey" });
    const hits = await queryMemories({ userId: "consuela", familyId: "demo-family", person: "Bailey" });
    expect(hits.map((h) => h.key)).toEqual(["a"]);
  });

  it("excludes archived rows", async () => {
    await storeMemory({ ...BASE, category: "note", key: "old", content: "z" });
    rows()[0].status = "archived";
    const hits = await queryMemories({ userId: "consuela", familyId: "demo-family" });
    expect(hits).toHaveLength(0);
  });

  it("excludes an archived row whatever the casing (F11)", async () => {
    await storeMemory({ ...BASE, category: "note", key: "old", content: "z" });
    rows()[0].status = "Archived";
    const hits = await queryMemories({ userId: "consuela", familyId: "demo-family" });
    expect(hits).toHaveLength(0);
  });

  it("a search whose every word is a stop word returns NOTHING, not the whole bank (F13)", async () => {
    await storeMemory({ ...BASE, key: "a", content: "alpha" });
    await storeMemory({ ...BASE, key: "b", content: "beta" });
    const hits = await queryMemories({ userId: "consuela", familyId: "demo-family", search: "the" });
    expect(hits).toHaveLength(0);
  });

  it("never reads the whole table (F15)", async () => {
    await storeMemory({ ...BASE, key: "a", content: "alpha" });
    mocks.state.calls.length = 0;
    await queryMemories({ userId: "consuela", familyId: "demo-family", search: "alpha" });
    const reads = mocks.state.calls.filter((c: FakePbCall) => c.method === "getList" || c.method === "getFullList");
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.some((c: FakePbCall) => c.method === "getFullList")).toBe(false);
    for (const read of reads) {
      if (read.method !== "getList") continue;
      expect(read.args[1]).toBeLessThanOrEqual(200);
      expect(read.args[2]?.fields).toBeTruthy();
    }
  });
});

describe("listActiveFacts", () => {
  it("returns only active rows", async () => {
    await storeMemory({ ...BASE, category: "note", key: "live", content: "l" });
    await storeMemory({ ...BASE, category: "note", key: "dead", content: "d" });
    rows()[1].status = "archived";
    const list = await listActiveFacts("demo-family");
    expect(list.map((f) => f.key)).toEqual(["live"]);
  });
});

describe("the family a row belongs to (F14)", () => {
  it("a correction moves the row to the family it was written into", async () => {
    await storeMemory({ ...BASE, familyId: "old-family", key: "k", content: "v1" });
    await storeMemory({ ...BASE, familyId: "new-family", key: "k", content: "v2" });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].familyId).toBe("new-family");
  });

  it("replaceMemoryContent moves it too", async () => {
    await storeMemory({ ...BASE, familyId: "old-family", key: "k", content: "v1" });
    await replaceMemoryContent({ userId: "consuela", familyId: "new-family", key: "k", content: "v2" });
    expect(rows()[0].familyId).toBe("new-family");
  });
});

describe("a store that is down", () => {
  beforeEach(() => {
    mocks.state.failRead = true;
  });

  it("propagates the failure instead of answering with an empty list", async () => {
    // An empty list is a confident "the family has no memories" — the answer
    // this codebase already gave during a PocketBase outage.
    await expect(queryMemories({ userId: "consuela", familyId: "demo-family" })).rejects.toThrow();
  });

  it("propagates the failure from listActiveFacts too", async () => {
    await expect(listActiveFacts("demo-family")).rejects.toThrow();
  });

  it("does not report zero memories when the store is down", async () => {
    await expect(getMemoryStats("demo-family")).rejects.toThrow();
  });
});

/**
 * The third review's findings on the store itself: the key must be stored
 * and looked up the SAME way (SQLite's `=` is case-sensitive, so "UPPER_KEY"
 * and "upper_key" would be two rows under a UNIQUE index that cannot see the
 * difference), and the console's edit must be a CORRECTION — with the old
 * wording kept and the version moved on — not a silent overwrite.
 */
describe("the subject key is written and read the same way (F2/N5)", () => {
  it("stores the key lowercased", async () => {
    const stored = await storeMemory({
      userId: "consuela",
      familyId: "demo-family",
      category: "note",
      key: "UPPER_KEY",
      content: "x",
    });
    expect(stored?.key).toBe("upper_key");
  });

  it("finds a row by the key whatever case it is asked in", async () => {
    await storeMemory({ userId: "consuela", familyId: "demo-family", category: "note", key: "Meal_Emoji", content: "x" });
    const hits = await queryMemories({ userId: "consuela", familyId: "demo-family", key: "meal_emoji" });
    expect(hits).toHaveLength(1);
  });

  it("cannot become two rows under a case difference", async () => {
    await storeMemory({ userId: "consuela", familyId: "demo-family", category: "note", key: "Same_Key", content: "one" });
    await storeMemory({ userId: "consuela", familyId: "demo-family", category: "note", key: "same_key", content: "two" });
    const hits = await queryMemories({ userId: "consuela", familyId: "demo-family", key: "same_key" });
    expect(hits).toHaveLength(1);
    expect(hits[0].content).toBe("two");
  });
});

describe("the console's edit is a correction, not a silent overwrite (F10/N14)", () => {
  it("keeps the old wording in the history and moves the version on", async () => {
    const stored = await storeMemory({
      userId: "consuela",
      familyId: "demo-family",
      category: "preference",
      key: "meal_emoji",
      content: "include an emoji",
    });
    const updated = await updateMemory(stored!.id, { content: "include a relevant emoji" });
    expect(updated?.content).toBe("include a relevant emoji");
    expect(updated?.version).toBe(2);
    expect(updated?.history).toHaveLength(1);
    expect(updated?.history[0].content).toBe("include an emoji");
  });

  it("refuses to blank a fact", async () => {
    const stored = await storeMemory({
      userId: "consuela",
      familyId: "demo-family",
      category: "preference",
      key: "meal_emoji",
      content: "include an emoji",
    });
    const blanked = await updateMemory(stored!.id, { content: "   " });
    expect(blanked).toBeNull();
    const still = await queryMemories({ userId: "consuela", familyId: "demo-family", key: "meal_emoji" });
    expect(still[0].content).toBe("include an emoji");
  });
});
