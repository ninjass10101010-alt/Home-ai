// F6: /api/recurring-patterns read the `events` collection with the PUBLIC
// getPB() client, which 403s under LOCKED_RULES. It must use the admin-authed
// client (getAuthedPB) and never touch the public client.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthedPB: vi.fn(),
  getPB: vi.fn(),
  suggestPatterns: vi.fn(async (_familyId: string, _events: any[]) => [
    { pattern: { id: "suggested_1" }, confidence: 0.8 },
  ]),
  getFamilyPatterns: vi.fn(async (_familyId: string) => []),
  detectRecurringPatterns: vi.fn(async () => ({ patterns: [], suggestions: [], stats: {} })),
  storePattern: vi.fn(async () => true),
}));

vi.mock("@/lib/pb-auth", () => ({ getAuthedPB: mocks.getAuthedPB }));
vi.mock("@/lib/pb", () => ({ getPB: mocks.getPB }));
vi.mock("@/lib/recurring-patterns", () => ({
  detectRecurringPatterns: mocks.detectRecurringPatterns,
  getFamilyPatterns: mocks.getFamilyPatterns,
  suggestPatterns: mocks.suggestPatterns,
  storePattern: mocks.storePattern,
  enableAutoSchedule: vi.fn(async () => true),
  disableAutoSchedule: vi.fn(async () => true),
}));

import { GET } from "@/app/api/recurring-patterns/route";

const EVENT_ROWS = [
  { id: "e1", title: "Soccer Practice", date: "2026-09-01" },
  { id: "e2", title: "Piano Lesson", date: "2026-09-02" },
];

function suggestReq() {
  return new NextRequest("http://localhost/api/recurring-patterns?type=suggest&familyId=fam");
}

describe("recurring-patterns route — reads via authed PB (F6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const getFullList = vi.fn(async () => EVENT_ROWS);
    const collection = vi.fn(() => ({ getFullList }));
    mocks.getAuthedPB.mockResolvedValue({ collection });
    mocks.getPB.mockImplementation(() => {
      throw new Error("public PB client must not be used");
    });
    mocks.suggestPatterns.mockResolvedValue([
      { pattern: { id: "suggested_1" }, confidence: 0.8 },
    ]);
  });

  it("type=suggest returns 200 with suggestions from authed-PB events", async () => {
    const res = await GET(suggestReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.suggestions)).toBe(true);
    expect(body.suggestions).toHaveLength(1);
    expect(mocks.getAuthedPB).toHaveBeenCalled();
  });

  it("never calls the public getPB client", async () => {
    await GET(suggestReq());
    expect(mocks.getPB).not.toHaveBeenCalled();
  });
});
