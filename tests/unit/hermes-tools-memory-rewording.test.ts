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
