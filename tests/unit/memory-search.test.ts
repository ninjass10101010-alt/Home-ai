import { describe, it, expect } from "vitest";
import {
  tokenize,
  escapeFilterValue,
  buildMemoryFilter,
  parseTagList,
  scoreMemory,
  rankFacts,
  selectCoreFacts,
  searchMessages,
} from "@/lib/memory-search";

describe("tokenize", () => {
  it("drops stop-words, punctuation and 1-char tokens, and keeps content words in order", () => {
    expect(tokenize("What should we make for dinner tonight?")).toEqual([
      "make", "dinner", "tonight",
    ]);
  });

  it("dedupes and caps the term count at 12", () => {
    // 13 distinct content words plus a repeat: the cap must cut the tail and
    // the repeat must not appear twice.
    const terms = tokenize(
      "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november alpha",
    );
    expect(terms).toEqual([
      "alpha", "bravo", "charlie", "delta", "echo", "foxtrot",
      "golf", "hotel", "india", "juliet", "kilo", "lima",
    ]);
    expect(terms.length).toBeLessThanOrEqual(12);
    expect(new Set(terms).size).toBe(terms.length);
    expect(tokenize("alpha bravo charlie", { max: 2 })).toEqual(["alpha", "bravo"]);
    expect(tokenize("alpha bravo", { max: 0 })).toEqual([]);
  });

  it("keeps short but meaningful words that are not stop-words", () => {
    expect(tokenize("Bailey likes sushi")).toEqual(["bailey", "likes", "sushi"]);
  });
});

describe("escapeFilterValue", () => {
  it("neutralises the characters that break a PocketBase filter", () => {
    expect(escapeFilterValue('what is for "dinner"')).toBe("what is for 'dinner'");
    expect(escapeFilterValue("50% off")).toBe("50 per cent off");
    expect(escapeFilterValue("a_b")).toBe("a b");
    expect(escapeFilterValue("back\\slash")).toBe("back slash");
  });
});

describe("buildMemoryFilter", () => {
  it("builds one OR across content, tags and key", () => {
    const filter = buildMemoryFilter(["dinner", "emily"]);
    expect(filter).toContain('content ~ "dinner"');
    expect(filter).toContain('content ~ "emily"');
    expect(filter).toContain('tags ~ "dinner"');
    expect(filter).toContain('key ~ "emily"');
    expect(filter).toContain("||");
  });

  it("returns an empty string when there are no terms (no filter is built)", () => {
    expect(buildMemoryFilter([])).toBe("");
  });

  it("never emits a raw double quote", () => {
    expect(buildMemoryFilter(tokenize('say "hi" now'))).not.toContain('""');
  });
});

describe("parseTagList", () => {
  it("parses the JSON-string shape the store writes", () => {
    expect(parseTagList('["Emily"]')).toEqual(["Emily"]);
  });

  it("returns an empty list for junk", () => {
    expect(parseTagList("not json")).toEqual([]);
    expect(parseTagList(undefined)).toEqual([]);
  });
});

describe("scoreMemory", () => {
  const base = { id: "m1", category: "note", key: "k", content: "c", confidence: 0.9 };

  it("scores a person-tagged hit above a content-only hit", () => {
    const tagged = { ...base, content: "loves sushi", tags: ["Emily"] };
    const plain = { ...base, content: "sushi is on the menu" };
    expect(scoreMemory(tagged, ["emily"])).toBeGreaterThan(scoreMemory(plain, ["emily"]));
  });

  it("gives a safety category a boost over an ordinary note", () => {
    const allergy = { ...base, id: "a", category: "allergy", content: "peanuts" };
    const note = { ...base, id: "b", category: "note", content: "peanuts" };
    expect(scoreMemory(allergy, ["peanuts"])).toBeGreaterThan(scoreMemory(note, ["peanuts"]));
  });

  it("scores zero when nothing matches", () => {
    expect(scoreMemory(base, ["zzz"])).toBe(0);
  });

  it("adds the speaker bonus once, not once per term", () => {
    // The bonus belongs to the FACT (its person is the one being asked
    // about), so extra unmatched terms must not inflate it.
    const mem = { id: "s1", category: "note", content: "sushi", person: "Emily", confidence: 0 };
    const one = scoreMemory(mem, ["sushi"], { speakerName: "Emily" });
    const two = scoreMemory(mem, ["sushi", "pasta"], { speakerName: "Emily" });
    expect(one).toBe(two);
    expect(one).toBeGreaterThan(0);
  });

  it("counts a fact as fresh at the epoch — now: 0 is a clock, not 'no clock'", () => {
    const mem = {
      id: "r1",
      category: "note",
      content: "peanuts",
      confidence: 0,
      updatedAt: "1970-01-01T00:00:00.000Z",
    };
    expect(scoreMemory(mem, ["peanuts"], { now: 0 })).toBeCloseTo(1.5, 5);
  });
});

