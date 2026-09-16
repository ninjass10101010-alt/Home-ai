import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(async (): Promise<{ name: string; role: string } | null> => ({ name: "Jeff", role: "parent" })),
}));

vi.mock("@/lib/session", () => ({
  verifySession: mocks.verifySession,
  SESSION_COOKIE: "consuela_session",
}));

import {
  recordChatOutcome,
  getRecentOutcomes,
  summarizeOutcomes,
  clearChatOutcomesForTests,
} from "@/lib/ai/health";
import { GET } from "@/app/api/ai/health/route";

function entry(overrides: Partial<Parameters<typeof recordChatOutcome>[0]> = {}) {
  return {
    outcome: "ok" as const,
    agent: "consuela",
    rounds: 1,
    ms: 1200,
    brain: "test-provider/test-model",
    targets: 1,
    ...overrides,
  };
}

beforeEach(() => {
  clearChatOutcomesForTests();
  mocks.verifySession.mockReset().mockResolvedValue({ name: "Jeff", role: "parent" });
});

describe("ai health recorder", () => {
  it("returns outcomes newest-first", () => {
    recordChatOutcome(entry({ ms: 100 }));
    recordChatOutcome(entry({ outcome: "snag", ms: 200, reason: "AI glm 500: boom" }));
    const recent = getRecentOutcomes();
    expect(recent).toHaveLength(2);
    expect(recent[0].outcome).toBe("snag");
    expect(recent[0].ts).toBeGreaterThanOrEqual(recent[1].ts);
  });

  it("caps the buffer at 50 entries (ring buffer)", () => {
    for (let i = 0; i < 60; i++) recordChatOutcome(entry({ ms: i }));
    const recent = getRecentOutcomes(100);
    expect(recent).toHaveLength(50);
    // oldest (ms=0..9) evicted; newest kept
    expect(recent[0].ms).toBe(59);
    expect(recent[49].ms).toBe(10);
  });

  it("summarizes counts by outcome + average duration + last failure", () => {
    recordChatOutcome(entry({ outcome: "ok", ms: 1000 }));
    recordChatOutcome(entry({ outcome: "wrapup", ms: 3000 }));
    recordChatOutcome(entry({ outcome: "exhausted", ms: 9000 }));
    recordChatOutcome(entry({ outcome: "snag", ms: 5000, reason: "TimeoutError" }));
    const s = summarizeOutcomes();
    expect(s.total).toBe(4);
    expect(s.ok).toBe(1);
    expect(s.wrapup).toBe(1);
    expect(s.exhausted).toBe(1);
    expect(s.snag).toBe(1);
    expect(s.clientGone).toBe(0);
    expect(s.unconfigured).toBe(0);
    expect(s.avgMs).toBe(4500);
    expect(s.lastFailure?.outcome).toBe("snag");
    expect(s.lastFailure?.reason).toBe("TimeoutError");
  });

  it("stores metadata only — the record shape carries no message content fields", () => {
    recordChatOutcome(entry());
    const rec = getRecentOutcomes()[0] as unknown as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    expect(keys).toEqual(["agent", "brain", "ms", "outcome", "rounds", "targets", "ts"]);
  });
});

describe("GET /api/ai/health", () => {
  it("401s without a session", async () => {
    mocks.verifySession.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/ai/health"));
    expect(res.status).toBe(401);
  });

  it("returns outcomes + summary for a signed-in session", async () => {
    recordChatOutcome(entry({ outcome: "ok", ms: 1000 }));
    recordChatOutcome(entry({ outcome: "exhausted", ms: 4000 }));
    const res = await GET(new NextRequest("http://localhost/api/ai/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcomes).toHaveLength(2);
    expect(body.outcomes[0].outcome).toBe("exhausted"); // newest first
    expect(body.summary.total).toBe(2);
    expect(body.summary.exhausted).toBe(1);
  });

  it("returns an empty (not erroring) shape when nothing has been recorded", async () => {
    const res = await GET(new NextRequest("http://localhost/api/ai/health"));
    const body = await res.json();
    expect(body.outcomes).toEqual([]);
    expect(body.summary.total).toBe(0);
  });
});
