import { describe, it, expect, vi, beforeEach } from "vitest";

const turns: any[] = [];
const mocks = vi.hoisted(() => ({ pb: null as any }));

vi.mock("@/lib/pb-auth", () => ({ getAuthedPB: async () => mocks.pb }));

import { loadRecentTurns, searchConversations } from "@/lib/memory-sessions";

beforeEach(() => {
  turns.length = 0;
  mocks.pb = {
    collection: () => ({
      getFullList: async ({ filter }: any) => {
        if (filter && filter.includes("createdAt")) {
          const min = /createdAt>"([^"]+)"/.exec(filter)?.[1] ?? "";
          return turns.filter((t) => t.createdAt > min);
        }
        return turns.slice();
      },
    }),
  };
});

describe("loadRecentTurns", () => {
  it("returns the turns inside the window", async () => {
    turns.push({ id: "1", role: "user", content: "a", createdAt: new Date().toISOString() });
    const list = await loadRecentTurns({ days: 30 });
    expect(list).toHaveLength(1);
  });
});

describe("searchConversations", () => {
  it("finds an older turn by a keyword", async () => {
    turns.push({ id: "1", role: "user", content: "the pool party is saturday", createdAt: new Date().toISOString() });
    const hits = await searchConversations("pool party");
    expect(hits).toHaveLength(1);
    expect(hits[0].content).toContain("pool party");
  });

  it("returns nothing for an unknown topic", async () => {
    turns.push({ id: "1", role: "user", content: "the pool party is saturday", createdAt: new Date().toISOString() });
    expect(await searchConversations("zebra crossing")).toHaveLength(0);
  });
});
