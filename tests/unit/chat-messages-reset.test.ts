// @vitest-environment jsdom
// /new conversation reset — the POST leg of /api/chat/messages. A system-role
// row marks "the conversation starts here"; the daily PB thread keeps its
// history (merged back on load), while the LLM only sees messages AFTER the
// marker (cutoff in the chat page). POST is session-gated (no guest writes)
// and accepts system role ONLY.
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = vi.hoisted(() => ({
  insertChatMessage: vi.fn(async () => ({})),
}));

vi.mock("@/db", () => ({ db: dbMock }));

vi.mock("@/lib/session", () => ({
  verifySession: vi.fn(async (cookie?: string) =>
    cookie
      ? { name: "Rebecca Garcia", role: "parent", id: "m1", memberId: "m1" }
      : null
  ),
  SESSION_COOKIE: "consuela_session",
}));

const liveSessionMocks = vi.hoisted(() => ({ requireLiveSession: vi.fn() }));
vi.mock("@/lib/server-auth", () => ({
  requireLiveSession: liveSessionMocks.requireLiveSession,
}));

import { POST } from "@/app/api/chat/messages/route";

function req(body: unknown, cookie?: string) {
  return {
    json: async () => body,
    cookies: { get: (name: string) => (cookie && name === "consuela_session" ? { value: cookie } : undefined) },
  } as any;
}

beforeEach(async () => {
  dbMock.insertChatMessage.mockClear();
  dbMock.insertChatMessage.mockImplementation(async () => ({}));
  const { verifySession } = await import("@/lib/session");
  liveSessionMocks.requireLiveSession.mockReset().mockImplementation(async (request: any) => {
    const token = request.cookies?.get?.("consuela_session")?.value;
    const signed = await verifySession(token);
    if (!signed) return { ok: false as const, status: 401 as const, error: "unauthorized" as const };
    return {
      ok: true as const,
      identity: { memberId: "m1", name: signed.name, role: signed.role as "parent" },
    };
  });
});

describe("POST /api/chat/messages — reset marker", () => {
  it("401s guests (no session cookie)", async () => {
    const res = await POST(req({ action: "reset" }));
    expect(res.status).toBe(401);
    expect(dbMock.insertChatMessage).not.toHaveBeenCalled();
  });

  it("writes a system reset marker into today's thread", async () => {
    const res = await POST(req({ action: "reset" }, "tok"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.threadId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dbMock.insertChatMessage).toHaveBeenCalledTimes(1);
    const arg = (dbMock.insertChatMessage.mock.calls as unknown as any[][])[0]?.[0];
    expect(arg.role).toBe("system");
    expect(arg.content).toBe("New conversation");
    expect(arg.source).toBe("dashboard");
    expect(arg.threadId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(arg.userId).toBe("Rebecca Garcia");
  });

  it("401s an invalid session", async () => {
    vi.mocked((await import("@/lib/session")).verifySession).mockResolvedValueOnce(null);
    const res = await POST(req({ action: "reset" }, "bad-token"));
    expect(res.status).toBe(401);
    expect(dbMock.insertChatMessage).not.toHaveBeenCalled();
  });
});