describe("rankFacts", () => {
  it("orders by confidence, usage and recency — not by input order", () => {
    const ranked = rankFacts(
      [
        { id: "stale", category: "note", content: "s", confidence: 0.9, usageCount: 0, updatedAt: "2020-01-01T00:00:00Z" },
        { id: "used", category: "note", content: "u", confidence: 0.5, usageCount: 9, updatedAt: "2020-01-01T00:00:00Z" },
        { id: "sure", category: "note", content: "c", confidence: 0.95, usageCount: 0, updatedAt: "2026-09-30T00:00:00Z" },
      ],
      { now: Date.parse("2026-10-01T00:00:00Z") },
    );
    expect(ranked.map((m) => m.id)).toEqual(["sure", "used", "stale"]);
  });
});

describe("selectCoreFacts", () => {
  const facts = [
    { id: "a", category: "allergy", content: "Emily is allergic to peanuts", confidence: 0.9 },
    { id: "b", category: "preference", content: "Bailey loves sushi", confidence: 0.9 },
    { id: "c", category: "note", content: "x".repeat(400), confidence: 0.5 },
  ];

  it("always keeps a safety fact, even when it is the lowest ranked", () => {
    const kept = selectCoreFacts(facts, { budget: 60 });
    expect(kept.map((f) => f.id)).toContain("a");
  });

  it("keeps a safety fact that does not fit the budget (safety outranks the budget)", () => {
    const kept = selectCoreFacts(
      [{ id: "a", category: "allergy", content: "x".repeat(200), confidence: 0.9 }],
      { budget: 20 },
    );
    expect(kept.map((f) => f.id)).toEqual(["a"]);
  });

  it("never exceeds the character budget for NON-safety facts", () => {
    const kept = selectCoreFacts(
      [
        { id: "a", category: "allergy", content: "short", confidence: 0.9 },
        { id: "c", category: "note", content: "x".repeat(400), confidence: 0.5 },
      ],
      { budget: 60 },
    );
    const total = kept.reduce((n, f) => n + (f.content?.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(60);
  });

  it("ranks the durable facts — confidence, usage and recency, not input order", () => {
    const kept = selectCoreFacts(
      [
        { id: "low", category: "note", content: "l", confidence: 0.2, usageCount: 0 },
        { id: "high", category: "note", content: "h", confidence: 0.95, usageCount: 9 },
      ],
      { budget: 1000 },
    );
    expect(kept.map((f) => f.id)).toEqual(["high", "low"]);
  });
});

describe("searchMessages", () => {
  const rows = [
    { content: "we talked about the pool party", role: "user", createdAt: "2026-10-01T10:00:00Z" },
    { content: "dinner was tacos", role: "assistant", createdAt: "2026-10-02T10:00:00Z" },
  ];

  it("finds a message by a single content term", () => {
    const hits = searchMessages(rows, tokenize("pool party"));
    expect(hits).toHaveLength(1);
    expect(hits[0].content).toContain("pool party");
  });

  it("returns nothing when no term matches", () => {
    expect(searchMessages(rows, tokenize("zebra"))).toHaveLength(0);
  });
});
