import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ verifyPinFromPB: vi.fn() }));
vi.mock("@/lib/server-auth", () => ({
  verifyPinFromPB: mocks.verifyPinFromPB,
  sanitizeMember: (m: any) => {
    const { pin, ...rest } = m;
    return rest;
  },
}));

import { POST } from "@/app/api/members/verify/route";

function req(body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/members/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.verifyPinFromPB.mockReset();
});

describe("POST /api/members/verify", () => {
  it("returns the sanitized member on a valid PIN", async () => {
    mocks.verifyPinFromPB.mockResolvedValue({ id: "m1", name: "Rebecca", role: "parent", pin: "9999" });

    const res = await POST(req({ memberName: "Rebecca", pin: "1234" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.member.name).toBe("Rebecca");
    expect(body.member.pin).toBeUndefined();
    expect(mocks.verifyPinFromPB).toHaveBeenCalledWith("Rebecca", "1234");
  });

  it("returns 401 Invalid PIN when verification fails", async () => {
    mocks.verifyPinFromPB.mockResolvedValue(null);

    const res = await POST(req({ memberName: "Rebecca", pin: "0000" }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid PIN" });
  });

  it("returns 400 when memberName or pin are missing", async () => {
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ memberName: "Rebecca" }))).status).toBe(400);
    expect((await POST(req({ pin: "1234" }))).status).toBe(400);
    expect(mocks.verifyPinFromPB).not.toHaveBeenCalled();
  });
});
