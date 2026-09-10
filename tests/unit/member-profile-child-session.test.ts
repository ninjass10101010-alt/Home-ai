import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifyPinFromPB: vi.fn(),
  findOrCreateMemberRecord: vi.fn(),
  verifySession: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/server-auth", () => ({
  verifyPinFromPB: mocks.verifyPinFromPB,
  findOrCreateMemberRecord: mocks.findOrCreateMemberRecord,
  sanitizeMember: (m: any) => {
    const { pin, ...rest } = m;
    return rest;
  },
}));

vi.mock("@/lib/session", () => ({
  SESSION_COOKIE: "consuela_session",
  verifySession: mocks.verifySession,
}));

import { POST } from "@/app/api/members/profile/route";

function req(body?: unknown, cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/members/profile", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `consuela_session=${cookie}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function pbWithGetOne(record: any) {
  return {
    collection: (_name: string) => ({
      getOne: async (_id: string) => {
        if (record === null) throw new Error("not found");
        return record;
      },
    }),
  };
}

const CHILD_SESSION = { memberId: "m-kid", name: "Emily", role: "child" };
const CHILD_RECORD = { id: "m-kid", name: "Emily Garcia", role: "child", emoji: "🧒", pin: "5678" };

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

describe("POST /api/members/profile — child-session avatar-only path", () => {
  it("1. happy path: child session, own record, emoji-only patch saves without a PIN", async () => {
    mocks.verifySession.mockResolvedValue(CHILD_SESSION);
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pbWithGetOne(CHILD_RECORD)));
    let saved: any = null;
    mocks.findOrCreateMemberRecord.mockImplementation(
      async (_pb: unknown, actor: any, clean: Record<string, unknown>) => {
        saved = { ...actor, ...clean };
        return saved;
      },
    );

    const res = await POST(req({ patch: { emoji: "🦊" } }, "session-token"));

    expect(res.status).toBe(200);
    expect(mocks.verifySession).toHaveBeenCalledWith("session-token");
    expect(mocks.verifyPinFromPB).not.toHaveBeenCalled();
    expect(saved.emoji).toBe("🦊");
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.member.emoji).toBe("🦊");
    expect(body.member.pin).toBeUndefined();
  });

  it("2. child session + non-avatar field (color) present → 401", async () => {
    mocks.verifySession.mockResolvedValue(CHILD_SESSION);

    const res = await POST(req({ patch: { emoji: "🦊", color: "red" } }, "session-token"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Avatar fields only on a child session" });
    expect(mocks.verifyPinFromPB).not.toHaveBeenCalled();
    expect(mocks.findOrCreateMemberRecord).not.toHaveBeenCalled();
  });

  it("3. child session + name field → 401", async () => {
    mocks.verifySession.mockResolvedValue(CHILD_SESSION);

    const res = await POST(req({ patch: { name: "Emily the Great" } }, "session-token"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Avatar fields only on a child session" });
    expect(mocks.findOrCreateMemberRecord).not.toHaveBeenCalled();
  });

  it("4. child session + pin field (attempt to change PIN via profile) → 401", async () => {
    mocks.verifySession.mockResolvedValue(CHILD_SESSION);

    const res = await POST(req({ patch: { pin: "9999" } }, "session-token"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Avatar fields only on a child session" });
    expect(mocks.findOrCreateMemberRecord).not.toHaveBeenCalled();
  });

  it("5. child session + valid patch BUT the resolved record is not the session's member → 401", async () => {
    mocks.verifySession.mockResolvedValue(CHILD_SESSION);
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) =>
      fn(pbWithGetOne({ id: "pb-row-other", name: "Rebecca", role: "parent" }))
    );

    const res = await POST(req({ patch: { emoji: "🦊" } }, "session-token"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid session" });
    expect(mocks.findOrCreateMemberRecord).not.toHaveBeenCalled();
  });

  it("6. parent session, NO PIN in body → 401 (PIN gate must survive for adults)", async () => {
    mocks.verifySession.mockResolvedValue({ memberId: "m1", name: "Rebecca", role: "parent" });

    const res = await POST(req({ patch: { emoji: "🦊" } }, "session-token"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid PIN" });
    expect(mocks.verifyPinFromPB).not.toHaveBeenCalled();
    expect(mocks.findOrCreateMemberRecord).not.toHaveBeenCalled();
  });

  it("7. no session, no PIN → 401", async () => {
    mocks.verifySession.mockResolvedValue(null);

    const res = await POST(req({ patch: { emoji: "🦊" } }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid PIN" });
    expect(mocks.verifyPinFromPB).not.toHaveBeenCalled();
    expect(mocks.findOrCreateMemberRecord).not.toHaveBeenCalled();
  });

  it("8. legacy PIN path unchanged: valid PIN + {color: 'red'} → 200", async () => {
    mocks.verifyPinFromPB.mockResolvedValue({ id: "m1", name: "Rebecca", role: "parent", color: "violet", pin: "9999" });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn({ collection: () => ({}) }));
    mocks.findOrCreateMemberRecord.mockImplementation(
      async (_pb: unknown, actor: any, clean: Record<string, unknown>) => ({ ...actor, ...clean }),
    );

    const res = await POST(req({ actorName: "Rebecca", actorPin: "9999", patch: { color: "red" } }, "session-token"));

    expect(res.status).toBe(200);
    expect(mocks.verifyPinFromPB).toHaveBeenCalledWith("Rebecca", "9999");
    expect(mocks.verifySession).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.member.color).toBe("red");
    expect(body.member.pin).toBeUndefined();
  });

  it("9. invalid PIN presented + valid child session → 401 'Invalid PIN' (explicit PIN errors never fall through to session)", async () => {
    mocks.verifyPinFromPB.mockResolvedValue(null);
    mocks.verifySession.mockResolvedValue(CHILD_SESSION);

    const res = await POST(req({ actorName: "Emily", actorPin: "0000", patch: { emoji: "🦊" } }, "session-token"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid PIN" });
    expect(mocks.verifySession).not.toHaveBeenCalled();
    expect(mocks.findOrCreateMemberRecord).not.toHaveBeenCalled();
  });

  it("10. avatarSize outside the vocabulary (xxl) on child path → field dropped; nothing valid remains → 400", async () => {
    mocks.verifySession.mockResolvedValue(CHILD_SESSION);
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pbWithGetOne(CHILD_RECORD)));

    const res = await POST(req({ patch: { avatarSize: "xxl" } }, "session-token"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No valid fields to update" });
    expect(mocks.findOrCreateMemberRecord).not.toHaveBeenCalled();
  });
});
