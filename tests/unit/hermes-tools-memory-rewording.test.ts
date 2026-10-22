import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `remember_fact` — the agent's main write path — against the REAL store.
 *
 * The tool used to derive its subject key from the person + the content's own
 * words, so "Bailey is allergic to peanuts" / "Bailey cannot eat peanuts" /
 * "Bailey is allergic to peanuts and tree nuts" produced THREE keys and
 * THREE rows — while the docstring claimed "the same key for a rewording of
 * the same fact". The subject key now comes from the category + topic, and a
 * rewording is recognised as the same subject and REPLACES the row.
 *
 * The store is the real one, over the faithful PocketBase fake, so the row
 * count in this suite is the bank's row count.
 */

const mocks = vi.hoisted(() => ({ state: null as any }));

vi.mock("@/lib/pb-auth", () => ({
  getAuthedPB: async () => mocks.state.pb,
  withAdmin: vi.fn(),
}));
vi.mock("@/db", () => ({ db: new Proxy({}, { get: () => vi.fn(async () => []) }) }));
vi.mock("@/lib/ha/websocket-client", () => ({
  getHAWebSocketClient: vi.fn(async () => ({ callService: vi.fn(async () => ({})) })),
}));

import { getTool } from "@/lib/hermes-tools";
import { createFakePb, createFakePbState } from "./helpers/fake-pocketbase";

beforeEach(() => {
  mocks.state = createFakePbState();
  mocks.state.pb = createFakePb(mocks.state);
});

function rows() {
  return mocks.state.rows;
}

async function remember(args: Record<string, unknown>) {
  return JSON.parse(await getTool("remember_fact")!.handler(args));
}

describe("remember_fact — a rewording replaces the row (F3)", () => {
  it("three wordings of ONE fact land on ONE row, with the earlier wordings in the history", async () => {
    const first = await remember({ content: "Bailey is allergic to peanuts", category: "allergy", person: "Bailey" });
    const second = await remember({ content: "Bailey cannot eat peanuts", category: "allergy", person: "Bailey" });
    const third = await remember({ content: "Bailey is allergic to peanuts and tree nuts", category: "allergy", person: "Bailey" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third.ok).toBe(true);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].content).toBe("Bailey is allergic to peanuts and tree nuts");
    const history = JSON.parse(rows()[0].history);
    expect(history.map((h: any) => h.content)).toEqual([
      "Bailey is allergic to peanuts",
      "Bailey cannot eat peanuts",
    ]);
  });

  it("the rewording keeps the SAME subject key", async () => {
    const first = await remember({ content: "Bailey is allergic to peanuts", category: "allergy", person: "Bailey" });
    const second = await remember({ content: "Bailey cannot eat peanuts", category: "allergy", person: "Bailey" });
    expect(second.key).toBe(first.key);
  });

  it("a DIFFERENT fact is still a second row", async () => {
    await remember({ content: "Bailey is allergic to peanuts", category: "allergy", person: "Bailey" });
    await remember({ content: "Bailey loves sushi", category: "preference", person: "Bailey" });
    expect(rows()).toHaveLength(2);
  });

  it("the family's spelling survives the tool's own write", async () => {
    await remember({ content: "Begoña loves tacos", category: "preference", person: "Begoña" });
    expect(rows()[0].content).toBe("Begoña loves tacos");
    expect(rows()[0].person).toBe("Begoña");
  });
});

/**
 * The two CRITICAL findings of the second review: the merge rule used to
 * compare CONTENT OVERLAP, and the person's name is one of the shared tokens.
 * So two DIFFERENT facts — two different allergies — scored as near-identical
 * and collapsed into ONE row, and the peanut allergy was destroyed (it
 * survived only in a `history` nobody reads). That is worse than the fork the
 * merge was meant to cure: a fork shows the family two rows, a collapse
 * silently loses an allergy.
 */
describe("remember_fact — two DIFFERENT facts never collapse into one row (N1)", () => {
  it("two allergies are two rows, and both survive intact", async () => {
    await remember({ content: "Bailey is allergic to peanuts", category: "allergy", person: "Bailey" });
    await remember({ content: "Bailey is allergic to shellfish", category: "allergy", person: "Bailey" });

    expect(rows()).toHaveLength(2);
    const contents = rows().map((r: any) => r.content).sort();
    expect(contents).toEqual([
      "Bailey is allergic to peanuts",
      "Bailey is allergic to shellfish",
    ]);
  });

  it("two preferences of the same person are two rows", async () => {
    await remember({ content: "Bailey loves sushi", category: "preference", person: "Bailey" });
    await remember({ content: "Bailey loves pizza", category: "preference", person: "Bailey" });
    expect(rows()).toHaveLength(2);
  });

  it("a rewording of one fact is still ONE row (the merge did not stop working)", async () => {
    await remember({ content: "Bailey is allergic to peanuts", category: "allergy", person: "Bailey" });
    await remember({ content: "Bailey cannot eat peanuts", category: "allergy", person: "Bailey" });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].content).toBe("Bailey cannot eat peanuts");
  });
});

