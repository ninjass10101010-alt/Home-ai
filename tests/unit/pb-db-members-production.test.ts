import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ withAdmin: vi.fn() }));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: mocks.withAdmin,
  getAuthedPB: vi.fn(),
}));

import { db as pbDb } from "@/db/pb-db";
import { memberFallbacks } from "@/lib/member-fallback";

const OPT_IN = "NEXT_PUBLIC_CANONICAL_MEMBER_FALLBACKS";

function pbClientWithMembers(getFullList: () => Promise<any[]>) {
  return { collection: () => ({ getFullList }) };
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv(OPT_IN, "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("pbDb member reads are PocketBase only in production", () => {
  it("serves nothing when PocketBase returns zero member rows", async () => {
    mocks.withAdmin.mockImplementation(async (fn: (p: unknown) => Promise<unknown>) =>
      fn(pbClientWithMembers(async () => [])),
    );

    await expect(pbDb.selectMembers()).resolves.toEqual([]);
    await expect(pbDb.selectMembersDetailed()).resolves.toEqual([]);
    await expect(pbDb.selectMembersForCalendar()).resolves.toEqual([
      { name: "All", color: "green", emoji: "👨‍👩‍👧‍👦" },
    ]);
  });

  it("serves nothing when the PocketBase admin client is unreachable", async () => {
    mocks.withAdmin.mockRejectedValue(new Error("pocketbase unreachable"));

    await expect(pbDb.selectMembers()).resolves.toEqual([]);
    await expect(pbDb.selectMembersDetailed()).resolves.toEqual([]);
  });

  it("serves nothing when the PocketBase member read is rejected", async () => {
    mocks.withAdmin.mockImplementation(async (fn: (p: unknown) => Promise<unknown>) =>
      fn(
        pbClientWithMembers(async () => {
          throw new Error("members read failed");
        }),
      ),
    );

    await expect(pbDb.selectMembers()).resolves.toEqual([]);
    await expect(pbDb.selectMembersDetailed()).resolves.toEqual([]);
  });

  it("serves nothing when PocketBase returns only unusable member rows", async () => {
    mocks.withAdmin.mockImplementation(async (fn: (p: unknown) => Promise<unknown>) =>
      fn(
        pbClientWithMembers(async () => [
          { id: "m8", name: "   ", role: "child", pin: "stored-only" },
        ]),
      ),
    );

    await expect(pbDb.selectMembers()).resolves.toEqual([]);
    await expect(pbDb.selectMembersDetailed()).resolves.toEqual([]);
  });

  it("returns live PocketBase rows untouched in production", async () => {
    const live = [
      { id: "m7", name: "Caspian Garcia", role: "child", emoji: "🦊", pin: "stored-only", age: 5 },
    ];
    mocks.withAdmin.mockImplementation(async (fn: (p: unknown) => Promise<unknown>) =>
      fn(pbClientWithMembers(async () => live)),
    );

    const members = await pbDb.selectMembers();

    expect(members).toHaveLength(1);
    expect(members[0].id).toBe("m7");
    expect(members[0].name).toBe("Caspian");
    expect(members[0].fullName).toBe("Caspian Garcia");
  });

  it("still serves the canonical family for a non-production opt-in", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(OPT_IN, "true");
    mocks.withAdmin.mockImplementation(async (fn: (p: unknown) => Promise<unknown>) =>
      fn(pbClientWithMembers(async () => [])),
    );

    const members = await pbDb.selectMembers();

    expect(members).toHaveLength(memberFallbacks.length);
    expect(await pbDb.selectMembersDetailed()).toHaveLength(memberFallbacks.length);
  });
});
