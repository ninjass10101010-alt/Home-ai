import { describe, it, expect, vi, afterEach } from "vitest";
import {
  tokenize,
  escapeFilterValue,
  buildMemoryFilter,
  parseTagList,
  scoreMemory,
  rankFacts,
  selectCoreFacts,
  searchMessages,
  MEMORY_STOP_WORDS,
} from "@/lib/memory-search";

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("keeps an accented word as ONE token instead of splitting it into fragments", () => {
    // "Begoña" used to become "bego" plus a two-letter fragment, and a
    // fragment like "oz" matched unrelated rows ("frozen"). The folded form
    // is what every comparison in the module speaks.
    expect(tokenize("Begoña Muñoz")).toEqual(["begona", "munoz"]);
    expect(tokenize("Éloise José")).toEqual(["eloise", "jose"]);
  });

  it("filters on the folded form — so the bank must store the folded form too", () => {
    // PocketBase's LIKE compares bytes and cannot fold, so the filter can
    // only ever reach a row whose text is already folded. This pins that
    // half of the contract: the query side folds, the write side must too.
    expect(buildMemoryFilter(tokenize("Begoña Muñoz"))).toContain('content ~ "begona"');
    expect(buildMemoryFilter(tokenize("Begoña Muñoz"))).toContain('key ~ "munoz"');
  });
});

