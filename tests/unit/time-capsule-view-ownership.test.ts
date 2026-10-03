/**
 * Bug 4 (P1) — a private time capsule could be marked viewed by ANYONE.
 *
 * `POST /api/time-capsules/[id]/view` resolved a session, took the caller name
 * and called `markCapsuleViewed(capsuleId, userId)` with **no ownership check**.
 * Every sibling verb has one: PATCH and DELETE require `createdBy`, the content
 * POST requires creator/recipient/family-wide. So any signed-in member — a child,
 * a guest, a pet — could stamp `viewedBy` and `firstViewedAt` onto a parent's
 * private capsule, permanently recording that they had opened it.
 *
 * The route also has to resolve the caller's LIVE PocketBase row before trusting
 * the session's identity, which is the house pattern for privileged routes
 * (AGENTS.md: "A cookie role is never trusted; PB identity outage fails closed").
 * A PB outage must be a 503 `member_lookup_failed`, never a silent allow.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

interface Session {
  name: string;
  memberId: string;
  role: string;
}

interface LiveMember {
  id: string;
  name: string;
  role: string;
}

const mocks = vi.hoisted(() => ({
  // Typed as the WIDEST value each mock ever takes (including null for the
  // failure paths) so the tests can exercise them without a cast per case.
  getUserId: vi.fn<() => Promise<string>>(async () => "Alex"),
  requireSession: vi.fn<() => Promise<Session | null>>(async () => ({
    name: "Alex",
    memberId: "m-alex",
    role: "parent",
  })),
  isLegacyOwner: vi.fn((id: string | null | undefined) => id === "demo-user"),
  sanitizeUserId: vi.fn((raw: string | null | undefined) => ((raw ?? "").trim() || "demo-user")),
  getLiveMemberById: vi.fn<() => Promise<LiveMember | null>>(async () => ({
    id: "m-alex",
    name: "Alex",
    role: "parent",
  })),
  getCapsule: vi.fn(),
  markCapsuleViewed: vi.fn(async () => {}),
  getUserCapsules: vi.fn<() => Promise<unknown[]>>(async () => []),
  checkAndUnlockCapsules: vi.fn<() => Promise<number>>(async () => 0),
}));

vi.mock("@/lib/auth", () => ({
  getUserId: mocks.getUserId,
  requireSession: mocks.requireSession,
  isLegacyOwner: mocks.isLegacyOwner,
  sanitizeUserId: mocks.sanitizeUserId,
}));
vi.mock("@/lib/live-member", () => ({
  getLiveMemberById: mocks.getLiveMemberById,
  verifyLiveParentSession: vi.fn(),
}));
vi.mock("@/lib/time-capsule", () => ({
  getCapsule: mocks.getCapsule,
  markCapsuleViewed: mocks.markCapsuleViewed,
  getUserCapsules: mocks.getUserCapsules,
  checkAndUnlockCapsules: mocks.checkAndUnlockCapsules,
}));

import { POST as VIEW_POST } from "@/app/api/time-capsules/[id]/view/route";

function capsule(overrides: Record<string, unknown> = {}) {
  return {
    capsule: {
      id: "cap-1",
      title: "For the twins, 2031",
      unlockDate: "2031-01-01T00:00:00.000Z",
      createdBy: "Alex",
      recipients: ["Bailey"],
      isFamilyWide: false,
      status: "locked",
      contentCount: 0,
      totalSize: 0,
      unlockNotificationSent: false,
      viewedBy: [],
      ...overrides,
    },
    contents: [],
  };
}

function req() {
  return new NextRequest("http://localhost/api/time-capsules/cap-1/view", { method: "POST" });
}

function params() {
  return { params: Promise.resolve({ id: "cap-1" }) };
}

async function view() {
  const res = await VIEW_POST(req(), params());
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) if (typeof (fn as any).mockReset === "function") (fn as any).mockReset();
  mocks.requireSession.mockResolvedValue({ name: "Alex", memberId: "m-alex", role: "parent" });
  mocks.isLegacyOwner.mockImplementation((id: string | null | undefined) => id === "demo-user");
  mocks.sanitizeUserId.mockImplementation((raw: string | null | undefined) => (raw ?? "").trim() || "demo-user");
  mocks.getUserId.mockResolvedValue("Alex");
  mocks.getLiveMemberById.mockResolvedValue({ id: "m-alex", name: "Alex", role: "parent" });
  mocks.getCapsule.mockResolvedValue(capsule());
  mocks.markCapsuleViewed.mockResolvedValue(undefined);
});

describe("Bug 4 — a stranger cannot mark a private capsule viewed", () => {
  it("403s an unrelated child and writes nothing", async () => {
    mocks.getLiveMemberById.mockResolvedValue({ id: "m-kiwi", name: "Kiwi", role: "child" });
    mocks.getUserId.mockResolvedValue("Kiwi");
    const { status, body } = await view();
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden");
    expect(mocks.markCapsuleViewed).not.toHaveBeenCalled();
  });

  it("403s a guest", async () => {
    mocks.getLiveMemberById.mockResolvedValue({ id: "m-guest", name: "Guest", role: "guest" });
    mocks.getUserId.mockResolvedValue("Guest");
    expect((await view()).status).toBe(403);
    expect(mocks.markCapsuleViewed).not.toHaveBeenCalled();
  });

  it("403s a parent who is neither creator, recipient, nor family-wide", async () => {
    mocks.getLiveMemberById.mockResolvedValue({ id: "m-rubio", name: "Rubio", role: "parent" });
    mocks.getUserId.mockResolvedValue("Rubio");
    expect((await view()).status).toBe(403);
    expect(mocks.markCapsuleViewed).not.toHaveBeenCalled();
  });

  it("404s an unknown capsule rather than 403 (no existence oracle difference)", async () => {
    mocks.getCapsule.mockResolvedValue(null);
    const { status } = await view();
    expect(status).toBe(404);
    expect(mocks.markCapsuleViewed).not.toHaveBeenCalled();
  });
});

describe("Bug 4 — the people who may open it", () => {
  it("lets the creator mark it viewed", async () => {
    const { status, body } = await view();
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(mocks.markCapsuleViewed).toHaveBeenCalledWith("cap-1", "Alex");
  });

  it("lets a named recipient mark it viewed", async () => {
    mocks.getLiveMemberById.mockResolvedValue({ id: "m-bailey", name: "Bailey", role: "child" });
    mocks.getUserId.mockResolvedValue("Bailey");
    const { status } = await view();
    expect(status).toBe(200);
    expect(mocks.markCapsuleViewed).toHaveBeenCalledWith("cap-1", "Bailey");
  });

  it("lets any signed-in member mark a family-wide capsule viewed", async () => {
    mocks.getCapsule.mockResolvedValue(capsule({ isFamilyWide: true }));
    mocks.getLiveMemberById.mockResolvedValue({ id: "m-petz", name: "Ziggy", role: "pet" });
    mocks.getUserId.mockResolvedValue("Ziggy");
    const { status } = await view();
    expect(status).toBe(200);
    expect(mocks.markCapsuleViewed).toHaveBeenCalledWith("cap-1", "Ziggy");
  });

  it("keeps the legacy demo-user namespace reachable (F8a continuity)", async () => {
    mocks.getCapsule.mockResolvedValue(capsule({ createdBy: "demo-user", recipients: [] }));
    mocks.getLiveMemberById.mockResolvedValue({ id: "m-alex", name: "Alex", role: "parent" });
    mocks.getUserId.mockResolvedValue("Alex");
    const { status } = await view();
    expect(status).toBe(200);
    expect(mocks.markCapsuleViewed).toHaveBeenCalledWith("cap-1", "Alex");
  });
});

describe("Bug 4 — live identity, not the cookie's word", () => {
  it("401s with no session and never writes", async () => {
    mocks.requireSession.mockResolvedValue(null);
    const { status, body } = await view();
    expect(status).toBe(401);
    expect(body.error).toBe("unauthorized");
    expect(mocks.markCapsuleViewed).not.toHaveBeenCalled();
    expect(mocks.getLiveMemberById).not.toHaveBeenCalled();
  });

  it("401s a session whose member no longer exists", async () => {
    mocks.getLiveMemberById.mockResolvedValue(null);
    const { status, body } = await view();
    expect(status).toBe(401);
    expect(body.error).toBe("member_missing");
    expect(mocks.markCapsuleViewed).not.toHaveBeenCalled();
  });

  it("fails CLOSED with 503 when the PocketBase identity read fails", async () => {
    mocks.getLiveMemberById.mockRejectedValue(new Error("pocketbase down"));
    const { status, body } = await view();
    expect(status).toBe(503);
    expect(body.error).toBe("member_lookup_failed");
    expect(mocks.markCapsuleViewed).not.toHaveBeenCalled();
  });

  it("uses the LIVE member's name, not the session cookie's claim", async () => {
    // The capsule belongs to Bailey. The cookie CLAIMS to be Bailey, but the
    // live PocketBase row says the session holder is Alex. Trusting the cookie
    // would 200 and stamp "Bailey opened it" onto Bailey's private capsule from
    // someone else's session; resolving the live row is a 403.
    mocks.requireSession.mockResolvedValue({ name: "Bailey", memberId: "m-alex", role: "parent" });
    mocks.getUserId.mockResolvedValue("Bailey");
    mocks.getCapsule.mockResolvedValue(capsule({ createdBy: "Bailey", recipients: ["Bailey"] }));
    mocks.getLiveMemberById.mockResolvedValue({ id: "m-alex", name: "Alex", role: "parent" });
    const { status } = await view();
    expect(status).toBe(403);
    expect(mocks.markCapsuleViewed).not.toHaveBeenCalled();
  });

  it("writes the caller's name even before authentication hydrates a role", async () => {
    mocks.requireSession.mockResolvedValue({ name: "Bailey", memberId: "m-bailey", role: "child" });
    mocks.getLiveMemberById.mockResolvedValue({ id: "m-bailey", name: "Bailey", role: "child" });
    mocks.getUserId.mockResolvedValue("Bailey");
    const { status } = await view();
    expect(status).toBe(200);
    expect(mocks.markCapsuleViewed).toHaveBeenCalledWith("cap-1", "Bailey");
  });
});

describe("Bug 4 — a missing capsule never becomes a 500", () => {
  it("returns 404 when the service reports no capsule", async () => {
    mocks.getCapsule.mockResolvedValue(null);
    expect((await view()).body.error).toBe("capsule_not_found");
  });
});