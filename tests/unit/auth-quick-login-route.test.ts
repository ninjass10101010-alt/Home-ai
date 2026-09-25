// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const members = vi.hoisted(() => ({ rows: [] as any[], failLookup: false }));
vi.mock("@/lib/server-auth", () => ({
  findMemberByName: async (name: string) => {
    if (members.failLookup) throw new Error("PocketBase unreachable");
    return members.rows.find((m: any) => m.name === name) || null;
  },
  sanitizeMember: (m: any) => ({ ...m, pin: undefined }),
}));

import { POST } from "@/app/api/auth/quick-login/route";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

function req(body: any) {
  return new NextRequest("http://localhost/api/auth/quick-login", {
    method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  members.failLookup = false;
  members.rows = [
    { id: "a", name: "Caspian", role: "child", age: 5, pin: "1010" },
    { id: "b", name: "Jasmine", role: "child", age: 10, pin: "0402" },
    { id: "c", name: "Bailey", role: "child", pin: "1005" },        // age missing
    { id: "d", name: "Rico", role: "pet", age: 5, pin: "0000" },
    { id: "e", name: "Rebecca", role: "parent", age: 38, pin: "0202" },
  ];
});

describe("POST /api/auth/quick-login", () => {
  it("signs in an under-10 child and sets the session cookie", async () => {
    const res = await POST(req({ memberName: "Caspian" }));
    expect(res.status).toBe(200);
    const token = res.cookies.get(SESSION_COOKIE)?.value;
    expect(token).toBeTruthy();
    expect(await verifySession(token)).toMatchObject({
      memberId: "a",
      name: "Caspian",
      role: "child",
    });
    const body = await res.json();
    expect(body.member.name).toBe("Caspian");
    expect(body.member.pin).toBeUndefined();
  });
  it("sets the child role's 900 second Max-Age on the session cookie", async () => {
    const res = await POST(req({ memberName: "Caspian" }));
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toContain("Max-Age=900");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect(setCookie).toContain("Path=/");
  });
  it("rejects a 10-year-old (strictly under 10)", async () => {
    expect((await POST(req({ memberName: "Jasmine" }))).status).toBe(403);
  });
  it("fails closed when age is missing", async () => {
    expect((await POST(req({ memberName: "Bailey" }))).status).toBe(403);
  });
  it("rejects pets and parents", async () => {
    expect((await POST(req({ memberName: "Rico" }))).status).toBe(403);
    expect((await POST(req({ memberName: "Rebecca" }))).status).toBe(403);
  });
  it("404 unknown member, 400 missing name", async () => {
    expect((await POST(req({ memberName: "Nobody" }))).status).toBe(404);
    expect((await POST(req({}))).status).toBe(400);
  });
  it("fail-closes to 403 pin_required with NO cookie when the PB lookup rejects", async () => {
    members.failLookup = true;
    const res = await POST(req({ memberName: "Caspian" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("pin_required");
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });
});