describe("MEMORY_STOP_WORDS", () => {
  it("prunes a message that is only stop words", () => {
    expect(MEMORY_STOP_WORDS.has("the")).toBe(true);
    expect(tokenize("the and of it is on to for with you")).toEqual([]);
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
    // The term reaches the escaper RAW, the way a direct caller passes it.
    // Tokenising first would strip the quote before the filter is built, and
    // the assertion would then hold even with the escaping deleted.
    const filter = buildMemoryFilter(['say "hi"']);
    expect(filter).toContain('content ~ "say \'hi\'"');
    expect(filter).not.toContain('""');
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

  it("scores a fact whose KEY carries the term — the filter searches key, so the scorer must too", () => {
    // The subject key IS the topic slug ("preference_sushi_bailey"), so a query
    // for the topic can only match the key. If the scorer ignored the key the
    // fact would be fetched by the filter and then dropped by the caller's
    // `score > 0` filter — fetched, scored zero, forgotten.
    const mem = {
      id: "k1",
      category: "preference",
      key: "preference_sushi_bailey",
      content: "Bailey likes the yellow rolls",
      confidence: 0.9,
    };
    expect(scoreMemory(mem, ["sushi"])).toBeGreaterThan(0);
  });

  it("treats an empty term as matching nothing — the filter builds none for it either", () => {
    // An empty LIKE matches every row, so the two entry points disagreed: the
    // filter produced nothing while the scorer matched the whole bank.
    expect(buildMemoryFilter([""])).toBe("");
    expect(scoreMemory(base, [""])).toBe(0);
  });

  it("scores an accented fact against the folded term — the comparison folds both sides", () => {
    // The bank may still hold "Begoña loves sushi" while the query side says
    // "begona". Every comparison this module owns folds, so the fact still
    // scores; the filter half of the contract is pinned in the tokenize block.
    const mem = {
      id: "a1",
      category: "preference",
      key: "bego_a_loves_sushi",
      content: "Begoña loves sushi",
      confidence: 0.9,
    };
    expect(scoreMemory(mem, ["begona"])).toBeGreaterThan(0);
  });

  it("never returns NaN or -Infinity for a broken confidence or usage count", () => {
    // NaN > 0 is false, so a NaN score made the caller's `score > 0` filter
    // drop the fact silently, and a NaN comparator left the sort order at
    // the caller's mercy.
    const broken = {
      id: "b1",
      category: "note",
      content: "sushi",
      confidence: Number.NaN,
      usageCount: -1,
    };
    const score = scoreMemory(broken, ["sushi"]);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThan(0);
    const text = { ...broken, confidence: "abc" as unknown as number };
    expect(Number.isFinite(scoreMemory(text, ["sushi"]))).toBe(true);
    const infinite = { ...broken, confidence: Number.POSITIVE_INFINITY };
    expect(Number.isFinite(scoreMemory(infinite, ["sushi"]))).toBe(true);
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

  it("never reads the wall clock — the durable order must not move with the calendar", () => {
    const mems = [
      { id: "sure", category: "note", content: "c", confidence: 0.9, usageCount: 0, updatedAt: "2026-10-01T00:00:00Z" },
      { id: "used", category: "note", content: "u", confidence: 0.5, usageCount: 9, updatedAt: "2026-01-01T00:00:00Z" },
    ];
    const clock = vi.spyOn(Date, "now");
    rankFacts(mems);
    expect(clock).not.toHaveBeenCalled();
  });

  it("returns the same order when the clock moves", () => {
    const mems = [
      { id: "sure", category: "note", content: "c", confidence: 0.9, usageCount: 0, updatedAt: "2026-10-01T00:00:00Z" },
      { id: "used", category: "note", content: "u", confidence: 0.5, usageCount: 9, updatedAt: "2026-01-01T00:00:00Z" },
    ];
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-21T00:00:00Z"));
    const first = rankFacts(mems).map((m) => m.id);
    clock.mockReturnValue(Date.parse("2031-10-21T00:00:00Z"));
    const second = rankFacts(mems).map((m) => m.id);
    expect(second).toEqual(first);
  });

  it("keeps a broken confidence from poisoning the durable order", () => {
    const ranked = rankFacts([
      { id: "broken", category: "note", content: "b", confidence: Number.NaN, usageCount: 0 },
      { id: "good", category: "note", content: "g", confidence: 0.9, usageCount: 0 },
    ]);
    expect(ranked.map((m) => m.id)).toEqual(["good", "broken"]);
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

  it("keeps a safety fact AND a discretionary fact when the budget only fits one", () => {
    // The budget rations the DISCRETIONARY facts. Charging a safety fact
    // against it would let an allergy push a preference out of the prompt —
    // the opposite of what "a safety fact is always kept" means.
    const kept = selectCoreFacts(
      [
        { id: "safe", category: "allergy", content: "x".repeat(40), confidence: 0.9 },
        { id: "note", category: "preference", content: "y".repeat(40), confidence: 0.9 },
      ],
      { budget: 48 },
    );
    expect(kept.map((f) => f.id)).toEqual(["safe", "note"]);
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

  it("returns the NEWEST match first when the relevance ties", () => {
    // The session loader hands the turns over newest-first (sort "-createdAt"),
    // so a tie must keep that order — reversing it would hand the model the
    // oldest conversations and drop the newest off the end.
    const tied = [
      { content: "the pool party", role: "user", createdAt: "2026-10-01T10:00:00Z" },
      { content: "pool party plans", role: "user", createdAt: "2026-10-03T10:00:00Z" },
      { content: "another pool chat", role: "user", createdAt: "2026-10-02T10:00:00Z" },
    ];
    const hits = searchMessages(tied, ["pool"]);
    expect(hits.map((h) => h.createdAt)).toEqual([
      "2026-10-03T10:00:00Z",
      "2026-10-02T10:00:00Z",
      "2026-10-01T10:00:00Z",
    ]);
  });

  it("keeps the NEWEST matches when the limit bites", () => {
    const tied = [
      { content: "the pool party", role: "user", createdAt: "2026-10-01T10:00:00Z" },
      { content: "pool party plans", role: "user", createdAt: "2026-10-03T10:00:00Z" },
      { content: "another pool chat", role: "user", createdAt: "2026-10-02T10:00:00Z" },
    ];
    const hits = searchMessages(tied, ["pool"], 2);
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.createdAt)).toEqual([
      "2026-10-03T10:00:00Z",
      "2026-10-02T10:00:00Z",
    ]);
  });

  it("treats an empty term as matching nothing", () => {
    expect(searchMessages(rows, [""])).toHaveLength(0);
  });
});
