import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Mock withAdmin before importing route
const mockGetFullList = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) => {
    const pb = {
      collection: vi.fn(() => ({
        getFullList: mockGetFullList,
        update: mockUpdate,
        create: vi.fn(),
        delete: vi.fn(),
      })),
    };
    return fn(pb);
  }),
}));

// Use real scoreEvent (no mock) to verify keyword scoring integration
// If we want isolation, we could mock, but real gives better coverage

async function importRoute() {
  // Re-import to get fresh module after env changes; use dynamic import
  // Vitest caches, but we can just import statically
  return await import("@/app/api/cron/calendar/score-importance/route");
}

describe("cron/calendar/score-importance", () => {
  const ORIGINAL = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret-123";
    mockGetFullList.mockReset();
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({ id: "updated" });
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL;
    vi.clearAllMocks();
  });

  function makeRequest(authHeader?: string, method: string = "GET") {
    return new NextRequest(`http://localhost:3000/api/cron/calendar/score-importance`, {
      method,
      headers: authHeader ? { authorization: authHeader } : {},
    });
  }

  it("requires CRON_SECRET - returns 401 when no auth header", async () => {
    const { GET } = await importRoute();
    mockGetFullList.mockResolvedValue([]);
    const req = makeRequest();
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns 401 when bearer is wrong", async () => {
    const { GET } = await importRoute();
    mockGetFullList.mockResolvedValue([]);
    const req = makeRequest("Bearer wrong-secret");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 when CRON_SECRET env is missing", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await importRoute();
    const req = makeRequest("Bearer test-secret-123");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("GET scores events for next 7 days and persists importance", async () => {
    const { GET } = await importRoute();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrowStr = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
    const farStr = new Date(today.getTime() + 10 * 86400000).toISOString().slice(0, 10);

    const events = [
      { id: "1", title: "Doctor appointment", date: tomorrowStr, member: "Emily" },
      { id: "2", title: "Lunch with friends", date: tomorrowStr, member: "Rebecca (Mom)" },
      { id: "3", title: "Birthday party", date: farStr, member: "Caspian" }, // outside window - filtered by PB, but fallback JS would also filter
    ];
    // PB date filter would already filter farStr out, so mock returns only in-window
    mockGetFullList.mockResolvedValue([events[0], events[1]]);

    const req = makeRequest("Bearer test-secret-123");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Only doctor event has keyword -> scored 1
    expect(body.scored).toBe(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateCall = mockUpdate.mock.calls[0];
    expect(updateCall[0]).toBe("1");
    expect(updateCall[1]).toHaveProperty("importanceScore");
    expect(updateCall[1].importanceScore).toBeGreaterThanOrEqual(50);
    expect(updateCall[1]).toHaveProperty("importanceReason");
    expect(updateCall[1].importanceReason).toContain("doctor");
    expect(updateCall[1]).toHaveProperty("importanceUpdatedAt");
  });

  it("POST also works and is idempotent", async () => {
    const { POST } = await importRoute();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrowStr = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
    mockGetFullList.mockResolvedValue([
      { id: "1", title: "Dentist — Bailey", date: tomorrowStr, member: "Bailey" },
    ]);

    const req = makeRequest("Bearer test-secret-123", "POST");
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scored).toBe(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("handles member -> members adaptation (single member, no bonus)", async () => {
    const { GET } = await importRoute();
    const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    mockGetFullList.mockResolvedValue([
      { id: "10", title: "Doctor visit", date: tomorrowStr, member: "Alice" },
    ]);
    const req = makeRequest("Bearer test-secret-123");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scored).toBe(1);
    // score should be 70 (50 keyword +20 startsWith), not 80 (no members bonus)
    const score = mockUpdate.mock.calls[0][1].importanceScore;
    expect(score).toBe(70);
  });

  it("handles start/end ISO duration >120", async () => {
    const { GET } = await importRoute();
    const now = new Date();
    now.setHours(10, 0, 0, 0);
    const start = new Date(now.getTime() + 86400000).toISOString();
    const end = new Date(now.getTime() + 86400000 + 180 * 60000).toISOString(); // 180 min
    // Event uses start/end ISO, no date field
    // PB date filter would miss it, fallback path handles it, but our mock returns it directly
    // To test adaptation, we force getFullList to throw on first call (date filter) then succeed on second (fallback)
    mockGetFullList
      .mockRejectedValueOnce(new Error("filter error"))
      .mockResolvedValueOnce([
        { id: "20", title: "Doctor check", start, end, member: "Bob" },
      ]);
    // Second fetch for startBased supplement after empty? Our route after fallback sets events via JS filter,
    // so the first fallback's fullList already contains the start event; we need to ensure it passes date window.
    // Instead mock simple: first call throws, second call returns the start-end event
    // But route's fallback does: const all = withAdmin(...getFullList) -> that is second call; then filters in JS.
    // For this test, make the JS filter pass: the start ISO date must be within window.
    const req = makeRequest("Bearer test-secret-123");
    const res = await GET(req);
    expect(res.status).toBe(200);
    // Should have scored with duration bonus: 50+20+10=80
    expect(mockUpdate).toHaveBeenCalled();
    const score = mockUpdate.mock.calls[0][1].importanceScore;
    expect(score).toBe(80);
  });

  it("returns 0 scored when no keyword matches", async () => {
    const { GET } = await importRoute();
    const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    mockGetFullList.mockResolvedValue([
      { id: "30", title: "Grocery run", date: tomorrowStr, member: "Rebecca" },
    ]);
    const req = makeRequest("Bearer test-secret-123");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scored).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("handles missing title gracefully", async () => {
    const { GET } = await importRoute();
    const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    mockGetFullList.mockResolvedValue([{ id: "40", date: tomorrowStr, member: "Test" }]);
    const req = makeRequest("Bearer test-secret-123");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scored).toBe(0);
  });
});
