import { describe, it, expect, vi, beforeEach } from "vitest";

const rows: any[] = [];
const mocks = vi.hoisted(() => ({ pb: null as any }));

vi.mock("@/lib/pb-auth", () => ({
  getAuthedPB: async () => mocks.pb,
}));

import { storeMemory, replaceMemoryContent, queryMemories, listActiveFacts, getMemoryStats } from "@/lib/family-memory";

/**
 * A fake PocketBase that honours the filter the store actually sends.
 * The brief's fake ignored the filter and matched on a hard-coded key, so it
 * could not tell a correct lookup from a wrong one — and it could not fail
 * when the filter named a column the collection does not have.
 */
function parseEquals(filter: string): Array<[string, string]> {
  return [...filter.matchAll(/([A-Za-z_]+) = "([^"]*)"/g)].map((m) => [m[1], m[2]] as [string, string]);
}
function parseNotEquals(filter: string): Array<[string, string]> {
  return [...filter.matchAll(/([A-Za-z_]+) != "([^"]*)"/g)].map((m) => [m[1], m[2]] as [string, string]);
}
function parseLikes(filter: string): Array<[string, string]> {
  return [...filter.matchAll(/([A-Za-z_]+) ~ "([^"]*)"/g)].map((m) => [m[1], m[2].toLowerCase()] as [string, string]);
}
/** The equality conditions are ANDed; the LIKE clauses are ORed — the same
 *  shape `buildMemoryFilter` produces. A LIKE is a byte-wise substring match
 *  that folds ASCII case and nothing else. */
function matches(row: any, filter: string): boolean {
  for (const [field, value] of parseEquals(filter)) {
    if (String(row[field] ?? "") !== value) return false;
  }
  for (const [field, value] of parseNotEquals(filter)) {
    if (String(row[field] ?? "") === value) return false;
  }
  const likes = parseLikes(filter);
  if (likes.length && !likes.some(([field, term]) => String(row[field] ?? "").toLowerCase().includes(term))) {
    return false;
  }
  return true;
}

function fakePb() {
  return {
    collection: () => ({
      getFirstListItem: async (filter: string) => {
        const row = rows.find((r) => matches(r, filter));
        if (!row) throw new Error("not found");
        return row;
      },
      getFullList: async ({ filter }: any) => {
        if (!filter) return rows.slice();
        return rows.filter((r) => matches(r, filter));
      },
      create: async (data: any) => { const row = { id: `r${rows.length + 1}`, ...data }; rows.push(row); return row; },
      update: async (id: string, data: any) => {
        const row = rows.find((r) => r.id === id)!;
        Object.assign(row, data);
        return row;
      },
      getOne: async (id: string) => rows.find((r) => r.id === id)!,
      delete: async (id: string) => { const i = rows.findIndex((r) => r.id === id); rows.splice(i, 1); },
    }),
  };
}

