import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  // Typed any[] (sibling pattern from hermes-tools-memory.test.ts) — rows in
  // the wild carry `tags` as a JSON string, which the FamilyMemory interface
  // types as string[]; a strict generic would reject the fixture.
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
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
});

describe("POST /api/cron/consuela/memory-export", () => {
  it("401s without the bearer and fails closed when CRON_SECRET is unset", async () => {
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req("Bearer wrong"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await POST(req("Bearer test-cron-secret"))).status).toBe(401);
  });

  it("exports all memories with parsed tags", async () => {
    mocks.queryMemories.mockResolvedValue([
      { id: "m1", userId: "consuela", familyId: "demo-family", category: "allergy", key: "k", content: "Bailey is allergic to peanuts", tags: '["Bailey"]', confidence: 0.9, createdAt: "2026-09-07T00:00:00Z", updatedAt: "2026-09-07T01:00:00Z", usageCount: 2, lastUsed: "2026-09-07T01:00:00Z" },
    ]);
    const res = await POST(req("Bearer test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.exportedAt).toBeTruthy();
    expect(body.memories[0].tags).toEqual(["Bailey"]);
    // F6.3 — the export is family-scoped: without familyId it would sweep
    // every namespace in the collection.
    expect(mocks.queryMemories).toHaveBeenCalledWith({ familyId: "demo-family", limit: 1000 });
  });
});
