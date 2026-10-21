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

/** SQLite's LIKE, as PocketBase runs it: a substring match whose case fold
 *  covers ASCII ONLY — every other character compares byte-exact. Proved
 *  against PocketBase 0.40.5 (`content ~ "begoña"` reaches "Begoña", while
 *  `content ~ "đorđe"` does NOT reach "Đorđe"), so a unit test can assert
 *  what a built filter actually REACHES instead of only what it contains. */
function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
}

function likeMatch(value: string, pattern: string): boolean {
  return asciiLower(value).includes(asciiLower(pattern));
}

/** The `content ~ "…"` patterns of a built filter, in the order they appear. */
function contentClauses(filter: string): string[] {
  return [...filter.matchAll(/content ~ "([^"]+)"/g)].map((m) => m[1]);
}

describe("tokenize", () => {
  it("drops stop-words, punctuation and 1-char tokens, and keeps content words in order", () => {
    expect(tokenize("What should we make for dinner tonight?")).toEqual([
      "make", "dinner", "tonight",
    ]);
  });

  it("drops 1-char tokens — they are a LIKE pattern too wide to be a signal", () => {
    // "b" and "c" are not stop-words, so only the length rule can drop them.
    expect(tokenize("b c sushi")).toEqual(["sushi"]);
    expect(tokenize("É sushi")).toEqual(["sushi"]);
  });

  it("dedupes and caps the term count at 12", () => {
    // 13 distinct content words plus a repeat that lands INSIDE the cap: the
    // cap must cut the tail AND the repeat must not appear twice.
    const terms = tokenize(
      "alpha bravo alpha charlie delta echo foxtrot golf hotel india juliet kilo lima mike november",
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
    // fragment like "oz" matched unrelated rows ("frozen"). The word survives
    // whole — never as a piece of itself.
    expect(tokenize("Begoña Muñoz")).toEqual(["begona", "begoña", "munoz", "muñoz"]);
    expect(tokenize("Begoña Muñoz")).not.toContain("bego");
    expect(tokenize("Begoña Muñoz")).not.toContain("oz");
    expect(tokenize("Søren")).not.toContain("ren");
  });

  it("carries the folded AND the raw form of an accented word — the filter must reach a row stored either way", () => {
    // A PocketBase LIKE compares bytes: it folds ASCII case and nothing else,
    // so "begona" cannot reach a stored "Begoña" and "begoña" cannot reach a
    // stored "Begona". Both forms travel, so the row is reachable either way.
    expect(tokenize("Begoña")).toEqual(["begona", "begoña"]);
    const filter = buildMemoryFilter(tokenize("Begoña"));
    expect(filter).toContain('content ~ "begona"');
    expect(filter).toContain('content ~ "begoña"');
  });

  it("keeps the original case of an accented capital — a LIKE folds ASCII case only", () => {
    // "éloise" cannot reach a stored "Éloise" (SQLite folds ASCII case only),
    // so the capitalised raw form travels too.
    expect(tokenize("Éloise")).toEqual(["eloise", "éloise", "Éloise"]);
    expect(tokenize("José")).toEqual(["jose", "josé"]);
  });

  it("maps the letters NFKD cannot decompose, so a name survives tokenising", () => {
    // ø ł đ ð þ æ œ ß have no Unicode decomposition, so NFKD leaves them
    // and the old splitter cut them into fragments ("Søren" → "ren") or
    // dropped the name entirely ("Đorđe" → nothing).
    expect(tokenize("Søren")).toEqual(["soren", "søren"]);
    expect(tokenize("Đorđe")).toEqual(["dorde", "đorđe", "Đorđe"]);
    expect(tokenize("Łukasz")).toEqual(["lukasz", "łukasz", "Łukasz"]);
    expect(tokenize("Straße")).toEqual(["strasse", "straße"]);
    expect(tokenize("Æthelred")).toEqual(["aethelred", "æthelred", "Æthelred"]);
    expect(tokenize("Þorir")).toEqual(["thorir", "þorir", "Þorir"]);
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

  it("puts content FIRST for every term — the first content term IS the first term", () => {
    // The plan's Task 2 fake PocketBase extracts the term with
    // /content ~ "([^"]+)"/.exec(filter), i.e. it takes the FIRST content
    // clause. If the fields were reordered the fake would silently match a
    // different term, so the order is a contract, not a style choice.
    const filter = buildMemoryFilter(["dinner", "emily"]);
    expect(filter.startsWith('(content ~ "dinner" || tags ~ "dinner" || key ~ "dinner"')).toBe(true);
    expect(contentClauses(filter)[0]).toBe("dinner");
  });

  it("reaches a row stored with the accent AND a row stored folded", () => {
    const filter = buildMemoryFilter(tokenize("Begoña"));
    const clauses = contentClauses(filter);
    const rows = [
      { key: "raw", content: "Begoña loves sushi" },
      { key: "folded", content: "Begona loves sushi" },
      { key: "other", content: "Bailey loves sushi" },
    ];
    const reached = rows.filter((row) => clauses.some((c) => likeMatch(row.content, c)));
    expect(reached.map((r) => r.key)).toEqual(["raw", "folded"]);
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

  it("gives a restriction the safety boost — it is a safety class", () => {
    const restriction = { ...base, id: "r", category: "restriction", content: "no peanuts" };
    const note = { ...base, id: "n", category: "note", content: "no peanuts" };
    expect(scoreMemory(restriction, ["peanuts"])).toBeGreaterThan(scoreMemory(note, ["peanuts"]));
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

  it("scores a fact stored with its accent AND one stored folded — both are found", () => {
    const terms = tokenize("Begoña");
    const raw = { id: "raw", category: "preference", content: "Begoña loves sushi", confidence: 0.9 };
    const folded = { id: "folded", category: "preference", content: "Begona loves sushi", confidence: 0.9 };
    expect(scoreMemory(raw, terms)).toBeGreaterThan(0);
    expect(scoreMemory(folded, terms)).toBeGreaterThan(0);
  });

  it("counts the folded and the raw form of ONE word as one hit, not two", () => {
    // The filter fetches the word twice, so the scorer must not pay for it
    // twice: an accented word would otherwise out-score a plain one.
    const mem = { id: "one", category: "note", content: "Begoña loves sushi", confidence: 0 };
    const plain = { id: "two", category: "note", content: "Bailey loves sushi", confidence: 0 };
    const accented = scoreMemory(mem, tokenize("Begoña"));
    const ascii = scoreMemory(plain, tokenize("Bailey"));
    expect(accented).toBeCloseTo(ascii, 5);
  });

  it("matches an UPPER-CASE term and an UPPER-CASE row", () => {
    const mem = { id: "u1", category: "preference", content: "SUSHI", confidence: 0.9 };
    expect(scoreMemory(mem, ["sushi"])).toBeGreaterThan(0);
    expect(scoreMemory(mem, ["SUSHI"])).toBeGreaterThan(0);
    const lower = { id: "u2", category: "preference", content: "sushi", confidence: 0.9 };
    expect(scoreMemory(lower, ["SUSHI"])).toBeGreaterThan(0);
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

  it("without a clock the order is confidence + usage — never recency", () => {
    // No `now` means no recency term at all. If the guard were dropped the
    // weight would be NaN, the comparator NaN, and the order would be the
    // caller's input order — the always-injected core would follow whatever
    // the database happened to return.
    const mems = [
      { id: "low", category: "note", content: "l", confidence: 0.5, usageCount: 0, updatedAt: "2026-10-01T00:00:00Z" },
      { id: "high", category: "note", content: "h", confidence: 0.6, usageCount: 0, updatedAt: "2020-01-01T00:00:00Z" },
    ];
    expect(rankFacts(mems).map((m) => m.id)).toEqual(["high", "low"]);
    // The same rows WITH a clock: recency flips them, so the order above is
    // genuinely recency-free and not a coincidence of the confidences.
    const withClock = rankFacts(mems, { now: Date.parse("2026-10-01T00:00:00Z") });
    expect(withClock.map((m) => m.id)).toEqual(["low", "high"]);
  });

  it("keeps a broken confidence from poisoning the durable order", () => {
    const ranked = rankFacts([
      { id: "broken", category: "note", content: "b", confidence: Number.NaN, usageCount: 0 },
      { id: "good", category: "note", content: "g", confidence: 0.9, usageCount: 0 },
    ]);
    expect(ranked.map((m) => m.id)).toEqual(["good", "broken"]);
  });

  it("keeps a broken usage count from poisoning the durable order", () => {
    const ranked = rankFacts([
      { id: "good", category: "note", content: "g", confidence: 0.5, usageCount: 0 },
      { id: "broken", category: "note", content: "b", confidence: 0.9, usageCount: Number.NaN },
    ]);
    expect(ranked.map((m) => m.id)).toEqual(["broken", "good"]);
    const junk = rankFacts([
      { id: "good", category: "note", content: "g", confidence: 0.5, usageCount: 0 },
      { id: "junk", category: "note", content: "j", confidence: 0.9, usageCount: "abc" as unknown as number },
    ]);
    expect(junk.map((m) => m.id)).toEqual(["junk", "good"]);
    const infinite = rankFacts([
      { id: "good", category: "note", content: "g", confidence: 0.5, usageCount: 0 },
      { id: "inf", category: "note", content: "i", confidence: 0.9, usageCount: Number.NEGATIVE_INFINITY },
    ]);
    expect(infinite.map((m) => m.id)).toEqual(["inf", "good"]);
  });

  it("never mutates the array it is given", () => {
    const mems = [
      { id: "low", category: "note", content: "l", confidence: 0.1, usageCount: 0 },
      { id: "high", category: "note", content: "h", confidence: 0.9, usageCount: 5 },
    ];
    const before = mems.map((m) => m.id);
    const ranked = rankFacts(mems);
    expect(ranked.map((m) => m.id)).toEqual(["high", "low"]);
    expect(mems.map((m) => m.id)).toEqual(before);
    expect(ranked).not.toBe(mems);
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

  it("keeps a restriction fact even when the budget is spent — a restriction is a safety fact", () => {
    const kept = selectCoreFacts(
      [{ id: "r", category: "restriction", content: "no peanuts", confidence: 0.1 }],
      { budget: 0 },
    );
    expect(kept.map((f) => f.id)).toEqual(["r"]);
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

  it("charges a per-fact allowance on top of the fact text", () => {
    // Each fact is rendered as a line, so it costs its text plus a fixed
    // allowance: 10 characters of text fit a budget of 18, not of 17.
    const fact = { id: "x", category: "note", content: "0123456789", confidence: 0.5 };
    expect(selectCoreFacts([fact], { budget: 18 }).map((f) => f.id)).toEqual(["x"]);
    expect(selectCoreFacts([fact], { budget: 17 }).map((f) => f.id)).toEqual([]);
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

  it("finds an accented chat turn — chat turns are full of accented names", () => {
    const accented = [{ content: "Begoña loves sushi", role: "user", createdAt: "2026-10-01T10:00:00Z" }];
    expect(searchMessages(accented, tokenize("Begoña"))).toHaveLength(1);
    expect(searchMessages(accented, ["begona"])).toHaveLength(1);
  });

  it("finds an UPPER-CASE chat turn and an UPPER-CASE term", () => {
    const shouted = [{ content: "SUSHI FOR DINNER", role: "user", createdAt: "2026-10-01T10:00:00Z" }];
    expect(searchMessages(shouted, ["sushi"])).toHaveLength(1);
    expect(searchMessages(shouted, ["SUSHI"])).toHaveLength(1);
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
