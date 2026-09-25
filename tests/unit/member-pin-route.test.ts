import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyPinFromPB: vi.fn(),
  verifyPinForMemberId: vi.fn(),
  verifySession: vi.fn(),
  isMemberPinAvailable: vi.fn(),
  findOrCreateMemberRecord: vi.fn(),
  withMemberAdminOperation: vi.fn(),
  withAdmin: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({
  verifyPinFromPB: mocks.verifyPinFromPB,
  verifyPinForMemberId: mocks.verifyPinForMemberId,
  verifySession: mocks.verifySession,
  isMemberPinAvailable: mocks.isMemberPinAvailable,
  findOrCreateMemberRecord: mocks.findOrCreateMemberRecord,
  withMemberAdminOperation: mocks.withMemberAdminOperation,
}));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn) }));
vi.mock("@/lib/session", () => ({ verifySession: mocks.verifySession, SESSION_COOKIE: "consuela_session" }));

import { POST } from "@/app/api/members/pin/route";

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/members/pin", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "consuela_session=token" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.verifyPinFromPB.mockResolvedValue({ id: "pb-1", pbId: "pb-1", name: "Rebecca", role: "parent" });
  mocks.verifyPinForMemberId.mockResolvedValue({ id: "pb-1", pbId: "pb-1", name: "Jon", role: "parent" });
  mocks.verifySession.mockResolvedValue({ memberId: "pb-1", name: "Jon", role: "parent" });
  mocks.isMemberPinAvailable.mockResolvedValue(true);
  mocks.withMemberAdminOperation.mockImplementation((fn: () => Promise<unknown>) => fn());
  mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn({}));
  mocks.findOrCreateMemberRecord.mockResolvedValue({ id: "pb-1", name: "Rebecca", role: "parent" });
});

describe("POST /api/members/pin", () => {
  it.each([null, 1234, ["1234"], "", "12x"])("rejects non-credential PIN value %s", async (newPin) => {
    const res = await POST(request({ actorName: "Rebecca", actorPin: "0202", newPin }));

    expect(res.status).toBe(400);
    expect(mocks.verifyPinFromPB).not.toHaveBeenCalled();
    expect(mocks.findOrCreateMemberRecord).not.toHaveBeenCalled();
  });

  it("returns pin_collision before writing when another credential uses the PIN", async () => {
    mocks.isMemberPinAvailable.mockResolvedValue(false);

    const res = await POST(request({ actorName: "Rebecca", actorPin: "0202", newPin: "1234" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "pin_collision" });
    expect(mocks.findOrCreateMemberRecord).not.toHaveBeenCalled();
  });

  it("binds the write to the signed session ID even when actorName is wrong", async () => {
    const res = await POST(request({ actorName: "Jonathan", actorPin: "0202", newPin: "1234" }));

    expect(res.status).toBe(200);
    expect(mocks.verifyPinForMemberId).toHaveBeenCalledWith("pb-1", "0202");
    expect(mocks.findOrCreateMemberRecord).toHaveBeenCalledWith({}, { id: "pb-1", pbId: "pb-1", name: "Jon", role: "parent" }, { pin: "1234" });
  });

  it("rejects a missing signed session before PIN verification", async () => {
    mocks.verifySession.mockResolvedValue(null);
    const res = await POST(request({ actorName: "Rebecca", actorPin: "0202", newPin: "1234" }));

    expect(res.status).toBe(401);
    expect(mocks.verifyPinForMemberId).not.toHaveBeenCalled();
  });
  it("keeps a newer rotation authoritative when an older verification resumes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let firstVerification = true;
    let lifecycleTail: Promise<unknown> = Promise.resolve();
    mocks.withMemberAdminOperation.mockImplementation((fn: () => Promise<unknown>) => {
      const run = lifecycleTail.then(fn);
      lifecycleTail = run.catch(() => undefined);
      return run;
    });
    mocks.verifyPinForMemberId.mockImplementation(async (_id: string, pin: string) => {
      if (pin === "0202" && firstVerification) {
        firstVerification = false;
        await gate;
      }
      return { id: "pb-1", pbId: "pb-1", name: "Rebecca", role: "parent" };
    });
    const updates: string[] = [];
    mocks.findOrCreateMemberRecord.mockImplementation(async (_pb, _actor, patch) => {
      updates.push(String(patch.pin));
      return { id: "pb-1", ...patch };
    });

    const oldRotation = POST(request({ actorName: "Rebecca", actorPin: "0202", newPin: "1111" }));
    await vi.waitFor(() => expect(mocks.verifyPinForMemberId).toHaveBeenCalledWith("pb-1", "0202"));
    const newRotationPromise = POST(request({ actorName: "Rebecca", actorPin: "0202", newPin: "2222" }));
    release();
    const [oldRotationResponse, newRotation] = await Promise.all([oldRotation, newRotationPromise]);

    expect(oldRotationResponse.status).toBe(200);
    expect(newRotation.status).toBe(200);
    expect(updates.at(-1)).toBe("2222");
  });
});
