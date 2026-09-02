import { describe, it, expect, vi, beforeEach } from "vitest";

let inFlight = 0;
let maxInFlight = 0;

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    try {
      return await fn({
        collection: () => ({
          getFullList: async () => [],
          getList: async () => [],
          getFirst: async () => null,
          create: async (d: any) => d,
          update: async (_id: string, d: any) => d,
        }),
      });
    } finally {
      inFlight -= 1;
    }
  }),
}));

vi.mock("@/db", () => ({
  db: {
    insertProactiveSuggestions: vi.fn(async () => ({ inserted: 0, rejected: 0 })),
    selectPendingSuggestions: vi.fn(async () => []),
    upsertMorningBriefing: vi.fn(async () => ({})),
  },
}));

// briefing.ts imports runEngine from "./engine", which resolves to the same
// module id as "@/lib/consuela/engine" — mocking the absolute specifier
// intercepts it. The real engine is loaded via vi.importActual in test 1.
vi.mock("@/lib/consuela/engine", () => ({
  runEngine: vi.fn(async () => ({ scanned: 0, inserted: 0, rejected: 0 })),
}));

import { generateBriefing } from "@/lib/consuela/briefing";

beforeEach(() => {
  inFlight = 0;
  maxInFlight = 0;
});

describe("consuela background parallelism", () => {
  it("runEngine runs scanners concurrently", async () => {
    const { runEngine } = await vi.importActual<typeof import("@/lib/consuela/engine")>(
      "@/lib/consuela/engine"
    );
    await runEngine({ scopeDate: "2026-09-02" });
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("generateBriefing runs its post-engine reads concurrently", async () => {
    await generateBriefing({ scopeDate: "2026-09-02" });
    expect(maxInFlight).toBeGreaterThan(1);
  });
});
