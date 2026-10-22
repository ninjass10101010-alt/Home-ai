import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * The memory-export cron — the one-way export to the Mac Obsidian agent.
 *
 * The route had no try/catch at all, so a PocketBase outage REJECTED the
 * request: honest in the sense that nothing false was exported, but it said
 * nothing about WHY and it was unpinned. The house convention for an
 * unreachable store is a 503 with a machine code.
 */

const mocks = vi.hoisted(() => ({
  queryMemories: vi.fn(async (): Promise<any[]> => []),
}));

vi.mock("@/lib/family-memory", () => ({ queryMemories: mocks.queryMemories }));

import { POST } from "@/app/api/cron/consuela/memory-export/route";

function req(auth?: string) {
  return new NextRequest("http://localhost/api/cron/consuela/memory-export", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
  mocks.queryMemories.mockResolvedValue([]);
});

describe("POST /api/cron/consuela/memory-export — the store is down", () => {
  it("answers 503 with a machine code instead of rejecting", async () => {
    mocks.queryMemories.mockRejectedValue(new Error("Failed to connect to the PocketBase server."));
    const res = await POST(req("Bearer test-cron-secret"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("memory_store_unreachable");
    expect(JSON.stringify(body)).not.toContain("PocketBase");
  });

  it("never exports an EMPTY bank while the store is down", async () => {
    mocks.queryMemories.mockRejectedValue(new Error("Failed to connect to the PocketBase server."));
    const res = await POST(req("Bearer test-cron-secret"));
    const body = await res.json();
    expect(body.memories).toBeUndefined();
    expect(body.count).toBeUndefined();
  });

  it("still fails closed without the bearer", async () => {
    mocks.queryMemories.mockRejectedValue(new Error("Failed to connect to the PocketBase server."));
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(mocks.queryMemories).not.toHaveBeenCalled();
  });
});