beforeEach(() => {
  rows.length = 0;
  mocks.pb = fakePb();
});

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
    expect(rows).toHaveLength(1);
  });

  it("replaces the existing subject in place instead of creating a second row", async () => {
    await storeMemory({ userId: "consuela", familyId: "demo-family", category: "preference", key: "meal_emoji", content: "include an emoji" });
    await storeMemory({ userId: "consuela", familyId: "demo-family", category: "preference", key: "meal_emoji", content: "include a relevant emoji" });
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("include a relevant emoji");
  });

  it("keeps the subject per user — the same subject in another namespace is another row", async () => {
    await storeMemory({ userId: "consuela", familyId: "demo-family", category: "note", key: "shared", content: "mine" });
    await storeMemory({ userId: "someone-else", familyId: "demo-family", category: "note", key: "shared", content: "theirs" });
    expect(rows).toHaveLength(2);
  });

  it("refuses a fact with no subject key — the key IS the identity", async () => {
    // An empty key would collide with every other empty-key fact under
    // UNIQUE(userId, key), so the bank would hold one row for all of them.
    const stored = await storeMemory({ userId: "consuela", familyId: "demo-family", category: "note", key: "   ", content: "x" });
    expect(stored).toBeNull();
    expect(rows).toHaveLength(0);
  });

  it("stores the content, tags, person and key FOLDED, so a byte-wise LIKE can reach the row", async () => {
    const stored = await storeMemory({
      userId: "consuela",
      familyId: "demo-family",
      category: "preference",
      key: "person_begoña",
      content: "Begoña loves tacos",
      tags: ["Begoña"],
      person: "Begoña",
    });
    expect(stored?.content).toBe("Begona loves tacos");
    expect(stored?.person).toBe("Begona");
    expect(stored?.tags).toEqual(["Begona"]);
    expect(stored?.key).toBe("person_begona");
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
    await storeMemory({ userId: "consuela", familyId: "demo-family", category: "allergy", key: "allergy_peanuts_emily", content: "Emily is allergic to peanuts" });
    const hits = await queryMemories({ userId: "consuela", familyId: "demo-family", search: "allergic peanuts" });
    expect(hits.length).toBeGreaterThan(0);
  });

  it("reaches a fact whose ONLY hit is in its subject key", async () => {
    await storeMemory({ userId: "consuela", familyId: "demo-family", category: "allergy", key: "allergy_peanuts_emily", content: "Emily must avoid them" });
    const hits = await queryMemories({ userId: "consuela", familyId: "demo-family", search: "peanuts" });
    expect(hits.map((h) => h.key)).toEqual(["allergy_peanuts_emily"]);
  });

  it("filters by person", async () => {
    await storeMemory({ userId: "consuela", familyId: "demo-family", category: "allergy", key: "a", content: "x", person: "Emily" });
    await storeMemory({ userId: "consuela", familyId: "demo-family", category: "allergy", key: "b", content: "y", person: "Bailey" });
    const hits = await queryMemories({ userId: "consuela", familyId: "demo-family", person: "Bailey" });
    expect(hits.map((h) => h.key)).toEqual(["b"]);
  });

  it("does not answer a person query with facts that have no person", async () => {
    await storeMemory({ userId: "consuela", familyId: "demo-family", category: "note", key: "family_note", content: "The wifi code is in the drawer" });
    await storeMemory({ userId: "consuela", familyId: "demo-family", category: "allergy", key: "a", content: "Bailey reacts to nuts", person: "Bailey" });
    const hits = await queryMemories({ userId: "consuela", familyId: "demo-family", person: "Bailey" });
    expect(hits.map((h) => h.key)).toEqual(["a"]);
  });

  it("excludes archived rows", async () => {
    await storeMemory({ userId: "consuela", familyId: "demo-family", category: "note", key: "old", content: "z" });
    rows[0].status = "archived";
    const hits = await queryMemories({ userId: "consuela", familyId: "demo-family" });
    expect(hits).toHaveLength(0);
  });
});

describe("listActiveFacts", () => {
  it("returns only active rows", async () => {
    await storeMemory({ userId: "consuela", familyId: "demo-family", category: "note", key: "live", content: "l" });
    await storeMemory({ userId: "consuela", familyId: "demo-family", category: "note", key: "dead", content: "d" });
    rows[1].status = "archived";
    const list = await listActiveFacts("demo-family");
    expect(list.map((f) => f.key)).toEqual(["live"]);
  });
});

describe("a store that is down", () => {
  beforeEach(() => {
    mocks.pb = {
      collection: () => ({
        getFullList: async () => { throw new Error("PB down"); },
      }),
    };
  });

  it("propagates the failure instead of answering with an empty list", async () => {
    // An empty list is a confident "the family has no memories" — the answer
    // this codebase already gave during a PocketBase outage.
    await expect(queryMemories({ userId: "consuela", familyId: "demo-family" })).rejects.toThrow("PB down");
  });

  it("propagates the failure from listActiveFacts too", async () => {
    await expect(listActiveFacts("demo-family")).rejects.toThrow("PB down");
  });

  it("does not report zero memories when the store is down", async () => {
    await expect(getMemoryStats("demo-family")).rejects.toThrow("PB down");
  });
});
