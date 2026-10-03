// @vitest-environment jsdom
// /new conversation reset — the POST leg of /api/chat/messages. A system-role
// row marks "the conversation starts here"; the daily PB thread keeps its
// history (merged back on load), while the LLM only sees messages AFTER the
// marker (cutoff in the chat page). POST is session-gated (no guest writes)
// and accepts system role ONLY.
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = vi.hoisted(() => ({
  insertChatMessage: vi.fn(async () => ({})),
  withAdmin: vi.fn(),
}));

vi.mock("@/db", () => ({ db: dbMock }));

// The reset marker is a WRITE into the family's shared thread, so the gate is a
// LIVE PocketBase identity read (the cookie role/name is a 7-day claim), not
// the signed cookie alone. Only `verifySession` stays stubbed; the live read is
// exercised through the PB seam below.
vi.mock("@/lib/session", () => ({
  verifySession: vi.fn(async (cookie?: string) =>
    cookie
      ? { name: "Rebecca Garcia", role: "parent", memberId: "m1" }
      : null
  ),
  SESSION_COOKIE: "consuela_session",
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => dbMock.withAdmin(fn),
}));

import { POST } from "@/app/api/chat/messages/route";

function req(body: unknown, cookie?: string) {
  return {
    json: async () => body,
    // The live-identity helper reads the cookie off the raw header (the way
    // every other server-auth caller sees it), not off a cookie accessor.
    headers: new Headers(cookie ? { cookie: `consuela_session=${cookie}` } : {}),
  } as any;
}

beforeEach(() => {
  dbMock.insertChatMessage.mockClear();
  dbMock.insertChatMessage.mockImplementation(async () => ({}));
  dbMock.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) =>
    fn({
      collection: () => ({
        getOne: async (id: string) => {
          if (id !== "m1") throw Object.assign(new Error("not found"), { status: 404 });
          return { id: "m1", name: "Rebecca Garcia", role: "parent" };
        },
      }),
    }),
  );
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
