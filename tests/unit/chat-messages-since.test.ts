import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const selectChatMessages = vi.hoisted(() => vi.fn(async () => [] as any[]));
vi.mock("@/db", () => ({ db: { selectChatMessages } }));

import { GET } from "@/app/api/chat/messages/route";

beforeEach(() => { selectChatMessages.mockClear(); });

describe("GET /api/chat/messages — since", () => {
  it("passes since through to selectChatMessages", async () => {
    await GET(new NextRequest("http://localhost/api/chat/messages?threadId=2026-09-02&since=2026-09-02T10:00:00.000Z"));
    expect(selectChatMessages).toHaveBeenCalledWith("2026-09-02", "2026-09-02T10:00:00.000Z");
  });

  it("omits since when absent", async () => {
    await GET(new NextRequest("http://localhost/api/chat/messages?threadId=2026-09-02"));
    expect(selectChatMessages).toHaveBeenCalledWith("2026-09-02", undefined);
  });

  it("rejects a quote-bearing since with 400", async () => {
    const res = await GET(new NextRequest("http://localhost/api/chat/messages?threadId=2026-09-02&since=x%22y"));
    expect(res.status).toBe(400);
  });
});