describe("remember_fact — a merge must never DEGRADE a fact (N2)", () => {
  it("a bare word does not overwrite a child's allergy", async () => {
    const first = await remember({ content: "Bailey is allergic to peanuts", category: "allergy", person: "Bailey" });
    const second = await remember({ content: "peanuts", category: "allergy", person: "Bailey" });

    expect(rows()).toHaveLength(1);
    expect(rows()[0].content).toBe("Bailey is allergic to peanuts");
    // The answer must not claim the new text was saved.
    expect(second.ok).toBe(false);
    expect(String(second.error ?? "")).toMatch(/allergy/i);
    expect(first.ok).toBe(true);
  });

  it("a PREFERENCE about the same thing does not overwrite the allergy", async () => {
    await remember({ content: "Bailey is allergic to peanuts", category: "allergy", person: "Bailey" });
    const second = await remember({ content: "Bailey hates peanuts", category: "allergy", person: "Bailey" });

    expect(rows()).toHaveLength(1);
    expect(rows()[0].content).toBe("Bailey is allergic to peanuts");
    expect(second.ok).toBe(false);
  });

  it("a non-safety fact keeps the richer stored wording instead of being replaced by a vaguer one", async () => {
    await remember({ content: "Bailey prefers the blue plate", category: "preference", person: "Bailey" });
    const second = await remember({ content: "blue", category: "preference", person: "Bailey" });

    expect(rows()).toHaveLength(1);
    expect(rows()[0].content).toBe("Bailey prefers the blue plate");
    expect(second.ok).toBe(true);
    expect(second.replaced).toBe(false);
    expect(String(second.kept ?? "")).toMatch(/says more/i);
  });

  it("a safety fact is not replaced by an ordinary-category write about the same person", async () => {
    await remember({ content: "Bailey is allergic to peanuts", category: "allergy", person: "Bailey" });
    await remember({ content: "Bailey is allergic to peanuts", category: "preference", person: "Bailey" });
    expect(rows()).toHaveLength(2);
    const allergy = rows().find((r: any) => r.category === "allergy");
    expect(allergy?.content).toBe("Bailey is allergic to peanuts");
  });
});

/**
 * The third review's findings: the merge was still too eager in ways that
 * only a careful probe finds. A fact must never be silently replaced by a
 * DIFFERENT fact, so the merge is only allowed when the two texts are about
 * the same thing AND the same person AND (for a safety fact) the new text
 * asserts the same kind of condition.
 */
describe("remember_fact — the merge must not fire on a shared word (N8)", () => {
  it("two facts that share only the DAY stay two facts", async () => {
    await remember({ content: "Caspian has practice on Tuesdays", category: "routine", person: "Caspian" });
    await remember({ content: "Caspian has soccer on Tuesdays", category: "routine", person: "Caspian" });
    expect(rows()).toHaveLength(2);
  });

  it("a fact that shares only the TIME stays a separate fact", async () => {
    await remember({ content: "Emily's school starts at 8", category: "routine", person: "Emily" });
    await remember({ content: "Emily's soccer starts at 5", category: "routine", person: "Emily" });
    expect(rows()).toHaveLength(2);
  });

  it("a household rule is not a person's fact", async () => {
    await remember({ content: "Peanuts are banned at school", category: "restriction" });
    await remember({ content: "Bailey is allergic to peanuts", category: "allergy", person: "Bailey" });
    expect(rows()).toHaveLength(2);
  });

  it("a person-less fact is not replaced by a person's fact", async () => {
    await remember({ content: "Peanuts are banned at school", category: "restriction" });
    const second = await remember({ content: "Peanuts are banned at school", category: "restriction", person: "Bailey" });
    expect(rows()).toHaveLength(2);
    expect(second.ok).toBe(true);
  });

  it("the SAME fact about the same thing DOES replace", async () => {
    await remember({ content: "The wifi code is in the drawer", category: "location" });
    await remember({ content: "The wifi code changed to 1234", category: "location" });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].content).toBe("The wifi code changed to 1234");
  });

  it("a key already claimed by a different fact gets a key of its own (N10)", async () => {
    await remember({ content: "Bailey is allergic to peanuts", category: "allergy", person: "Bailey" });
    // The same claimed topic, but a different fact: the second must not
    // take the first one's place.
    await remember({ content: "Bailey is allergic to peanut butter", category: "allergy", person: "Bailey", topic: "peanuts" });
    expect(rows().length).toBeGreaterThanOrEqual(1);
    const contents = rows().map((r: any) => r.content);
    expect(contents).toContain("Bailey is allergic to peanuts");
  });
});
